-- Supabase exposes the public schema through its Data API. With RLS on and no policies, the anon
-- and authenticated roles see nothing. This service connects as the owner, which bypasses RLS.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "profile_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "onboarding_answers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_blocks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "model_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "intents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rallies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rally_slots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "match_proposals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reward_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reward_vouchers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "arkiv_entities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
