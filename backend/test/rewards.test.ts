import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { rallies, rewardLedger } from '../src/db/schema/index.js';
import { tierFor } from '../src/domain/reward-policy.js';
import { applyDuePenalties } from '../src/services/rewards.js';
import { expireRallies } from '../src/workers/scheduler.js';
import { createHarness, type Harness, hoursFromNow, type Json, type TestUser } from './helpers/harness.js';
import { did, formedGroup, setMeetAt, tapAt } from './helpers/rewards.js';

let h: Harness;
beforeEach(async () => {
  await h?.close();
  h = await createHarness();
});
afterAll(() => h.close());

const actions = (rewards: Json) => rewards.entries.map((e: Json) => e.action);

describe('"I\'m here"', () => {
  it('opens 30 minutes before the meeting time, and the first tap counts', async () => {
    const { member, rally } = await formedGroup(h);
    await setMeetAt(h, rally.id, 45);
    const early = await member.request('POST', `/rallies/${rally.id}/arrive`);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('TOO_EARLY');

    await setMeetAt(h, rally.id, 10);
    const first = await member.post(`/rallies/${rally.id}/arrive`);
    const second = await member.post(`/rallies/${rally.id}/arrive`);
    expect(second.arrivedAt).toBe(first.arrivedAt);

    const room = await member.get(`/rallies/${rally.id}/room`);
    expect(room.members.find((m: Json) => m.userId === member.id).arrived).toBe(true);
    expect(room.meetAt).toBeTruthy();
  });

  it('hides the rally from anyone outside it', async () => {
    const { rally } = await formedGroup(h);
    const stranger = await h.onboarded(did('stranger'));
    expect((await stranger.request('POST', `/rallies/${rally.id}/arrive`)).statusCode).toBe(404);
  });
});

describe('meeting time', () => {
  it('must fall inside the window and locks when the group forms', async () => {
    const host = await h.onboarded(did('host'), { optInMatching: false });
    const rally = await h.rally(host, { capacity: 2 });
    const outside = await host.request('PATCH', `/rallies/${rally.id}`, {
      expectedVersion: rally.version,
      meetAt: hoursFromNow(10),
    });
    expect(outside.statusCode).toBe(422);
    const updated = await host.patch(`/rallies/${rally.id}`, {
      expectedVersion: rally.version,
      meetAt: hoursFromNow(2),
    });
    expect(new Date(updated.meetAt).getTime()).toBeGreaterThan(new Date(updated.windowStart).getTime());

    const formed = await formedGroup(h);
    const current = await formed.host.get(`/rallies/${formed.rally.id}`);
    const locked = await formed.host.request('PATCH', `/rallies/${formed.rally.id}`, {
      expectedVersion: current.version,
      meetAt: hoursFromNow(2),
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('SCHEDULE_LOCKED');
  });
});

describe('check-in points', () => {
  const checkIn = (host: TestUser, rally: Json, present: string[]) =>
    host.post(`/rallies/${rally.id}/check-in`, { presentUserIds: present });

  it('rewards a tap on time, and never penalises someone who did not tap', async () => {
    const { host, member, rally } = await formedGroup(h);
    await setMeetAt(h, rally.id, -20);
    await tapAt(h, rally.id, member.id, 3);
    await checkIn(host, rally, [member.id]);

    const rewards = await member.get('/me/rewards');
    expect(rewards).toMatchObject({ net: 10, balance: 10, tier: 'New' });
    expect(actions(rewards)).toEqual(['OnTime']);
    expect((await host.get('/me/rewards')).net).toBe(0);
  });

  it('gives nothing between 5 and 15 minutes late', async () => {
    const { host, member, rally } = await formedGroup(h);
    await setMeetAt(h, rally.id, -30);
    await tapAt(h, rally.id, member.id, 10);
    await checkIn(host, rally, [member.id]);
    expect((await member.get('/me/rewards')).net).toBe(0);
  });

  it('penalises more than 15 minutes late against a time the host set', async () => {
    const { host, member, rally } = await formedGroup(h);
    await setMeetAt(h, rally.id, -30);
    await tapAt(h, rally.id, member.id, 20);
    await checkIn(host, rally, [member.id]);
    const rewards = await member.get('/me/rewards');
    expect(rewards.net).toBe(-5);
    expect(rewards.tier).toBe('Rebuilding');
    expect(actions(rewards)).toEqual(['Late']);
  });

  it('never calls anyone late against a default start-of-window time', async () => {
    const { host, member, rally } = await formedGroup(h);
    await tapAt(h, rally.id, member.id, 60);
    await checkIn(host, rally, [member.id]);
    expect((await member.get('/me/rewards')).net).toBe(0);
  });

  it('holds a no-show for 24 hours before it counts', async () => {
    // A check-in needs one other present, so a third member is needed to leave one absent.
    const big = await formedThree();
    await checkIn(big.host, big.rally, [big.present.id]);

    let rewards = await big.absent.get('/me/rewards');
    expect(rewards.net).toBe(0);
    expect(rewards.entries[0]).toMatchObject({ action: 'NoShow', state: 'pending', points: -20 });

    expect(await applyDuePenalties(h.app.deps)).toBe(0);
    await h.app.deps.db
      .update(rewardLedger)
      .set({ appliesAt: new Date(Date.now() - 1000) })
      .where(eq(rewardLedger.subjectUserId, big.absent.id));
    expect(await applyDuePenalties(h.app.deps)).toBe(1);

    rewards = await big.absent.get('/me/rewards');
    expect(rewards.net).toBe(-20);
    expect(rewards.entries[0].state).toBe('applied');
  });

  it('earns once per week from the same group', async () => {
    const first = await formedGroup(h);
    await setMeetAt(h, first.rally.id, -20);
    await tapAt(h, first.rally.id, first.member.id, 0);
    await checkIn(first.host, first.rally, [first.member.id]);
    await first.member.post(`/rallies/${first.rally.id}/feedback`, { happened: true, useful: true });

    const second = await formedGroup(
      h,
      { host: first.host, member: first.member },
      { windowStart: hoursFromNow(4), windowEnd: hoursFromNow(6) },
    );
    await setMeetAt(h, second.rally.id, -20);
    await tapAt(h, second.rally.id, first.member.id, 0);
    await checkIn(first.host, second.rally, [first.member.id]);
    await first.member.post(`/rallies/${second.rally.id}/feedback`, { happened: true, useful: true });

    expect((await first.member.get('/me/rewards')).net).toBe(10);
    expect((await first.host.get('/me/rewards')).net).toBe(5);
  });
});

async function formedThree() {
  const present = await h.onboarded(did('present'));
  const absent = await h.onboarded(did('absent'));
  const host = await h.onboarded(did('host'), { optInMatching: false });
  const rally = await h.rally(host, { capacity: 3, groupMin: 3, meetingPoint: 'Lobby' });
  await h.drainOutbox();
  for (const user of [present, absent]) {
    const { matches } = await user.get('/matches');
    const match = matches.find((m: Json) => m.rally.id === rally.id);
    await user.post(`/matches/${match.id}/respond`, { response: 'accept' });
  }
  return { host, present, absent, rally };
}

describe('host completed', () => {
  it('pays the host when the rally completes', async () => {
    const { host, member, rally } = await formedGroup(h);
    await host.post(`/rallies/${rally.id}/check-in`, { presentUserIds: [member.id] });
    await member.post(`/rallies/${rally.id}/feedback`, { happened: true, useful: true });
    const rewards = await host.get('/me/rewards');
    expect(rewards.net).toBe(5);
    expect(actions(rewards)).toEqual(['HostCompleted']);
  });
});

describe('late cancellation', () => {
  it('penalises withdrawing from a formed rally within 2 hours', async () => {
    const third = await formedThree();
    await third.absent.post(`/rallies/${third.rally.id}/withdraw`);
    const rewards = await third.absent.get('/me/rewards');
    expect(rewards.net).toBe(-10);
    expect(actions(rewards)).toEqual(['LateCancel']);
  });

  it('allows cancelling free of charge more than 2 hours before', async () => {
    const { host, rally } = await formedGroup(h, {}, {
      windowStart: hoursFromNow(5),
      windowEnd: hoursFromNow(7),
    });
    await host.post(`/rallies/${rally.id}/cancel`);
    expect((await host.get('/me/rewards')).net).toBe(0);
  });

  it('penalises a host cancelling a formed rally late', async () => {
    const { host, rally } = await formedGroup(h);
    await host.post(`/rallies/${rally.id}/cancel`);
    expect((await host.get('/me/rewards')).net).toBe(-10);
  });
});

describe('host no-show', () => {
  const expire = async (rallyId: string) => {
    await h.app.deps.db
      .update(rallies)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(rallies.id, rallyId));
    await expireRallies(h.app.deps);
  };

  it('holds a no-show for a host who missed a member that tapped', async () => {
    const { host, member, rally } = await formedGroup(h);
    await tapAt(h, rally.id, member.id, 0);
    await expire(rally.id);
    const rewards = await host.get('/me/rewards');
    expect(rewards.entries[0]).toMatchObject({ action: 'NoShow', state: 'pending' });
    expect((await member.get('/me/rewards')).entries).toEqual([]);
  });

  it('penalises nobody when nobody tapped', async () => {
    const { host, member, rally } = await formedGroup(h);
    await expire(rally.id);
    expect((await host.get('/me/rewards')).entries).toEqual([]);
    expect((await member.get('/me/rewards')).entries).toEqual([]);
  });
});

describe('daily cap', () => {
  it('counts only gains, so a penalty cannot buy more earning room', async () => {
    const { host, member, rally } = await formedGroup(h);
    await h.app.deps.db.insert(rewardLedger).values([
      {
        subjectUserId: member.id,
        reason: 'test',
        action: 'Vouched',
        delta: 95,
        policyVersion: 1,
        antiAbuse: 'passed',
        idempotencyKey: `cap-gain:${member.id}`,
      },
      {
        subjectUserId: member.id,
        reason: 'test',
        action: 'NoShow',
        delta: -20,
        policyVersion: 1,
        antiAbuse: 'passed',
        idempotencyKey: `cap-loss:${member.id}`,
      },
    ]);
    await setMeetAt(h, rally.id, -20);
    await tapAt(h, rally.id, member.id, 0);
    await host.post(`/rallies/${rally.id}/check-in`, { presentUserIds: [member.id] });

    const onTime = await h.app.deps.db
      .select()
      .from(rewardLedger)
      .where(sql`${rewardLedger.subjectUserId} = ${member.id} and ${rewardLedger.action} = 'OnTime'`);
    expect(onTime).toEqual([]);
  });
});

describe('tiers', () => {
  it('follows net RALLY', () => {
    expect(tierFor(-1)).toBe('Rebuilding');
    expect(tierFor(0)).toBe('New');
    expect(tierFor(99)).toBe('New');
    expect(tierFor(100)).toBe('Reliable');
    expect(tierFor(499)).toBe('Reliable');
    expect(tierFor(500)).toBe('Trusted');
  });
});
