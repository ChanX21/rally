import type { Category } from './catalog.js';

// shortcut: uncommon titles use category copy; add a cue when a new activity needs its own joke.
const TITLE_LINES: readonly [RegExp, string][] = [
  [/\b(coffee|espresso|latte|cappuccino)\b/i, 'Someone up for coffee?'],
  [/\b(pitch|pitches|pitching)\b/i, 'I have a pitch. You have ears?'],
  [/\b(chess)\b/i, 'Your move. Literally.'],
  [/\b(debug|debugging|bugs?)\b/i, 'My code needs a second opinion.'],
  [/\b(pizza)\b/i, 'Pizza tastes better with a plus one.'],
  [/\b(jog|joggin|jogging|running)\b/i, "Jogging buddy? I'll bring the wheezing."],
  [/\b(yoga|stretch|stretching)\b/i, 'Stretch goals, but make them literal.'],
];
const CATEGORY_LINES: Record<Category, string> = {
  coffee: 'Someone up for coffee?',
  food: 'My stomach called a meeting.',
  gaming: 'Player two, where are you?',
  build: 'Two brains. Hopefully fewer bugs.',
  workshop: 'Anyone else learning on the fly?',
  explore: 'Side quest, anyone?',
  networking: 'Strangers now, collaborators later?',
  wellness: 'Anyone up for a little reset?',
  support: 'A listening ear, anyone?',
};

/** Public copy is curated; names, contacts and exact locations in a title stay private. */
export function rallyDialogue(title: string, category: string): string {
  return TITLE_LINES.find(([pattern]) => pattern.test(title))?.[1]
    ?? (Object.hasOwn(CATEGORY_LINES, category) ? CATEGORY_LINES[category as Category] : 'Good company, anyone?');
}
