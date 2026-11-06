import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Database } from '../db/client.js';
import { modelRuns } from '../db/schema/index.js';
import type { Infer } from '../integrations/zero-g.js';
import { createFormationEngine, type FormationEngine, type Trace } from './formation.js';

export interface FormationRun<T> {
  result: T;
  /** Null when the engine answered without calling a model. */
  modelRunId: string | null;
  requestId: string | null;
}

export type FormationRunner = <T>(
  call: (engine: FormationEngine, runId: string) => Promise<T>,
) => Promise<FormationRun<T>>;

function outcomeOf(trace: Trace): (typeof modelRuns.$inferInsert)['outcome'] {
  switch (trace.result) {
    case 'valid':
      return 'ok';
    case 'timeout':
      return 'timeout';
    case 'invalid_output':
      return 'invalid_output';
    default:
      // The adapter gives no reason only when credentials are missing.
      return trace.diagnostics?.reason ? 'upstream_error' : 'not_configured';
  }
}

/**
 * Calls the Formation Engine and records the attempt, so proposals and intents can reference their
 * evidence. The engine's trace holds only metadata: never prompts, answers, candidates or replies.
 */
export function createFormationRunner(
  infer: Infer,
  db: Database,
  log: FastifyBaseLogger,
  visionInfer: Infer = infer,
): FormationRunner {
  return async (call) => {
    const runId = randomUUID();
    let trace: Trace | undefined;
    const engine = createFormationEngine(infer, (value) => {
      trace = value;
      log.info(value, 'formation inference');
    }, visionInfer);

    const result = await call(engine, runId);
    const recorded = trace;
    if (!recorded) return { result, modelRunId: null, requestId: null };

    const requestId =
      recorded.providerRequestId ?? recorded.diagnostics?.providerRequestId ?? null;
    const { reason, httpStatus } = recorded.diagnostics ?? {};
    await db.insert(modelRuns).values({
      id: runId,
      task: recorded.task,
      promptVersion: recorded.promptVersion,
      model: recorded.model ?? null,
      provider: recorded.provider ?? null,
      requestId,
      latencyMs: recorded.latencyMs,
      totalTokens: recorded.tokens ?? null,
      cost: recorded.cost ?? null,
      outcome: outcomeOf(recorded),
      failureReason: reason ? `${reason}${httpStatus ? ` ${httpStatus}` : ''}` : null,
    });
    return { result, modelRunId: runId, requestId };
  };
}
