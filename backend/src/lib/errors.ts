import { DrizzleQueryError } from 'drizzle-orm';

interface AppErrorOptions {
  /** Returned to the client, so it must be safe to expose. */
  details?: unknown;
  /** Logged only, never returned to the client. */
  cause?: unknown;
}

/** An expected failure whose code and message are safe to return to clients. */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly details: unknown;

  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.details = options.details;
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);

/** The PostgreSQL error code behind a failed query, if there is one. */
export function postgresCode(error: unknown): string | undefined {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  const code = (cause as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

export const UNIQUE_VIOLATION = '23505';
