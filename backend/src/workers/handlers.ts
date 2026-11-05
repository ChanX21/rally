import { z } from 'zod';

import type { Deps } from '../lib/deps.js';
import type { OutboxEventType } from '../lib/outbox.js';
import { syncRallyListing } from '../services/arkiv-sync.js';
import { applyVerifiedVouch } from '../services/feedback.js';
import { evaluateForUser, evaluateRally } from '../services/matching.js';

/** A bad payload can never succeed, so retrying is pointless. */
export class PermanentError extends Error {
  override readonly name = 'PermanentError';
}

function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) throw new PermanentError('Invalid outbox payload');
  return result.data;
}

const rallyPayload = z.object({ rallyId: z.uuid() });
const userPayload = z.object({ userId: z.uuid() });
const reevaluatePayload = z.union([rallyPayload, userPayload]);
const vouchPayload = z.object({ feedbackId: z.uuid() });

export type OutboxHandler = (deps: Deps, payload: unknown) => Promise<unknown>;

/** Delivery is at-least-once, so every handler must be safe to run twice. */
export const handlers: Record<OutboxEventType, OutboxHandler> = {
  'rally.published': (deps, payload) =>
    evaluateRally(deps, parsePayload(rallyPayload, payload).rallyId),
  'user.onboarded': (deps, payload) =>
    evaluateForUser(deps, parsePayload(userPayload, payload).userId),
  'match.reevaluate': (deps, payload) => {
    const parsed = parsePayload(reevaluatePayload, payload);
    return 'rallyId' in parsed
      ? evaluateRally(deps, parsed.rallyId)
      : evaluateForUser(deps, parsed.userId);
  },
  'arkiv.sync': (deps, payload) =>
    syncRallyListing(deps, parsePayload(rallyPayload, payload).rallyId),
  'vouch.verified': (deps, payload) =>
    applyVerifiedVouch(deps, parsePayload(vouchPayload, payload).feedbackId),
};
