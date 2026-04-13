import type { Request, Response } from "express";
import pgClient from "../services/db.js";

// ── Add favourite ─────────────────────────────────────────────
export async function addFavourite(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, productId } = req.body as { uniqueDeviceId?: string; productId?: string };
    if (!uniqueDeviceId || !productId) {
      return res.status(400).json({ success: false, error: "Missing uniqueDeviceId or productId" });
    }

    await pgClient.query(
      `UPDATE app_user_state
       SET favorite_product_ids = (
         CASE
           WHEN COALESCE(favorite_product_ids, '[]'::jsonb) @> $2::jsonb
           THEN COALESCE(favorite_product_ids, '[]'::jsonb)
           ELSE COALESCE(favorite_product_ids, '[]'::jsonb) || $2::jsonb
         END
       ),
       last_updated_at = NOW()
       WHERE unique_device_id = $1`,
      [uniqueDeviceId, JSON.stringify([String(productId)])]
    );

    const result = await pgClient.query<{ favorite_product_ids: string[] }>(
      `SELECT favorite_product_ids FROM app_user_state WHERE unique_device_id = $1`,
      [uniqueDeviceId]
    );

    const ids = result.rows[0]?.favorite_product_ids ?? [];
    console.log(`[Favourites] Added ${productId} for ${uniqueDeviceId} — total: ${ids.length}`);
    return res.status(200).json({ success: true, action: "added", productId, favorite_product_ids: ids });
  } catch (err) {
    console.error("[Favourites] addFavourite error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ── Remove favourite ──────────────────────────────────────────
export async function removeFavourite(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, productId } = req.body as { uniqueDeviceId?: string; productId?: string };
    if (!uniqueDeviceId || !productId) {
      return res.status(400).json({ success: false, error: "Missing uniqueDeviceId or productId" });
    }

    await pgClient.query(
      `UPDATE app_user_state
       SET favorite_product_ids = COALESCE(
         (SELECT jsonb_agg(elem)
          FROM jsonb_array_elements_text(COALESCE(favorite_product_ids, '[]'::jsonb)) AS elem
          WHERE elem <> $2),
         '[]'::jsonb
       ),
       last_updated_at = NOW()
       WHERE unique_device_id = $1`,
      [uniqueDeviceId, String(productId)]
    );

    const result = await pgClient.query<{ favorite_product_ids: string[] }>(
      `SELECT favorite_product_ids FROM app_user_state WHERE unique_device_id = $1`,
      [uniqueDeviceId]
    );

    const ids = result.rows[0]?.favorite_product_ids ?? [];
    console.log(`[Favourites] Removed ${productId} for ${uniqueDeviceId} — total: ${ids.length}`);
    return res.status(200).json({ success: true, action: "removed", productId, favorite_product_ids: ids });
  } catch (err) {
    console.error("[Favourites] removeFavourite error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ── Get favourites ────────────────────────────────────────────
export async function getFavourites(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId } = req.body as { uniqueDeviceId?: string };
    if (!uniqueDeviceId) {
      return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    }

    const result = await pgClient.query<{ favorite_product_ids: string[] }>(
      `SELECT COALESCE(favorite_product_ids, '[]'::jsonb) AS favorite_product_ids
       FROM app_user_state
       WHERE unique_device_id = $1`,
      [uniqueDeviceId]
    );

    const ids = result.rows[0]?.favorite_product_ids ?? [];
    return res.status(200).json({ success: true, favorite_product_ids: ids, count: ids.length });
  } catch (err) {
    console.error("[Favourites] getFavourites error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ── Check if product is favourite ─────────────────────────────
export async function checkFavourite(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, productId } = req.body as { uniqueDeviceId?: string; productId?: string };
    if (!uniqueDeviceId || !productId) {
      return res.status(400).json({ success: false, error: "Missing uniqueDeviceId or productId" });
    }

    const result = await pgClient.query<{ is_favourite: boolean }>(
      `SELECT favorite_product_ids @> $2::jsonb AS is_favourite
       FROM app_user_state
       WHERE unique_device_id = $1`,
      [uniqueDeviceId, JSON.stringify([String(productId)])]
    );

    const isFavourite = result.rows[0]?.is_favourite ?? false;
    return res.status(200).json({ success: true, productId, is_favourite: isFavourite });
  } catch (err) {
    console.error("[Favourites] checkFavourite error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}