import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { claims, offers, rallies, rewardLedger } from '../src/db/schema/index.js';
import { applyVerifiedVouch } from '../src/services/feedback.js';
import { expireOffers } from '../src/workers/scheduler.js';
import { createHarness, type Harness, type Json, type TestUser } from './helpers/harness.js';

let h: Harness;
let counter = 0;
const did = (name: string) => `did:privy:${name}-${(counter += 1)}`;

beforeEach(async () => {
  await h?.close();
  h = await createHarness();
});
afterAll(() => h.close());

const respond = (user: TestUser, matchId: string, response: 'accept' | 'decline') =>
  user.request('POST', `/matches/${matchId}/respond`, { response });

async function setUp(candidateCount: number, rallyOptions: Record<string, unknown> = {}) {
  const candidates = await Promise.all(
    Array.from({ length: candidateCount }, (_, i) => h.onboarded(did(`c${i}`))),
  );
  const creator = await h.onboarded(did('creator'), { optInMatching: false });
  const rally: Json = await h.rally(creator, { capacity: candidateCount + 1, ...rallyOptions });
  await h.drainOutbox();
  const matchIds = await Promise.all(
    candidates.map(async (candidate) => {
      const { matches } = await candidate.get('/matches');
      return matches[0]?.id as string;
    }),
  );
  return { candidates, creator, rally, matchIds };
}

const activeClaims = async (rallyId: string) =>
  h.app.deps.db
    .select()
    .from(claims)
    .where(and(eq(claims.rallyId, rallyId), eq(claims.status, 'active')));

describe('accepting', () => {
  it('claims a seat and moves the group through ready to formed', async () => {
    const { candidates, creator, rally, matchIds } = await setUp(1, {
      meetingPoint: 'Hotel lobby, table 7',
    });

    const before = await candidates[0]!.request('GET', `/rallies/${rally.id}/room`);
    expect(before.statusCode).toBe(404);

    const response = await respond(candidates[0]!, matchIds[0]!, 'accept');
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ status: 'accepted' });

    const after = await creator.get(`/rallies/${rally.id}`);
    expect(after).toMatchObject({ status: 'formed', openSeats: 0 });

    const room = await candidates[0]!.get(`/rallies/${rally.id}/room`);
    expect(room.meetingPoint).toBe('Hotel lobby, table 7');
    expect(room.members).toHaveLength(2);
  });

  it('stops at ready until the host sets a meeting point', async () => {
    const { candidates, creator, rally, matchIds } = await setUp(1);
    await respond(candidates[0]!, matchIds[0]!, 'accept');

    const ready = await creator.get(`/rallies/${rally.id}`);
    expect(ready.status).toBe('ready');

    const locked = await candidates[0]!.request('GET', `/rallies/${rally.id}/room`);
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('ROOM_LOCKED');

    const formed = await creator.patch(`/rallies/${rally.id}`, {
      expectedVersion: ready.version,
      meetingPoint: 'Cafe by the entrance',
    });
    expect(formed.status).toBe('formed');
  });

  it('waits for pending offers before becoming ready', async () => {
    const { candidates, creator, rally, matchIds } = await setUp(2);
    await respond(candidates[0]!, matchIds[0]!, 'accept');
    expect((await creator.get(`/rallies/${rally.id}`)).status).toBe('proposed');
    await respond(candidates[1]!, matchIds[1]!, 'decline');
    expect((await creator.get(`/rallies/${rally.id}`)).status).toBe('ready');
  });

  it('never joins anyone without their acceptance', async () => {
    const { rally } = await setUp(2);
    expect(await activeClaims(rally.id)).toHaveLength(1);
  });

  it('is idempotent', async () => {
    const { candidates, rally, matchIds } = await setUp(1);
    const first = await respond(candidates[0]!, matchIds[0]!, 'accept');
    const second = await respond(candidates[0]!, matchIds[0]!, 'accept');
    expect(second.statusCode).toBe(200);
    expect(second.json().data.status).toBe(first.json().data.status);
    expect(await activeClaims(rally.id)).toHaveLength(2);
    const [row] = await h.app.deps.db.select().from(rallies).where(eq(rallies.id, rally.id));
    expect(row?.openSeats).toBe(0);
  });

  it('handles concurrent duplicate accepts from one user', async () => {
    const { candidates, rally, matchIds } = await setUp(1);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => respond(candidates[0]!, matchIds[0]!, 'accept')),
    );
    expect(results.every((result) => result.statusCode === 200)).toBe(true);
    expect(await activeClaims(rally.id)).toHaveLength(2);
    const [row] = await h.app.deps.db.select().from(rallies).where(eq(rallies.id, rally.id));
    expect(row?.openSeats).toBe(0);
  });

  it('refuses someone else\'s match', async () => {
    const { matchIds } = await setUp(1);
    const other = await h.onboarded(did('other'), { optInMatching: false });
    expect((await respond(other, matchIds[0]!, 'accept')).statusCode).toBe(404);
    expect((await other.request('GET', `/matches/${matchIds[0]}`)).statusCode).toBe(404);
  });

  it('cannot decline after accepting, or accept after declining', async () => {
    const { candidates, matchIds } = await setUp(2);
    await respond(candidates[0]!, matchIds[0]!, 'accept');
    const decline = await respond(candidates[0]!, matchIds[0]!, 'decline');
    expect(decline.json().error.code).toBe('ALREADY_ACCEPTED');

    await respond(candidates[1]!, matchIds[1]!, 'decline');
    expect((await respond(candidates[1]!, matchIds[1]!, 'decline')).statusCode).toBe(200);
    const accept = await respond(candidates[1]!, matchIds[1]!, 'accept');
    expect(accept.json().error.code).toBe('OFFER_CLOSED');
  });

  it('rejects expired offers, then cleans them up', async () => {
    const { candidates, creator, rally, matchIds } = await setUp(1);
    await h.app.deps.db
      .update(offers)
      .set({ holdUntil: new Date(Date.now() - 1000) })
      .where(eq(offers.id, matchIds[0]!));

    const late = await respond(candidates[0]!, matchIds[0]!, 'accept');
    expect(late.json().error.code).toBe('OFFER_EXPIRED');
    expect(await activeClaims(rally.id)).toHaveLength(1);

    expect(await expireOffers(h.app.deps)).toBe(1);
    const { matches } = await candidates[0]!.get('/matches');
    expect(matches[0].status).toBe('expired');
    const reopened = await creator.get(`/rallies/${rally.id}`);
    expect(reopened.status).toBe('open');
    expect(reopened.openSeats).toBe(1);
  });

  it('rejects acceptance on a cancelled rally', async () => {
    const { candidates, creator, rally, matchIds } = await setUp(1);
    await creator.post(`/rallies/${rally.id}/cancel`);
    const response = await respond(candidates[0]!, matchIds[0]!, 'accept');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('OFFER_CLOSED');
  });

  it('rejects a schedule conflict', async () => {
    const { candidates, matchIds } = await setUp(1);
    await h.rally(candidates[0]!, { category: 'coffee', goal: 'Overlap', publish: false });
    const publishLater = await h.app.deps.db
      .select()
      .from(rallies)
      .where(eq(rallies.goal, 'Overlap'));
    await candidates[0]!.post(`/rallies/${publishLater[0]!.id}/publish`);
    const response = await respond(candidates[0]!, matchIds[0]!, 'accept');
    expect(response.json().error.code).toBe('SCHEDULE_CONFLICT');
  });

  it('rejects when a block appeared after the offer', async () => {
    const { candidates, creator, matchIds } = await setUp(1);
    await creator.post('/me/blocks', { userId: candidates[0]!.id });
    const response = await respond(candidates[0]!, matchIds[0]!, 'accept');
    expect(response.json().error.code).toBe('MEMBER_CONFLICT');
  });
});

describe('the last seat', () => {
  it('gives one seat to exactly one of many concurrent accepters', async () => {
    const { candidates, rally, matchIds } = await setUp(8);
    // Leave a single seat, with eight offers outstanding.
    await h.app.deps.db.execute(sql`
      update rally_slots set retired_at = now()
      where rally_id = ${rally.id} and position > 1
    `);
    await h.app.deps.db
      .update(rallies)
      .set({ capacity: 2, openSeats: 1 })
      .where(eq(rallies.id, rally.id));

    const results = await Promise.all(
      candidates.map((candidate, i) => respond(candidate, matchIds[i]!, 'accept')),
    );

    const winners = results.filter((result) => result.statusCode === 200);
    const losers = results.filter((result) => result.statusCode !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(7);
    for (const loser of losers) {
      expect(loser.statusCode).toBe(409);
      expect(loser.json().error.code).toBe('RALLY_FULL');
      expect(loser.json().error.message).toBeTruthy();
    }

    expect(await activeClaims(rally.id)).toHaveLength(2);
    const [row] = await h.app.deps.db.select().from(rallies).where(eq(rallies.id, rally.id));
    expect(row?.openSeats).toBe(0);
  });

  it('fills several seats correctly under load, with no seat counted twice', async () => {
    const { candidates, rally, matchIds } = await setUp(6);
    await h.app.deps.db.execute(sql`
      update rally_slots set retired_at = now()
      where rally_id = ${rally.id} and position > 3
    `);
    await h.app.deps.db
      .update(rallies)
      .set({ capacity: 4, openSeats: 3 })
      .where(eq(rallies.id, rally.id));

    const results = await Promise.all(
      candidates.map((candidate, i) => respond(candidate, matchIds[i]!, 'accept')),
    );
    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(3);

    const active = await activeClaims(rally.id);
    expect(active).toHaveLength(4);
    expect(new Set(active.map((claim) => claim.slotId)).size).toBe(4);
    const [row] = await h.app.deps.db.select().from(rallies).where(eq(rallies.id, rally.id));
    expect(row?.openSeats).toBe(0);
  });

  it('uses PostgreSQL rather than the public listing', async () => {
    const { candidates, rally, matchIds } = await setUp(1);
    const [entity] = [...h.arkiv.entities.values()];
    expect(entity).toBeDefined();
    // Public data claiming no seats must not stop a real seat from being taken.
    entity!.openSeats = 0;
    h.arkiv.failReads = true;
    h.arkiv.failWrites = true;
    const response = await respond(candidates[0]!, matchIds[0]!, 'accept');
    expect(response.statusCode).toBe(200);
    expect(await activeClaims(rally.id)).toHaveLength(2);
  });
});

describe('one person across rallies', () => {
  it('cannot take overlapping seats by racing two accepts', async () => {
    const person = await h.onboarded(did('racer'));
    const hostA = await h.onboarded(did('hostA'), { optInMatching: false });
    const hostB = await h.onboarded(did('hostB'), { optInMatching: false });
    await h.rally(hostA, { goal: 'First' });
    await h.drainOutbox();
    await h.rally(hostB, { goal: 'Second' });
    await h.drainOutbox();

    const { matches } = await person.get('/matches');
    expect(matches).toHaveLength(2);
    const results = await Promise.all(
      matches.map((match: Json) => respond(person, match.id, 'accept')),
    );
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const failed = results.find((result) => result.statusCode === 409);
    expect(failed?.json().error.code).toBe('SCHEDULE_CONFLICT');
  });
});

describe('declining and withdrawing', () => {
  it('reopens and looks for someone else when declines leave too few', async () => {
    const { candidates, creator, rally, matchIds } = await setUp(1);
    await respond(candidates[0]!, matchIds[0]!, 'decline');
    expect((await creator.get(`/rallies/${rally.id}`)).status).toBe('open');

    const replacement = await h.onboarded(did('replacement'));
    await h.drainOutbox();
    const { matches } = await replacement.get('/matches');
    expect(matches).toHaveLength(1);
    expect(matches[0].status).toBe('pending');
    expect(await activeClaims(rally.id)).toHaveLength(1);

    const again = await candidates[0]!.get('/matches');
    expect(again.matches).toHaveLength(1);
    expect(again.matches[0].status).toBe('declined');
  });

  it('releases the seat, reopens below the minimum, and removes room access', async () => {
    const { candidates, creator, rally, matchIds } = await setUp(1, {
      meetingPoint: 'Table 7',
    });
    await respond(candidates[0]!, matchIds[0]!, 'accept');
    expect((await creator.get(`/rallies/${rally.id}`)).status).toBe('formed');

    const withdrawn = await candidates[0]!.post(`/rallies/${rally.id}/withdraw`);
    expect(withdrawn).toMatchObject({ status: 'open', openSeats: 1 });

    const retry = await candidates[0]!.post(`/rallies/${rally.id}/withdraw`);
    expect(retry.openSeats).toBe(1);

    const room = await candidates[0]!.request('GET', `/rallies/${rally.id}/room`);
    expect(room.statusCode).toBe(404);

    const { items } = await creator.get('/notifications');
    expect(items.map((n: Json) => n.type)).toContain('rally.participant_withdrew');

    await h.drainOutbox();
    expect(await activeClaims(rally.id)).toHaveLength(1);
    expect((await candidates[0]!.get('/matches')).matches).toHaveLength(1);
  });

  it('notifies people holding an offer, without accepting for them', async () => {
    const { candidates, rally, matchIds } = await setUp(3, { capacity: 3 });
    const pendingIndex = [0, 1, 2].filter((i) => matchIds[i]);
    expect(pendingIndex).toHaveLength(2);
    const [first, second] = pendingIndex;

    await respond(candidates[first!]!, matchIds[first!]!, 'accept');
    await candidates[first!]!.post(`/rallies/${rally.id}/withdraw`);

    const { items } = await candidates[second!]!.get('/notifications');
    expect(items.map((n: Json) => n.type)).toContain('rally.seat_open');
    expect(await activeClaims(rally.id)).toHaveLength(1);
  });

  it('stops the creator withdrawing', async () => {
    const { creator, rally } = await setUp(1);
    const response = await creator.request('POST', `/rallies/${rally.id}/withdraw`);
    expect(response.json().error.code).toBe('CREATOR_CANNOT_WITHDRAW');
  });
});

describe('after meeting', () => {
  async function formed() {
    const setup = await setUp(2, { meetingPoint: 'Table 7' });
    await respond(setup.candidates[0]!, setup.matchIds[0]!, 'accept');
    await respond(setup.candidates[1]!, setup.matchIds[1]!, 'accept');
    return setup;
  }

  it('opens check-in only once formed', async () => {
    const { creator, rally } = await setUp(1);
    const early = await creator.request('POST', `/rallies/${rally.id}/check-in`, {
      presentUserIds: [],
    });
    expect(early.json().error.code).toBe('INVALID_STATE');
  });

  it('lets only the host check in', async () => {
    const { candidates, rally } = await formed();
    const notHost = await candidates[0]!.request('POST', `/rallies/${rally.id}/check-in`, {
      presentUserIds: [],
    });
    expect(notHost.statusCode).toBe(403);
  });

  it('marks no-shows and validates attendees', async () => {
    const { candidates, creator, rally } = await formed();
    const stranger = await h.onboarded(did('stranger'), { optInMatching: false });
    const bad = await creator.request('POST', `/rallies/${rally.id}/check-in`, {
      presentUserIds: [stranger.id],
    });
    expect(bad.json().error.code).toBe('NOT_A_PARTICIPANT');
    const alone = await creator.request('POST', `/rallies/${rally.id}/check-in`, {
      presentUserIds: [],
    });
    expect(alone.json().error.code).toBe('NOT_ENOUGH_PRESENT');

    const met = await creator.post(`/rallies/${rally.id}/check-in`, {
      presentUserIds: [candidates[0]!.id],
    });
    expect(met.status).toBe('met');

    const absent = await candidates[1]!.request('POST', `/rallies/${rally.id}/feedback`, {
      happened: true,
    });
    expect(absent.statusCode).toBe(404);
    const [noShow] = await h.app.deps.db
      .select()
      .from(claims)
      .where(and(eq(claims.rallyId, rally.id), eq(claims.userId, candidates[1]!.id)));
    expect(noShow?.status).toBe('no_show');
  });

  it('keeps met and completed as separate states', async () => {
    const { candidates, creator, rally } = await formed();
    await creator.post(`/rallies/${rally.id}/check-in`, {
      presentUserIds: [candidates[0]!.id, candidates[1]!.id],
    });
    const notHappened = await candidates[0]!.post(`/rallies/${rally.id}/feedback`, {
      happened: false,
    });
    expect(notHappened.rallyStatus).toBe('met');
    const happened = await candidates[1]!.post(`/rallies/${rally.id}/feedback`, { happened: true });
    expect(happened.rallyStatus).toBe('completed');
  });

  it('rejects self-vouching, and vouching for someone absent', async () => {
    const { candidates, creator, rally } = await formed();
    await creator.post(`/rallies/${rally.id}/check-in`, {
      presentUserIds: [candidates[0]!.id],
    });
    const self = await candidates[0]!.request('POST', `/rallies/${rally.id}/feedback`, {
      happened: true,
      vouches: [{ recipientId: candidates[0]!.id, contribution: 'I was great' }],
    });
    expect(self.json().error.code).toBe('SELF_FEEDBACK');
    const absent = await candidates[0]!.request('POST', `/rallies/${rally.id}/feedback`, {
      happened: true,
      vouches: [{ recipientId: candidates[1]!.id, contribution: 'Helped' }],
    });
    expect(absent.json().error.code).toBe('NOT_PRESENT');
  });

  it('turns a verified vouch into evidence and points exactly once', async () => {
    const { candidates, creator, rally } = await formed();
    await creator.post(`/rallies/${rally.id}/check-in`, {
      presentUserIds: [candidates[0]!.id, candidates[1]!.id],
    });
    const vouch = { recipientId: candidates[1]!.id, contribution: 'Helped my pitch' };
    const body = { happened: true, vouches: [vouch], encoreWith: [candidates[1]!.id] };
    const result = await candidates[0]!.post(`/rallies/${rally.id}/feedback`, body);
    expect(result.vouches[0].verification).toBe('verified');

    // A retried request must not create another vouch.
    const retry = await candidates[0]!.post(`/rallies/${rally.id}/feedback`, body);
    expect(retry.vouches).toEqual([]);

    await h.drainOutbox();
    const rewards = await candidates[1]!.get('/me/rewards');
    expect(rewards.balance).toBe(25);
    expect(rewards.entries[0]).toMatchObject({ reason: 'completed_and_vouched', policyVersion: 1 });

    const me = await candidates[1]!.get('/me');
    expect(me.profile.evidence[0]).toMatchObject({ contribution: 'Helped my pitch' });
    expect(me.profile.inferredTags[0]).toMatchObject({ tag: 'food' });
    expect(me.profile.declaredSkills).toEqual([]);

    const [row] = await h.app.deps.db.execute<{ id: string }>(
      sql`select id from feedback where type = 'vouch' limit 1`,
    );
    await applyVerifiedVouch(h.app.deps, row!.id);
    const entries = await h.app.deps.db.select().from(rewardLedger);
    expect(entries).toHaveLength(1);
  });

  it('flags reciprocal vouches, giving no points', async () => {
    const { candidates, creator, rally } = await formed();
    await creator.post(`/rallies/${rally.id}/check-in`, {
      presentUserIds: [candidates[0]!.id, candidates[1]!.id],
    });
    await candidates[0]!.post(`/rallies/${rally.id}/feedback`, {
      happened: true,
      vouches: [{ recipientId: candidates[1]!.id, contribution: 'Great' }],
    });
    const back = await candidates[1]!.post(`/rallies/${rally.id}/feedback`, {
      happened: true,
      vouches: [{ recipientId: candidates[0]!.id, contribution: 'You too' }],
    });
    expect(back.vouches[0].verification).toBe('flagged');
    await h.drainOutbox();
    expect((await candidates[0]!.get('/me/rewards')).balance).toBe(0);
    expect((await candidates[1]!.get('/me/rewards')).balance).toBe(25);
  });
});

describe('notifications', () => {
  it('lists, marks read, stays private to each user', async () => {
    const { candidates } = await setUp(1);
    const inbox = await candidates[0]!.get('/notifications');
    expect(inbox.unreadCount).toBeGreaterThanOrEqual(1);

    const id = inbox.items[0].id as string;
    const other = await h.onboarded(did('other'), { optInMatching: false });
    expect((await other.request('POST', `/notifications/${id}/read`)).statusCode).toBe(404);

    const read = await candidates[0]!.post(`/notifications/${id}/read`);
    expect(read.readAt).toEqual(expect.any(String));

    await candidates[0]!.post('/notifications/read-all');
    const unread = await candidates[0]!.get('/notifications?unreadOnly=true');
    expect(unread.items).toEqual([]);
    expect(unread.unreadCount).toBe(0);
  });

  it('does not put private details in notification text', async () => {
    const { candidates, matchIds, creator } = await setUp(1, {
      meetingPoint: 'Secret table 7',
    });
    await respond(candidates[0]!, matchIds[0]!, 'accept');
    for (const user of [candidates[0]!, creator]) {
      const response = await user.request('GET', '/notifications');
      expect(response.body).not.toContain('Secret table');
    }
  });
});
