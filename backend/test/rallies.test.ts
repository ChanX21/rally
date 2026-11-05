import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { claims, outboxEvents, rallies, rallySlots } from '../src/db/schema/index.js';
import { notify } from '../src/lib/notify.js';
import { lockRally } from '../src/repositories/rallies.js';
import { lockUser } from '../src/repositories/users.js';
import { expireIntents, expireRallies } from '../src/workers/scheduler.js';
import { createHarness, type Harness, hoursFromNow, type TestUser } from './helpers/harness.js';

let h: Harness;
let creator: TestUser;
let stranger: TestUser;

beforeAll(async () => {
  h = await createHarness();
  creator = await h.onboarded('did:privy:creator', { optInMatching: false });
  stranger = await h.onboarded('did:privy:stranger', { optInMatching: false });
});
afterAll(() => h.close());

const expectError = async (
  response: Promise<{ statusCode: number; json: () => { error: { code: string } } }>,
  status: number,
  code: string,
) => {
  const result = await response;
  expect(result.statusCode).toBe(status);
  expect(result.json().error.code).toBe(code);
};

describe('onboarding', () => {
  it('requires three distinct catalog interests', async () => {
    const user = await h.user('did:privy:ob1');
    const answer = (interests: string[]) =>
      user.request('POST', '/onboarding/complete', { interests, optInMatching: false });
    expect((await answer(['food', 'coffee'])).statusCode).toBe(400);
    expect((await answer(['food', 'coffee', 'nonsense'])).statusCode).toBe(400);
    await expectError(answer(['food', 'food', 'coffee']), 422, 'INVALID_INTERESTS');
  });

  it('caps answers at three and requires availability to opt in', async () => {
    const user = await h.user('did:privy:ob2');
    const answers = [1, 2, 3, 4].map((n) => ({ questionId: `q${n}`, answer: 'a' }));
    const tooMany = await user.request('POST', '/onboarding/complete', {
      interests: ['food', 'coffee', 'gaming'],
      answers,
      optInMatching: false,
    });
    expect(tooMany.statusCode).toBe(400);

    await expectError(
      user.request('POST', '/onboarding/complete', {
        interests: ['food', 'coffee', 'gaming'],
        optInMatching: true,
      }),
      422,
      'AVAILABILITY_REQUIRED',
    );
  });

  it('versions the profile and records onboarding once', async () => {
    const user = await h.onboarded('did:privy:ob3');
    await expectError(
      user.request('POST', '/onboarding/complete', {
        interests: ['food', 'coffee', 'gaming'],
        optInMatching: false,
      }),
      409,
      'ALREADY_ONBOARDED',
    );

    const updated = await user.patch('/me/profile', {
      interests: ['build', 'coffee', 'gaming'],
      declaredSkills: ['reviewer'],
    });
    expect(updated.profile).toMatchObject({ version: 2, interestsVersion: 2 });
    expect(updated.profile.availableFrom).not.toBeNull();

    const me = await user.get('/me');
    expect(me.profile.interests).toEqual(['build', 'coffee', 'gaming']);
  });

  it('falls back to template questions without AI, and accepts only known templates from AI', async () => {
    const user = await h.user('did:privy:ob4');
    const body = { interests: ['food', 'coffee', 'gaming'] };

    h.ai.respond = () => {
      throw new Error('down');
    };
    const fallback = await user.post('/onboarding/questions', body);
    expect(fallback.source).toBe('fallback');
    expect(fallback.questions).toHaveLength(3);

    h.ai.respond = () => ({ questionIds: ['made_up'] });
    expect((await user.post('/onboarding/questions', body)).source).toBe('fallback');

    h.ai.respond = () => ({ questionIds: ['group_size', 'skill_offer'] });
    const chosen = await user.post('/onboarding/questions', body);
    expect(chosen.source).toBe('ai');
    expect(chosen.questions.map((q: { id: string }) => q.id)).toEqual(['group_size', 'skill_offer']);
    expect(chosen.aiRequestId).toMatch(/^req_/);
  });
});

describe('creating rallies', () => {
  it('requires onboarding', async () => {
    const newcomer = await h.user('did:privy:newcomer');
    const response = await newcomer.request('POST', '/rallies', {
      category: 'food',
      goal: 'x',
      windowStart: hoursFromNow(1),
      windowEnd: hoursFromNow(2),
      durationMin: 30,
      zone: 'venue-nearby',
      groupMin: 2,
      capacity: 2,
    });
    expect(response.json().error.code).toBe('NOT_ONBOARDED');
  });

  it('creates a draft with the host seated', async () => {
    const rally = await h.rally(creator, { publish: false, capacity: 4 });
    expect(rally).toMatchObject({ status: 'draft', capacity: 4, openSeats: 3 });
    expect(rally.opaqueId).toMatch(/^rly_/);
    expect(rally.opaqueId).not.toContain(rally.id);

    const participants = await creator.get(`/rallies/${rally.id}/participants`);
    expect(participants).toMatchObject([{ userId: creator.id, role: 'host' }]);
  });

  it.each([
    [{ windowEnd: hoursFromNow(-1), windowStart: hoursFromNow(-2) }, 'INVALID_WINDOW'],
    [{ windowStart: hoursFromNow(3), windowEnd: hoursFromNow(2) }, 'INVALID_WINDOW'],
    [{ durationMin: 400 }, 'INVALID_DURATION'],
    [{ zone: 'hotel-room-402' }, 'INVALID_ZONE'],
    [{ groupMin: 5, capacity: 3 }, 'INVALID_GROUP'],
    [{ slotRoles: ['buddy'], capacity: 4 }, 'INVALID_ROLES'],
  ])('rejects %j', async (overrides, code) => {
    await expectError(
      creator.request('POST', '/rallies', {
        category: 'food',
        goal: 'x',
        windowStart: hoursFromNow(1),
        windowEnd: hoursFromNow(3),
        durationMin: 45,
        zone: 'venue-nearby',
        groupMin: 2,
        capacity: 3,
        ...overrides,
      }),
      422,
      code,
    );
  });

  it('forces sensitive categories private and never lists them', async () => {
    const rally = await h.rally(creator, { category: 'support', visibility: 'public_coarse' });
    expect(rally.visibility).toBe('private');
    const writes = h.arkiv.writes.length;
    await h.drainOutbox();
    expect(h.arkiv.writes.slice(writes).filter((w) => w.includes(rally.opaqueId))).toEqual([]);
  });

  it('never returns the exact meeting point from the rally endpoints', async () => {
    const rally = await h.rally(creator, { meetingPoint: 'Hotel lobby, table 7', publish: false });
    expect(rally.hasMeetingPoint).toBe(true);
    const response = await creator.request('GET', `/rallies/${rally.id}`);
    expect(response.body).not.toContain('table 7');
  });
});

describe('idempotent creation', () => {
  const body = () => ({
    category: 'food',
    goal: 'Idempotent run',
    windowStart: '2099-01-01T10:00:00.000Z',
    windowEnd: '2099-01-01T12:00:00.000Z',
    durationMin: 45,
    zone: 'venue-nearby',
    groupMin: 2,
    capacity: 3,
  });

  it('rejects windows too far ahead', async () => {
    await expectError(
      creator.request('POST', '/rallies', body()),
      422,
      'INVALID_WINDOW',
    );
  });

  it('creates once for concurrent retries with the same key', async () => {
    const payload = {
      ...body(),
      windowStart: hoursFromNow(1),
      windowEnd: hoursFromNow(3),
    };
    const headers = { 'idempotency-key': 'retry-key-0001' };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => creator.post('/rallies', payload, headers)),
    );
    expect(new Set(results.map((rally) => rally.id)).size).toBe(1);

    const [row] = await h.app.deps.db
      .select({ value: sql<number>`count(*)::int` })
      .from(rallies)
      .where(eq(rallies.goal, 'Idempotent run'));
    expect(row?.value).toBe(1);
  });

  it('rejects a reused key with a different request', async () => {
    const headers = { 'idempotency-key': 'retry-key-0002' };
    const payload = { ...body(), windowStart: hoursFromNow(1), windowEnd: hoursFromNow(3) };
    await creator.post('/rallies', payload, headers);
    await expectError(
      creator.request('POST', '/rallies', { ...payload, goal: 'Different' }, headers),
      422,
      'IDEMPOTENCY_KEY_REUSED',
    );
  });

  it('allows the same key for different users', async () => {
    const headers = { 'idempotency-key': 'retry-key-0003' };
    const payload = { ...body(), windowStart: hoursFromNow(1), windowEnd: hoursFromNow(3) };
    const mine = await creator.post('/rallies', payload, headers);
    const theirs = await stranger.post('/rallies', payload, headers);
    expect(mine.id).not.toBe(theirs.id);
  });
});

describe('authorization', () => {
  it('hides other people\'s rallies entirely', async () => {
    const rally = await h.rally(creator, { publish: false });
    for (const [method, url, payload] of [
      ['GET', `/rallies/${rally.id}`, undefined],
      ['GET', `/rallies/${rally.id}/participants`, undefined],
      ['GET', `/rallies/${rally.id}/room`, undefined],
      ['PATCH', `/rallies/${rally.id}`, { expectedVersion: 1, goal: 'Hijacked' }],
      ['POST', `/rallies/${rally.id}/publish`, {}],
      ['POST', `/rallies/${rally.id}/cancel`, {}],
      ['POST', `/rallies/${rally.id}/withdraw`, {}],
      ['POST', `/rallies/${rally.id}/check-in`, { presentUserIds: [] }],
      ['POST', `/rallies/${rally.id}/feedback`, { happened: true }],
    ] as const) {
      const response = await stranger.request(method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await creator.get(`/rallies/${rally.id}`)).goal).toBe('Late snack run');
  });

  it('lists only my rallies', async () => {
    const mine = await h.rally(creator, { publish: false, goal: 'Only mine' });
    const list = await stranger.get('/rallies?limit=100');
    expect(list.items.map((rally: { id: string }) => rally.id)).not.toContain(mine.id);
  });

  it('paginates', async () => {
    const user = await h.onboarded('did:privy:pager', { optInMatching: false });
    for (let i = 0; i < 3; i += 1) await h.rally(user, { publish: false, goal: `Rally ${i}` });
    const first = await user.get('/rallies?limit=2');
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await user.get(`/rallies?limit=2&cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const response = await user.request('GET', '/rallies?cursor=garbage');
    expect(response.json().error.code).toBe('INVALID_CURSOR');
  });
});

describe('updating', () => {
  it('requires the current version', async () => {
    const rally = await h.rally(creator, { publish: false });
    const updated = await creator.patch(`/rallies/${rally.id}`, {
      expectedVersion: rally.version,
      goal: 'New goal',
    });
    expect(updated.goal).toBe('New goal');
    expect(updated.version).toBe(rally.version + 1);

    await expectError(
      creator.request('PATCH', `/rallies/${rally.id}`, {
        expectedVersion: rally.version,
        goal: 'Stale',
      }),
      409,
      'VERSION_CONFLICT',
    );
  });

  it('resizes seats and refuses to go below participants', async () => {
    const rally = await h.rally(creator, { publish: false, capacity: 4, groupMin: 2 });
    const bigger = await creator.patch(`/rallies/${rally.id}`, {
      expectedVersion: rally.version,
      capacity: 6,
    });
    expect(bigger).toMatchObject({ capacity: 6, openSeats: 5 });

    const smaller = await creator.patch(`/rallies/${rally.id}`, {
      expectedVersion: bigger.version,
      capacity: 2,
    });
    expect(smaller).toMatchObject({ capacity: 2, openSeats: 1 });

    await expectError(
      creator.request('PATCH', `/rallies/${rally.id}`, {
        expectedVersion: smaller.version,
        capacity: 1,
      }),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('cancelling', () => {
  it('releases seats, is repeatable, and blocks further changes', async () => {
    const rally = await h.rally(creator);
    await h.drainOutbox();
    const cancelled = await creator.post(`/rallies/${rally.id}/cancel`);
    expect(cancelled).toMatchObject({ status: 'cancelled', openSeats: rally.capacity });

    const again = await creator.post(`/rallies/${rally.id}/cancel`);
    expect(again.status).toBe('cancelled');

    const active = await h.app.deps.db
      .select()
      .from(claims)
      .where(sql`${claims.rallyId} = ${rally.id} and ${claims.status} = 'active'`);
    expect(active).toEqual([]);

    await expectError(
      creator.request('PATCH', `/rallies/${rally.id}`, {
        expectedVersion: cancelled.version + 1,
        goal: 'x',
      }),
      409,
      'VERSION_CONFLICT',
    );
    await expectError(
      creator.request('PATCH', `/rallies/${rally.id}`, {
        expectedVersion: cancelled.version,
        goal: 'x',
      }),
      409,
      'INVALID_STATE',
    );
  });
});

describe('expiry', () => {
  it('expires overdue rallies once, without reopening', async () => {
    const rally = await h.rally(creator);
    await h.drainOutbox();
    await h.app.deps.db
      .update(rallies)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(rallies.id, rally.id));

    expect(await expireRallies(h.app.deps)).toBeGreaterThanOrEqual(1);
    expect((await creator.get(`/rallies/${rally.id}`)).status).toBe('expired');

    await expectError(
      creator.request('POST', `/rallies/${rally.id}/cancel`),
      409,
      'INVALID_STATE',
    );
  });

  it('expires waiting intents', async () => {
    const user = await h.onboarded('did:privy:expiry');
    h.ai.respond = () => {
      throw new Error('down');
    };
    const { intent } = await user.post('/intents/parse', { text: 'coffee now' });
    await user.post(`/intents/${intent.id}/activate`, {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await h.app.deps.db.execute(
      sql`update intents set expires_at = now() - interval '1 second' where id = ${intent.id}`,
    );
    expect(await expireIntents(h.app.deps)).toBeGreaterThanOrEqual(1);
    const { waiting } = await user.get('/matches');
    expect(waiting).toEqual([]);
  });
});

describe('locking', () => {
  it('does not block foreign key checks while a user or rally is locked', async () => {
    const rally = await h.rally(creator, { publish: false });
    const { db } = h.app.deps;

    await db.transaction(async (tx) => {
      await lockUser(tx, stranger.id);
      await lockRally(tx, rally.id);

      // A separate connection writes rows referencing both. These would hang with FOR UPDATE.
      await notify(db, {
        userId: stranger.id,
        type: 'test',
        title: 't',
        body: 'b',
        dedupeKey: `locking:${rally.id}`,
      });
      await db.insert(rallySlots).values({ rallyId: rally.id, position: 99, role: 'participant' });
    });
  });
});

describe('Supabase Data API exposure', () => {
  it('has row level security on every table, hiding rows from non-owner roles', async () => {
    const { db } = h.app.deps;
    const tables = await db.execute<{ table: string; rls: boolean }>(sql`
      select c.relname as table, c.relrowsecurity as rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `);
    expect(tables.length).toBeGreaterThanOrEqual(18);
    expect(tables.filter((row) => !row.rls).map((row) => row.table)).toEqual([]);

    await db.execute(sql`do $$ begin create role anon_test nologin; exception when duplicate_object then null; end $$`);
    await db.execute(sql`grant usage on schema public to anon_test`);
    await db.execute(sql`grant select on users to anon_test`);

    const owner = await db.execute<{ count: number }>(sql`select count(*)::int as count from users`);
    expect(owner[0]!.count).toBeGreaterThan(0);

    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role anon_test`);
      const anon = await tx.execute<{ count: number }>(sql`select count(*)::int as count from users`);
      expect(anon[0]!.count).toBe(0);
    });
  });
});

describe('atomicity', () => {
  it('rolls back the outbox with the transaction', async () => {
    const before = await h.app.deps.db.select({ id: outboxEvents.id }).from(outboxEvents);
    const rally = await h.rally(creator, { publish: false });
    await h.app.deps.db
      .transaction(async (tx) => {
        await tx.insert(outboxEvents).values({ type: 'arkiv.sync', payload: { rallyId: rally.id } });
        throw new Error('rollback');
      })
      .catch(() => undefined);
    const after = await h.app.deps.db.select({ id: outboxEvents.id }).from(outboxEvents);
    expect(after.length).toBe(before.length);
  });

  it('has database constraints as a last line of defence', async () => {
    const rally = await h.rally(creator, { publish: false });
    const { db } = h.app.deps;
    await expect(
      db.update(rallies).set({ openSeats: -1 }).where(eq(rallies.id, rally.id)),
    ).rejects.toThrow();
    await expect(
      db.update(rallies).set({ openSeats: 99 }).where(eq(rallies.id, rally.id)),
    ).rejects.toThrow();

    const [host] = await db.select().from(claims).where(eq(claims.rallyId, rally.id));
    await expect(
      db.insert(claims).values({ rallyId: rally.id, slotId: host!.slotId, userId: stranger.id }),
    ).rejects.toThrow();
  });
});
