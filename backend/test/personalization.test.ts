import { afterAll, beforeEach, expect, it } from 'vitest';
import { createHarness, type Harness, hoursFromNow } from './helpers/harness.js';
import { compositionInput } from '../src/schemas/formation.js';

let h: Harness;
beforeEach(async () => { await h?.close(); h = await createHarness(); });
afterAll(() => h.close());

it('offers different interest-specific questionnaires, including when AI is unavailable', async () => {
  const user = await h.user('did:personal:questions');
  const a = await user.post('/onboarding/questions', { interests: ['gaming', 'build', 'workshop'] });
  const b = await user.post('/onboarding/questions', { interests: ['food', 'coffee', 'explore'] });
  expect(a.questions.map((q: {id: string}) => q.id)).toEqual(['gaming_game', 'build_role', 'workshop_topic']);
  expect(b.questions.map((q: {id: string}) => q.id)).toEqual(['food_style', 'coffee_energy', 'explore_range']);
  expect(a.source).toBe('fallback');
  expect(a.questions[0].options.some((o: {value: string}) => o.value === 'chess')).toBe(true);
});

it('persists structured answers as preferences and declared roles without frontend duplication', async () => {
  const user = await h.user('did:personal:profile');
  const data = await user.post('/onboarding/complete', {
    interests: ['gaming', 'build', 'coffee'], optInMatching: false,
    answers: [{ questionId: 'gaming_game', answer: 'chess' }, { questionId: 'build_role', answer: 'reviewer' }, { questionId: 'coffee_energy', answer: 'quiet' }],
  });
  expect(data.profile.preferences).toMatchObject({ gaming_game: 'chess', build_role: 'reviewer', coffee_energy: 'quiet' });
  expect(data.profile.declaredSkills).toContain('reviewer');
});

it('rejects invented option values and unrelated interest answers', async () => {
  const user = await h.user('did:personal:invalid');
  for (const answer of ['invented', 'chess']) {
    const result = await user.request('POST', '/onboarding/complete', { interests: ['food', 'coffee', 'explore'], optInMatching: false, answers: [{ questionId: 'gaming_game', answer }] });
    expect(result.statusCode).toBe(422);
  }
});

it('passes only structured profile context to parsing, and saves activity answers in the ready draft', async () => {
  const user = await h.onboarded('did:personal:context', { interests: ['gaming', 'build', 'food'], displayName: 'PRIVATE NAME', preferences: { gaming_game: 'chess', private_note: 'SECRET' } });
  h.ai.respond = () => ({ schemaVersion: 1, status: 'needs_answers', questionIds: ['gaming_game'] });
  const first = await user.post('/intents/parse', { text: 'A gaming Rally; which game is undecided.' });
  expect(first.intent.questions[0]).toMatchObject({ id: 'gaming_game', text: 'Which game is this Rally for?' });
  const sent = JSON.stringify(h.ai.callsFor('intent')[0]!.input);
  expect(sent).toContain('chess');
  expect(sent).not.toMatch(/PRIVATE NAME|SECRET|did:personal/);
  h.ai.respond = () => ({ schemaVersion: 1, status: 'ready', intent: { categoryId: 'gaming', goal: 'Play Valorant', startAt: hoursFromNow(1), durationMin: 45, groupMin: 2, groupMax: 2, zoneId: 'venue-nearby', vibe: 'chatty', preferences: { gaming_game: 'chess' } } });
  const ready = await user.post(`/intents/${first.intent.id}/answers`, { answers: [{ questionId: 'gaming_game', answer: 'valorant' }] });
  expect(ready.intent.preferences).toEqual({ gaming_game: 'valorant' });
  expect(ready.status).toBe('ready');
});

it('uses preferences in candidate filtering and blocks a conflict introduced after an offer', async () => {
  const host = await h.onboarded('did:personal:host', { optInMatching: false });
  const chess = await h.onboarded('did:personal:chess', { preferences: { gaming_game: 'chess' } });
  const other = await h.onboarded('did:personal:valorant', { preferences: { gaming_game: 'valorant' } });
  const rally = await h.rally(host, { category: 'gaming', capacity: 2, preferences: { gaming_game: 'chess' } });
  await h.drainOutbox();
  expect((await other.get('/matches')).matches).toHaveLength(0);
  const match = (await chess.get('/matches')).matches[0];
  expect(match.rally.id).toBe(rally.id);
  const call = compositionInput.parse({ ...(h.ai.callsFor('composition')[0]!.input as object), requestId: 'test' });
  expect(call.rally.intent.preferences).toEqual({ gaming_game: 'chess' });
  expect(call.candidates).toHaveLength(1);
  expect(call.candidates[0]!.preferences).toMatchObject({ gaming_game: 'chess' });
  await chess.patch('/me/profile', { preferences: { gaming_game: 'valorant' } });
  const response = await chess.request('POST', `/matches/${match.id}/respond`, { response: 'accept' });
  expect(response.statusCode).toBe(409);
  expect(response.json().error.code).toBe('MATCH_NO_LONGER_ELIGIBLE');
});


it('uses explicit waiting-intent preferences over profile defaults through acceptance', async () => {
  const host = await h.onboarded('did:personal:waiting-host', { optInMatching: false });
  const guest = await h.onboarded('did:personal:waiting-guest', { preferences: { gaming_game: 'valorant' } });
  const draft = await guest.post('/intents/parse', { text: 'gaming' });
  await guest.post(`/intents/${draft.intent.id}/activate`, {
    category: 'gaming', windowStart: hoursFromNow(0), windowEnd: hoursFromNow(6), durationMin: 45,
    preferences: { gaming_game: 'chess' },
  });
  const rally = await h.rally(host, { category: 'gaming', capacity: 2, preferences: { gaming_game: 'chess' } });
  await h.drainOutbox();
  const match = (await guest.get('/matches')).matches[0];
  expect(match.rally.id).toBe(rally.id);
  const result = await guest.post(`/matches/${match.id}/respond`, { response: 'accept' });
  expect(result.status).toBe('accepted');
});


it('prefills the editable fallback with a relevant saved preference', async () => {
  const user = await h.onboarded('did:personal:fallback', { preferences: { coffee_energy: 'quiet' } });
  const result = await user.post('/intents/parse', { text: 'coffee now' });
  expect(result.status).toBe('needs_review');
  expect(result.intent.preferences).toEqual({ coffee_energy: 'quiet' });
});
