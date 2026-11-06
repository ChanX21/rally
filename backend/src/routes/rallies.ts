import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { requireUser } from '../plugins/auth.js';
import {
  arrivalSchema,
  raiseDisputeBody,
  checkInBody,
  createRallyBody,
  feedbackBody,
  feedbackResultSchema,
  idempotencyHeader,
  idParams,
  listRalliesQuery,
  participantSchema,
  rallySchema,
  roomSchema,
  updateRallyBody,
} from '../schemas/api.js';
import { ok, successSchema } from '../schemas/common.js';
import { raiseDispute } from '../services/disputes.js';
import { submitFeedback } from '../services/feedback.js';
import {
  cancelRally,
  checkIn,
  createRally,
  getRally,
  getRoom,
  listParticipants,
  listRallies,
  markArrived,
  publishRally,
  updateRally,
  withdrawFromRally,
} from '../services/rallies.js';

const secured = { security: [{ bearer: [] }] };
const rallyResponse = { response: { 200: successSchema(rallySchema) } };

export const rallyRoutes: FastifyPluginAsyncZod = async (app) => {
  const { deps } = app;
  const auth = { onRequest: app.authenticate };

  app.post(
    '/rallies',
    {
      ...auth,
      schema: {
        ...secured,
        ...rallyResponse,
        body: createRallyBody,
        headers: idempotencyHeader,
      },
    },
    async (request) =>
      ok(
        await createRally(
          deps,
          requireUser(request).id,
          request.body,
          request.headers['idempotency-key'],
        ),
      ),
  );

  app.get(
    '/rallies',
    {
      ...auth,
      schema: {
        ...secured,
        querystring: listRalliesQuery,
        response: {
          200: successSchema(
            z.object({ items: z.array(rallySchema), nextCursor: z.string().nullable() }),
          ),
        },
      },
    },
    async (request) => ok(await listRallies(deps, requireUser(request).id, request.query)),
  );

  app.get(
    '/rallies/:id',
    { ...auth, schema: { ...secured, ...rallyResponse, params: idParams } },
    async (request) => ok(await getRally(deps, requireUser(request).id, request.params.id)),
  );

  app.patch(
    '/rallies/:id',
    { ...auth, schema: { ...secured, ...rallyResponse, params: idParams, body: updateRallyBody } },
    async (request) =>
      ok(await updateRally(deps, requireUser(request).id, request.params.id, request.body)),
  );

  app.post(
    '/rallies/:id/publish',
    { ...auth, schema: { ...secured, ...rallyResponse, params: idParams } },
    async (request) => ok(await publishRally(deps, requireUser(request).id, request.params.id)),
  );

  app.post(
    '/rallies/:id/cancel',
    { ...auth, schema: { ...secured, ...rallyResponse, params: idParams } },
    async (request) => ok(await cancelRally(deps, requireUser(request).id, request.params.id)),
  );

  app.post(
    '/rallies/:id/withdraw',
    { ...auth, schema: { ...secured, ...rallyResponse, params: idParams } },
    async (request) =>
      ok(await withdrawFromRally(deps, requireUser(request).id, request.params.id)),
  );

  app.get(
    '/rallies/:id/participants',
    {
      ...auth,
      schema: {
        ...secured,
        params: idParams,
        response: { 200: successSchema(z.array(participantSchema)) },
      },
    },
    async (request) =>
      ok(await listParticipants(deps, requireUser(request).id, request.params.id)),
  );

  app.get(
    '/rallies/:id/room',
    {
      ...auth,
      schema: { ...secured, params: idParams, response: { 200: successSchema(roomSchema) } },
    },
    async (request) => ok(await getRoom(deps, requireUser(request).id, request.params.id)),
  );

  app.post(
    '/rallies/:id/arrive',
    {
      ...auth,
      schema: { ...secured, params: idParams, response: { 200: successSchema(arrivalSchema) } },
    },
    async (request) => ok(await markArrived(deps, requireUser(request).id, request.params.id)),
  );

  app.post(
    '/rallies/:id/disputes',
    {
      ...auth,
      schema: {
        ...secured,
        params: idParams,
        body: raiseDisputeBody,
        response: { 200: successSchema(z.object({ id: z.uuid(), status: z.string() })) },
      },
    },
    async (request) =>
      ok(await raiseDispute(deps, requireUser(request).id, request.params.id, request.body)),
  );

  app.post(
    '/rallies/:id/check-in',
    { ...auth, schema: { ...secured, ...rallyResponse, params: idParams, body: checkInBody } },
    async (request) =>
      ok(
        await checkIn(
          deps,
          requireUser(request).id,
          request.params.id,
          request.body.presentUserIds,
        ),
      ),
  );

  app.post(
    '/rallies/:id/feedback',
    {
      ...auth,
      schema: {
        ...secured,
        params: idParams,
        body: feedbackBody,
        response: { 200: successSchema(feedbackResultSchema) },
      },
    },
    async (request) =>
      ok(await submitFeedback(deps, requireUser(request).id, request.params.id, request.body)),
  );
};
