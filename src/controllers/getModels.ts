import type { Request, Response } from "express";
import { getApi } from "../scrapers/homeScraper.js";
import dotenv from "dotenv";
dotenv.config();

export async function getModels(req: Request, res: Response): Promise<Response> {
  try {
    const origin = process.env.END_POINT!;
    const { phpsessid, cartId, uniqueDeviceId, resource } = req.body as Record<string, string>;
    if (!cartId) return res.status(400).json({ success: false, error: "Missing cartId" });
    if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    if (!resource) return res.status(400).json({ success: false, error: "Missing resource" });
    if (!phpsessid) return res.status(400).json({ success: false, error: "Missing phpsessid" });
    const url = `${origin}/api/mod/ecommerce/cars/getModels`;
    const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;
    const result = await getApi(url, cartId, uniqueDeviceId, cookie, resource) as Record<string, unknown>;
    let data: unknown = result.content;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}
