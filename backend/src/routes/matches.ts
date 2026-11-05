import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { requireUser } from '../plugins/auth.js';
import { idParams, matchesSchema, matchSchema, respondBody } from '../schemas/api.js';
import { ok, successSchema } from '../schemas/common.js';
import { getMatch, listMatches, respondToMatch } from '../services/matches.js';

const secured = { security: [{ bearer: [] }] };

export const matchRoutes: FastifyPluginAsyncZod = async (app) => {
  const { deps } = app;
  const auth = { onRequest: app.authenticate };

  app.get(
    '/matches',
    {
      ...auth,
      schema: {
        ...secured,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
        response: { 200: successSchema(matchesSchema) },
      },
    },
    async (request) => ok(await listMatches(deps, requireUser(request).id, request.query.limit)),
  );

  app.get(
    '/matches/:id',
    {
      ...auth,
      schema: { ...secured, params: idParams, response: { 200: successSchema(matchSchema) } },
    },
    async (request) => ok(await getMatch(deps, requireUser(request).id, request.params.id)),
  );

  app.post(
    '/matches/:id/respond',
    {
      ...auth,
      schema: {
        ...secured,
        params: idParams,
        body: respondBody,
        response: { 200: successSchema(matchSchema) },
      },
    },
    async (request) =>
      ok(
        await respondToMatch(
          deps,
          requireUser(request).id,
          request.params.id,
          request.body.response,
        ),
      ),
  );
};
