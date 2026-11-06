import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { arkivEntities, outboxEvents, rallies } from '../src/db/schema/index.js';
import { createArkivGateway, listingSchema } from '../src/integrations/arkiv/index.js';
import { reconcileArkiv, syncRallyListing } from '../src/services/arkiv-sync.js';
import { createHarness, type Harness, hoursFromNow, type Json, type TestUser } from './helpers/harness.js';

let h: Harness;
let creator: TestUser;
let counter = 0;
let publishedCount = 0;

const SAFE_FIELDS = [
  'app',
  'category',
  'entityKey',
  'event',
  'expiresAt',
  'minGroupSize',
  'neededRole',
  'opaqueId',
  'openSeats',
  'startBucket',
  'status',
  'zone',
];

beforeEach(async () => {
  await h?.close();
  publishedCount = 0;
  h = await createHarness();
  creator = await h.onboarded('did:privy:arkiv-creator', {
    displayName: 'Private Creator Name',
    optInMatching: false,
  });
});
afterAll(() => h.close());
beforeEach(() => {
  h.arkiv.failReads = false;
  h.arkiv.failWrites = false;
});

const entityFor = (opaqueId: string) =>
  [...h.arkiv.entities.values()].find((entity) => entity.opaqueId === opaqueId);
const entityRow = async (rallyId: string) => {
  const [row] = await h.app.deps.db
    .select()
    .from(arkivEntities)
    .where(eq(arkivEntities.rallyId, rallyId));
  return row;
};

async function published(overrides: Record<string, unknown> = {}): Promise<Json> {
  const offset = publishedCount++ * 3;
  const rally = await h.rally(creator, {
    windowStart: hoursFromNow(1 + offset), windowEnd: hoursFromNow(3 + offset), ...overrides,
  });
  await h.drainOutbox();
  return creator.get(`/rallies/${rally.id}`);
}

describe('publishing', () => {
  it('publishes public-safe fields only, after commit', async () => {
    const rally = await h.rally(creator, {
      goal: 'Secret goal text',
      meetingPoint: 'Exact table 7',
      meetingBrief: 'Bring your private documents',
    });
    expect(entityFor(rally.opaqueId)).toBeUndefined();

    await h.drainOutbox();
    const entity = entityFor(rally.opaqueId)!;
    expect(Object.keys(entity).sort()).toEqual(SAFE_FIELDS);
    expect(entity).toMatchObject({
      app: 'rally-mumbai',
      event: 'ethglobal-mumbai-2026',
      category: 'food',
      zone: 'venue-nearby',
      openSeats: 2,
      minGroupSize: 2,
      neededRole: 'participant',
    });
    expect(entity.startBucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);

    const text = JSON.stringify(entity);
    for (const secret of [
      'Secret goal',
      'table 7',
      'private documents',
      creator.id,
      creator.did,
      rally.id,
      'Private Creator',
    ]) {
      expect(text).not.toContain(secret);
    }

    const row = await entityRow(rally.id);
    expect(row).toMatchObject({ syncStatus: 'synced', entityKey: entity.entityKey });
    expect(row?.lastTxHash).toEqual(expect.any(String));
  });

  it('does not publish drafts or private rallies', async () => {
    const draft = await h.rally(creator, { publish: false });
    const privateRally = await published({ visibility: 'private' });
    await h.drainOutbox();
    expect(entityFor(draft.opaqueId)).toBeUndefined();
    expect(entityFor(privateRally.opaqueId)).toBeUndefined();
    expect(await syncRallyListing(h.app.deps, privateRally.id)).toBe('skipped');
  });
});

describe('updates', () => {
  it('patches when seats change, and deletes when closed', async () => {
    const candidate = await h.onboarded(`did:privy:arkiv-c${(counter += 1)}`);
    const rally = await published({ capacity: 2 });
    expect(entityFor(rally.opaqueId)?.openSeats).toBe(1);
    expect(entityFor(rally.opaqueId)?.status).toBe('filling');

    const { matches } = await candidate.get('/matches');
    await candidate.post(`/matches/${matches[0].id}/respond`, { response: 'accept' });
    await h.drainOutbox();
    expect(entityFor(rally.opaqueId)).toMatchObject({ openSeats: 0, status: 'full' });

    await creator.post(`/rallies/${rally.id}/cancel`);
    await h.drainOutbox();
    expect(entityFor(rally.opaqueId)).toBeUndefined();
    expect(await entityRow(rally.id)).toMatchObject({ syncStatus: 'deleted' });
  });

  it('writes nothing when already in sync', async () => {
    const rally = await published();
    const writes = h.arkiv.writes.length;
    expect(await syncRallyListing(h.app.deps, rally.id)).toBe('unchanged');
    expect(h.arkiv.writes.length).toBe(writes);
  });

  it('extends when the deadline moves later, since patches cannot', async () => {
    const rally = await published();
    const later = new Date(Date.now() + 8 * 3_600_000).toISOString();
    await creator.patch(`/rallies/${rally.id}`, {
      expectedVersion: rally.version,
      windowEnd: later,
    });
    await h.drainOutbox();
    expect(h.arkiv.writes).toContain(`extend:${rally.opaqueId}`);
    expect(entityFor(rally.opaqueId)?.expiresAt.toISOString()).toBe(later);
  });

  it('removes a listing on expiry', async () => {
    const rally = await published();
    await h.app.deps.db
      .update(rallies)
      .set({ status: 'expired', version: rally.version + 1 })
      .where(eq(rallies.id, rally.id));
    expect(await syncRallyListing(h.app.deps, rally.id)).toBe('deleted');
    expect(entityFor(rally.opaqueId)).toBeUndefined();
  });
});

describe('failures', () => {
  it('does not stop a user-facing action, and converges on retry', async () => {
    h.arkiv.failWrites = true;
    const rally = await h.rally(creator);
    expect(rally.status).toBe('open');
    await h.drainOutbox();

    expect(entityFor(rally.opaqueId)).toBeUndefined();
    const row = await entityRow(rally.id);
    expect(row).toMatchObject({ syncStatus: 'pending', lastError: 'RPC unavailable' });

    const [event] = await h.app.deps.db
      .select()
      .from(outboxEvents)
      .where(
        sql`${outboxEvents.type} = 'arkiv.sync' and ${outboxEvents.payload}->>'rallyId' = ${rally.id}`,
      );
    expect(event).toMatchObject({ status: 'pending', attempts: 1 });

    h.arkiv.failWrites = false;
    await h.app.deps.db
      .update(outboxEvents)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(outboxEvents.id, event!.id));
    await h.drainOutbox();

    expect(entityFor(rally.opaqueId)).toBeDefined();
    expect(await entityRow(rally.id)).toMatchObject({ syncStatus: 'synced', lastError: null });
  });

  it('adopts an entity after a crash between chain write and commit', async () => {
    const rally = await published();
    const entity = entityFor(rally.opaqueId)!;
    await h.app.deps.db.delete(arkivEntities).where(eq(arkivEntities.rallyId, rally.id));

    expect(await syncRallyListing(h.app.deps, rally.id)).toBe('adopted');
    const copies = [...h.arkiv.entities.values()].filter((e) => e.opaqueId === rally.opaqueId);
    expect(copies).toHaveLength(1);
    expect((await entityRow(rally.id))?.entityKey).toBe(entity.entityKey);
  });

  it('skips cleanly with no relayer configured', async () => {
    const saved = h.app.deps.arkiv;
    h.app.deps.arkiv = null;
    try {
      expect(await syncRallyListing(h.app.deps, '00000000-0000-4000-8000-000000000000')).toBe('skipped');
      expect(await reconcileArkiv(h.app.deps)).toBe(0);
    } finally {
      h.app.deps.arkiv = saved;
    }
  });

  it('lets only one worker use the relayer at a time', async () => {
    const rally = await published();
    await h.app.deps.db
      .update(arkivEntities)
      .set({ syncStatus: 'pending' })
      .where(eq(arkivEntities.rallyId, rally.id));

    await h.app.deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(7794095)`);
      await expect(syncRallyListing(h.app.deps, rally.id)).rejects.toThrow(/Another worker/);
    });
    expect(await syncRallyListing(h.app.deps, rally.id)).not.toBe('skipped');
  });
});

describe('reconciliation', () => {
  it('re-enqueues missing and out-of-date listings, not healthy ones', async () => {
    const healthy = await published({ goal: 'Healthy' });
    const missing = await published({ goal: 'Missing' });
    await h.app.deps.db.delete(arkivEntities).where(eq(arkivEntities.rallyId, missing.id));
    await h.app.deps.db.execute(
      sql`update rallies set updated_at = now() - interval '5 minutes'
          where id in (${healthy.id}, ${missing.id})`,
    );
    await h.drainOutbox();

    expect(await reconcileArkiv(h.app.deps, 500)).toBeGreaterThanOrEqual(1);
    const queued = await h.app.deps.db.execute<{ rally_id: string }>(sql`
      select payload->>'rallyId' as rally_id from outbox_events
      where type = 'arkiv.sync' and status = 'pending'
    `);
    const ids = queued.map((row) => row.rally_id);
    expect(ids).toContain(missing.id);
    expect(ids).not.toContain(healthy.id);

    // Already queued, so running again adds no duplicate for it.
    await reconcileArkiv(h.app.deps, 500);
    const again = await h.app.deps.db.execute<{ rally_id: string }>(sql`
      select payload->>'rallyId' as rally_id from outbox_events
      where type = 'arkiv.sync' and status = 'pending'
    `);
    expect(again.filter((row) => row.rally_id === missing.id)).toHaveLength(1);
    await h.drainOutbox();
  });
});

describe('public preview', () => {
  const preview = async (query = '') => {
    const response = await h.app.inject({ url: `/activities/preview${query}` });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data;
  };

  it('needs no login and returns confirmed coarse data', async () => {
    const rally = await published({ category: 'gaming', zone: 'venue-floor-2' });
    const { available, activities } = await preview('?category=gaming&zone=venue-floor-2');
    expect(available).toBe(true);
    const card = activities.find((a: Json) => a.opaqueId === rally.opaqueId);
    expect(card).toMatchObject({ category: 'gaming', zone: 'venue-floor-2', status: 'open' });
    expect(Object.keys(card).sort()).toEqual(
      ['category', 'dialogue', 'minGroupSize', 'neededRole', 'opaqueId', 'openSeats', 'startBucket', 'status', 'zone'],
    );
  });

  it('takes seat counts from PostgreSQL rather than the listing', async () => {
    const rally = await published({ category: 'explore' });
    entityFor(rally.opaqueId)!.openSeats = 99;
    const { activities } = await preview('?category=explore');
    expect(activities.find((a: Json) => a.opaqueId === rally.opaqueId).openSeats).toBe(2);
  });

  it('ties cached AI dialogue to the current title without publishing the raw goal', async () => {
    h.ai.respond = () => ({ schemaVersion: 1, dialogue: 'Pitch me your idea; I will bring the ears.' });
    const rally = await published({ category: 'build', goal: 'Hear my pitch, private email alice@example.com' });
    const { activities } = await preview('?category=build');
    const card = activities.find((a: Json) => a.opaqueId === rally.opaqueId);
    expect(card.dialogue).toBe('Pitch me your idea; I will bring the ears.');
    expect(JSON.stringify(card)).not.toContain('alice@example.com');
    expect(JSON.stringify(h.ai.callsFor('map_dialogue')[0]?.input)).not.toContain('alice@example.com');
    await creator.patch(`/rallies/${rally.id}`, { expectedVersion: rally.version, goal: 'Coffee after building' });
    expect((await preview('?category=build')).activities.find((a: Json) => a.opaqueId === rally.opaqueId).dialogue).toBeNull();
    h.ai.respond = () => ({ schemaVersion: 1, dialogue: 'Refactoring my caffeine levels. Join me?' });
    await h.drainOutbox();
    expect((await preview('?category=build')).activities.find((a: Json) => a.opaqueId === rally.opaqueId).dialogue)
      .toBe('Refactoring my caffeine levels. Join me?');
    expect(h.ai.callsFor('map_dialogue')).toHaveLength(2);
  });

  it('drops a Rally whose expiry passed before the background worker caught up', async () => {
    const rally = await published({ category: 'explore' });
    await h.app.deps.db.update(rallies).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(rallies.id, rally.id));
    expect((await preview('?category=explore')).activities).toEqual([]);
  });

  it('drops listings that are stale or written by someone else', async () => {
    const rally = await published({ category: 'networking' });
    await h.app.deps.db
      .update(rallies)
      .set({ status: 'cancelled' })
      .where(eq(rallies.id, rally.id));
    h.arkiv.entities.set('0xforged', {
      ...entityFor(rally.opaqueId)!,
      entityKey: '0xforged',
      opaqueId: 'rly_forged',
    });
    const { activities } = await preview('?category=networking');
    expect(activities).toEqual([]);
    h.arkiv.entities.delete('0xforged');
  });

  it('paginates by key within the configured page size', async () => {
    for (let i = 0; i < 3; i += 1) await published({ category: 'workshop' });
    const first = await preview('?category=workshop&limit=2');
    expect(first.activities).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await preview(`?category=workshop&limit=2&cursor=${first.nextCursor}`);
    expect(second.activities).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const badCursor = await h.app.inject({ url: '/activities/preview?cursor=drop-table' });
    expect(badCursor.statusCode).toBe(400);
  });

  it('shows a notice when Arkiv is down, or not configured', async () => {
    h.arkiv.failReads = true;
    const down = await preview();
    expect(down).toMatchObject({ available: false, activities: [] });
    expect(down.notice).toMatch(/temporarily unavailable/);

    const saved = h.app.deps.arkiv;
    h.app.deps.arkiv = null;
    expect((await preview()).available).toBe(false);
    h.app.deps.arkiv = saved;
  });
});

describe('real SDK gateway against a local JSON-RPC stub', () => {
  let server: Server;
  let url: string;
  const requests: { method: string; params: unknown[] }[] = [];
  const key = `0x${'ab'.repeat(32)}`;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += String(chunk)));
      req.on('end', () => {
        const parsed = JSON.parse(body) as { id: number; method: string; params: unknown[] };
        requests.push(parsed);
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: { data: [], blockNumber: '0x1', cursor: null },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => {
    requests.length = 0;
  });

  const gateway = () =>
    createArkivGateway({
      privateKey: `0x${'11'.repeat(32)}`,
      accessKey: 'test-access-key',
      rpcUrl: url,
      app: 'rally-mumbai',
      event: 'ethglobal-mumbai-2026',
      schemaName: 'rally-mumbai.activity.v1',
      queryTimeoutMs: 2000,
    })!;

  it('returns no gateway without a relayer key', () => {
    expect(
      createArkivGateway({
        privateKey: undefined,
        accessKey: undefined,
        rpcUrl: url,
        app: 'a',
        event: 'b',
        schemaName: 'c',
        queryTimeoutMs: 1000,
      }),
    ).toBeNull();
  });

  it('fits the attribute limit for a named schema', () => {
    expect(Object.keys(listingSchema('x').columns ?? {}).length).toBeLessThanOrEqual(31);
  });

  it('sends the real query language, scoped to the relayer and event', async () => {
    const result = await gateway().queryListings({
      category: 'food',
      zone: 'venue-nearby',
      startBucket: '2026-11-06T14',
      after: key,
      limit: 40,
    });
    expect(result).toEqual({ listings: [], nextAfter: null });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('arkiv_query');
    const sent = JSON.stringify(requests[0]?.params);
    for (const expected of [
      'rally-mumbai.activity.v1',
      'rally-mumbai',
      'ethglobal-mumbai-2026',
      'food',
      'venue-nearby',
      '2026-11-06T14',
      key,
    ]) {
      expect(sent).toContain(expected);
    }
    // Derived from the private key above: entities from any other writer are excluded.
    expect(sent.toLowerCase()).toContain('$owner');
  });
});
