import { randomBytes } from 'node:crypto';

import postgres from 'postgres';
import { inject } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';

export interface TestDatabase {
  url: string;
  drop(): Promise<void>;
}

/** A migrated database of its own, so test files can run in parallel. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('databaseUrl');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());

  return {
    url: url.toString(),
    async drop() {
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
