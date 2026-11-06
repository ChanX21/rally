import { createHash } from 'node:crypto';

import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { rewardLedger, rewardPolicies, users } from '../db/schema/index.js';
import {
  arrivalAction,
  DEFAULT_AMOUNTS,
  DEFAULT_POLICY_VERSION,
  LATE_CANCEL_WINDOW_MIN,
  MAX_EARNED_PER_DAY,
  meetTime,
  NO_SHOW_HOLD_HOURS,
  type PolicyAmounts,
  policyError,
  REPEAT_GROUP_DAYS,
  type RewardAction,
  tierFor,
} from '../domain/reward-policy.js';
import type { Db, Tx } from '../lib/db-types.js';
import type { Deps } from '../lib/deps.js';
import { AppError } from '../lib/errors.js';
import { type NotificationInput, notify } from '../lib/notify.js';
import { activeMembers, type Rally } from '../repositories/rallies.js';

export interface Policy {
  version: number;
  amounts: PolicyAmounts;
}

/** Version 1 is published by the contract's constructor, so it needs no database row. */
export async function latestPolicy(db: Db): Promise<Policy> {
  const [row] = await db
    .select()
    .from(rewardPolicies)
    .orderBy(desc(rewardPolicies.version))
    .limit(1);
  return row
    ? { version: row.version, amounts: row.amounts as PolicyAmounts }
    : { version: DEFAULT_POLICY_VERSION, amounts: DEFAULT_AMOUNTS };
}

/** Saves the next version. The scheduler publishes it on-chain, and new entries use it at once. */
export async function publishPolicy(deps: Deps, amounts: PolicyAmounts): Promise<Policy> {
  const problem = policyError(amounts);
  if (problem) throw new AppError(422, 'INVALID_POLICY', problem);
  return deps.db.transaction(async (tx) => {
    // Serializes publishers, so two admins cannot both claim the next version.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('reward_policies'))`);
    const version = (await latestPolicy(tx)).version + 1;
    await tx.insert(rewardPolicies).values({ version, amounts });
    return { version, amounts };
  });
}

export interface EntryInput {
  userId: string;
  rallyId: string;
  action: RewardAction;
  /** Stable for this event, so a retry can never apply it twice. */
  key: string;
  groupKey?: string;
  /** Delays a penalty so the person has time to appeal it. */
  holdUntil?: Date;
}

/** Returns the new entry's id, or null if this event was already recorded. */
export async function addEntry(tx: Tx, policy: Policy, input: EntryInput): Promise<string | null> {
  const [row] = await tx
    .insert(rewardLedger)
    .values({
      subjectUserId: input.userId,
      rallyId: input.rallyId,
      reason: input.action,
      action: input.action,
      delta: policy.amounts[input.action],
      policyVersion: policy.version,
      antiAbuse: 'passed',
      idempotencyKey: input.key,
      state: input.holdUntil ? 'pending' : 'applied',
      appliesAt: input.holdUntil ?? null,
      groupKey: input.groupKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: rewardLedger.id });
  return row?.id ?? null;
}

/** Only gains count. Summing penalties too would give someone more earning room after a no-show. */
export async function earnedToday(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${rewardLedger.delta}), 0)::int` })
    .from(rewardLedger)
    .where(
      and(
        eq(rewardLedger.subjectUserId, userId),
        eq(rewardLedger.state, 'applied'),
        sql`${rewardLedger.delta} > 0`,
        gte(rewardLedger.createdAt, new Date(Date.now() - 86_400_000)),
      ),
    );
  return row?.total ?? 0;
}

export function groupKeyFor(userIds: Iterable<string>): string {
  return createHash('sha256').update([...userIds].sort().join(',')).digest('hex');
}

/** Stops friends farming points by meeting repeatedly. */
async function earnedWithGroup(
  tx: Tx,
  userId: string,
  action: RewardAction,
  groupKey: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: rewardLedger.id })
    .from(rewardLedger)
    .where(
      and(
        eq(rewardLedger.subjectUserId, userId),
        eq(rewardLedger.action, action),
        eq(rewardLedger.groupKey, groupKey),
        gte(rewardLedger.createdAt, new Date(Date.now() - REPEAT_GROUP_DAYS * 86_400_000)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function earnForGroup(
  tx: Tx,
  policy: Policy,
  input: EntryInput & { groupKey: string },
): Promise<boolean> {
  const amount = policy.amounts[input.action];
  if (await earnedWithGroup(tx, input.userId, input.action, input.groupKey)) return false;
  if ((await earnedToday(tx, input.userId)) + amount > MAX_EARNED_PER_DAY) return false;
  return (await addEntry(tx, policy, input)) !== null;
}

type Member = Awaited<ReturnType<typeof activeMembers>>[number];

/**
 * Applies check-in results, using the members as they were before check-in changed them. Points come
 * only from a person's own tap, so a host checking in late can never cost anyone points.
 */
export async function rewardCheckIn(
  tx: Tx,
  rally: Rally,
  members: Member[],
  present: Set<string>,
): Promise<void> {
  const policy = await latestPolicy(tx);
  const groupKey = groupKeyFor(present);
  for (const member of members) {
    if (!present.has(member.userId)) {
      await holdNoShow(tx, policy, rally, member.userId);
      continue;
    }
    if (!member.arrivedAt) continue;
    const action = arrivalAction(rally, member.arrivedAt);
    if (action === 'OnTime') {
      const earned = await earnForGroup(tx, policy, {
        userId: member.userId,
        rallyId: rally.id,
        action,
        key: `on_time:${rally.id}:${member.userId}`,
        groupKey,
      });
      if (earned) {
        await notifyChange(tx, member.userId, rally, 'reward.earned', 'You were on time', policy.amounts.OnTime);
      }
    } else if (action === 'Late') {
      const added = await addEntry(tx, policy, {
        userId: member.userId,
        rallyId: rally.id,
        action,
        key: `late:${rally.id}:${member.userId}`,
      });
      if (added) {
        await notifyChange(tx, member.userId, rally, 'reward.penalty', 'You arrived late', policy.amounts.Late);
      }
    }
  }
}

async function notifyChange(
  tx: Tx,
  userId: string,
  rally: Rally,
  type: string,
  title: string,
  amount: number,
): Promise<void> {
  const signed = amount > 0 ? `+${amount}` : String(amount);
  await notify(tx, {
    userId,
    type,
    title,
    body: `${signed} RALLY for "${rally.goal}".`,
    data: { rallyId: rally.id },
    dedupeKey: `${type}:${title}:${rally.id}:${userId}`,
  });
}

async function holdNoShow(tx: Tx, policy: Policy, rally: Rally, userId: string): Promise<void> {
  const added = await addEntry(tx, policy, {
    userId,
    rallyId: rally.id,
    action: 'NoShow',
    key: `no_show:${rally.id}:${userId}`,
    holdUntil: new Date(Date.now() + NO_SHOW_HOLD_HOURS * 3_600_000),
  });
  if (!added) return;
  await notify(tx, {
    userId,
    type: 'reward.no_show_pending',
    title: 'You were marked absent',
    body: `If you were at "${rally.goal}", tap "I was there" on your profile within ${NO_SHOW_HOLD_HOURS} hours.`,
    data: { rallyId: rally.id },
    dedupeKey: `reward.no_show_pending:${rally.id}:${userId}`,
  });
}

/** Host completes a rally. Needs at least two people present, which check-in already requires. */
export async function rewardHostCompleted(tx: Tx, rally: Rally, present: Set<string>): Promise<void> {
  const policy = await latestPolicy(tx);
  const earned = await earnForGroup(tx, policy, {
    userId: rally.creatorId,
    rallyId: rally.id,
    action: 'HostCompleted',
    key: `host_completed:${rally.id}`,
    groupKey: groupKeyFor(present),
  });
  if (earned) {
    await notifyChange(tx, rally.creatorId, rally, 'reward.earned', 'Your rally happened', policy.amounts.HostCompleted);
  }
}

/** Call before the claim is released. Only people who were counted on get a late-cancel penalty. */
export async function penaliseLateCancel(tx: Tx, rally: Rally, userId: string): Promise<void> {
  if (rally.status !== 'ready' && rally.status !== 'formed') return;
  const cutoff = meetTime(rally).getTime() - LATE_CANCEL_WINDOW_MIN * 60_000;
  if (Date.now() < cutoff) return;
  const policy = await latestPolicy(tx);
  const added = await addEntry(tx, policy, {
    userId,
    rallyId: rally.id,
    action: 'LateCancel',
    key: `late_cancel:${rally.id}:${userId}`,
  });
  if (added) {
    await notifyChange(tx, userId, rally, 'reward.penalty', 'You cancelled late', policy.amounts.LateCancel);
  }
}

/**
 * A formed rally that expired with no check-in has no attendance record. The host is penalised only
 * if a member's tap shows someone turned up and the host did not. Nobody else can be judged.
 */
export async function penaliseAbsentHost(tx: Tx, rally: Rally): Promise<void> {
  if (rally.status !== 'formed') return;
  const members = await activeMembers(tx, rally.id);
  const host = members.find((member) => member.userId === rally.creatorId);
  const someoneCame = members.some(
    (member) => member.userId !== rally.creatorId && member.arrivedAt !== null,
  );
  if (!someoneCame || !host || host.arrivedAt) return;
  await holdNoShow(tx, await latestPolicy(tx), rally, rally.creatorId);
}

/** Applies no-show penalties whose appeal time has run out. */
export async function applyDuePenalties(deps: Deps): Promise<number> {
  const due = await deps.db
    .select({ id: rewardLedger.id })
    .from(rewardLedger)
    .where(and(eq(rewardLedger.state, 'pending'), lte(rewardLedger.appliesAt, new Date())))
    .limit(100);
  if (due.length === 0) return 0;

  return deps.db.transaction(async (tx) => {
    // Checks the state again, so an appeal arriving since the query above still wins.
    const rows = await tx
      .update(rewardLedger)
      .set({ state: 'applied' })
      .where(
        and(
          inArray(rewardLedger.id, due.map((row) => row.id)),
          eq(rewardLedger.state, 'pending'),
        ),
      )
      .returning();
    await notify(
      tx,
      ...rows.map((row): NotificationInput => ({
        userId: row.subjectUserId,
        type: 'reward.penalty',
        title: 'No-show recorded',
        body: `${row.delta} RALLY for missing a rally you joined.`,
        data: row.rallyId ? { rallyId: row.rallyId } : {},
        dedupeKey: `reward.penalty:${row.id}`,
      })),
    );
    return rows.length;
  });
}

export async function getRewards(deps: Deps, userId: string) {
  const [user] = await deps.db
    .select({ walletAddress: users.walletAddress, rewardAddress: users.rewardAddress })
    .from(users)
    .where(eq(users.id, userId));
  const [totals] = await deps.db
    .select({ net: sql<number>`coalesce(sum(${rewardLedger.delta}), 0)::int` })
    .from(rewardLedger)
    .where(and(eq(rewardLedger.subjectUserId, userId), eq(rewardLedger.state, 'applied')));
  const rows = await deps.db
    .select()
    .from(rewardLedger)
    .where(eq(rewardLedger.subjectUserId, userId))
    .orderBy(desc(rewardLedger.createdAt))
    .limit(100);

  const net = totals?.net ?? 0;
  const { env } = deps;
  const address = user?.rewardAddress ?? user?.walletAddress ?? null;
  return {
    balance: net,
    net,
    tier: tierFor(net),
    chain:
      env.ARC_LEDGER_ENABLED && env.ARC_TOKEN_ADDRESS && env.ARC_CHAIN_ID
        ? {
            chainId: env.ARC_CHAIN_ID,
            rpcUrl: env.ARC_RPC_URL ?? null,
            tokenAddress: env.ARC_TOKEN_ADDRESS,
            explorerUrl: env.ARC_EXPLORER_URL,
            address,
          }
        : null,
    entries: rows
      .filter((row) => row.state !== 'cancelled')
      .map((row) => ({
        id: row.id,
        rallyId: row.rallyId,
        reason: row.reason,
        action: row.action,
        points: row.delta,
        policyVersion: row.policyVersion,
        state: row.state,
        appliesAt: row.appliesAt?.toISOString() ?? null,
        chainTxHash: row.chainTxHash,
        createdAt: row.createdAt.toISOString(),
      })),
  };
}
