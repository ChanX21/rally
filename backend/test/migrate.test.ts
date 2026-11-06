import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { runMigrations } from '../src/db/migrate.js';
import { createTestDatabase } from './helpers/db.js';

describe('runMigrations', () => {
  it('records applied migrations and is safe to re-run', async () => {
    const database = await createTestDatabase();
    await runMigrations(database.url);

    const client = postgres(database.url, { max: 1, onnotice: () => {} });
    try {
      const rows = await client`select count(*)::int as count from drizzle.__drizzle_migrations`;
      expect(rows[0]?.count).toBeGreaterThanOrEqual(5);
      const tables = await client`
        select table_name from information_schema.tables where table_schema = 'public'
      `;
      expect(tables.map((row) => row.table_name as string)).toEqual(
        expect.arrayContaining(['users', 'rallies', 'claims', 'offers', 'outbox_events']),
      );
    } finally {
      await client.end();
      await database.drop();
    }
  });
});


it('keeps migration timestamps increasing so upgrades do not skip new migrations', () => {
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { when: number }[] };
  for (let i = 1; i < journal.entries.length; i++) expect(journal.entries[i]!.when).toBeGreaterThan(journal.entries[i - 1]!.when);
});

it('upgrades the existing receipt-free schema without losing stored provider IDs', async () => {
  const database = await createTestDatabase();
  const client = postgres(database.url, { max: 1, onnotice: () => {} });
  try {
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { when: number }[] };
    await client`alter table model_runs drop column rally_id`;
    await client`delete from drizzle.__drizzle_migrations where created_at = ${journal.entries.at(-1)!.when}`;
    await client`insert into model_runs (task, prompt_version, outcome, request_id) values ('intent', 'legacy', 'ok', 'provider-existing-request')`;
    await runMigrations(database.url);
    const rows = await client`select request_id,rally_id from model_runs where request_id = 'provider-existing-request'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rally_id).toBeNull();
  } finally { await client.end(); await database.drop(); }
});
