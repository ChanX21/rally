import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarness, type Harness, hoursFromNow, type Json } from './helpers/harness.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

/** The judge story, through the HTTP API. Only external services are faked. */
describe('end-to-end journey', () => {
  it('goes from a sentence to a completed rally with a vouch', async () => {
    // AI handles every step, in the order the flow reaches it.
    h.ai.respond = ({ system }) => {
      if (system.includes('relevant question')) {
        return { schemaVersion: 1, questionIds: ['group_energy', 'skill_offer'] };
      }
      if (system.includes('Extract activity intent')) {
        return h.ai.callsFor('intent').length === 1
          ? { schemaVersion: 1, status: 'needs_answers', questionIds: ['start_time'] }
          : {
              schemaVersion: 1,
              status: 'ready',
              intent: {
                categoryId: 'food',
                goal: 'Late snack run',
                startAt: hoursFromNow(1),
                durationMin: 40,
                groupMin: 2,
                groupMax: 3,
                zoneId: 'venue-nearby',
                vibe: 'chatty',
              },
            };
      }
      return {
        schemaVersion: 1,
        status: 'proposed',
        memberIds: ['m1', 'c1'],
        roles: [
          { memberId: 'm1', roleId: 'host' },
          { memberId: 'c1', roleId: 'participant' },
        ],
        reason: 'You are both up for a chatty snack run tonight.',
      };
    };

    // Workflow A: a joiner signs in and onboards.
    const ben = await h.user('did:privy:ben');
    const { questions } = await ben.post('/onboarding/questions', {
      interests: ['food', 'coffee', 'gaming'],
    });
    expect(questions).toHaveLength(2);
    await ben.post('/onboarding/complete', {
      displayName: 'Ben',
      interests: ['food', 'coffee', 'gaming'],
      answers: questions.map((q: Json) => ({ questionId: q.id, answer: 'chatty' })),
      declaredSkills: ['participant'],
      preferences: { group_energy: 'chatty' },
      availableFrom: hoursFromNow(0),
      availableTo: hoursFromNow(6),
      optInMatching: true,
    });
    await h.drainOutbox();
    expect((await ben.get('/matches')).matches).toEqual([]);

    // Workflow B: a host describes an activity and approves the plan.
    const asha = await h.onboarded('did:privy:asha', { displayName: 'Asha', optInMatching: false });
    const asked = await asha.post('/intents/parse', { text: 'Anyone up for a late snack run?' });
    expect(asked.status).toBe('needs_answers');
    expect(asked.aiRequestId).toMatch(/^req_/);
    expect(asked.intent.questions).toHaveLength(1);

    const { intent, status } = await asha.post(`/intents/${asked.intent.id}/answers`, {
      answers: [{ questionId: 'start_time', answer: 'In about an hour' }],
    });
    expect(status).toBe('ready');

    const rally = await asha.post(
      '/rallies',
      {
        intentId: intent.id,
        category: intent.category,
        goal: intent.goal,
        vibe: intent.vibe,
        windowStart: intent.windowStart,
        windowEnd: hoursFromNow(4),
        durationMin: intent.durationMin,
        zone: intent.zone,
        groupMin: intent.groupMin,
        capacity: intent.groupMax,
        publish: true,
      },
      { 'idempotency-key': 'journey-create-1' },
    );
    expect(rally.status).toBe('open');

    // Discovery becomes visible once the outbox has run, and it is not joinable.
    await h.drainOutbox();
    const preview = (await h.app.inject({ url: '/activities/preview?category=food' })).json().data;
    expect(preview.activities).toHaveLength(1);
    expect(JSON.stringify(preview)).not.toContain(rally.goal);

    // Matching proposed Ben, with an AI explanation.
    const { matches } = await ben.get('/matches');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      source: 'ai',
      reason: 'You are both up for a chatty snack run tonight.',
      status: 'pending',
    });
    expect((await ben.get('/notifications')).items[0].title).toBe('You have been matched');

    // Before acceptance, a proposal is visible but the room is not.
    expect((await ben.request('GET', `/rallies/${rally.id}`)).statusCode).toBe(200);
    expect((await ben.request('GET', `/rallies/${rally.id}/room`)).statusCode).toBe(404);

    // Explicit consent.
    await ben.post(`/matches/${matches[0].id}/respond`, { response: 'accept' });
    const afterAccept = await asha.get(`/rallies/${rally.id}`);
    expect(afterAccept.status).toBe('ready');
    expect(afterAccept.openSeats).toBe(1);

    const formed = await asha.patch(`/rallies/${rally.id}`, {
      expectedVersion: afterAccept.version,
      meetingPoint: 'Food court, north entrance',
      meetingBrief: 'Look for the Rally sign',
    });
    expect(formed.status).toBe('formed');

    // The meeting card unlocks for the group.
    const room = await ben.get(`/rallies/${rally.id}/room`);
    expect(room).toMatchObject({
      meetingPoint: 'Food court, north entrance',
      meetingBrief: 'Look for the Rally sign',
    });
    expect(room.members.map((m: Json) => m.displayName)).toEqual(['Asha', 'Ben']);

    // They meet. Host attests presence; a participant attests the outcome and vouches.
    const met = await asha.post(`/rallies/${rally.id}/check-in`, { presentUserIds: [ben.id] });
    expect(met.status).toBe('met');

    const feedback = await ben.post(`/rallies/${rally.id}/feedback`, {
      happened: true,
      useful: true,
      vouches: [{ recipientId: asha.id, contribution: 'Found the best snack place' }],
      encoreWith: [asha.id],
    });
    expect(feedback).toMatchObject({
      rallyStatus: 'completed',
      vouches: [{ recipientId: asha.id, verification: 'verified' }],
    });
    await h.drainOutbox();

    const ashaRewards = await asha.get('/me/rewards');
    expect(ashaRewards.balance).toBe(25);
    const ashaProfile = await asha.get('/me');
    expect(ashaProfile.profile.evidence).toHaveLength(1);

    // The public listing is gone from live discovery.
    expect(h.arkiv.entities.size).toBe(0);
    const after = (await h.app.inject({ url: '/activities/preview?category=food' })).json().data;
    expect(after.activities).toEqual([]);

    const docs = await h.app.inject({ url: '/docs/json' });
    expect(docs.statusCode).toBe(200);
    const paths = Object.keys(docs.json<{ paths: Record<string, unknown> }>().paths);
    for (const path of ['/auth/session', '/intents/parse', '/matches/{id}/respond']) {
      expect(paths).toContain(path);
    }
  });
});
