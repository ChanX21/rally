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
