import { afterAll, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { feedback, outboxEvents, rallies, rallyProofs, rewardLedger } from '../src/db/schema/index.js';
import { completeDueRallies } from '../src/services/completion.js';
import { assessProof, cleanupProofPhotos, normalizeProofImages } from '../src/services/proofs.js';
import { applyDuePenalties } from '../src/services/rewards.js';
import { expireRallies } from '../src/workers/scheduler.js';
import { applyVerifiedVouch } from '../src/services/feedback.js';
import { formedGroup, setMeetAt } from './helpers/rewards.js';
import { createHarness, type Harness } from './helpers/harness.js';

let h: Harness;
beforeEach(async () => { await h?.close(); h = await createHarness({ PROOFS_ENABLED: 'true' }); });
afterAll(() => h.close());
const assessment = { schemaVersion: 1, activityMatch: 'matched', assessable: true, groupEvidence: true, visiblePeople: 2, duplicateImages: false, reason: 'People sharing food' };
async function photo(color = 'red') {
  const bytes = await sharp({ create: { width: 96, height: 96, channels: 3, background: color } }).png().toBuffer();
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
async function completed() {
  const group = await formedGroup(h);
  await setMeetAt(h, group.rally.id, -90);
  expect(await completeDueRallies(h.app.deps)).toBe(1);
  return group;
}
const headers = (key = 'proof-test-key') => ({ 'idempotency-key': key });

it('automatically completes without attendance, photos or rewards, and wins over expiry', async () => {
  const { host, member, rally } = await formedGroup(h);
  await setMeetAt(h, rally.id, -90);
  await h.app.deps.db.update(rallies).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(rallies.id, rally.id));
  expect(await expireRallies(h.app.deps)).toBe(0);
  expect(await Promise.all([completeDueRallies(h.app.deps), completeDueRallies(h.app.deps)])).toContain(1);
  const room = await host.get(`/rallies/${rally.id}/room`);
  expect(room.status).toBe('completed');
  expect(room.members.every((m: { checkedIn: boolean; arrived: boolean }) => !m.checkedIn && !m.arrived)).toBe(true);
  expect((await member.get('/me/rewards')).balance).toBe(0);
  expect((await member.get(`/rallies/${rally.id}/proof`)).state).toBe('not_submitted');
  expect((await h.app.deps.db.select().from(rewardLedger))).toHaveLength(0);
});

it('records optional vouches without host check-in or points and disables complaints', async () => {
  const { host, member, rally } = await completed();
  await host.post(`/rallies/${rally.id}/feedback`, { happened: true, vouches: [{ recipientId: member.id, contribution: 'Great company' }] });
  await h.drainOutbox();
  expect(await h.app.deps.db.select().from(feedback).where(eq(feedback.type, 'vouch'))).toHaveLength(1);
  expect((await member.get('/me')).profile.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ contribution: 'Great company' })]));
  expect((await member.get('/me/rewards')).balance).toBe(0);
  const report = await host.request('POST', `/rallies/${rally.id}/disputes`, { category: 'other', subjectId: member.id, description: 'A complaint' });
  expect(report.statusCode).toBe(409);
  expect(report.json().error.code).toBe('REPORTS_DISABLED');
});

it.each([true, false])('rechecks matching once after vouch evidence changes with opt-in %s', async (enabled) => {
  const { host, member, rally } = await completed();
  await member.patch('/me/profile', { optInMatching: enabled });
  await h.drainOutbox();
  const eventsForMember = async () => (await h.app.deps.db.select().from(outboxEvents)
    .where(eq(outboxEvents.type, 'match.reevaluate'))).filter((event) => event.payload.userId === member.id);
  const before = (await eventsForMember()).length;
  await host.post(`/rallies/${rally.id}/feedback`, { happened: true, vouches: [{ recipientId: member.id, contribution: 'Great company' }] });
  await h.drainOutbox();
  expect((await eventsForMember()).length - before).toBe(enabled ? 1 : 0);
  const [vouch] = await h.app.deps.db.select().from(feedback).where(eq(feedback.type, 'vouch'));
  await applyVerifiedVouch(h.app.deps, vouch!.id);
  expect((await eventsForMember()).length - before).toBe(enabled ? 1 : 0);
  expect((await member.get('/me')).profile.preferences).toEqual({});
});

it('one proof rewards the whole group exactly once under concurrent submission/worker retries', async () => {
  const { host, member, rally } = await completed();
  h.ai.respond = () => assessment;
  const body = { images: [await photo()] };
  const responses = await Promise.all([host.request('POST', `/rallies/${rally.id}/proof`, body, headers()), host.request('POST', `/rallies/${rally.id}/proof`, body, headers())]);
  expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
  const id = responses[0].json().data.id;
  await Promise.all([assessProof(h.app.deps, id), assessProof(h.app.deps, id)]);
  await assessProof(h.app.deps, id);
  for (const user of [host, member]) {
    const rewards = await user.get('/me/rewards');
    expect(rewards.balance).toBe(10);
    expect(rewards.entries).toHaveLength(1);
    expect(rewards.entries[0].action).toBe('RallyCompleted');
    const proof = await user.get(`/rallies/${rally.id}/proof`);
    expect(proof).toMatchObject({ state: 'accepted', rewardedCount: 2, canSubmit: false });
    expect(JSON.stringify(proof)).not.toContain('base64');
  }
  const result = await member.request('POST', `/rallies/${rally.id}/proof`, body, headers('other-key'));
  expect(result.statusCode).toBe(409);
  expect(h.ai.calls.filter((c) => c.system.includes('Assess only'))).toHaveLength(1);
});

it('rejects unrelated/unclear evidence without awarding points and allows a bounded new submission', async () => {
  const { host, rally } = await completed();
  h.ai.respond = () => ({ ...assessment, activityMatch: 'mismatched' });
  for (let attempt = 0; attempt < 3; attempt++) {
    const proof = await host.post(`/rallies/${rally.id}/proof`, { images: [await photo()] }, headers(`proof-try-${attempt}`));
    await assessProof(h.app.deps, proof.id);
    expect((await host.get(`/rallies/${rally.id}/proof`)).state).toBe('needs_clearer_photos');
  }
  expect((await host.request('POST', `/rallies/${rally.id}/proof`, { images: [await photo()] }, headers('fourth-try'))).statusCode).toBe(429);
  expect((await host.get('/me/rewards')).balance).toBe(0);
});

it('bounds AI outages to two calls and recovers expired processing leases without approval', async () => {
  const { host, rally } = await completed();
  const proof = await host.post(`/rallies/${rally.id}/proof`, { images: [await photo()] }, headers());
  await expect(assessProof(h.app.deps, proof.id)).rejects.toThrow('temporarily unavailable');
  await assessProof(h.app.deps, proof.id);
  await assessProof(h.app.deps, proof.id);
  expect((await host.get(`/rallies/${rally.id}/proof`)).state).toBe('unavailable');
  expect(h.ai.calls.filter((c) => c.system.includes('Assess only'))).toHaveLength(2);
  await h.app.deps.db.update(rallyProofs).set({ state: 'processing', leaseUntil: new Date(Date.now() - 1000) }).where(eq(rallyProofs.id, proof.id));
  await cleanupProofPhotos(h.app.deps);
  expect((await host.get(`/rallies/${rally.id}/proof`)).state).toBe('unavailable');
});

it('does not allow nonmembers, missing request keys, expired submissions or changing a retried payload', async () => {
  const { host, rally } = await completed();
  const stranger = await h.onboarded('did:proof:stranger');
  expect((await stranger.request('POST', `/rallies/${rally.id}/proof`, { images: [await photo()] }, headers())).statusCode).toBe(404);
  expect((await host.request('POST', `/rallies/${rally.id}/proof`, { images: [await photo()] })).statusCode).toBe(400);
  await host.post(`/rallies/${rally.id}/proof`, { images: [await photo()] }, headers());
  expect((await host.request('POST', `/rallies/${rally.id}/proof`, { images: [await photo('blue')] }, headers())).statusCode).toBe(409);
  await h.app.deps.db.update(rallies).set({ completedAt: new Date(Date.now() - 49 * 3600000) }).where(eq(rallies.id, rally.id));
  expect((await host.request('POST', `/rallies/${rally.id}/proof`, { images: [await photo()] }, headers('late-key'))).json().error.code).toBe('PROOF_WINDOW_CLOSED');
});

it('validates actual bytes and rejects repeated images, strips metadata, and deletes retained photos', async () => {
  await expect(normalizeProofImages(['data:image/png;base64,aGVsbG8='])).rejects.toMatchObject({ code: 'INVALID_PHOTO' });
  const image = await photo();
  await expect(normalizeProofImages([image, image])).rejects.toMatchObject({ code: 'DUPLICATE_PHOTO' });
  const normalized = await normalizeProofImages([image]);
  const metadata = await sharp(Buffer.from(normalized[0]!.data.split(',')[1]!, 'base64')).metadata();
  expect(metadata.format).toBe('jpeg');
  expect(metadata.exif).toBeUndefined();
  const { host, rally } = await completed();
  h.ai.respond = () => assessment;
  const proof = await host.post(`/rallies/${rally.id}/proof`, { images: [image] }, headers());
  await assessProof(h.app.deps, proof.id);
  await h.app.deps.db.update(rallyProofs).set({ createdAt: new Date(Date.now() - 31 * 86400000) }).where(eq(rallyProofs.id, proof.id));
  await cleanupProofPhotos(h.app.deps);
  const [row] = await h.app.deps.db.select().from(rallyProofs).where(eq(rallyProofs.id, proof.id));
  expect(row!.images[0]!.data).toBe('');
  expect(row!.images[0]!.hash).toHaveLength(64);
  expect((await host.get('/me/rewards')).balance).toBe(10);
});

it('never lets the penalty job apply pending positive rewards', async () => {
  const host = await h.onboarded('did:proof:pending');
  await h.app.deps.db.insert(rewardLedger).values({ subjectUserId: host.id, action: 'RallyCompleted', reason: 'test', delta: 10, policyVersion: 1, antiAbuse: 'passed', idempotencyKey: 'pending-positive', state: 'pending', appliesAt: new Date(Date.now() - 1000) });
  expect(await applyDuePenalties(h.app.deps)).toBe(0);
  expect((await host.get('/me/rewards')).balance).toBe(0);
});

it('prevents concurrent different Rallies from earning for the same photo', async () => {
  const first = await completed();
  const { users } = await import('../src/db/schema/index.js');
  await h.app.deps.db.update(users).set({ optInMatching: false });
  const second = await completed();
  h.ai.respond = () => assessment;
  const body = { images: [await photo()] };
  const one = await first.host.post(`/rallies/${first.rally.id}/proof`, body, headers('first-group'));
  const two = await second.host.post(`/rallies/${second.rally.id}/proof`, body, headers('second-group'));
  await Promise.all([assessProof(h.app.deps, one.id), assessProof(h.app.deps, two.id)]);
  const states = [(await first.host.get(`/rallies/${first.rally.id}/proof`)).state, (await second.host.get(`/rallies/${second.rally.id}/proof`)).state];
  expect(states.sort()).toEqual(['accepted', 'needs_clearer_photos']);
  expect(await h.app.deps.db.select().from(rewardLedger)).toHaveLength(2);
});

it('strips existing EXIF and sends no wallet, email or roster to the model', async () => {
  const original = await sharp({ create: { width: 96, height: 96, channels: 3, background: 'green' } }).withExif({ IFD0: { Artist: 'PRIVATE CAMERA OWNER' } }).jpeg().toBuffer();
  expect((await sharp(original).metadata()).exif).toBeDefined();
  const normalized = await normalizeProofImages([`data:image/jpeg;base64,${original.toString('base64')}`]);
  expect((await sharp(Buffer.from(normalized[0]!.data.split(',')[1]!, 'base64')).metadata()).exif).toBeUndefined();
  const { host, member, rally } = await completed();
  h.ai.respond = () => assessment;
  const proof = await host.post(`/rallies/${rally.id}/proof`, { images: [await photo()], note: 'Contact me@example.com or 0x4A1cD581623Dc1efcB3Eea5da963BFC2C53A996f' }, headers());
  await assessProof(h.app.deps, proof.id);
  const call = h.ai.calls.find((c) => c.system.includes('Assess only'))!;
  expect(JSON.stringify(call.input)).not.toMatch(/me@example.com|0x4A1c|PRIVATE CAMERA/);
  expect(JSON.stringify(call.input)).not.toContain(member.id);
});

it('pins the reward policy at submission and only syncs new rewards when the revised ledger is enabled', async () => {
  const { host, member, rally } = await completed();
  const { users, rewardPolicies } = await import('../src/db/schema/index.js');
  const { DEFAULT_AMOUNTS } = await import('../src/domain/reward-policy.js');
  const { queueChainWork } = await import('../src/services/chain-sync.js');
  await h.app.deps.db.update(users).set({ walletAddress: '0x1111111111111111111111111111111111111111' }).where(eq(users.id, host.id));
  await h.app.deps.db.update(users).set({ walletAddress: '0x2222222222222222222222222222222222222222' }).where(eq(users.id, member.id));
  h.ai.respond = () => assessment;
  const proof = await host.post(`/rallies/${rally.id}/proof`, { images: [await photo()] }, headers());
  await h.app.deps.db.insert(rewardPolicies).values({ version: 2, amounts: { ...DEFAULT_AMOUNTS, RallyCompleted: 99 } });
  await assessProof(h.app.deps, proof.id);
  expect((await host.get('/me/rewards')).entries[0]).toMatchObject({ points: 10, policyVersion: 1 });
  expect(await queueChainWork(h.app.deps)).toBe(0);
  h.app.deps.env.ARC_COMPLETION_REWARDS_ENABLED = true;
  expect(await queueChainWork(h.app.deps)).toBe(2);
  await h.drainOutbox();
  expect(h.arc.records).toHaveLength(2);
  expect(h.arc.records.every((entry) => entry.action === 8 && entry.delta === 10 && entry.policyVersion === 1)).toBe(true);
  expect(h.arc.records[0]!.evidenceHash).not.toBe(h.arc.records[1]!.evidenceHash);
});

it('excludes a withdrawn person when a replacement group completes', async () => {
  const group = await formedGroup(h);
  await group.member.post(`/rallies/${group.rally.id}/withdraw`);
  const replacement = await h.onboarded('did:proof:replacement');
  const { matches } = await replacement.get('/matches');
  const offer = matches.find((match: { rally: { id: string } }) => match.rally.id === group.rally.id);
  await replacement.post(`/matches/${offer.id}/respond`, { response: 'accept' });
  await setMeetAt(h, group.rally.id, -90);
  await completeDueRallies(h.app.deps);
  h.ai.respond = () => assessment;
  const proof = await group.host.post(`/rallies/${group.rally.id}/proof`, { images: [await photo()] }, headers());
  await assessProof(h.app.deps, proof.id);
  expect((await replacement.get('/me/rewards')).balance).toBe(10);
  expect((await group.member.get('/me/rewards')).balance).toBe(0);
  expect((await group.member.request('GET', `/rallies/${group.rally.id}/proof`)).statusCode).toBe(404);
});

it('rate-limits the authenticated user without blocking other people on the same venue IP', async () => {
  const { host, rally } = await completed();
  const stranger = await h.onboarded('did:proof:rate-limit');
  const body = { images: [await photo()] };
  for (let i = 0; i < 6; i++) expect((await stranger.request('POST', `/rallies/${rally.id}/proof`, body, headers(`outsider-${i}`))).statusCode).toBe(404);
  expect((await stranger.request('POST', `/rallies/${rally.id}/proof`, body, headers('outsider-seven'))).statusCode).toBe(429);
  expect((await host.request('POST', `/rallies/${rally.id}/proof`, body, headers())).statusCode).toBe(200);
});
