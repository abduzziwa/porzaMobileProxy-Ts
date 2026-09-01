import v3Pool from "../db/v3Client.js";
import { corenioCartCreate } from "./v3CoreniService.js";

// Shared between v3CartController (browsing) and v3OrdersController (checkout)
// — both need the exact same "does this shopper already have an active
// Corenio cart" concept, backed by v3_cart_sessions.

export interface ShopperIdentity {
  deviceId: string;
  userId: number | null;
}

export async function getStoredCorenioCartId(shopper: ShopperIdentity): Promise<number | null> {
  const result = shopper.userId != null
    ? await v3Pool.query<{ corenio_cart_id: string }>(
        `SELECT corenio_cart_id FROM v3_cart_sessions WHERE user_id = $1`,
        [shopper.userId]
      )
    : await v3Pool.query<{ corenio_cart_id: string }>(
        `SELECT corenio_cart_id FROM v3_cart_sessions WHERE device_id = $1 AND user_id IS NULL`,
        [shopper.deviceId]
      );
  return result.rows.length ? Number(result.rows[0].corenio_cart_id) : null;
}

// Reuses the shopper's existing Corenio cart if one is stored; creates and
// persists a new one otherwise. Concurrent first-adds are guarded by the
// partial unique indexes on v3_cart_sessions — a race just means one caller's
// INSERT loses and re-selects the winner's cart_id instead of duplicating it.
export async function ensureCorenioCartId(shopper: ShopperIdentity, userToken?: string | null): Promise<number> {
  const existing = await getStoredCorenioCartId(shopper);
  if (existing !== null) return existing;

  const { cart_id } = await corenioCartCreate(userToken);

  try {
    await v3Pool.query(
      `INSERT INTO v3_cart_sessions (device_id, user_id, corenio_cart_id)
       VALUES ($1, $2, $3)`,
      [shopper.deviceId, shopper.userId, cart_id]
    );
    return cart_id;
  } catch {
    const winner = await getStoredCorenioCartId(shopper);
    return winner ?? cart_id;
  }
}

// Called once a cart is spent — after a successful finalize, or on an
// explicit cart clear — so the next cart action starts a fresh Corenio cart
// instead of trying to reuse a dead one.
export async function retireCorenioCartId(shopper: ShopperIdentity): Promise<void> {
  if (shopper.userId != null) {
    await v3Pool.query(`DELETE FROM v3_cart_sessions WHERE user_id = $1`, [shopper.userId]);
  } else {
    await v3Pool.query(`DELETE FROM v3_cart_sessions WHERE device_id = $1 AND user_id IS NULL`, [shopper.deviceId]);
  }
}
