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
