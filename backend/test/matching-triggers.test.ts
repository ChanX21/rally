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
