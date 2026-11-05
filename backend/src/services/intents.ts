import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';

import { intents } from '../db/schema/index.js';
import {
  CATEGORIES,
  MAX_DAYS_AHEAD,
  MAX_DURATION_MIN,
  MAX_GROUP,
  MAX_QUESTIONS,
  MIN_GROUP,
  VIBES,
} from '../domain/catalog.js';
import { FALLBACK_QUESTIONS, parseIntentFallback, redactPii } from '../domain/intent-fallback.js';
import type { Deps } from '../lib/deps.js';
import { AppError, notFound } from '../lib/errors.js';
import { enqueue } from '../lib/outbox.js';
import { decodeCursor, page } from '../lib/pagination.js';
import { DATA_RULE, runAiTask, userData } from './ai-harness.js';

const PROMPT_VERSION = 'parse_intent.v1';

/** Strict: extra fields such as member IDs or owners make the whole output invalid. */
const aiIntentSchema = z.strictObject({
  category: z.enum(CATEGORIES).nullable(),
  goal: z.string().min(1).max(120),
  from: z.iso.datetime({ offset: true }),
  durationMin: z.number().int().min(5).max(MAX_DURATION_MIN),
  groupMin: z.number().int().min(MIN_GROUP).max(MAX_GROUP),
  groupMax: z.number().int().min(MIN_GROUP).max(MAX_GROUP),
  zone: z.string().nullable(),
  vibe: z.enum(VIBES),
  questions: z
    .array(z.strictObject({ id: z.string().min(1).max(40), text: z.string().min(1).max(140) }))
    .max(MAX_QUESTIONS),
});

type AiIntent = z.infer<typeof aiIntentSchema>;

function validateAiIntent(output: AiIntent, now: Date, zones: readonly string[]): string | null {
  if (output.groupMin > output.groupMax) return 'groupMin exceeds groupMax';
  if (output.zone !== null && !zones.includes(output.zone)) return 'zone not in catalog';
  const from = new Date(output.from).getTime();
  if (from < now.getTime() - 5 * 60_000) return 'start time is in the past';
  if (from > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) return 'start time too far ahead';
  return null;
}

export async function parseIntent(deps: Deps, userId: string, text: string) {
  const now = new Date();
  const result = await runAiTask(deps, {
    task: 'parse_intent',
    promptVersion: PROMPT_VERSION,
    schema: aiIntentSchema,
    validate: (output) => validateAiIntent(output, now, deps.env.EVENT_ZONES),
    messages: [
      {
        role: 'system',
        content:
          `You turn a person's activity idea into a structured plan for a real-world meetup app. ${DATA_RULE}\n` +
          'Fields: category (one of the allowed values, or null if unclear), goal (short summary, ' +
          'no personal data), from (ISO 8601 start time), durationMin, groupMin, groupMax, zone ' +
          '(one of the allowed zones, or null if not stated), vibe, questions. ' +
          'questions: at most three, only where the answer would change who is matched, each ' +
          'with a short id and text. Use an empty array if nothing is ambiguous. ' +
          'Never output people, IDs, exact addresses or seat assignments.',
      },
      {
        role: 'user',
        content: [
          userData('context', {
            now: now.toISOString(),
            categories: CATEGORIES,
            zones: deps.env.EVENT_ZONES,
            vibes: VIBES,
          }),
          userData('activity_idea', redactPii(text)),
        ].join('\n'),
      },
    ],
  });

  const structured = result.ok
    ? {
        category: result.output.category,
        goal: result.output.goal,
        windowStart: new Date(result.output.from),
        windowEnd: new Date(new Date(result.output.from).getTime() + result.output.durationMin * 60_000),
        durationMin: result.output.durationMin,
        groupMin: result.output.groupMin,
        groupMax: result.output.groupMax,
        zone: result.output.zone,
        vibe: result.output.vibe,
      }
    : parseIntentFallback(text, now);
  const questions = result.ok ? result.output.questions : [...FALLBACK_QUESTIONS];
  const source = result.ok ? ('ai' as const) : ('fallback' as const);

  const [intent] = await deps.db
    .insert(intents)
    .values({
      userId,
      rawText: text,
      source,
      modelRunId: result.modelRunId,
      questions,
      ...structured,
    })
    .returning();

  return {
    intent: intent!,
    needsReview: !result.ok,
    aiRequestId: result.requestId,
  };
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
