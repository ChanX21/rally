import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outboxEvents } from '../src/db/schema/index.js';
import { enqueue } from '../src/lib/outbox.js';
import { PermanentError } from '../src/workers/handlers.js';
import { processOutboxBatch, recoverStaleEvents } from '../src/workers/outbox.js';
import { runScheduledJobs } from '../src/workers/scheduler.js';
import { startWorkers } from '../src/workers/runner.js';
import { createHarness, type Harness } from './helpers/harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(async () => {
  await h.app.deps.db.delete(outboxEvents);
});

const single = async () => {
  const rows = await h.app.deps.db.select().from(outboxEvents);
  expect(rows).toHaveLength(1);
  return rows[0]!;
};
const add = (dedupeKey?: string) =>
  enqueue(h.app.deps.db, {
    type: 'arkiv.sync',
    payload: { n: 1 },
    ...(dedupeKey ? { dedupeKey } : {}),
  });
const makeDue = (id: string) =>
  h.app.deps.db
    .update(outboxEvents)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(eq(outboxEvents.id, id));

describe('outbox processing', () => {
  it('marks handled events done', async () => {
    await add();
    const seen: unknown[] = [];
    const count = await processOutboxBatch(h.app.deps, {
      'arkiv.sync': (_deps, payload) => {
        seen.push(payload);
        return Promise.resolve();
      },
    });
    expect(count).toBe(1);
    expect(seen).toEqual([{ n: 1 }]);
    const event = await single();
    expect(event).toMatchObject({ status: 'done', attempts: 1, lastError: null });
    expect(event.processedAt).toBeInstanceOf(Date);
  });

  it('deduplicates events sharing a key', async () => {
    await add('same');
    await add('same');
    await single();
  });

  it('retries with backoff, then succeeds', async () => {
    await add();
    let calls = 0;
    const handlers = {
      'arkiv.sync': () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('RPC 503')) : Promise.resolve();
      },
    };

    await processOutboxBatch(h.app.deps, handlers);
    const retrying = await single();
    expect(retrying).toMatchObject({ status: 'pending', attempts: 1, lastError: 'RPC 503' });
    expect(retrying.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Not due yet, so nothing is claimed.
    expect(await processOutboxBatch(h.app.deps, handlers)).toBe(0);

    await makeDue(retrying.id);
    await processOutboxBatch(h.app.deps, handlers);
    expect(await single()).toMatchObject({ status: 'done', attempts: 2 });
    expect(calls).toBe(2);
  });

  it('gives up after max attempts and keeps the error', async () => {
    await add();
    const { id } = await single();
    await h.app.deps.db.update(outboxEvents).set({ maxAttempts: 2 }).where(eq(outboxEvents.id, id));
    const handlers = { 'arkiv.sync': () => Promise.reject(new Error('still down')) };

    await processOutboxBatch(h.app.deps, handlers);
    await makeDue(id);
    await processOutboxBatch(h.app.deps, handlers);
    expect(await single()).toMatchObject({
      status: 'dead',
      attempts: 2,
      lastError: 'still down',
    });
    await makeDue(id);
    expect(await processOutboxBatch(h.app.deps, handlers)).toBe(0);
  });

  it('does not retry permanent failures', async () => {
    await add();
    await processOutboxBatch(h.app.deps, {
      'arkiv.sync': () => Promise.reject(new PermanentError('bad payload')),
    });
    expect(await single()).toMatchObject({ status: 'dead', attempts: 1 });
  });

  it('treats an unknown event type as dead', async () => {
    await h.app.deps.db.insert(outboxEvents).values({ type: 'unknown.event', payload: {} });
    await processOutboxBatch(h.app.deps);
    expect(await single()).toMatchObject({ status: 'dead' });
  });

  it('rejects invalid payloads permanently through the real handlers', async () => {
    await add();
    await processOutboxBatch(h.app.deps);
    expect(await single()).toMatchObject({ status: 'dead', lastError: 'Invalid outbox payload' });
  });

  it('never gives an event to two concurrent workers', async () => {
    for (let i = 0; i < 25; i += 1) await add();
    const seen: string[] = [];
    const handlers = {
      'arkiv.sync': (_deps: unknown, payload: unknown) => {
        seen.push(JSON.stringify(payload));
        return Promise.resolve();
      },
    };
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while ((await processOutboxBatch(h.app.deps, handlers)) > 0) {
          /* drain */
        }
      }),
    );
    expect(seen).toHaveLength(25);
    const rows = await h.app.deps.db.select().from(outboxEvents);
    expect(rows.every((row) => row.status === 'done' && row.attempts === 1)).toBe(true);
  });

  it('recovers events from a crashed worker', async () => {
    await add();
    const { id } = await single();
    await h.app.deps.db
      .update(outboxEvents)
      .set({
        status: 'processing',
        attempts: 1,
        lockedUntil: sql`now() - interval '1 second'`,
      })
      .where(eq(outboxEvents.id, id));

    expect(await recoverStaleEvents(h.app.deps)).toBe(1);
    expect(await single()).toMatchObject({ status: 'pending', lockedUntil: null });
  });

  it('leaves events with a live lease alone', async () => {
    await add();
    const { id } = await single();
    await h.app.deps.db
      .update(outboxEvents)
      .set({ status: 'processing', lockedUntil: sql`now() + interval '1 minute'` })
      .where(eq(outboxEvents.id, id));
    expect(await recoverStaleEvents(h.app.deps)).toBe(0);
  });
});

describe('scheduler and runner', () => {
  it('cleans up old finished events but keeps dead ones', async () => {
    await add('old-done');
    await add('old-dead');
    await h.app.deps.db.execute(sql`
      update outbox_events
      set status = case when dedupe_key = 'old-done' then 'done' else 'dead' end::outbox_status,
          processed_at = now() - interval '30 days'
    `);
    await runScheduledJobs(h.app.deps);
    const rows = await h.app.deps.db.select().from(outboxEvents);
    expect(rows.map((row) => row.dedupeKey)).toEqual(['old-dead']);
  });

  it('runs in the background and stops cleanly', async () => {
    await enqueue(h.app.deps.db, {
      type: 'rally.published',
      payload: { rallyId: '00000000-0000-4000-8000-000000000000' },
    });
    const deps = {
      ...h.app.deps,
      env: { ...h.app.deps.env, OUTBOX_POLL_MS: 20, SCHEDULER_INTERVAL_MS: 1000 },
    };
    const workers = startWorkers(deps);
    await expect
      .poll(async () => (await single()).status, { timeout: 5000, interval: 25 })
      .toBe('done');
    await workers.stop();
  });
});
