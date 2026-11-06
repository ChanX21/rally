ALTER TABLE "model_runs" ADD COLUMN "rally_id" uuid;--> statement-breakpoint
CREATE INDEX "model_runs_rally_created_idx" ON "model_runs" USING btree ("rally_id","created_at");
--> statement-breakpoint
UPDATE outbox_events
SET status = 'pending', attempts = 0, next_attempt_at = now(), processed_at = NULL,
    payload = payload - 'dialogue'
WHERE type = 'map.dialogue' AND status = 'done' AND payload ? 'dialogue'
  AND NOT (payload ? 'aiRequestId');
