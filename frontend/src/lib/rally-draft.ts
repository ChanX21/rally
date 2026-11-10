import type { CreateRallyInput, Intent } from "./api";
import { CATEGORIES, ZONES, VIBES, fromLocalInput, toLocalInput } from "./format";

// A typed place stays private: `zone` is published to public listings, so only these fixed areas
// can go there. The typed text is sent as the meeting point, which only the formed group can see.
export const TYPED_AREA_ZONE = "venue-nearby";
export const isFixedArea = (area: string) => ZONES.some((zone) => zone.id === area);

export type RallyDraft = {
  goal: string; category: string; start: string; durationMin: string;
  groupMin: string; capacity: string; zone: string; vibe: string; preferences: Record<string, string>;
};

export function draftFromIntent(intent: Intent, answers: Record<string, string> = {}): RallyDraft {
  const draft: RallyDraft = {
    goal: intent.goal ?? "", category: intent.category ?? "", start: intent.source === "fallback" ? "" : toLocalInput(intent.windowStart),
    durationMin: intent.durationMin?.toString() ?? "45", groupMin: String(intent.groupMin ?? 2),
    capacity: String(intent.groupMax ?? intent.groupMin ?? 2), zone: intent.zone ?? "", vibe: intent.vibe ?? "any",
    preferences: intent.preferences ?? {},
  };
  // These answers come from typed controls, so a failed reparse must not erase them.
  if (answers.start_time && /^\d{4}-\d{2}-\d{2}T/.test(answers.start_time)) draft.start = toLocalInput(fromLocalInput(answers.start_time));
  if (answers.duration) draft.durationMin = answers.duration;
  if (answers.distance) draft.zone = answers.distance;
  if (answers.group_fit) draft.vibe = answers.group_fit;
  if (answers.group_size) draft.groupMin = draft.capacity = answers.group_size;
  return draft;
}

export type RallyDetail = Exclude<keyof RallyDraft, "preferences">;

export function rallyDraftIssues(draft: RallyDraft, now = Date.now()): Partial<Record<RallyDetail, string>> {
  const issues: Partial<Record<RallyDetail, string>> = {};
  if (!draft.goal.trim() || draft.goal.trim().length > 160) issues.goal = "Give your Rally a title of up to 160 characters.";
  if (!CATEGORIES.some((category) => category.id === draft.category)) issues.category = "Choose an activity.";
  const start = fromLocalInput(draft.start);
  if (!start || Date.parse(start) <= now) issues.start = "Choose a start time in the future.";
  else if (Date.parse(start) > now + 60 * 86_400_000) issues.start = "Choose a start within the next 60 days.";
  const duration = Number(draft.durationMin), min = Number(draft.groupMin), max = Number(draft.capacity);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) issues.durationMin = "Choose a duration from 5 to 480 minutes.";
  if (!Number.isInteger(min) || min < 2 || min > 12) issues.groupMin = "Choose a minimum of 2–12 people.";
  if (!Number.isInteger(max) || max < 2 || max > 12 || min > max) issues.capacity = "Choose a maximum of 2–12 people, no smaller than the minimum.";
  if (!draft.zone.trim()) issues.zone = "Type a meeting area or pick one.";
  if (!VIBES.some((vibe) => vibe.id === draft.vibe)) issues.vibe = "Choose a group atmosphere.";
  return issues;
}

export function rallyDraftProblem(draft: RallyDraft, now = Date.now()): string | null {
  return Object.values(rallyDraftIssues(draft, now))[0] ?? null;
}

export function rallyInputFromDraft(draft: RallyDraft, intentId: string): CreateRallyInput {
  const problem = rallyDraftProblem(draft);
  if (problem) throw new Error(problem);
  const start = fromLocalInput(draft.start)!;
  return {
    intentId, goal: draft.goal.trim(), category: draft.category, preferences: draft.preferences,
    windowStart: start, windowEnd: new Date(Date.parse(start) + Number(draft.durationMin) * 60_000).toISOString(),
    durationMin: Number(draft.durationMin), groupMin: Number(draft.groupMin), capacity: Number(draft.capacity),
    zone: isFixedArea(draft.zone) ? draft.zone : TYPED_AREA_ZONE,
    ...(isFixedArea(draft.zone) ? {} : { meetingPoint: draft.zone.trim() }),
    vibe: draft.vibe, publish: true,
  };
}
