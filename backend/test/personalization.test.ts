import { afterAll, beforeEach, expect, it } from 'vitest';
import { createHarness, type Harness, hoursFromNow } from './helpers/harness.js';
import { activityInput, compositionInput } from '../src/schemas/formation.js';
import { relevantPreferences, mergePreferences } from '../src/domain/questions.js';

let h: Harness;
beforeEach(async () => { await h?.close(); h = await createHarness(); });
afterAll(() => h.close());

it('preserves activity preference answers when the reparse falls back', async () => {
  const user = await h.onboarded('did:personal:reparse-fallback', { preferences: { custom_workshop: 'AI' } });
  h.ai.respond = () => ({ schemaVersion: 1, status: 'needs_answers', questionIds: ['workshop_topic'] });
  const first = await user.post('/intents/parse', { text: 'A workshop with someone' });
  h.ai.respond = () => { throw new Error('Provider unavailable'); };
  const result = await user.post(`/intents/${first.intent.id}/answers`, { answers: [{ questionId: 'workshop_topic', answer: 'Candle making' }] });
  expect(result.status).toBe('needs_review');
  expect(result.intent.preferences).toEqual({ custom_workshop: 'Candle making' });
});

it('uses edited free-text notes to retry existing rallies, redacts them, and keeps them private', async () => {
  const host = await h.onboarded('did:notes:host', { optInMatching: false });
  const guest = await h.onboarded('did:notes:guest', { preferences: { matching_notes: 'I prefer Minecraft' } });
  h.ai.respond = ({ input }) => {
    const parsed = compositionInput.parse({ ...(input as object), requestId: 'test' });
    const candidate = parsed.candidates.find((person) => person.preferences?.matching_notes?.includes('Valorant'));
    return candidate ? { schemaVersion: 1, status: 'proposed', memberIds: [...parsed.rally.requiredMembers.map((person) => person.id), candidate.id],
      roles: [{ memberId: candidate.id, roleId: candidate.roleIds[0] }], reason: 'Shared game interest' } : { schemaVersion: 1, status: 'no_fit' };
  };
  const rally = await h.rally(host, { category: 'gaming', capacity: 2, preferences: { gaming_game: 'valorant' } });
  await h.drainOutbox();
  expect((await guest.get('/matches')).matches).toEqual([]);
  await guest.patch('/me/profile', { preferences: { matching_notes: 'I play Valorant. Contact player@example.com' } });
  await h.drainOutbox();
  expect((await guest.get('/matches')).matches[0]).toMatchObject({ status: 'pending', rally: { id: rally.id } });
  const calls = h.ai.callsFor('composition');
  const sent = compositionInput.parse({ ...(calls.at(-1)!.input as object), requestId: 'test' });
  expect(sent.candidates[0]?.preferences?.matching_notes).toBe('I play Valorant. Contact [email]');
  expect(JSON.stringify([...h.arkiv.entities.values()])).not.toMatch(/matching_notes|player@example.com|Minecraft/);
});

it('uses notes as private parsing context without copying them into the activity', async () => {
  const notes = 'I like chess and quiet coffee. Email player@example.com';
  const user = await h.onboarded('did:notes:parse', { preferences: { matching_notes: notes } });
  h.ai.respond = () => ({ schemaVersion: 1, status: 'ready', intent: { categoryId: 'gaming', goal: 'Play chess', startAt: hoursFromNow(1), durationMin: 30, zoneId: 'venue-nearby', vibe: 'quiet', preferences: { matching_notes: notes, gaming_game: 'chess' } } });
  const result = await user.post('/intents/parse', { text: 'Play chess' });
  const sent = activityInput.parse({ ...(h.ai.callsFor('intent')[0]!.input as object), requestId: 'test' });
  expect(sent.profile?.preferences.matching_notes).toBe('I like chess and quiet coffee. Email [email]');
  expect(result.intent.preferences).toEqual({ gaming_game: 'chess' });
});

it('bounds notes and protects preferences appended while the user was editing', async () => {
  const user = await h.onboarded('did:notes:validation');
  const before = await user.get('/me');
  const notes = 'I like building together. '.repeat(100);
  const saved = await user.patch('/me/profile', { preferences: { matching_notes: notes }, expectedProfileVersion: before.profile.version });
  expect(saved.profile.preferences.matching_notes).toBe(notes.trim());
  const stale = await user.request('PATCH', '/me/profile', { preferences: { matching_notes: 'Old draft' }, expectedProfileVersion: before.profile.version });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().error.code).toBe('PROFILE_CHANGED');
  expect((await user.get('/me')).profile.preferences).toEqual(saved.profile.preferences);
  for (const preferences of [{ matching_notes: 'x'.repeat(4001) }, { matching_notes: '   ' }, { custom_gaming: 'x'.repeat(121) }, { private_note: 'x'.repeat(121) }]) {
    expect((await user.request('PATCH', '/me/profile', { preferences })).statusCode).toBe(400);
  }
  const cleared = await user.patch('/me/profile', { preferences: {} });
  expect(cleared.profile.preferences).toEqual({});
});

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

it('shows contextual coffee questions and accepts answers through the existing flow', async () => {
  const user = await h.onboarded('did:personal:coffee-wording', { preferences: { coffee_energy: 'quiet' } });
  h.ai.respond = () => ({ schemaVersion: 1, status: 'needs_answers', questionIds: ['start_time', 'duration', 'distance'] });
  const first = await user.post('/intents/parse', { text: 'Coffee after the 0G workshop' });
  expect(first.intent.questions.map((q: { id: string; text: string }) => [q.id, q.text])).toEqual([
    ['start_time', 'What time does the 0G workshop finish?'],
    ['duration', 'A quick coffee or time to sit and chat—about how many minutes?'],
    ['distance', 'What place or location would you like to meet at?'],
  ]);
  expect((await user.get('/intents')).items[0].questions).toEqual(first.intent.questions);
  h.ai.respond = () => ({ schemaVersion: 1, status: 'ready', intent: {
    categoryId: 'coffee', goal: 'Coffee after the workshop', startAt: hoursFromNow(1),
    durationMin: 30, groupMin: 2, groupMax: 3, zoneId: 'venue-nearby', vibe: 'quiet',
  } });
  const ready = await user.post(`/intents/${first.intent.id}/answers`, { answers: [
    { questionId: 'start_time', answer: hoursFromNow(1) },
    { questionId: 'duration', answer: '30 minutes' },
    { questionId: 'distance', answer: 'A nearby café' },
  ] });
  expect(ready.status).toBe('ready');
  expect(ready.intent.preferences).toEqual({ coffee_energy: 'quiet' });
  expect(h.ai.callsFor('intent')).toHaveLength(2);
});

it('persists tailored jogging questions and completes the same answer flow', async () => {
  const user = await h.onboarded('did:personal:jogging');
  const questionTexts = {
    start_time: 'What day and time would you like to go jogging?',
    duration: 'About how many minutes would you like to jog?',
    group_size: 'One jogging buddy or a small group—how many runners, including you?',
  };
  h.ai.respond = () => ({ schemaVersion: 1, status: 'needs_answers',
    questionIds: Object.keys(questionTexts), questionTexts });
  const first = await user.post('/intents/parse', { text: 'Need someone to go joggin with?' });
  expect(first.status).toBe('needs_answers');
  expect(first.intent.questions).toEqual(Object.entries(questionTexts).map(([id, text]) => ({ id, text })));
  expect((await user.get('/intents')).items[0].questions).toEqual(first.intent.questions);
  h.ai.respond = () => ({ schemaVersion: 1, status: 'ready', intent: {
    categoryId: 'wellness', goal: 'Jog with a buddy', startAt: hoursFromNow(1),
    durationMin: 30, groupMin: 2, groupMax: 2, zoneId: 'venue-nearby', vibe: 'any',
  } });
  const ready = await user.post(`/intents/${first.intent.id}/answers`, { answers: [
    { questionId: 'start_time', answer: hoursFromNow(1) },
    { questionId: 'duration', answer: '30 minutes' },
    { questionId: 'group_size', answer: 'One buddy, two of us total' },
  ] });
  expect(ready.status).toBe('ready');
  expect(ready.intent).toMatchObject({ category: 'wellness', durationMin: 30, groupMin: 2, groupMax: 2 });
});

it('saves custom onboarding answers without inventing a verified role', async () => {
  const user = await h.user('did:custom:onboarding');
  const result = await user.post('/onboarding/complete', {
    interests: ['gaming', 'build', 'food'], optInMatching: false,
    answers: [{ questionId: 'gaming_game', answer: 'Rocket League' }, { questionId: 'build_role', answer: 'Product designer' }],
  });
  expect(result.profile.preferences).toEqual({ custom_gaming: 'Rocket League', custom_build: 'Product designer' });
  expect(result.profile.declaredSkills).not.toContain('Product designer');
  expect((await user.get('/me')).profile.preferences.custom_gaming).toBe('Rocket League');
});

it('keeps plan-specific custom preferences ahead of profile defaults', () => {
  expect(relevantPreferences('gaming', mergePreferences({ gaming_game: 'chess' }, { custom_gaming: 'Rocket League' })))
    .toEqual({ custom_gaming: 'Rocket League' });
  expect(relevantPreferences('gaming', mergePreferences({ custom_gaming: 'Rocket League' }, { gaming_game: 'chess' })))
    .toEqual({ gaming_game: 'chess' });
});

it('passes private, redacted custom preferences into composition and keeps them out of Arkiv', async () => {
  const host = await h.onboarded('did:custom:host', { optInMatching: false });
  const guest = await h.onboarded('did:custom:guest', { preferences: { custom_gaming: 'Rocket League, email me at player@example.com', custom_food: 'Vegetarian' } });
  const rally = await h.rally(host, { category: 'gaming', capacity: 2, preferences: { custom_gaming: 'Rocket League doubles' } });
  await h.drainOutbox();
  const sent = compositionInput.parse({ ...(h.ai.callsFor('composition')[0]!.input as object), requestId: 'test' });
  expect(sent.rally.intent.preferences).toEqual({ custom_gaming: 'Rocket League doubles' });
  expect(sent.candidates[0]?.preferences).toEqual({ custom_gaming: 'Rocket League, email me at [email]', custom_food: 'Vegetarian' });
  expect((await guest.get('/matches')).matches[0].rally.id).toBe(rally.id);
  expect(JSON.stringify([...h.arkiv.entities.values()])).not.toMatch(/Rocket League|Vegetarian|example.com/);
});

it('closes stale custom invites after edits while leaving unrelated preferences alone', async () => {
  const host = await h.onboarded('did:custom:edit-host', { optInMatching: false });
  const guest = await h.onboarded('did:custom:edit-guest', { preferences: { custom_gaming: 'Rocket League' } });
  await h.rally(host, { category: 'gaming', capacity: 2 });
  await h.drainOutbox();
  const match = (await guest.get('/matches')).matches[0];
  await guest.patch('/me/profile', { preferences: { custom_gaming: 'Rocket League', custom_food: 'Vegetarian' } });
  expect((await guest.get(`/matches/${match.id}`)).status).toBe('pending');
  await guest.patch('/me/profile', { preferences: { custom_gaming: 'Casual Minecraft', custom_food: 'Vegetarian' } });
  expect((await guest.get(`/matches/${match.id}`)).status).toBe('cancelled');
  expect((await guest.request('POST', `/matches/${match.id}/respond`, { response: 'accept' })).statusCode).toBe(409);
  await guest.patch('/me/profile', { preferences: {} });
  expect((await guest.get('/me')).profile.preferences).toEqual({});
});

it('validates custom preference categories and length', async () => {
  const guest = await h.onboarded('did:custom:validation');
  for (const preferences of [{ custom_unknown: 'text' }, { custom_gaming: 'x'.repeat(121) }, { custom_gaming: '   ' }]) {
    expect((await guest.request('PATCH', '/me/profile', { preferences })).statusCode).toBe(400);
  }
});

it('persists a custom activity answer through parsing, activation and publication', async () => {
  const host = await h.onboarded('did:custom:activity', { preferences: { gaming_game: 'chess' } });
  h.ai.respond = () => ({ schemaVersion: 1, status: 'needs_answers', questionIds: ['gaming_game'] });
  const first = await host.post('/intents/parse', { text: 'Find a gaming buddy' });
  h.ai.respond = () => ({ schemaVersion: 1, status: 'ready', intent: {
    categoryId: 'gaming', goal: 'Play Rocket League', startAt: hoursFromNow(1), durationMin: 30,
    groupMin: 2, groupMax: 2, zoneId: 'venue-nearby', vibe: 'any',
  } });
  const ready = await host.post(`/intents/${first.intent.id}/answers`, { answers: [{ questionId: 'gaming_game', answer: 'Rocket League' }] });
  expect(ready.intent.preferences).toEqual({ custom_gaming: 'Rocket League' });
  const rally = await h.rally(host, { category: 'gaming', intentId: ready.intent.id, capacity: 2 });
  expect(rally.preferences).toEqual({ custom_gaming: 'Rocket League' });
});

it('does not let a profile default override a custom waiting intent in SQL filtering', async () => {
  const host = await h.onboarded('did:custom:waiting-host', { optInMatching: false });
  const guest = await h.onboarded('did:custom:waiting-guest', { preferences: { gaming_game: 'valorant' } });
  const draft = await guest.post('/intents/parse', { text: 'gaming' });
  await guest.post(`/intents/${draft.intent.id}/activate`, { category: 'gaming',
    windowStart: hoursFromNow(0), windowEnd: hoursFromNow(6), durationMin: 30,
    preferences: { custom_gaming: 'Open to learning another game' } });
  await h.rally(host, { category: 'gaming', capacity: 2, preferences: { gaming_game: 'chess' } });
  await h.drainOutbox();
  expect((await guest.get('/matches')).matches).toHaveLength(1);
  const sent = compositionInput.parse({ ...(h.ai.callsFor('composition')[0]!.input as object), requestId: 'test' });
  expect(sent.candidates[0]?.preferences).toEqual({ custom_gaming: 'Open to learning another game' });
  const match = (await guest.get('/matches')).matches[0];
  await guest.patch('/me/profile', { preferences: { custom_gaming: 'Casual Minecraft' } });
  expect((await guest.get(`/matches/${match.id}`)).status).toBe('pending');
});
