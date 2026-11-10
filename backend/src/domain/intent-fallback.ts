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
  ['gaming', /\b(game|gaming|play|wow|chess|cards|fifa|carrom|carom)\b/i],
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

/** Only explicit relative starts; “for 17 minutes” is a duration, not a start. */
export function explicitStart(text: string, now: Date): Date | null {
  const match = RELATIVE_START.exec(text);
  if (!match) return null;
  const amount = Number(match[1] ?? match[3]);
  const unit = (match[2] ?? match[4])!.toLowerCase();
  return new Date(now.getTime() + amount * (unit.startsWith('h') ? 60 : 1) * 60_000);
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
export function parseIntentFallback(text: string, now: Date): FallbackIntent {
  const category = KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;

  let startOffsetMin = 15;
  if (NOW_WORDS.test(text)) startOffsetMin = 5;
  else if (TONIGHT_WORDS.test(text)) startOffsetMin = 60;

  const windowStart = explicitStart(text, now) ?? new Date(now.getTime() + startOffsetMin * 60_000);
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
