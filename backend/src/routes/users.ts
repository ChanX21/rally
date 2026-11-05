import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { requireUser } from '../plugins/auth.js';
import type { ProfileVersion, User } from '../repositories/users.js';
import {
  blockBody,
  meSchema,
  onboardingBody,
  onboardingQuestionsBody,
  profileUpdateBody,
  questionsSchema,
  userIdParams,
  userSchema,
} from '../schemas/api.js';
import { ok, successSchema } from '../schemas/common.js';
import {
  blockUser,
  chooseOnboardingQuestions,
  completeOnboarding,
  getMe,
  unblockUser,
  updateProfile,
  upsertSession,
} from '../services/users.js';

const secured = { security: [{ bearer: [] }] };

function userView(user: User) {
  return {
    id: user.id,
    walletAddress: user.walletAddress,
    displayName: user.displayName,
    optInMatching: user.optInMatching,
    onboarded: user.onboardedAt !== null,
  };
}

function profileView(profile: ProfileVersion) {
  return {
    version: profile.version,
    interests: profile.interests,
    interestsVersion: profile.interestsVersion,
    declaredSkills: profile.declaredSkills,
    inferredTags: profile.inferredTags,
    evidence: profile.evidence,
    preferences: profile.preferences,
    availableFrom: profile.availableFrom?.toISOString() ?? null,
    availableTo: profile.availableTo?.toISOString() ?? null,
    lastUpdatedAt: profile.createdAt.toISOString(),
  };
}

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  const { deps } = app;
  const auth = { onRequest: app.authenticate };

  app.post(
    '/auth/session',
    {
      schema: { ...secured, response: { 200: successSchema(userSchema) } },
    },
    async (request) => {
      const did = await app.verifyBearer(request);
      return ok(userView(await upsertSession(deps, did)));
    },
  );

  app.get(
    '/me',
    { ...auth, schema: { ...secured, response: { 200: successSchema(meSchema) } } },
    async (request) => {
      const { user, profile } = await getMe(deps, requireUser(request));
      return ok({ user: userView(user), profile: profile ? profileView(profile) : null });
    },
  );

  app.patch(
    '/me/profile',
    {
      ...auth,
      schema: { ...secured, body: profileUpdateBody, response: { 200: successSchema(meSchema) } },
    },
    async (request) => {
      const { user, profile } = await updateProfile(
        deps,
        requireUser(request).id,
        request.body,
      );
      return ok({ user: userView(user), profile: profileView(profile) });
    },
  );

  app.post(
    '/me/blocks',
    {
      ...auth,
      schema: {
        ...secured,
        body: blockBody,
        response: { 200: successSchema(z.object({ blocked: z.literal(true) })) },
      },
    },
    async (request) => {
      await blockUser(deps, requireUser(request).id, request.body.userId);
      return ok({ blocked: true as const });
    },
  );

  app.delete(
    '/me/blocks/:userId',
    {
      ...auth,
      schema: {
        ...secured,
        params: userIdParams,
        response: { 200: successSchema(z.object({ blocked: z.literal(false) })) },
      },
    },
    async (request) => {
      await unblockUser(deps, requireUser(request).id, request.params.userId);
      return ok({ blocked: false as const });
    },
  );

  app.post(
    '/onboarding/questions',
    {
      ...auth,
      schema: {
        ...secured,
        body: onboardingQuestionsBody,
        response: { 200: successSchema(questionsSchema) },
      },
    },
    async (request) => ok(await chooseOnboardingQuestions(deps, request.body.interests)),
  );

  app.post(
    '/onboarding/complete',
    {
      ...auth,
      schema: { ...secured, body: onboardingBody, response: { 200: successSchema(meSchema) } },
    },
    async (request) => {
      const { user, profile } = await completeOnboarding(
        deps,
        requireUser(request).id,
        request.body,
      );
      return ok({ user: userView(user), profile: profileView(profile) });
    },
  );
};
