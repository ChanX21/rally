import { redactPii } from '../domain/intent-fallback.js';
import { inArray } from 'drizzle-orm';

import { rallies } from '../db/schema/index.js';
import { TERMINAL, toPublicStatus } from '../domain/rally-state.js';
import { cachedMapDialogues } from './map-dialogue.js';
import { isSensitive, type Category } from '../domain/catalog.js';
import type { Deps } from '../lib/deps.js';

const UNAVAILABLE_NOTICE =
  'Public discovery is temporarily unavailable. You can still tell Rally what you want to do.';

export interface PreviewQuery {
  category?: string | undefined;
  zone?: string | undefined;
  startBucket?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

/**
 * Public discovery from Arkiv, then confirmed against PostgreSQL: index lag is tolerated, stale
 * listings are dropped, and displayed seats come from the authority. Failing to reach Arkiv is a
 * notice rather than an error, because invites keep working without it.
 */
export async function previewActivities(deps: Deps, query: PreviewQuery) {
  const unavailable = { available: false, notice: UNAVAILABLE_NOTICE, activities: [], nextCursor: null };
  if (!deps.arkiv) return unavailable;

  const limit = Math.min(query.limit ?? deps.env.ARKIV_QUERY_PAGE_SIZE, deps.env.ARKIV_QUERY_PAGE_SIZE);

  let result;
  try {
    result = await deps.arkiv.queryListings({
      category: query.category,
      zone: query.zone,
      startBucket: query.startBucket,
      after: query.cursor,
      limit,
    });
  } catch (error) {
    deps.log.warn({ err: error }, 'Arkiv preview query failed');
    return unavailable;
  }

  const opaqueIds = result.listings.map((listing) => listing.opaqueId);
  const confirmed =
    opaqueIds.length === 0
      ? []
      : await deps.db
          .select({
            id: rallies.id,
            opaqueId: rallies.opaqueId,
            status: rallies.status,
            openSeats: rallies.openSeats,
            visibility: rallies.visibility,
            goal: rallies.goal,
            meetingPoint: rallies.meetingPoint,
            publicPlace: rallies.publicPlace,
            category: rallies.category,
            expiresAt: rallies.expiresAt,
          })
          .from(rallies)
          .where(inArray(rallies.opaqueId, opaqueIds));
  const visible = confirmed.filter((rally) => rally.visibility === 'public_coarse' && !isSensitive(rally.category as Category)
    && rally.status !== 'draft' && !TERMINAL.includes(rally.status) && rally.status !== 'met' && rally.expiresAt > new Date());
  const dialogues = await cachedMapDialogues(deps.db, visible);
  const byOpaqueId = new Map(visible.map((rally) => [rally.opaqueId, rally]));

  const activities = result.listings.flatMap((listing) => {
    const rally = byOpaqueId.get(listing.opaqueId);
    // Unknown to Rally means someone else wrote it, or it is stale. Do not show either.
    if (!rally) return [];
    const status = toPublicStatus(rally.status, rally.openSeats);
    if (status === 'closed') return [];
    return [
      {
        opaqueId: listing.opaqueId,
        title: redactPii(rally.meetingPoint ? rally.goal.split(rally.meetingPoint).join('') : rally.goal).trim().slice(0, 80) || listing.category,
        publicPlace: rally.publicPlace,
        dialogue: dialogues.get(rally.id)?.dialogue ?? null,
        aiRequestId: dialogues.get(rally.id)?.aiRequestId ?? null,
        category: listing.category,
        zone: listing.zone,
        startBucket: listing.startBucket,
        neededRole: listing.neededRole,
        minGroupSize: listing.minGroupSize,
        openSeats: rally.openSeats,
        status,
      },
    ];
  });

  return { available: true, notice: null, activities, nextCursor: result.nextAfter };
}
