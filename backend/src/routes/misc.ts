import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { requireUser } from '../plugins/auth.js';
import {
  idParams,
  metricsSchema,
  notificationSchema,
  notificationsQuery,
  previewQuery,
  previewSchema,
  rewardsSchema,
  voucherSchema,
} from '../schemas/api.js';
import { ok, successSchema } from '../schemas/common.js';
import { previewActivities } from '../services/activities.js';
import { getRewards } from '../services/feedback.js';
import { collectMetrics } from '../services/metrics.js';
import { listNotifications, markAllRead, markRead } from '../services/notifications.js';
import { issueVoucher } from '../services/reward-voucher.js';

const secured = { security: [{ bearer: [] }] };

export const miscRoutes: FastifyPluginAsyncZod = async (app) => {
  const { deps } = app;
  const auth = { onRequest: app.authenticate };

  // Public: this is the QR preview. Everything here is already public on Arkiv.
  app.get(
    '/activities/preview',
    {
      schema: { querystring: previewQuery, response: { 200: successSchema(previewSchema) } },
    },
    async (request) => ok(await previewActivities(deps, request.query)),
  );

  app.get(
    '/notifications',
    {
      ...auth,
      schema: {
        ...secured,
        querystring: notificationsQuery,
        response: {
          200: successSchema(
            z.object({
              items: z.array(notificationSchema),
              nextCursor: z.string().nullable(),
              unreadCount: z.number(),
            }),
          ),
        },
      },
    },
    async (request) => ok(await listNotifications(deps, requireUser(request).id, request.query)),
  );

  app.post(
    '/notifications/read-all',
    {
      ...auth,
      schema: {
        ...secured,
        response: { 200: successSchema(z.object({ updated: z.number() })) },
      },
    },
    async (request) => ok(await markAllRead(deps, requireUser(request).id)),
  );

  app.post(
    '/notifications/:id/read',
    {
      ...auth,
      schema: {
        ...secured,
        params: idParams,
        response: { 200: successSchema(notificationSchema) },
      },
    },
    async (request) => ok(await markRead(deps, requireUser(request).id, request.params.id)),
  );

  app.get(
    '/me/rewards',
    { ...auth, schema: { ...secured, response: { 200: successSchema(rewardsSchema) } } },
    async (request) => ok(await getRewards(deps, requireUser(request).id)),
  );

  app.post(
    '/me/rewards/:id/voucher',
    {
      ...auth,
      schema: {
        ...secured,
        params: idParams,
        response: { 200: successSchema(voucherSchema) },
      },
    },
    async (request) => ok(await issueVoucher(deps, requireUser(request).id, request.params.id)),
  );

  app.get(
    '/internal/metrics',
    {
      onRequest: app.requireAdmin,
      schema: { ...secured, response: { 200: successSchema(metricsSchema) } },
    },
    async () => ok(await collectMetrics(deps)),
  );
};
