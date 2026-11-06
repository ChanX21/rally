import { inArray, sql } from 'drizzle-orm';

import { intents, offers, outboxEvents, rallies } from '../db/schema/index.js';
import { EXPIRABLE } from '../domain/rally-state.js';
import type { Deps } from '../lib/deps.js';
import { lockRally } from '../repositories/rallies.js';
import { reconcileArkiv } from '../services/arkiv-sync.js';
import { queueChainWork } from '../services/chain-sync.js';
import { completeDueRallies } from '../services/completion.js';
import { cleanupProofPhotos } from '../services/proofs.js';
import { expireDisputes } from '../services/disputes.js';
import { expireOffersForRally } from '../services/matches.js';
import { closeRally } from '../services/rally-lifecycle.js';
import { applyDuePenalties, penaliseAbsentHost } from '../services/rewards.js';
import { recoverStaleEvents } from './outbox.js';

const BATCH = 100;

/** Queue each active Rally once per two-minute window, across all service instances. */
export async function queueMatchingSweep(deps: Deps): Promise<number> {
  const queued = await deps.db.execute(sql`
    insert into outbox_events (type, dedupe_key, payload)
    select 'match.reevaluate',
      'match.sweep:' || r.id::text || ':' || floor(extract(epoch from now()) / 120)::text,
      jsonb_build_object('rallyId', r.id)
    from rallies r
    where r.status in ('open', 'waiting', 'proposed')
      and r.published_at is not null and r.open_seats > 0 and r.expires_at > now()
      and not exists (
        select 1 from outbox_events job
        where job.type in ('rally.published', 'match.reevaluate')
          and job.status in ('pending', 'processing') and job.payload->>'rallyId' = r.id::text
      )
    on conflict do nothing
    returning id
  `);
  return queued.length;
}

export async function expireOffers(deps: Deps): Promise<number> {
  const due = await deps.db
    .selectDistinct({ rallyId: offers.rallyId })
    .from(offers)
    .where(sql`${offers.status} = 'pending' and ${offers.holdUntil} <= now()`)
    .limit(BATCH);

  let expired = 0;
  for (const { rallyId } of due) {
    expired += await deps.db.transaction((tx) => expireOffersForRally(tx, rallyId));
  }
  return expired;
}

export async function expireRallies(deps: Deps): Promise<number> {
  const due = await deps.db
    .select({ id: rallies.id })
    .from(rallies)
    .where(
      sql`${rallies.expiresAt} <= now() and ${inArray(rallies.status, [...EXPIRABLE])} and not (${rallies.proofFlow} and ${rallies.status} = 'formed')`,
    )
    .limit(BATCH);

  let expired = 0;
  for (const { id } of due) {
    await deps.db.transaction(async (tx) => {
      const rally = await lockRally(tx, id);
      // Checked again under the lock: the rally may have changed since the query above.
      if (rally && !(rally.proofFlow && rally.status === 'formed') && EXPIRABLE.includes(rally.status) && rally.expiresAt <= new Date()) {
        await penaliseAbsentHost(tx, rally);
        await closeRally(tx, rally, 'expired');
        expired += 1;
      }
    });
  }
  return expired;
}

export async function expireIntents(deps: Deps): Promise<number> {
  const rows = await deps.db
    .update(intents)
    .set({ status: 'expired' })
    .where(sql`${intents.status} = 'waiting' and ${intents.expiresAt} <= now()`)
    .returning({ id: intents.id });
  return rows.length;
}

/** Removes data only once nothing can need it again. Audit records and dead events are kept. */
export async function cleanup(deps: Deps): Promise<void> {
  await deps.db
    .delete(outboxEvents)
    .where(sql`${outboxEvents.status} = 'done' and ${outboxEvents.processedAt} < now() - interval '7 days'`);
  await deps.db.execute(
    sql`delete from idempotency_keys where created_at < now() - interval '2 days'`,
  );
  await deps.db.execute(
    sql`delete from notifications where read_at < now() - interval '30 days'`,
  );
}

/** One job failing must not stop the others. */
export async function runScheduledJobs(deps: Deps): Promise<void> {
  const jobs = {
    recoverStaleEvents,
    expireOffers,
    completeDueRallies,
    expireRallies,
    expireIntents,
    reconcileArkiv,
    applyDuePenalties,
    expireDisputes,
    queueChainWork,
    cleanupProofPhotos,
    cleanup,
  };
  for (const [name, job] of Object.entries(jobs)) {
    try {
      const result = await job(deps);
      if (typeof result === 'number' && result > 0) {
        deps.log.info({ job: name, count: result }, 'scheduled job ran');
      }
    } catch (error) {
      deps.log.error({ err: error, job: name }, 'scheduled job failed');
    }
  }
}
