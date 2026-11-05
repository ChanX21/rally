ALTER TABLE "intents" ADD COLUMN "answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "parse_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "model_runs" ADD COLUMN "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "rallies" ADD COLUMN "no_fit_shortlist_hash" text;