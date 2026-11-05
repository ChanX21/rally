import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import { createZeroG } from '../integrations/zero-g.js';
import { createFormationEngine, type FormationEngine } from '../services/formation.js';

declare module 'fastify' {
  interface FastifyInstance { formation: FormationEngine }
}

export const formationPlugin = fp<{ env: Env }>((app, { env }, done) => {
  app.decorate('formation', createFormationEngine(createZeroG(env), (trace) => app.log.info(trace, 'formation inference')));
  if (!env.ZERO_G_API_KEY || !env.ZERO_G_MODEL) app.log.warn('AI unavailable: configure ZERO_G_API_KEY and ZERO_G_MODEL');
  done();
});
