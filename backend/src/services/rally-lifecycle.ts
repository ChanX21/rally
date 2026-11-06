import { and, eq, ne, notInArray } from 'drizzle-orm';

import {
  arkivEntities,
  claims,
  matchProposals,
  offers,
  rallies,
} from '../db/schema/index.js';
import { ACCEPTING, assertTransition, type RallyStatus } from '../domain/rally-state.js';
import type { Tx } from '../lib/db-types.js';
import { notify } from '../lib/notify.js';
import { enqueue } from '../lib/outbox.js';
import {
  activeMembers,
  countActiveClaims,
  countPendingOffers,
  openSlots,
  type Rally,
} from '../repositories/rallies.js';

/** The only place rally status changes, so every change is validated and versioned. */
export async function transition(
  tx: Tx,
  rally: Rally,
  to: RallyStatus,
  extra: Partial<typeof rallies.$inferInsert> = {},
): Promise<Rally> {
  assertTransition(rally.status, to);
  const [updated] = await tx
    .update(rallies)
    .set({ ...extra, status: to, version: rally.version + 1 })
    .where(eq(rallies.id, rally.id))
    .returning();
  return updated!;
}

/** Queues a public listing refresh. The worker reads current state, so duplicates are harmless. */
export async function scheduleArkivSync(tx: Tx, rally: Rally): Promise<void> {
  if (rally.visibility !== 'public_coarse' || rally.publishedAt === null) return;
  await tx
    .insert(arkivEntities)
    .values({ rallyId: rally.id })
    .onConflictDoUpdate({ target: arkivEntities.rallyId, set: { syncStatus: 'pending' } });
  await enqueue(tx, { type: 'arkiv.sync', payload: { rallyId: rally.id } });
}

/** Marks a proposal as resolved once none of its offers are still pending. */
export async function refreshProposal(tx: Tx, proposalId: string): Promise<void> {
  const rows = await tx
    .select({ status: offers.status })
    .from(offers)
    .where(eq(offers.proposalId, proposalId));
  if (rows.some((row) => row.status === 'pending')) return;

  const state = rows.some((row) => row.status === 'accepted')
    ? ('confirmed' as const)
    : rows.some((row) => row.status === 'expired')
      ? ('expired' as const)
      : ('failed' as const);
  await tx
    .update(matchProposals)
    .set({ state })
    .where(and(eq(matchProposals.id, proposalId), eq(matchProposals.state, 'pending')));
}

async function form(tx: Tx, rally: Rally): Promise<Rally> {
  const formed = await transition(tx, rally, 'formed', { formedAt: new Date() });
  const members = await activeMembers(tx, rally.id);
  await notify(
    tx,
    ...members.map((member) => ({
      userId: member.userId,
      type: 'rally.formed',
      title: 'Your group has formed',
      body: 'Everyone has confirmed. Open the room for the meeting details.',
      data: { rallyId: rally.id },
      dedupeKey: `rally.formed:${rally.id}:${formed.version}:${member.userId}`,
    })),
  );
  return formed;
}

/**
 * Moves a locked rally to whatever its seats and offers now imply. Call after anything that changes
 * claims or offers. Replacements are never auto-accepted: reopening only triggers new offers.
 */
export async function settleRally(tx: Tx, rally: Rally): Promise<Rally> {
  if (!ACCEPTING.includes(rally.status)) return rally;

  const claimCount = await countActiveClaims(tx, rally.id);
  const availableRoles = [...new Set((await openSlots(tx, rally.id)).map((slot) => slot.role))];
  const closed = await tx.update(offers).set({ status: 'cancelled' })
    .where(and(eq(offers.rallyId, rally.id), eq(offers.status, 'pending'),
      availableRoles.length ? notInArray(offers.role, availableRoles) : undefined))
    .returning({ id: offers.id, candidateId: offers.candidateId, proposalId: offers.proposalId });
  for (const offer of closed) {
    await refreshProposal(tx, offer.proposalId);
    await notify(tx, { userId: offer.candidateId, type: 'match.unavailable', title: 'That place was taken',
      body: 'Someone accepted first. Rally will keep looking for another match.', data: { matchId: offer.id }, dedupeKey: `match.unavailable:${offer.id}` });
    await enqueue(tx, { type: 'match.reevaluate', payload: { userId: offer.candidateId } });
  }
  const pending = await countPendingOffers(tx, rally.id);

  let current = rally;
  if (current.status === 'ready' || current.status === 'formed') {
    if (claimCount < current.groupMin) {
      current = await transition(tx, current, pending > 0 ? 'proposed' : 'open', {
        formedAt: null,
      });
      if (pending === 0) {
        await enqueue(tx, { type: 'match.reevaluate', payload: { rallyId: rally.id } });
      }
      return current;
    }
  } else {
    const enough = claimCount >= current.groupMin;
    if (current.openSeats === 0 || (pending === 0 && enough)) {
      current = await transition(tx, current, 'ready');
    } else if (current.status === 'proposed' && pending === 0) {
      current = await transition(tx, current, 'open');
      await enqueue(tx, { type: 'match.reevaluate', payload: { rallyId: rally.id } });
      return current;
    }
  }

  if (current.status === 'ready' && current.meetingPoint) {
    current = await form(tx, current);
  }
  return current;
}

/** Ends a rally for everyone, with `status` as cancelled or expired. */
export async function closeRally(
  tx: Tx,
  rally: Rally,
  status: 'cancelled' | 'expired',
): Promise<Rally> {
  const closed = await transition(tx, rally, status, { openSeats: rally.capacity });

  const members = await activeMembers(tx, rally.id);
  await tx
    .update(claims)
    .set({ status: 'released', releasedAt: new Date() })
    .where(and(eq(claims.rallyId, rally.id), eq(claims.status, 'active')));

  const cancelledOffers = await tx
    .update(offers)
    .set({ status: 'cancelled' })
    .where(and(eq(offers.rallyId, rally.id), eq(offers.status, 'pending')))
    .returning({ candidateId: offers.candidateId });

  await tx
    .update(matchProposals)
    .set({ state: status === 'cancelled' ? 'cancelled' : 'expired' })
    .where(and(eq(matchProposals.rallyId, rally.id), eq(matchProposals.state, 'pending')));

  const verb = status === 'cancelled' ? 'was cancelled' : 'has expired';
  const recipients = [
    ...members.map((member) => member.userId),
    ...cancelledOffers.map((offer) => offer.candidateId),
  ];
  await notify(
    tx,
    ...recipients.map((userId) => ({
      userId,
      type: `rally.${status}`,
      title: `A rally ${verb}`,
      body: `"${rally.goal}" ${verb}.`,
      data: { rallyId: rally.id },
      dedupeKey: `rally.${status}:${rally.id}:${userId}`,
    })),
  );

  for (const userId of new Set(members.map((member) => member.userId))) {
    await enqueue(tx, { type: 'match.reevaluate', payload: { userId } });
  }
  await scheduleArkivSync(tx, closed);
  return closed;
}

/** Tells people still holding an offer that a seat has come back. */
export async function notifyBackups(tx: Tx, rally: Rally, excludeUserId: string): Promise<void> {
  const pending = await tx
    .select({ candidateId: offers.candidateId })
    .from(offers)
    .where(
      and(
        eq(offers.rallyId, rally.id),
        eq(offers.status, 'pending'),
        ne(offers.candidateId, excludeUserId),
      ),
    );
  await notify(
    tx,
    ...pending.map(({ candidateId }) => ({
      userId: candidateId,
      type: 'rally.seat_open',
      title: 'A seat opened up',
      body: `A seat is available again for "${rally.goal}". Accept your match to take it.`,
      data: { rallyId: rally.id },
      dedupeKey: `rally.seat_open:${rally.id}:${rally.version}:${candidateId}`,
    })),
  );
}
