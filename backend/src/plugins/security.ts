import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';

import type { Env } from '../config/env.js';

export const securityPlugin = fp<{ env: Env }>(async (app, { env }) => {
  await app.register(helmet);

  // The PWA authenticates with a bearer token, so cookies are not allowed cross-origin.
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  });
});
