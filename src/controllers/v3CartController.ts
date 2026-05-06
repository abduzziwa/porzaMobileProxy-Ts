import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";

export async function addToCart(req: Request, res: Response): Promise<Response> {
  const { user_id, product_id, quantity = 1 } = req.body as { user_id?: number; product_id?: number; quantity?: number };

  if (!user_id || !product_id) return res.status(400).json({ success: false, error: "Missing user_id or product_id" });

  const qty = Math.max(1, Number(quantity));

  try {
    const result = await v3Pool.query(
      `INSERT INTO v3_cart (user_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET quantity = v3_cart.quantity + EXCLUDED.quantity,
                     updated_at = NOW()
       RETURNING product_id, quantity`,
      [user_id, product_id, qty]
    );
    return res.json({ success: true, cart_item: result.rows[0] });
  } catch (err) {
    console.error("[addToCart] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function removeFromCart(req: Request, res: Response): Promise<Response> {
  const { user_id, product_id } = req.body as { user_id?: number; product_id?: number };

  if (!user_id || !product_id) return res.status(400).json({ success: false, error: "Missing user_id or product_id" });

  try {
    await v3Pool.query(`DELETE FROM v3_cart WHERE user_id = $1 AND product_id = $2`, [user_id, product_id]);
    return res.json({ success: true });
  } catch (err) {
    console.error("[removeFromCart] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function updateCart(req: Request, res: Response): Promise<Response> {
  const { user_id, product_id, quantity } = req.body as { user_id?: number; product_id?: number; quantity?: number };

  if (!user_id || !product_id || quantity === undefined) {
    return res.status(400).json({ success: false, error: "Missing user_id, product_id or quantity" });
  }

  try {
    if (Number(quantity) <= 0) {
      await v3Pool.query(`DELETE FROM v3_cart WHERE user_id = $1 AND product_id = $2`, [user_id, product_id]);
      return res.json({ success: true, cart_item: null });
    }

    const result = await v3Pool.query(
      `UPDATE v3_cart SET quantity = $3, updated_at = NOW()
       WHERE user_id = $1 AND product_id = $2
       RETURNING product_id, quantity`,
      [user_id, product_id, Number(quantity)]
    );
    return res.json({ success: true, cart_item: result.rows[0] ?? null });
  } catch (err) {
    console.error("[updateCart] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function getCart(req: Request, res: Response): Promise<Response> {
  const { user_id } = req.body as { user_id?: number };

  if (!user_id) return res.status(400).json({ success: false, error: "Missing user_id" });

  try {
    const result = await v3Pool.query(
      `SELECT product_id, quantity, added_at, updated_at
       FROM v3_cart WHERE user_id = $1 ORDER BY updated_at DESC`,
      [user_id]
    );
    const total_quantity = result.rows.reduce(
      (sum: number, row: { quantity: unknown }) => sum + Number(row.quantity),
      0
    );
    return res.json({
      success: true,
      items: result.rows,
      total_items: result.rowCount ?? 0,
      total_quantity,
    });
  } catch (err) {
    console.error("[getCart] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function clearCart(req: Request, res: Response): Promise<Response> {
  const { user_id } = req.body as { user_id?: number };

  if (!user_id) return res.status(400).json({ success: false, error: "Missing user_id" });

  try {
    await v3Pool.query(`DELETE FROM v3_cart WHERE user_id = $1`, [user_id]);
    return res.json({ success: true });
  } catch (err) {
    console.error("[clearCart] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}
