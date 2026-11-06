import { expect, it } from 'vitest';
import { rallyDialogue } from '../src/domain/map-dialogue.js';

it.each([
  ['Rally for coffee', 'coffee', 'Someone up for coffee?'],
  ['Someone to hear my pitch', 'build', 'I have a pitch. You have ears?'],
  ['Chess after lunch', 'gaming', 'Your move. Literally.'],
  ['Debug this bug with me', 'build', 'My code needs a second opinion.'],
  ['Need someone to go joggin with?', 'wellness', "Jogging buddy? I'll bring the wheezing."],
  ['A snack run', 'food', 'My stomach called a meeting.'],
  ['Something unusual', '__proto__', 'Good company, anyone?'],
])('makes a short activity-specific line from %s', (title, category, expected) => {
  expect(rallyDialogue(title, category)).toBe(expected);
  expect(expected.length).toBeLessThanOrEqual(80);
});

it('never copies personal information or unknown titles into a public bubble', () => {
  const title = 'Meet Alice at table 7, alice@example.com, +919876543210';
  expect(rallyDialogue(title, 'networking')).toBe('Strangers now, collaborators later?');
  expect(rallyDialogue(title, 'unknown')).toBe('Good company, anyone?');
});
