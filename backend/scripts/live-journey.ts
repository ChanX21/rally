// Runs the whole product flow against the real 0G and Arkiv networks, on a throwaway local database.
// Only login is simulated. Spends small amounts of 0G balance and tGLM.
//   npm run smoke:journey
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { desc, eq } from 'drizzle-orm';
import EmbeddedPostgres from 'embedded-postgres';

import { buildApp } from '../src/app.js';
import { loadDotEnv, parseEnv } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrate.js';
import { arkivEntities, modelRuns, outboxEvents } from '../src/db/schema/index.js';
import { processOutboxBatch } from '../src/workers/outbox.js';

loadDotEnv();
const port = 54391;
const directory = await mkdtemp(join(tmpdir(), 'rally-journey-'));
const postgres = new EmbeddedPostgres({
  databaseDir: directory,
  port,
  user: 'postgres',
  password: 'postgres',
  persistent: false,
  autoRehydrateSymlinks: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
  onLog: () => {},
});
await postgres.initialise();
await postgres.start();
await postgres.createDatabase('journey');
const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/journey`;
await runMigrations(databaseUrl);

const env = parseEnv({
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',
  DATABASE_URL: databaseUrl,
  // A separate tag keeps these listings out of real discovery results.
  ARKIV_EVENT: `${process.env.ARKIV_EVENT || 'ethglobal-mumbai-2026'}-smoke`,
  ZG_TIMEOUT_MS: '60000',
});
const app = await buildApp({
  env,
  integrations: {
    auth: {
      verify: (token) => Promise.resolve({ did: token }),
      getWallet: () => Promise.resolve(null),
    },
  },
});
await app.ready();

type Body = { data: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(user: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) {
  const response = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${user}` },
    ...(payload ? { payload } : {}),
  });
  if (response.statusCode !== 200) throw new Error(`${method} ${url}: ${response.body}`);
  return response.json<Body>().data;
}

async function drain() {
  while ((await processOutboxBatch(app.deps)) > 0) {
    /* run everything that is due */
  }
  const stuck = await app.deps.db
    .select({ type: outboxEvents.type, error: outboxEvents.lastError, attempts: outboxEvents.attempts })
    .from(outboxEvents)
    .where(eq(outboxEvents.status, 'pending'));
  if (stuck.length > 0) throw new Error(`Events did not complete: ${JSON.stringify(stuck)}`);
}

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const latestRun = async (task: string) => {
  const [run] = await app.deps.db
    .select()
    .from(modelRuns)
    .where(eq(modelRuns.task, task))
    .orderBy(desc(modelRuns.createdAt))
    .limit(1);
  return run;
};
const showRun = (label: string, run: Awaited<ReturnType<typeof latestRun>>) =>
  console.log(
    `  0G ${label}: outcome=${run?.outcome} request=${run?.requestId} model=${run?.model} ` +
      `latency=${run?.latencyMs}ms cost=${run?.cost}` +
      (run?.failureReason ? ` reason=${run.failureReason}` : ''),
  );

let failed = false;
try {
  console.log('1. Joiner signs in and onboards');
  await call('did:journey:joiner', 'POST', '/auth/session');
  const questions = await call('did:journey:joiner', 'POST', '/onboarding/questions', {
    interests: ['food', 'coffee', 'gaming'],
  });
  console.log(`  questions (${questions.source}):`, questions.questions.map((q: { text: string }) => q.text));
  showRun('questions', await latestRun('onboarding_questions'));
  await call('did:journey:joiner', 'POST', '/onboarding/complete', {
    displayName: 'Joiner',
    interests: ['food', 'coffee', 'gaming'],
    answers: [],
    optInMatching: true,
    availableFrom: hours(-1),
    availableTo: hours(8),
  });
  await drain();

  console.log('2. Host describes an activity');
  await call('did:journey:host', 'POST', '/auth/session');
  await call('did:journey:host', 'POST', '/onboarding/complete', {
    displayName: 'Host',
    interests: ['food', 'build', 'explore'],
    optInMatching: false,
  });
  const parsed = await call('did:journey:host', 'POST', '/intents/parse', {
    text: 'Anyone up for a late snack run near the venue in about an hour? Chatty group of 2 to 4.',
  });
  console.log('  intent:', {
    source: parsed.intent.source,
    needsReview: parsed.needsReview,
    category: parsed.intent.category,
    goal: parsed.intent.goal,
    from: parsed.intent.windowStart,
    zone: parsed.intent.zone,
    group: [parsed.intent.groupMin, parsed.intent.groupMax],
    questions: parsed.intent.questions.map((q: { text: string }) => q.text),
  });
  showRun('intent', await latestRun('parse_intent'));

  console.log('3. Host approves the plan; Arkiv listing and matching run after commit');
  const rally = await call('did:journey:host', 'POST', '/rallies', {
    intentId: parsed.intent.id,
    category: parsed.intent.category ?? 'food',
    goal: parsed.intent.goal,
    windowStart: hours(1),
    windowEnd: hours(4),
    durationMin: 45,
    zone: parsed.intent.zone ?? 'venue-nearby',
    groupMin: 2,
    capacity: 3,
    publish: true,
  });
  await drain();
  const [entity] = await app.deps.db
    .select()
    .from(arkivEntities)
    .where(eq(arkivEntities.rallyId, rally.id));
  console.log(`  Arkiv entity=${entity?.entityKey}\n  Arkiv tx=${entity?.lastTxHash} sync=${entity?.syncStatus}`);
  const relayerListing = await app.deps.arkiv?.findByOpaqueId(rally.opaqueId);
  console.log('  public listing:', relayerListing);
  const preview = await app.inject({ url: `/activities/preview?category=${rally.category}` });
  const previewBody = preview.json<Body>().data;
  console.log('  preview:', { available: previewBody.available, activities: previewBody.activities });

  console.log('4. Joiner is matched');
  const { matches } = await call('did:journey:joiner', 'GET', '/matches');
  console.log('  match:', { source: matches[0]?.source, reason: matches[0]?.reason, status: matches[0]?.status });
  showRun('composition', await latestRun('compose_group'));
  if (!matches[0]) throw new Error('No match was proposed');

  console.log('5. Joiner accepts; host sets the meeting point; room unlocks');
  await call('did:journey:joiner', 'POST', `/matches/${matches[0].id}/respond`, { response: 'accept' });
  const ready = await call('did:journey:host', 'GET', `/rallies/${rally.id}`);
  console.log(`  status=${ready.status} openSeats=${ready.openSeats} (from PostgreSQL)`);
  const formed = await call('did:journey:host', 'PATCH', `/rallies/${rally.id}`, {
    expectedVersion: ready.version,
    meetingPoint: 'Food court, north entrance',
  });
  console.log(`  status=${formed.status}`);
  const room = await call('did:journey:joiner', 'GET', `/rallies/${rally.id}/room`);
  console.log(`  room members=${room.members.length} meetingPoint present=${Boolean(room.meetingPoint)}`);
  await drain();
  const synced = await app.deps.arkiv?.findByOpaqueId(rally.opaqueId);
  console.log(`  listing now openSeats=${synced?.openSeats} status=${synced?.status}`);
  if (synced && JSON.stringify(synced).includes('Food court')) throw new Error('Meeting point leaked');

  console.log('6. They meet; feedback completes it; listing is removed');
  const joinerId = room.members.find((m: { role: string }) => m.role !== 'host').userId;
  const hostId = room.members.find((m: { role: string }) => m.role === 'host').userId;
  await call('did:journey:host', 'POST', `/rallies/${rally.id}/check-in`, { presentUserIds: [joinerId] });
  const feedback = await call('did:journey:joiner', 'POST', `/rallies/${rally.id}/feedback`, {
    happened: true,
    vouches: [{ recipientId: hostId, contribution: 'Found the best snack place' }],
  });
  console.log(`  status=${feedback.rallyStatus} vouch=${feedback.vouches[0]?.verification}`);
  await drain();
  const rewards = await call('did:journey:host', 'GET', '/me/rewards');
  console.log(`  host points=${rewards.balance}`);
  console.log(`  listing after completion: ${JSON.stringify(await app.deps.arkiv?.findByOpaqueId(rally.opaqueId))}`);
  console.log('JOURNEY PASSED');
} catch (error) {
  failed = true;
  console.error('JOURNEY FAILED:', error instanceof Error ? error.message : error);
} finally {
  await app.close();
  await postgres.stop();
  await rm(directory, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
