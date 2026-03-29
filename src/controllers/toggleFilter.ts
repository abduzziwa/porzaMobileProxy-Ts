import type { Request, Response } from "express";
import { getApiWithParamsLoginForm } from "../scrapers/homeScraper.js";
import dotenv from "dotenv";
dotenv.config();

export async function toggleFilter(req: Request, res: Response): Promise<Response> {
  try {
    const origin = process.env.END_POINT!;
    const { phpsessid, cartId, uniqueDeviceId, catId, parentProp, prop } = req.body as Record<string, string>;
    if (!cartId) return res.status(400).json({ success: false, error: "Missing cartId" });
    if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    if (!phpsessid) return res.status(400).json({ success: false, error: "Missing phpsessid" });
    if (!catId) return res.status(400).json({ success: false, error: "Missing catId" });
    if (!parentProp) return res.status(400).json({ success: false, error: "Missing parentProp" });
    if (!prop) return res.status(400).json({ success: false, error: "Missing prop" });
    const url = `${origin}/api/mod/ecommerce/categorie/toggleFilter`;
    const resource = { catid: catId, parentprop: parentProp, prop };
    let data: unknown = await getApiWithParamsLoginForm(url, cartId, phpsessid, resource);
    if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }
    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}
