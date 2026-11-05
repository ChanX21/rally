// Real PostgreSQL for local development without Docker. Data lives in .local/postgres.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

const databaseDir = join(import.meta.dirname, '..', '.local', 'postgres');
const port = 54329;
const isNew = !existsSync(join(databaseDir, 'PG_VERSION'));

const server = new EmbeddedPostgres({
  databaseDir,
  port,
  user: 'postgres',
  password: 'postgres',
  persistent: true,
  autoRehydrateSymlinks: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  // Fixed local password, so never listen beyond loopback.
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
  onLog: () => {},
});

if (isNew) await server.initialise();
await server.start();
if (isNew) await server.createDatabase('rally');

console.log(`PostgreSQL ready: postgres://postgres:postgres@127.0.0.1:${port}/rally`);
console.log('Press Ctrl-C to stop.');

const stop = () => {
  void server.stop().then(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
