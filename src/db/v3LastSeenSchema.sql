-- Previously created directly in the DB with no schema file; documented here now.
-- Already keyed by UNIQUE(device_id, product_id), so this table was guest-ready
-- by construction — it only needed user_id made nullable.
CREATE TABLE IF NOT EXISTS v3_last_seen (
  id         SERIAL PRIMARY KEY,
  device_id  VARCHAR(255) NOT NULL REFERENCES v3_devices(device_id) ON DELETE CASCADE,
  user_id    INT REFERENCES v3_users(user_id) ON DELETE CASCADE,   -- nullable for guests
  product_id INT NOT NULL,
  seen_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE (device_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_v3_last_seen_device_id ON v3_last_seen(device_id);
CREATE INDEX IF NOT EXISTS idx_v3_last_seen_user_id ON v3_last_seen(user_id);
CREATE INDEX IF NOT EXISTS idx_v3_last_seen_seen_at ON v3_last_seen(seen_at);
