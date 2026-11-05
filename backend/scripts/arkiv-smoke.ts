// Checks the Arkiv integration against the real network.
//   npm run arkiv:smoke            read-only; needs no funds or configuration
//   npm run arkiv:smoke -- --write create, read, patch and delete one test entity; spends tGLM
import { generatePrivateKey } from 'viem/accounts';

import { loadDotEnv } from '../src/config/env.js';
import { createArkivGateway } from '../src/integrations/arkiv/index.js';

loadDotEnv();
const write = process.argv.includes('--write');
const configuredKey = process.env.ARKIV_PRIVATE_KEY || undefined;
if (write && !configuredKey) {
  console.error('--write needs ARKIV_PRIVATE_KEY set to a funded testnet key.');
  process.exit(1);
}

const app = process.env.ARKIV_APP || 'rally-mumbai';
const event = process.env.ARKIV_EVENT || 'ethglobal-mumbai-2026';
const gateway = createArkivGateway({
  // Reads need an owner to filter by. A throwaway key is never funded and signs nothing.
  privateKey: configuredKey ?? generatePrivateKey(),
  accessKey: process.env.ARKIV_ACCESS_KEY || undefined,
  rpcUrl: process.env.ARKIV_RPC_URL || undefined,
  app,
  event,
  schemaName: process.env.ARKIV_SCHEMA_NAME || 'rally-mumbai.activity.v1',
  queryTimeoutMs: 15_000,
})!;

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    console.log(`ok    ${name} (${Date.now() - startedAt} ms)`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.error(`FAIL  ${name} (${Date.now() - startedAt} ms): ${message}`);
    process.exit(1);
  }
}

for (const limit of [40, 100]) {
  const { listings } = await step(`query, limit ${limit}`, () => gateway.queryListings({ limit }));
  console.log(`      ${listings.length} listing(s)`);
}
await step('query by opaque ID', () => gateway.findByOpaqueId('rly_smoke_absent'));

if (write) {
  const opaqueId = `rly_smoke_${Date.now()}`;
  const { entityKey, txHash } = await step('create', () =>
    gateway.createListing(
      {
        app,
        event: `${event}-smoke`,
        opaqueId,
        category: 'food',
        zone: 'venue-nearby',
        startBucket: new Date().toISOString().slice(0, 13),
        neededRole: 'participant',
        openSeats: 2,
        minGroupSize: 2,
        status: 'open',
      },
      new Date(Date.now() + 3_600_000),
    ),
  );
  console.log(`      entity ${entityKey}\n      tx ${txHash}`);

  const found = await step('read back', () => gateway.findByOpaqueId(opaqueId));
  console.log(`      found: ${found?.entityKey === entityKey}`);
  await step('patch', () =>
    gateway.updateListing(entityKey, {
      category: 'food',
      zone: 'venue-nearby',
      startBucket: new Date().toISOString().slice(0, 13),
      neededRole: 'participant',
      openSeats: 1,
      minGroupSize: 2,
      status: 'filling',
    }),
  );
  await step('extend', () => gateway.extendListing(entityKey, new Date(Date.now() + 7_200_000)));
  await step('delete', () => gateway.deleteListing(entityKey));
}

console.log('done');
