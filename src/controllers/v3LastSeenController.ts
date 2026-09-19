import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";
import { fetchProductsData } from "../services/v3CoreniService.js";
import { transformProduct } from "./v3ProductsController.js";
import redis from "../services/v3RedisService.js";

export async function addLastSeen(req: Request, res: Response): Promise<Response> {
  const { device_id, user_id, product_id } = req.body as { device_id?: string; user_id?: number; product_id?: number };

  if (!device_id || !product_id) return res.status(400).json({ success: false, error: "Missing device_id or product_id" });

  try {
    await v3Pool.query(
      `INSERT INTO v3_last_seen (device_id, user_id, product_id, seen_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (device_id, product_id)
       DO UPDATE SET seen_at = NOW(), user_id = EXCLUDED.user_id`,
      [device_id, user_id ?? null, product_id]
    );

    // Enforce 50-item limit per device
    await v3Pool.query(
      `DELETE FROM v3_last_seen
       WHERE device_id = $1
       AND id NOT IN (
         SELECT id FROM v3_last_seen
         WHERE device_id = $1
         ORDER BY seen_at DESC
         LIMIT 50
       )`,
      [device_id]
    );

    try {
      const keys = await redis.keys(`v3cache:${device_id}:/v3/last-seen/get:*`);
      if (keys.length) await redis.del(...keys);
    } catch (err) {
      console.error("[addLastSeen] Cache invalidation error (non-fatal):", err instanceof Error ? err.message : String(err));
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[addLastSeen] Error:", (err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function getLastSeen(req: Request, res: Response): Promise<Response> {
  const { device_id, limit = 20, language = "en" } = req.body as { device_id?: string; limit?: number; language?: string };

  if (!device_id) return res.status(400).json({ success: false, error: "Missing device_id" });

  const safeLimit = Math.min(Math.max(1, Number(limit)), 50);

  try {
    const result = await v3Pool.query(
      `SELECT product_id FROM v3_last_seen
       WHERE device_id = $1
       ORDER BY seen_at DESC
       LIMIT $2`,
      [device_id, safeLimit]
    );

    if (!result.rows.length) {
      return res.json({ success: true, products: [], total: 0 });
    }

    const product_ids = result.rows.map((r: { product_id: number }) => r.product_id);
    const { user_id } = req.body as { user_id?: number };
    const [raw, likedResult] = await Promise.all([
      fetchProductsData(product_ids, language, req.corenioToken),
      user_id
        ? v3Pool.query(`SELECT product_id FROM v3_liked_products WHERE user_id = $1 AND product_id = ANY($2)`, [user_id, product_ids])
        : Promise.resolve({ rows: [] as { product_id: number }[] }),
    ]);
    const likedIds = new Set(likedResult.rows.map((r: { product_id: number }) => r.product_id));
    const products = raw.map((p) => transformProduct(p, likedIds));

    return res.json({ success: true, products, total: products.length });
  } catch (err) {
    console.error("[getLastSeen] Error:", (err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}
