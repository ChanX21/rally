-- Recheck existing open Rallies once after removing onboarding-interest restrictions.
INSERT INTO outbox_events (type, dedupe_key, payload)
SELECT 'match.reevaluate', 'preferences-matching-v1:' || id::text,
       jsonb_build_object('rallyId', id)
FROM rallies
WHERE status IN ('open', 'waiting', 'proposed') AND open_seats > 0 AND expires_at > now()
ON CONFLICT DO NOTHING;
