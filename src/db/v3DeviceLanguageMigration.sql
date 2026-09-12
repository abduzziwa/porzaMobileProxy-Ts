-- Tracks the device's current app language so composed messages (push
-- notifications) can be sent in the language the user actually has the app
-- set to, instead of always English. Kept per-device (same granularity as
-- platform/app_version already on this table) rather than per-user, since
-- language is an app/device setting, not an account-wide preference synced
-- across devices. Defaults to 'en' so existing rows and any caller that
-- doesn't yet send it degrade to the current English-only behavior.
ALTER TABLE v3_devices ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'en';
