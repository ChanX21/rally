import { afterAll, beforeEach, expect, it } from 'vitest';

import { createHarness, type Harness, hoursFromNow } from './helpers/harness.js';

let h: Harness;
beforeEach(async () => {
  await h?.close();
  h = await createHarness();
});
afterAll(() => h.close());

it('serializes concurrent publications and rolls back the conflicting creation', async () => {
  const host = await h.onboarded('did:schedule:host', { optInMatching: false });
  const body = {
    category: 'food', goal: 'Snack', windowStart: hoursFromNow(1), windowEnd: hoursFromNow(3),
    durationMin: 45, zone: 'venue-nearby', groupMin: 2, capacity: 2, publish: true,
  };
  const results = await Promise.all([host.request('POST', '/rallies', body), host.request('POST', '/rallies', body)]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe('SCHEDULE_CONFLICT');
  expect((await host.get('/rallies')).items).toHaveLength(1);
});

it('allows overlapping drafts but publishes only one, even concurrently', async () => {
  const host = await h.onboarded('did:schedule:drafts', { optInMatching: false });
  const a = await h.rally(host, { publish: false });
  const b = await h.rally(host, { publish: false, windowStart: a.windowStart, windowEnd: a.windowEnd });
  const results = await Promise.all([
    host.request('POST', `/rallies/${a.id}/publish`), host.request('POST', `/rallies/${b.id}/publish`),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const states = await Promise.all([host.get(`/rallies/${a.id}`), host.get(`/rallies/${b.id}`)]);
  expect(states.map((r) => r.status).sort()).toEqual(['draft', 'open']);
  const published = states.find((r) => r.status === 'open')!;
  expect((await host.post(`/rallies/${published.id}/publish`)).id).toBe(published.id);
});

it('rejects moving a published Rally into another commitment without changing its schedule', async () => {
  const host = await h.onboarded('did:schedule:edit', { optInMatching: false });
  const a = await h.rally(host);
  const b = await h.rally(host, { windowStart: hoursFromNow(4), windowEnd: hoursFromNow(6) });
  const result = await host.request('PATCH', `/rallies/${b.id}`, {
    expectedVersion: b.version, windowStart: a.windowStart, windowEnd: a.windowEnd,
  });
  expect(result.statusCode).toBe(409);
  expect(result.json().error.code).toBe('SCHEDULE_CONFLICT');
  const unchanged = await host.get(`/rallies/${b.id}`);
  expect(unchanged.windowStart).toBe(b.windowStart);
  expect(unchanged.version).toBe(b.version);
});

it('allows adjacent windows and reuses the same user lock as match acceptance', async () => {
  const guest = await h.onboarded('did:schedule:guest');
  const other = await h.onboarded('did:schedule:other', { optInMatching: false });
  const draft = await h.rally(guest, { publish: false });
  const offered = await h.rally(other, { capacity: 2, windowStart: draft.windowStart, windowEnd: draft.windowEnd });
  await h.drainOutbox();
  const match = (await guest.get('/matches')).matches.find((m: { rally: { id: string } }) => m.rally.id === offered.id)!;
  const results = await Promise.all([
    guest.request('POST', `/rallies/${draft.id}/publish`),
    guest.request('POST', `/matches/${match.id}/respond`, { response: 'accept' }),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe('SCHEDULE_CONFLICT');
  const adjacent = await h.rally(guest, {
    windowStart: draft.windowEnd, windowEnd: hoursFromNow(6),
  });
  expect(adjacent.status).toBe('open');
});
