/** Fixed catalog. Everything that reaches matching or Arkiv comes from these lists. */
export const CATEGORIES = [
  'build',
  'coffee',
  'workshop',
  'gaming',
  'food',
  'explore',
  'networking',
  'wellness',
  'support',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Forced private: never published to Arkiv, whatever the creator asked for. */
export const SENSITIVE_CATEGORIES: readonly Category[] = ['wellness', 'support'];

export const VIBES = ['quiet', 'chatty', 'any'] as const;
export type Vibe = (typeof VIBES)[number];

export const ROLES = ['participant', 'buddy', 'builder', 'reviewer', 'mentor'] as const;
export type Role = (typeof ROLES)[number];
/** The creator's seat. Never offered to candidates. */
export const HOST_ROLE = 'host';

export const REQUIRED_INTERESTS = 3;
export const MAX_QUESTIONS = 3;
export const MIN_GROUP = 2;
export const MAX_GROUP = 12;
export const MAX_DURATION_MIN = 480;
export const MAX_DAYS_AHEAD = 14;
export const SHORTLIST_SIZE = 8;

export function isSensitive(category: Category): boolean {
  return SENSITIVE_CATEGORIES.includes(category);
}

export interface QuestionTemplate {
  id: string;
  text: string;
}

/** Constrained templates. AI may only choose among these for onboarding. */
export const ONBOARDING_QUESTIONS: readonly QuestionTemplate[] = [
  { id: 'group_energy', text: 'Do you prefer quiet hangouts or chatty groups?' },
  { id: 'skill_offer', text: 'What is one thing you could help someone with today?' },
  { id: 'looking_for', text: 'What are you hoping to get out of this event?' },
  { id: 'travel_range', text: 'How far from the venue are you happy to go?' },
  { id: 'group_size', text: 'Do you prefer pairs or small groups?' },
];
