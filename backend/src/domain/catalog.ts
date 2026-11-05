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
// A fresh Rally may need every seat except the host to reach its minimum.
export const SHORTLIST_SIZE = MAX_GROUP - 1;

export function isSensitive(category: Category): boolean {
  return SENSITIVE_CATEGORIES.includes(category);
}

export interface QuestionTemplate {
  id: string;
  /** Shown to the user. Never written by the model. */
  text: string;
  /** Sent to the model so it can choose relevant questions. */
  purpose: string;
}

/** Constrained templates. The Formation Engine may only choose among these IDs. */
export const ONBOARDING_QUESTIONS: readonly QuestionTemplate[] = [
  {
    id: 'group_energy',
    text: 'Do you prefer quiet hangouts or chatty groups?',
    purpose: 'Social energy, to fit people to a group vibe',
  },
  {
    id: 'skill_offer',
    text: 'What is one thing you could help someone with today?',
    purpose: 'A capability this person could contribute',
  },
  {
    id: 'looking_for',
    text: 'What are you hoping to get out of this event?',
    purpose: 'Goals, to tell apart similar interests',
  },
  {
    id: 'travel_range',
    text: 'How far from the venue are you happy to go?',
    purpose: 'Willingness to leave the venue',
  },
  {
    id: 'group_size',
    text: 'Do you prefer pairs or small groups?',
    purpose: 'Preferred group size',
  },
];

/** Asked only when the answer changes a real matching decision. */
export const ACTIVITY_QUESTIONS: readonly QuestionTemplate[] = [
  { id: 'start_time', text: 'When do you want to start?', purpose: 'The start date and time' },
  { id: 'duration', text: 'How long do you expect it to take?', purpose: 'The duration in minutes' },
  { id: 'distance', text: 'How far are you willing to go?', purpose: 'Which event zone it happens in' },
  { id: 'group_fit', text: 'Quiet hangout or chatty group?', purpose: 'The group vibe' },
  { id: 'group_size', text: 'How many people, including you?', purpose: 'Minimum and maximum group size' },
];
