import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Uses TEST_DATABASE_URL when set; otherwise starts a throwaway PostgreSQL. */
export default async function setup(project: TestProject) {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    project.provide('databaseUrl', external);
    return;
  }

  const databaseDir = await mkdtemp(join(tmpdir(), 'rally-test-pg-'));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    autoRehydrateSymlinks: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: () => {},
  });

  await server.initialise();
  await server.start();
  await server.createDatabase('rally_test');
  project.provide('databaseUrl', `postgres://postgres:postgres@127.0.0.1:${port}/rally_test`);

  return async () => {
    await server.stop();
    await rm(databaseDir, { recursive: true, force: true });
  };
}
