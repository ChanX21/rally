import { describe, expect, it } from 'vitest';

import { canTransition, toPublicStatus } from '../src/domain/rally-state.js';
import { rankCandidates, scoreCandidate } from '../src/domain/scoring.js';
import { overlapMinutes, startBucket } from '../src/domain/time.js';
import { parseIntentFallback, redactPii } from '../src/domain/intent-fallback.js';
import { validateComposition } from '../src/services/matching.js';
import { backoffMs } from '../src/workers/outbox.js';

describe('rally state machine', () => {
  it.each([
    ['draft', 'open'],
    ['open', 'proposed'],
    ['proposed', 'ready'],
    ['ready', 'formed'],
    ['formed', 'met'],
    ['met', 'completed'],
    ['formed', 'open'],
    ['proposed', 'cancelled'],
    ['waiting', 'expired'],
  ] as const)('allows %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['draft', 'formed'],
    ['open', 'met'],
    ['open', 'formed'],
    ['proposed', 'formed'],
    ['ready', 'met'],
    ['met', 'cancelled'],
    ['met', 'expired'],
    ['completed', 'open'],
    ['cancelled', 'open'],
    ['expired', 'open'],
  ] as const)('forbids %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('only exposes coarse public states', () => {
    expect(toPublicStatus('waiting', 2)).toBe('open');
    expect(toPublicStatus('proposed', 2)).toBe('filling');
    expect(toPublicStatus('formed', 1)).toBe('filling');
    expect(toPublicStatus('proposed', 0)).toBe('full');
    expect(toPublicStatus('met', 1)).toBe('closed');
    expect(toPublicStatus('cancelled', 3)).toBe('closed');
  });
});

describe('time helpers', () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 10, 6, hour));

  it('measures overlap', () => {
    expect(overlapMinutes(at(10), at(12), at(11), at(13))).toBe(60);
    expect(overlapMinutes(at(10), at(11), at(11), at(13))).toBe(0);
    expect(overlapMinutes(at(10), at(11), at(12), at(13))).toBe(0);
  });

  it('coarsens to the hour', () => {
    expect(startBucket(new Date('2026-11-06T14:37:12Z'))).toBe('2026-11-06T14');
  });
});

describe('scoring', () => {
  const base = {
    overlapMin: 60,
    durationMin: 60,
    hasWaitingIntent: false,
    declaredSkills: [],
    neededRole: 'participant',
    vibeMatch: false,
    mutualEncore: false,
  };

  it('applies the playbook weights', () => {
    expect(scoreCandidate(base)).toBe(Math.round(45 + 30 * 0.3 + 15 * 0.8));
    expect(
      scoreCandidate({
        ...base,
        hasWaitingIntent: true,
        declaredSkills: ['participant'],
        mutualEncore: true,
      }),
    ).toBe(100);
  });

  it('rewards better timing', () => {
    expect(scoreCandidate({ ...base, overlapMin: 30 })).toBeLessThan(scoreCandidate(base));
  });

  it('breaks ties deterministically', () => {
    const ranked = rankCandidates([
      { userId: 'b', score: 5 },
      { userId: 'a', score: 5 },
      { userId: 'c', score: 9 },
    ]);
    expect(ranked.map((row) => row.userId)).toEqual(['c', 'a', 'b']);
  });
});

describe('composition validator', () => {
  const aliases = new Set(['c1', 'c2', 'c3']);
  const roles = ['participant', 'participant', 'reviewer'];
  const check = (output: { memberIds: string[]; roles: string[] }, min = 1, max = 3) =>
    validateComposition(output, aliases, roles, min, max);

  it('accepts a valid group', () => {
    expect(check({ memberIds: ['c1', 'c3'], roles: ['reviewer', 'participant'] })).toBeNull();
  });

  it.each([
    [{ memberIds: ['c9'], roles: ['participant'] }, 'member not in shortlist'],
    [{ memberIds: ['c1', 'c1'], roles: ['participant', 'participant'] }, 'duplicate member'],
    [{ memberIds: ['c1'], roles: ['host'] }, 'role not available'],
    [{ memberIds: ['c1', 'c2'], roles: ['reviewer', 'reviewer'] }, 'role not available'],
    [{ memberIds: ['c1', 'c2'], roles: ['participant'] }, 'roles do not line up with members'],
  ])('rejects %j', (output, reason) => {
    expect(check(output)).toBe(reason);
  });

  it('enforces group size limits', () => {
    expect(check({ memberIds: ['c1'], roles: ['participant'] }, 2, 3)).toBe('group below minimum');
    expect(check({ memberIds: ['c1', 'c2'], roles: ['participant', 'participant'] }, 1, 1)).toBe(
      'group above open seats',
    );
  });
});

describe('deterministic intent fallback', () => {
  const now = new Date('2026-11-05T18:00:00Z');

  it('classifies with rules and fills conservative defaults', () => {
    const intent = parseIntentFallback('Anyone up for a late snack run?', now);
    expect(intent).toMatchObject({ category: 'food', groupMin: 2, groupMax: 2, zone: null });
    expect(intent.windowStart.getTime()).toBe(now.getTime() + 3_600_000);
  });

  it('leaves category unset rather than guessing', () => {
    expect(parseIntentFallback('hello there', now).category).toBeNull();
  });

  it('understands relative hours', () => {
    const intent = parseIntentFallback('coffee in 2 hours', now);
    expect(intent.category).toBe('coffee');
    expect(intent.windowStart.getTime()).toBe(now.getTime() + 7_200_000);
  });
});

describe('PII redaction', () => {
  it('removes direct identifiers', () => {
    const text = redactPii(
      'mail me a.b@x.io or +91 98765 43210, wallet 0x' +
        'a'.repeat(40) +
        ' see https://x.io/y',
    );
    expect(text).toBe('mail me [email] or [phone], wallet [wallet] see [link]');
  });
});

describe('backoff', () => {
  it('grows and stays capped', () => {
    expect(backoffMs(1, () => 1)).toBe(4000);
    expect(backoffMs(2, () => 1)).toBe(8000);
    expect(backoffMs(30, () => 1)).toBe(300_000);
    expect(backoffMs(1, () => 0)).toBe(2000);
  });
});
