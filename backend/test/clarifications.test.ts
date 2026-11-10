import { afterAll, beforeEach, expect, it } from 'vitest';
import { explicitStart, parseIntentFallback } from '../src/domain/intent-fallback.js';
import { knownIntentSchema } from '../src/schemas/formation.js';
import { createHarness, type Harness } from './helpers/harness.js';

let h: Harness;
beforeEach(async () => { await h?.close(); h = await createHarness(); });
afterAll(() => h?.close());

it('keeps the explicit carrom game and relative start, removing only redundant questions', async () => {
  const host = await h.onboarded('did:clarify:carrom', { optInMatching: false });
  h.ai.respond = () => ({ schemaVersion: 1, status: 'needs_answers', questionIds: ['gaming_game', 'start_time', 'duration'],
    intent: { categoryId: 'gaming', preferences: { custom_gaming: 'Carrom' } } });
  const before = Date.now();
  const first = await host.post('/intents/parse', { text: 'make a rally of carrom boords 17 mins from now' });
  expect(first.status).toBe('needs_answers');
  expect(first.intent.questions.map((question: { id: string }) => question.id)).toEqual(['duration']);
  expect(Date.parse(first.intent.windowStart) - before).toBeGreaterThanOrEqual(17 * 60000);
  expect(Date.parse(first.intent.windowStart) - before).toBeLessThan(17 * 60000 + 5000);
  expect(first.intent.durationMin).toBeNull();
  expect(first.intent.preferences).toEqual({ custom_gaming: 'Carrom' });
  h.ai.respond = () => ({ schemaVersion: 1, status: 'ready', intent: { categoryId: 'gaming', goal: 'Carrom together',
    startAt: new Date(Date.now() + 40 * 60000).toISOString(), durationMin: 30, zoneId: 'venue-floor-1', vibe: 'any' } });
  const second = await host.post(`/intents/${first.intent.id}/answers`, { answers: [{ questionId: 'duration', answer: '30' }] });
  expect(second.status).toBe('ready');
  expect(second.intent.windowStart).toBe(first.intent.windowStart);
  expect(second.intent.preferences.custom_gaming).toBe('Carrom');
  expect((h.ai.callsFor('intent')[1]!.input as { knownIntent: { startAt: string } }).knownIntent.startAt).toBe(first.intent.windowStart);
});

it('goes straight to confirmation if only already-known details were requested', async () => {
  const host = await h.onboarded('did:clarify:complete', { optInMatching: false });
  h.ai.respond = ({ input }) => ({ schemaVersion: 1, status: 'needs_answers', questionIds: ['gaming_game', 'start_time', 'duration'],
    intent: { categoryId: 'gaming', goal: 'Carrom together', startAt: (input as { knownIntent: { startAt: string } }).knownIntent.startAt,
      durationMin: 30, groupMin: 2, groupMax: 2, zoneId: 'venue-floor-1', vibe: 'any', preferences: { custom_gaming: 'Carrom' } } });
  const result = await host.post('/intents/parse', { text: 'Carrom 17 mins from now for 30 minutes at venue-floor-1, two of us' });
  expect(result.status).toBe('ready');
  expect(result.intent.questions).toEqual([]);
  expect(result.intent.durationMin).toBe(30);
  expect((await host.get('/rallies')).items).toEqual([]);
});

it('redacts retained facts before sending them back to the model', async () => {
  const host = await h.onboarded('did:clarify:privacy', { optInMatching: false });
  await host.post('/intents/parse', { text: 'Carrom with me at private@example.com in 17 minutes' });
  const sent = JSON.stringify(h.ai.callsFor('intent')[0]!.input);
  expect(sent).not.toContain('private@example.com');
  expect(sent).toContain('[email]');
});

it('does not invent group bounds in a partial extraction', () => {
  expect(knownIntentSchema.parse({})).toEqual({});
});

it.each(['in 17 minutes', '17 mins from now', 'in 17 mins for 30 minutes'])('resolves %s without confusing start and duration', (text) => {
  const now = new Date('2026-11-06T10:00:00Z');
  expect(explicitStart(text, now)?.toISOString()).toBe('2026-11-06T10:17:00.000Z');
  expect(explicitStart('for 17 minutes', now)).toBeNull();
  expect(explicitStart('in 2 hours', now)?.toISOString()).toBe('2026-11-06T12:00:00.000Z');
  expect(parseIntentFallback('carrom boords', now).category).toBe('gaming');
});


it.each([
  ['Cricekt tomorrow at 3 PM', '2026-11-11T09:30:00.000Z'],
  ['Cricket on 12th Nov at 3:05 PM', '2026-11-12T09:35:00.000Z'],
  ['Cricket on 2026-12-12 at 16:00', '2026-12-12T10:30:00.000Z'],
  ['Cricket today at 12 AM', '2026-11-09T18:30:00.000Z'],
])('preserves the explicit local cricket start: %s', (text, expected) => {
  expect(explicitStart(text, new Date('2026-11-10T06:00:00Z'), 'Asia/Kolkata')?.toISOString()).toBe(expected);
  expect(parseIntentFallback(text, new Date(), 'Asia/Kolkata').category).toBe('gaming');
});

it('retains a specified cricket date when the AI fails, without a random suggested time', async () => {
  const host = await h.onboarded('did:cricket:fallback', { optInMatching: false });
  h.ai.respond = () => { throw new Error('offline'); };
  const date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const result = await host.post('/intents/parse', { text: `Cricket on ${date} at 3 PM`, timeZone: 'Asia/Kolkata' });
  expect(result.startTimeConfirmed).toBe(true);
  expect(result.intent.windowStart).toBe(`${date}T09:30:00.000Z`);
  expect(result.intent.category).toBe('gaming');
});

it('does not guess an unspecified date or accept impossible dates', () => {
  const now = new Date('2026-11-10T06:00:00Z');
  expect(explicitStart('Cricket at 3 PM', now, 'Asia/Kolkata')).toBeNull();
  expect(explicitStart('Cricket on 31 February at 3 PM', now, 'Asia/Kolkata')).toBeNull();
});


it('allows creating a rally next month but rejects starts beyond 60 days', async () => {
  const host = await h.onboarded('did:future:host', { optInMatching: false });
  const start = new Date(Date.now() + 45 * 86400000);
  const rally = await h.rally(host, { windowStart: start.toISOString(), windowEnd: new Date(start.getTime() + 3600000).toISOString() });
  expect(Date.parse(rally.windowStart)).toBe(start.getTime());
  const tooFar = new Date(Date.now() + 61 * 86400000);
  const response = await host.request('POST', '/rallies', { goal: 'Cricket', category: 'gaming', zone: 'venue-floor-1', durationMin: 30, groupMin: 2, capacity: 2, windowStart: tooFar.toISOString(), windowEnd: new Date(tooFar.getTime() + 3600000).toISOString(), vibe: 'any', publish: true });
  expect(response.statusCode).toBe(422);
});
