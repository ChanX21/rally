import { z } from 'zod';
import { preferenceSchema } from '../domain/questions.js';
import { CATEGORIES } from '../domain/catalog.js';
import { redactPii } from '../domain/intent-fallback.js';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const ids = z.array(id).max(30).refine((v) => new Set(v).size === v.length);
const time = z.iso.datetime();
const base = { requestId: id };
export const mapDialogueInput = z.strictObject({ ...base, title: z.string().min(1).max(160), category: z.enum(CATEGORIES) });
export const mapDialogueText = z.string().trim().min(1).max(80).refine((text) =>
  !/[\r\n<>@[\]]/.test(text) && redactPii(text) === text, 'dialogue must be a single public-safe line');
export const mapDialogueResult = z.strictObject({ schemaVersion: z.literal(1), dialogue: mapDialogueText });
const question = z.strictObject({ id, purpose: z.string().min(1).max(200), options: z.array(z.object({ value: z.string(), label: z.string() })).max(10).optional() });
const questions = z.array(question).max(32).refine((v) => new Set(v.map((q) => q.id)).size === v.length);
export const onboardingInput = z.strictObject({
  ...base, interests: ids.length(3), questions, alreadyAnsweredIds: ids,
  remainingQuestions: z.number().int().min(0).max(3),
});
export const questionSelection = z.strictObject({ schemaVersion: z.literal(1), questionIds: ids.max(3) });
export const intentSchema = z.strictObject({
  categoryId: id, goal: z.string().min(1).max(160), startAt: time,
  durationMin: z.number().int().min(5).max(480),
  groupMin: z.number().int().min(2).max(20).default(2), groupMax: z.number().int().min(2).max(20).default(2),
  preferences: preferenceSchema.optional(),
  zoneId: id, vibe: z.enum(['quiet', 'chatty', 'any']),
}).refine((v) => v.groupMin <= v.groupMax);
export const knownIntentSchema = z.strictObject({ ...intentSchema.shape,
  groupMin: intentSchema.shape.groupMin.removeDefault(), groupMax: intentSchema.shape.groupMax.removeDefault(),
}).partial()
  .refine((value) => value.groupMin === undefined || value.groupMax === undefined || value.groupMin <= value.groupMax);
export type KnownIntent = z.infer<typeof knownIntentSchema>;
export const activityInput = z.strictObject({
  ...base, text: z.string().min(1).max(2000),
  answers: z.array(z.strictObject({ questionId: id, answer: z.string().max(300) })).max(3),
  questions, remainingQuestions: z.number().int().min(0).max(3),
  attempt: z.number().int().min(0).max(1),
  knownIntent: knownIntentSchema.optional(),
  profile: z.strictObject({ interests: ids, declaredSkills: ids, preferences: preferenceSchema }).optional(),
  now: time, eventEnd: time,
  timeZone: z.string().refine((v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }),
  allowedCategoryIds: ids.min(1), allowedZoneIds: ids.min(1),
});
export const parseResult = z.discriminatedUnion('status', [
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal('ready'), intent: intentSchema }),
  z.strictObject({
    schemaVersion: z.literal(1), status: z.literal('needs_answers'), questionIds: ids.min(1).max(3),
    questionTexts: z.record(id, z.string().trim().min(1).max(200)).optional(),
    intent: knownIntentSchema.optional(),
  }),
]);
const person = z.strictObject({
  preferences: preferenceSchema.optional(),
  id, optedIn: z.literal(true), roleIds: ids, zoneIds: ids.min(1),
  availableFrom: time, availableUntil: time,
}).refine((v) => Date.parse(v.availableFrom) < Date.parse(v.availableUntil));
export const compositionInput = z.strictObject({
  ...base,
  invitationLimit: z.number().int().min(1).max(11).optional(),
  rally: z.strictObject({
    id, intent: intentSchema, requiredMembers: z.array(person).min(1).max(20), requiredRoleIds: ids,
  }),
  candidates: z.array(person).max(20),
}).refine((v) => {
  const all = [...v.rally.requiredMembers, ...v.candidates];
  return new Set(all.map((p) => p.id)).size === all.length;
});
export const compositionResult = z.discriminatedUnion('status', [
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal('no_fit') }),
  z.strictObject({
    schemaVersion: z.literal(1), status: z.literal('proposed'), memberIds: ids.min(2).max(20),
    roles: z.array(z.strictObject({ memberId: id, roleId: id })).max(20),
    reason: z.string().min(1).max(240),
  }),
]);
export type CompositionInput = z.infer<typeof compositionInput>;
export type CompositionResult = z.infer<typeof compositionResult>;

export const proofInput = z.strictObject({
  requestId: id, category: id, goal: z.string().min(1).max(160), note: z.string().max(300),
  images: z.array(z.string().startsWith('data:image/jpeg;base64,').max(1_400_000)).min(1).max(3),
});
export const proofAssessment = z.strictObject({
  schemaVersion: z.literal(1), activityMatch: z.enum(['matched', 'mismatched', 'uncertain']),
  assessable: z.boolean(), groupEvidence: z.boolean(), visiblePeople: z.number().int().min(0).max(100),
  duplicateImages: z.boolean(), reason: z.string().min(1).max(500),
});
