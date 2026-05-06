import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";

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

    return res.json({ success: true });
  } catch (err) {
    console.error("[addLastSeen] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function getLastSeen(req: Request, res: Response): Promise<Response> {
  const { device_id, limit = 20 } = req.body as { device_id?: string; limit?: number };

  if (!device_id) return res.status(400).json({ success: false, error: "Missing device_id" });

  const safeLimit = Math.min(Math.max(1, Number(limit)), 50);

  try {
    const result = await v3Pool.query(
      `SELECT product_id, seen_at FROM v3_last_seen
       WHERE device_id = $1
       ORDER BY seen_at DESC
       LIMIT $2`,
      [device_id, safeLimit]
    );
    return res.json({
      success: true,
      product_ids: result.rows.map((r: { product_id: number }) => r.product_id),
      total: result.rowCount ?? 0,
    });
  } catch (err) {
    console.error("[getLastSeen] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}
