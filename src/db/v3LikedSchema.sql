-- Previously created directly in the DB with no schema file; documented here now
-- as part of adding guest (device-scoped) liked-products support.
CREATE TABLE IF NOT EXISTS v3_liked_products (
  id         SERIAL PRIMARY KEY,
  device_id  VARCHAR REFERENCES v3_devices(device_id),
  user_id    INT REFERENCES v3_users(user_id),   -- NULL for guest rows, scoped by device_id instead
  product_id INT NOT NULL,
  added_at   TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_liked_user_product   ON v3_liked_products(user_id, product_id)   WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_liked_device_product ON v3_liked_products(device_id, product_id) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_v3_liked_device_id ON v3_liked_products(device_id);
