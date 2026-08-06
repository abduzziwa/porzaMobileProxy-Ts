-- v3 notification history: one row per matched user per email-copy delivery
-- event, for the future Notifications page in the app. Idempotent — safe to
-- re-run. user_id references v3_users(user_id) (the Corenio numeric ID),
-- matching the FK convention already used by v3_device_sessions, v3_cart,
-- v3_orders, etc. — verified live via \d v3_users before writing this.

CREATE TABLE IF NOT EXISTS v3_notifications (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER NOT NULL REFERENCES v3_users(user_id) ON DELETE CASCADE,
  recipient_email         VARCHAR(320) NOT NULL,
  title                   VARCHAR(200) NOT NULL,
  body                    TEXT NOT NULL,
  source                  VARCHAR(100) NOT NULL DEFAULT 'corenio-email-copy',
  read_at                 TIMESTAMP NULL,
  delivery_status         VARCHAR(30) NOT NULL DEFAULT 'pending',
  firebase_success_count  INTEGER NOT NULL DEFAULT 0,
  firebase_failure_count  INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT v3_notifications_delivery_status_check
    CHECK (delivery_status IN ('pending', 'sent', 'partially_sent', 'failed', 'no_active_devices'))
);

CREATE INDEX IF NOT EXISTS idx_v3_notifications_user_created
  ON v3_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_v3_notifications_user_read
  ON v3_notifications (user_id, read_at);

CREATE INDEX IF NOT EXISTS idx_v3_notifications_created_at
  ON v3_notifications (created_at);

CREATE INDEX IF NOT EXISTS idx_v3_notifications_delivery_status
  ON v3_notifications (delivery_status);

-- ─── Retention (not executed automatically) ──────────────────────────────
-- This project has no cron/task-runner infrastructure. Run the statement
-- below manually (or via an external scheduler later) to purge history
-- older than the 180-day retention window:
--
-- DELETE FROM v3_notifications WHERE created_at < NOW() - INTERVAL '180 days';
