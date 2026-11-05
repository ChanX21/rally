import { buildApp } from './app.js';
import { EnvValidationError, loadEnv } from './config/env.js';
import { installShutdownHandlers } from './lib/shutdown.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp({ env });
  installShutdownHandlers(app, env.SHUTDOWN_TIMEOUT_MS);

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
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
