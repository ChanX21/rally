import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { intents } from '../src/db/schema/index.js';
import { createHarness, type Harness, hoursFromNow } from './helpers/harness.js';

let h: Harness;
beforeEach(async () => { await h?.close(); h = await createHarness(); });
afterAll(() => h?.close());

it.each([
  ['duration', '3', '30'], ['duration', '3.5', '30'],
  ['group_size', '1', '2'], ['group_size', '13', '2'],
])('rejects invalid %s=%s before spending the reparse and permits a corrected answer', async (questionId, invalid, valid) => {
  const host = await h.onboarded('did:answers:host', { optInMatching: false });
  h.ai.respond = () => ({ schemaVersion: 1, status: 'needs_answers', questionIds: [questionId] });
  const parsed = await host.post('/intents/parse', { text: 'Lunch with a few people' });
  const rejected = await host.request('POST', `/intents/${parsed.intent.id}/answers`, { answers: [{ questionId, answer: invalid }] });
  expect(rejected.statusCode).toBe(422);
  expect(rejected.json().error.code).toBe('INVALID_ANSWER');
  expect(h.ai.callsFor('intent')).toHaveLength(1);
  const [draft] = await h.app.deps.db.select().from(intents).where(eq(intents.id, parsed.intent.id));
  expect(draft?.parseAttempts).toBe(1);
  h.ai.respond = () => ({ schemaVersion: 1, status: 'ready', intent: { categoryId: 'food', goal: 'Lunch together',
    startAt: hoursFromNow(2), durationMin: 30, groupMin: 2, groupMax: 2, zoneId: 'venue-floor-1', vibe: 'any' } });
  const corrected = await host.post(`/intents/${parsed.intent.id}/answers`, { answers: [{ questionId, answer: valid }] });
  expect(corrected.status).toBe('ready');
  expect(h.ai.callsFor('intent')).toHaveLength(2);
});
