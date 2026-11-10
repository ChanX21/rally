import type { Match, Rally } from "./api";
import { ACTIVE_RALLY_STATUSES } from "./format";

export function myRallySections(rallies: Rally[], matches: Match[], now: number) {
  const unique = [...new Map(rallies.map(rally => [rally.id, rally])).values()];
  return {
    current: unique.filter(rally => ACTIVE_RALLY_STATUSES.includes(rally.status))
      .sort((a, b) => Date.parse(a.meetAt ?? a.windowStart) - Date.parse(b.meetAt ?? b.windowStart)),
    past: unique.filter(rally => !ACTIVE_RALLY_STATUSES.includes(rally.status))
      .sort((a, b) => Date.parse(b.completedAt ?? b.windowStart) - Date.parse(a.completedAt ?? a.windowStart)),
    invitations: matches.filter(match => match.status === "pending" && Date.parse(match.holdUntil) > now
      && ["open", "waiting", "proposed", "ready"].includes(match.rally.status)
      && !unique.some(rally => rally.id === match.rally.id)),
  };
}
