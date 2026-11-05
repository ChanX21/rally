import assert from 'node:assert/strict';
import { loadDotEnv, inferenceEnvSchema } from '../src/config/env.js';
import { createZeroG, InferenceError } from '../src/integrations/zero-g.js';
import { createFormationEngine } from '../src/services/formation.js';

let step = 'configuration';

// Synthetic people only: this demonstrates inference, not a real match or consent.
try {
  loadDotEnv();
  const infer = createZeroG(inferenceEnvSchema.parse(process.env));
  const engine = createFormationEngine(async (system, input) => {
    const reply = await infer(system, input);
    // This script sends only synthetic fixtures; never enable raw output in app logging.
    console.log(JSON.stringify({ type: 'demo_model_output', step, text: reply.text.slice(0, 4000) }));
    return reply;
  },
    (trace) => console.log(JSON.stringify({ type: 'inference_trace', ...trace })));
  step = 'onboarding';
  const questions = await engine.chooseOnboardingQuestions({
    requestId: 'demo_onboarding', interests: ['food', 'coffee', 'build'],
    questions: [{ id: 'availability', purpose: 'When are you available to meet?' }],
    alreadyAnsweredIds: [], remainingQuestions: 3,
  });
  if (questions.source !== 'ai') throw new InferenceError('failure' in questions ? questions.failure : 'invalid_output');
  assert.ok(questions.questionIds.length > 0, 'Expected at least one onboarding question');
  console.log(JSON.stringify({ step: 'onboarding', status: 'passed', result: questions }));

  const now = new Date();
  const startAt = new Date(now.getTime() + 3600000).toISOString();
  const until = new Date(now.getTime() + 4 * 3600000).toISOString();
  const activity = {
    text: 'A chatty food snack run for 40 minutes in zone venue, with exactly 2 people including me. Category food. I have not decided the start time.',
    questions: [{ id: 'start_time', purpose: 'What exact UTC date and time should the activity start?' }],
    now: now.toISOString(), eventEnd: until, timeZone: 'UTC',
    allowedCategoryIds: ['food'], allowedZoneIds: ['venue'],
  };
  step = 'rally_questions';
  const clarification = await engine.parseActivity({
    ...activity, requestId: 'demo_rally_questions', answers: [], remainingQuestions: 3, attempt: 0,
  });
  if (clarification.status !== 'needs_answers') {
    throw new InferenceError(clarification.status === 'ready' ? 'invalid_output' : clarification.status);
  }
  assert.deepEqual(clarification.questionIds, ['start_time']);
  console.log(JSON.stringify({ step, status: 'passed', result: clarification }));

  step = 'rally_answers';
  const parsed = await engine.parseActivity({
    ...activity, requestId: 'demo_rally_answers',
    answers: [{ questionId: 'start_time', answer: `Start at exactly ${startAt} UTC.` }],
    remainingQuestions: 2, attempt: 1,
  });
  if (parsed.status !== 'ready') throw new InferenceError(parsed.status === 'needs_answers' ? 'invalid_output' : parsed.status);
  assert.equal(Date.parse(parsed.intent.startAt), Date.parse(startAt));
  assert.equal(parsed.intent.durationMin, 40);
  assert.equal(parsed.intent.groupMin, 2);
  assert.equal(parsed.intent.groupMax, 2);
  console.log(JSON.stringify({ step, status: 'passed', result: parsed }));

  const person = (id: string) => ({
    id, optedIn: true as const, interests: ['food'], roleIds: ['buddy'], zoneIds: ['venue'],
    availableFrom: now.toISOString(), availableUntil: until,
  });
  step = 'composition';
  const proposal = await engine.composeGroup({
    requestId: 'demo_composition',
    rally: { id: 'demo_rally', intent: parsed.intent, requiredMembers: [person('demo_host')], requiredRoleIds: ['buddy'] },
    candidates: [person('demo_guest')],
  });
  if (proposal.status !== 'proposed') throw new InferenceError(proposal.status === 'no_fit' ? 'invalid_output' : proposal.status);
  assert.deepEqual([...proposal.memberIds].sort(), ['demo_guest', 'demo_host']);
  console.log(JSON.stringify({ step, status: 'passed', result: proposal }));
  console.log(JSON.stringify({ status: 'ok', scope: 'four live inference calls covering onboarding, Rally questions, answered intent and composition with synthetic fixtures; no users joined, seats reserved or rooms created' }));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', step, reason: error instanceof InferenceError ? error.code : 'demo_assertion_or_configuration_failed' }));
  process.exitCode = 1;
}
