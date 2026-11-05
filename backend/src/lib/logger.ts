import { DrizzleQueryError } from 'drizzle-orm';

import type { Env } from '../config/env.js';

type SerializedError = {
  type: string;
  message: string;
  stack: string;
  code?: unknown;
  constraint?: unknown;
  statusCode?: unknown;
  cause?: SerializedError;
};

/**
 * Logs an allowlist of error fields. Default serialization would write SQL bind
 * parameters (in DrizzleQueryError's message and stack) and row values (in
 * PostgresError's `detail`) to the logs, and those can hold user data.
 */
export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: String(error), stack: '' };
  }

  const fields = error as Error & {
    code?: unknown;
    constraint_name?: unknown;
    statusCode?: unknown;
  };

  const redacted = error instanceof DrizzleQueryError;
  return {
    type: error.name,
    message: redacted ? `Failed query: ${error.query}` : error.message,
    // A query error's stack starts with its message, which holds the bind parameters.
    stack: redacted ? '' : (error.stack ?? ''),
    ...(fields.code === undefined ? {} : { code: fields.code }),
    ...(fields.constraint_name === undefined ? {} : { constraint: fields.constraint_name }),
    ...(fields.statusCode === undefined ? {} : { statusCode: fields.statusCode }),
    ...(error.cause === undefined ? {} : { cause: serializeError(error.cause) }),
  };
}

export function loggerOptions(env: Env) {
  return {
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    serializers: { err: serializeError },
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };
}
