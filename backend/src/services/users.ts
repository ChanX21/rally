import { and, eq, sql } from 'drizzle-orm';

import { onboardingAnswers, userBlocks, users } from '../db/schema/index.js';
import {
  type Category,
  MAX_QUESTIONS,
  ONBOARDING_QUESTIONS,
  REQUIRED_INTERESTS,
} from '../domain/catalog.js';
import { onboardingCatalog, PERSONAL_QUESTIONS, preferencesFromAnswers } from '../domain/questions.js';
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

/** The model only picks IDs from the fixed catalog. If it fails, the engine uses catalog order. */
export async function chooseOnboardingQuestions(
  deps: Deps,
  userId: string,
  interests: readonly Category[],
) {
  const catalog = onboardingCatalog(interests);
  const answered = await deps.db
    .select({ id: onboardingAnswers.questionId })
    .from(onboardingAnswers)
    .where(eq(onboardingAnswers.userId, userId));
  const alreadyAnsweredIds = answered.map((row) => row.id);

  const { result, requestId } = await deps.formation((engine, runId) =>
    engine.chooseOnboardingQuestions({
      requestId: runId,
      interests: [...interests],
      questions: catalog.map(({ id, purpose, options }) => ({ id, purpose, options })),
      alreadyAnsweredIds,
      remainingQuestions: Math.max(0, MAX_QUESTIONS - alreadyAnsweredIds.length),
    }),
  );

  return {
    questions: result.questionIds.flatMap((id) =>
      catalog.filter((question) => question.id === id).map(({ id: qid, text, options }) => ({
        id: qid,
        text, options,
      })),
    ),
    source: result.source,
    aiRequestId: requestId,
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
  const knownQuestions = new Set([...ONBOARDING_QUESTIONS, ...PERSONAL_QUESTIONS].map((question) => question.id));
  if (input.answers.some((answer) => !knownQuestions.has(answer.questionId))) {
    throw new AppError(422, 'UNKNOWN_QUESTION', 'That question is not in the catalog');
  }
  for (const answer of input.answers) {
    const question = PERSONAL_QUESTIONS.find((q) => q.id === answer.questionId);
    if (question && (!onboardingCatalog(input.interests).some((q) => q.id === question.id)
      || !question.options?.some((o) => o.value === answer.answer))) {
      throw new AppError(422, 'INVALID_ANSWER', 'Choose an offered option for your selected interest');
    }
  }
  const derived = preferencesFromAnswers(input.answers);
  const declaredSkills = [...new Set([...input.declaredSkills,
    ...(derived.build_role && derived.build_role !== 'any' ? [derived.build_role] : [])])];
  if (input.optInMatching) assertAvailability(input.availableFrom, input.availableTo);

  return deps.db.transaction(async (tx) => {
    const user = await lockUser(tx, userId);
    if (!user) throw notFound('User');
    if (user.onboardedAt) {
      throw new AppError(409, 'ALREADY_ONBOARDED', 'Use PATCH /me/profile to change your profile');
    }

    const profile = await appendProfile(tx, userId, {
      interests: input.interests,
      declaredSkills,
      preferences: { ...input.preferences, ...derived },
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

