import postgres from 'postgres';
import { describe, expect, inject, it } from 'vitest';

import { runMigrations } from '../src/db/migrate.js';

describe('runMigrations', () => {
  it('records applied migrations and is safe to re-run', async () => {
    const url = inject('databaseUrl');
    await runMigrations(url);
    await runMigrations(url);

    const client = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const rows = await client`select count(*)::int as count from drizzle.__drizzle_migrations`;
      expect(rows[0]?.count).toBeGreaterThanOrEqual(1);
    } finally {
      await client.end();
    }
  });
});
