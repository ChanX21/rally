import { eq, sql } from 'drizzle-orm';

import { claims, rallies } from '../../src/db/schema/index.js';
import type { Harness, Json, TestUser } from './harness.js';

let counter = 0;
export const did = (name: string) => `did:privy:${name}-${(counter += 1)}`;

export interface Group {
  host: TestUser;
  member: TestUser;
  rally: Json;
}

/** Forms a two-person rally. Pass existing users to reform the same group. */
export async function formedGroup(
  h: Harness,
  people: { host?: TestUser; member?: TestUser } = {},
  rallyOptions: Record<string, unknown> = {},
): Promise<Group> {
  const member = people.member ?? (await h.onboarded(did('member')));
  const host = people.host ?? (await h.onboarded(did('host'), { optInMatching: false }));
  const rally = await h.rally(host, { capacity: 2, meetingPoint: 'Hotel lobby', ...rallyOptions });
  await h.drainOutbox();
  const { matches } = await member.get('/matches');
  const match = matches.find((m: Json) => m.rally.id === rally.id);
  await member.post(`/matches/${match.id}/respond`, { response: 'accept' });
  return { host, member, rally };
}

/** Sets the agreed time relative to now. */
export const setMeetAt = (h: Harness, rallyId: string, minutesFromNow: number) =>
  h.app.deps.db
    .update(rallies)
    .set({ meetAt: new Date(Date.now() + minutesFromNow * 60_000) })
    .where(eq(rallies.id, rallyId));

/** Records a tap at a time relative to the agreed time, which is not otherwise possible in a test. */
export const tapAt = (h: Harness, rallyId: string, userId: string, minutesAfterMeet: number) =>
  h.app.deps.db
    .update(claims)
    .set({
      arrivedAt: sql`(select coalesce(meet_at, window_start) from rallies where id = ${rallyId}) + make_interval(mins => ${minutesAfterMeet})`,
    })
    .where(sql`${claims.rallyId} = ${rallyId} and ${claims.userId} = ${userId} and ${claims.status} = 'active'`);
