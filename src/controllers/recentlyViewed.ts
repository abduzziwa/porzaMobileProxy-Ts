import type { Request, Response } from "express";
import pgClient from "../services/db.js";

// ── Add to recently viewed (max 20, FIFO) ────────────────────
export async function addRecentlyViewed(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, productId } = req.body as { uniqueDeviceId?: string; productId?: string };

    if (!uniqueDeviceId || !productId) {
      return res.status(400).json({ success: false, error: "Missing uniqueDeviceId or productId" });
    }

    const pid = String(productId);

    // 1. Remove existing occurrence of this product (avoid duplicates)
    // 2. Prepend to front (most recent first)
    // 3. Trim to 20 items
    await pgClient.query(
      `UPDATE app_user_state
       SET recently_viewed_ids = (
         SELECT jsonb_agg(elem)
         FROM (
           SELECT elem
           FROM jsonb_array_elements_text(
             -- Remove existing occurrence then prepend new one
             ($2::jsonb) || (
               SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
               FROM jsonb_array_elements_text(COALESCE(recently_viewed_ids, '[]'::jsonb)) AS e
               WHERE e <> $3
             )
           ) WITH ORDINALITY AS t(elem, ord)
           ORDER BY ord
           LIMIT 20
         ) sub
       ),
       last_updated_at = NOW()
       WHERE unique_device_id = $1`,
      [uniqueDeviceId, JSON.stringify([pid]), pid]
    );

    return res.status(200).json({ success: true, productId: pid });
  } catch (err) {
    console.error("[RecentlyViewed] addRecentlyViewed error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ── Get recently viewed ids ───────────────────────────────────
export async function getRecentlyViewed(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId } = req.body as { uniqueDeviceId?: string };

    if (!uniqueDeviceId) {
      return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    }

    const result = await pgClient.query<{ recently_viewed_ids: string[] }>(
      `SELECT COALESCE(recently_viewed_ids, '[]'::jsonb) AS recently_viewed_ids
       FROM app_user_state
       WHERE unique_device_id = $1`,
      [uniqueDeviceId]
    );

    const ids = result.rows[0]?.recently_viewed_ids ?? [];
    return res.status(200).json({ success: true, recently_viewed_ids: ids, count: ids.length });
  } catch (err) {
    console.error("[RecentlyViewed] getRecentlyViewed error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}