import { randomBytes } from 'node:crypto';

import { and, desc, eq, exists, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { relevantPreferences } from '../domain/questions.js';
import { claims, intents, offers, rallies, rallySlots } from '../db/schema/index.js';
import {
  type Category,
  HOST_ROLE,
  isSensitive,
  MAX_DAYS_AHEAD,
  type Role,
  type Vibe,
} from '../domain/catalog.js';
import { ARRIVE_OPENS_BEFORE_MIN, meetTime } from '../domain/reward-policy.js';
import {
  CANCELLABLE,
  EDITABLE_SCHEDULE,
  ROOM_VISIBLE,
  TERMINAL,
} from '../domain/rally-state.js';
import type { Tx } from '../lib/db-types.js';
import type { Deps } from '../lib/deps.js';
import { AppError, notFound } from '../lib/errors.js';
import { withIdempotency } from '../lib/idempotency.js';
import { notify } from '../lib/notify.js';
import { enqueue } from '../lib/outbox.js';
import { decodeCursor, page } from '../lib/pagination.js';
import {
  activeClaim,
  activeMembers,
  countActiveClaims,
  findRally,
  hasScheduleConflict,
  lockRally,
  openSlots,
  type Rally,
} from '../repositories/rallies.js';
import { lockUser } from '../repositories/users.js';
import {
  closeRally,
  notifyBackups,
  scheduleArkivSync,
  settleRally,
  transition,
} from './rally-lifecycle.js';
import { penaliseLateCancel, rewardCheckIn } from './rewards.js';

/** Public-to-members shape. The exact meeting point is only available through the room. */
export function rallyView(rally: Rally) {
  return {
    id: rally.id,
    preferences: rally.preferences,
    opaqueId: rally.opaqueId,
    creatorId: rally.creatorId,
    status: rally.status,
    visibility: rally.visibility,
    category: rally.category,
    goal: rally.goal,
    vibe: rally.vibe,
    windowStart: rally.windowStart.toISOString(),
    windowEnd: rally.windowEnd.toISOString(),
    meetAt: meetTime(rally).toISOString(),
    durationMin: rally.durationMin,
    zone: rally.zone,
    groupMin: rally.groupMin,
    capacity: rally.capacity,
    openSeats: rally.openSeats,
    expiresAt: rally.expiresAt.toISOString(),
    version: rally.version,
    hasMeetingPoint: rally.meetingPoint !== null,
    createdAt: rally.createdAt.toISOString(),
  };
}

interface Schedule {
  windowStart: Date;
  windowEnd: Date;
  durationMin: number;
}

function assertSchedule({ windowStart, windowEnd, durationMin }: Schedule, now: Date) {
  if (windowEnd <= windowStart) {
    throw new AppError(422, 'INVALID_WINDOW', 'The time window must end after it starts');
  }
  if (windowEnd <= now) {
    throw new AppError(422, 'INVALID_WINDOW', 'The time window has already passed');
  }
  if (windowStart.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) {
    throw new AppError(422, 'INVALID_WINDOW', `Rallies can start at most ${MAX_DAYS_AHEAD} days ahead`);
  }
  if (windowEnd.getTime() - windowStart.getTime() < durationMin * 60_000) {
    throw new AppError(422, 'INVALID_DURATION', 'The duration does not fit in the time window');
  }
}

function assertZone(deps: Deps, zone: string) {
  if (!deps.env.EVENT_ZONES.includes(zone)) {
    throw new AppError(422, 'INVALID_ZONE', 'That zone is not available at this event');
  }
}

export interface CreateRallyInput {
  preferences?: Record<string, string>;
  intentId?: string | undefined;
  category: Category;
  goal: string;
  vibe?: Vibe | undefined;
  windowStart: Date;
  windowEnd: Date;
  durationMin: number;
  zone: string;
  groupMin: number;
  capacity: number;
  slotRoles?: Role[] | undefined;
  visibility?: 'public_coarse' | 'private' | undefined;
  meetingPoint?: string | undefined;
  meetingBrief?: string | undefined;
  publish: boolean;
}

async function publishLocked(tx: Tx, rally: Rally): Promise<Rally> {
  if (await hasScheduleConflict(tx, rally.creatorId, rally.id, rally.windowStart, rally.windowEnd)) {
    throw new AppError(409, 'SCHEDULE_CONFLICT', 'You already have a rally at this time');
  }
  const published = await transition(tx, rally, 'open', { publishedAt: new Date() });
  await scheduleArkivSync(tx, published);
  await enqueue(tx, {
    type: 'rally.published',
    payload: { rallyId: published.id },
    dedupeKey: `rally.published:${published.id}`,
  });
  return published;
}

export async function createRally(
  deps: Deps,
  userId: string,
  input: CreateRallyInput,
  idempotencyKey: string | undefined,
) {
  const now = new Date();
  assertSchedule(input, now);
  assertZone(deps, input.zone);
  if (input.groupMin > input.capacity) {
    throw new AppError(422, 'INVALID_GROUP', 'The group minimum exceeds capacity');
  }
  const roles = input.slotRoles ?? [];
  if (roles.length > 0 && roles.length !== input.capacity - 1) {
    throw new AppError(
      422,
      'INVALID_ROLES',
      'slotRoles must list one role for each seat other than the host',
    );
  }

  return withIdempotency(
    deps.db,
    { userId, scope: 'rallies.create', key: idempotencyKey, request: input },
    async (tx) => {
      const user = await lockUser(tx, userId);
      if (!user?.onboardedAt) {
        throw new AppError(409, 'NOT_ONBOARDED', 'Complete onboarding first');
      }

      let confirmedPreferences = input.preferences;
      if (input.intentId) {
        const [intent] = await tx
          .update(intents)
          .set({ status: 'published' })
          .where(
            and(
              eq(intents.id, input.intentId),
              eq(intents.userId, userId),
              inArray(intents.status, ['draft', 'waiting']),
            ),
          )
          .returning({ id: intents.id, preferences: intents.preferences });
        if (!intent) throw notFound('Intent');
        confirmedPreferences ??= intent.preferences;
      }

      // Sensitive categories stay private, whatever the request says.
      const visibility = isSensitive(input.category) ? 'private' : (input.visibility ?? 'public_coarse');

      const [created] = await tx
        .insert(rallies)
        .values({
          opaqueId: `rly_${randomBytes(12).toString('base64url')}`,
          creatorId: userId,
          intentId: input.intentId,
          preferences: relevantPreferences(input.category, confirmedPreferences ?? {}),
          visibility,
          category: input.category,
          goal: input.goal,
          vibe: input.vibe,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          durationMin: input.durationMin,
          zone: input.zone,
          neededRole: roles[0] ?? 'participant',
          groupMin: input.groupMin,
          capacity: input.capacity,
          openSeats: input.capacity - 1,
          meetingPoint: input.meetingPoint,
          meetingBrief: input.meetingBrief,
          expiresAt: input.windowEnd,
        })
        .returning();
      const rally = created!;

      const slots = await tx
        .insert(rallySlots)
        .values(
          Array.from({ length: input.capacity }, (_, position) => ({
            rallyId: rally.id,
            position,
            role: position === 0 ? HOST_ROLE : (roles[position - 1] ?? 'participant'),
          })),
        )
        .returning({ id: rallySlots.id, position: rallySlots.position });
      const hostSlot = slots.find((slot) => slot.position === 0)!;
      await tx.insert(claims).values({ rallyId: rally.id, slotId: hostSlot.id, userId });

      const result = input.publish ? await publishLocked(tx, rally) : rally;
      return rallyView(result);
    },
  );
}

async function requireCreator(tx: Tx, rallyId: string, userId: string): Promise<Rally> {
  const rally = await lockRally(tx, rallyId);
  if (!rally) throw notFound('Rally');
  // Others get 403 only if they can already see the rally. Otherwise existence stays hidden.
  if (rally.creatorId !== userId) {
    const visible = await canSee(tx, rally, userId);
    if (!visible) throw notFound('Rally');
    throw new AppError(403, 'FORBIDDEN', 'Only the creator can do this');
  }
  return rally;
}

async function canSee(tx: Tx | Deps['db'], rally: Rally, userId: string): Promise<boolean> {
  if (rally.creatorId === userId) return true;
  if (await activeClaim(tx, rally.id, userId)) return true;
  const [offer] = await tx
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.rallyId, rally.id), eq(offers.candidateId, userId)));
  return offer !== undefined;
}

export async function publishRally(deps: Deps, userId: string, rallyId: string) {
  return deps.db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const rally = await requireCreator(tx, rallyId, userId);
    if (rally.status !== 'draft') {
      // A retried publish is a no-op, once it has actually happened.
      if (rally.publishedAt !== null) return rallyView(rally);
      throw new AppError(409, 'INVALID_STATE', `A ${rally.status} rally cannot be published`);
    }
    if (rally.windowEnd <= new Date()) {
      throw new AppError(422, 'INVALID_WINDOW', 'The time window has already passed');
    }
    return rallyView(await publishLocked(tx, rally));
  });
}

export async function getRally(deps: Deps, userId: string, rallyId: string) {
  const rally = await findRally(deps.db, rallyId);
  if (!rally || !(await canSee(deps.db, rally, userId))) throw notFound('Rally');
  return rallyView(rally);
}

export async function listRallies(
  deps: Deps,
  userId: string,
  options: {
    limit: number;
    cursor?: string | undefined;
    status?: Rally['status'] | undefined;
  },
) {
  const cursor = decodeCursor(options.cursor);
  const rows = await deps.db
    .select()
    .from(rallies)
    .where(
      and(
        or(
          eq(rallies.creatorId, userId),
          exists(
            deps.db
              .select({ one: sql`1` })
              .from(claims)
              .where(
                and(
                  eq(claims.rallyId, rallies.id),
                  eq(claims.userId, userId),
                  eq(claims.status, 'active'),
                ),
              ),
          ),
        ),
        options.status ? eq(rallies.status, options.status) : undefined,
        cursor
          ? or(
              lt(rallies.createdAt, cursor.createdAt),
              and(eq(rallies.createdAt, cursor.createdAt), lt(rallies.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(rallies.createdAt), desc(rallies.id))
    .limit(options.limit + 1);

  const { items, nextCursor } = page(rows, options.limit);
  return { items: items.map(rallyView), nextCursor };
}

export interface UpdateRallyInput {
  expectedVersion: number;
  goal?: string | undefined;
  vibe?: Vibe | undefined;
  windowStart?: Date | undefined;
  windowEnd?: Date | undefined;
  durationMin?: number | undefined;
  zone?: string | undefined;
  groupMin?: number | undefined;
  capacity?: number | undefined;
  meetingPoint?: string | undefined;
  meetAt?: Date | undefined;
  meetingBrief?: string | undefined;
}

async function resizeSeats(tx: Tx, rally: Rally, capacity: number): Promise<number> {
  const claimCount = await countActiveClaims(tx, rally.id);
  if (capacity < claimCount) {
    throw new AppError(409, 'CAPACITY_BELOW_CLAIMS', 'Capacity cannot be below current participants');
  }

  const delta = capacity - rally.capacity;
  if (delta > 0) {
    const [last] = await tx
      .select({ position: rallySlots.position })
      .from(rallySlots)
      .where(eq(rallySlots.rallyId, rally.id))
      .orderBy(desc(rallySlots.position))
      .limit(1);
    const start = (last?.position ?? 0) + 1;
    await tx.insert(rallySlots).values(
      Array.from({ length: delta }, (_, index) => ({
        rallyId: rally.id,
        position: start + index,
        role: rally.neededRole,
      })),
    );
  } else if (delta < 0) {
    const free = await openSlots(tx, rally.id);
    const retire = free.slice(delta).map((slot) => slot.id);
    await tx
      .update(rallySlots)
      .set({ retiredAt: new Date() })
      .where(and(inArray(rallySlots.id, retire), isNull(rallySlots.retiredAt)));
  }
  return capacity - claimCount;
}

export async function updateRally(
  deps: Deps,
  userId: string,
  rallyId: string,
  input: UpdateRallyInput,
) {
  return deps.db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const rally = await requireCreator(tx, rallyId, userId);

    if (rally.version !== input.expectedVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', 'This rally has changed. Reload and try again', {
        details: { currentVersion: rally.version },
      });
    }
    if (rally.status === 'met' || TERMINAL.includes(rally.status)) {
      throw new AppError(409, 'INVALID_STATE', `A ${rally.status} rally cannot be changed`);
    }

    const changesSchedule =
      input.windowStart !== undefined ||
      input.windowEnd !== undefined ||
      input.durationMin !== undefined ||
      input.zone !== undefined;
    if (changesSchedule && !EDITABLE_SCHEDULE.includes(rally.status)) {
      throw new AppError(
        409,
        'SCHEDULE_LOCKED',
        'Time and place cannot change once people have been asked',
      );
    }

    const schedule = {
      windowStart: input.windowStart ?? rally.windowStart,
      windowEnd: input.windowEnd ?? rally.windowEnd,
      durationMin: input.durationMin ?? rally.durationMin,
    };
    if (changesSchedule) {
      assertSchedule(schedule, new Date());
      if (rally.status !== 'draft' && await hasScheduleConflict(tx, userId, rally.id, schedule.windowStart, schedule.windowEnd)) {
        throw new AppError(409, 'SCHEDULE_CONFLICT', 'You already have a rally at this time');
      }
    }
    if (input.zone !== undefined) assertZone(deps, input.zone);

    if (input.meetAt !== undefined) {
      // Fixed once the group forms, so a host cannot move the time to suit their own arrival.
      if (rally.status === 'formed') {
        throw new AppError(409, 'SCHEDULE_LOCKED', 'The meeting time cannot change once the group has formed');
      }
      if (input.meetAt < schedule.windowStart || input.meetAt > schedule.windowEnd) {
        throw new AppError(422, 'INVALID_MEET_TIME', 'The meeting time must fall inside the time window');
      }
    }

    const capacity = input.capacity ?? rally.capacity;
    const groupMin = input.groupMin ?? rally.groupMin;
    if (groupMin > capacity) {
      throw new AppError(422, 'INVALID_GROUP', 'The group minimum exceeds capacity');
    }
    const openSeats =
      capacity === rally.capacity ? rally.openSeats : await resizeSeats(tx, rally, capacity);

    const [updated] = await tx
      .update(rallies)
      .set({
        ...schedule,
        capacity,
        groupMin,
        openSeats,
        goal: input.goal ?? rally.goal,
        vibe: input.vibe ?? rally.vibe,
        zone: input.zone ?? rally.zone,
        meetingPoint: input.meetingPoint ?? rally.meetingPoint,
        meetingBrief: input.meetingBrief ?? rally.meetingBrief,
        meetAt: input.meetAt ?? rally.meetAt,
        expiresAt: input.windowEnd ?? rally.expiresAt,
        noFitShortlistHash: null,
        version: rally.version + 1,
      })
      .where(eq(rallies.id, rally.id))
      .returning();

    const settled = await settleRally(tx, updated!);
    await scheduleArkivSync(tx, settled);
    if (settled.status === 'open' || settled.status === 'waiting') {
      await enqueue(tx, { type: 'match.reevaluate', payload: { rallyId: rally.id } });
    }
    return rallyView(settled);
  });
}

export async function cancelRally(deps: Deps, userId: string, rallyId: string) {
  return deps.db.transaction(async (tx) => {
    const rally = await requireCreator(tx, rallyId, userId);
    if (rally.status === 'cancelled') return rallyView(rally);
    if (!CANCELLABLE.includes(rally.status)) {
      throw new AppError(409, 'INVALID_STATE', `A ${rally.status} rally cannot be cancelled`);
    }
    await penaliseLateCancel(tx, rally, userId);
    return rallyView(await closeRally(tx, rally, 'cancelled'));
  });
}

export async function withdrawFromRally(deps: Deps, userId: string, rallyId: string) {
  return deps.db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const rally = await lockRally(tx, rallyId);
    if (!rally || !(await canSee(tx, rally, userId))) throw notFound('Rally');
    if (rally.creatorId === userId) {
      throw new AppError(409, 'CREATOR_CANNOT_WITHDRAW', 'Cancel the rally instead');
    }
    if (!CANCELLABLE.includes(rally.status)) {
      throw new AppError(409, 'INVALID_STATE', `You cannot withdraw from a ${rally.status} rally`);
    }

    const claim = await activeClaim(tx, rally.id, userId);
    // A retry after a successful withdrawal finds no claim and is simply a no-op.
    if (!claim) return rallyView(rally);

    await penaliseLateCancel(tx, rally, userId);
    await tx
      .update(claims)
      .set({ status: 'withdrawn', releasedAt: new Date() })
      .where(eq(claims.id, claim.id));
    const [updated] = await tx
      .update(rallies)
      .set({ openSeats: sql`${rallies.openSeats} + 1`, version: rally.version + 1 })
      .where(eq(rallies.id, rally.id))
      .returning();

    const remaining = await activeMembers(tx, rally.id);
    await notify(
      tx,
      ...remaining.map((member) => ({
        userId: member.userId,
        type: 'rally.participant_withdrew',
        title: 'Someone withdrew',
        body: `A participant withdrew from "${rally.goal}".`,
        data: { rallyId: rally.id },
        dedupeKey: `rally.withdrew:${claim.id}:${member.userId}`,
      })),
    );
    await notifyBackups(tx, updated!, userId);

    const settled = await settleRally(tx, updated!);
    await scheduleArkivSync(tx, settled);
    return rallyView(settled);
  });
}

async function requireMember(deps: Deps, userId: string, rallyId: string): Promise<Rally> {
  const rally = await findRally(deps.db, rallyId);
  if (!rally || !(await activeClaim(deps.db, rallyId, userId))) throw notFound('Rally');
  return rally;
}

export async function listParticipants(deps: Deps, userId: string, rallyId: string) {
  await requireMember(deps, userId, rallyId);
  const members = await activeMembers(deps.db, rallyId);
  return members.map((member) => ({
    userId: member.userId,
    displayName: member.displayName,
    role: member.role,
    checkedIn: member.checkedInAt !== null,
    arrived: member.arrivedAt !== null,
  }));
}

/** The temporary room. It stays closed until the group has actually formed. */
export async function getRoom(deps: Deps, userId: string, rallyId: string) {
  const rally = await requireMember(deps, userId, rallyId);
  if (!ROOM_VISIBLE.includes(rally.status)) {
    throw new AppError(409, 'ROOM_LOCKED', 'The room unlocks when the group has formed');
  }
  const members = await listParticipants(deps, userId, rallyId);
  return {
    rallyId: rally.id,
    status: rally.status,
    goal: rally.goal,
    windowStart: rally.windowStart.toISOString(),
    windowEnd: rally.windowEnd.toISOString(),
    meetAt: meetTime(rally).toISOString(),
    zone: rally.zone,
    meetingPoint: rally.meetingPoint,
    meetingBrief: rally.meetingBrief,
    members,
  };
}

/** A member's own "I'm here". Safe to repeat: the first tap is the one that counts. */
export async function markArrived(deps: Deps, userId: string, rallyId: string) {
  return deps.db.transaction(async (tx) => {
    const rally = await lockRally(tx, rallyId);
    if (!rally) throw notFound('Rally');
    const claim = await activeClaim(tx, rallyId, userId);
    if (!claim) throw notFound('Rally');

    const view = (arrivedAt: Date) => ({
      arrivedAt: arrivedAt.toISOString(),
      meetAt: meetTime(rally).toISOString(),
    });
    if (claim.arrivedAt) return view(claim.arrivedAt);
    if (rally.status !== 'formed') {
      throw new AppError(409, 'INVALID_STATE', 'You can only tap in while the group is meeting');
    }
    const now = new Date();
    const opens = meetTime(rally).getTime() - ARRIVE_OPENS_BEFORE_MIN * 60_000;
    if (now.getTime() < opens) {
      throw new AppError(409, 'TOO_EARLY', `This opens ${ARRIVE_OPENS_BEFORE_MIN} minutes before the meeting time`);
    }
    await tx.update(claims).set({ arrivedAt: now }).where(eq(claims.id, claim.id));
    return view(now);
  });
}

/** Host-attested presence. The playbook is explicit that this proves nothing further. */
export async function checkIn(
  deps: Deps,
  userId: string,
  rallyId: string,
  presentUserIds: string[],
) {
  return deps.db.transaction(async (tx) => {
    const rally = await requireCreator(tx, rallyId, userId);
    if (rally.status === 'met') return rallyView(rally);
    if (rally.status !== 'formed') {
      throw new AppError(409, 'INVALID_STATE', 'Check-in opens once the group has formed');
    }

    const members = await activeMembers(tx, rally.id);
    const memberIds = new Set(members.map((member) => member.userId));
    const present = new Set(presentUserIds);
    present.add(userId);
    for (const id of present) {
      if (!memberIds.has(id)) {
        throw new AppError(422, 'NOT_A_PARTICIPANT', 'Everyone present must be a participant');
      }
    }
    if (present.size < 2) {
      throw new AppError(422, 'NOT_ENOUGH_PRESENT', 'At least one other participant must be present');
    }

    const now = new Date();
    for (const member of members) {
      await tx
        .update(claims)
        .set(
          present.has(member.userId)
            ? { checkedInAt: now }
            : { status: 'no_show', releasedAt: now },
        )
        .where(eq(claims.id, member.claimId));
    }

    await rewardCheckIn(tx, rally, members, present);
    const met = await transition(tx, rally, 'met', { metAt: now });
    await notify(
      tx,
      ...[...present]
        .filter((id) => id !== userId)
        .map((id) => ({
          userId: id,
          type: 'rally.met',
          title: 'How did it go?',
          body: `Tell us whether "${rally.goal}" happened, and vouch for someone if they helped.`,
          data: { rallyId: rally.id },
          dedupeKey: `rally.met:${rally.id}:${id}`,
        })),
    );
    await scheduleArkivSync(tx, met);
    return rallyView(met);
  });
}
