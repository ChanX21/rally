import assert from 'node:assert/strict';
import { loadDotEnv, inferenceEnvSchema } from '../src/config/env.js';
import { createZeroG, InferenceError } from '../src/integrations/zero-g.js';
import { createFormationEngine } from '../src/services/formation.js';

let step = 'configuration';

// Synthetic people only: this demonstrates inference, not a real match or consent.
try {
  console.log('RALLY AI DEMO — real 0G inference with fictional people. No seats or rooms are created.');
  console.log('Each step shows a plain-English explanation followed by the original JSON evidence.');
  loadDotEnv();
  const infer = createZeroG(inferenceEnvSchema.parse(process.env));
  const engine = createFormationEngine(async (system, input) => {
    const reply = await infer(system, input);
    // This script sends only synthetic fixtures; never enable raw output in app logging.
    console.log('AI response JSON (the model’s answer, before validation):');
    console.log(JSON.stringify({ type: 'demo_model_output', step, text: reply.text.slice(0, 4000) }));
    return reply;
  },
    (trace) => {
      console.log(`Request details: ${trace.model ?? '0G'} took ${(trace.latencyMs / 1000).toFixed(1)} seconds; validation result: ${trace.result}.`);
      console.log(`Provider-reported usage: ${trace.tokens ?? 'unavailable'} tokens. Request ID: ${trace.providerRequestId ?? trace.diagnostics?.providerRequestId ?? 'unavailable'}.`);
      console.log('Technical trace JSON (timing, usage and request metadata):');
      console.log(JSON.stringify({ type: 'inference_trace', ...trace }));
    });
  step = 'onboarding';
  console.log('\nSTEP 1/4 — Onboarding questionnaire');
  console.log('A fictional user chooses food, coffee and building. Ask AI which allowed question would help us match them.');
  console.log('Available question: availability = “When are you available to meet?”');
  const questions = await engine.chooseOnboardingQuestions({
    requestId: 'demo_onboarding', interests: ['food', 'coffee', 'build'],
    questions: [{ id: 'availability', purpose: 'When are you available to meet?' }],
    alreadyAnsweredIds: [], remainingQuestions: 3,
  });
  if (questions.source !== 'ai') throw new InferenceError('failure' in questions ? questions.failure : 'invalid_output');
  assert.ok(questions.questionIds.length > 0, 'Expected at least one onboarding question');
  console.log(`PASS: AI selected ${questions.questionIds.join(', ')} from our catalog. It used real inference, not the fallback.`);
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
  console.log('\nSTEP 2/4 — Rally questionnaire');
  console.log(`Simulated user request: “${activity.text}”`);
  console.log('The start time is missing. AI should ask for it instead of guessing.');
  const clarification = await engine.parseActivity({
    ...activity, requestId: 'demo_rally_questions', answers: [], remainingQuestions: 3, attempt: 0,
  });
  if (clarification.status !== 'needs_answers') {
    throw new InferenceError(clarification.status === 'ready' ? 'invalid_output' : clarification.status);
  }
  assert.deepEqual(clarification.questionIds, ['start_time']);
  console.log('PASS: AI asked “What exact UTC date and time should the activity start?” (start_time).');
  console.log(JSON.stringify({ step, status: 'passed', result: clarification }));

  step = 'rally_answers';
  console.log('\nSTEP 3/4 — Turn the answer into a Rally draft');
  console.log(`Simulated user answer: Start at ${new Date(startAt).toUTCString()}.`);
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
  console.log(`PASS: AI created an unconfirmed draft: ${parsed.intent.goal}; ${parsed.intent.durationMin} minutes; ${parsed.intent.groupMin}–${parsed.intent.groupMax} people including the host; zone ${parsed.intent.zoneId}; ${parsed.intent.vibe} atmosphere.`);
  console.log(`Draft starts at ${new Date(parsed.intent.startAt).toUTCString()}. We checked that it preserves the supplied time, duration and group size. A real user must still confirm it.`);
  console.log(JSON.stringify({ step, status: 'passed', result: parsed }));

  const person = (id: string) => ({
    id, optedIn: true as const, interests: ['food'], roleIds: ['buddy'], zoneIds: ['venue'],
    availableFrom: now.toISOString(), availableUntil: until,
  });
  step = 'composition';
  console.log('\nSTEP 4/4 — Propose a compatible group');
  console.log('Give AI two fictional people: demo_host and demo_guest. Both opted in, like food, can be buddies, and are available in the venue zone.');
  const proposal = await engine.composeGroup({
    requestId: 'demo_composition',
    rally: { id: 'demo_rally', intent: parsed.intent, requiredMembers: [person('demo_host')], requiredRoleIds: ['buddy'] },
    candidates: [person('demo_guest')],
  });
  if (proposal.status !== 'proposed') throw new InferenceError(proposal.status === 'no_fit' ? 'invalid_output' : proposal.status);
  assert.deepEqual([...proposal.memberIds].sort(), ['demo_guest', 'demo_host']);
  console.log(`PASS: AI proposed ${proposal.memberIds.join(' + ')}. Assigned roles: ${proposal.roles.map((role) => `${role.memberId}: ${role.roleId}`).join(', ')}.`);
  console.log(`AI’s explanation: ${proposal.reason}`);
  console.log('Our code checked the supplied IDs, host inclusion, role eligibility, time overlap, zone and group size. This is a proposal, not an accepted invitation.');
  console.log(JSON.stringify({ step, status: 'passed', result: proposal }));
  console.log('\nSUCCESS — All four AI checks passed. Onboarding questions, Rally questions, answered draft and group proposal worked on this synthetic scenario.');
  console.log('Backend work still owns saving data, live eligibility, invitations, mutual acceptance, seat allocation and room creation.');
  console.log(JSON.stringify({ status: 'ok', scope: 'four live inference calls covering onboarding, Rally questions, answered intent and composition with synthetic fixtures; no users joined, seats reserved or rooms created' }));
} catch (error) {
  console.error(`\nFAILED during ${step}: ${error instanceof InferenceError ? error.code : 'an assertion or configuration check failed'}. This step did not pass. Inspect the response and trace above; the demo has stopped.`);
  console.error(JSON.stringify({ status: 'failed', step, reason: error instanceof InferenceError ? error.code : 'demo_assertion_or_configuration_failed' }));
  process.exitCode = 1;
}
