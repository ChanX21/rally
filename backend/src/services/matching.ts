import { createHash } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { matchProposals, offers, rallies } from '../db/schema/index.js';
import { SHORTLIST_SIZE } from '../domain/catalog.js';
import { MATCHABLE } from '../domain/rally-state.js';
import { rankCandidates, scoreCandidate } from '../domain/scoring.js';
import { overlapMinutes } from '../domain/time.js';
import { redactPii } from '../domain/intent-fallback.js';
import type { Tx } from '../lib/db-types.js';
import type { Deps } from '../lib/deps.js';
import { notify } from '../lib/notify.js';
import {
  type CandidateRow,
  findCandidates,
  findRalliesForUser,
} from '../repositories/matching.js';
import {
  activeMembers,
  countActiveClaims,
  countPendingOffers,
  findRally,
  lockRally,
  openSlots,
  type Rally,
} from '../repositories/rallies.js';
import { scheduleArkivSync, transition } from './rally-lifecycle.js';

const FORBIDDEN_IN_REASON = /(@|https?:\/\/|\b0x[a-f0-9]{6,}|\b[cm]\d+\b|did:privy)/i;

export interface ScoredCandidate extends CandidateRow {
  alias: string;
  score: number;
  overlapMin: number;
}

interface Composition {
  members: { userId: string; role: string }[];
  reason: string;
  score: number;
  source: 'ai' | 'deterministic';
  modelRunId: string | null;
}

export type EvaluationOutcome =
  | 'not_matchable'
  | 'no_need'
  | 'waiting'
  | 'no_fit'
  | 'unchanged'
  | 'proposed'
  | 'stale';

function scoreAll(rally: Rally, rows: readonly CandidateRow[]): ScoredCandidate[] {
  const scored = rows.map((row) => {
    const overlapMin =
      row.intent_start && row.intent_end
        ? overlapMinutes(row.intent_start, row.intent_end, rally.windowStart, rally.windowEnd)
        : overlapMinutes(
            row.available_from ?? rally.windowStart,
            row.available_to ?? rally.windowStart,
            rally.windowStart,
            rally.windowEnd,
          );
    const rank = row.interests.indexOf(rally.category);
    const score = scoreCandidate({
      overlapMin,
      durationMin: rally.durationMin,
      hasWaitingIntent: row.intent_id !== null,
      interestRank: rank === -1 ? null : rank,
      declaredSkills: row.declared_skills,
      neededRole: rally.neededRole,
      vibeMatch:
        rally.vibe !== null &&
        (row.intent_vibe === rally.vibe || row.preferences?.group_energy === rally.vibe),
      mutualEncore: row.mutual_encore,
    });
    return { ...row, score, overlapMin, userId: row.user_id };
  });
  return rankCandidates(scored).map((row, index) => ({ ...row, alias: `c${index + 1}` }));
}

function defaultReason(rally: Rally): string {
  return `You are both free in this window and interested in ${rally.category}.`;
}

/** Rule-based group. Same input, same group. It can only select from eligible candidates. */
export function composeDeterministically(
  rally: Rally,
  candidates: readonly ScoredCandidate[],
  roles: readonly string[],
  maxMembers: number,
): Composition {
  const chosen = candidates.slice(0, maxMembers);
  return {
    members: chosen.map((candidate, index) => ({
      userId: candidate.user_id,
      role: roles[index]!,
    })),
    reason: defaultReason(rally),
    score: Math.round(
      chosen.reduce((total, candidate) => total + candidate.score, 0) / Math.max(chosen.length, 1),
    ),
    source: 'deterministic',
    modelRunId: null,
  };
}

/** Seats and roles, which the engine's checks do not cover. Null means the group fits. */
export function validateComposition(
  output: { memberIds: readonly string[]; roles: readonly string[] },
  aliases: ReadonlySet<string>,
  roles: readonly string[],
  minMembers: number,
  maxMembers: number,
): string | null {
  const { memberIds, roles: chosenRoles } = output;
  if (new Set(memberIds).size !== memberIds.length) return 'duplicate member';
  if (memberIds.some((id) => !aliases.has(id))) return 'member not in shortlist';
  if (memberIds.length < minMembers) return 'group below minimum';
  if (memberIds.length > maxMembers) return 'group above open seats';
  if (chosenRoles.length !== memberIds.length) return 'roles do not line up with members';

  const remaining = [...roles];
  for (const role of chosenRoles) {
    const index = remaining.indexOf(role);
    if (index === -1) return 'role not available';
    remaining.splice(index, 1);
  }
  return null;
}

/** Shown to the people invited, so it must not reveal aliases or contact details. */
export function safeReason(reason: string, rally: Rally): string {
  return FORBIDDEN_IN_REASON.test(reason) ? defaultReason(rally) : reason;
}

type AiComposition =
  | { kind: 'proposed'; composition: Composition }
  | { kind: 'no_fit' }
  | { kind: 'failed'; failure: string; modelRunId: string | null };

/**
 * One Formation Engine call. Everyone appears under an alias, with only match-relevant features, so
 * no user ID, name, wallet or exact location crosses the model boundary. All are mapped back here.
 */
async function composeWithEngine(
  deps: Deps,
  rally: Rally,
  members: Awaited<ReturnType<typeof activeMembers>>,
  candidates: readonly ScoredCandidate[],
  roles: readonly string[],
  minMembers: number,
  maxMembers: number,
): Promise<AiComposition> {
  const start = rally.windowStart.toISOString();
  const end = new Date(rally.windowStart.getTime() + rally.durationMin * 60_000).toISOString();
  const openRoleIds = [...new Set(roles)];
  const committed = (alias: string, role: string) => ({
    id: alias,
    optedIn: true as const,
    interests: [rally.category],
    roleIds: [role],
    zoneIds: [rally.zone],
    availableFrom: start,
    availableUntil: end,
  });

  const { result, modelRunId } = await deps.formation((engine, runId) =>
    engine.composeGroup({
      requestId: runId,
      rally: {
        id: rally.opaqueId,
        intent: {
          categoryId: rally.category,
          goal: redactPii(rally.goal),
          startAt: start,
          durationMin: rally.durationMin,
          groupMin: members.length + minMembers,
          groupMax: members.length + maxMembers,
          zoneId: rally.zone,
          vibe: (rally.vibe as 'quiet' | 'chatty' | 'any' | null) ?? 'any',
        },
        // People already in hold a seat, and their consent is on record.
        requiredMembers: members.map((member, index) => committed(`m${index + 1}`, member.role)),
        requiredRoleIds: [],
      },
      candidates: candidates.map((candidate) => ({
        id: candidate.alias,
        optedIn: true as const,
        interests: candidate.interests,
        roleIds: openRoleIds,
        zoneIds: [rally.zone],
        availableFrom: (candidate.intent_start ?? candidate.available_from)!.toISOString(),
        availableUntil: (candidate.intent_end ?? candidate.available_to)!.toISOString(),
      })),
    }),
  );

  if (result.status === 'no_fit') return { kind: 'no_fit' };
  if (result.status !== 'proposed') {
    return { kind: 'failed', failure: result.status, modelRunId };
  }

  // Assign any seat the model left without a role from what is still open.
  const aliases = new Set(candidates.map((candidate) => candidate.alias));
  const chosen = result.memberIds.filter((id) => aliases.has(id));
  const roleOf = new Map(result.roles.map((entry) => [entry.memberId, entry.roleId]));
  const unassigned = [...roles];
  for (const id of chosen) {
    const index = unassigned.indexOf(roleOf.get(id) ?? '');
    if (index !== -1) unassigned.splice(index, 1);
  }
  const chosenRoles = chosen.map((id) => roleOf.get(id) ?? unassigned.shift() ?? '');

  const violation = validateComposition(
    { memberIds: chosen, roles: chosenRoles },
    aliases,
    roles,
    minMembers,
    maxMembers,
  );
  if (violation !== null) {
    deps.log.warn({ violation }, 'composition rejected after engine validation');
    return { kind: 'failed', failure: 'invalid_output', modelRunId };
  }

  const byAlias = new Map(candidates.map((candidate) => [candidate.alias, candidate]));
  const scores = chosen.map((alias) => byAlias.get(alias)!.score);
  return {
    kind: 'proposed',
    composition: {
      members: chosen.map((alias, index) => ({
        userId: byAlias.get(alias)!.user_id,
        role: chosenRoles[index]!,
      })),
      reason: safeReason(result.reason, rally),
      score: Math.round(scores.reduce((total, score) => total + score, 0) / scores.length),
      source: 'ai',
      modelRunId,
    },
  };
}

async function markWaiting(tx: Tx, rally: Rally): Promise<void> {
  if (rally.status !== 'open') return;
  await scheduleArkivSync(tx, await transition(tx, rally, 'waiting'));
  await notify(tx, {
    userId: rally.creatorId,
    type: 'rally.waiting',
    title: 'No close fit yet',
    body: `We will keep looking for "${rally.goal}" and notify you when something changes.`,
    data: { rallyId: rally.id },
    dedupeKey: `rally.waiting:${rally.id}`,
  });
}

/**
 * The single matching engine. Hard filters first, then at most one compose call, then revalidation
 * in a transaction. The AI call sits outside the transaction so no lock is held across the network.
 */
export async function evaluateRally(deps: Deps, rallyId: string): Promise<EvaluationOutcome> {
  const rally = await findRally(deps.db, rallyId);
  const matchable = (candidate: Rally) =>
    MATCHABLE.includes(candidate.status) &&
    candidate.openSeats > 0 &&
    candidate.expiresAt > new Date();
  if (!rally || !matchable(rally)) return 'not_matchable';

  const claimCount = await countActiveClaims(deps.db, rallyId);
  const pending = await countPendingOffers(deps.db, rallyId);
  const shortfall = rally.groupMin - claimCount - pending;
  // Once people are being asked, only top up if those answers cannot reach the minimum anyway.
  if (rally.status === 'proposed' && shortfall <= 0) return 'no_need';

  const pendingRoles = await deps.db
    .select({ role: offers.role })
    .from(offers)
    .where(sql`${offers.rallyId} = ${rallyId} and ${offers.status} = 'pending'`);
  const roles = (await openSlots(deps.db, rallyId)).map((slot) => slot.role);
  for (const { role } of pendingRoles) {
    const index = roles.indexOf(role);
    if (index !== -1) roles.splice(index, 1);
  }

  const seatsToOffer = Math.min(
    roles.length,
    rally.status === 'proposed' ? shortfall : rally.openSeats - pending,
  );
  const candidates = scoreAll(rally, await findCandidates(deps.db, rally, SHORTLIST_SIZE));

  const minMembers = Math.max(shortfall, 1);
  const maxMembers = Math.min(seatsToOffer, candidates.length);

  if (maxMembers < minMembers) {
    // No viable group: keep waiting. The only honest result here is "no fit yet".
    await deps.db.transaction(async (tx) => {
      const locked = await lockRally(tx, rallyId);
      if (locked) await markWaiting(tx, locked);
    });
    return 'waiting';
  }

  // The only model call. Infeasible cases returned above, and anyone offered a seat leaves the
  // candidate set. A no-fit is remembered below, so a call is spent only when candidates change.
  const shortlistHash = createHash('sha256')
    .update(JSON.stringify([candidates.map((c) => c.user_id).sort(), maxMembers, minMembers]))
    .digest('hex');
  if (rally.noFitShortlistHash === shortlistHash) return 'unchanged';

  const members = await activeMembers(deps.db, rallyId);
  const outcome = await composeWithEngine(
    deps,
    rally,
    members,
    candidates,
    roles,
    minMembers,
    maxMembers,
  );

  if (outcome.kind === 'no_fit') {
    // A genuine no-fit waits for supply to change. It is remembered so the same people, seats and
    // needs do not spend another model call.
    await deps.db.transaction(async (tx) => {
      const locked = await lockRally(tx, rallyId);
      if (!locked) return;
      await tx
        .update(rallies)
        .set({ noFitShortlistHash: shortlistHash })
        .where(eq(rallies.id, rallyId));
      await markWaiting(tx, locked);
    });
    return 'no_fit';
  }

  if (outcome.kind === 'failed' && deps.env.AI_REQUIRED) {
    // An outage is not a no-fit. Throwing lets the outbox retry with backoff.
    throw new Error(`Formation Engine failed: ${outcome.failure}`);
  }

  const composition =
    outcome.kind === 'proposed'
      ? outcome.composition
      : {
          ...composeDeterministically(rally, candidates, roles, maxMembers),
          modelRunId: outcome.modelRunId,
        };

  return deps.db.transaction(async (tx) => {
    const locked = await lockRally(tx, rallyId);
    if (!locked || !matchable(locked)) return 'stale';

    // State may have moved during the model call. Keep only people who still qualify.
    const stillEligible = new Set(
      (await findCandidates(tx, locked, SHORTLIST_SIZE)).map((row) => row.user_id),
    );
    const offered = composition.members.filter((member) => stillEligible.has(member.userId));
    const nowPending = await countPendingOffers(tx, rallyId);
    const nowClaims = await countActiveClaims(tx, rallyId);
    if (
      offered.length === 0 ||
      nowClaims + nowPending + offered.length < locked.groupMin ||
      nowPending + offered.length > locked.openSeats
    ) {
      return 'stale';
    }

    const holdUntil = new Date(
      Math.min(Date.now() + deps.env.OFFER_HOLD_MINUTES * 60_000, locked.expiresAt.getTime()),
    );
    const [proposal] = await tx
      .insert(matchProposals)
      .values({
        rallyId,
        source: composition.source,
        reason: composition.reason,
        score: composition.score,
        modelRunId: composition.modelRunId,
        expiresAt: holdUntil,
      })
      .returning();
    const created = await tx
      .insert(offers)
      .values(
        offered.map((member) => ({
          proposalId: proposal!.id,
          rallyId,
          candidateId: member.userId,
          role: member.role,
          holdUntil,
        })),
      )
      .returning({ id: offers.id, candidateId: offers.candidateId });

    await notify(
      tx,
      ...created.map((offer) => ({
        userId: offer.candidateId,
        type: 'match.proposed',
        title: 'You have been matched',
        body: composition.reason,
        data: { matchId: offer.id },
        dedupeKey: `match.proposed:${offer.id}`,
      })),
    );

    const next =
      locked.status === 'proposed' ? locked : await transition(tx, locked, 'proposed');
    await scheduleArkivSync(tx, next);
    return 'proposed';
  });
}

/** The onboarding trigger, and updated availability, feed the same engine as a new rally. */
export async function evaluateForUser(deps: Deps, userId: string): Promise<void> {
  const rallyIds = await findRalliesForUser(deps.db, userId, 5);
  for (const rallyId of rallyIds) {
    await evaluateRally(deps, rallyId);
  }
}
