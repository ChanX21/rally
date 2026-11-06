import { z } from 'zod';
import { type Category, CATEGORIES, ONBOARDING_QUESTIONS, ACTIVITY_QUESTIONS, type QuestionTemplate } from './catalog.js';

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
export const customPreferenceText = z.string().trim().min(1).max(120);
export const isCustomPreference = (key: string) => key === 'matching_notes' || CATEGORIES.some((category) => key === `custom_${category}`);
export const preferenceSchema = z.record(z.string().max(40), z.string().trim().min(1).max(4000)).refine((v) =>
  Object.entries(v).every(([key, value]) => key === 'matching_notes' ? value.length <= 4000 : isCustomPreference(key) ? customPreferenceText.safeParse(value).success
    : Object.hasOwn(PREFERENCE_CHOICES, key) && (PREFERENCE_CHOICES[key as PreferenceKey] as readonly string[]).includes(value)), 'unknown preference or option');
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

const activityWording: Record<Category, { name: string; duration: string; distance: string }> = {
  coffee: { name: 'coffee break', duration: 'A quick coffee or time to sit and chat—about how many minutes?', distance: 'Stay at the venue or walk to a nearby café?' },
  food: { name: 'food meetup', duration: 'A quick bite or a longer meal—about how many minutes?', distance: 'Eat at the venue or find somewhere nearby?' },
  gaming: { name: 'gaming session', duration: 'One quick game or a longer session—about how many minutes?', distance: 'Play at the venue or head somewhere nearby?' },
  build: { name: 'build session', duration: 'How many minutes would you like to spend building together?', distance: 'Work at the venue or meet somewhere nearby?' },
  workshop: { name: 'workshop meetup', duration: 'How many minutes should we set aside for this workshop meetup?', distance: 'Meet at the workshop venue or somewhere nearby?' },
  explore: { name: 'outing', duration: 'A short wander or a longer outing—about how many minutes?', distance: 'Explore the venue or head into the nearby area?' },
  networking: { name: 'networking meetup', duration: 'Quick introductions or longer conversations—about how many minutes?', distance: 'Meet people at the venue or head somewhere nearby?' },
  wellness: { name: 'wellness activity', duration: 'How many minutes would you like to set aside for this wellness activity?', distance: 'Stay at the venue or find a nearby spot for this activity?' },
  support: { name: 'support meetup', duration: 'How much time would feel comfortable for this meetup, in minutes?', distance: 'Meet at the venue or somewhere nearby?' },
};

/** Changes presentation only: IDs, purposes and offered answers keep their existing meaning. */
export function activityQuestions(category: Category | null, text: string): QuestionTemplate[] {
  const context = category ? activityWording[category] : null;
  const wording: Record<string, string> = context ? {
    start_time: `What date and time should your ${context.name} start?`,
    duration: context.duration,
    distance: context.distance,
    group_fit: `Would you prefer a quieter group or plenty of conversation for your ${context.name}?`,
    group_size: `How many people would you like in your ${context.name}, including you?`,
  } : {};
  const afterWorkshop = /\bafter\s+(?:the\s+)?((?:[\p{L}\p{N}-]+\s+){0,4}workshop)\b/iu.exec(text);
  if (afterWorkshop) wording.start_time = `What time does the ${afterWorkshop[1]} finish?`;
  return activityCatalog.map((q) => ({ ...q, text: wording[q.id] ?? q.text }));
}

export function safePreferences(input: Record<string, string>): Preferences {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => preferenceSchema.safeParse({ [key]: value }).success));
}
export function validPreferenceAnswer(answer: string): boolean {
  return customPreferenceText.safeParse(answer).success;
}
export function preferencesFromAnswers(answers: { questionId: string; answer: string }[]): Preferences {
  return Object.fromEntries(answers.flatMap(({ questionId, answer }) => {
    const value = answer.trim().toLowerCase();
    const category = Object.entries(categoryKey).find(([, key]) => key === questionId)?.[0];
    return preferenceSchema.safeParse({ [questionId]: value }).success
      ? [[questionId, value]] : category && validPreferenceAnswer(answer) ? [[`custom_${category}`, answer.trim()]] : [];
  }));
}
export function relevantPreferences(category: string, preferences: Preferences): Preferences {
  const key = categoryKey[category as Category];
  return Object.fromEntries(Object.entries(safePreferences(preferences)).filter(([id]) =>
    id === `custom_${category}` || (id === key && !preferences[`custom_${category}`])));
}
/** Personal notes help matching, but must never be copied onto a published activity. */
export function matchingPreferences(category: string, preferences: Preferences): Preferences {
  const notes = safePreferences(preferences).matching_notes;
  return { ...relevantPreferences(category, preferences), ...(notes ? { matching_notes: notes } : {}) };
}
export function mergePreferences(...sources: Preferences[]): Preferences {
  const merged: Preferences = {};
  for (const source of sources) {
    for (const [category, key] of Object.entries(categoryKey)) {
      if (source[`custom_${category}`]) delete merged[key];
      else if (source[key]) delete merged[`custom_${category}`];
    }
    Object.assign(merged, source);
  }
  return merged;
}
export function compatiblePreferences(wanted: Preferences, actual: Preferences) {
  return Object.entries(wanted).every(([key, value]) => isCustomPreference(key) || value === 'any' || !actual[key] || actual[key] === 'any' || actual[key] === value);
}
