import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { outboxEvents } from '../src/db/schema/index.js';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { createHarness, type Harness, hoursFromNow } from './helpers/harness.js';
import { compositionInput } from '../src/schemas/formation.js';

let h: Harness;
beforeEach(async () => { await h?.close(); h = await createHarness(); });
afterAll(() => h.close());

it('defaults new onboarding to invites and continues matching past the first five rallies', async () => {
  const host = await h.onboarded('did:triggers:batch-host', { optInMatching: false });
  let lastId = '';
  for (let n = 1; n <= 6; n++) {
    const rally = await h.rally(host, { category: 'gaming', capacity: 2, windowStart: hoursFromNow(n),
      windowEnd: hoursFromNow(n + 0.5), durationMin: 30,
      preferences: { gaming_game: n === 6 ? 'chess' : 'valorant' } });
    lastId = rally.id;
  }
  await h.drainOutbox();
  const guest = await h.user('did:triggers:batch-guest');
  const result = await guest.post('/onboarding/complete', {
    interests: ['gaming', 'food', 'coffee'], preferences: { gaming_game: 'chess' },
    availableFrom: hoursFromNow(0), availableTo: hoursFromNow(12),
  });
  expect(result.user.optInMatching).toBe(true);
  await h.drainOutbox();
  expect((await guest.get('/matches')).matches.map((match: { rally: { id: string } }) => match.rally.id)).toEqual([lastId]);
  expect((await guest.get('/notifications')).items.filter((item: { type: string }) => item.type === 'match.proposed')).toHaveLength(1);
  await h.drainOutbox();
  expect((await guest.get('/notifications')).items.filter((item: { type: string }) => item.type === 'match.proposed')).toHaveLength(1);
});

it('sends a later Rally to an idle user but respects paused or expired availability', async () => {
  const idle = await h.onboarded('did:triggers:idle');
  const paused = await h.onboarded('did:triggers:paused', { optInMatching: false });
  const expired = await h.onboarded('did:triggers:expired', { availableFrom: hoursFromNow(-12), availableTo: hoursFromNow(-1) });
  const host = await h.onboarded('did:triggers:later-host', { optInMatching: false });
  const rally = await h.rally(host, { capacity: 2 });
  await h.drainOutbox();
  expect((await idle.get('/matches')).matches[0].rally.id).toBe(rally.id);
  expect((await paused.get('/matches')).matches).toEqual([]);
  expect((await expired.get('/matches')).matches).toEqual([]);
});

it('retries a no-fit when custom preferences change and uses them in composition', async () => {
  const host = await h.onboarded('did:triggers:custom-host', { optInMatching: false });
  const guest = await h.onboarded('did:triggers:custom-guest', { preferences: { custom_gaming: 'Casual Minecraft' } });
  h.ai.respond = ({ input }) => {
    const parsed = compositionInput.parse({ ...(input as object), requestId: 'test' });
    const candidate = parsed.candidates.find((person) => person.preferences?.custom_gaming === 'Rocket League');
    return candidate ? { schemaVersion: 1, status: 'proposed', memberIds: [...parsed.rally.requiredMembers.map((person) => person.id), candidate.id],
      roles: [{ memberId: candidate.id, roleId: candidate.roleIds[0] }], reason: 'Shared game preference' }
      : { schemaVersion: 1, status: 'no_fit' };
  };
  const rally = await h.rally(host, { category: 'gaming', capacity: 2, preferences: { custom_gaming: 'Rocket League' } });
  await h.drainOutbox();
  expect((await guest.get('/matches')).matches).toHaveLength(0);
  await guest.patch('/me/profile', { preferences: { custom_gaming: 'Rocket League' } });
  await h.drainOutbox();
  expect((await guest.get('/matches')).matches[0]).toMatchObject({ source: 'ai', rally: { id: rally.id } });
});

it('reevaluates someone whose accepted Rally is cancelled', async () => {
  const guest = await h.onboarded('did:triggers:freed');
  const hostA = await h.onboarded('did:triggers:host-a', { optInMatching: false });
  const hostB = await h.onboarded('did:triggers:host-b', { optInMatching: false });
  const first = await h.rally(hostA, { capacity: 2 });
  await h.drainOutbox();
  const offer = (await guest.get('/matches')).matches[0];
  await guest.post(`/matches/${offer.id}/respond`, { response: 'accept' });
  const second = await h.rally(hostB, { capacity: 2 });
  await h.drainOutbox();
  expect((await guest.get('/matches')).matches).toHaveLength(1);
  await hostA.post(`/rallies/${first.id}/cancel`);
  await h.drainOutbox();
  expect((await guest.get('/matches')).matches.some((match: { rally: { id: string } }) => match.rally.id === second.id)).toBe(true);
});

it.each([true, false])('checks existing rallies after a saved preference change when matching is %s', async (enabled) => {
  const host = await h.onboarded('did:triggers:preference-host', { optInMatching: false });
  const guest = await h.onboarded('did:triggers:preference-guest', {
    optInMatching: enabled, preferences: { gaming_game: 'valorant' },
  });
  const rally = await h.rally(host, { category: 'gaming', capacity: 2, preferences: { gaming_game: 'chess' } });
  await h.drainOutbox();
  expect((await guest.get('/matches')).matches).toHaveLength(0);
  await guest.patch('/me/profile', { preferences: { gaming_game: 'chess' } });
  await h.drainOutbox();
  const matches = (await guest.get('/matches')).matches;
  expect(matches).toHaveLength(enabled ? 1 : 0);
  if (enabled) {
    expect(matches[0].rally.id).toBe(rally.id);
    expect(matches[0].status).toBe('pending');
    expect((await host.request('GET', `/rallies/${rally.id}/room`)).statusCode).toBe(409);
  }
});

it.each([true, false])('matches saved preferences across onboarding interests when the Rally exists first: %s', async (rallyFirst) => {
  const host = await h.onboarded('did:triggers:cross-interest-host', { optInMatching: false });
  h.ai.respond = ({ input }) => {
    const parsed = compositionInput.parse({ ...(input as object), requestId: 'test' });
    const candidate = parsed.candidates.find((person) => person.preferences?.custom_technology === 'I want to practise startup pitches');
    return candidate ? { schemaVersion: 1, status: 'proposed',
      memberIds: [...parsed.rally.requiredMembers.map((person) => person.id), candidate.id],
      roles: [{ memberId: candidate.id, roleId: candidate.roleIds[0] }], reason: 'Shared pitch practice' }
      : { schemaVersion: 1, status: 'no_fit' };
  };
  const makeRally = () => h.rally(host, { category: 'build', goal: 'Someone to hear my pitch', capacity: 2 });
  let rally = rallyFirst ? await makeRally() : null;
  await h.drainOutbox();
  const guest = await h.onboarded('did:triggers:cross-interest-guest', {
    interests: ['music', 'technology', 'books'],
    preferences: { custom_technology: 'I want to practise startup pitches' },
  });
  if (!rallyFirst) rally = await makeRally();
  await h.drainOutbox();
  const matches = (await guest.get('/matches')).matches;
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ status: 'pending', source: 'ai', rally: { id: rally!.id } });
  const sent = h.ai.callsFor('composition')[0]!.input as { candidates: Record<string, unknown>[]; rally: { requiredMembers: Record<string, unknown>[] } };
  expect(sent.candidates[0]!.preferences).toEqual({ custom_technology: 'I want to practise startup pitches' });
  for (const person of [...sent.candidates, ...sent.rally.requiredMembers]) expect(person).not.toHaveProperty('interests');
  expect((await guest.get('/notifications')).items.some((item: { type: string }) => item.type === 'match.proposed')).toBe(true);
});


it('queues existing open Rallies once when the preference-matching migration runs', async () => {
  const host = await h.onboarded('did:triggers:backfill-host', { optInMatching: false });
  const rally = await h.rally(host, { capacity: 2 });
  await h.drainOutbox();
  const migration = readFileSync(new URL('../drizzle/0008_preference_matching.sql', import.meta.url), 'utf8');
  await h.app.deps.db.execute(sql.raw(migration));
  await h.app.deps.db.execute(sql.raw(migration));
  const jobs = await h.app.deps.db.select().from(outboxEvents)
    .where(eq(outboxEvents.dedupeKey, `preferences-matching-v1:${rally.id}`));
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ type: 'match.reevaluate', status: 'pending', payload: { rallyId: rally.id } });
});
