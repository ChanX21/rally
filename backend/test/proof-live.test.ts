import { writeFile } from 'node:fs/promises';
import { afterAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../src/config/env.js';
import { modelRuns } from '../src/db/schema/index.js';
import { createZeroG } from '../src/integrations/zero-g.js';
import { completeDueRallies } from '../src/services/completion.js';
import { createFormationRunner } from '../src/services/formation-runs.js';
import { assessProof } from '../src/services/proofs.js';
import { createHarness, type Harness } from './helpers/harness.js';
import { formedGroup, setMeetAt } from './helpers/rewards.js';

let h: Harness | undefined;
afterAll(async () => h?.close());

it.skipIf(process.env.RUN_LIVE_PROOF !== 'true')('proves public photo -> real 0G -> rewards for a synthetic group', async () => {
  h = await createHarness({ PROOFS_ENABLED: 'true' });
  const { host, member, rally } = await formedGroup(h, {}, { goal: 'Share a meal together' });
  await setMeetAt(h, rally.id, -90);
  await completeDueRallies(h.app.deps);
  const env = loadEnv();
  const vision = createZeroG({ ...env, ZERO_G_MODEL: env.ZERO_G_VISION_MODEL, AI_MAX_OUTPUT_TOKENS: 1000 });
  h.app.deps.formation = createFormationRunner(createZeroG(env), h.app.deps.db, h.app.log, vision);
  const response = await fetch('https://www.nasa.gov/wp-content/uploads/2023/03/hera-crew-mealtime.jpg', { signal: AbortSignal.timeout(20000) });
  expect(response.ok).toBe(true);
  const image = Buffer.from(await response.arrayBuffer());
  const proof = await host.post(`/rallies/${rally.id}/proof`, { images: [`data:image/jpeg;base64,${image.toString('base64')}`] }, { 'idempotency-key': 'live-synthetic-group-proof' });
  await assessProof(h.app.deps, proof.id);
  const final = await member.get(`/rallies/${rally.id}/proof`);
  expect(final.state).toBe('accepted');
  const balances = await Promise.all([host.get('/me/rewards'), member.get('/me/rewards')]);
  expect(balances.map((r) => r.balance)).toEqual([10, 10]);
  await assessProof(h.app.deps, proof.id);
  const calls = await h.app.deps.db.select({ model: modelRuns.model, requestId: modelRuns.requestId, tokens: modelRuns.totalTokens, cost: modelRuns.cost, outcome: modelRuns.outcome }).from(modelRuns).where(eq(modelRuns.task, 'proof'));
  expect(calls).toHaveLength(1);
  const evidence = { at: new Date().toISOString(), scope: 'Public NASA fixture, real 0G, isolated throwaway database, synthetic login/group, no production users or chain writes',
    fixture: 'https://www.nasa.gov/image-article/hera-crew-members-enjoy-meal-together/', status: final.state, participantsRewarded: final.rewardedCount,
    pointsPerParticipant: final.rewardAmount, duplicateWorkerDidNotPayAgain: true, calls };
  await writeFile('evidence/proof-full-flow-live-2026-11-06.json', `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
}, 120000);
