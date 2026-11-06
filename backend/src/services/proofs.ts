import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { z } from 'zod';
import { rallies, rallyProofs, rewardLedger } from '../db/schema/index.js';
import { redactPii } from '../domain/intent-fallback.js';
import type { Deps } from '../lib/deps.js';
import { AppError, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { enqueue } from '../lib/outbox.js';
import { lockRally } from '../repositories/rallies.js';
import { lockUser } from '../repositories/users.js';
import { latestPolicy } from './rewards.js';

export const proofBody = z.object({ images: z.array(z.string().min(1).max(7_000_000)).min(1).max(3), note: z.string().trim().max(300).default('') });
export const proofViewSchema = z.object({ id: z.uuid().nullable(), state: z.enum(['not_submitted', 'processing', 'accepted', 'needs_clearer_photos', 'unavailable']),
  reason: z.string().nullable(), canSubmit: z.boolean(), rewardAmount: z.number(), rewardedCount: z.number(), submissionsLeft: z.number(), closesAt: z.string() });
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Proof = typeof rallyProofs.$inferSelect;

export async function normalizeProofImages(inputs: string[]) {
  const result: { data: string; hash: string }[] = [];
  for (const input of inputs) {
    const match = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
    if (!match || match[1]!.length % 4 !== 0) throw new AppError(422, 'INVALID_PHOTO', 'Choose a JPEG or PNG photo');
    const bytes = Buffer.from(match[1]!, 'base64');
    if (bytes.length > 5 * 1024 * 1024) throw new AppError(422, 'PHOTO_TOO_LARGE', 'Each photo must be 5 MB or smaller');
    try {
      const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning' });
      const meta = await image.metadata();
      if (!['jpeg', 'png'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1 || !meta.width || !meta.height || meta.width < 64 || meta.height < 64) throw new Error('Invalid photo');
      const normalized = await image.rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      if (normalized.length > 1_000_000) throw new Error('Photo too large');
      result.push({ data: `data:image/jpeg;base64,${normalized.toString('base64')}`, hash: digest(normalized) });
    } catch { throw new AppError(422, 'INVALID_PHOTO', 'Choose a clear JPEG or PNG photo under 20 megapixels'); }
  }
  if (new Set(result.map((image) => image.hash)).size !== result.length) throw new AppError(422, 'DUPLICATE_PHOTO', 'Choose different photos, not copies of the same photo');
  return result;
}

async function ownedRally(deps: Deps, userId: string, rallyId: string) {
  const [rally] = await deps.db.select().from(rallies).where(eq(rallies.id, rallyId));
  if (!rally?.proofFlow || rally.status !== 'completed' || !rally.completedAt || !rally.completionMemberIds.includes(userId)) throw notFound('Rally');
  return rally;
}
export async function getProof(deps: Deps, userId: string, rallyId: string): Promise<z.infer<typeof proofViewSchema>> {
  const rally = await ownedRally(deps, userId, rallyId);
  const rows = await deps.db.select({ id: rallyProofs.id, state: rallyProofs.state, reason: rallyProofs.reason, rewardAmount: rallyProofs.rewardAmount })
    .from(rallyProofs).where(eq(rallyProofs.rallyId, rallyId)).orderBy(desc(rallyProofs.createdAt));
  const current = rows.find((p) => p.state === 'accepted') ?? rows[0];
  const closesAt = new Date(rally.completedAt!.getTime() + 48 * 3600000);
  return { id: current?.id ?? null, state: current?.state ?? 'not_submitted', reason: current?.reason ?? null,
    rewardAmount: current?.rewardAmount ?? (await latestPolicy(deps.db)).amounts.RallyCompleted,
    rewardedCount: current?.state === 'accepted' ? rally.completionMemberIds.length : 0,
    canSubmit: deps.env.PROOFS_ENABLED && closesAt > new Date() && rows.length < 3 && !rows.some((p) => ['processing', 'accepted'].includes(p.state)),
    submissionsLeft: Math.max(0, 3 - rows.length), closesAt: closesAt.toISOString() };
}
export async function submitProof(deps: Deps, userId: string, rallyId: string, input: z.infer<typeof proofBody>, key: string) {
  await ownedRally(deps, userId, rallyId);
  if (!deps.env.PROOFS_ENABLED) throw new AppError(503, 'PROOFS_DISABLED', 'Photo submissions are temporarily unavailable');
  const images = await normalizeProofImages(input.images);
  const requestHash = digest(JSON.stringify({ images: images.map((i) => i.hash), note: input.note }));
  await deps.db.transaction(async (tx) => {
    const rally = await lockRally(tx, rallyId);
    if (!rally?.proofFlow || !rally.completionMemberIds.includes(userId)) throw notFound('Rally');
    const [previous] = await tx.select({ requestHash: rallyProofs.requestHash, uploaderId: rallyProofs.uploaderId }).from(rallyProofs).where(and(eq(rallyProofs.rallyId, rallyId), eq(rallyProofs.requestKey, key)));
    if (previous) {
      if (previous.requestHash !== requestHash || previous.uploaderId !== userId) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Use a new request key for changed photos');
      return;
    }
    if (rally.status !== 'completed' || !rally.completedAt || Date.now() > rally.completedAt.getTime() + 48 * 3600000) throw new AppError(409, 'PROOF_WINDOW_CLOSED', 'Photos can be submitted for 48 hours after completion');
    const existing = await tx.select({ state: rallyProofs.state }).from(rallyProofs).where(eq(rallyProofs.rallyId, rallyId));
    if (existing.some((p) => ['processing', 'accepted'].includes(p.state))) throw new AppError(409, 'PROOF_ALREADY_SUBMITTED', 'Your group already has photos being checked or accepted');
    if (existing.length >= 3) throw new AppError(429, 'PROOF_LIMIT', 'This Rally has reached its three-submission limit');
    const policy = await latestPolicy(tx);
    const [proof] = await tx.insert(rallyProofs).values({ rallyId, uploaderId: userId, requestKey: key, requestHash,
      images, note: input.note, policyVersion: policy.version, rewardAmount: policy.amounts.RallyCompleted }).returning({ id: rallyProofs.id });
    await enqueue(tx, { type: 'proof.assess', payload: { proofId: proof!.id }, dedupeKey: `proof.assess:${proof!.id}` });
  });
  return getProof(deps, userId, rallyId);
}

async function decide(deps: Deps, proof: Proof, accepts: boolean, modelRunId: string | null, assessment: Record<string, unknown>) {
  const [snapshot] = await deps.db.select({ members: rallies.completionMemberIds }).from(rallies).where(eq(rallies.id, proof.rallyId));
  if (!snapshot) return;
  await deps.db.transaction(async (tx) => {
    for (const userId of [...snapshot.members].sort()) await lockUser(tx, userId);
    const rally = await lockRally(tx, proof.rallyId);
    if (!rally || rally.status !== 'completed') return;
    // Hash locks prevent concurrent different groups from earning from the same normalized image.
    for (const hash of proof.images.map((i) => i.hash).sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${hash}))`);
    const duplicate = await tx.execute(sql`select id from rally_proofs p where p.rally_id <> ${rally.id} and p.state = 'accepted'
      and exists (select 1 from jsonb_array_elements(p.images) i where i->>'hash' in (${sql.join(proof.images.map((i) => sql`${i.hash}`), sql`, `)})) limit 1`);
    const accepted = accepts && duplicate.length === 0;
    const [changed] = await tx.update(rallyProofs).set({ state: accepted ? 'accepted' : 'needs_clearer_photos',
      reason: accepted ? 'Your group photos were accepted.' : 'Please choose clearer, original photos showing people doing this activity together.',
      modelRunId, assessment, decidedAt: new Date(), leaseUntil: null })
      .where(and(eq(rallyProofs.id, proof.id), eq(rallyProofs.state, 'processing'), eq(rallyProofs.attempts, proof.attempts))).returning({ id: rallyProofs.id });
    if (!changed) return;
    if (accepted) for (const userId of rally.completionMemberIds) {
      // Completion rewards pay the whole roster; legacy per-person caps do not truncate the group.
      await tx.insert(rewardLedger).values({ subjectUserId: userId, rallyId: rally.id, action: 'RallyCompleted', reason: 'RallyCompleted',
        delta: proof.rewardAmount, policyVersion: proof.policyVersion, proofId: proof.id, antiAbuse: 'passed',
        idempotencyKey: `rally_completed:${rally.id}:${userId}` }).onConflictDoNothing();
    }
    await notify(tx, ...rally.completionMemberIds.map((userId) => ({ userId,
      type: accepted ? 'reward.earned' : 'proof.needs_clearer_photos', title: accepted ? 'Your group earned RALLY' : 'Try clearer Rally photos',
      body: accepted ? `Everyone in your group earned ${proof.rewardAmount} RALLY.` : 'Your Rally is still completed. Your group can submit clearer photos.',
      data: { rallyId: rally.id }, dedupeKey: `proof.decision:${proof.id}:${userId}` })));
  });
}

export async function assessProof(deps: Deps, proofId: string): Promise<void> {
  const [proof] = await deps.db.update(rallyProofs).set({ attempts: sql`${rallyProofs.attempts} + 1`, leaseUntil: new Date(Date.now() + 150000) })
    .where(and(eq(rallyProofs.id, proofId), eq(rallyProofs.state, 'processing'), sql`${rallyProofs.attempts} < 2`,
      sql`(${rallyProofs.leaseUntil} is null or ${rallyProofs.leaseUntil} < now())`)).returning();
  if (!proof) return;
  const [rally] = await deps.db.select().from(rallies).where(eq(rallies.id, proof.rallyId));
  if (!rally) return;
  const duplicate = await deps.db.execute(sql`select id from rally_proofs p where p.rally_id <> ${rally.id} and p.state = 'accepted'
    and exists (select 1 from jsonb_array_elements(p.images) i where i->>'hash' in (${sql.join(proof.images.map((i) => sql`${i.hash}`), sql`, `)})) limit 1`);
  if (duplicate.length) { await decide(deps, proof, false, null, { duplicateAcrossRallies: true }); return; }
  const { result, modelRunId } = await deps.formation((engine, requestId) => engine.assessProof({ requestId,
    category: rally.category, goal: redactPii(rally.goal).slice(0, 160), note: redactPii(proof.note), images: proof.images.map((i) => i.data) }));
  if ('status' in result) {
    await deps.db.update(rallyProofs).set({ state: proof.attempts >= 2 ? 'unavailable' : 'processing', leaseUntil: null, modelRunId,
      reason: 'Photo checking is temporarily unavailable. Your Rally remains completed.' })
      .where(and(eq(rallyProofs.id, proof.id), eq(rallyProofs.state, 'processing'), eq(rallyProofs.attempts, proof.attempts)));
    if (proof.attempts < 2) throw new Error('Photo assessment temporarily unavailable');
    return;
  }
  await decide(deps, proof, result.assessable && result.activityMatch === 'matched' && result.groupEvidence && result.visiblePeople >= 2 && !result.duplicateImages, modelRunId, result);
}

export async function cleanupProofPhotos(deps: Deps) {
  const recoverable = await deps.db.select({ id: rallyProofs.id, attempts: rallyProofs.attempts }).from(rallyProofs)
    .where(sql`${rallyProofs.state} = 'processing' and ${rallyProofs.attempts} < 2 and ${rallyProofs.leaseUntil} < now()`).limit(100);
  for (const proof of recoverable) await enqueue(deps.db, { type: 'proof.assess', payload: { proofId: proof.id }, dedupeKey: `proof.recover:${proof.id}:${proof.attempts}` });
  await deps.db.update(rallyProofs).set({ state: 'unavailable', reason: 'Photo checking was interrupted. Please try again.', leaseUntil: null })
    .where(sql`${rallyProofs.state} = 'processing' and ((${rallyProofs.attempts} >= 2 and ${rallyProofs.leaseUntil} < now()) or ${rallyProofs.createdAt} < now() - interval '30 days')`);
  // Keep private hashes for reuse checks, but delete photos and notes after retention expires.
  await deps.db.execute(sql`update rally_proofs set images = (select coalesce(jsonb_agg(jsonb_build_object('hash', i->>'hash', 'data', '')), '[]'::jsonb) from jsonb_array_elements(images) i), note = ''
    where created_at < now() - interval '30 days' and state <> 'processing' and (note <> '' or exists (select 1 from jsonb_array_elements(images) i where i->>'data' <> ''))`);
}
