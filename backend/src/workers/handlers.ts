import { z } from 'zod';

import type { Deps } from '../lib/deps.js';
import type { OutboxEventType } from '../lib/outbox.js';
import { syncRallyListing } from '../services/arkiv-sync.js';
import { syncDispute, syncPolicy, syncRewardEntry } from '../services/chain-sync.js';
import { assessProof } from '../services/proofs.js';
import { applyVerifiedVouch } from '../services/feedback.js';
import { evaluateForUser, evaluateRally } from '../services/matching.js';
import { generateMapDialogue } from '../services/map-dialogue.js';

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
const userPayload = z.object({ userId: z.uuid(), after: z.object({ id: z.uuid(), start: z.iso.datetime().transform((v) => new Date(v)) }).optional() });
const reevaluatePayload = z.union([rallyPayload, userPayload]);
const vouchPayload = z.object({ feedbackId: z.uuid() });
const entryPayload = z.object({ entryId: z.uuid() });
const policyPayload = z.object({ version: z.number().int().positive() });
const disputePayload = z.object({ disputeId: z.uuid() });

export type OutboxHandler = (deps: Deps, payload: unknown) => Promise<unknown>;

/** Delivery is at-least-once, so every handler must be safe to run twice. */
export const handlers: Record<OutboxEventType, OutboxHandler> = {
  'map.dialogue': (deps, payload) => {
    const input = parsePayload(z.object({ rallyId: z.uuid(), key: z.string().min(1).max(200) }), payload);
    return generateMapDialogue(deps, input.rallyId, input.key);
  },
  'rally.published': (deps, payload) =>
    evaluateRally(deps, parsePayload(rallyPayload, payload).rallyId),
  'user.onboarded': (deps, payload) =>
    evaluateForUser(deps, parsePayload(userPayload, payload).userId),
  'match.reevaluate': (deps, payload) => {
    const parsed = parsePayload(reevaluatePayload, payload);
    return 'rallyId' in parsed
      ? evaluateRally(deps, parsed.rallyId)
      : evaluateForUser(deps, parsed.userId, parsed.after);
  },
  'arkiv.sync': (deps, payload) =>
    syncRallyListing(deps, parsePayload(rallyPayload, payload).rallyId),
  'proof.assess': (deps, payload) => assessProof(deps, parsePayload(z.object({ proofId: z.uuid() }), payload).proofId),
  'vouch.verified': (deps, payload) =>
    applyVerifiedVouch(deps, parsePayload(vouchPayload, payload).feedbackId),
  'reward.chain_sync': (deps, payload) =>
    syncRewardEntry(deps, parsePayload(entryPayload, payload).entryId),
  'reward.policy_sync': (deps, payload) =>
    syncPolicy(deps, parsePayload(policyPayload, payload).version),
  'dispute.chain_sync': (deps, payload) =>
    syncDispute(deps, parsePayload(disputePayload, payload).disputeId),
};
