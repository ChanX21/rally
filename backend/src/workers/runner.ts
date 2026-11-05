import type { Deps } from '../lib/deps.js';
import { processOutboxBatch } from './outbox.js';
import { runScheduledJobs } from './scheduler.js';

export interface Workers {
  stop(): Promise<void>;
}

/** Runs `tick` repeatedly with a pause in between, so runs never overlap. */
function loop(intervalMs: number, tick: () => Promise<unknown>) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = tick().finally(schedule);
    }, intervalMs);
  };
  schedule();

  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}

/** Simple in-process polling, which is all one service needs. */
export function startWorkers(deps: Deps): Workers {
  const guard = (name: string, work: () => Promise<unknown>) => async () => {
    try {
      await work();
    } catch (error) {
      deps.log.error({ err: error, worker: name }, 'worker tick failed');
    }
  };

  let stopping = false;

  const stopOutbox = loop(
    deps.env.OUTBOX_POLL_MS,
    guard('outbox', async () => {
      // Drain quickly while there is a backlog, then fall back to polling.
      while ((await processOutboxBatch(deps)) > 0 && !stopping) {
        /* keep draining */
      }
    }),
  );
  const stopScheduler = loop(
    deps.env.SCHEDULER_INTERVAL_MS,
    guard('scheduler', () => runScheduledJobs(deps)),
  );

  return {
    async stop() {
      stopping = true;
      await Promise.all([stopOutbox(), stopScheduler()]);
    },
  };
}
