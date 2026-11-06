import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { outboxEvents, rallies } from '../src/db/schema/index.js';
import { compositionInput } from '../src/schemas/formation.js';
import { queueMatchingSweep } from '../src/workers/scheduler.js';
import { createHarness, type Harness, hoursFromNow } from './helpers/harness.js';

let h: Harness;
beforeEach(async () => { await h?.close(); h = await createHarness(); });
afterAll(() => h?.close());

it('recovers a missed preference trigger and sends only one invitation', async () => {
  const host = await h.onboarded('did:sweep:host', { optInMatching: false });
  const guest = await h.onboarded('did:sweep:guest', { interests: ['music', 'books', 'animals'], preferences: { matching_notes: 'Just reading today' } });
  h.ai.respond = ({ input }) => {
    const data = compositionInput.parse({ ...(input as object), requestId: 'test' });
    const guest = data.candidates.find((p) => p.preferences?.matching_notes === 'I would like to practise a pitch');
    return guest ? { schemaVersion: 1, status: 'proposed', memberIds: [...data.rally.requiredMembers.map((p) => p.id), guest.id],
      roles: [{ memberId: guest.id, roleId: guest.roleIds[0] }], reason: 'Shared pitch practice' }
      : { schemaVersion: 1, status: 'no_fit' };
  };
  const rally = await h.rally(host, { category: 'build', goal: 'Someone to hear my pitch', capacity: 2 });
  await h.drainOutbox();
  expect((await guest.get('/matches')).matches).toHaveLength(0);
  await guest.patch('/me/profile', { preferences: { matching_notes: 'I would like to practise a pitch' } });
  // Simulate a missed profile-change trigger; the periodic sweep must recover it.
  await h.app.deps.db.delete(outboxEvents).where(sql`type = 'match.reevaluate' and payload->>'userId' = ${guest.id}`);
  expect(await queueMatchingSweep(h.app.deps)).toBe(1);
  expect(await queueMatchingSweep(h.app.deps)).toBe(0);
  await h.drainOutbox();
  expect((await guest.get('/matches')).matches[0]).toMatchObject({ status: 'pending', rally: { id: rally.id } });
  expect(await queueMatchingSweep(h.app.deps)).toBe(0);
  expect((await guest.get('/notifications')).items.filter((n: { type: string }) => n.type === 'match.proposed')).toHaveLength(1);
});

it('deduplicates concurrent sweep instances and reuses unchanged no-fit without more inference', async () => {
  const host = await h.onboarded('did:sweep:cached-host', { optInMatching: false });
  await h.onboarded('did:sweep:cached-guest');
  h.ai.respond = () => ({ schemaVersion: 1, status: 'no_fit' });
  await h.rally(host, { capacity: 2 });
  await h.drainOutbox();
  const calls = h.ai.callsFor('composition').length;
  const counts = await Promise.all([queueMatchingSweep(h.app.deps), queueMatchingSweep(h.app.deps)]);
  expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
  await h.drainOutbox();
  expect(h.ai.callsFor('composition')).toHaveLength(calls);
});

it('skips expired, closed, seatless and already queued Rallies', async () => {
  const host = await h.onboarded('did:sweep:skip-host', { optInMatching: false });
  const expired = await h.rally(host);
  const closed = await h.rally(host, { windowStart: hoursFromNow(4), windowEnd: hoursFromNow(5) });
  const seatless = await h.rally(host, { windowStart: hoursFromNow(6), windowEnd: hoursFromNow(7) });
  await h.drainOutbox();
  await h.app.deps.db.update(rallies).set({ expiresAt: new Date(0) }).where(eq(rallies.id, expired.id));
  await h.app.deps.db.update(rallies).set({ status: 'cancelled' }).where(eq(rallies.id, closed.id));
  await h.app.deps.db.update(rallies).set({ openSeats: 0 }).where(eq(rallies.id, seatless.id));
  await h.rally(host, { windowStart: hoursFromNow(8), windowEnd: hoursFromNow(9) }); // Its publication job is still pending.
  expect(await queueMatchingSweep(h.app.deps)).toBe(0);
});
