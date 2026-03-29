import type { Request, Response } from "express";
import { postApi } from "../scrapers/homeScraper.js";
import dotenv from "dotenv";
dotenv.config();

export async function setCar(req: Request, res: Response): Promise<Response> {
  try {
    const origin = process.env.END_POINT!;
    const { phpsessid, cartId, uniqueDeviceId, resource } = req.body as Record<
      string,
      string
    >;
    if (!cartId)
      return res.status(400).json({ success: false, error: "Missing cartId" });
    if (!uniqueDeviceId)
      return res
        .status(400)
        .json({ success: false, error: "Missing uniqueDeviceId" });
    if (!phpsessid)
      return res
        .status(400)
        .json({ success: false, error: "Missing phpsessid" });
    const url = `${origin}/api/mod/ecommerce/cars/setCar/${resource}`;
    const data = await postApi(url, cartId, phpsessid);
    return res
      .status(200)
      .json({ success: true, cartId, uniqueDeviceId, resource, data });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
}
