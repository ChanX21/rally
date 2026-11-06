import type { Category, Vibe } from './catalog.js';

const KEYWORDS: readonly [Category, RegExp][] = [
  ['food', /\b(snack|food|dinner|lunch|breakfast|eat|meal|biryani|chai|pizza)\b/i],
  ['coffee', /\b(coffee|espresso|latte|cafe)\b/i],
  ['gaming', /\b(game|gaming|play|wow|chess|cards|fifa)\b/i],
  ['workshop', /\b(workshop|class|session|candle|learn)\b/i],
  ['build', /\b(build|hack|code|coding|debug|pitch|demo|review)\b/i],
  ['explore', /\b(explore|walk|tour|sightsee|market|wander)\b/i],
  ['networking', /\b(network|networking|meet people|founders|intro)\b/i],
  ['wellness', /\b(wellness|yoga|meditation|stretching|jog|joggin|jogging|run|running)\b/i],
  ['support', /\bsupport\b/i],
];

const NOW_WORDS = /\b(now|right now|asap|immediately)\b/i;
const TONIGHT_WORDS = /\b(tonight|late|midnight|evening)\b/i;
const IN_HOURS = /\bin (\d{1,2}) ?(?:h|hr|hrs|hour|hours)\b/i;

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

  const hours = IN_HOURS.exec(text);
  let startOffsetMin = 15;
  if (hours?.[1]) startOffsetMin = Number(hours[1]) * 60;
  else if (NOW_WORDS.test(text)) startOffsetMin = 5;
  else if (TONIGHT_WORDS.test(text)) startOffsetMin = 60;

  const windowStart = new Date(now.getTime() + startOffsetMin * 60_000);
  return {
    category,
    goal: text.trim().slice(0, 120),
    windowStart,
    windowEnd: new Date(windowStart.getTime() + 2 * 60 * 60_000),
    durationMin: 45,
    groupMin: 2,
    groupMax: 4,
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
