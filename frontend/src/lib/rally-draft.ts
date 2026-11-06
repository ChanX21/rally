import type { CreateRallyInput, Intent } from "./api";
import { CATEGORIES, ZONES, VIBES, fromLocalInput, toLocalInput } from "./format";

export type RallyDraft = {
  goal: string; category: string; start: string; durationMin: string;
  groupMin: string; capacity: string; zone: string; vibe: string; preferences: Record<string, string>;
};

export function draftFromIntent(intent: Intent): RallyDraft {
  return {
    goal: intent.goal ?? "", category: intent.category ?? "", start: toLocalInput(intent.windowStart),
    durationMin: intent.durationMin?.toString() ?? "", groupMin: String(intent.groupMin ?? 2),
    capacity: String(intent.groupMax ?? intent.groupMin ?? 2), zone: intent.zone ?? "", vibe: intent.vibe ?? "any",
    preferences: intent.preferences ?? {},
  };
}

export function rallyDraftProblem(draft: RallyDraft, now = Date.now()): string | null {
  if (!draft.goal.trim() || draft.goal.trim().length > 160) return "Give your Rally a title of up to 160 characters.";
  if (!CATEGORIES.some((category) => category.id === draft.category)) return "Choose an activity.";
  const start = fromLocalInput(draft.start);
  if (!start || Date.parse(start) <= now) return "Choose a start time in the future.";
  if (Date.parse(start) > now + 14 * 86_400_000) return "Choose a start within the next 14 days.";
  const duration = Number(draft.durationMin), min = Number(draft.groupMin), max = Number(draft.capacity);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) return "Choose a duration from 5 to 480 minutes.";
  if (![min, max].every((size) => Number.isInteger(size) && size >= 2 && size <= 12) || min > max) return "Choose 2–12 people, with the minimum no greater than the maximum.";
  if (!ZONES.some((zone) => zone.id === draft.zone)) return "Choose a meeting area.";
  if (!VIBES.some((vibe) => vibe.id === draft.vibe)) return "Choose a group atmosphere.";
  return null;
}

export function rallyInputFromDraft(draft: RallyDraft, intentId: string): CreateRallyInput {
  const problem = rallyDraftProblem(draft);
  if (problem) throw new Error(problem);
  const start = fromLocalInput(draft.start)!;
  return {
    intentId, goal: draft.goal.trim(), category: draft.category, preferences: draft.preferences,
    windowStart: start, windowEnd: new Date(Date.parse(start) + Number(draft.durationMin) * 60_000).toISOString(),
    durationMin: Number(draft.durationMin), groupMin: Number(draft.groupMin), capacity: Number(draft.capacity),
    zone: draft.zone, vibe: draft.vibe, publish: true,
  };
}
