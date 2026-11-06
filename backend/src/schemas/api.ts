import { z } from 'zod';
import { preferenceSchema, PREFERENCE_CHOICES } from '../domain/questions.js';

import {
  CATEGORIES,
  MAX_DURATION_MIN,
  MAX_GROUP,
  MAX_QUESTIONS,
  MIN_GROUP,
  REQUIRED_INTERESTS,
  ROLES,
  VIBES,
} from '../domain/catalog.js';
import { paginationQuery } from '../lib/pagination.js';

const shortText = (max: number) => z.string().trim().min(1).max(max);
const dateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const isoString = z.string();
const category = z.enum(CATEGORIES);
const vibe = z.enum(VIBES);
const skills = z.array(shortText(30)).max(10);
const preferences = z.record(shortText(40), shortText(120)).refine(
  (value) => Object.keys(value).length <= 10,
  'at most 10 preferences',
).refine((values) => Object.entries(values).every(([key, value]) => !Object.hasOwn(PREFERENCE_CHOICES, key)
  || preferenceSchema.safeParse({ [key]: value }).success), 'choose a valid structured preference');

export const idParams = z.object({ id: z.uuid() });
export const userIdParams = z.object({ userId: z.uuid() });
export const idempotencyHeader = z.object({
  'idempotency-key': z.string().min(8).max(128).optional(),
});

export const userSchema = z.object({
  id: z.uuid(),
  walletAddress: z.string().nullable(),
  displayName: z.string().nullable(),
  optInMatching: z.boolean(),
  onboarded: z.boolean(),
});

export const profileSchema = z.object({
  version: z.number(),
  interests: z.array(z.string()),
  interestsVersion: z.number(),
  declaredSkills: z.array(z.string()),
  inferredTags: z.array(
    z.object({ tag: z.string(), confidence: z.number(), source: z.string(), at: z.string() }),
  ),
  evidence: z.array(
    z.object({
      type: z.literal('vouch'),
      rallyId: z.string(),
      contribution: z.string(),
      at: z.string(),
    }),
  ),
  preferences: z.record(z.string(), z.string()),
  availableFrom: z.string().nullable(),
  availableTo: z.string().nullable(),
  lastUpdatedAt: z.string(),
});

export const meSchema = z.object({ user: userSchema, profile: profileSchema.nullable() });

export const onboardingQuestionsBody = z.object({
  interests: z.array(category).length(REQUIRED_INTERESTS),
});

export const questionsSchema = z.object({
  questions: z.array(z.object({ id: z.string(), text: z.string(), options: z.array(z.object({ value: z.string(), label: z.string() })).optional() })),
  source: z.enum(['ai', 'fallback']),
  aiRequestId: z.string().nullable(),
});

export const onboardingBody = z.object({
  displayName: shortText(60).optional(),
  interests: z.array(category).length(REQUIRED_INTERESTS),
  answers: z
    .array(z.object({ questionId: shortText(40), answer: shortText(300) }))
    .max(MAX_QUESTIONS)
    .default([]),
  declaredSkills: skills.default([]),
  preferences: preferences.default({}),
  availableFrom: dateTime.optional(),
  availableTo: dateTime.optional(),
  optInMatching: z.boolean(),
});

export const profileUpdateBody = z.object({
  displayName: shortText(60).optional(),
  interests: z.array(category).length(REQUIRED_INTERESTS).optional(),
  declaredSkills: skills.optional(),
  preferences: preferences.optional(),
  availableFrom: dateTime.nullable().optional(),
  availableTo: dateTime.nullable().optional(),
  optInMatching: z.boolean().optional(),
});

export const blockBody = z.object({ userId: z.uuid() });

export const parseIntentBody = z.object({
  text: shortText(500),
  // Resolves words like "tonight". Must be a real IANA zone; the engine validates it too.
  timeZone: z
    .string()
    .max(64)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'must be an IANA time zone')
    .optional(),
});

export const answerIntentBody = z.object({
  answers: z
    .array(z.object({ questionId: shortText(40), answer: shortText(300) }))
    .min(1)
    .max(MAX_QUESTIONS),
});

export const intentSchema = z.object({
  preferences: preferenceSchema,
  id: z.uuid(),
  status: z.string(),
  source: z.enum(['ai', 'fallback']),
  category: z.string().nullable(),
  goal: z.string().nullable(),
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  durationMin: z.number().nullable(),
  groupMin: z.number().nullable(),
  groupMax: z.number().nullable(),
  zone: z.string().nullable(),
  vibe: z.string().nullable(),
  questions: z.array(z.object({ id: z.string(), text: z.string(), options: z.array(z.object({ value: z.string(), label: z.string() })).optional() })),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

export const parsedIntentSchema = z.object({
  intent: intentSchema,
  status: z.enum(['ready', 'needs_answers', 'needs_review']),
  needsReview: z.boolean(),
  aiRequestId: z.string().nullable(),
});

export const activateIntentBody = z.object({
  preferences: preferenceSchema.optional(),
  category: category.optional(),
  windowStart: dateTime.optional(),
  windowEnd: dateTime.optional(),
  durationMin: z.number().int().min(5).max(MAX_DURATION_MIN).optional(),
  zone: shortText(64).nullable().optional(),
  vibe: vibe.optional(),
  expiresAt: dateTime.optional(),
});

export const createRallyBody = z.object({
  preferences: preferenceSchema.optional(),
  intentId: z.uuid().optional(),
  category,
  goal: shortText(160),
  vibe: vibe.optional(),
  windowStart: dateTime,
  windowEnd: dateTime,
  durationMin: z.number().int().min(5).max(MAX_DURATION_MIN),
  zone: shortText(64),
  groupMin: z.number().int().min(MIN_GROUP).max(MAX_GROUP),
  capacity: z.number().int().min(MIN_GROUP).max(MAX_GROUP),
  slotRoles: z.array(z.enum(ROLES)).max(MAX_GROUP - 1).optional(),
  visibility: z.enum(['public_coarse', 'private']).optional(),
  meetingPoint: shortText(300).optional(),
  meetingBrief: shortText(500).optional(),
  publish: z.boolean().default(false),
});

export const updateRallyBody = z.object({
  expectedVersion: z.number().int().positive(),
  goal: shortText(160).optional(),
  vibe: vibe.optional(),
  windowStart: dateTime.optional(),
  windowEnd: dateTime.optional(),
  durationMin: z.number().int().min(5).max(MAX_DURATION_MIN).optional(),
  zone: shortText(64).optional(),
  groupMin: z.number().int().min(MIN_GROUP).max(MAX_GROUP).optional(),
  capacity: z.number().int().min(MIN_GROUP).max(MAX_GROUP).optional(),
  meetingPoint: shortText(300).optional(),
  meetingBrief: shortText(500).optional(),
});

export const rallyStatusSchema = z.enum([
  'draft',
  'open',
  'waiting',
  'proposed',
  'ready',
  'formed',
  'met',
  'completed',
  'cancelled',
  'expired',
]);

export const rallySchema = z.object({
  preferences: preferenceSchema,
  id: z.uuid(),
  opaqueId: z.string(),
  creatorId: z.uuid(),
  status: rallyStatusSchema,
  visibility: z.enum(['public_coarse', 'private']),
  category: z.string(),
  goal: z.string(),
  vibe: z.string().nullable(),
  windowStart: isoString,
  windowEnd: isoString,
  durationMin: z.number(),
  zone: z.string(),
  groupMin: z.number(),
  capacity: z.number(),
  openSeats: z.number(),
  expiresAt: isoString,
  version: z.number(),
  hasMeetingPoint: z.boolean(),
  createdAt: isoString,
});

export const listRalliesQuery = paginationQuery.extend({ status: rallyStatusSchema.optional() });
export const listQuery = paginationQuery;

export const participantSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  role: z.string(),
  checkedIn: z.boolean(),
});

export const roomSchema = z.object({
  rallyId: z.uuid(),
  status: rallyStatusSchema,
  goal: z.string(),
  windowStart: isoString,
  windowEnd: isoString,
  zone: z.string(),
  meetingPoint: z.string().nullable(),
  meetingBrief: z.string().nullable(),
  members: z.array(participantSchema),
});

export const checkInBody = z.object({ presentUserIds: z.array(z.uuid()).max(MAX_GROUP) });

export const feedbackBody = z.object({
  happened: z.boolean(),
  useful: z.boolean().optional(),
  vouches: z
    .array(z.object({ recipientId: z.uuid(), contribution: shortText(200) }))
    .max(MAX_GROUP)
    .default([]),
  encoreWith: z.array(z.uuid()).max(MAX_GROUP).default([]),
});

export const feedbackResultSchema = z.object({
  rallyStatus: rallyStatusSchema,
  vouches: z.array(z.object({ recipientId: z.uuid(), verification: z.string() })),
});

export const respondBody = z.object({ response: z.enum(['accept', 'decline']) });

export const matchSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  role: z.string(),
  holdUntil: isoString,
  reason: z.string(),
  source: z.enum(['ai', 'deterministic']),
  rally: z.object({
    id: z.uuid(),
    status: rallyStatusSchema,
    category: z.string(),
    goal: z.string(),
    vibe: z.string().nullable(),
    windowStart: isoString,
    windowEnd: isoString,
    durationMin: z.number(),
    zone: z.string(),
    groupMin: z.number(),
    capacity: z.number(),
    openSeats: z.number(),
  }),
});

export const matchesSchema = z.object({
  matches: z.array(matchSchema),
  waiting: z.array(
    z.object({
      id: z.uuid(),
      category: z.string().nullable(),
      goal: z.string().nullable(),
      expiresAt: z.string().nullable(),
    }),
  ),
});

export const previewQuery = z.object({
  category: category.optional(),
  zone: shortText(64).optional(),
  startBucket: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

export const previewSchema = z.object({
  available: z.boolean(),
  notice: z.string().nullable(),
  activities: z.array(
    z.object({
      opaqueId: z.string(),
      category: z.string(),
      zone: z.string(),
      startBucket: z.string(),
      neededRole: z.string(),
      minGroupSize: z.number(),
      openSeats: z.number(),
      status: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export const notificationSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.string()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

export const notificationsQuery = paginationQuery.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export const rewardsSchema = z.object({
  balance: z.number(),
  entries: z.array(
    z.object({
      id: z.uuid(),
      rallyId: z.uuid().nullable(),
      reason: z.string(),
      points: z.number(),
      policyVersion: z.number(),
      createdAt: z.string(),
    }),
  ),
});

export const voucherSchema = z.object({
  domain: z.object({
    name: z.string(),
    version: z.string(),
    chainId: z.number(),
    verifyingContract: z.string(),
  }),
  message: z.object({
    account: z.string(),
    amount: z.string(),
    nonce: z.string(),
    expiry: z.string(),
  }),
  signature: z.string(),
});

export const metricsSchema = z.object({
  users: z.object({ total: z.number(), onboarded: z.number(), opted_in: z.number() }),
  rallies: z.record(z.string(), z.number()),
  proposals: z.record(z.string(), z.number()),
  offers: z.record(z.string(), z.number()),
  outbox: z.record(z.string(), z.number()),
  oldestPendingOutboxSeconds: z.number().nullable(),
  arkivEntities: z.record(z.string(), z.number()),
  aiRuns: z.record(z.string(), z.number()),
});
