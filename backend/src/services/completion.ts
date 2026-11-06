import { and, eq, inArray, sql } from 'drizzle-orm';
import { claims, offers, rallies } from '../db/schema/index.js';
import { meetTime } from '../domain/reward-policy.js';
import type { Deps } from '../lib/deps.js';
import { notify } from '../lib/notify.js';
import { lockRally } from '../repositories/rallies.js';
import { scheduleArkivSync, transition } from './rally-lifecycle.js';

export async function completeDueRallies(deps: Deps): Promise<number> {
  const due = await deps.db.select({ id: rallies.id }).from(rallies).where(and(
    eq(rallies.proofFlow, true), inArray(rallies.status, ['formed', 'met']),
    sql`coalesce(${rallies.meetAt}, ${rallies.windowStart}) + make_interval(mins => ${rallies.durationMin} + 15) <= now()`,
  )).limit(100);
  let completed = 0;
  for (const { id } of due) await deps.db.transaction(async (tx) => {
    const rally = await lockRally(tx, id);
    if (!rally?.proofFlow || !['formed', 'met'].includes(rally.status)
      || meetTime(rally).getTime() + (rally.durationMin + 15) * 60000 > Date.now()) return;
    const members = await tx.select({ userId: claims.userId }).from(claims).where(and(eq(claims.rallyId, id), eq(claims.status, 'active')));
    const roster = [...new Set(members.map((m) => m.userId))];
    const ended = await transition(tx, rally, 'completed', { completedAt: new Date(), completionMemberIds: roster });
    await tx.update(offers).set({ status: 'cancelled' }).where(and(eq(offers.rallyId, id), eq(offers.status, 'pending')));
    await notify(tx, ...roster.map((userId) => ({ userId, type: 'rally.completed', title: 'How did it go?',
      body: 'Your Rally ended. Add photos to reward your group, or leave an optional vouch.',
      data: { rallyId: id }, dedupeKey: `rally.completed:${id}:${userId}` })));
    await scheduleArkivSync(tx, ended);
    completed += 1;
  });
  return completed;
}
