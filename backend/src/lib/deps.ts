import type { FastifyBaseLogger } from 'fastify';

import type { Env } from '../config/env.js';
import type { Database } from '../db/client.js';
import type { ArcGateway } from '../integrations/arc/index.js';
import type { ArkivGateway } from '../integrations/arkiv/index.js';
import type { AuthVerifier } from '../integrations/privy/index.js';
import type { Infer } from '../integrations/zero-g.js';
import type { FormationRunner } from '../services/formation-runs.js';

/** External services. Null or failing ones each have a documented degraded mode. */
export interface Integrations {
  auth: AuthVerifier | null;
  infer: Infer;
  arkiv: ArkivGateway | null;
  arc: ArcGateway | null;
}

export interface Deps extends Omit<Integrations, 'infer'> {
  /** The Formation Engine, with each inference recorded in model_runs. */
  formation: FormationRunner;
  db: Database;
  env: Env;
  log: FastifyBaseLogger;
}
