import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { type Hex, keccak256, stringToHex } from 'viem';

import {
  disputes,
  outboxEvents,
  rewardLedger,
  rallyProofs,
  rewardPolicies,
  users,
} from '../db/schema/index.js';
import { REWARD_ACTIONS, type RewardAction } from '../domain/reward-policy.js';
import type { Db } from '../lib/db-types.js';
import type { Deps } from '../lib/deps.js';
import { enqueue } from '../lib/outbox.js';

const BATCH = 100;

/** The order must match the Category and Outcome enums in contracts/src/RallyLedger.sol. */
export const DISPUTE_CATEGORIES = ['no_show_appeal', 'misconduct', 'false_checkin', 'other'] as const;
export const DISPUTE_OUTCOMES = ['upheld', 'dismissed', 'false'] as const;

const plainKey = (value: string): Hex => keccak256(stringToHex(value));

/** Salted, so public hashes cannot be guessed from short text or matched to rally ids. */
function secretHash(deps: Deps, ...parts: string[]): Hex {
  const secret = deps.env.ARC_REF_SECRET;
  if (!secret) throw new Error('ARC_REF_SECRET is required for chain sync');
  return keccak256(stringToHex([secret, ...parts].join('\u0000')));
}

/** Pins the address at the first write, so a later wallet change cannot split someone's history. */
async function pinAddress(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .update(users)
    .set({ rewardAddress: sql`coalesce(${users.rewardAddress}, ${users.walletAddress})` })
    .where(eq(users.id, userId))
    .returning({ address: users.rewardAddress });
  return row?.address ?? null;
}

function requireArc(deps: Deps) {
  if (!deps.arc) throw new Error('Arc ledger is not enabled');
  return deps.arc;
}

export async function syncRewardEntry(deps: Deps, entryId: string): Promise<void> {
  const arc = requireArc(deps);
  const [entry] = await deps.db.select().from(rewardLedger).where(eq(rewardLedger.id, entryId));
  if (!entry || entry.state !== 'applied' || entry.chainStatus === 'synced' || !entry.action) return;
  let proofHash: string | null = null;
  if (entry.action === 'RallyCompleted') {
    if (!deps.env.ARC_COMPLETION_REWARDS_ENABLED || !entry.proofId) return;
    const [proof] = await deps.db.select().from(rallyProofs).where(eq(rallyProofs.id, entry.proofId));
    if (!proof || proof.state !== 'accepted') return;
    proofHash = proof.requestHash;
  }

  const subject = await pinAddress(deps.db, entry.subjectUserId);
  if (!subject) throw new Error('User has no wallet address');

  const hash = await arc.record({
    subject,
    action: REWARD_ACTIONS.indexOf(entry.action as RewardAction),
    delta: entry.delta,
    policyVersion: entry.policyVersion,
    // Different for each person, so two records from one rally do not show that they met.
    ref: secretHash(deps, 'ref', entry.rallyId ?? entry.id, subject.toLowerCase()),
    evidenceHash: proofHash ? secretHash(deps, 'proof', proofHash, entry.subjectUserId) : secretHash(deps, 'evidence', entry.id),
    key: plainKey(`entry:${entry.idempotencyKey}`),
  });
  await deps.db
    .update(rewardLedger)
    .set({ chainStatus: 'synced', chainTxHash: hash })
    .where(eq(rewardLedger.id, entryId));
}

export async function syncPolicy(deps: Deps, version: number): Promise<void> {
  const arc = requireArc(deps);
  const [policy] = await deps.db
    .select()
    .from(rewardPolicies)
    .where(eq(rewardPolicies.version, version));
  if (!policy || policy.chainTxHash) return;

  const hash = await arc.publishPolicy(
    version,
    REWARD_ACTIONS.map((action) => policy.amounts[action] ?? 0),
  );
  await deps.db
    .update(rewardPolicies)
    .set({ chainTxHash: hash ?? 'already-published' })
    .where(eq(rewardPolicies.version, version));
}

export async function syncDispute(deps: Deps, disputeId: string): Promise<void> {
  const arc = requireArc(deps);
  const [dispute] = await deps.db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!dispute || dispute.chainStatus === 'synced' || dispute.status === 'open') return;

  const subject = await pinAddress(deps.db, dispute.subjectId);
  const raiser = await pinAddress(deps.db, dispute.raisedBy);
  if (!subject || !raiser) throw new Error('A party to this dispute has no wallet address');

  const hash = await arc.recordRuling({
    disputeRef: secretHash(deps, 'dispute', dispute.id),
    subject,
    raiser,
    category: DISPUTE_CATEGORIES.indexOf(dispute.category),
    outcome: DISPUTE_OUTCOMES.indexOf(dispute.status),
    evidenceHash: secretHash(deps, 'evidence', dispute.description),
    key: plainKey(`ruling:${dispute.id}`),
  });
  await deps.db
    .update(disputes)
    .set({ chainStatus: 'synced', chainTxHash: hash })
    .where(eq(disputes.id, disputeId));
}

/**
 * Queues whatever is ready for the chain. Scanning instead of queueing at write time also backfills
 * everything once the ledger is enabled, and picks up a user's entries when a wallet appears.
 */
export async function queueChainWork(deps: Deps): Promise<number> {
  if (!deps.arc) return 0;
  let queued = 0;

  const policies = await deps.db
    .select({ version: rewardPolicies.version })
    .from(rewardPolicies)
    .where(isNull(rewardPolicies.chainTxHash))
    .orderBy(asc(rewardPolicies.version));
  for (const { version } of policies) {
    await enqueue(deps.db, {
      type: 'reward.policy_sync',
      payload: { version },
      dedupeKey: `reward.policy_sync:${version}`,
    });
  }

  const entries = await deps.db
    .select({ id: rewardLedger.id })
    .from(rewardLedger)
    .innerJoin(users, eq(users.id, rewardLedger.subjectUserId))
    .where(
      and(
        eq(rewardLedger.state, 'applied'),
        deps.env.ARC_COMPLETION_REWARDS_ENABLED ? undefined : ne(rewardLedger.action, 'RallyCompleted'),
        eq(rewardLedger.chainStatus, 'pending'),
        isNotNull(rewardLedger.action),
        or(isNotNull(users.rewardAddress), isNotNull(users.walletAddress)),
      ),
    )
    .orderBy(asc(rewardLedger.createdAt))
    .limit(BATCH);
  for (const { id } of entries) {
    await deps.db.transaction(async (tx) => {
      await tx
        .update(rewardLedger)
        .set({ chainStatus: 'queued' })
        .where(eq(rewardLedger.id, id));
      await enqueue(tx, {
        type: 'reward.chain_sync',
        payload: { entryId: id },
        dedupeKey: `reward.chain_sync:${id}`,
      });
    });
    queued += 1;
  }

  queued += await reopenSkippedCompletions(deps);

  const rulings = await deps.db
    .select({ id: disputes.id })
    .from(disputes)
    .innerJoin(users, eq(users.id, disputes.raisedBy))
    .where(
      and(
        ne(disputes.status, 'open'),
        eq(disputes.chainStatus, 'pending'),
        or(isNotNull(users.rewardAddress), isNotNull(users.walletAddress)),
      ),
    )
    .limit(BATCH);
  for (const { id } of rulings) {
    await deps.db.transaction(async (tx) => {
      await tx.update(disputes).set({ chainStatus: 'queued' }).where(eq(disputes.id, id));
      await enqueue(tx, {
        type: 'dispute.chain_sync',
        payload: { disputeId: id },
        dedupeKey: `dispute.chain_sync:${id}`,
      });
    });
    queued += 1;
  }

  await markFailed(deps);
  return queued;
}

/**
 * During a deploy, an old worker with the flag off can finish a queued completion without writing it.
 * Its dedupe key then blocks a new event and the entry stays queued, so the same event runs again.
 * An entry is marked synced before its event is done, so queued with a done event means it never ran.
 */
async function reopenSkippedCompletions(deps: Deps): Promise<number> {
  if (!deps.env.ARC_COMPLETION_REWARDS_ENABLED) return 0;
  const skipped = await deps.db
    .select({ id: rewardLedger.id })
    .from(rewardLedger)
    .innerJoin(rallyProofs, eq(rallyProofs.id, rewardLedger.proofId))
    .innerJoin(outboxEvents, eq(outboxEvents.dedupeKey, sql`'reward.chain_sync:' || ${rewardLedger.id}`))
    .where(
      and(
        eq(rewardLedger.action, 'RallyCompleted'),
        eq(rewardLedger.state, 'applied'),
        eq(rewardLedger.chainStatus, 'queued'),
        eq(rallyProofs.state, 'accepted'),
        eq(outboxEvents.status, 'done'),
      ),
    )
    .limit(BATCH);
  if (skipped.length === 0) return 0;
  await deps.db
    .update(outboxEvents)
    .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), processedAt: null })
    .where(
      and(
        eq(outboxEvents.status, 'done'),
        inArray(outboxEvents.dedupeKey, skipped.map(({ id }) => `reward.chain_sync:${id}`)),
      ),
    );
  return skipped.length;
}

/** Events that ran out of retries. Points stay correct, because Postgres holds them. */
async function markFailed(deps: Deps): Promise<void> {
  const dead = await deps.db
    .select({ dedupeKey: outboxEvents.dedupeKey })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, 'dead'),
        inArray(outboxEvents.type, ['reward.chain_sync', 'dispute.chain_sync']),
      ),
    );
  const idsFor = (prefix: string) =>
    dead
      .map((row) => row.dedupeKey ?? '')
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));

  const entryIds = idsFor('reward.chain_sync:');
  if (entryIds.length > 0) {
    await deps.db
      .update(rewardLedger)
      .set({ chainStatus: 'failed' })
      .where(and(inArray(rewardLedger.id, entryIds), eq(rewardLedger.chainStatus, 'queued')));
  }
  const disputeIds = idsFor('dispute.chain_sync:');
  if (disputeIds.length > 0) {
    await deps.db
      .update(disputes)
      .set({ chainStatus: 'failed' })
      .where(and(inArray(disputes.id, disputeIds), eq(disputes.chainStatus, 'queued')));
  }
}
