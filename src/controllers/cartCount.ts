import type { Request, Response } from "express";
import pgClient from "../services/db.js";

export async function getCartCount(req: Request, res: Response): Promise<Response> {
  try {
    const { cartId } = req.body as { cartId: string };

    if (!cartId) {
      return res.status(400).json({ success: false, error: "Missing cartId" });
    }

    const result = await pgClient.query<{ total: string }>(
      `SELECT COALESCE(SUM(quantity), 0) AS total
       FROM cart_items
       WHERE cart_id = $1 AND deleted = false`,
      [cartId]
    );

    const count = parseInt(result.rows[0]?.total ?? "0", 10);

    return res.status(200).json({ success: true, count });
  } catch (err) {
    console.error("[CartCount] Error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}