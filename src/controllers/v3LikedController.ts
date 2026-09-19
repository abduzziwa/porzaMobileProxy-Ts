import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";
import { fetchProductsData } from "../services/v3CoreniService.js";
import { transformProduct } from "./v3ProductsController.js";
import redis from "../services/v3RedisService.js";

async function invalidateLikedCache(device_id: string): Promise<void> {
  try {
    const keys = await redis.keys(`v3cache:${device_id}:/v3/liked/get:*`);
    if (keys.length) await redis.del(...keys);
  } catch (err) {
    console.error("[invalidateLikedCache] Error (non-fatal):", err instanceof Error ? err.message : String(err));
  }
}

export async function toggleLiked(req: Request, res: Response): Promise<Response> {
  const { user_id = null, device_id, product_id } = req.body as {
    user_id?: number | null;
    device_id?: string;
    product_id?: number;
  };

  if (!device_id || !product_id) return res.status(400).json({ success: false, error: "Missing device_id or product_id" });

  try {
    const existing = user_id != null
      ? await v3Pool.query(`SELECT id FROM v3_liked_products WHERE user_id = $1 AND product_id = $2`, [user_id, product_id])
      : await v3Pool.query(
          `SELECT id FROM v3_liked_products WHERE device_id = $1 AND user_id IS NULL AND product_id = $2`,
          [device_id, product_id]
        );

    if ((existing.rowCount ?? 0) > 0) {
      if (user_id != null) {
        await v3Pool.query(`DELETE FROM v3_liked_products WHERE user_id = $1 AND product_id = $2`, [user_id, product_id]);
      } else {
        await v3Pool.query(
          `DELETE FROM v3_liked_products WHERE device_id = $1 AND user_id IS NULL AND product_id = $2`,
          [device_id, product_id]
        );
      }
      await invalidateLikedCache(device_id);
      return res.json({ success: true, liked: false });
    } else {
      await v3Pool.query(
        `INSERT INTO v3_liked_products (device_id, user_id, product_id) VALUES ($1, $2, $3)`,
        [device_id, user_id, product_id]
      );
      await invalidateLikedCache(device_id);
      return res.json({ success: true, liked: true });
    }
  } catch (err) {
    console.error("[toggleLiked] Error:", (err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function getLiked(req: Request, res: Response): Promise<Response> {
  const { user_id = null, device_id, language = "en" } = req.body as {
    user_id?: number | null;
    device_id?: string;
    language?: string;
  };

  if (!device_id) return res.status(400).json({ success: false, error: "Missing device_id" });

  try {
    const result = user_id != null
      ? await v3Pool.query(`SELECT product_id FROM v3_liked_products WHERE user_id = $1 ORDER BY added_at DESC`, [user_id])
      : await v3Pool.query(
          `SELECT product_id FROM v3_liked_products WHERE device_id = $1 AND user_id IS NULL ORDER BY added_at DESC`,
          [device_id]
        );

    if (!result.rows.length) {
      return res.json({ success: true, products: [], total: 0 });
    }

    const product_ids = result.rows.map((r: { product_id: number }) => r.product_id);
    const likedIds = new Set(product_ids);
    const raw = await fetchProductsData(product_ids, language, req.corenioToken);
    const products = raw.map((p) => transformProduct(p, likedIds));

    return res.json({ success: true, products, total: products.length });
  } catch (err) {
    console.error("[getLiked] Error:", (err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function checkLiked(req: Request, res: Response): Promise<Response> {
  const { user_id = null, device_id, product_ids } = req.body as {
    user_id?: number | null;
    device_id?: string;
    product_ids?: number[];
  };

  if (!device_id || !Array.isArray(product_ids) || product_ids.length === 0) {
    return res.status(400).json({ success: false, error: "Missing device_id or product_ids" });
  }

  try {
    const result = user_id != null
      ? await v3Pool.query(`SELECT product_id FROM v3_liked_products WHERE user_id = $1 AND product_id = ANY($2)`, [user_id, product_ids])
      : await v3Pool.query(
          `SELECT product_id FROM v3_liked_products WHERE device_id = $1 AND user_id IS NULL AND product_id = ANY($2)`,
          [device_id, product_ids]
        );
    return res.json({
      success: true,
      liked_ids: result.rows.map((r: { product_id: number }) => r.product_id),
    });
  } catch (err) {
    console.error("[checkLiked] Error:", (err instanceof Error ? err.message : String(err)));
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}
