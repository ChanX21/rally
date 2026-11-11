import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { expect, it } from 'vitest';
import { createTestDatabase } from './helpers/db.js';

it('direct server startup applies pending migrations before accepting requests', async () => {
  const database = await createTestDatabase();
  const client = postgres(database.url, { max: 1, onnotice: () => {} });
  const cwd = await mkdtemp(join(tmpdir(), 'rally-startup-'));
  const journal = JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { tag: string; when: number }[] };
  const placeMigration = journal.entries.find(entry => entry.tag === '0010_public_place')!;
  await client`alter table rallies drop column public_place`;
  await client`delete from drizzle.__drizzle_migrations where created_at = ${placeMigration.when}`;
  const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)), fileURLToPath(new URL('../src/index.ts', import.meta.url))], {
    cwd, env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_URL: database.url, DATABASE_MIGRATION_URL: database.url, HOST: '127.0.0.1', PORT: '0', WORKERS_ENABLED: 'false', LOG_LEVEL: 'info' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Server did not become ready')), 10_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Server exited before becoming ready')); });
      child.stdout.on('data', chunk => {
        output += String(chunk);
        const match = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
        if (match) { clearTimeout(timer); resolve(match[1]!); }
      });
    });
    expect((await fetch(`${url}/health/ready`)).status).toBe(200);
    const columns = await client`select column_name from information_schema.columns where table_name='rallies' and column_name='public_place'`;
    expect(columns).toHaveLength(1);
  } finally {
    if (child.exitCode === null) { const closed = once(child, 'close'); child.kill('SIGTERM'); await closed; }
    await client.end(); await database.drop(); await rm(cwd, { recursive: true, force: true });
  }
});
