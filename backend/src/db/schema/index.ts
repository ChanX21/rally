import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const userStatus = pgEnum('user_status', ['active', 'suspended']);
export const intentStatus = pgEnum('intent_status', [
  'draft',
  'waiting',
  'matched',
  'published',
  'expired',
  'cancelled',
]);
export const rallyStatus = pgEnum('rally_status', [
  'draft',
  'open',
  'waiting',
  'proposed',
  'ready',
  'formed',
  'met',
  'completed',
  'cancelled',
  'expired',
]);
export const rallyVisibility = pgEnum('rally_visibility', ['public_coarse', 'private']);
export const proposalState = pgEnum('proposal_state', [
  'pending',
  'confirmed',
  'failed',
  'expired',
  'cancelled',
]);
export const proposalSource = pgEnum('proposal_source', ['ai', 'deterministic']);
export const offerStatus = pgEnum('offer_status', [
  'pending',
  'accepted',
  'declined',
  'expired',
  'cancelled',
]);
export const claimStatus = pgEnum('claim_status', ['active', 'withdrawn', 'released', 'no_show']);
export const feedbackType = pgEnum('feedback_type', ['attest', 'vouch', 'encore']);
export const verificationState = pgEnum('verification_state', [
  'not_applicable',
  'verified',
  'flagged',
  'rejected',
]);
export const rewardEntryState = pgEnum('reward_entry_state', [
  'pending',
  'held',
  'applied',
  'cancelled',
]);
export const chainStatus = pgEnum('chain_status', ['pending', 'queued', 'synced', 'failed']);
export const disputeCategory = pgEnum('dispute_category', [
  'no_show_appeal',
  'misconduct',
  'false_checkin',
  'other',
]);
export const disputeStatus = pgEnum('dispute_status', ['open', 'upheld', 'dismissed', 'false']);
export const outboxStatus = pgEnum('outbox_status', ['pending', 'processing', 'done', 'dead']);
export const arkivSyncStatus = pgEnum('arkiv_sync_status', ['pending', 'synced', 'deleted']);
export const modelRunOutcome = pgEnum('model_run_outcome', [
  'ok',
  'invalid_output',
  'timeout',
  'upstream_error',
  'not_configured',
]);

export const users = pgTable('users', {
  id: id(),
  privyDid: text('privy_did').notNull().unique(),
  walletAddress: text('wallet_address'),
  // Set at the first chain write, so one person's public history stays on one address.
  rewardAddress: text('reward_address'),
  status: userStatus('status').notNull().default('active'),
  displayName: text('display_name'),
  optInMatching: boolean('opt_in_matching').notNull().default(false),
  onboardedAt: timestamptz('onboarded_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const profileVersions = pgTable(
  'profile_versions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    version: integer('version').notNull(),
    interests: text('interests').array().notNull(),
    interestsVersion: integer('interests_version').notNull().default(1),
    declaredSkills: text('declared_skills').array().notNull().default(sql`'{}'`),
    inferredTags: jsonb('inferred_tags').$type<InferredTag[]>().notNull().default([]),
    evidence: jsonb('evidence').$type<ProfileEvidence[]>().notNull().default([]),
    preferences: jsonb('preferences').$type<Record<string, string>>().notNull().default({}),
    availableFrom: timestamptz('available_from'),
    availableTo: timestamptz('available_to'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('profile_versions_user_version_key').on(table.userId, table.version)],
);

export const onboardingAnswers = pgTable(
  'onboarding_answers',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    questionId: text('question_id').notNull(),
    answer: text('answer').notNull(),
    answeredAt: timestamptz('answered_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.questionId] })],
);

export const userBlocks = pgTable(
  'user_blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.blockerId, table.blockedId] }),
    index('user_blocks_blocked_idx').on(table.blockedId),
    check('user_blocks_not_self', sql`${table.blockerId} <> ${table.blockedId}`),
  ],
);

export const modelRuns = pgTable(
  'model_runs',
  {
    id: id(),
    task: text('task').notNull(),
    rallyId: uuid('rally_id'),
    promptVersion: text('prompt_version').notNull(),
    model: text('model'),
    provider: text('provider'),
    requestId: text('request_id'),
    latencyMs: integer('latency_ms'),
    totalTokens: integer('total_tokens'),
    cost: text('cost'),
    outcome: modelRunOutcome('outcome').notNull(),
    failureReason: text('failure_reason'),
    createdAt: createdAt(),
  },
  (table) => [index('model_runs_task_created_idx').on(table.task, table.createdAt), index('model_runs_rally_created_idx').on(table.rallyId, table.createdAt)],
);

export const intents = pgTable(
  'intents',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: intentStatus('status').notNull().default('draft'),
    rawText: text('raw_text').notNull(),
    source: text('source').$type<'ai' | 'fallback'>().notNull(),
    modelRunId: uuid('model_run_id').references(() => modelRuns.id),
    preferences: jsonb('preferences').$type<Record<string, string>>().notNull().default({}),
    category: text('category'),
    goal: text('goal'),
    windowStart: timestamptz('window_start'),
    windowEnd: timestamptz('window_end'),
    durationMin: integer('duration_min'),
    groupMin: integer('group_min'),
    groupMax: integer('group_max'),
    zone: text('zone'),
    vibe: text('vibe'),
    questions: jsonb('questions').$type<ClarifyingQuestion[]>().notNull().default([]),
    answers: jsonb('answers').$type<ClarifyingAnswer[]>().notNull().default([]),
    // Enforced here because clients cannot be trusted to count: one parse plus one reparse.
    parseAttempts: integer('parse_attempts').notNull().default(0),
    timeZone: text('time_zone'),
    expiresAt: timestamptz('expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('intents_user_idx').on(table.userId, table.createdAt),
    index('intents_waiting_idx')
      .on(table.category, table.windowStart, table.windowEnd)
      .where(sql`${table.status} = 'waiting'`),
  ],
);

export const rallies = pgTable(
  'rallies',
  {
    id: id(),
    opaqueId: text('opaque_id').notNull().unique(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id),
    intentId: uuid('intent_id').references(() => intents.id),
    status: rallyStatus('status').notNull().default('draft'),
    visibility: rallyVisibility('visibility').notNull().default('public_coarse'),
    preferences: jsonb('preferences').$type<Record<string, string>>().notNull().default({}),
    category: text('category').notNull(),
    goal: text('goal').notNull(),
    vibe: text('vibe'),
    windowStart: timestamptz('window_start').notNull(),
    windowEnd: timestamptz('window_end').notNull(),
    durationMin: integer('duration_min').notNull(),
    zone: text('zone').notNull(),
    neededRole: text('needed_role').notNull().default('participant'),
    groupMin: integer('group_min').notNull(),
    capacity: integer('capacity').notNull(),
    openSeats: integer('open_seats').notNull(),
    meetingPoint: text('meeting_point'),
    meetingBrief: text('meeting_brief'),
    meetAt: timestamptz('meet_at'),
    expiresAt: timestamptz('expires_at').notNull(),
    // A model no_fit for this shortlist. Waits for supply to change before spending another call.
    noFitShortlistHash: text('no_fit_shortlist_hash'),
    version: integer('version').notNull().default(1),
    publishedAt: timestamptz('published_at'),
    formedAt: timestamptz('formed_at'),
    metAt: timestamptz('met_at'),
    completedAt: timestamptz('completed_at'),
    proofFlow: boolean('proof_flow').notNull().default(false),
    completionMemberIds: jsonb('completion_member_ids').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('rallies_creator_idx').on(table.creatorId, table.createdAt),
    index('rallies_matchable_idx')
      .on(table.category, table.windowStart)
      .where(sql`${table.status} in ('open', 'waiting', 'proposed')`),
    index('rallies_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} in ('draft', 'open', 'waiting', 'proposed', 'ready', 'formed')`),
    check(
      'rallies_seats_valid',
      sql`${table.openSeats} >= 0 and ${table.openSeats} <= ${table.capacity}`,
    ),
    check(
      'rallies_group_valid',
      sql`${table.groupMin} >= 2 and ${table.groupMin} <= ${table.capacity}`,
    ),
    check('rallies_window_valid', sql`${table.windowEnd} > ${table.windowStart}`),
    check('rallies_duration_valid', sql`${table.durationMin} > 0`),
  ],
);

export const rallySlots = pgTable(
  'rally_slots',
  {
    id: id(),
    rallyId: uuid('rally_id')
      .notNull()
      .references(() => rallies.id),
    position: integer('position').notNull(),
    role: text('role').notNull(),
    // Set when capacity shrinks. Old claims may still reference a retired slot.
    retiredAt: timestamptz('retired_at'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('rally_slots_rally_position_key').on(table.rallyId, table.position)],
);

export const matchProposals = pgTable(
  'match_proposals',
  {
    id: id(),
    rallyId: uuid('rally_id')
      .notNull()
      .references(() => rallies.id),
    state: proposalState('state').notNull().default('pending'),
    source: proposalSource('source').notNull(),
    reason: text('reason').notNull(),
    score: integer('score').notNull(),
    modelRunId: uuid('model_run_id').references(() => modelRuns.id),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('match_proposals_rally_idx').on(table.rallyId),
    index('match_proposals_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.state} = 'pending'`),
  ],
);

export const offers = pgTable(
  'offers',
  {
    id: id(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => matchProposals.id),
    rallyId: uuid('rally_id')
      .notNull()
      .references(() => rallies.id),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
    status: offerStatus('status').notNull().default('pending'),
    holdUntil: timestamptz('hold_until').notNull(),
    respondedAt: timestamptz('responded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('offers_candidate_idx').on(table.candidateId, table.status),
    index('offers_proposal_idx').on(table.proposalId),
    uniqueIndex('offers_one_per_rally_candidate_key').on(table.rallyId, table.candidateId),
    index('offers_expiry_idx')
      .on(table.holdUntil)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const claims = pgTable(
  'claims',
  {
    id: id(),
    rallyId: uuid('rally_id')
      .notNull()
      .references(() => rallies.id),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => rallySlots.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    offerId: uuid('offer_id').references(() => offers.id),
    status: claimStatus('status').notNull().default('active'),
    checkedInAt: timestamptz('checked_in_at'),
    arrivedAt: timestamptz('arrived_at'),
    releasedAt: timestamptz('released_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('claims_one_active_per_slot_key')
      .on(table.slotId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('claims_one_active_per_user_key')
      .on(table.rallyId, table.userId)
      .where(sql`${table.status} = 'active'`),
    index('claims_user_status_idx').on(table.userId, table.status),
  ],
);

export const feedback = pgTable(
  'feedback',
  {
    id: id(),
    rallyId: uuid('rally_id')
      .notNull()
      .references(() => rallies.id),
    giverId: uuid('giver_id')
      .notNull()
      .references(() => users.id),
    recipientId: uuid('recipient_id').references(() => users.id),
    type: feedbackType('type').notNull(),
    happened: boolean('happened'),
    useful: boolean('useful'),
    contribution: text('contribution'),
    verificationState: verificationState('verification_state').notNull().default('not_applicable'),
    flagReason: text('flag_reason'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('feedback_attest_once_key')
      .on(table.rallyId, table.giverId)
      .where(sql`${table.type} = 'attest'`),
    uniqueIndex('feedback_pair_once_key')
      .on(table.rallyId, table.giverId, table.recipientId, table.type)
      .where(sql`${table.type} <> 'attest'`),
    index('feedback_recipient_idx').on(table.recipientId, table.type),
    index('feedback_giver_idx').on(table.giverId, table.type, table.createdAt),
    check('feedback_not_self', sql`${table.giverId} <> ${table.recipientId}`),
  ],
);

// shortcut: bounded normalized photos live privately in Postgres for the pilot; move to object storage when volume grows.
export const rallyProofs = pgTable('rally_proofs', {
  id: id(),
  rallyId: uuid('rally_id').notNull().references(() => rallies.id),
  uploaderId: uuid('uploader_id').notNull().references(() => users.id),
  requestKey: text('request_key').notNull(),
  requestHash: text('request_hash').notNull(),
  state: text('state').$type<'processing' | 'accepted' | 'needs_clearer_photos' | 'unavailable'>().notNull().default('processing'),
  images: jsonb('images').$type<{ data: string; hash: string }[]>().notNull().default([]),
  note: text('note').notNull().default(''),
  reason: text('reason'),
  modelRunId: uuid('model_run_id').references(() => modelRuns.id),
  assessment: jsonb('assessment').$type<Record<string, unknown>>(),
  attempts: integer('attempts').notNull().default(0),
  leaseUntil: timestamptz('lease_until'),
  rewardAmount: integer('reward_amount').notNull(),
  policyVersion: integer('policy_version').notNull(),
  createdAt: createdAt(),
  decidedAt: timestamptz('decided_at'),
}, (table) => [
  uniqueIndex('rally_proofs_request_key').on(table.rallyId, table.requestKey),
  uniqueIndex('rally_proofs_one_live').on(table.rallyId).where(sql`${table.state} in ('processing', 'accepted')`),
  index('rally_proofs_rally_idx').on(table.rallyId, table.createdAt),
  check('rally_proofs_state_valid', sql`${table.state} in ('processing', 'accepted', 'needs_clearer_photos', 'unavailable')`),
  check('rally_proofs_attempts_valid', sql`${table.attempts} between 0 and 2`),
  check('rally_proofs_reward_valid', sql`${table.rewardAmount} > 0 and ${table.rewardAmount} <= 100`),
]);

export const rewardLedger = pgTable(
  'reward_ledger',
  {
    id: id(),
    subjectUserId: uuid('subject_user_id')
      .notNull()
      .references(() => users.id),
    rallyId: uuid('rally_id').references(() => rallies.id),
    reason: text('reason').notNull(),
    delta: integer('delta').notNull(),
    policyVersion: integer('policy_version').notNull(),
    antiAbuse: text('anti_abuse').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    action: text('action'),
    state: rewardEntryState('state').notNull().default('applied'),
    appliesAt: timestamptz('applies_at'),
    groupKey: text('group_key'),
    proofId: uuid('proof_id').references(() => rallyProofs.id),
    chainStatus: chainStatus('chain_status').notNull().default('pending'),
    chainTxHash: text('chain_tx_hash'),
    createdAt: createdAt(),
  },
  (table) => [
    index('reward_ledger_subject_idx').on(table.subjectUserId, table.createdAt),
    index('reward_ledger_due_idx')
      .on(table.appliesAt)
      .where(sql`${table.state} = 'pending'`),
    index('reward_ledger_chain_idx')
      .on(table.createdAt)
      .where(sql`${table.state} = 'applied' and ${table.chainStatus} = 'pending'`),
  ],
);

export const rewardPolicies = pgTable('reward_policies', {
  version: integer('version').primaryKey(),
  amounts: jsonb('amounts').$type<Record<string, number>>().notNull(),
  chainTxHash: text('chain_tx_hash'),
  createdAt: createdAt(),
});

export const disputes = pgTable(
  'disputes',
  {
    id: id(),
    rallyId: uuid('rally_id')
      .notNull()
      .references(() => rallies.id),
    raisedBy: uuid('raised_by')
      .notNull()
      .references(() => users.id),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => users.id),
    category: disputeCategory('category').notNull(),
    description: text('description').notNull(),
    status: disputeStatus('status').notNull().default('open'),
    // The no-show entry an appeal is holding back.
    heldEntryId: uuid('held_entry_id').references(() => rewardLedger.id),
    resolvedBy: text('resolved_by'),
    resolutionNote: text('resolution_note'),
    resolvedAt: timestamptz('resolved_at'),
    chainStatus: chainStatus('chain_status').notNull().default('pending'),
    chainTxHash: text('chain_tx_hash'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('disputes_once_key').on(
      table.rallyId,
      table.raisedBy,
      table.subjectId,
      table.category,
    ),
    index('disputes_status_idx').on(table.status, table.createdAt),
    index('disputes_subject_idx').on(table.subjectId, table.createdAt),
    index('disputes_raiser_idx').on(table.raisedBy, table.createdAt),
  ],
);

export const rewardVouchers = pgTable('reward_vouchers', {
  id: id(),
  ledgerId: uuid('ledger_id')
    .notNull()
    .unique()
    .references(() => rewardLedger.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  wallet: text('wallet').notNull(),
  amount: text('amount').notNull(),
  nonce: text('nonce').notNull().unique(),
  expiresAt: timestamptz('expires_at').notNull(),
  signature: text('signature').notNull(),
  createdAt: createdAt(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data').$type<Record<string, string>>().notNull().default({}),
    dedupeKey: text('dedupe_key').notNull().unique(),
    readAt: timestamptz('read_at'),
    createdAt: createdAt(),
  },
  (table) => [index('notifications_user_idx').on(table.userId, table.createdAt)],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: id(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text('dedupe_key').unique(),
    status: outboxStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    lockedUntil: timestamptz('locked_until'),
    lastError: text('last_error'),
    processedAt: timestamptz('processed_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('outbox_events_due_idx')
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    index('outbox_events_stale_idx')
      .on(table.lockedUntil)
      .where(sql`${table.status} = 'processing'`),
  ],
);

export const arkivEntities = pgTable(
  'arkiv_entities',
  {
    rallyId: uuid('rally_id')
      .primaryKey()
      .references(() => rallies.id),
    entityKey: text('entity_key'),
    lastTxHash: text('last_tx_hash'),
    syncStatus: arkivSyncStatus('sync_status').notNull().default('pending'),
    syncedVersion: integer('synced_version'),
    syncedExpiresAt: timestamptz('synced_expires_at'),
    syncedAt: timestamptz('synced_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('arkiv_entities_key_key').on(table.entityKey)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.scope, table.key] }),
    index('idempotency_keys_created_idx').on(table.createdAt),
  ],
);

export interface InferredTag {
  tag: string;
  confidence: number;
  source: string;
  at: string;
}

export interface ProfileEvidence {
  type: 'vouch';
  rallyId: string;
  contribution: string;
  at: string;
}

export interface ClarifyingQuestion {
  options?: { value: string; label: string }[];
  id: string;
  text: string;
}

export interface ClarifyingAnswer {
  questionId: string;
  answer: string;
}
