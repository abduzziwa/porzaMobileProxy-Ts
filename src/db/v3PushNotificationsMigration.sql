-- v3 push notifications: extend v3_devices with FCM token storage.
-- Idempotent — safe to re-run.

ALTER TABLE v3_devices ADD COLUMN IF NOT EXISTS fcm_token TEXT NULL;
ALTER TABLE v3_devices ADD COLUMN IF NOT EXISTS fcm_token_status VARCHAR(30) NOT NULL DEFAULT 'missing';
ALTER TABLE v3_devices ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE v3_devices ADD COLUMN IF NOT EXISTS fcm_token_updated_at TIMESTAMP NULL;

-- Speeds up the email-to-device lookup used by the Corenio notification pipeline,
-- which only ever needs devices that currently have a live, sendable token.
CREATE INDEX IF NOT EXISTS idx_v3_devices_active_push_tokens
  ON v3_devices (device_id)
  WHERE fcm_token IS NOT NULL
    AND notifications_enabled = TRUE
    AND fcm_token_status = 'active';
