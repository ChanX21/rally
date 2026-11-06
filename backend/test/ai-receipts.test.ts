import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { modelRuns } from '../src/db/schema/index.js';
import { compositionInput } from '../src/schemas/formation.js';
import { createHarness, type Harness, hoursFromNow } from './helpers/harness.js';

let h: Harness;
beforeEach(async () => { await h?.close(); h = await createHarness(); });
afterAll(() => h?.close());

it('shows genuine provider IDs for planning and matching to members and invitees only', async () => {
  const host = await h.onboarded('did:receipt:host', { optInMatching: false });
  const guest = await h.onboarded('did:receipt:guest');
  const outsider = await h.onboarded('did:receipt:outsider', { optInMatching: false });
  h.ai.respond = ({ system, input }) => {
    if (system.includes('Extract activity intent')) return { schemaVersion: 1, status: 'ready', intent: {
      categoryId: 'food', goal: 'Snack together', startAt: hoursFromNow(1), durationMin: 30, groupMin: 2, groupMax: 2, zoneId: 'venue-nearby', vibe: 'any',
    } };
    const data = compositionInput.parse({ ...(input as object), requestId: 'test' });
    return { schemaVersion: 1, status: 'proposed', memberIds: [...data.rally.requiredMembers.map((p) => p.id), data.candidates[0]!.id],
      roles: [{ memberId: data.candidates[0]!.id, roleId: data.candidates[0]!.roleIds[0] }], reason: 'Shared food plan' };
  };
  const parsed = await host.post('/intents/parse', { text: 'Snack together in an hour' });
  const rally = await h.rally(host, { intentId: parsed.intent.id, capacity: 2, durationMin: 30 });
  await h.drainOutbox();
  const response = await host.get(`/rallies/${rally.id}/ai-receipts`);
  const [composition] = await h.app.deps.db.select().from(modelRuns).where(eq(modelRuns.task, 'composition'));
  expect(response.receipts).toEqual(expect.arrayContaining([
    expect.objectContaining({ task: 'intent', requestId: parsed.aiRequestId }),
    expect.objectContaining({ task: 'composition', requestId: composition!.requestId, outcome: 'ok' }),
  ]));
  expect(response.receipts.some((receipt: { requestId: string }) => receipt.requestId === composition!.id)).toBe(false);
  expect(await guest.get(`/rallies/${rally.id}/ai-receipts`)).toEqual(response);
  expect((await outsider.request('GET', `/rallies/${rally.id}/ai-receipts`)).statusCode).toBe(404);
  expect((await h.app.inject({ url: `/rallies/${rally.id}/ai-receipts` })).statusCode).toBe(401);
  expect(JSON.stringify(response)).not.toMatch(/did:receipt|rawText|preferences/);
});

it('retains no-fit receipts without requiring a successful proposal and omits missing IDs', async () => {
  const host = await h.onboarded('did:receipt:no-fit-host', { optInMatching: false });
  await h.onboarded('did:receipt:no-fit-guest');
  h.ai.respond = () => ({ schemaVersion: 1, status: 'no_fit' });
  const rally = await h.rally(host, { capacity: 2 });
  await h.drainOutbox();
  const response = await host.get(`/rallies/${rally.id}/ai-receipts`);
  expect(response.receipts).toEqual(expect.arrayContaining([expect.objectContaining({ task: 'composition', outcome: 'ok' })]));
  expect(response.receipts.every((receipt: { requestId: string }) => receipt.requestId.startsWith('req_'))).toBe(true);
  await h.app.deps.db.update(modelRuns).set({ requestId: null }).where(eq(modelRuns.rallyId, rally.id));
  expect((await host.get(`/rallies/${rally.id}/ai-receipts`)).receipts).toEqual([]);
});
