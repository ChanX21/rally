import { eq, sql } from 'drizzle-orm';

import { outboxEvents } from '../db/schema/index.js';
import type { Deps } from '../lib/deps.js';
import { serializeError } from '../lib/logger.js';
import { type OutboxHandler, handlers as defaultHandlers, PermanentError } from './handlers.js';

// The lease covers the whole batch, which runs in sequence and may include slow AI and chain calls.
export const LEASE_SECONDS = 300;
const BATCH_SIZE = 5;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 5 * 60_000;

type OutboxEvent = typeof outboxEvents.$inferSelect;

/** Exponential with full jitter, so retries against a struggling RPC spread out. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/** SKIP LOCKED lets instances share work, and a lease recovers events from a crashed worker. */
async function claimBatch(deps: Deps): Promise<OutboxEvent[]> {
  const rows = await deps.db
    .update(outboxEvents)
    .set({
      status: 'processing',
      attempts: sql`${outboxEvents.attempts} + 1`,
      lockedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,
    })
    .where(
      sql`${outboxEvents.id} in (
        select id from outbox_events
        where status = 'pending' and next_attempt_at <= now()
        order by next_attempt_at
        limit ${BATCH_SIZE}
        for update skip locked
      )`,
    )
    .returning();
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function recoverStaleEvents(deps: Deps): Promise<number> {
  const rows = await deps.db
    .update(outboxEvents)
    .set({
      status: sql`case when ${outboxEvents.attempts} >= ${outboxEvents.maxAttempts}
        then 'dead'::outbox_status else 'pending'::outbox_status end`,
      lockedUntil: null,
      lastError: 'Lease expired: worker stopped while processing',
    })
    .where(sql`${outboxEvents.status} = 'processing' and ${outboxEvents.lockedUntil} < now()`)
    .returning({ id: outboxEvents.id });
  return rows.length;
}

async function processEvent(
  deps: Deps,
  event: OutboxEvent,
  handlers: Record<string, OutboxHandler>,
): Promise<void> {
  const log = deps.log.child({ eventId: event.id, eventType: event.type, attempt: event.attempts });
  const handler = handlers[event.type];

  try {
    if (!handler) throw new PermanentError(`No handler for ${event.type}`);
    await handler(deps, event.payload);
    await deps.db
      .update(outboxEvents)
      .set({ status: 'done', processedAt: new Date(), lockedUntil: null, lastError: null })
      .where(eq(outboxEvents.id, event.id));
    log.debug('outbox event processed');
  } catch (error) {
    const giveUp = error instanceof PermanentError || event.attempts >= event.maxAttempts;
    const lastError = serializeError(error).message.slice(0, 500);
    await deps.db
      .update(outboxEvents)
      .set(
        giveUp
          ? { status: 'dead', lockedUntil: null, lastError }
          : {
              status: 'pending',
              lockedUntil: null,
              lastError,
              nextAttemptAt: new Date(Date.now() + backoffMs(event.attempts)),
            },
      )
      .where(eq(outboxEvents.id, event.id));
    if (giveUp) log.error({ err: error }, 'outbox event failed permanently');
    else log.warn({ err: error }, 'outbox event failed, will retry');
  }
}

/** Processes due events one at a time. Returns how many were claimed. */
export async function processOutboxBatch(
  deps: Deps,
  handlers: Record<string, OutboxHandler> = defaultHandlers,
): Promise<number> {
  const events = await claimBatch(deps);
  for (const event of events) {
    await processEvent(deps, event, handlers);
  }
  return events.length;
}
