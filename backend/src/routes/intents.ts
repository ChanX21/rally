import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { intents } from '../db/schema/index.js';
import { requireUser } from '../plugins/auth.js';
import {
  activateIntentBody,
  answerIntentBody,
  idParams,
  intentSchema,
  listQuery,
  parsedIntentSchema,
  parseIntentBody,
} from '../schemas/api.js';
import { ok, successSchema } from '../schemas/common.js';
import {
  activateIntent,
  answerIntent,
  cancelIntent,
  listIntents,
  parseIntent,
} from '../services/intents.js';

const secured = { security: [{ bearer: [] }] };

/** rawText stays private to the database and is not returned. */
function intentView(intent: typeof intents.$inferSelect) {
  return {
    id: intent.id,
    status: intent.status,
    source: intent.source,
    category: intent.category,
    goal: intent.goal,
    windowStart: intent.windowStart?.toISOString() ?? null,
    windowEnd: intent.windowEnd?.toISOString() ?? null,
    durationMin: intent.durationMin,
    groupMin: intent.groupMin,
    groupMax: intent.groupMax,
    zone: intent.zone,
    vibe: intent.vibe,
    questions: intent.questions,
    expiresAt: intent.expiresAt?.toISOString() ?? null,
    createdAt: intent.createdAt.toISOString(),
  };
}

export const intentRoutes: FastifyPluginAsyncZod = async (app) => {
  const { deps } = app;
  const auth = { onRequest: app.authenticate };

  app.post(
    '/intents/parse',
    {
      ...auth,
      schema: {
        ...secured,
        body: parseIntentBody,
        response: { 200: successSchema(parsedIntentSchema) },
      },
    },
    async (request) => {
      const result = await parseIntent(deps, requireUser(request).id, request.body);
      return ok({ ...result, intent: intentView(result.intent) });
    },
  );

  app.post(
    '/intents/:id/answers',
    {
      ...auth,
      schema: {
        ...secured,
        params: idParams,
        body: answerIntentBody,
        response: { 200: successSchema(parsedIntentSchema) },
      },
    },
    async (request) => {
      const result = await answerIntent(
        deps,
        requireUser(request).id,
        request.params.id,
        request.body.answers,
      );
      return ok({ ...result, intent: intentView(result.intent) });
    },
  );

  app.get(
    '/intents',
    {
      ...auth,
      schema: {
        ...secured,
        querystring: listQuery,
        response: {
          200: successSchema(
            z.object({ items: z.array(intentSchema), nextCursor: z.string().nullable() }),
          ),
        },
      },
    },
    async (request) => {
      const { items, nextCursor } = await listIntents(
        deps,
        requireUser(request).id,
        request.query,
      );
      return ok({ items: items.map(intentView), nextCursor });
    },
  );

  app.post(
    '/intents/:id/activate',
    {
      ...auth,
      schema: {
        ...secured,
        params: idParams,
        body: activateIntentBody,
        response: { 200: successSchema(intentSchema) },
      },
    },
    async (request) =>
      ok(
        intentView(
          await activateIntent(deps, requireUser(request).id, request.params.id, request.body),
        ),
      ),
  );

  app.post(
    '/intents/:id/cancel',
    {
      ...auth,
      schema: { ...secured, params: idParams, response: { 200: successSchema(intentSchema) } },
    },
    async (request) =>
      ok(intentView(await cancelIntent(deps, requireUser(request).id, request.params.id))),
  );
};
