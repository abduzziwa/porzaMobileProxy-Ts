import v3Pool from "../db/v3Client.js";
import { corenioCartCreate, corenioCartAddItem } from "./v3CoreniService.js";

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

// Called when Corenio tells us a stored cart_id no longer exists (404) —
// Corenio expires/drops carts server-side after a while. v3_cart (the local
// item list the app's cart page actually reads — it never calls Corenio to
// render) still thinks those items are live, so a bare retire would leave
// the app showing items that quietly can't be checked out. This recreates
// the Corenio cart and re-pushes every locally-known item into it, so the
// app's view of the cart stays true without the shopper re-adding anything.
export async function resyncCorenioCart(shopper: ShopperIdentity, userToken?: string | null): Promise<number> {
  await retireCorenioCartId(shopper);

  const localItems = shopper.userId != null
    ? await v3Pool.query<{ product_id: number; quantity: number }>(
        `SELECT product_id, quantity FROM v3_cart WHERE user_id = $1`,
        [shopper.userId]
      )
    : await v3Pool.query<{ product_id: number; quantity: number }>(
        `SELECT product_id, quantity FROM v3_cart WHERE device_id = $1 AND user_id IS NULL`,
        [shopper.deviceId]
      );

  const { cart_id } = await corenioCartCreate(userToken);
  await v3Pool.query(
    `INSERT INTO v3_cart_sessions (device_id, user_id, corenio_cart_id) VALUES ($1, $2, $3)`,
    [shopper.deviceId, shopper.userId, cart_id]
  );

  for (const row of localItems.rows) {
    try {
      const added = await corenioCartAddItem(
        cart_id,
        { product_id: row.product_id, quantity: Number(row.quantity) },
        userToken
      );
      if (shopper.userId != null) {
        await v3Pool.query(
          `UPDATE v3_cart SET corenio_cart_id = $1, corenio_item_id = $2 WHERE user_id = $3 AND product_id = $4`,
          [cart_id, added.item_id, shopper.userId, row.product_id]
        );
      } else {
        await v3Pool.query(
          `UPDATE v3_cart SET corenio_cart_id = $1, corenio_item_id = $2 WHERE device_id = $3 AND product_id = $4 AND user_id IS NULL`,
          [cart_id, added.item_id, shopper.deviceId, row.product_id]
        );
      }
    } catch (err) {
      // A single product that Corenio now rejects (discontinued, out of
      // stock, etc.) shouldn't sink the whole resync — leave that row's
      // corenio_item_id as-is (stale/null) so it's picked up as
      // "unreconciled" the next time addToCart/updateCart touches it,
      // matching the existing guest->account merge recovery path.
      console.error(`[resyncCorenioCart] Failed to re-push product ${row.product_id} into fresh cart ${cart_id} (non-blocking):`, (err as Error).message);
    }
  }

  return cart_id;
}
