import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import Fastify, { LogController } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import type { Env } from './config/env.js';
import { loggerOptions } from './lib/logger.js';
import { databasePlugin } from './plugins/database.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { securityPlugin } from './plugins/security.js';
import { healthRoutes } from './routes/health.js';

const REQUEST_ID_PATTERN = /^[\w-]{8,64}$/;

/** Keeps a well-formed caller-supplied ID for tracing. Anything else gets a fresh one. */
function requestId(request: IncomingMessage): string {
  const supplied = request.headers['x-request-id'];
  return typeof supplied === 'string' && REQUEST_ID_PATTERN.test(supplied)
    ? supplied
    : randomUUID();
}

export async function buildApp({ env }: { env: Env }) {
  const app = Fastify({
    logger: loggerOptions(env),
    trustProxy: env.TRUST_PROXY,
    genReqId: requestId,
    requestIdHeader: false,
    // Health probes run constantly and would drown out real request logs.
    logController: new LogController({
      disableRequestLogging: (request) => request.url.startsWith('/health'),
    }),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  // The error handler goes first so every later plugin and route inherits it.
  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin, { env });
  await app.register(databasePlugin, { url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX });

  await app.register(healthRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
