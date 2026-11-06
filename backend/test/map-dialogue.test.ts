import { afterAll, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createFormationEngine } from '../src/services/formation.js';
import { dialogueKey, generateMapDialogue } from '../src/services/map-dialogue.js';
import { outboxEvents, modelRuns } from '../src/db/schema/index.js';
import { createHarness, type Harness } from './helpers/harness.js';

const raw = { requestId: 'test', title: 'Rally for coffee', category: 'coffee' as const };
it('generates original dialogue through inference with only redacted title context', async () => {
  let sent: unknown;
  const engine = createFormationEngine(async (_system, input) => {
    sent = input;
    return { text: JSON.stringify({ schemaVersion: 1, dialogue: 'Seeking a co-founder for my next coffee break.' }), model: 'fixture' };
  });
  expect(await engine.generateMapDialogue({ ...raw, title: 'Coffee; email coffee@example.com' }))
    .toEqual({ schemaVersion: 1, dialogue: 'Seeking a co-founder for my next coffee break.' });
  expect(sent).toEqual({ title: 'Coffee; email [email]', category: 'coffee' });
});
it.each(['', 'x'.repeat(81), 'Email me at coffee@example.com', 'Go to https://example.com', 'Call +919876543210', 'Two\nlines', 'Hello [email]'])('rejects invalid or identifying public output: %s', async (dialogue) => {
  const engine = createFormationEngine(async () => ({ text: JSON.stringify({ schemaVersion: 1, dialogue }), model: 'fixture' }));
  expect(await engine.generateMapDialogue(raw)).toEqual({ status: 'invalid_output' });
});

let h: Harness;
beforeEach(async () => { await h?.close(); h = await createHarness(); });
afterAll(() => h?.close());

it('generates once per published title and reuses the cached AI output on previews and job replay', async () => {
  const host = await h.onboarded('did:dialogue:cache-host', { optInMatching: false });
  h.ai.respond = () => ({ schemaVersion: 1, dialogue: 'A brew-tiful excuse to meet someone new.' });
  const rally = await h.rally(host, { category: 'coffee', goal: 'Coffee at the event' });
  await h.drainOutbox();
  const preview = () => h.app.inject({ url: '/activities/preview' });
  expect((await preview()).json().data.activities[0].dialogue).toBe('A brew-tiful excuse to meet someone new.');
  await preview();
  await generateMapDialogue(h.app.deps, rally.id, dialogueKey({ id: rally.id, goal: rally.goal, category: rally.category }));
  expect(h.ai.callsFor('map_dialogue')).toHaveLength(1);
  const [trace] = await h.app.deps.db.select().from(modelRuns).where(eq(modelRuns.task, 'map_dialogue'));
  expect(trace).toMatchObject({ outcome: 'ok', model: 'fake-model' });
});

it('does not run inference for private Rallies or show canned text when generation fails', async () => {
  const host = await h.onboarded('did:dialogue:failure-host', { optInMatching: false });
  await h.rally(host, { visibility: 'private' });
  await h.drainOutbox();
  expect(h.ai.callsFor('map_dialogue')).toHaveLength(0);
  await h.rally(host, { category: 'coffee', windowStart: new Date(Date.now() + 5 * 3600000).toISOString(), windowEnd: new Date(Date.now() + 6 * 3600000).toISOString() });
  await h.drainOutbox();
  const response = await h.app.inject({ url: '/activities/preview' });
  expect(response.statusCode).toBe(200);
  expect(response.json().data.activities[0].dialogue).toBeNull();
  const before = h.ai.callsFor('map_dialogue').length;
  await h.app.inject({ url: '/activities/preview' });
  expect(h.ai.callsFor('map_dialogue')).toHaveLength(before);
  const jobs = await h.app.deps.db.select().from(outboxEvents).where(eq(outboxEvents.type, 'map.dialogue'));
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.status).toBe('pending');
});

it('backfills existing Rallies after a cache miss without billing on each preview', async () => {
  const host = await h.onboarded('did:dialogue:backfill-host', { optInMatching: false });
  h.ai.respond = () => ({ schemaVersion: 1, dialogue: 'Coffee: the original networking protocol.' });
  const rally = await h.rally(host, { category: 'coffee' });
  await h.drainOutbox();
  const key = dialogueKey({ id: rally.id, goal: rally.goal, category: rally.category });
  await h.app.deps.db.delete(outboxEvents).where(eq(outboxEvents.dedupeKey, key));
  const first = await h.app.inject({ url: '/activities/preview' });
  expect(first.json().data.activities[0].dialogue).toBeNull();
  await h.app.inject({ url: '/activities/preview' });
  expect(h.ai.callsFor('map_dialogue')).toHaveLength(1);
  await h.drainOutbox();
  expect((await h.app.inject({ url: '/activities/preview' })).json().data.activities[0].dialogue)
    .toBe('Coffee: the original networking protocol.');
  expect(h.ai.callsFor('map_dialogue')).toHaveLength(2);
});

it('recovers dialogue jobs claimed by a deployment without the handler', async () => {
  const host = await h.onboarded('did:dialogue:rollout-host', { optInMatching: false });
  const rally = await h.rally(host, { category: 'coffee', goal: 'Coffee break' });
  const key = dialogueKey(rally);
  await h.app.deps.db.update(outboxEvents).set({ status: 'dead', attempts: 1, lastError: 'No handler for map.dialogue' }).where(eq(outboxEvents.dedupeKey, key));
  await h.drainOutbox();
  const preview = () => h.app.inject({ url: '/activities/preview' });
  expect((await preview()).json().data.activities[0].dialogue).toBeNull();
  const [job] = await h.app.deps.db.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, key));
  expect(job).toMatchObject({ status: 'pending', attempts: 0, lastError: null });
  h.ai.respond = () => ({ schemaVersion: 1, dialogue: 'Someone up for coffee?' });
  await h.drainOutbox();
  expect((await preview()).json().data.activities[0].dialogue).toBe('Someone up for coffee?');
  expect(h.ai.callsFor('map_dialogue')).toHaveLength(1);
});
