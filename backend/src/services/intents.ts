import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';

import { intents } from '../db/schema/index.js';
import type {
  VIBES} from '../domain/catalog.js';
import {
  CATEGORIES,
  MAX_DAYS_AHEAD,
  MAX_GROUP,
  MAX_QUESTIONS, ROLES
} from '../domain/catalog.js';
import { parseIntentFallback, redactPii } from '../domain/intent-fallback.js';
import { activityCatalog, preferencesFromAnswers, relevantPreferences, safePreferences, PERSONAL_QUESTIONS } from '../domain/questions.js';
import { latestProfile } from '../repositories/users.js';
import type { Deps } from '../lib/deps.js';
import { AppError, notFound } from '../lib/errors.js';
import { enqueue } from '../lib/outbox.js';
import { decodeCursor, page } from '../lib/pagination.js';

export type Intent = typeof intents.$inferSelect;
export type ParseStatus = 'ready' | 'needs_answers' | 'needs_review';

export interface ParsedIntent {
  intent: Intent;
  status: ParseStatus;
  needsReview: boolean;
  aiRequestId: string | null;
}

interface ParseCall {
  userId: string;
  text: string;
  timeZone: string;
  answers: { questionId: string; answer: string }[];
  attempt: 0 | 1;
}

function eventEnd(deps: Deps, now: Date): string {
  const configured = deps.env.EVENT_END ? new Date(deps.env.EVENT_END) : null;
  const latest = new Date(now.getTime() + MAX_DAYS_AHEAD * 86_400_000);
  return (configured && configured < latest ? configured : latest).toISOString();
}

/**
 * Runs the Formation Engine, and maps its answer onto intent columns. Anything but a usable result
 * becomes the editable form: prefilled by fixed rules, marked for review, and never published until
 * the user confirms it.
 */
async function runParse(deps: Deps, call: ParseCall) {
  const now = new Date();
  const profile = await latestProfile(deps.db, call.userId);
  const answered = new Set(call.answers.map((answer) => answer.questionId));
  const { result, modelRunId, requestId } = await deps.formation((engine, runId) =>
    engine.parseActivity({
      requestId: runId,
      text: redactPii(call.text),
      answers: call.answers.map((answer) => ({ ...answer, answer: redactPii(answer.answer) })),
      questions: activityCatalog.map(({ id, purpose, options }) => ({ id, purpose, options })),
      profile: profile ? { interests: profile.interests,
        declaredSkills: [...new Set(profile.declaredSkills.filter((s) => ROLES.some((role) => role === s)))],
        preferences: safePreferences(profile.preferences) } : undefined,
      remainingQuestions: Math.max(0, MAX_QUESTIONS - answered.size),
      attempt: call.attempt,
      now: now.toISOString(),
      eventEnd: eventEnd(deps, now),
      timeZone: call.timeZone,
      allowedCategoryIds: [...CATEGORIES],
      allowedZoneIds: deps.env.EVENT_ZONES,
    }),
  );

  const meta = { modelRunId, aiRequestId: requestId };

  if (result.status === 'ready') {
    const { intent } = result;
    const start = new Date(intent.startAt);
    return {
      ...meta,
      status: 'ready' as const,
      source: 'ai' as const,
      questions: [],
      fields: {
        preferences: relevantPreferences(intent.categoryId, { ...safePreferences(profile?.preferences ?? {}), ...intent.preferences, ...preferencesFromAnswers(call.answers) }),
        category: intent.categoryId,
        goal: intent.goal,
        windowStart: start,
        windowEnd: new Date(start.getTime() + intent.durationMin * 60_000),
        durationMin: intent.durationMin,
        groupMin: Math.min(intent.groupMin, MAX_GROUP),
        groupMax: Math.min(intent.groupMax, MAX_GROUP),
        zone: intent.zoneId,
        vibe: intent.vibe,
      },
    };
  }

  const fallbackFields = parseIntentFallback(call.text, now);
  const fallback = { ...fallbackFields,
    preferences: relevantPreferences(fallbackFields.category ?? '', safePreferences(profile?.preferences ?? {})) };
  if (result.status === 'needs_answers') {
    return {
      ...meta,
      status: 'needs_answers' as const,
      source: 'ai' as const,
      questions: activityCatalog.filter((q) => result.questionIds.includes(q.id)).map(
        ({ id, text, options }) => ({ id, text, options }),
      ),
      // Nothing is confirmed yet, so the model's silence is not filled in with a guess.
      fields: { goal: fallback.goal },
    };
  }

  deps.log.warn({ failure: result.status, aiRequestId: requestId }, 'intent parse fell back to form');
  return {
    ...meta,
    status: 'needs_review' as const,
    source: 'fallback' as const,
    questions: [],
    fields: fallback,
  };
}

const present = (intent: Intent, parse: { status: ParseStatus; aiRequestId: string | null }) => ({
  intent,
  status: parse.status,
  needsReview: parse.status === 'needs_review',
  aiRequestId: parse.aiRequestId,
});

export async function parseIntent(
  deps: Deps,
  userId: string,
  input: { text: string; timeZone?: string | undefined },
): Promise<ParsedIntent> {
  const timeZone = input.timeZone ?? deps.env.EVENT_TIME_ZONE;
  const parse = await runParse(deps, { userId, text: input.text, timeZone, answers: [], attempt: 0 });
  const [intent] = await deps.db
    .insert(intents)
    .values({
      userId,
      rawText: input.text,
      timeZone,
      parseAttempts: 1,
      source: parse.source,
      modelRunId: parse.modelRunId,
      questions: parse.questions,
      ...parse.fields,
    })
    .returning();
  return present(intent!, parse);
}

/**
 * Applies the user's answers with the one reparse the budget allows. The attempt is claimed first in
 * a conditional update, so concurrent retries cannot spend a second model call.
 */
export async function answerIntent(
  deps: Deps,
  userId: string,
  intentId: string,
  answers: { questionId: string; answer: string }[],
): Promise<ParsedIntent> {
  const [existing] = await deps.db
    .select()
    .from(intents)
    .where(and(eq(intents.id, intentId), eq(intents.userId, userId)));
  if (!existing) throw notFound('Intent');

  const asked = new Set(existing.questions.map((question) => question.id));
  if (asked.size === 0) {
    throw new AppError(409, 'NO_QUESTIONS', 'This intent is not waiting for answers');
  }
  if (answers.some((answer) => !asked.has(answer.questionId))) {
    throw new AppError(422, 'UNKNOWN_QUESTION', 'Only answer the questions you were asked');
  }
  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length) {
    throw new AppError(422, 'DUPLICATE_ANSWER', 'Each question may be answered once');
  }

  for (const answer of answers) {
    const question = PERSONAL_QUESTIONS.find((q) => q.id === answer.questionId);
    if (question && !question.options?.some((o) => o.value === answer.answer)) {
      throw new AppError(422, 'INVALID_ANSWER', 'Choose an offered option');
    }
  }
  const [claimed] = await deps.db
    .update(intents)
    .set({ parseAttempts: 2, answers })
    .where(and(eq(intents.id, intentId), eq(intents.status, 'draft'), eq(intents.parseAttempts, 1)))
    .returning({ id: intents.id });
  if (!claimed) {
    throw new AppError(409, 'PARSE_BUDGET_EXHAUSTED', 'Use the editable form to finish this plan');
  }

  const parse = await runParse(deps, {
    userId,
    text: existing.rawText,
    timeZone: existing.timeZone ?? deps.env.EVENT_TIME_ZONE,
    answers,
    attempt: 1,
  });
  const [intent] = await deps.db
    .update(intents)
    .set({
      source: parse.source,
      modelRunId: parse.modelRunId,
      questions: [],
      ...parse.fields,
    })
    .where(eq(intents.id, intentId))
    .returning();
  return present(intent!, parse);
}

export async function listIntents(
  deps: Deps,
  userId: string,
  options: { limit: number; cursor?: string | undefined },
) {
  const cursor = decodeCursor(options.cursor);
  const rows = await deps.db
    .select()
    .from(intents)
    .where(
      and(
        eq(intents.userId, userId),
        cursor
          ? or(
              lt(intents.createdAt, cursor.createdAt),
              and(eq(intents.createdAt, cursor.createdAt), lt(intents.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(intents.createdAt), desc(intents.id))
    .limit(options.limit + 1);
  return page(rows, options.limit);
}

export interface ActivateIntentInput {
  preferences?: Record<string, string>;
  category?: (typeof CATEGORIES)[number] | undefined;
  windowStart?: Date | undefined;
  windowEnd?: Date | undefined;
  durationMin?: number | undefined;
  zone?: string | null | undefined;
  vibe?: (typeof VIBES)[number] | undefined;
  expiresAt?: Date | undefined;
}

/** "No close fit yet. Keep this interest active until 6 PM?" Consent to stay matchable. */
export async function activateIntent(
  deps: Deps,
  userId: string,
  intentId: string,
  input: ActivateIntentInput,
) {
  return deps.db.transaction(async (tx) => {
    const [intent] = await tx
      .select()
      .from(intents)
      .where(and(eq(intents.id, intentId), eq(intents.userId, userId)))
      .for('update');
    if (!intent) throw notFound('Intent');
    if (intent.status === 'waiting') return intent;
    if (intent.status !== 'draft') {
      throw new AppError(409, 'INVALID_STATE', `This intent is already ${intent.status}`);
    }

    const merged = {
      preferences: relevantPreferences(input.category ?? intent.category ?? '', input.preferences ?? intent.preferences),
      category: input.category ?? intent.category,
      windowStart: input.windowStart ?? intent.windowStart,
      windowEnd: input.windowEnd ?? intent.windowEnd,
      durationMin: input.durationMin ?? intent.durationMin,
      zone: input.zone === undefined ? intent.zone : input.zone,
      vibe: input.vibe ?? intent.vibe,
    };
    if (!merged.category || !merged.windowStart || !merged.windowEnd || !merged.durationMin) {
      throw new AppError(
        422,
        'INTENT_INCOMPLETE',
        'Category, time window and duration are required to keep this interest active',
      );
    }
    if (merged.windowEnd <= merged.windowStart) {
      throw new AppError(422, 'INVALID_WINDOW', 'The time window must end after it starts');
    }
    if (merged.windowEnd <= new Date()) {
      throw new AppError(422, 'INVALID_WINDOW', 'The time window has already passed');
    }
    if (merged.zone && !deps.env.EVENT_ZONES.includes(merged.zone)) {
      throw new AppError(422, 'INVALID_ZONE', 'That zone is not available at this event');
    }
    const expiresAt = input.expiresAt ?? merged.windowEnd;
    if (expiresAt <= new Date()) {
      throw new AppError(422, 'INVALID_EXPIRY', 'Expiry must be in the future');
    }

    const [updated] = await tx
      .update(intents)
      .set({ ...merged, status: 'waiting', expiresAt })
      .where(eq(intents.id, intentId))
      .returning();
    await enqueue(tx, { type: 'match.reevaluate', payload: { userId } });
    return updated!;
  });
}

export async function cancelIntent(deps: Deps, userId: string, intentId: string) {
  const [updated] = await deps.db
    .update(intents)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(intents.id, intentId),
        eq(intents.userId, userId),
        inArray(intents.status, ['draft', 'waiting']),
      ),
    )
    .returning();
  if (updated) return updated;

  const [existing] = await deps.db
    .select()
    .from(intents)
    .where(and(eq(intents.id, intentId), eq(intents.userId, userId)));
  if (!existing) throw notFound('Intent');
  if (existing.status === 'cancelled') return existing;
  throw new AppError(409, 'INVALID_STATE', `This intent is already ${existing.status}`);
}
