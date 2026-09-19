import type { Request, Response } from "express";
import "../types.js"; // side-effect only — registers the req.corenioToken Express augmentation
import v3Pool from "../db/v3Client.js";
import {
  fetchProductsData,
  corenioCartAddItem,
  corenioCartUpdateItem,
  corenioCartRemoveItems,
  corenioCartDelete,
} from "../services/v3CoreniService.js";
import {
  type ShopperIdentity,
  getStoredCorenioCartId,
  ensureCorenioCartId,
  retireCorenioCartId,
} from "../services/v3CartSessionService.js";
import { transformProduct } from "./v3ProductsController.js";

// ─── Write-through cache helpers ──────────────────────────────────────────
// Corenio is always written to first; v3_cart / v3_cart_sessions are only
// ever updated after Corenio confirms success — they mirror confirmed
// Corenio state, they are never the source of truth for it.

interface CachedCartRow {
  quantity: number;
  corenioItemId: number | null;
}

// Single lookup used everywhere a caller needs to know both "is this product
// already a real Corenio cart item" and "what does our cache currently think
// the quantity is" — kept as one query so the two never drift relative to
// each other within a request (e.g. a merged-but-unreconciled row: a real
// quantity from a guest->account merge, but corenio_item_id still NULL since
// that quantity was never actually pushed to the account's Corenio cart).
async function getCachedCartRow(shopper: ShopperIdentity, productId: number): Promise<CachedCartRow | null> {
  const result = shopper.userId != null
    ? await v3Pool.query<{ quantity: number; corenio_item_id: string | null }>(
        `SELECT quantity, corenio_item_id FROM v3_cart WHERE user_id = $1 AND product_id = $2`,
        [shopper.userId, productId]
      )
    : await v3Pool.query<{ quantity: number; corenio_item_id: string | null }>(
        `SELECT quantity, corenio_item_id FROM v3_cart WHERE device_id = $1 AND product_id = $2 AND user_id IS NULL`,
        [shopper.deviceId, productId]
      );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  return { quantity: Number(row.quantity), corenioItemId: row.corenio_item_id != null ? Number(row.corenio_item_id) : null };
}

async function upsertCacheRow(
  shopper: ShopperIdentity,
  productId: number,
  quantity: number,
  corenioCartId: number,
  corenioItemId: number
): Promise<{ product_id: number; quantity: number }> {
  const result = shopper.userId != null
    ? await v3Pool.query<{ product_id: number; quantity: number }>(
        `INSERT INTO v3_cart (device_id, user_id, product_id, quantity, corenio_cart_id, corenio_item_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, product_id) WHERE user_id IS NOT NULL
         DO UPDATE SET quantity = EXCLUDED.quantity, corenio_cart_id = EXCLUDED.corenio_cart_id,
                       corenio_item_id = EXCLUDED.corenio_item_id, updated_at = NOW(), device_id = EXCLUDED.device_id
         RETURNING product_id, quantity`,
        [shopper.deviceId, shopper.userId, productId, quantity, corenioCartId, corenioItemId]
      )
    : await v3Pool.query<{ product_id: number; quantity: number }>(
        `INSERT INTO v3_cart (device_id, user_id, product_id, quantity, corenio_cart_id, corenio_item_id)
         VALUES ($1, NULL, $2, $3, $4, $5)
         ON CONFLICT (device_id, product_id) WHERE user_id IS NULL
         DO UPDATE SET quantity = EXCLUDED.quantity, corenio_cart_id = EXCLUDED.corenio_cart_id,
                       corenio_item_id = EXCLUDED.corenio_item_id, updated_at = NOW()
         RETURNING product_id, quantity`,
        [shopper.deviceId, productId, quantity, corenioCartId, corenioItemId]
      );
  return result.rows[0];
}

async function deleteCacheRow(shopper: ShopperIdentity, productId: number): Promise<void> {
  if (shopper.userId != null) {
    await v3Pool.query(`DELETE FROM v3_cart WHERE user_id = $1 AND product_id = $2`, [shopper.userId, productId]);
  } else {
    await v3Pool.query(
      `DELETE FROM v3_cart WHERE device_id = $1 AND product_id = $2 AND user_id IS NULL`,
      [shopper.deviceId, productId]
    );
  }
}

// ─── Endpoints (request/response contracts unchanged) ────────────────────

export async function addToCart(req: Request, res: Response): Promise<Response> {
  const { user_id = null, device_id, product_id, quantity = 1 } = req.body as {
    user_id?: number | null;
    device_id?: string;
    product_id?: number;
    quantity?: number;
  };

  if (!device_id || !product_id) return res.status(400).json({ success: false, error: "Missing device_id or product_id" });

  const qty = Math.max(1, Number(quantity));
  const shopper: ShopperIdentity = { deviceId: device_id, userId: user_id };

  try {
    const cartId = await ensureCorenioCartId(shopper, req.corenioToken);
    const cached = await getCachedCartRow(shopper, product_id);
    const newQuantity = (cached?.quantity ?? 0) + qty;

    let corenioItemId: number;
    if (cached?.corenioItemId != null) {
      // Already a real Corenio cart item — PATCH sets the absolute quantity.
      await corenioCartUpdateItem(cartId, cached.corenioItemId, newQuantity, req.corenioToken);
      corenioItemId = cached.corenioItemId;
    } else {
      // No Corenio item yet — either a genuinely new product, or a cache row
      // that exists locally (e.g. from a guest->account merge) but was never
      // pushed to Corenio. Either way, POST the FULL quantity that should
      // exist, not just this tap's increment, so the two never diverge.
      const added = await corenioCartAddItem(cartId, { product_id, quantity: newQuantity }, req.corenioToken);
      corenioItemId = added.item_id;
    }

    console.log(`[CORENIO_API -> DATABASE] cart/add: Corenio confirmed item ${corenioItemId} (qty ${newQuantity}) — writing to v3_cart`);
    const cacheRow = await upsertCacheRow(shopper, product_id, newQuantity, cartId, corenioItemId);
    return res.json({ success: true, cart_item: cacheRow });
  } catch (err) {
    console.error("[addToCart] Error:", (err as Error).message);
    return res.status(502).json({ success: false, error: "Could not update cart" });
  }
}

export async function removeFromCart(req: Request, res: Response): Promise<Response> {
  const { user_id = null, device_id, product_id } = req.body as {
    user_id?: number | null;
    device_id?: string;
    product_id?: number;
  };

  if (!device_id || !product_id) return res.status(400).json({ success: false, error: "Missing device_id or product_id" });

  const shopper: ShopperIdentity = { deviceId: device_id, userId: user_id };

  try {
    const cartId = await getStoredCorenioCartId(shopper);
    const cached = await getCachedCartRow(shopper, product_id);

    if (cartId !== null && cached?.corenioItemId != null) {
      await corenioCartRemoveItems(cartId, [cached.corenioItemId], req.corenioToken);
      console.log(`[CORENIO_API -> DATABASE] cart/remove: Corenio confirmed removal of item ${cached.corenioItemId} — deleting from v3_cart`);
    }
    // Either nothing stored on either side, or a cache row that was never
    // pushed to Corenio (unreconciled merge) — either way there is nothing
    // to remove on Corenio's side, so this stays a no-op there.

    await deleteCacheRow(shopper, product_id);
    return res.json({ success: true });
  } catch (err) {
    console.error("[removeFromCart] Error:", (err as Error).message);
    return res.status(502).json({ success: false, error: "Could not update cart" });
  }
}

export async function updateCart(req: Request, res: Response): Promise<Response> {
  const { user_id = null, device_id, product_id, quantity } = req.body as {
    user_id?: number | null;
    device_id?: string;
    product_id?: number;
    quantity?: number;
  };

  if (!device_id || !product_id || quantity === undefined) {
    return res.status(400).json({ success: false, error: "Missing device_id, product_id or quantity" });
  }

  const shopper: ShopperIdentity = { deviceId: device_id, userId: user_id };

  try {
    const cached = await getCachedCartRow(shopper, product_id);

    if (Number(quantity) <= 0) {
      const cartId = await getStoredCorenioCartId(shopper);
      if (cartId !== null && cached?.corenioItemId != null) {
        await corenioCartRemoveItems(cartId, [cached.corenioItemId], req.corenioToken);
        console.log(`[CORENIO_API -> DATABASE] cart/update (qty<=0): Corenio confirmed removal of item ${cached.corenioItemId} — deleting from v3_cart`);
      }
      await deleteCacheRow(shopper, product_id);
      return res.json({ success: true, cart_item: null });
    }

    if (!cached) {
      // Nothing to update — same "not in cart" outcome the old implementation
      // returned via UPDATE affecting zero rows.
      return res.json({ success: true, cart_item: null });
    }

    const cartId = await ensureCorenioCartId(shopper, req.corenioToken);
    let corenioItemId: number;

    if (cached.corenioItemId != null) {
      await corenioCartUpdateItem(cartId, cached.corenioItemId, Number(quantity), req.corenioToken);
      corenioItemId = cached.corenioItemId;
    } else {
      // Cache row exists but was never pushed to Corenio (unreconciled
      // merge) — POST it fresh at the requested quantity.
      const added = await corenioCartAddItem(cartId, { product_id, quantity: Number(quantity) }, req.corenioToken);
      corenioItemId = added.item_id;
    }

    console.log(`[CORENIO_API -> DATABASE] cart/update: Corenio confirmed item ${corenioItemId} (qty ${quantity}) — writing to v3_cart`);
    const cacheRow = await upsertCacheRow(shopper, product_id, Number(quantity), cartId, corenioItemId);
    return res.json({ success: true, cart_item: cacheRow });
  } catch (err) {
    console.error("[updateCart] Error:", (err as Error).message);
    return res.status(502).json({ success: false, error: "Could not update cart" });
  }
}

// Reads the local cache only — no Corenio call. This is the entire point of
// the write-through design: browsing/rendering the cart stays instant.
export async function getCart(req: Request, res: Response): Promise<Response> {
  const { user_id = null, device_id, language = "en" } = req.body as {
    user_id?: number | null;
    device_id?: string;
    language?: string;
  };

  if (!device_id) return res.status(400).json({ success: false, error: "Missing device_id" });

  try {
    const result = user_id != null
      ? await v3Pool.query(
          `SELECT product_id, quantity FROM v3_cart WHERE user_id = $1 ORDER BY updated_at DESC`,
          [user_id]
        )
      : await v3Pool.query(
          `SELECT product_id, quantity FROM v3_cart WHERE device_id = $1 AND user_id IS NULL ORDER BY updated_at DESC`,
          [device_id]
        );

    if (!result.rows.length) {
      return res.json({ success: true, items: [], total_items: 0, total_quantity: 0 });
    }

    const quantityMap = new Map<number, number>(
      result.rows.map((r: { product_id: number; quantity: number }) => [r.product_id, Number(r.quantity)])
    );
    const product_ids = result.rows.map((r: { product_id: number }) => r.product_id);

    const [raw, likedResult] = await Promise.all([
      fetchProductsData(product_ids, language, req.corenioToken),
      user_id != null
        ? v3Pool.query(`SELECT product_id FROM v3_liked_products WHERE user_id = $1 AND product_id = ANY($2)`, [user_id, product_ids])
        : v3Pool.query(
            `SELECT product_id FROM v3_liked_products WHERE device_id = $1 AND user_id IS NULL AND product_id = ANY($2)`,
            [device_id, product_ids]
          ),
    ]);
    const likedIds = new Set(likedResult.rows.map((r: { product_id: number }) => r.product_id));
    const items = raw.map((p) => ({
      ...transformProduct(p, likedIds),
      quantity: quantityMap.get(Number(p.product_id)) ?? 1,
    }));

    const total_quantity = items.reduce((sum, item) => sum + item.quantity, 0);

    return res.json({
      success: true,
      items,
      total_items: items.length,
      total_quantity,
    });
  } catch (err) {
    console.error("[getCart] Error:", (err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function clearCart(req: Request, res: Response): Promise<Response> {
  const { user_id = null, device_id } = req.body as { user_id?: number | null; device_id?: string };

  if (!device_id) return res.status(400).json({ success: false, error: "Missing device_id" });

  const shopper: ShopperIdentity = { deviceId: device_id, userId: user_id };

  try {
    const cartId = await getStoredCorenioCartId(shopper);
    if (cartId !== null) {
      await corenioCartDelete(cartId, req.corenioToken);
      console.log(`[CORENIO_API -> DATABASE] cart/clear: Corenio confirmed cart ${cartId} deleted — clearing v3_cart`);
    }

    if (user_id != null) {
      await v3Pool.query(`DELETE FROM v3_cart WHERE user_id = $1`, [user_id]);
    } else {
      await v3Pool.query(`DELETE FROM v3_cart WHERE device_id = $1 AND user_id IS NULL`, [device_id]);
    }
    await retireCorenioCartId(shopper);
    return res.json({ success: true });
  } catch (err) {
    console.error("[clearCart] Error:", (err as Error).message);
    return res.status(502).json({ success: false, error: "Could not clear cart" });
  }
}
