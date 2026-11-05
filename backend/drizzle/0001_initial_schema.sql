CREATE TYPE "public"."arkiv_sync_status" AS ENUM('pending', 'synced', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('active', 'withdrawn', 'released', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('attest', 'vouch', 'encore');--> statement-breakpoint
CREATE TYPE "public"."intent_status" AS ENUM('draft', 'waiting', 'matched', 'published', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."model_run_outcome" AS ENUM('ok', 'invalid_output', 'timeout', 'upstream_error', 'not_configured');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'declined', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'done', 'dead');--> statement-breakpoint
CREATE TYPE "public"."proposal_source" AS ENUM('ai', 'deterministic');--> statement-breakpoint
CREATE TYPE "public"."proposal_state" AS ENUM('pending', 'confirmed', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."rally_status" AS ENUM('draft', 'open', 'waiting', 'proposed', 'ready', 'formed', 'met', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."rally_visibility" AS ENUM('public_coarse', 'private');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."verification_state" AS ENUM('not_applicable', 'verified', 'flagged', 'rejected');--> statement-breakpoint
CREATE TABLE "arkiv_entities" (
	"rally_id" uuid PRIMARY KEY NOT NULL,
	"entity_key" text,
	"last_tx_hash" text,
	"sync_status" "arkiv_sync_status" DEFAULT 'pending' NOT NULL,
	"synced_version" integer,
	"synced_expires_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rally_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid,
	"status" "claim_status" DEFAULT 'active' NOT NULL,
	"checked_in_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rally_id" uuid NOT NULL,
	"giver_id" uuid NOT NULL,
	"recipient_id" uuid,
	"type" "feedback_type" NOT NULL,
	"happened" boolean,
	"useful" boolean,
	"contribution" text,
	"verification_state" "verification_state" DEFAULT 'not_applicable' NOT NULL,
	"flag_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_not_self" CHECK ("feedback"."giver_id" <> "feedback"."recipient_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_scope_key_pk" PRIMARY KEY("user_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE "intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "intent_status" DEFAULT 'draft' NOT NULL,
	"raw_text" text NOT NULL,
	"source" text NOT NULL,
	"model_run_id" uuid,
	"category" text,
	"goal" text,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"duration_min" integer,
	"group_min" integer,
	"group_max" integer,
	"zone" text,
	"vibe" text,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rally_id" uuid NOT NULL,
	"state" "proposal_state" DEFAULT 'pending' NOT NULL,
	"source" "proposal_source" NOT NULL,
	"reason" text NOT NULL,
	"score" integer NOT NULL,
	"model_run_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text,
	"provider" text,
	"request_id" text,
	"latency_ms" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost" text,
	"tee_verified" boolean,
	"outcome" "model_run_outcome" NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"rally_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"hold_until" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_answers" (
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"answer" text NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_answers_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"interests" text[] NOT NULL,
	"interests_version" integer DEFAULT 1 NOT NULL,
	"declared_skills" text[] DEFAULT '{}' NOT NULL,
	"inferred_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"available_from" timestamp with time zone,
	"available_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rallies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opaque_id" text NOT NULL,
	"creator_id" uuid NOT NULL,
	"intent_id" uuid,
	"status" "rally_status" DEFAULT 'draft' NOT NULL,
	"visibility" "rally_visibility" DEFAULT 'public_coarse' NOT NULL,
	"category" text NOT NULL,
	"goal" text NOT NULL,
	"vibe" text,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"zone" text NOT NULL,
	"needed_role" text DEFAULT 'participant' NOT NULL,
	"group_min" integer NOT NULL,
	"capacity" integer NOT NULL,
	"open_seats" integer NOT NULL,
	"meeting_point" text,
	"meeting_brief" text,
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"formed_at" timestamp with time zone,
	"met_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rallies_opaque_id_unique" UNIQUE("opaque_id"),
	CONSTRAINT "rallies_seats_valid" CHECK ("rallies"."open_seats" >= 0 and "rallies"."open_seats" <= "rallies"."capacity"),
	CONSTRAINT "rallies_group_valid" CHECK ("rallies"."group_min" >= 2 and "rallies"."group_min" <= "rallies"."capacity"),
	CONSTRAINT "rallies_window_valid" CHECK ("rallies"."window_end" > "rallies"."window_start"),
	CONSTRAINT "rallies_duration_valid" CHECK ("rallies"."duration_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "rally_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rally_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"rally_id" uuid,
	"reason" text NOT NULL,
	"delta" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"anti_abuse" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_ledger_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "reward_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"amount" text NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_vouchers_ledger_id_unique" UNIQUE("ledger_id"),
	CONSTRAINT "reward_vouchers_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "user_blocks_not_self" CHECK ("user_blocks"."blocker_id" <> "user_blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_did" text NOT NULL,
	"wallet_address" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"display_name" text,
	"opt_in_matching" boolean DEFAULT false NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_privy_did_unique" UNIQUE("privy_did")
);
--> statement-breakpoint
ALTER TABLE "arkiv_entities" ADD CONSTRAINT "arkiv_entities_rally_id_rallies_id_fk" FOREIGN KEY ("rally_id") REFERENCES "public"."rallies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_rally_id_rallies_id_fk" FOREIGN KEY ("rally_id") REFERENCES "public"."rallies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_slot_id_rally_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."rally_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_rally_id_rallies_id_fk" FOREIGN KEY ("rally_id") REFERENCES "public"."rallies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_giver_id_users_id_fk" FOREIGN KEY ("giver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_model_run_id_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_proposals" ADD CONSTRAINT "match_proposals_rally_id_rallies_id_fk" FOREIGN KEY ("rally_id") REFERENCES "public"."rallies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_proposals" ADD CONSTRAINT "match_proposals_model_run_id_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_proposal_id_match_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."match_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_rally_id_rallies_id_fk" FOREIGN KEY ("rally_id") REFERENCES "public"."rallies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_candidate_id_users_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_answers" ADD CONSTRAINT "onboarding_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_versions" ADD CONSTRAINT "profile_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rallies" ADD CONSTRAINT "rallies_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rallies" ADD CONSTRAINT "rallies_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rally_slots" ADD CONSTRAINT "rally_slots_rally_id_rallies_id_fk" FOREIGN KEY ("rally_id") REFERENCES "public"."rallies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_rally_id_rallies_id_fk" FOREIGN KEY ("rally_id") REFERENCES "public"."rallies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_vouchers" ADD CONSTRAINT "reward_vouchers_ledger_id_reward_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."reward_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_vouchers" ADD CONSTRAINT "reward_vouchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arkiv_entities_key_key" ON "arkiv_entities" USING btree ("entity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_active_per_slot_key" ON "claims" USING btree ("slot_id") WHERE "claims"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_active_per_user_key" ON "claims" USING btree ("rally_id","user_id") WHERE "claims"."status" = 'active';--> statement-breakpoint
CREATE INDEX "claims_user_status_idx" ON "claims" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_attest_once_key" ON "feedback" USING btree ("rally_id","giver_id") WHERE "feedback"."type" = 'attest';--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_pair_once_key" ON "feedback" USING btree ("rally_id","giver_id","recipient_id","type") WHERE "feedback"."type" <> 'attest';--> statement-breakpoint
CREATE INDEX "feedback_recipient_idx" ON "feedback" USING btree ("recipient_id","type");--> statement-breakpoint
CREATE INDEX "feedback_giver_idx" ON "feedback" USING btree ("giver_id","type","created_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "intents_user_idx" ON "intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "intents_waiting_idx" ON "intents" USING btree ("category","window_start","window_end") WHERE "intents"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "match_proposals_rally_idx" ON "match_proposals" USING btree ("rally_id");--> statement-breakpoint
CREATE INDEX "match_proposals_expiry_idx" ON "match_proposals" USING btree ("expires_at") WHERE "match_proposals"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "model_runs_task_created_idx" ON "model_runs" USING btree ("task","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "offers_candidate_idx" ON "offers" USING btree ("candidate_id","status");--> statement-breakpoint
CREATE INDEX "offers_proposal_idx" ON "offers" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_one_per_rally_candidate_key" ON "offers" USING btree ("rally_id","candidate_id");--> statement-breakpoint
CREATE INDEX "offers_expiry_idx" ON "offers" USING btree ("hold_until") WHERE "offers"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_events_due_idx" ON "outbox_events" USING btree ("next_attempt_at") WHERE "outbox_events"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_events_stale_idx" ON "outbox_events" USING btree ("locked_until") WHERE "outbox_events"."status" = 'processing';--> statement-breakpoint
CREATE UNIQUE INDEX "profile_versions_user_version_key" ON "profile_versions" USING btree ("user_id","version");--> statement-breakpoint
CREATE INDEX "rallies_creator_idx" ON "rallies" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "rallies_matchable_idx" ON "rallies" USING btree ("category","window_start") WHERE "rallies"."status" in ('open', 'waiting', 'proposed');--> statement-breakpoint
CREATE INDEX "rallies_expiry_idx" ON "rallies" USING btree ("expires_at") WHERE "rallies"."status" in ('draft', 'open', 'waiting', 'proposed', 'ready', 'formed');--> statement-breakpoint
CREATE UNIQUE INDEX "rally_slots_rally_position_key" ON "rally_slots" USING btree ("rally_id","position");--> statement-breakpoint
CREATE INDEX "reward_ledger_subject_idx" ON "reward_ledger" USING btree ("subject_user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_id");