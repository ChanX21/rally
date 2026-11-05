import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { matchProposals, offers } from '../db/schema/index.js';
import { SHORTLIST_SIZE } from '../domain/catalog.js';
import { MATCHABLE } from '../domain/rally-state.js';
import { rankCandidates, scoreCandidate } from '../domain/scoring.js';
import { overlapMinutes } from '../domain/time.js';
import type { Deps } from '../lib/deps.js';
import { notify } from '../lib/notify.js';
import {
  type CandidateRow,
  findCandidates,
  findRalliesForUser,
} from '../repositories/matching.js';
import {
  countActiveClaims,
  countPendingOffers,
  findRally,
  lockRally,
  openSlots,
  type Rally,
} from '../repositories/rallies.js';
import { DATA_RULE, runAiTask, userData } from './ai-harness.js';
import { scheduleArkivSync, transition } from './rally-lifecycle.js';

const COMPOSE_PROMPT_VERSION = 'compose_group.v1';
const FORBIDDEN_IN_REASON = /(@|https?:\/\/|\b0x[a-f0-9]{6,}|\bc\d+\b|did:privy)/i;

const composeSchema = z.strictObject({
  memberIds: z.array(z.string()).min(1).max(SHORTLIST_SIZE),
  roles: z.array(z.string()).min(1).max(SHORTLIST_SIZE),
  reason: z.string().min(1).max(280),
});

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

/** Rejects anything but a real subset of the shortlist that fits seats and roles. */
export function validateComposition(
  output: z.infer<typeof composeSchema>,
  aliases: ReadonlySet<string>,
  roles: readonly string[],
  minMembers: number,
  maxMembers: number,
): string | null {
  const { memberIds, roles: chosenRoles, reason } = output;
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
  if (FORBIDDEN_IN_REASON.test(reason)) return 'reason contains identifiers';
  return null;
}

async function composeWithAi(
  deps: Deps,
  rally: Rally,
  candidates: readonly ScoredCandidate[],
  roles: readonly string[],
  minMembers: number,
  maxMembers: number,
): Promise<Composition> {
  const aliases = new Set(candidates.map((candidate) => candidate.alias));
  const result = await runAiTask(deps, {
    task: 'compose_group',
    promptVersion: COMPOSE_PROMPT_VERSION,
    maxTokens: 800,
    schema: composeSchema,
    validate: (output) => validateComposition(output, aliases, roles, minMembers, maxMembers),
    messages: [
      {
        role: 'system',
        content:
          'You compose a small group for a real-world activity from a shortlist of already ' +
          `eligible, pseudonymous candidates. ${DATA_RULE}\nFields: memberIds (candidate aliases, ` +
          `${minMembers} to ${maxMembers} of them), roles (same length and order, each taken once ` +
          'from availableRoles), reason (one friendly sentence shown to the people invited: ' +
          'mention no aliases, names or contact details). Only use listed aliases. Prefer ' +
          'feasible timing, then complementary skills, then likely acceptance.',
      },
      {
        role: 'user',
        content: [
          userData('activity', {
            category: rally.category,
            vibe: rally.vibe,
            durationMin: rally.durationMin,
            zone: rally.zone,
            availableRoles: roles,
          }),
          // Aliases only. No user IDs, names, wallets or free-form text cross this boundary.
          userData(
            'candidates',
            candidates.map((candidate) => ({
              alias: candidate.alias,
              interests: candidate.interests,
              skills: candidate.declared_skills,
              overlapMinutes: candidate.overlapMin,
              hasActiveIntent: candidate.intent_id !== null,
              vibe: candidate.intent_vibe ?? candidate.preferences?.group_energy ?? null,
              priorMutualEncore: candidate.mutual_encore,
            })),
          ),
        ].join('\n'),
      },
    ],
  });

  if (!result.ok) {
    const fallback = composeDeterministically(rally, candidates, roles, maxMembers);
    return { ...fallback, modelRunId: result.modelRunId };
  }

  const byAlias = new Map(candidates.map((candidate) => [candidate.alias, candidate]));
  const members = result.output.memberIds.map((alias, index) => ({
    userId: byAlias.get(alias)!.user_id,
    role: result.output.roles[index]!,
  }));
  const scores = result.output.memberIds.map((alias) => byAlias.get(alias)!.score);
  return {
    members,
    reason: result.output.reason,
    score: Math.round(scores.reduce((total, score) => total + score, 0) / scores.length),
    source: 'ai',
    modelRunId: result.modelRunId,
  };
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
      if (!locked) return;
      if (locked.status === 'open') {
        await scheduleArkivSync(tx, await transition(tx, locked, 'waiting'));
        await notify(tx, {
          userId: locked.creatorId,
          type: 'rally.waiting',
          title: 'No close fit yet',
          body: `We will keep looking for "${locked.goal}" and notify you when something changes.`,
          data: { rallyId },
          dedupeKey: `rally.waiting:${rallyId}`,
        });
      }
    });
    return 'waiting';
  }

  // The only model call. Infeasible cases returned above, and anyone offered a seat leaves the
  // candidate set, so a rally only spends another call when its feasible candidates have changed.
  const composition = await composeWithAi(deps, rally, candidates, roles, minMembers, maxMembers);

  return deps.db.transaction(async (tx) => {
    const locked = await lockRally(tx, rallyId);
    if (!locked || !matchable(locked)) return 'stale';

    // State may have moved during the model call. Keep only people who still qualify.
    const stillEligible = new Set(
      (await findCandidates(tx, locked, SHORTLIST_SIZE)).map((row) => row.user_id),
    );
    const members = composition.members.filter((member) => stillEligible.has(member.userId));
    const nowPending = await countPendingOffers(tx, rallyId);
    const nowClaims = await countActiveClaims(tx, rallyId);
    if (
      members.length === 0 ||
      nowClaims + nowPending + members.length < locked.groupMin ||
      nowPending + members.length > locked.openSeats
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
        members.map((member) => ({
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
