import assert from 'node:assert/strict';
import { loadDotEnv, inferenceEnvSchema } from '../src/config/env.js';
import { CATEGORIES } from '../src/domain/catalog.js';
import { onboardingCatalog, activityCatalog } from '../src/domain/questions.js';
import { createZeroG } from '../src/integrations/zero-g.js';
import { createFormationEngine } from '../src/services/formation.js';

// Synthetic inputs only; four paid inference calls, no database writes.
loadDotEnv();
const engine = createFormationEngine(createZeroG(inferenceEnvSchema.parse(process.env)),
  (trace) => console.log(JSON.stringify({ type: 'trace', ...trace })));
try {
  for (const interests of [['gaming', 'build', 'workshop'], ['food', 'coffee', 'explore']]) {
    const catalog = onboardingCatalog(interests);
    const result = await engine.chooseOnboardingQuestions({ requestId: 'demo_personal_onboarding', interests,
      questions: catalog.map(({ id, purpose, options }) => ({ id, purpose, options })), alreadyAnsweredIds: [], remainingQuestions: 3 });
    assert.equal(result.source, 'ai');
    assert.ok(result.questionIds.length > 0);
    assert.ok(result.questionIds.every((id) => catalog.some((q) => q.id === id)));
    console.log(JSON.stringify({ status: 'passed', interests, questions: catalog.filter((q) => result.questionIds.includes(q.id)) }));
  }
  const now = new Date();
  const start = new Date(now.getTime() + 3600000).toISOString();
  const input = {
    requestId: 'demo_personal_activity', text: `Gaming at exactly ${start} UTC, for 40 minutes, exactly 2 people, chatty, zone venue. The game is undecided; ask me which game.`,
    questions: activityCatalog.map(({ id, purpose, options }) => ({ id, purpose, options })),
    now: now.toISOString(), eventEnd: new Date(now.getTime() + 4 * 3600000).toISOString(), timeZone: 'UTC',
    profile: { interests: ['gaming', 'build', 'food'], declaredSkills: [], preferences: { gaming_game: 'any' } },
    allowedCategoryIds: [...CATEGORIES], allowedZoneIds: ['venue'],
  };
  const asked = await engine.parseActivity({ ...input, attempt: 0, remainingQuestions: 3, answers: [] });
  assert.equal(asked.status, 'needs_answers');
  assert.ok('questionIds' in asked && asked.questionIds.includes('gaming_game'));
  console.log(JSON.stringify({ status: 'passed', step: 'activity_questions', result: asked }));
  const answered = await engine.parseActivity({ ...input, attempt: 1, remainingQuestions: 2, answers: [{ questionId: 'gaming_game', answer: 'chess' }] });
  assert.equal(answered.status, 'ready');
  assert.ok('intent' in answered && answered.intent.preferences?.gaming_game === 'chess');
  console.log(JSON.stringify({ status: 'passed', step: 'activity_answers', result: answered }));
  console.log('PASS: two distinct onboarding questionnaires and a gaming-specific clarification/answer round trip.');
} catch {
  console.error('FAIL: inspect the safe traces above; live personalization assertions did not pass.');
  process.exitCode = 1;
}
