-- v3 cart write-through cache: mirrors Corenio's real Carts API instead of
-- being the source of truth. Corenio is always written first; these columns
-- are only ever updated after Corenio confirms success. Idempotent.

-- Per-item Corenio identifiers, so update/remove can target the right
-- Corenio cart item without re-deriving it.
ALTER TABLE v3_cart ADD COLUMN IF NOT EXISTS corenio_cart_id BIGINT;
ALTER TABLE v3_cart ADD COLUMN IF NOT EXISTS corenio_item_id BIGINT;

-- Persistent pointer to a shopper's active Corenio cart, stored independently
-- of item rows so it survives the cart being emptied down to zero items
-- (which would otherwise lose the pointer and force a fresh cart on every
-- next add). One row per guest device, one row per account — same identity
-- split v3_cart itself already uses. Retired (row deleted) on successful
-- order finalize and on explicit cart clear.
CREATE TABLE IF NOT EXISTS v3_cart_sessions (
  id               SERIAL PRIMARY KEY,
  device_id        VARCHAR(255) NOT NULL REFERENCES v3_devices(device_id) ON DELETE CASCADE,
  user_id          INTEGER NULL REFERENCES v3_users(user_id) ON DELETE CASCADE,
  corenio_cart_id  BIGINT NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_cart_sessions_guest
  ON v3_cart_sessions (device_id) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_cart_sessions_account
  ON v3_cart_sessions (user_id) WHERE user_id IS NOT NULL;
