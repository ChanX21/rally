// Fixed values and display helpers. There is no catalog endpoint yet, so the
// handoff asks us to hardcode these.

export const CATEGORIES: Array<{ id: string; label: string; phrase: string }> = [
  { id: "build", label: "Build", phrase: "Building something" },
  { id: "coffee", label: "Coffee", phrase: "Up for a coffee break" },
  { id: "workshop", label: "Workshop", phrase: "Going to a workshop" },
  { id: "gaming", label: "Gaming", phrase: "Playing some games" },
  { id: "food", label: "Food", phrase: "Going for food" },
  { id: "explore", label: "Explore", phrase: "Exploring around" },
  { id: "music", label: "Music", phrase: "Listening or playing music" },
  { id: "photography", label: "Photography", phrase: "Taking photos together" },
  { id: "arts", label: "Arts", phrase: "Making or enjoying art" },
  { id: "football", label: "Football", phrase: "Playing or watching football" },
  { id: "gym", label: "Gym", phrase: "Finding a gym buddy" },
  { id: "nature", label: "Nature", phrase: "Spending time outdoors" },
  { id: "fashion", label: "Fashion", phrase: "Exploring fashion together" },
  { id: "travel", label: "Travel", phrase: "Planning a trip or outing" },
  { id: "finance", label: "Finance", phrase: "Discussing finance" },
  { id: "technology", label: "Technology", phrase: "Exploring technology" },
  { id: "books", label: "Books", phrase: "Reading or discussing books" },
  { id: "animals", label: "Animals", phrase: "Meeting fellow animal lovers" },
  { id: "networking", label: "Networking", phrase: "Meeting new people" },
  { id: "wellness", label: "Wellness", phrase: "Taking a break" },
  { id: "support", label: "Support", phrase: "Looking for support" },
];

// wellness and support are always private and never appear in public discovery.
export const SENSITIVE_CATEGORIES = ["wellness", "support"];

export const ZONES: Array<{ id: string; label: string }> = [
  { id: "venue-floor-1", label: "Venue, floor 1" },
  { id: "venue-floor-2", label: "Venue, floor 2" },
  { id: "venue-nearby", label: "Near the venue" },
];

export const VIBES: Array<{ id: string; label: string }> = [
  { id: "any", label: "Any vibe" },
  { id: "quiet", label: "Quiet hangout" },
  { id: "chatty", label: "Chatty group" },
];

export function categoryLabel(id: string | null): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id ?? "Plan";
}

export function categoryPhrase(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.phrase ?? id;
}

// Zones are configurable on the server, so an unknown id is shown as it arrives.
export function zoneLabel(id: string | null): string {
  return ZONES.find((z) => z.id === id)?.label ?? id ?? "Anywhere";
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function preferenceText(key: string, value: string): string {
  if (key === "matching_notes") return value;
  if (key.startsWith("custom_")) return `${categoryLabel(key.slice(7))}: ${value}`;
  const labels: Record<string, string> = {
    gaming_game: "Gaming", build_role: "Building", workshop_topic: "Workshops",
    food_style: "Food", coffee_energy: "Coffee", explore_range: "Exploring", group_energy: "Group atmosphere",
  };
  const values: Record<string, string> = {
    any: "No preference", ai: "AI", web3: "Web3", wow: "World of Warcraft",
    sit_down: "Sit-down meals", venue: "Stay at the venue", nearby: "Nearby places",
  };
  return `${labels[key] ?? capitalize(key.replaceAll("_", " "))}: ${values[value] ?? capitalize(value.replaceAll("_", " "))}`;
}

export function matchingProgressLabels(progress: { identified: number; accepted: number }) {
  return {
    identified: progress.identified ? `${progress.identified} ${progress.identified === 1 ? "match" : "matches"} identified` : "No matches yet",
    accepted: progress.accepted ? `${progress.accepted} accepted` : "No one has accepted yet",
  };
}

const MATCHING_PREFERENCE_KEYS = ["gaming_game", "build_role", "workshop_topic", "food_style", "coffee_energy", "explore_range", "group_energy", ...CATEGORIES.map((category) => `custom_${category.id}`)];

export function preferenceNotes(preferences: Record<string, string>): string {
  return [preferences.matching_notes, ...Object.entries(preferences)
    .filter(([key, value]) => MATCHING_PREFERENCE_KEYS.includes(key) && value !== "any")
    .map(([key, value]) => preferenceText(key, value))].filter(Boolean).join("\n");
}

export function preferencesFromNotes(text: string, previous: Record<string, string>): Record<string, string> {
  // Keep unrelated private fields out of the matching notes sent to AI.
  const preserved = Object.fromEntries(Object.entries(previous)
    .filter(([key]) => key !== "matching_notes" && !MATCHING_PREFERENCE_KEYS.includes(key)));
  return { ...preserved, ...(text.trim() ? { matching_notes: text.trim() } : {}) };
}

export function displayTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

// startBucket is the UTC hour, e.g. "2026-11-06T14". Show it in the device's zone.
export function bucketLabel(bucket: string): string {
  const date = new Date(`${bucket}:00:00Z`);
  if (Number.isNaN(date.getTime())) return bucket;
  return `around ${date.toLocaleTimeString([], { hour: "numeric" })}`;
}

export function countdown(msLeft: number): string {
  const seconds = Math.max(0, Math.floor(msLeft / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

// For waits that can run for hours or days. Rounds up so it reaches 00:00:00 as the moment arrives.
export function clockCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor(total / 3600) % 24;
  if (days > 0) return `${days}d ${hours}h`;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

export function durationLabel(minutes: number): string {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// Just the time for today; other days also need the date to be unambiguous.
export function scheduleTime(at: number, now: number): string {
  const date = new Date(at);
  const time = displayTime(date.toISOString());
  if (date.toDateString() === new Date(now).toDateString()) return time;
  return `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

export function timeAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

export function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

// <input type="datetime-local"> works in local wall-clock time with no offset.
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Rallies that still need the user's attention, for the home screen.
export const ACTIVE_RALLY_STATUSES = ["draft", "open", "waiting", "proposed", "ready", "formed", "met"];

export function rallyPath(status: string, id: string): string {
  if (status === "formed" || status === "completed") return `/app/room?id=${id}`;
  if (status === "met") return `/app/feedback?id=${id}`;
  return `/app/finding-people?rally=${id}`;
}

const REWARD_LABELS: Record<string, string> = {
  RallyCompleted: "Group photo reward",
  OnTime: "On time",
  HostCompleted: "Hosted a Rally",
  Vouched: "Someone vouched for you",
  Late: "Arrived late",
  LateCancel: "Cancelled late",
  NoShow: "Marked absent",
  ComplaintUpheld: "Report upheld against you",
  FalseComplaint: "False report",
};

export function rewardLabel(action: string | null): string {
  return (action && REWARD_LABELS[action]) ?? "Rally points";
}

export function signedPoints(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

// Routes each notification type to its screen, per the handoff table.
export function notificationPath(type: string, data: Record<string, string>): string {
  const { matchId, rallyId } = data;
  switch (type) {
    case "match.proposed":
    case "match.expired":
    case "match.unavailable":
      return matchId ? `/app/match-found?id=${matchId}` : "/app/match-found";
    case "rally.seat_open":
      return "/app/match-found";
    case "rally.completed":
    case "proof.needs_clearer_photos":
    case "rally.formed":
      return rallyId ? `/app/room?id=${rallyId}` : "/app/home";
    case "rally.met":
      return rallyId ? `/app/feedback?id=${rallyId}` : "/app/home";
    case "reward.earned":
    case "reward.penalty":
    case "reward.no_show_pending":
    case "dispute.resolved":
      return "/app/profile";
    case "rally.waiting":
    case "match.accepted":
    case "match.declined":
    case "rally.participant_withdrew":
    case "rally.cancelled":
    case "rally.expired":
      return rallyId ? `/app/finding-people?rally=${rallyId}` : "/app/home";
    default:
      return "/app/home";
  }
}
