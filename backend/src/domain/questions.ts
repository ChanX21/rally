import { z } from 'zod';
import { type Category, ONBOARDING_QUESTIONS, ACTIVITY_QUESTIONS, type QuestionTemplate } from './catalog.js';

export const PREFERENCE_CHOICES = {
  gaming_game: ['chess', 'valorant', 'minecraft', 'wow', 'any'],
  build_role: ['builder', 'reviewer', 'mentor', 'any'],
  workshop_topic: ['ai', 'web3', 'frontend', 'any'],
  food_style: ['sit_down', 'takeaway', 'any'],
  coffee_energy: ['quiet', 'chatty', 'any'],
  explore_range: ['venue', 'nearby', 'any'],
  group_energy: ['quiet', 'chatty', 'any'],
} as const;
export type PreferenceKey = keyof typeof PREFERENCE_CHOICES;
export const preferenceSchema = z.record(z.string(), z.string()).refine((v) =>
  Object.entries(v).every(([key, value]) => Object.hasOwn(PREFERENCE_CHOICES, key)
    && (PREFERENCE_CHOICES[key as PreferenceKey] as readonly string[]).includes(value)), 'unknown preference or option');
export type Preferences = Record<string, string>;
const categoryKey: Partial<Record<Category, PreferenceKey>> = {
  gaming: 'gaming_game', build: 'build_role', workshop: 'workshop_topic',
  food: 'food_style', coffee: 'coffee_energy', explore: 'explore_range',
};
const texts: Record<string, string> = {
  gaming_game: 'Which game would you like to find people for?',
  build_role: 'When building together, would you like to build, review, or mentor?',
  workshop_topic: 'Which workshop topic would you like a learning buddy for?',
  food_style: 'For food plans, do you prefer sitting down together or grabbing takeaway?',
  coffee_energy: 'Would you prefer a quiet coffee break or a chatty coffee group?',
  explore_range: 'Would you rather explore the venue or head to the nearby area?',
};
function template(key: PreferenceKey): QuestionTemplate {
  return { id: key, text: texts[key]!, purpose: texts[key]!,
    options: PREFERENCE_CHOICES[key].map((value) => ({ value, label: value === 'any' ? 'No preference' : value.replaceAll('_', ' ') })) };
}
export const PERSONAL_QUESTIONS = Object.values(categoryKey).map(template);
export function onboardingCatalog(interests: readonly string[]) {
  const personal = interests.flatMap((category) => {
    const key = categoryKey[category as Category];
    return key ? [template(key)] : [];
  });
  return personal.length >= 3 ? personal : [...personal, ...ONBOARDING_QUESTIONS];
}
const activityTexts: Record<string, string> = {
  gaming_game: 'Which game is this Rally for?', build_role: 'Which role do you need help with for this build?',
  workshop_topic: 'Which topic is this workshop Rally about?', food_style: 'For this food run, sit down together or grab takeaway?',
  coffee_energy: 'Should this coffee Rally be quiet or chatty?', explore_range: 'Are we exploring the venue or the nearby area?',
};
export const activityCatalog = [...ACTIVITY_QUESTIONS, ...PERSONAL_QUESTIONS.map((q) => ({ ...q, text: activityTexts[q.id]!, purpose: activityTexts[q.id]! }))];
export function safePreferences(input: Record<string, string>): Preferences {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => Object.hasOwn(PREFERENCE_CHOICES, key)
    && (PREFERENCE_CHOICES[key as PreferenceKey] as readonly string[]).includes(value)));
}
export function preferencesFromAnswers(answers: { questionId: string; answer: string }[]): Preferences {
  return safePreferences(Object.fromEntries(answers.map((a) => [a.questionId, a.answer.trim().toLowerCase()])));
}
export function relevantPreferences(category: string, preferences: Preferences): Preferences {
  const key = categoryKey[category as Category];
  return key && preferences[key] ? { [key]: preferences[key] } : {};
}
export function compatiblePreferences(wanted: Preferences, actual: Preferences) {
  return Object.entries(wanted).every(([key, value]) => value === 'any' || !actual[key] || actual[key] === 'any' || actual[key] === value);
}
