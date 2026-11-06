import { and, desc, eq, lt, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { claims, disputes, rallies, rewardLedger, users } from '../db/schema/index.js';
import { DISPUTE_TIMEOUT_HOURS, type RewardAction } from '../domain/reward-policy.js';
import { ROOM_VISIBLE } from '../domain/rally-state.js';
import type { Tx } from '../lib/db-types.js';
import type { Deps } from '../lib/deps.js';
import { AppError, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { addEntry, latestPolicy } from './rewards.js';

export type DisputeCategory = 'no_show_appeal' | 'misconduct' | 'false_checkin' | 'other';
export type DisputeOutcome = 'upheld' | 'dismissed' | 'false';

interface RaiseInput {
  category: DisputeCategory;
  subjectId?: string | undefined;
  description?: string | undefined;
}

async function wasInRally(tx: Tx, rallyId: string, userId: string): Promise<boolean> {
  const rows = await tx
    .select({ status: claims.status })
    .from(claims)
    .where(and(eq(claims.rallyId, rallyId), eq(claims.userId, userId)));
  return rows.some((row) => row.status === 'active' || row.status === 'no_show');
}

async function insertDispute(tx: Tx, values: typeof disputes.$inferInsert) {
  const [row] = await tx.insert(disputes).values(values).onConflictDoNothing().returning();
  if (!row) throw new AppError(409, 'DISPUTE_EXISTS', 'You have already reported this');
  return { id: row.id, status: row.status };
}

/** "I was there". Holds the penalty until someone rules, so nobody is penalised while appealing. */
async function raiseAppeal(tx: Tx, userId: string, rallyId: string, description?: string) {
  const [entry] = await tx
    .select()
    .from(rewardLedger)
    .where(
      and(
        eq(rewardLedger.subjectUserId, userId),
        eq(rewardLedger.rallyId, rallyId),
        eq(rewardLedger.action, 'NoShow'),
        eq(rewardLedger.state, 'pending'),
      ),
    )
    .for('update');
  if (!entry) throw new AppError(409, 'NOT_APPEALABLE', 'There is no pending no-show to appeal');

  await tx.update(rewardLedger).set({ state: 'held' }).where(eq(rewardLedger.id, entry.id));
  return insertDispute(tx, {
    rallyId,
    raisedBy: userId,
    subjectId: userId,
    category: 'no_show_appeal',
    description: description ?? 'I was there',
    heldEntryId: entry.id,
  });
}

export async function raiseDispute(deps: Deps, userId: string, rallyId: string, input: RaiseInput) {
  return deps.db.transaction(async (tx) => {
    const [rally] = await tx.select().from(rallies).where(eq(rallies.id, rallyId));
    if (!rally) throw notFound('Rally');
    if (input.category === 'no_show_appeal') {
      return raiseAppeal(tx, userId, rallyId, input.description);
    }

    if (!(await wasInRally(tx, rallyId, userId))) throw notFound('Rally');
    if (!ROOM_VISIBLE.includes(rally.status)) {
      throw new AppError(409, 'INVALID_STATE', 'Reports open once the group has formed');
    }
    if (!input.subjectId || !input.description) {
      throw new AppError(422, 'INVALID_DISPUTE', 'Say who this is about and what happened');
    }
    if (input.subjectId === userId) {
      throw new AppError(422, 'INVALID_DISPUTE', 'You cannot report yourself');
    }
    if (!(await wasInRally(tx, rallyId, input.subjectId))) {
      throw new AppError(422, 'INVALID_DISPUTE', 'That person was not in this rally');
    }
    return insertDispute(tx, {
      rallyId,
      raisedBy: userId,
      subjectId: input.subjectId,
      category: input.category,
      description: input.description,
    });
  });
}

/** The subject sees only rulings, so a complaint cannot be traced back to whoever raised it. */
export async function listMyDisputes(deps: Deps, userId: string) {
  const rows = await deps.db
    .select()
    .from(disputes)
    .where(or(eq(disputes.raisedBy, userId), eq(disputes.subjectId, userId)))
    .orderBy(desc(disputes.createdAt))
    .limit(100);
  return {
    raised: rows
      .filter((row) => row.raisedBy === userId)
      .map((row) => ({
        id: row.id,
        rallyId: row.rallyId,
        category: row.category,
        description: row.description,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
      })),
    against: rows
      .filter((row) => row.subjectId === userId && row.raisedBy !== userId && row.status !== 'open')
      .map((row) => ({
        id: row.id,
        rallyId: row.rallyId,
        category: row.category,
        status: row.status,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
      })),
  };
}

export async function listAllDisputes(
  deps: Deps,
  filter: { userId?: string | undefined; status?: DisputeOutcome | 'open' | undefined },
) {
  const raiser = alias(users, 'raiser');
  const subject = alias(users, 'subject');
  const rows = await deps.db
    .select({ dispute: disputes, goal: rallies.goal, raiser, subject })
    .from(disputes)
    .innerJoin(rallies, eq(rallies.id, disputes.rallyId))
    .innerJoin(raiser, eq(raiser.id, disputes.raisedBy))
    .innerJoin(subject, eq(subject.id, disputes.subjectId))
    .where(
      and(
        filter.userId
          ? or(eq(disputes.raisedBy, filter.userId), eq(disputes.subjectId, filter.userId))
          : undefined,
        filter.status ? eq(disputes.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(disputes.createdAt))
    .limit(200);

  const party = (user: typeof users.$inferSelect) => ({
    id: user.id,
    displayName: user.displayName,
    wallet: user.rewardAddress ?? user.walletAddress,
  });
  return rows.map(({ dispute, goal, raiser: from, subject: about }) => ({
    id: dispute.id,
    rallyId: dispute.rallyId,
    rallyGoal: goal,
    category: dispute.category,
    description: dispute.description,
    status: dispute.status,
    raiser: party(from),
    subject: party(about),
    resolvedBy: dispute.resolvedBy,
    resolutionNote: dispute.resolutionNote,
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
    chainStatus: dispute.chainStatus,
    chainTxHash: dispute.chainTxHash,
    createdAt: dispute.createdAt.toISOString(),
  }));
}

interface Ruling {
  outcome: DisputeOutcome;
  note?: string | undefined;
  by: 'admin' | 'timeout';
}

export async function resolveDispute(deps: Deps, disputeId: string, ruling: Ruling) {
  return deps.db.transaction(async (tx) => {
    const [dispute] = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).for('update');
    if (!dispute) throw notFound('Dispute');
    if (dispute.status !== 'open') {
      throw new AppError(409, 'ALREADY_RESOLVED', 'This dispute has already been ruled on');
    }

    const policy = await latestPolicy(tx);
    const penalise = (userId: string, action: RewardAction) =>
      addEntry(tx, policy, {
        userId,
        rallyId: dispute.rallyId,
        action,
        key: `dispute:${dispute.id}:${action}`,
      });

    if (dispute.category === 'no_show_appeal') {
      if (dispute.heldEntryId) {
        await tx
          .update(rewardLedger)
          .set({ state: ruling.outcome === 'upheld' ? 'cancelled' : 'applied' })
          .where(eq(rewardLedger.id, dispute.heldEntryId));
      }
    } else if (ruling.outcome === 'upheld') {
      await penalise(dispute.subjectId, 'ComplaintUpheld');
    }
    if (ruling.outcome === 'false') await penalise(dispute.raisedBy, 'FalseComplaint');

    await tx
      .update(disputes)
      .set({
        status: ruling.outcome,
        resolvedBy: ruling.by,
        resolutionNote: ruling.note ?? null,
        resolvedAt: new Date(),
      })
      .where(eq(disputes.id, dispute.id));

    const recipients = new Set([dispute.raisedBy, dispute.subjectId]);
    await notify(
      tx,
      ...[...recipients].map((userId) => ({
        userId,
        type: 'dispute.resolved',
        title: 'A report has been reviewed',
        body: 'See your profile for the outcome.',
        data: { rallyId: dispute.rallyId },
        dedupeKey: `dispute.resolved:${dispute.id}:${userId}`,
      })),
    );
    return { id: dispute.id, status: ruling.outcome };
  });
}

/** If nobody rules in time, doubt goes to the person who could be penalised. */
export async function expireDisputes(deps: Deps): Promise<number> {
  const cutoff = new Date(Date.now() - DISPUTE_TIMEOUT_HOURS * 3_600_000);
  const due = await deps.db
    .select({ id: disputes.id, category: disputes.category })
    .from(disputes)
    .where(and(eq(disputes.status, 'open'), lt(disputes.createdAt, cutoff)))
    .limit(100);
  for (const { id, category } of due) {
    await resolveDispute(deps, id, {
      outcome: category === 'no_show_appeal' ? 'upheld' : 'dismissed',
      by: 'timeout',
    });
  }
  return due.length;
}
