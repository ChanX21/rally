import { notifications } from '../db/schema/index.js';
import type { Db } from './db-types.js';

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Stops retries from delivering the same message twice. */
  dedupeKey: string;
}

export async function notify(db: Db, ...items: NotificationInput[]): Promise<void> {
  if (items.length === 0) return;
  await db
    .insert(notifications)
    .values(items.map((item) => ({ ...item, data: item.data ?? {} })))
    .onConflictDoNothing();
}
