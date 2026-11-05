import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError } from '../lib/errors.js';
import { ok, successSchema } from '../schemas/common.js';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  // Probes run constantly and must not be blocked by rate limiting.
  const probe = { config: { rateLimit: false } } as const;

  app.get(
    '/health',
    {
      ...probe,
      schema: {
        response: {
          200: successSchema(z.object({ status: z.literal('ok'), uptimeSeconds: z.number() })),
        },
      },
    },
    () => ok({ status: 'ok' as const, uptimeSeconds: Math.round(process.uptime()) }),
  );

  app.get(
    '/health/ready',
    {
      ...probe,
      schema: {
        response: {
          200: successSchema(z.object({ status: z.literal('ready'), database: z.literal('ok') })),
        },
      },
    },
    async () => {
      try {
        await app.db.execute(sql`select 1`);
      } catch (cause) {
        throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable', { cause });
      }
      return ok({ status: 'ready' as const, database: 'ok' as const });
    },
  );
};
