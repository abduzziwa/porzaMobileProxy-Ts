import type { Request, Response } from "express";
import { getVariable } from "../scrapers/homeScraper.js";
import dotenv from "dotenv";
dotenv.config();

export async function getProductsDetails(req: Request, res: Response): Promise<Response> {
  try {
    const origin = process.env.END_POINT!;
    const { uniqueDeviceId, cartId, phpsessid, url } = req.body as Record<string, string>;
    if (!uniqueDeviceId || !cartId || !phpsessid) return res.status(400).json({ error: "Missing required fields" });
    const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;
    const urlEndPoint = `${origin}${url}`;
    const Products = await getVariable(urlEndPoint, cartId, cookie, "", "product", true);
    return res.status(200).json({ success: true, data: Products });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message });
  }
}
