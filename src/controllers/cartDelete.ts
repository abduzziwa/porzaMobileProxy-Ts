import type { Request, Response } from "express";
import { getApi } from "../scrapers/homeScraper.js";
import dotenv from "dotenv";
dotenv.config();

export async function cartDelete(req: Request, res: Response): Promise<Response> {
  try {
    const origin = process.env.END_POINT!;
    const { phpsessid, cartId, uniqueDeviceId, itemId, action } = req.body as Record<string, string>;
    if (!cartId) return res.status(400).json({ success: false, error: "Missing cartId" });
    if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    if (!action) return res.status(400).json({ success: false, error: "Missing action" });
    if (!phpsessid) return res.status(400).json({ success: false, error: "Missing phpsessid" });
    const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;
    const url = `${origin}/api/mod/ecommerce/order/${action}`;
    const resource = action === "removeAll" ? "" : itemId;
    let data: unknown = await getApi(url, cartId, uniqueDeviceId, cookie, resource);
    if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}
