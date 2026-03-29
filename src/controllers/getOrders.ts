import type { Request, Response } from "express";
import { getVariable } from "../scrapers/homeScraper.js";

export async function getOrders(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid } = req.body as Record<string, string>;
    if (!uniqueDeviceId || !cartId || !phpsessid) return res.status(400).json({ error: "Missing required fields" });
    const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;
    const url = `${process.env.END_POINT}/mijn-rekening/orders`;
    const orders = await getVariable(url, cartId, cookie, "", "orders", true);
    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message });
  }
}
