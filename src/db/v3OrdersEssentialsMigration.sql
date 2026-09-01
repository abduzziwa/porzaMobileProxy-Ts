-- v3 orders: essentials-only columns for the new Carts/Orders checkout flow.
-- Deliberately NOT storing a subtotal/shipping/vat breakdown or full product
-- snapshots — Corenio owns that detail now. This is only what's needed to
-- know which orders passed through this proxy and how much revenue they
-- represent (id, user, product_ids+quantity, amount). Idempotent.

ALTER TABLE v3_orders ADD COLUMN IF NOT EXISTS corenio_cart_id BIGINT;
ALTER TABLE v3_orders ADD COLUMN IF NOT EXISTS currency        VARCHAR(3);
ALTER TABLE v3_orders ADD COLUMN IF NOT EXISTS total_amount    NUMERIC(10,2);
