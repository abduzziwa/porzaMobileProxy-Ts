-- Account deletion (Apple App Store Guideline 5.1.1(v) compliance): Corenio
-- has no delete-account endpoint, so this is a soft-delete on our side.
-- Login is blocked immediately once a deletion is requested (not after the
-- grace period) — deletion_purge_at is a backend-only 30-day retention
-- window before we anonymize PII, not a "log back in to cancel" feature.
-- Idempotent — safe to re-run.

ALTER TABLE v3_users ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE v3_users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMP NULL;
ALTER TABLE v3_users ADD COLUMN IF NOT EXISTS deletion_purge_at TIMESTAMP NULL;
ALTER TABLE v3_users ADD COLUMN IF NOT EXISTS deletion_purged_at TIMESTAMP NULL;
-- Which device initiated the request — audit trail, not used for any logic.
ALTER TABLE v3_users ADD COLUMN IF NOT EXISTS deletion_requested_device_id VARCHAR NULL;

-- Speeds up the daily purge job's scan for accounts past their retention
-- window — a tiny, highly selective index (only deleted-but-not-yet-purged
-- rows match at all).
CREATE INDEX IF NOT EXISTS idx_v3_users_pending_purge
  ON v3_users (deletion_purge_at)
  WHERE deleted = TRUE AND deletion_purged_at IS NULL;
