import { describe, expect, it } from 'vitest';
import { createFormationEngine } from '../src/services/formation.js';
import { InferenceError } from '../src/integrations/zero-g.js';
import type { CompositionInput } from '../src/schemas/formation.js';
const person = (id: string) => ({ id, optedIn: true as const, interests: ['food'], roleIds: ['buddy'], zoneIds: ['venue'], availableFrom: '2026-11-05T10:00:00Z', availableUntil: '2026-11-05T12:00:00Z' });
const intent = { categoryId: 'food', goal: 'snack', startAt: '2026-11-05T11:00:00Z', durationMin: 40, groupMin: 2, groupMax: 3, zoneId: 'venue', vibe: 'any' as const };
const input: CompositionInput = { requestId: 'request_1', rally: { id: 'rally', intent, requiredMembers: [person('host')], requiredRoleIds: ['buddy'] }, candidates: [person('guest')] };
const proposal = { schemaVersion: 1, status: 'proposed', memberIds: ['host', 'guest'], roles: [{ memberId: 'guest', roleId: 'buddy' }], reason: 'Shared slot' };
const engine = (output: unknown) => createFormationEngine(async () => ({ text: JSON.stringify(output), model: 'fixture' }));
const onboarding = { requestId: 'request_1', interests: ['food', 'build', 'coffee'], questions: [{ id: 'time', purpose: 'availability' }], alreadyAnsweredIds: [], remainingQuestions: 3 };
const activity = { requestId: 'request_1', text: 'snack', answers: [], questions: [{ id: 'time', purpose: 'start time' }], remainingQuestions: 3, attempt: 0, now: '2026-11-05T10:00:00Z', eventEnd: '2026-11-05T13:00:00Z', timeZone: 'Asia/Kolkata', allowedCategoryIds: ['food'], allowedZoneIds: ['venue'] };

describe('Formation Engine trust boundaries', () => {
  it('accepts a feasible proposal including creator', async () => {
    expect(await engine(proposal).composeGroup(input)).toEqual(proposal);
  });
  it.each([
    { memberIds: ['host', 'fake'] }, { memberIds: ['guest', 'other'] },
    { memberIds: ['host', 'host'] }, { memberIds: ['host'] },
    { roles: [{ memberId: 'guest', roleId: 'admin' }] },
    { roles: [{ memberId: 'fake', roleId: 'buddy' }] }, { roles: [] },
    { roles: [{ memberId: 'guest', roleId: 'buddy' }, { memberId: 'guest', roleId: 'buddy' }] },
    { extra: 'injected' }, { schemaVersion: 2 }, { reason: '' },
  ])('rejects unsafe output %j', async (patch) => {
    expect(await engine({ ...proposal, ...patch }).composeGroup(input)).toEqual({ status: 'invalid_output' });
  });
  it.each([
    { zoneIds: ['elsewhere'] }, { availableFrom: '2026-11-05T11:10:00Z' },
    { availableUntil: '2026-11-05T11:20:00Z' }, { roleIds: [] },
  ])('rejects incompatible selected participant %j', async (patch) => {
    const changed = structuredClone(input); Object.assign(changed.candidates[0]!, patch);
    expect(await engine(proposal).composeGroup(changed)).toEqual({ status: 'invalid_output' });
  });
  it('skips inference when minimum cannot be met', async () => {
    const ai = createFormationEngine(() => { throw new Error('must not call'); });
    expect(await ai.composeGroup({ ...input, candidates: [] })).toEqual({ schemaVersion: 1, status: 'no_fit' });
  });
  it('keeps provider failure distinct from no fit', async () => {
    const ai = createFormationEngine(async () => { throw new InferenceError('unavailable'); });
    expect(await ai.composeGroup(input)).toEqual({ status: 'unavailable' });
    expect(await engine({ schemaVersion: 1, status: 'no_fit' }).composeGroup(input)).toHaveProperty('status', 'no_fit');
  });
  it('rejects unconsented participants before inference', async () => {
    const changed = structuredClone(input); Object.assign(changed.candidates[0]!, { optedIn: false });
    await expect(engine(proposal).composeGroup(changed)).rejects.toThrow();
  });
  it('rejects duplicate input people', async () => {
    await expect(engine(proposal).composeGroup({ ...input, candidates: [person('host')] })).rejects.toThrow();
  });
  it('selects catalog questions and marks fallback on hallucinations', async () => {
    expect(await engine({ schemaVersion: 1, questionIds: ['time'] }).chooseOnboardingQuestions(onboarding)).toHaveProperty('source', 'ai');
    expect(await engine({ schemaVersion: 1, questionIds: ['fake'] }).chooseOnboardingQuestions(onboarding)).toMatchObject({ source: 'fallback', questionIds: ['time'] });
  });
  it('preserves timeout reason on onboarding fallback', async () => {
    const ai = createFormationEngine(async () => { throw new InferenceError('timeout'); });
    expect(await ai.chooseOnboardingQuestions(onboarding)).toMatchObject({ source: 'fallback', failure: 'timeout' });
  });
  it('does not reask answered onboarding questions', async () => {
    expect(await engine({}).chooseOnboardingQuestions({ ...onboarding, alreadyAnsweredIds: ['time'] })).toHaveProperty('questionIds', []);
  });
  it('accepts an unconfirmed valid draft', async () => {
    expect(await engine({ schemaVersion: 1, status: 'ready', intent }).parseActivity(activity)).toHaveProperty('status', 'ready');
  });
  it.each([
    { categoryId: 'fake' }, { zoneId: 'fake' }, { startAt: '2026-11-05T09:00:00Z' },
    { startAt: '2026-11-05T12:50:00Z' }, { groupMin: 5 }, { durationMin: -1 },
  ])('rejects invalid intent %j', async (patch) => {
    expect(await engine({ schemaVersion: 1, status: 'ready', intent: { ...intent, ...patch } }).parseActivity(activity)).toEqual({ status: 'invalid_output' });
  });
  it('limits clarification to one round', async () => {
    const ai = engine({ schemaVersion: 1, status: 'needs_answers', questionIds: ['time'] });
    expect(await ai.parseActivity(activity)).toHaveProperty('status', 'needs_answers');
    expect(await ai.parseActivity({ ...activity, attempt: 1 })).toEqual({ status: 'invalid_output' });
  });
  it('completes the Rally questionnaire after answering the missing time', async () => {
    const responses = [
      { schemaVersion: 1, status: 'needs_answers', questionIds: ['time'] },
      { schemaVersion: 1, status: 'ready', intent },
    ];
    const ai = createFormationEngine(async () => ({ text: JSON.stringify(responses.shift()), model: 'fixture' }));
    expect(await ai.parseActivity(activity)).toEqual({ schemaVersion: 1, status: 'needs_answers', questionIds: ['time'] });
    expect(await ai.parseActivity({ ...activity, attempt: 1, remainingQuestions: 2, answers: [{ questionId: 'time', answer: intent.startAt }] })).toEqual({ schemaVersion: 1, status: 'ready', intent });
  });
  it('reports schema failure without logging response text', async () => {
    const traces: unknown[] = [];
    const ai = createFormationEngine(async () => ({ text: JSON.stringify({ unexpected: 'private-value' }), model: 'fixture', providerRequestId: 'p1', tokens: 12 }), (v) => traces.push(v));
    await ai.chooseOnboardingQuestions(onboarding);
    expect(traces[0]).toMatchObject({ result: 'invalid_output', providerRequestId: 'p1', tokens: 12, diagnostics: { reason: 'schema_mismatch' } });
    expect(JSON.stringify(traces)).not.toContain('private-value');
  });
  it('never logs user data or provider errors', async () => {
    const traces: unknown[] = [];
    const ai = createFormationEngine(async () => { throw new Error('secret-provider-body'); }, (v) => traces.push(v));
    await ai.parseActivity(activity);
    expect(JSON.stringify(traces)).not.toMatch(/secret-provider-body|snack|Asia/);
  });
});
