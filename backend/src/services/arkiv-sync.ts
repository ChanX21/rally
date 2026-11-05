import { eq, sql } from 'drizzle-orm';

import { arkivEntities, rallies } from '../db/schema/index.js';
import { TERMINAL, toPublicStatus } from '../domain/rally-state.js';
import { startBucket } from '../domain/time.js';
import type { ListingValues } from '../integrations/arkiv/index.js';
import type { Deps } from '../lib/deps.js';
import { serializeError } from '../lib/logger.js';
import { enqueue } from '../lib/outbox.js';
import { openSlots, type Rally } from '../repositories/rallies.js';

export type SyncResult = 'skipped' | 'unchanged' | 'created' | 'adopted' | 'updated' | 'deleted';

/** Single relayer wallet, so writes are serialized across instances to keep nonces in order. */
const RELAYER_LOCK = 7_794_095;

export class RelayerBusyError extends Error {
  override readonly name = 'RelayerBusyError';
}

/**
 * The privacy boundary: every field here becomes public and stays in chain history. It is built
 * from coarse values only, and takes no user, intent or meeting data.
 */
export function toListing(
  rally: Rally,
  neededRole: string,
  app: string,
  event: string,
): ListingValues {
  return {
    app,
    event,
    opaqueId: rally.opaqueId,
    category: rally.category,
    zone: rally.zone,
    startBucket: startBucket(rally.windowStart),
    neededRole,
    openSeats: rally.openSeats,
    minGroupSize: rally.groupMin,
    status: toPublicStatus(rally.status, rally.openSeats),
  };
}

/**
 * Makes the public listing match PostgreSQL. It reads current state, not an event's snapshot, so
 * retries and duplicates converge. Runs after commit: a failure here never affects joining.
 */
export async function syncRallyListing(deps: Deps, rallyId: string): Promise<SyncResult> {
  const gateway = deps.arkiv;
  if (!gateway?.canWrite) return 'skipped';

  try {
    return await deps.db.transaction(async (tx) => {
      const [lock] = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${RELAYER_LOCK}) as locked`,
      );
      if (!lock?.locked) throw new RelayerBusyError('Another worker is writing to Arkiv');

      const [rally] = await tx.select().from(rallies).where(eq(rallies.id, rallyId));
      if (rally?.visibility !== 'public_coarse' || rally.publishedAt === null) return 'skipped';

      const [entity] = await tx
        .select()
        .from(arkivEntities)
        .where(eq(arkivEntities.rallyId, rallyId));

      const record = async (fields: Partial<typeof arkivEntities.$inferInsert>) => {
        await tx
          .insert(arkivEntities)
          .values({ rallyId, ...fields })
          .onConflictDoUpdate({
            target: arkivEntities.rallyId,
            set: { ...fields, lastError: null },
          });
      };

      if (TERMINAL.includes(rally.status)) {
        if (entity?.syncStatus === 'deleted') return 'unchanged';
        let txHash: string | null = null;
        if (entity?.entityKey) {
          ({ txHash } = await gateway.deleteListing(entity.entityKey));
        }
        await record({
          syncStatus: 'deleted',
          syncedVersion: rally.version,
          syncedAt: new Date(),
          ...(txHash === null ? {} : { lastTxHash: txHash }),
        });
        return 'deleted';
      }

      if (entity?.syncStatus === 'synced' && entity.syncedVersion === rally.version) {
        return 'unchanged';
      }

      const slots = await openSlots(tx, rallyId);
      const listing = toListing(
        rally,
        slots[0]?.role ?? rally.neededRole,
        deps.env.ARKIV_APP,
        deps.env.ARKIV_EVENT,
      );

      // A crash after a chain write but before this commit leaves a live entity with no stored
      // key. Looking it up first means a retry adopts it rather than publishing a duplicate.
      const existingKey =
        entity?.entityKey ?? (await gateway.findByOpaqueId(rally.opaqueId))?.entityKey ?? null;

      let result: SyncResult;
      let entityKey: string;
      let txHash: string;
      let syncedExpiresAt = entity?.syncedExpiresAt ?? null;

      if (existingKey === null) {
        ({ entityKey, txHash } = await gateway.createListing(listing, rally.expiresAt));
        syncedExpiresAt = rally.expiresAt;
        result = 'created';
      } else {
        const { app, event, opaqueId, ...mutable } = listing;
        ({ entityKey, txHash } = await gateway.updateListing(existingKey, mutable));
        result = entity?.entityKey ? 'updated' : 'adopted';
        // Patches never change expiry, and Arkiv cannot shorten it. Terminal rallies get deleted.
        if (syncedExpiresAt === null || rally.expiresAt > syncedExpiresAt) {
          ({ txHash } = await gateway.extendListing(existingKey, rally.expiresAt));
          syncedExpiresAt = rally.expiresAt;
        }
      }

      await record({
        entityKey,
        lastTxHash: txHash,
        syncStatus: 'synced',
        syncedVersion: rally.version,
        syncedExpiresAt,
        syncedAt: new Date(),
      });
      return result;
    });
  } catch (error) {
    if (!(error instanceof RelayerBusyError)) {
      // Recorded outside the rolled-back transaction, and short: RPC errors can be very long.
      await deps.db
        .update(arkivEntities)
        .set({ lastError: serializeError(error).message.slice(0, 500) })
        .where(eq(arkivEntities.rallyId, rallyId));
    }
    throw error;
  }
}

/** Repairs drift after dropped events or downtime. PostgreSQL decides what should exist. */
export async function reconcileArkiv(deps: Deps, limit = 50): Promise<number> {
  if (!deps.arkiv?.canWrite) return 0;
  const rows = await deps.db.execute<{ id: string }>(sql`
    select r.id
    from rallies r
    left join arkiv_entities e on e.rally_id = r.id
    where r.visibility = 'public_coarse'
      and r.published_at is not null
      and (
        (r.status not in ('completed', 'cancelled', 'expired')
          and (e.rally_id is null or e.sync_status <> 'synced' or e.synced_version <> r.version))
        or
        (r.status in ('completed', 'cancelled', 'expired')
          and e.entity_key is not null and e.sync_status <> 'deleted')
      )
      and r.updated_at < now() - interval '1 minute'
      and not exists (
        select 1 from outbox_events o
        where o.type = 'arkiv.sync'
          and o.status in ('pending', 'processing')
          and o.payload->>'rallyId' = r.id::text
      )
    order by r.updated_at
    limit ${limit}
  `);
  for (const row of rows) {
    await enqueue(deps.db, { type: 'arkiv.sync', payload: { rallyId: row.id } });
  }
  return rows.length;
}
