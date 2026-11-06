import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SENSITIVE_CATEGORIES } from '../src/domain/catalog.js';
import { activityQuestions, onboardingCatalog, preferenceSchema } from '../src/domain/questions.js';
import { parseIntentFallback } from '../src/domain/intent-fallback.js';
import { compositionInput } from '../src/schemas/formation.js';
import { createHarness, type Harness, hoursFromNow } from './helpers/harness.js';

const cases = [
  ['music', 'Listen to live music', 'Live Jazz'],
  ['photography', 'Take a photo walk', 'Street portraits'],
  ['arts', 'Painting together', 'Watercolors'],
  ['football', 'Play football', 'Watch Champions League'],
  ['gym', 'Gym workout together', 'Weight training'],
  ['nature', 'Go birdwatching', 'Trail walks'],
  ['fashion', 'Go thrifting', 'Vintage clothes'],
  ['travel', 'Plan a trip', 'Weekend trips'],
  ['finance', 'Discuss budgeting', 'Personal budgeting'],
  ['technology', 'Explore robotics', 'Robotics projects'],
  ['books', 'Start a book club', 'Science Fiction'],
  ['animals', 'Visit a pet shelter', 'Shelter volunteering'],
] as const;

it('preserves private categories', () => {
  expect(SENSITIVE_CATEGORIES).toEqual(['wellness', 'support']);
});

it.each(cases)('classifies %s and offers a relevant question without adding structured options', (category, text, answer) => {
  expect(parseIntentFallback(text, new Date()).category).toBe(category);
  const questions = onboardingCatalog([category, 'coffee', 'food']);
  expect(questions.map((question) => question.id)).toEqual([`custom_${category}`, 'coffee_energy', 'food_style']);
  expect(questions[0]!.options).toBeUndefined();
  expect(activityQuestions(category, text).find((question) => question.id === `custom_${category}`)?.text).toBeTruthy();
  expect(preferenceSchema.safeParse({ [`custom_${category}`]: answer }).success).toBe(true);
});

describe('new-interest journeys', () => {
  let h: Harness;
  beforeEach(async () => { await h?.close(); h = await createHarness(); });
  afterAll(() => h.close());

  it.each(cases)('saves %s onboarding answers and invites the user to an existing matching Rally', async (category, text, answer) => {
    const guest = await h.user(`did:new-interest:${category}`);
    const questions = await guest.post('/onboarding/questions', { interests: [category, 'coffee', 'food'] });
    expect(questions.questions[0].id).toBe(`custom_${category}`);
    const result = await guest.post('/onboarding/complete', {
      interests: [category, 'coffee', 'food'], optInMatching: true,
      answers: [{ questionId: `custom_${category}`, answer }],
      availableFrom: hoursFromNow(-1), availableTo: hoursFromNow(12),
    });
    expect(result.profile.preferences).toEqual({ [`custom_${category}`]: answer });
    const host = await h.onboarded(`did:new-interest:host:${category}`, { optInMatching: false });
    h.ai.respond = ({ input }) => {
      const parsed = compositionInput.parse({ ...(input as object), requestId: 'test' });
      return { schemaVersion: 1, status: 'proposed',
        memberIds: [...parsed.rally.requiredMembers, ...parsed.candidates].map((person) => person.id),
        roles: parsed.candidates.map((person) => ({ memberId: person.id, roleId: person.roleIds[0] })), reason: 'Shared activity preference' };
    };
    const rally = await h.rally(host, { category, goal: text, capacity: 2, preferences: { [`custom_${category}`]: answer } });
    await h.drainOutbox();
    expect((await guest.get('/matches')).matches[0]).toMatchObject({ source: 'ai', status: 'pending', rally: { id: rally.id, category } });
    const sent = compositionInput.parse({ ...(h.ai.callsFor('composition')[0]!.input as object), requestId: 'test' });
    expect(sent.candidates[0]!.preferences).toEqual({ [`custom_${category}`]: answer });
    expect([...h.arkiv.entities.values()][0]?.category).toBe(category);
    expect(JSON.stringify([...h.arkiv.entities.values()])).not.toContain(`custom_${category}`);
    expect((await guest.patch('/me/profile', { interests: ['build', 'coffee', category] })).profile.interests).toContain(category);
  });

  it('passes the expanded catalog to intent parsing and saves a new-category activity answer', async () => {
    const user = await h.onboarded('did:new-interest:parse', { interests: ['music', 'photography', 'arts'] });
    h.ai.respond = () => ({ schemaVersion: 1, status: 'needs_answers', questionIds: ['custom_music'] });
    const parsed = await user.post('/intents/parse', { text: 'Listen to music with someone' });
    expect(parsed.intent.questions[0].id).toBe('custom_music');
    h.ai.respond = () => ({ schemaVersion: 1, status: 'ready', intent: {
      categoryId: 'music', goal: 'Listen to jazz', startAt: hoursFromNow(1), durationMin: 30, zoneId: 'venue-nearby', vibe: 'quiet',
    } });
    const ready = await user.post(`/intents/${parsed.intent.id}/answers`, { answers: [{ questionId: 'custom_music', answer: 'Live Jazz' }] });
    expect(ready.intent).toMatchObject({ category: 'music', preferences: { custom_music: 'Live Jazz' } });
    const wrong = await h.user('did:new-interest:wrong');
    const invalid = await wrong.request('POST', '/onboarding/complete', { interests: ['music', 'photography', 'arts'], optInMatching: false, answers: [{ questionId: 'custom_football', answer: 'Play' }] });
    expect(invalid.statusCode).toBe(422);
    expect((await wrong.request('POST', '/onboarding/questions', { interests: ['invented', 'coffee', 'food'] })).statusCode).toBe(400);
  });
});
