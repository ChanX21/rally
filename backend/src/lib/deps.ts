import type { FastifyBaseLogger } from 'fastify';

import type { Env } from '../config/env.js';
import type { Database } from '../db/client.js';
import type { ArkivGateway } from '../integrations/arkiv/index.js';
import type { AuthVerifier } from '../integrations/privy/index.js';
import type { AiProvider } from '../integrations/zerog/index.js';

/** External services are null when unconfigured; each caller has a documented degraded mode. */
export interface Integrations {
  auth: AuthVerifier | null;
  ai: AiProvider | null;
  arkiv: ArkivGateway | null;
}

export interface Deps extends Integrations {
  db: Database;
  env: Env;
  log: FastifyBaseLogger;
}
