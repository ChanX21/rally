import { and, count, desc, eq, isNull, lt, or } from 'drizzle-orm';

import { notifications } from '../db/schema/index.js';
import type { Deps } from '../lib/deps.js';
import { notFound } from '../lib/errors.js';
import { decodeCursor, page } from '../lib/pagination.js';

function view(row: typeof notifications.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: row.data,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(
  deps: Deps,
  userId: string,
  options: { limit: number; cursor?: string | undefined; unreadOnly: boolean },
) {
  const cursor = decodeCursor(options.cursor);
  const rows = await deps.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        options.unreadOnly ? isNull(notifications.readAt) : undefined,
        cursor
          ? or(
              lt(notifications.createdAt, cursor.createdAt),
              and(eq(notifications.createdAt, cursor.createdAt), lt(notifications.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(options.limit + 1);

  const [unread] = await deps.db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  const { items, nextCursor } = page(rows, options.limit);
  return { items: items.map(view), nextCursor, unreadCount: unread?.value ?? 0 };
}

export async function markRead(deps: Deps, userId: string, id: string) {
  const [row] = await deps.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  if (!row) throw notFound('Notification');
  if (row.readAt) return view(row);

  const [updated] = await deps.db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(eq(notifications.id, id))
    .returning();
  return view(updated!);
}

export async function markAllRead(deps: Deps, userId: string) {
  const updated = await deps.db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return { updated: updated.length };
}
