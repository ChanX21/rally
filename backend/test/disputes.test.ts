import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { disputes } from '../src/db/schema/index.js';
import { expireDisputes } from '../src/services/disputes.js';
import { createHarness, type Harness, type Json, type TestUser } from './helpers/harness.js';
import { did, formedGroup } from './helpers/rewards.js';

const ADMIN = 'test-admin-token-that-is-at-least-32-chars';

let h: Harness;
beforeEach(async () => {
  await h?.close();
  h = await createHarness({ ADMIN_API_TOKEN: ADMIN });
});
afterAll(() => h.close());

const admin = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  h.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${ADMIN}` },
    ...(payload ? { payload } : {}),
  });

const rule = (id: string, outcome: string) =>
  admin('POST', `/internal/disputes/${id}/resolve`, { outcome });

async function complaint() {
  const group = await formedGroup(h);
  const { id } = await group.member.post(`/rallies/${group.rally.id}/disputes`, {
    category: 'misconduct',
    subjectId: group.host.id,
    description: 'Was rude to the group',
  });
  return { ...group, id: id as string };
}

async function absentMember() {
  const present = await h.onboarded(did('present'));
  const absent = await h.onboarded(did('absent'));
  const host = await h.onboarded(did('host'), { optInMatching: false });
  const rally: Json = await h.rally(host, { capacity: 3, groupMin: 3, meetingPoint: 'Lobby' });
  await h.drainOutbox();
  for (const user of [present, absent]) {
    const { matches } = await user.get('/matches');
    const match = matches.find((m: Json) => m.rally.id === rally.id);
    await user.post(`/matches/${match.id}/respond`, { response: 'accept' });
  }
  await host.post(`/rallies/${rally.id}/check-in`, { presentUserIds: [present.id] });
  return { host, present, absent, rally };
}

const appeal = (user: TestUser, rallyId: string) =>
  user.post(`/rallies/${rallyId}/disputes`, { category: 'no_show_appeal' });

describe('raising a complaint', () => {
  it('needs a member of the rally, about another member', async () => {
    const { host, member, rally } = await formedGroup(h);
    const stranger = await h.onboarded(did('stranger'));
    const body = { category: 'other', subjectId: host.id, description: 'Something happened' };
    expect((await stranger.request('POST', `/rallies/${rally.id}/disputes`, body)).statusCode).toBe(404);
    const aboutStranger = await member.request('POST', `/rallies/${rally.id}/disputes`, {
      ...body,
      subjectId: stranger.id,
    });
    expect(aboutStranger.statusCode).toBe(422);
    const aboutSelf = await member.request('POST', `/rallies/${rally.id}/disputes`, {
      ...body,
      subjectId: member.id,
    });
    expect(aboutSelf.statusCode).toBe(422);
  });

  it('only accepts one report per person and category', async () => {
    const { member, host, rally } = await complaint();
    const again = await member.request('POST', `/rallies/${rally.id}/disputes`, {
      category: 'misconduct',
      subjectId: host.id,
      description: 'Again',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('DISPUTE_EXISTS');
  });

  it('never shows the subject who complained, or the text', async () => {
    const { host, member, id } = await complaint();
    expect((await host.get('/me/disputes')).against).toEqual([]);

    await rule(id, 'dismissed');
    const seen = await host.get('/me/disputes');
    expect(seen.against).toHaveLength(1);
    expect(JSON.stringify(seen.against)).not.toContain('rude');
    expect(JSON.stringify(seen.against)).not.toContain(member.id);
    expect((await member.get('/me/disputes')).raised[0].description).toContain('rude');
  });
});

describe('rulings on complaints', () => {
  it('upheld penalises the subject', async () => {
    const { host, member, id } = await complaint();
    expect((await rule(id, 'upheld')).statusCode).toBe(200);
    expect((await host.get('/me/rewards')).net).toBe(-15);
    expect((await member.get('/me/rewards')).net).toBe(0);
  });

  it('dismissed penalises nobody', async () => {
    const { host, member, id } = await complaint();
    await rule(id, 'dismissed');
    expect((await host.get('/me/rewards')).net).toBe(0);
    expect((await member.get('/me/rewards')).net).toBe(0);
  });

  it('false penalises the person who raised it', async () => {
    const { host, member, id } = await complaint();
    await rule(id, 'false');
    expect((await host.get('/me/rewards')).net).toBe(0);
    expect((await member.get('/me/rewards')).net).toBe(-10);
  });

  it('can only be ruled on once', async () => {
    const { id } = await complaint();
    await rule(id, 'upheld');
    const again = await rule(id, 'false');
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_RESOLVED');
  });

  it('times out as dismissed after 72 hours', async () => {
    const { host, id } = await complaint();
    await h.app.deps.db
      .update(disputes)
      .set({ createdAt: new Date(Date.now() - 73 * 3_600_000) })
      .where(eq(disputes.id, id));
    await expireDisputes(h.app.deps);
    const [row] = await h.app.deps.db.select().from(disputes).where(eq(disputes.id, id));
    expect(row).toMatchObject({ status: 'dismissed', resolvedBy: 'timeout' });
    expect((await host.get('/me/rewards')).net).toBe(0);
  });
});

describe('no-show appeals', () => {
  it('holds the penalty, and the rally stays closed to the person', async () => {
    const { absent, rally } = await absentMember();
    const { id } = await appeal(absent, rally.id);
    expect(id).toBeTruthy();
    const rewards = await absent.get('/me/rewards');
    expect(rewards.net).toBe(0);
    expect(rewards.entries[0].state).toBe('held');
  });

  it('cannot be raised without a pending no-show', async () => {
    const { present, rally } = await absentMember();
    const response = await present.request('POST', `/rallies/${rally.id}/disputes`, {
      category: 'no_show_appeal',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOT_APPEALABLE');
  });

  it('upheld cancels the penalty', async () => {
    const { absent, rally } = await absentMember();
    const { id } = await appeal(absent, rally.id);
    await rule(id, 'upheld');
    const rewards = await absent.get('/me/rewards');
    expect(rewards.net).toBe(0);
    expect(rewards.entries).toEqual([]);
  });

  it('dismissed applies the penalty', async () => {
    const { absent, rally } = await absentMember();
    const { id } = await appeal(absent, rally.id);
    await rule(id, 'dismissed');
    expect((await absent.get('/me/rewards')).net).toBe(-20);
  });

  it('false applies the penalty and adds another', async () => {
    const { absent, rally } = await absentMember();
    const { id } = await appeal(absent, rally.id);
    await rule(id, 'false');
    expect((await absent.get('/me/rewards')).net).toBe(-30);
  });

  it('times out in the person\'s favour after 72 hours', async () => {
    const { absent, rally } = await absentMember();
    const { id } = await appeal(absent, rally.id);
    await h.app.deps.db
      .update(disputes)
      .set({ createdAt: new Date(Date.now() - 73 * 3_600_000) })
      .where(eq(disputes.id, id));
    await expireDisputes(h.app.deps);
    expect((await absent.get('/me/rewards')).net).toBe(0);
  });
});

describe('admin', () => {
  it('needs the admin token', async () => {
    const { member } = await formedGroup(h);
    for (const url of ['/internal/disputes', '/internal/reward-policy']) {
      expect((await member.request('GET', url)).statusCode).toBe(401);
    }
  });

  it('shows a person\'s full history, raised and against', async () => {
    const { host, member, id } = await complaint();
    const asSubject = (await admin('GET', `/internal/disputes?userId=${host.id}`)).json().data;
    const asRaiser = (await admin('GET', `/internal/disputes?userId=${member.id}`)).json().data;
    expect(asSubject.map((d: Json) => d.id)).toEqual([id]);
    expect(asRaiser.map((d: Json) => d.id)).toEqual([id]);
    expect(asSubject[0]).toMatchObject({
      description: 'Was rude to the group',
      status: 'open',
      raiser: { id: member.id },
      subject: { id: host.id },
    });
  });

  it('publishes a new policy, which new entries use', async () => {
    const current = (await admin('GET', '/internal/reward-policy')).json().data;
    expect(current.amounts.NoShow).toBe(-20);
    const amounts = { ...current.amounts, ComplaintUpheld: -40 };
    const next = await admin('PUT', '/internal/reward-policy', { amounts });
    expect(next.json().data.version).toBe(current.version + 1);

    const { host, id } = await complaint();
    await rule(id, 'upheld');
    const rewards = await host.get('/me/rewards');
    expect(rewards.net).toBe(-40);
    expect(rewards.entries[0].policyVersion).toBe(current.version + 1);

    await admin('PUT', '/internal/reward-policy', {
      amounts: { ...amounts, ComplaintUpheld: -15 },
    });
  });

  it('rejects a policy the contract would reject', async () => {
    const { amounts } = (await admin('GET', '/internal/reward-policy')).json().data;
    for (const bad of [
      { ...amounts, OnTime: 101 },
      { ...amounts, OnTime: -1 },
      { ...amounts, NoShow: 1 },
      { ...amounts, NoShow: -101 },
    ]) {
      const response = await admin('PUT', '/internal/reward-policy', { amounts: bad });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('INVALID_POLICY');
    }
  });
});
