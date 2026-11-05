import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Db } from '../lib/db-types.js';
import type { Rally } from './rallies.js';

const timestamp = z.union([z.date(), z.string()]).transform((value) => new Date(value));

const candidateRow = z.object({
  user_id: z.uuid(),
  interests: z.array(z.string()),
  declared_skills: z.array(z.string()),
  preferences: z.record(z.string(), z.string()).nullable(),
  available_from: timestamp.nullable(),
  available_to: timestamp.nullable(),
  intent_id: z.uuid().nullable(),
  intent_start: timestamp.nullable(),
  intent_end: timestamp.nullable(),
  intent_vibe: z.string().nullable(),
  mutual_encore: z.boolean(),
});

export type CandidateRow = z.infer<typeof candidateRow>;

/**
 * Hard filters, run in SQL first. A person qualifies through an active waiting intent, or through
 * a listed interest plus declared availability. Nothing below uses AI or any public Arkiv data.
 */
export async function findCandidates(db: Db, rally: Rally, limit: number): Promise<CandidateRow[]> {
  const start = rally.windowStart.toISOString();
  const end = rally.windowEnd.toISOString();
  const minOverlap = `${rally.durationMin} minutes`;

  const rows = await db.execute(sql`
    select
      u.id as user_id,
      p.interests,
      p.declared_skills,
      p.preferences,
      p.available_from,
      p.available_to,
      i.id as intent_id,
      i.window_start as intent_start,
      i.window_end as intent_end,
      i.vibe as intent_vibe,
      exists (
        select 1
        from feedback mine
        join feedback theirs
          on theirs.rally_id = mine.rally_id
         and theirs.giver_id = mine.recipient_id
         and theirs.recipient_id = mine.giver_id
         and theirs.type = 'encore'
        join claims member
          on member.rally_id = ${rally.id}
         and member.status = 'active'
         and member.user_id = mine.recipient_id
        where mine.type = 'encore' and mine.giver_id = u.id
      ) as mutual_encore
    from users u
    join lateral (
      select * from profile_versions v
      where v.user_id = u.id
      order by v.version desc
      limit 1
    ) p on true
    left join lateral (
      select * from intents w
      where w.user_id = u.id
        and w.status = 'waiting'
        and w.category = ${rally.category}
        and (w.expires_at is null or w.expires_at > now())
        and (w.zone is null or w.zone = ${rally.zone})
        and least(w.window_end, ${end}::timestamptz)
          - greatest(w.window_start, ${start}::timestamptz) >= ${minOverlap}::interval
      order by w.created_at
      limit 1
    ) i on true
    where u.status = 'active'
      and u.opt_in_matching
      and u.id <> ${rally.creatorId}
      and (
        i.id is not null
        or (
          ${rally.category} = any(p.interests)
          and p.available_from is not null
          and p.available_to is not null
          and least(p.available_to, ${end}::timestamptz)
            - greatest(p.available_from, ${start}::timestamptz) >= ${minOverlap}::interval
        )
      )
      and not exists (
        select 1 from offers o where o.rally_id = ${rally.id} and o.candidate_id = u.id
      )
      and not exists (
        select 1 from claims c
        where c.rally_id = ${rally.id} and c.user_id = u.id
      )
      and not exists (
        select 1
        from claims c
        join user_blocks b
          on (b.blocker_id = c.user_id and b.blocked_id = u.id)
          or (b.blocker_id = u.id and b.blocked_id = c.user_id)
        where c.rally_id = ${rally.id} and c.status = 'active'
      )
      and not exists (
        select 1
        from claims c
        join rallies other on other.id = c.rally_id
        where c.user_id = u.id
          and c.status = 'active'
          and other.id <> ${rally.id}
          and other.status in ('open', 'waiting', 'proposed', 'ready', 'formed', 'met')
          and other.window_start < ${end}::timestamptz
          and other.window_end > ${start}::timestamptz
      )
    order by (i.id is not null) desc, u.created_at
    limit ${limit}
  `);

  return z.array(candidateRow).parse([...rows]);
}

/** Matchable rallies a person might fit, soonest first. Each then runs the full engine. */
export async function findRalliesForUser(db: Db, userId: string, limit: number): Promise<string[]> {
  const rows = await db.execute(sql`
    select r.id
    from rallies r
    join lateral (
      select interests from profile_versions v
      where v.user_id = ${userId}
      order by v.version desc
      limit 1
    ) p on true
    where r.status in ('open', 'waiting', 'proposed')
      and r.open_seats > 0
      and r.expires_at > now()
      and r.creator_id <> ${userId}
      and (
        r.category = any(p.interests)
        or exists (
          select 1 from intents w
          where w.user_id = ${userId} and w.status = 'waiting' and w.category = r.category
        )
      )
    order by r.window_start
    limit ${limit}
  `);
  return z
    .array(z.object({ id: z.uuid() }))
    .parse([...rows])
    .map((row) => row.id);
}
