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
import type { Integrations } from './lib/deps.js';
import { authPlugin } from './plugins/auth.js';
import { databasePlugin } from './plugins/database.js';
import { docsPlugin } from './plugins/docs.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { createIntegrations, integrationsPlugin } from './plugins/integrations.js';
import { securityPlugin } from './plugins/security.js';
import { healthRoutes } from './routes/health.js';
import { intentRoutes } from './routes/intents.js';
import { matchRoutes } from './routes/matches.js';
import { miscRoutes } from './routes/misc.js';
import { rallyRoutes } from './routes/rallies.js';
import { userRoutes } from './routes/users.js';

const REQUEST_ID_PATTERN = /^[\w-]{8,64}$/;

/** Keeps a well-formed caller-supplied ID for tracing. Anything else gets a fresh one. */
function requestId(request: IncomingMessage): string {
  const supplied = request.headers['x-request-id'];
  return typeof supplied === 'string' && REQUEST_ID_PATTERN.test(supplied)
    ? supplied
    : randomUUID();
}

export interface BuildOptions {
  env: Env;
  /** Tests replace external services. Omitted ones are built from the environment. */
  integrations?: Partial<Integrations>;
}

export async function buildApp({ env, integrations }: BuildOptions) {
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

  await app.register(integrationsPlugin, {
    env,
    integrations: { ...createIntegrations(env), ...integrations },
  });
  await app.register(authPlugin);
  await app.register(docsPlugin);

  await app.register(healthRoutes);
  await app.register(userRoutes);
  await app.register(intentRoutes);
  await app.register(rallyRoutes);
  await app.register(matchRoutes);
  await app.register(miscRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
