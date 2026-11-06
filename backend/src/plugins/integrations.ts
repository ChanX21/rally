import fp from 'fastify-plugin';

import type { Env } from '../config/env.js';
import { createArcGateway } from '../integrations/arc/index.js';
import { createArkivGateway } from '../integrations/arkiv/index.js';
import { createPrivyVerifier } from '../integrations/privy/index.js';
import { createZeroG } from '../integrations/zero-g.js';
import type { Deps, Integrations } from '../lib/deps.js';
import { createFormationRunner } from '../services/formation-runs.js';

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
  }
}

export function createIntegrations(env: Env): Integrations {
  return {
    auth:
      env.PRIVY_APP_ID && env.PRIVY_APP_SECRET
        ? createPrivyVerifier({
            appId: env.PRIVY_APP_ID,
            appSecret: env.PRIVY_APP_SECRET,
            verificationKey: env.PRIVY_VERIFICATION_KEY,
          })
        : null,
    infer: createZeroG(env),
    visionInfer: createZeroG({ ...env, ZERO_G_MODEL: env.ZERO_G_VISION_MODEL, AI_MAX_OUTPUT_TOKENS: 1000 }),
    arkiv: createArkivGateway({
      privateKey: env.ARKIV_PRIVATE_KEY,
      accessKey: env.ARKIV_ACCESS_KEY,
      rpcUrl: env.ARKIV_RPC_URL,
      app: env.ARKIV_APP,
      event: env.ARKIV_EVENT,
      schemaName: env.ARKIV_SCHEMA_NAME,
      queryTimeoutMs: env.ARKIV_QUERY_TIMEOUT_MS,
    }),
    arc:
      env.ARC_LEDGER_ENABLED &&
      env.ARC_RPC_URL &&
      env.ARC_CHAIN_ID &&
      env.ARC_LEDGER_ADDRESS &&
      env.ARC_RELAYER_PRIVATE_KEY
        ? createArcGateway({
            rpcUrl: env.ARC_RPC_URL,
            chainId: env.ARC_CHAIN_ID,
            ledgerAddress: env.ARC_LEDGER_ADDRESS,
            privateKey: env.ARC_RELAYER_PRIVATE_KEY,
          })
        : null,
  };
}

export const integrationsPlugin = fp<{ env: Env; integrations: Integrations }>(
  (app, { env, integrations }, done) => {
    const { infer, visionInfer, ...services } = integrations;
    app.decorate('deps', {
      ...services,
      db: app.db,
      env,
      log: app.log,
      formation: createFormationRunner(infer, app.db, app.log, visionInfer),
    });
    done();
  },
  { dependencies: ['database'], name: 'integrations' },
);
