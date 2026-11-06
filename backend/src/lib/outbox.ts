import { outboxEvents } from '../db/schema/index.js';
import type { Db } from './db-types.js';

export type OutboxEventType =
  | 'rally.published'
  | 'user.onboarded'
  | 'match.reevaluate'
  | 'arkiv.sync'
  | 'proof.assess'
  | 'vouch.verified'
  | 'reward.chain_sync'
  | 'reward.policy_sync'
  | 'dispute.chain_sync';

export interface OutboxEventInput {
  type: OutboxEventType;
  payload: Record<string, unknown>;
  /** Events sharing a key are recorded once. */
  dedupeKey?: string;
  delayMs?: number;
}

/** Call inside the transaction making the state change, so both commit or neither does. */
export async function enqueue(db: Db, event: OutboxEventInput): Promise<void> {
  await db
    .insert(outboxEvents)
    .values({
      type: event.type,
      payload: event.payload,
      ...(event.dedupeKey === undefined ? {} : { dedupeKey: event.dedupeKey }),
      ...(event.delayMs === undefined
        ? {}
        : { nextAttemptAt: new Date(Date.now() + event.delayMs) }),
    })
    .onConflictDoNothing();
}
