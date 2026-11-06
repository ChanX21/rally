import { expect, it } from 'vitest';

import { type Category } from '../src/domain/catalog.js';
import { parseIntentFallback } from '../src/domain/intent-fallback.js';
import { activityCatalog, activityQuestions } from '../src/domain/questions.js';

it.each<[Category, string, RegExp]>([
  ['coffee', 'Coffee after the 0G workshop', /coffee/],
  ['food', 'Food with friends', /bite|meal/],
  ['gaming', 'Play chess', /game/],
  ['build', 'Build a demo together', /building/],
  ['workshop', 'Workshop buddies', /workshop/],
  ['explore', 'Explore the venue', /outing/],
  ['networking', 'Networking meetup', /introductions|conversations/],
  ['wellness', 'Wellness activity', /wellness/],
  ['support', 'Support meetup', /comfortable/],
])('uses %s wording without changing question meanings', (category, text, duration) => {
  expect(parseIntentFallback(text, new Date()).category).toBe(category);
  const questions = activityQuestions(category, text);
  expect(questions.find((q) => q.id === 'duration')?.text).toMatch(duration);
  expect(questions.map(({ text: _text, ...q }) => q)).toEqual(
    activityCatalog.map(({ text: _text, ...q }) => q),
  );
});

it('uses the named workshop only when the plan explicitly follows it', () => {
  const start = (text: string) => activityQuestions('coffee', text).find((q) => q.id === 'start_time')?.text;
  expect(start('Coffee after the 0G workshop')).toBe('What time does the 0G workshop finish?');
  expect(start('Coffee after the AI safety workshop')).toBe('What time does the AI safety workshop finish?');
  expect(start('Coffee before the 0G workshop')).toBe('What date and time should your coffee break start?');
});

it('keeps unknown plans usable and never mutates the shared catalog', () => {
  const before = structuredClone(activityCatalog);
  expect(activityQuestions(null, 'Something together')).toEqual(activityCatalog);
  activityQuestions('coffee', 'Coffee after the 0G workshop');
  activityQuestions('gaming', 'Play chess');
  expect(activityCatalog).toEqual(before);
});
