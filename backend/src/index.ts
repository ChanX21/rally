import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { EnvValidationError, loadEnv } from './config/env.js';
import { installShutdownHandlers } from './lib/shutdown.js';
import { startWorkers, type Workers } from './workers/runner.js';

async function main(): Promise<void> {
  const env = loadEnv();
  // Direct node startup must not serve code against an older database schema.
  await runMigrations(env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL);
  const app = await buildApp({ env });

  // Runs before the database pool closes, so a tick in progress can finish its work.
  let workers: Workers | undefined;
  app.addHook('preClose', async () => {
    await workers?.stop();
  });
  installShutdownHandlers(app, env.SHUTDOWN_TIMEOUT_MS);

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    if (env.WORKERS_ENABLED) {
      workers = startWorkers(app.deps);
      app.log.info('workers started');
    }
  } catch (error) {
    app.log.fatal({ err: error }, 'failed to start server');
    await app.close();
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof EnvValidationError ? error.message : error);
  process.exitCode = 1;
});
