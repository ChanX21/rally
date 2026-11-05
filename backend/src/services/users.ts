import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { onboardingAnswers, userBlocks, users } from '../db/schema/index.js';
import {
  type Category,
  MAX_QUESTIONS,
  ONBOARDING_QUESTIONS,
  REQUIRED_INTERESTS,
} from '../domain/catalog.js';
import type { Deps } from '../lib/deps.js';
import { AppError, notFound } from '../lib/errors.js';
import { enqueue } from '../lib/outbox.js';
import {
  appendProfile,
  findUserByDid,
  latestProfile,
  lockUser,
  type User,
} from '../repositories/users.js';
import { DATA_RULE, runAiTask, userData } from './ai-harness.js';

/** Identity comes only from the verified token. Wallets are read from Privy, never the client. */
export async function upsertSession(deps: Deps, did: string): Promise<User> {
  const existing = await findUserByDid(deps.db, did);

  let wallet: string | null = null;
  try {
    wallet = (await deps.auth?.getWallet(did)) ?? null;
  } catch (error) {
    // Login should survive a Privy API blip. Only reward vouchers need a verified wallet.
    deps.log.warn({ err: error }, 'could not read wallet from Privy');
  }

  if (existing && (wallet === null || wallet === existing.walletAddress)) return existing;

  const [user] = await deps.db
    .insert(users)
    .values({ privyDid: did, walletAddress: wallet })
    .onConflictDoUpdate({
      target: users.privyDid,
      set: { walletAddress: sql`coalesce(excluded.wallet_address, ${users.walletAddress})` },
    })
    .returning();
  return user!;
}

export async function getMe(deps: Deps, user: User) {
  const profile = await latestProfile(deps.db, user.id);
  return { user, profile: profile ?? null };
}

const QUESTIONS_PROMPT_VERSION = 'onboarding_questions.v1';

/** 0G may only choose from fixed templates. If it fails, the templates are used in order. */
export async function chooseOnboardingQuestions(deps: Deps, interests: readonly Category[]) {
  const allowedIds = ONBOARDING_QUESTIONS.map((question) => question.id);
  const result = await runAiTask(deps, {
    task: 'onboarding_questions',
    promptVersion: QUESTIONS_PROMPT_VERSION,
    maxTokens: 300,
    schema: z.strictObject({
      questionIds: z.array(z.string()).min(1).max(MAX_QUESTIONS),
    }),
    validate: ({ questionIds }) => {
      if (new Set(questionIds).size !== questionIds.length) return 'duplicate question';
      return questionIds.every((id) => allowedIds.includes(id)) ? null : 'unknown question id';
    },
    messages: [
      {
        role: 'system',
        content:
          'Choose the onboarding questions most useful for matching this person with others for ' +
          `real-world activities. ${DATA_RULE}\nFields: questionIds, at most ${MAX_QUESTIONS} ` +
          'IDs from the available list.',
      },
      {
        role: 'user',
        content: [
          userData('interests', interests),
          userData('available_questions', ONBOARDING_QUESTIONS),
        ].join('\n'),
      },
    ],
  });

  const chosen = result.ok
    ? result.output.questionIds.flatMap((id) =>
        ONBOARDING_QUESTIONS.filter((question) => question.id === id),
      )
    : ONBOARDING_QUESTIONS.slice(0, MAX_QUESTIONS);

  return {
    questions: chosen,
    source: result.ok ? ('ai' as const) : ('fallback' as const),
    aiRequestId: result.requestId,
  };
}

export interface OnboardingInput {
  displayName?: string | undefined;
  interests: Category[];
  answers: { questionId: string; answer: string }[];
  declaredSkills: string[];
  preferences: Record<string, string>;
  availableFrom?: Date | undefined;
  availableTo?: Date | undefined;
  optInMatching: boolean;
}

function assertAvailability(from: Date | undefined | null, to: Date | undefined | null) {
  if (!from || !to) {
    throw new AppError(422, 'AVAILABILITY_REQUIRED', 'Matching needs an availability window');
  }
  if (to <= from) {
    throw new AppError(422, 'INVALID_WINDOW', 'Availability must end after it starts');
  }
}

export async function completeOnboarding(deps: Deps, userId: string, input: OnboardingInput) {
  if (new Set(input.interests).size !== REQUIRED_INTERESTS) {
    throw new AppError(422, 'INVALID_INTERESTS', 'Choose three different interests');
  }
  if (new Set(input.answers.map((answer) => answer.questionId)).size !== input.answers.length) {
    throw new AppError(422, 'DUPLICATE_ANSWER', 'Each question may be answered once');
  }
  if (input.optInMatching) assertAvailability(input.availableFrom, input.availableTo);

  return deps.db.transaction(async (tx) => {
    const user = await lockUser(tx, userId);
    if (!user) throw notFound('User');
    if (user.onboardedAt) {
      throw new AppError(409, 'ALREADY_ONBOARDED', 'Use PATCH /me/profile to change your profile');
    }

    const profile = await appendProfile(tx, userId, {
      interests: input.interests,
      declaredSkills: input.declaredSkills,
      preferences: input.preferences,
      availableFrom: input.availableFrom ?? null,
      availableTo: input.availableTo ?? null,
    });
    if (input.answers.length > 0) {
      await tx
        .insert(onboardingAnswers)
        .values(input.answers.map((answer) => ({ userId, ...answer })));
    }
    const [updated] = await tx
      .update(users)
      .set({
        onboardedAt: new Date(),
        optInMatching: input.optInMatching,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      })
      .where(eq(users.id, userId))
      .returning();

    if (input.optInMatching) {
      await enqueue(tx, {
        type: 'user.onboarded',
        payload: { userId },
        dedupeKey: `user.onboarded:${userId}`,
      });
    }
    return { user: updated!, profile };
  });
}

export interface ProfileUpdateInput {
  displayName?: string | undefined;
  interests?: Category[] | undefined;
  declaredSkills?: string[] | undefined;
  preferences?: Record<string, string> | undefined;
  availableFrom?: Date | null | undefined;
  availableTo?: Date | null | undefined;
  optInMatching?: boolean | undefined;
}

export async function updateProfile(deps: Deps, userId: string, input: ProfileUpdateInput) {
  if (input.interests && new Set(input.interests).size !== REQUIRED_INTERESTS) {
    throw new AppError(422, 'INVALID_INTERESTS', 'Choose three different interests');
  }

  return deps.db.transaction(async (tx) => {
    const user = await lockUser(tx, userId);
    if (!user) throw notFound('User');
    if (!user.onboardedAt) {
      throw new AppError(409, 'NOT_ONBOARDED', 'Complete onboarding first');
    }

    const previous = await latestProfile(tx, userId);
    const availableFrom =
      input.availableFrom === undefined ? (previous?.availableFrom ?? null) : input.availableFrom;
    const availableTo =
      input.availableTo === undefined ? (previous?.availableTo ?? null) : input.availableTo;
    const optIn = input.optInMatching ?? user.optInMatching;
    if (optIn) assertAvailability(availableFrom, availableTo);

    const profile = await appendProfile(tx, userId, {
      ...(input.interests === undefined ? {} : { interests: input.interests }),
      ...(input.declaredSkills === undefined ? {} : { declaredSkills: input.declaredSkills }),
      ...(input.preferences === undefined ? {} : { preferences: input.preferences }),
      availableFrom,
      availableTo,
    });
    const [updated] = await tx
      .update(users)
      .set({
        optInMatching: optIn,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      })
      .where(eq(users.id, userId))
      .returning();

    if (optIn) await enqueue(tx, { type: 'match.reevaluate', payload: { userId } });
    return { user: updated!, profile };
  });
}

export async function blockUser(deps: Deps, blockerId: string, blockedId: string) {
  if (blockerId === blockedId) {
    throw new AppError(422, 'CANNOT_BLOCK_SELF', 'You cannot block yourself');
  }
  const [target] = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, blockedId));
  if (!target) throw notFound('User');
  await deps.db.insert(userBlocks).values({ blockerId, blockedId }).onConflictDoNothing();
}

export async function unblockUser(deps: Deps, blockerId: string, blockedId: string) {
  await deps.db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)));
}

