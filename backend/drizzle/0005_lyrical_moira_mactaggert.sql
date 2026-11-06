ALTER TABLE "intents" ADD COLUMN "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rallies" ADD COLUMN "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;