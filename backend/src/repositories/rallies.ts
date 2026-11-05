import { and, count, eq, isNull, sql } from 'drizzle-orm';

import { claims, offers, rallies, rallySlots, users } from '../db/schema/index.js';
import type { Db } from '../lib/db-types.js';

export type Rally = typeof rallies.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type Claim = typeof claims.$inferSelect;

export async function findRally(db: Db, rallyId: string): Promise<Rally | undefined> {
  const [rally] = await db.select().from(rallies).where(eq(rallies.id, rallyId));
  return rally;
}

/** Serializes everything changing a rally's seats or status. See lockUser for the lock strength. */
export async function lockRally(db: Db, rallyId: string): Promise<Rally | undefined> {
  const [rally] = await db
    .select()
    .from(rallies)
    .where(eq(rallies.id, rallyId))
    .for('no key update');
  return rally;
}

export async function activeClaim(
  db: Db,
  rallyId: string,
  userId: string,
): Promise<Claim | undefined> {
  const [claim] = await db
    .select()
    .from(claims)
    .where(
      and(eq(claims.rallyId, rallyId), eq(claims.userId, userId), eq(claims.status, 'active')),
    );
  return claim;
}

export async function countActiveClaims(db: Db, rallyId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(claims)
    .where(and(eq(claims.rallyId, rallyId), eq(claims.status, 'active')));
  return row?.value ?? 0;
}

export async function countPendingOffers(db: Db, rallyId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(offers)
    .where(
      and(
        eq(offers.rallyId, rallyId),
        eq(offers.status, 'pending'),
        sql`${offers.holdUntil} > now()`,
      ),
    );
  return row?.value ?? 0;
}

export async function activeMembers(db: Db, rallyId: string) {
  return db
    .select({
      userId: claims.userId,
      claimId: claims.id,
      role: rallySlots.role,
      displayName: users.displayName,
      checkedInAt: claims.checkedInAt,
    })
    .from(claims)
    .innerJoin(rallySlots, eq(rallySlots.id, claims.slotId))
    .innerJoin(users, eq(users.id, claims.userId))
    .where(and(eq(claims.rallyId, rallyId), eq(claims.status, 'active')))
    .orderBy(rallySlots.position);
}

/** Roles of live seats nobody holds. Duplicates mean several seats with that role. */
export async function openSlots(db: Db, rallyId: string) {
  return db
    .select({ id: rallySlots.id, role: rallySlots.role, position: rallySlots.position })
    .from(rallySlots)
    .leftJoin(claims, and(eq(claims.slotId, rallySlots.id), eq(claims.status, 'active')))
    .where(and(eq(rallySlots.rallyId, rallyId), isNull(rallySlots.retiredAt), isNull(claims.id)))
    .orderBy(rallySlots.position);
}

/** True if the user holds a seat elsewhere that overlaps this time window. */
export async function hasScheduleConflict(
  db: Db,
  userId: string,
  rallyId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: claims.id })
    .from(claims)
    .innerJoin(rallies, eq(rallies.id, claims.rallyId))
    .where(
      and(
        eq(claims.userId, userId),
        eq(claims.status, 'active'),
        sql`${rallies.id} <> ${rallyId}`,
        sql`${rallies.status} in ('open', 'waiting', 'proposed', 'ready', 'formed', 'met')`,
        sql`${rallies.windowStart} < ${windowEnd.toISOString()}`,
        sql`${rallies.windowEnd} > ${windowStart.toISOString()}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}
