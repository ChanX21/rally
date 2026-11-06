import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { disputes, outboxEvents, rewardLedger, users } from '../src/db/schema/index.js';
import { queueChainWork } from '../src/services/chain-sync.js';
import { createHarness, type Harness, type TestUser } from './helpers/harness.js';
import { did, setMeetAt, tapAt } from './helpers/rewards.js';

const ADMIN = 'test-admin-token-that-is-at-least-32-chars';
const WALLET_A = `0x${'aa'.repeat(20)}`;
const WALLET_B = `0x${'bb'.repeat(20)}`;

let h: Harness;
beforeEach(async () => {
  await h?.close();
  h = await createHarness({ ADMIN_API_TOKEN: ADMIN });
});
afterAll(() => h.close());

async function userWithWallet(name: string, wallet: string | null, optInMatching = true) {
  const id = did(name);
  if (wallet) h.wallets[id] = wallet;
  return h.onboarded(id, { optInMatching });
}

/** A rally where both people tap in on time, so the member earns OnTime. */
async function earnOnTime(hostWallet: string | null, memberWallet: string | null) {
  const member = await userWithWallet('member', memberWallet);
  const host = await userWithWallet('host', hostWallet, false);
  const rally = await h.rally(host, { capacity: 2, meetingPoint: 'Lobby' });
  await h.drainOutbox();
  const { matches } = await member.get('/matches');
  await member.post(`/matches/${matches[0].id}/respond`, { response: 'accept' });
  await setMeetAt(h, rally.id, -20);
  await tapAt(h, rally.id, member.id, 0);
  await tapAt(h, rally.id, host.id, 0);
  await host.post(`/rallies/${rally.id}/check-in`, { presentUserIds: [member.id] });
  return { host, member, rally };
}

const sync = async () => {
  const queued = await queueChainWork(h.app.deps);
  await h.drainOutbox();
  return queued;
};

const entriesOf = (user: TestUser) =>
  h.app.deps.db.select().from(rewardLedger).where(eq(rewardLedger.subjectUserId, user.id));

describe('reward sync', () => {
  it('writes entries to the wallet with the amount and version', async () => {
    const { member } = await earnOnTime(WALLET_A, WALLET_B);
    expect(await sync()).toBe(2);

    const record = h.arc.records.find((row) => row.subject === WALLET_B);
    expect(record).toMatchObject({ action: 0, delta: 10, policyVersion: 1 });
    const [entry] = await entriesOf(member);
    expect(entry).toMatchObject({ chainStatus: 'synced' });
    expect(entry!.chainTxHash).toMatch(/^0x/);
    expect((await member.get('/me/rewards')).entries[0].chainTxHash).toMatch(/^0x/);
  });

  it('gives each person a different reference, so records do not show who met', async () => {
    await earnOnTime(WALLET_A, WALLET_B);
    await sync();
    const refs = h.arc.records.map((row) => row.ref);
    expect(refs).toHaveLength(2);
    expect(new Set(refs).size).toBe(2);
  });

  it('never puts text or ids on-chain', async () => {
    const { rally } = await earnOnTime(WALLET_A, WALLET_B);
    await sync();
    const written = JSON.stringify(h.arc.records);
    expect(written).not.toContain(rally.id);
    expect(written).not.toContain('Lobby');
  });

  it('does not queue a penalty still open to appeal', async () => {
    const present = await userWithWallet('present', WALLET_B);
    const absent = await userWithWallet('absent', WALLET_A);
    const host = await userWithWallet('host', `0x${'cc'.repeat(20)}`, false);
    const rally = await h.rally(host, { capacity: 3, groupMin: 3, meetingPoint: 'Lobby' });
    await h.drainOutbox();
    for (const user of [present, absent]) {
      const { matches } = await user.get('/matches');
      await user.post(`/matches/${matches[0].id}/respond`, { response: 'accept' });
    }
    await host.post(`/rallies/${rally.id}/check-in`, { presentUserIds: [present.id] });

    expect(await sync()).toBe(0);
    expect(h.arc.records).toEqual([]);
  });

  it('keeps one address even if the login wallet changes', async () => {
    const { member } = await earnOnTime(WALLET_A, WALLET_B);
    await sync();
    await h.app.deps.db
      .update(users)
      .set({ walletAddress: `0x${'dd'.repeat(20)}` })
      .where(eq(users.id, member.id));
    const [row] = await h.app.deps.db.select().from(users).where(eq(users.id, member.id));
    expect(row!.rewardAddress).toBe(WALLET_B);
  });

  it('waits for a wallet, then catches up', async () => {
    const { member } = await earnOnTime(WALLET_A, null);
    await sync();
    // Only the host has a wallet so far.
    expect(h.arc.records.map((row) => row.subject)).toEqual([WALLET_A]);
    const [waiting] = await entriesOf(member);
    expect(waiting!.chainStatus).toBe('pending');

    await h.app.deps.db
      .update(users)
      .set({ walletAddress: WALLET_B })
      .where(eq(users.id, member.id));
    await sync();
    expect(h.arc.records.some((row) => row.subject === WALLET_B)).toBe(true);
  });

  it('retries, and a retry is not a second reward', async () => {
    const { member } = await earnOnTime(WALLET_A, WALLET_B);
    h.arc.fail = true;
    await queueChainWork(h.app.deps);
    await h.drainOutbox();
    const [failed] = await entriesOf(member);
    expect(failed!.chainStatus).toBe('queued');

    h.arc.fail = false;
    await h.app.deps.db.update(outboxEvents).set({ nextAttemptAt: new Date(0) });
    await h.drainOutbox();
    const [synced] = await entriesOf(member);
    expect(synced!.chainStatus).toBe('synced');
    expect(h.arc.records.filter((row) => row.subject === WALLET_B)).toHaveLength(1);
  });

  it('marks an entry failed once its event runs out of retries, without losing points', async () => {
    const { member } = await earnOnTime(WALLET_A, WALLET_B);
    h.arc.fail = true;
    await queueChainWork(h.app.deps);
    await h.app.deps.db.update(outboxEvents).set({ maxAttempts: 1 });
    await h.drainOutbox();
    await queueChainWork(h.app.deps);

    const [entry] = await entriesOf(member);
    expect(entry!.chainStatus).toBe('failed');
    expect((await member.get('/me/rewards')).net).toBe(10);
  });
});

describe('with the ledger disabled', () => {
  it('still keeps points, and backfills once enabled', async () => {
    const { arc } = h.app.deps;
    h.app.deps.arc = null;
    const { member } = await earnOnTime(WALLET_A, WALLET_B);
    expect(await queueChainWork(h.app.deps)).toBe(0);
    expect((await member.get('/me/rewards')).net).toBe(10);
    expect(h.arc.records).toEqual([]);

    h.app.deps.arc = arc;
    await sync();
    expect(h.arc.records).toHaveLength(2);
  });
});

describe('policy sync', () => {
  it('publishes a new version on-chain', async () => {
    await userWithWallet('someone', WALLET_A);
    const auth = { authorization: `Bearer ${ADMIN}` };
    const { amounts } = (
      await h.app.inject({ url: '/internal/reward-policy', headers: auth })
    ).json().data;
    await h.app.inject({
      method: 'PUT',
      url: '/internal/reward-policy',
      headers: auth,
      payload: { amounts: { ...amounts, OnTime: 12 } },
    });
    await sync();
    expect(h.arc.policies).toEqual([
      { version: 2, amounts: [12, 5, 25, -5, -10, -20, -15, -10, 10] },
    ]);
  });
});

describe('ruling sync', () => {
  it('records the outcome with hashes only', async () => {
    const { host, member, rally } = await earnOnTime(WALLET_A, WALLET_B);
    const { id } = await member.post(`/rallies/${rally.id}/disputes`, {
      category: 'misconduct',
      subjectId: host.id,
      description: 'Private complaint text',
    });
    await sync();
    expect(h.arc.rulings).toEqual([]);

    await h.app.inject({
      method: 'POST',
      url: `/internal/disputes/${id}/resolve`,
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { outcome: 'upheld' },
    });
    await sync();

    expect(h.arc.rulings).toHaveLength(1);
    expect(h.arc.rulings[0]).toMatchObject({
      subject: WALLET_A,
      raiser: WALLET_B,
      category: 1,
      outcome: 0,
    });
    expect(JSON.stringify(h.arc.rulings)).not.toContain('Private');
    const [row] = await h.app.deps.db.select().from(disputes).where(eq(disputes.id, id));
    expect(row!.chainStatus).toBe('synced');
    // The penalty follows as its own record, so every balance change is a Recorded event.
    expect(h.arc.records.some((r) => r.delta === -15 && r.subject === WALLET_A)).toBe(true);
  });
});
