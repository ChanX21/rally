CREATE TABLE "rally_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rally_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'processing' NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reason" text,
	"model_run_id" uuid,
	"assessment" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"reward_amount" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "rally_proofs_state_valid" CHECK ("rally_proofs"."state" in ('processing', 'accepted', 'needs_clearer_photos', 'unavailable')),
	CONSTRAINT "rally_proofs_attempts_valid" CHECK ("rally_proofs"."attempts" between 0 and 2),
	CONSTRAINT "rally_proofs_reward_valid" CHECK ("rally_proofs"."reward_amount" > 0 and "rally_proofs"."reward_amount" <= 100)
);
--> statement-breakpoint
ALTER TABLE "rallies" ADD COLUMN "proof_flow" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rallies" ADD COLUMN "completion_member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD COLUMN "proof_id" uuid;--> statement-breakpoint
ALTER TABLE "rally_proofs" ADD CONSTRAINT "rally_proofs_rally_id_rallies_id_fk" FOREIGN KEY ("rally_id") REFERENCES "public"."rallies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rally_proofs" ADD CONSTRAINT "rally_proofs_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rally_proofs" ADD CONSTRAINT "rally_proofs_model_run_id_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rally_proofs_request_key" ON "rally_proofs" USING btree ("rally_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rally_proofs_one_live" ON "rally_proofs" USING btree ("rally_id") WHERE "rally_proofs"."state" in ('processing', 'accepted');--> statement-breakpoint
CREATE INDEX "rally_proofs_rally_idx" ON "rally_proofs" USING btree ("rally_id","created_at");--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_proof_id_rally_proofs_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."rally_proofs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rally_proofs" ENABLE ROW LEVEL SECURITY;
