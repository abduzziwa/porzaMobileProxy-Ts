import type { Request, Response } from "express";
import { getVariable } from "../scrapers/homeScraper.js";

export async function getCart(req: Request, res: Response): Promise<Response> {
  try {
    console.log("[API] Cart Called");
    const { cartId, phpsessid } = req.body as Record<string, string>;
    if (!cartId || !phpsessid) {
      return res.status(400).json({ success: false, error: "Missing required fields", required: ["cartId", "phpsessid"] });
    }
    const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;
    const url = `${process.env.END_POINT}/mijn-wagen?jsonAbdul=1`;
    const cart = await getVariable(url, cartId, cookie, "", "cart", false, 10000);
    return res.status(200).json({ success: true, data: cart });
  } catch (error) {
    console.error("[API][getCart] Error:", (error instanceof Error ? error.message : String(error)));
    return res.status(500).json({ success: false, error: "Internal server error", message: (error as Error).message });
  }
}
