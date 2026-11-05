import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const ids = z.array(id).max(30).refine((v) => new Set(v).size === v.length);
const time = z.iso.datetime();
const base = { requestId: id };
const question = z.strictObject({ id, purpose: z.string().min(1).max(200) });
const questions = z.array(question).max(20).refine((v) => new Set(v.map((q) => q.id)).size === v.length);
export const onboardingInput = z.strictObject({
  ...base, interests: ids.length(3), questions, alreadyAnsweredIds: ids,
  remainingQuestions: z.number().int().min(0).max(3),
});
export const questionSelection = z.strictObject({ schemaVersion: z.literal(1), questionIds: ids.max(3) });
export const activityInput = z.strictObject({
  ...base, text: z.string().min(1).max(2000),
  answers: z.array(z.strictObject({ questionId: id, answer: z.string().max(300) })).max(3),
  questions, remainingQuestions: z.number().int().min(0).max(3),
  attempt: z.number().int().min(0).max(1),
  now: time, eventEnd: time,
  timeZone: z.string().refine((v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }),
  allowedCategoryIds: ids.min(1), allowedZoneIds: ids.min(1),
});
export const intentSchema = z.strictObject({
  categoryId: id, goal: z.string().min(1).max(160), startAt: time,
  durationMin: z.number().int().min(5).max(480),
  groupMin: z.number().int().min(2).max(20), groupMax: z.number().int().min(2).max(20),
  zoneId: id, vibe: z.enum(['quiet', 'chatty', 'any']),
}).refine((v) => v.groupMin <= v.groupMax);
export const parseResult = z.discriminatedUnion('status', [
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal('ready'), intent: intentSchema }),
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal('needs_answers'), questionIds: ids.min(1).max(3) }),
]);
const person = z.strictObject({
  id, optedIn: z.literal(true), interests: ids, roleIds: ids, zoneIds: ids.min(1),
  availableFrom: time, availableUntil: time,
}).refine((v) => Date.parse(v.availableFrom) < Date.parse(v.availableUntil));
export const compositionInput = z.strictObject({
  ...base,
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
