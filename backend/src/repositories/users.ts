import { desc, eq } from 'drizzle-orm';

import { profileVersions, users } from '../db/schema/index.js';
import type { Db } from '../lib/db-types.js';

export type User = typeof users.$inferSelect;
export type ProfileVersion = typeof profileVersions.$inferSelect;

export async function findUserByDid(db: Db, did: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.privyDid, did));
  return user;
}

/**
 * Serializes one user's seat-changing operations, always before locking a rally. NO KEY UPDATE lets
 * other transactions keep inserting rows that reference this user. Plain FOR UPDATE would block
 * their foreign key checks, which can deadlock against a transaction holding a rally lock.
 */
export async function lockUser(db: Db, userId: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).for('no key update');
  return user;
}

export async function latestProfile(db: Db, userId: string): Promise<ProfileVersion | undefined> {
  const [profile] = await db
    .select()
    .from(profileVersions)
    .where(eq(profileVersions.userId, userId))
    .orderBy(desc(profileVersions.version))
    .limit(1);
  return profile;
}

type ProfileChanges = Partial<
  Pick<
    ProfileVersion,
    | 'interests'
    | 'declaredSkills'
    | 'inferredTags'
    | 'evidence'
    | 'preferences'
    | 'availableFrom'
    | 'availableTo'
  >
>;

/** Profiles are append-only. Take the user lock first so version numbers cannot collide. */
export async function appendProfile(
  db: Db,
  userId: string,
  changes: ProfileChanges,
): Promise<ProfileVersion> {
  const previous = await latestProfile(db, userId);
  const interests = changes.interests ?? previous?.interests ?? [];
  const interestsChanged =
    previous !== undefined && interests.join() !== previous.interests.join();

  const [profile] = await db
    .insert(profileVersions)
    .values({
      userId,
      version: (previous?.version ?? 0) + 1,
      interests,
      interestsVersion: (previous?.interestsVersion ?? 1) + (interestsChanged ? 1 : 0),
      declaredSkills: changes.declaredSkills ?? previous?.declaredSkills ?? [],
      inferredTags: changes.inferredTags ?? previous?.inferredTags ?? [],
      evidence: changes.evidence ?? previous?.evidence ?? [],
      preferences: changes.preferences ?? previous?.preferences ?? {},
      availableFrom:
        changes.availableFrom === undefined ? (previous?.availableFrom ?? null) : changes.availableFrom,
      availableTo:
        changes.availableTo === undefined ? (previous?.availableTo ?? null) : changes.availableTo,
    })
    .returning();
  return profile!;
}
