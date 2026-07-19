-- Previously created directly in the DB with no schema file; documented here now
-- as part of adding guest (device-scoped) cart support.
CREATE TABLE IF NOT EXISTS v3_cart (
  id         SERIAL PRIMARY KEY,
  device_id  VARCHAR REFERENCES v3_devices(device_id),
  user_id    INT REFERENCES v3_users(user_id),   -- NULL for guest rows, scoped by device_id instead
  product_id INT NOT NULL,
  quantity   INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Two partial unique indexes instead of one UNIQUE(user_id, product_id):
-- Postgres treats NULL <> NULL, so a plain unique constraint on (user_id, product_id)
-- would never dedupe guest rows across devices anyway — split by identity kind instead.
CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_cart_user_product   ON v3_cart(user_id, product_id)   WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_cart_device_product ON v3_cart(device_id, product_id) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_v3_cart_device_id ON v3_cart(device_id);
