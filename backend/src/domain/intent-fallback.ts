import type { Category, Vibe } from './catalog.js';

const KEYWORDS: readonly [Category, RegExp][] = [
  ['food', /\b(snack|food|dinner|lunch|breakfast|eat|meal|biryani|chai|pizza)\b/i],
  ['coffee', /\b(coffee|espresso|latte|cafe)\b/i],
  ['football', /\b(football|soccer|kickabout|kick around)\b/i],
  ['photography', /\b(photography|photograph|photos?|photo walk|camera)\b/i],
  ['music', /\b(music|concert|karaoke|guitar|singing|jam session|listen to songs)\b/i],
  ['gym', /\b(gym|workout|weightlifting|weights|fitness training)\b/i],
  ['nature', /\b(nature|hike|hiking|birdwatching|trail walk|outdoors)\b/i],
  ['fashion', /\b(fashion|styling|thrifting|clothes|outfits)\b/i],
  ['travel', /\b(travel|trip|backpacking|itinerary|flight|airport|flying|fly)\b/i],
  ['finance', /\b(finance|budgeting|investing|investment|personal finance)\b/i],
  ['technology', /\b(technology|tech|artificial intelligence|robotics|gadgets)\b/i],
  ['books', /\b(books|reading|book club|book discussion|novels?|literature)\b/i],
  ['animals', /\b(animals?|pets?|dogs?|cats?|pet shelter)\b/i],
  ['arts', /\b(arts?|painting|drawing|sketching|pottery|sculpture)\b/i],
  ['gaming', /\b(game|gaming|play|wow|chess|cards|fifa|carrom|carom|cricket|cricekt)\b/i],
  ['workshop', /\b(workshop|class|session|candle|learn)\b/i],
  ['build', /\b(build|hack|code|coding|debug|pitch|demo|review)\b/i],
  ['explore', /\b(explore|walk|tour|sightsee|market|wander)\b/i],
  ['networking', /\b(network|networking|meet people|founders|intro)\b/i],
  ['wellness', /\b(wellness|yoga|meditation|stretching|jog|joggin|jogging|run|running)\b/i],
  ['support', /\bsupport\b/i],
];

const NOW_WORDS = /\b(now|right now|asap|immediately)\b/i;
const TONIGHT_WORDS = /\b(tonight|late|midnight|evening)\b/i;
const RELATIVE_START = /\b(?:in\s+(\d{1,3})\s*(minutes?|mins?|m|hours?|hrs?|h)\b|(\d{1,3})\s*(minutes?|mins?|m|hours?|hrs?|h)\s+from\s+now\b)/i;

/** Resolve explicit starts only; never mistake “for 17 minutes” for a start. */
export function explicitStart(text: string, now: Date, timeZone = 'UTC'): Date | null {
  const relative = RELATIVE_START.exec(text);
  if (relative) {
    const amount = Number(relative[1] ?? relative[3]);
    const unit = (relative[2] ?? relative[4])!.toLowerCase();
    return new Date(now.getTime() + amount * (unit.startsWith('h') ? 60 : 1) * 60_000);
  }
  const clock = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i.exec(text);
  if (!clock) return null;
  let hour = Number(clock[1] ?? clock[4]);
  const minute = Number(clock[2] ?? clock[5] ?? 0);
  if (minute > 59 || (clock[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (clock[3]) hour = hour % 12 + (clock[3].toLowerCase() === 'pm' ? 12 : 0);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  const local = parts(now);
  let year = Number(local.year), month = Number(local.month), day = Number(local.day);
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const named = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+(\d{4}))?\b/i.exec(text);
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (named) { day = Number(named[1]); month = months.indexOf(named[2]!.slice(0, 3).toLowerCase()) + 1; year = Number(named[3] ?? year); }
  else if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
  else if (/\btomorrow\b/i.test(text)) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear(); month = next.getUTCMonth() + 1; day = next.getUTCDate();
  } else if (!/\btoday\b/i.test(text)) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  let result = wall;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(result));
    result += wall - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  }
  const resolved = parts(new Date(result));
  if (Number(resolved.hour) !== hour || Number(resolved.minute) !== minute) return null;
  return new Date(result);
}

export interface FallbackIntent {
  category: Category | null;
  goal: string;
  windowStart: Date;
  windowEnd: Date;
  durationMin: number;
  groupMin: number;
  groupMax: number;
  zone: string | null;
  vibe: Vibe;
}

/**
 * Used when 0G is unavailable. It only classifies with fixed rules and fills conservative defaults.
 * The result is marked for review, so the user confirms it in the editable form.
 */
export function parseIntentFallback(text: string, now: Date, timeZone = 'UTC'): FallbackIntent {
  const category = KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;

  let startOffsetMin = 15;
  if (NOW_WORDS.test(text)) startOffsetMin = 5;
  else if (TONIGHT_WORDS.test(text)) startOffsetMin = 60;

  const windowStart = explicitStart(text, now, timeZone) ?? new Date(now.getTime() + startOffsetMin * 60_000);
  return {
    category,
    goal: text.trim().slice(0, 120),
    windowStart,
    windowEnd: new Date(windowStart.getTime() + 2 * 60 * 60_000),
    durationMin: 45,
    groupMin: 2,
    groupMax: 2,
    zone: null,
    vibe: 'any',
  };
}

const PII_PATTERNS: readonly [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/https?:\/\/\S+/gi, '[link]'],
  [/\b0x[a-fA-F0-9]{40}\b/g, '[wallet]'],
  [/\+?\d[\d\s().-]{7,}\d/g, '[phone]'],
];

/** Strips direct identifiers before text crosses the model boundary. */
export function redactPii(text: string): string {
  return PII_PATTERNS.reduce((result, [pattern, label]) => result.replace(pattern, label), text);
}
