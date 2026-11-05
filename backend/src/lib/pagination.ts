import { z } from 'zod';

import { AppError } from './errors.js';

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export interface Cursor {
  createdAt: Date;
  id: string;
}

const cursorSchema = z.object({ c: z.iso.datetime(), i: z.uuid() });

export function encodeCursor(row: Cursor): string {
  return Buffer.from(JSON.stringify({ c: row.createdAt.toISOString(), i: row.id })).toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string | undefined): Cursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { createdAt: new Date(parsed.c), id: parsed.i };
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not valid');
  }
}

/** Fetch limit + 1 rows, then call this to split off the extra row into a cursor. */
export function page<T extends Cursor>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}
