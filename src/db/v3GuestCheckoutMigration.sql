-- Guest checkout migration — run this once against the existing production database.
-- Safe to re-run (every statement is idempotent).
--
-- Context: v3_cart and v3_liked_products were created directly in the DB with no
-- schema file (see v3CartSchema.sql / v3LikedSchema.sql for their documented shape
-- going forward). This migration brings the *existing* tables in line with that shape.

-- ── v3_orders: allow guest orders (user_id nullable, device_id already present) ──
ALTER TABLE v3_orders ALTER COLUMN user_id DROP NOT NULL;

-- ── v3_last_seen: allow guest last-seen (already keyed by UNIQUE(device_id, product_id),
-- so this table only ever needed the NOT NULL dropped — no index changes required) ──
ALTER TABLE v3_last_seen ALTER COLUMN user_id DROP NOT NULL;

-- ── v3_device_vehicles: allow guest vehicle selection ──
ALTER TABLE v3_device_vehicles ALTER COLUMN user_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_device_vehicles_guest ON v3_device_vehicles(device_id) WHERE user_id IS NULL;

-- ── v3_cart: add device_id, allow guest rows ──
ALTER TABLE v3_cart ADD COLUMN IF NOT EXISTS device_id VARCHAR REFERENCES v3_devices(device_id);
ALTER TABLE v3_cart ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'v3_cart' AND con.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE v3_cart DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_cart_user_product   ON v3_cart(user_id, product_id)   WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_cart_device_product ON v3_cart(device_id, product_id) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_v3_cart_device_id ON v3_cart(device_id);

-- ── v3_liked_products: add device_id, allow guest rows ──
ALTER TABLE v3_liked_products ADD COLUMN IF NOT EXISTS device_id VARCHAR REFERENCES v3_devices(device_id);
ALTER TABLE v3_liked_products ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'v3_liked_products' AND con.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE v3_liked_products DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_liked_user_product   ON v3_liked_products(user_id, product_id)   WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_liked_device_product ON v3_liked_products(device_id, product_id) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_v3_liked_device_id ON v3_liked_products(device_id);

-- Note: pre-existing v3_cart / v3_liked_products rows keep device_id = NULL. That's fine —
-- they were all account-owned (user_id NOT NULL was enforced until now) and account
-- queries never filter by device_id, only guest queries do.
