-- Tracks the last resolved payment status (paid/cancelled/expired/failed)
-- we've already pushed a notification for, per order — separate from the
-- existing `status` column (which stores Corenio's raw status text and is
-- used for display, not notification bookkeeping). NULL until the order's
-- payment status is first observed as resolved by any polling/viewing path
-- (payment-status check, order list, order detail). Idempotent: a
-- notification only fires when this differs from the newly observed status,
-- so viewing the same resolved order repeatedly never re-sends the same push.
ALTER TABLE v3_orders ADD COLUMN IF NOT EXISTS last_notified_payment_status VARCHAR;
