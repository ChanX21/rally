import { and, desc, eq, sql } from 'drizzle-orm';

import { claims, intents, matchProposals, offers, rallies, userBlocks } from '../db/schema/index.js';
import { meetTime } from '../domain/reward-policy.js';
import { ACCEPTING } from '../domain/rally-state.js';
import type { Tx } from '../lib/db-types.js';
import type { Deps } from '../lib/deps.js';
import { AppError, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { enqueue } from '../lib/outbox.js';
import {
  activeClaim,
  hasScheduleConflict,
  lockRally,
  type Offer,
  openSlots,
  type Rally,
} from '../repositories/rallies.js';
import { findCandidates } from '../repositories/matching.js';
import { lockUser } from '../repositories/users.js';
import { refreshProposal, scheduleArkivSync, settleRally } from './rally-lifecycle.js';

function matchView(
  offer: Offer,
  rally: Rally,
  proposal: Pick<typeof matchProposals.$inferSelect, 'reason' | 'source'>,
) {
  return {
    id: offer.id,
    status: offer.status,
    role: offer.role,
    holdUntil: offer.holdUntil.toISOString(),
    reason: proposal.reason,
    source: proposal.source,
    rally: {
      id: rally.id,
      status: rally.status,
      category: rally.category,
      goal: rally.goal,
      vibe: rally.vibe,
      windowStart: rally.windowStart.toISOString(),
      windowEnd: rally.windowEnd.toISOString(),
      durationMin: rally.durationMin,
      zone: rally.zone,
      groupMin: rally.groupMin,
      capacity: rally.capacity,
      openSeats: rally.openSeats,
    },
  };
}

async function loadMatch(db: Deps['db'] | Tx, userId: string, offerId: string) {
  const [row] = await db
    .select({ offer: offers, rally: rallies, proposal: matchProposals })
    .from(offers)
    .innerJoin(rallies, eq(rallies.id, offers.rallyId))
    .innerJoin(matchProposals, eq(matchProposals.id, offers.proposalId))
    .where(and(eq(offers.id, offerId), eq(offers.candidateId, userId)));
  if (!row) throw notFound('Match');
  return row;
}

export async function getMatch(deps: Deps, userId: string, offerId: string) {
  const { offer, rally, proposal } = await loadMatch(deps.db, userId, offerId);
  return matchView(offer, rally, proposal);
}

/** Proposals plus the wait state, so "no match" is shown as waiting and never a dead end. */
export async function listMatches(deps: Deps, userId: string, limit: number) {
  const rows = await deps.db
    .select({ offer: offers, rally: rallies, proposal: matchProposals })
    .from(offers)
    .innerJoin(rallies, eq(rallies.id, offers.rallyId))
    .innerJoin(matchProposals, eq(matchProposals.id, offers.proposalId))
    .where(eq(offers.candidateId, userId))
    .orderBy(desc(offers.createdAt))
    .limit(limit);

  const waiting = await deps.db
    .select({
      id: intents.id,
      category: intents.category,
      goal: intents.goal,
      expiresAt: intents.expiresAt,
    })
    .from(intents)
    .where(and(eq(intents.userId, userId), eq(intents.status, 'waiting')))
    .orderBy(desc(intents.createdAt));

  return {
    matches: rows.map((row) => matchView(row.offer, row.rally, row.proposal)),
    waiting: waiting.map((intent) => ({
      ...intent,
      expiresAt: intent.expiresAt?.toISOString() ?? null,
    })),
  };
}

async function assertNoBlockWithMembers(tx: Tx, userId: string, rallyId: string) {
  const [conflict] = await tx
    .select({ id: claims.id })
    .from(claims)
    .innerJoin(
      userBlocks,
      sql`(${userBlocks.blockerId} = ${claims.userId} and ${userBlocks.blockedId} = ${userId})
       or (${userBlocks.blockerId} = ${userId} and ${userBlocks.blockedId} = ${claims.userId})`,
    )
    .where(and(eq(claims.rallyId, rallyId), eq(claims.status, 'active')))
    .limit(1);
  if (conflict) {
    throw new AppError(409, 'MEMBER_CONFLICT', 'This match is no longer available');
  }
}

async function accept(tx: Tx, userId: string, offer: Offer, rally: Rally) {
  if ((rally.proofFlow && meetTime(rally) <= new Date()) || !ACCEPTING.includes(rally.status) || rally.expiresAt <= new Date()) {
    throw new AppError(409, 'RALLY_CLOSED', 'This rally is no longer accepting people');
  }
  // PostgreSQL is authoritative here. Arkiv's public seat count is never consulted.
  if (rally.openSeats <= 0) {
    throw new AppError(409, 'RALLY_FULL', 'That was the last seat, and someone else just took it');
  }
  if (await hasScheduleConflict(tx, userId, rally.id, rally.windowStart, rally.windowEnd)) {
    throw new AppError(409, 'SCHEDULE_CONFLICT', 'You already have a rally at this time');
  }
  await assertNoBlockWithMembers(tx, userId, rally.id);
  if ((await findCandidates(tx, rally, 1, userId)).length === 0) {
    throw new AppError(409, 'MATCH_NO_LONGER_ELIGIBLE', 'Your availability or matching preferences changed. Please find a new match.');
  }

  const slot = (await openSlots(tx, rally.id)).find((open) => open.role === offer.role);
  if (!slot) {
    throw new AppError(409, 'ROLE_TAKEN', 'The role you were offered has been taken');
  }

  await tx.insert(claims).values({ rallyId: rally.id, slotId: slot.id, userId, offerId: offer.id });
  const [updated] = await tx
    .update(rallies)
    .set({ openSeats: rally.openSeats - 1, version: rally.version + 1 })
    .where(eq(rallies.id, rally.id))
    .returning();
  await tx
    .update(offers)
    .set({ status: 'accepted', respondedAt: new Date() })
    .where(eq(offers.id, offer.id));
  await tx
    .update(intents)
    .set({ status: 'matched' })
    .where(
      and(
        eq(intents.userId, userId),
        eq(intents.status, 'waiting'),
        eq(intents.category, rally.category),
      ),
    );

  await notify(tx, {
    userId: rally.creatorId,
    type: 'match.accepted',
    title: 'Someone accepted',
    body: `A person accepted your rally "${rally.goal}".`,
    data: { rallyId: rally.id },
    dedupeKey: `match.accepted:${offer.id}`,
  });
  return updated!;
}

async function decline(tx: Tx, offer: Offer, rally: Rally) {
  await tx
    .update(offers)
    .set({ status: 'declined', respondedAt: new Date() })
    .where(eq(offers.id, offer.id));
  await notify(tx, {
    userId: rally.creatorId,
    type: 'match.declined',
    title: 'Someone passed',
    body: `A person passed on "${rally.goal}". We will keep looking if needed.`,
    data: { rallyId: rally.id },
    dedupeKey: `match.declined:${offer.id}`,
  });
  return rally;
}

/**
 * Explicit consent, committed atomically. Locks are taken user, then rally, then offer. The rally
 * lock means seat-changing requests run one at a time, and unique indexes are the final defence.
 * Everything rolls back together on any failure, and responding twice returns the same result.
 */
export async function respondToMatch(
  deps: Deps,
  userId: string,
  offerId: string,
  response: 'accept' | 'decline',
) {
  return deps.db.transaction(async (tx) => {
    const [peek] = await tx
      .select({ rallyId: offers.rallyId })
      .from(offers)
      .where(and(eq(offers.id, offerId), eq(offers.candidateId, userId)));
    if (!peek) throw notFound('Match');

    await lockUser(tx, userId);
    const rally = await lockRally(tx, peek.rallyId);
    if (!rally) throw notFound('Match');
    const [offer] = await tx.select().from(offers).where(eq(offers.id, offerId)).for('update');
    if (!offer) throw notFound('Match');

    if (offer.status === 'accepted') {
      if (response === 'decline') {
        throw new AppError(409, 'ALREADY_ACCEPTED', 'Withdraw from the rally to give up your seat');
      }
      if (!(await activeClaim(tx, rally.id, userId))) {
        throw new AppError(409, 'SEAT_RELEASED', 'You have already given up this seat');
      }
      return (await loadMatchView(tx, userId, offerId));
    }
    if (offer.status === 'declined' && response === 'decline') {
      return loadMatchView(tx, userId, offerId);
    }
    if (offer.status !== 'pending') {
      throw new AppError(409, 'OFFER_CLOSED', `This match is ${offer.status}`);
    }
    if (offer.holdUntil <= new Date()) {
      throw new AppError(409, 'OFFER_EXPIRED', 'This match has expired');
    }

    const changed =
      response === 'accept'
        ? await accept(tx, userId, offer, rally)
        : await decline(tx, offer, rally);

    await refreshProposal(tx, offer.proposalId);
    const settled = await settleRally(tx, changed);
    await scheduleArkivSync(tx, settled);
    return loadMatchView(tx, userId, offerId);
  });
}

async function loadMatchView(tx: Tx, userId: string, offerId: string) {
  const { offer, rally, proposal } = await loadMatch(tx, userId, offerId);
  return matchView(offer, rally, proposal);
}

/** Expires offers past their hold time for one locked rally, and settles it. */
export async function expireOffersForRally(tx: Tx, rallyId: string): Promise<number> {
  const rally = await lockRally(tx, rallyId);
  if (!rally) return 0;

  const expired = await tx
    .update(offers)
    .set({ status: 'expired' })
    .where(
      and(
        eq(offers.rallyId, rallyId),
        eq(offers.status, 'pending'),
        sql`${offers.holdUntil} <= now()`,
      ),
    )
    .returning({
      id: offers.id,
      candidateId: offers.candidateId,
      proposalId: offers.proposalId,
    });
  if (expired.length === 0) return 0;

  await notify(
    tx,
    ...expired.map((offer) => ({
      userId: offer.candidateId,
      type: 'match.expired',
      title: 'A match expired',
      body: `Your match for "${rally.goal}" expired.`,
      data: { matchId: offer.id },
      dedupeKey: `match.expired:${offer.id}`,
    })),
  );

  for (const proposalId of new Set(expired.map((offer) => offer.proposalId))) {
    await refreshProposal(tx, proposalId);
  }
  const settled = await settleRally(tx, rally);
  await scheduleArkivSync(tx, settled);
  await enqueue(tx, { type: 'match.reevaluate', payload: { rallyId } });
  return expired.length;
}

