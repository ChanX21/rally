import type { FastifyBaseLogger } from 'fastify';

interface Closable {
  log: FastifyBaseLogger;
  close(): Promise<unknown>;
}

/**
 * Stops accepting requests, waits for in-flight work, then closes resources via
 * onClose hooks. Handlers use `once`, so a second Ctrl-C force-kills the process.
 */
export function installShutdownHandlers(app: Closable, timeoutMs: number): void {
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ reason }, 'shutting down');

    const forceExit = setTimeout(() => {
      app.log.error({ timeoutMs }, 'graceful shutdown timed out');
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();

    try {
      await app.close();
      app.log.info('shutdown complete');
      process.exitCode = exitCode;
    } catch (error) {
      app.log.error({ err: error }, 'shutdown failed');
      process.exitCode = 1;
    } finally {
      clearTimeout(forceExit);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void shutdown(signal, 0));
  }

  process.on('uncaughtException', (error) => {
    app.log.fatal({ err: error }, 'uncaught exception');
    void shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ err: reason }, 'unhandled rejection');
    void shutdown('unhandledRejection', 1);
  });
}
