import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { idempotencyKeys } from '../db/schema/index.js';
import type { Tx } from './db-types.js';
import { AppError } from './errors.js';

interface IdempotencyOptions {
  userId: string;
  scope: string;
  /** The Idempotency-Key header. Without it the work simply runs. */
  key: string | undefined;
  request: unknown;
}

/**
 * Runs `work` once per key. The key row and the work share a transaction, so a failure leaves no
 * trace and may be retried. A concurrent duplicate blocks on the insert until the first commits,
 * then replays its stored response.
 */
export async function withIdempotency<T>(
  db: Database,
  options: IdempotencyOptions,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const { userId, scope, key, request } = options;
  if (key === undefined) return db.transaction(work);

  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(idempotencyKeys)
      .values({ userId, scope, key, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (inserted.length === 0) {
      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.scope, scope),
            eq(idempotencyKeys.key, key),
          ),
        );
      if (existing?.requestHash !== requestHash) {
        throw new AppError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used with a different request',
        );
      }
      return existing.responseBody as T;
    }

    const result = await work(tx);
    await tx
      .update(idempotencyKeys)
      .set({ responseBody: result })
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.key, key),
        ),
      );
    return result;
  });
}
