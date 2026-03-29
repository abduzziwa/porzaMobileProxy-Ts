import type { Request, Response } from "express";
import { getVariable } from "../scrapers/homeScraper.js";

export async function getBrandsList(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid, url } = req.body as Record<string, string>;
    if (!uniqueDeviceId || !cartId || !phpsessid) return res.status(400).json({ error: "Missing required fields" });
    const cookie = `cartId=${cartId}, eucookie=1, PHPSESSID=${phpsessid}`;
    const brandsList = await getVariable(url, cartId, cookie, "", "brandsList", true, 5000);
    return res.status(200).json({ success: true, data: brandsList });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message });
  }
}
