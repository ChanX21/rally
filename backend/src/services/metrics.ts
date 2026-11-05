import { sql } from 'drizzle-orm';

import type { Deps } from '../lib/deps.js';

async function countsBy(deps: Deps, table: string, column: string) {
  const rows = await deps.db.execute<{ key: string; value: number }>(
    sql.raw(`select ${column}::text as key, count(*)::int as value from ${table} group by 1`),
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/** Playbook pilot funnel plus operational health, with separate denominators. Aggregates only. */
export async function collectMetrics(deps: Deps) {
  const [rally, proposal, offer, outbox, arkiv, aiRuns] = await Promise.all([
    countsBy(deps, 'rallies', 'status'),
    countsBy(deps, 'match_proposals', 'state'),
    countsBy(deps, 'offers', 'status'),
    countsBy(deps, 'outbox_events', 'status'),
    countsBy(deps, 'arkiv_entities', 'sync_status'),
    countsBy(deps, 'model_runs', 'outcome'),
  ]);
  const [users] = await deps.db.execute<{ total: number; onboarded: number; opted_in: number }>(sql`
    select count(*)::int as total,
      count(onboarded_at)::int as onboarded,
      count(*) filter (where opt_in_matching)::int as opted_in
    from users
  `);
  const [oldest] = await deps.db.execute<{ seconds: number | null }>(sql`
    select extract(epoch from now() - min(created_at))::int as seconds
    from outbox_events where status = 'pending'
  `);

  return {
    users: users ?? { total: 0, onboarded: 0, opted_in: 0 },
    rallies: rally,
    proposals: proposal,
    offers: offer,
    outbox: outbox,
    oldestPendingOutboxSeconds: oldest?.seconds ?? null,
    arkivEntities: arkiv,
    aiRuns,
  };
}
