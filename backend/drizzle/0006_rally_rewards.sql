CREATE TYPE "public"."chain_status" AS ENUM('pending', 'queued', 'synced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."dispute_category" AS ENUM('no_show_appeal', 'misconduct', 'false_checkin', 'other');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'upheld', 'dismissed', 'false');--> statement-breakpoint
CREATE TYPE "public"."reward_entry_state" AS ENUM('pending', 'held', 'applied', 'cancelled');--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rally_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"category" "dispute_category" NOT NULL,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"held_entry_id" uuid,
	"resolved_by" text,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"chain_status" "chain_status" DEFAULT 'pending' NOT NULL,
	"chain_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_policies" (
	"version" integer PRIMARY KEY NOT NULL,
	"amounts" jsonb NOT NULL,
	"chain_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rallies" ADD COLUMN "meet_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD COLUMN "action" text;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD COLUMN "state" "reward_entry_state" DEFAULT 'applied' NOT NULL;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD COLUMN "applies_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD COLUMN "group_key" text;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD COLUMN "chain_status" "chain_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD COLUMN "chain_tx_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reward_address" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_rally_id_rallies_id_fk" FOREIGN KEY ("rally_id") REFERENCES "public"."rallies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_held_entry_id_reward_ledger_id_fk" FOREIGN KEY ("held_entry_id") REFERENCES "public"."reward_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_once_key" ON "disputes" USING btree ("rally_id","raised_by","subject_id","category");--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "disputes_subject_idx" ON "disputes" USING btree ("subject_id","created_at");--> statement-breakpoint
CREATE INDEX "disputes_raiser_idx" ON "disputes" USING btree ("raised_by","created_at");--> statement-breakpoint
CREATE INDEX "reward_ledger_due_idx" ON "reward_ledger" USING btree ("applies_at") WHERE "reward_ledger"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "reward_ledger_chain_idx" ON "reward_ledger" USING btree ("created_at") WHERE "reward_ledger"."state" = 'applied' and "reward_ledger"."chain_status" = 'pending';--> statement-breakpoint
ALTER TABLE "reward_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "disputes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE "reward_ledger" SET "action" = 'Vouched' WHERE "reason" = 'completed_and_vouched';
