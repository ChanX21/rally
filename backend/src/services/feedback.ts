import { and, count, eq, gte, sql } from 'drizzle-orm';

import { feedback, rallies, rewardLedger } from '../db/schema/index.js';
import type { Tx } from '../lib/db-types.js';
import type { Deps } from '../lib/deps.js';
import { AppError, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { enqueue } from '../lib/outbox.js';
import { MAX_EARNED_PER_DAY, MAX_PER_COUNTERPARTY } from '../domain/reward-policy.js';
import { activeMembers, lockRally } from '../repositories/rallies.js';
import { appendProfile, latestProfile, lockUser } from '../repositories/users.js';
import { transition } from './rally-lifecycle.js';
import { earnedToday, latestPolicy, rewardHostCompleted } from './rewards.js';

export const MAX_VOUCHES_GIVEN_PER_DAY = 5;

export interface FeedbackInput {
  happened: boolean;
  useful?: boolean | undefined;
  vouches: { recipientId: string; contribution: string }[];
  encoreWith: string[];
}

/** Why a vouch should not earn points. Null means it passed the anti-abuse checks. */
async function flagVouch(
  tx: Tx,
  giverId: string,
  recipientId: string,
  rallyId: string,
): Promise<string | null> {
  const oneDayAgo = new Date(Date.now() - 86_400_000);
  const [recent] = await tx
    .select({ value: count() })
    .from(feedback)
    .where(
      and(
        eq(feedback.giverId, giverId),
        eq(feedback.type, 'vouch'),
        gte(feedback.createdAt, oneDayAgo),
      ),
    );
  if ((recent?.value ?? 0) >= MAX_VOUCHES_GIVEN_PER_DAY) return 'suspicious_burst';

  const [repeated] = await tx
    .select({ value: count() })
    .from(feedback)
    .where(
      and(
        eq(feedback.giverId, giverId),
        eq(feedback.recipientId, recipientId),
        eq(feedback.type, 'vouch'),
        sql`${feedback.rallyId} <> ${rallyId}`,
      ),
    );
  if ((repeated?.value ?? 0) > 0) return 'repeated_pair';

  const [reciprocal] = await tx
    .select({ value: count() })
    .from(feedback)
    .where(
      and(
        eq(feedback.giverId, recipientId),
        eq(feedback.recipientId, giverId),
        eq(feedback.type, 'vouch'),
      ),
    );
  if ((reciprocal?.value ?? 0) > 0) return 'reciprocal';

  return null;
}

export async function submitFeedback(
  deps: Deps,
  userId: string,
  rallyId: string,
  input: FeedbackInput,
) {
  return deps.db.transaction(async (tx) => {
    await lockUser(tx, userId);
    let rally = await lockRally(tx, rallyId);
    if (!rally) throw notFound('Rally');

    const members = await activeMembers(tx, rallyId);
    const me = members.find((member) => member.userId === userId);
    if (!me) throw notFound('Rally');
    if (rally.status !== 'met' && rally.status !== 'completed') {
      throw new AppError(409, 'INVALID_STATE', 'Feedback opens after the host has checked in');
    }
    if (!rally.proofFlow && !me.checkedInAt) {
      throw new AppError(403, 'NOT_PRESENT', 'Only people marked present can leave feedback');
    }

    const proofRoster = rally.proofFlow ? rally.completionMemberIds : null;
    const present = new Set(
      members.filter((member) => proofRoster ? proofRoster.includes(member.userId) : member.checkedInAt !== null).map((member) => member.userId),
    );
    const recipients = [
      ...input.vouches.map((vouch) => vouch.recipientId),
      ...input.encoreWith,
    ];
    for (const recipientId of recipients) {
      if (recipientId === userId) {
        throw new AppError(422, 'SELF_FEEDBACK', 'You cannot vouch for yourself');
      }
      if (!present.has(recipientId)) {
        throw new AppError(422, 'NOT_PRESENT', 'You can only vouch for people present with you');
      }
    }

    await tx
      .insert(feedback)
      .values({
        rallyId,
        giverId: userId,
        type: 'attest',
        happened: input.happened,
        useful: input.useful,
      })
      .onConflictDoNothing();

    if (!rally.proofFlow && rally.status === 'met' && input.happened) {
      rally = await transition(tx, rally, 'completed', { completedAt: new Date() });
      await rewardHostCompleted(tx, rally, present);
    }

    const vouchResults: { recipientId: string; verification: string }[] = [];
    for (const vouch of input.vouches) {
      if (rally.status !== 'completed') {
        throw new AppError(409, 'INVALID_STATE', 'Vouches need a completed rally');
      }
      const flag = await flagVouch(tx, userId, vouch.recipientId, rallyId);
      const [row] = await tx
        .insert(feedback)
        .values({
          rallyId,
          giverId: userId,
          recipientId: vouch.recipientId,
          type: 'vouch',
          contribution: vouch.contribution,
          verificationState: flag ? 'flagged' : 'verified',
          flagReason: flag,
        })
        .onConflictDoNothing()
        .returning({ id: feedback.id });
      // A retried request hits the unique key, so it cannot enqueue a second reward.
      if (!row) continue;
      vouchResults.push({
        recipientId: vouch.recipientId,
        verification: flag ? 'flagged' : 'verified',
      });
      if (!flag) {
        await enqueue(tx, {
          type: 'vouch.verified',
          payload: { feedbackId: row.id },
          dedupeKey: `vouch.verified:${row.id}`,
        });
      }
    }

    for (const recipientId of input.encoreWith) {
      await tx
        .insert(feedback)
        .values({ rallyId, giverId: userId, recipientId, type: 'encore' })
        .onConflictDoNothing();
    }

    return { rallyStatus: rally.status, vouches: vouchResults };
  });
}

/**
 * Applies a verified vouch: appends profile evidence and accrues capped off-chain points. Evidence
 * changes the profile; it never changes identity, and declared skills stay separate.
 */
export async function applyVerifiedVouch(deps: Deps, feedbackId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [vouch] = await tx
      .select()
      .from(feedback)
      .where(and(eq(feedback.id, feedbackId), eq(feedback.type, 'vouch')));
    if (!vouch?.recipientId || vouch.verificationState !== 'verified') return;
    const recipientId = vouch.recipientId;

    const [rally] = await tx.select().from(rallies).where(eq(rallies.id, vouch.rallyId));
    if (rally?.status !== 'completed') return;

    await lockUser(tx, recipientId);

    const profile = await latestProfile(tx, recipientId);
    const at = new Date().toISOString();
    const alreadyRecorded = profile?.evidence.some(
      (entry) => entry.rallyId === rally.id && entry.contribution === vouch.contribution,
    );
    if (profile && !alreadyRecorded) {
      await appendProfile(tx, recipientId, {
        evidence: [
          ...profile.evidence,
          {
            type: 'vouch',
            rallyId: rally.id,
            contribution: vouch.contribution ?? '',
            at,
          },
        ],
        inferredTags: [
          ...profile.inferredTags,
          { tag: rally.category, confidence: 0.6, source: `vouch:${vouch.id}`, at },
        ],
      });
    }

    if (rally.proofFlow) return;
    const key = `vouch:${vouch.id}`;
    const [fromGiver] = await tx
      .select({ total: sql<number>`coalesce(sum(${rewardLedger.delta}), 0)::int` })
      .from(rewardLedger)
      .innerJoin(feedback, sql`${rewardLedger.idempotencyKey} = 'vouch:' || ${feedback.id}::text`)
      .where(
        and(eq(rewardLedger.subjectUserId, recipientId), eq(feedback.giverId, vouch.giverId)),
      );

    const policy = await latestPolicy(tx);
    const points = policy.amounts.Vouched;
    const capped =
      (await earnedToday(tx, recipientId)) + points > MAX_EARNED_PER_DAY ||
      (fromGiver?.total ?? 0) + points > MAX_PER_COUNTERPARTY;
    if (capped) {
      deps.log.info({ feedbackId }, 'vouch reward skipped: cap reached');
      return;
    }

    const inserted = await tx
      .insert(rewardLedger)
      .values({
        subjectUserId: recipientId,
        rallyId: rally.id,
        reason: 'completed_and_vouched',
        action: 'Vouched',
        delta: points,
        policyVersion: policy.version,
        antiAbuse: 'passed',
        idempotencyKey: key,
      })
      .onConflictDoNothing()
      .returning({ id: rewardLedger.id });

    if (inserted.length > 0) {
      await notify(tx, {
        userId: recipientId,
        type: 'reward.earned',
        title: 'Someone vouched for you',
        body: `You earned ${points} RALLY: "${vouch.contribution ?? ''}"`,
        data: { rallyId: rally.id },
        dedupeKey: `reward.earned:${vouch.id}`,
      });
    }
  });
}
