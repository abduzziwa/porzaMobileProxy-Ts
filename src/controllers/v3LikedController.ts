import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";

export async function toggleLiked(req: Request, res: Response): Promise<Response> {
  const { user_id, product_id } = req.body as { user_id?: number; product_id?: number };

  if (!user_id || !product_id) return res.status(400).json({ success: false, error: "Missing user_id or product_id" });

  try {
    const existing = await v3Pool.query(
      `SELECT id FROM v3_liked_products WHERE user_id = $1 AND product_id = $2`,
      [user_id, product_id]
    );

    if ((existing.rowCount ?? 0) > 0) {
      await v3Pool.query(`DELETE FROM v3_liked_products WHERE user_id = $1 AND product_id = $2`, [user_id, product_id]);
      return res.json({ success: true, liked: false });
    } else {
      await v3Pool.query(`INSERT INTO v3_liked_products (user_id, product_id) VALUES ($1, $2)`, [user_id, product_id]);
      return res.json({ success: true, liked: true });
    }
  } catch (err) {
    console.error("[toggleLiked] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function getLiked(req: Request, res: Response): Promise<Response> {
  const { user_id } = req.body as { user_id?: number };

  if (!user_id) return res.status(400).json({ success: false, error: "Missing user_id" });

  try {
    const result = await v3Pool.query(
      `SELECT product_id, added_at FROM v3_liked_products WHERE user_id = $1 ORDER BY added_at DESC`,
      [user_id]
    );
    return res.json({
      success: true,
      product_ids: result.rows.map((r: { product_id: number }) => r.product_id),
      total: result.rowCount ?? 0,
    });
  } catch (err) {
    console.error("[getLiked] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function checkLiked(req: Request, res: Response): Promise<Response> {
  const { user_id, product_ids } = req.body as { user_id?: number; product_ids?: number[] };

  if (!user_id || !Array.isArray(product_ids) || product_ids.length === 0) {
    return res.status(400).json({ success: false, error: "Missing user_id or product_ids" });
  }

  try {
    const result = await v3Pool.query(
      `SELECT product_id FROM v3_liked_products WHERE user_id = $1 AND product_id = ANY($2)`,
      [user_id, product_ids]
    );
    return res.json({
      success: true,
      liked_ids: result.rows.map((r: { product_id: number }) => r.product_id),
    });
  } catch (err) {
    console.error("[checkLiked] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}
