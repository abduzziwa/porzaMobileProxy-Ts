import type { Request, Response } from "express";
import { carSearchBy } from "../scrapers/homeScraper.js";
import redis from "../services/redisClient.js";

export async function searchCarByPlate(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid, licencePlate } = req.body as Record<string, string>;
    if (!uniqueDeviceId || !cartId || !phpsessid || !licencePlate) return res.status(400).json({ error: "Missing required fields" });
    const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;
    const url = process.env.END_POINT!;
    const result = await carSearchBy(url, cartId, uniqueDeviceId, cookie, licencePlate);
    if (result.carfound) {
      if (result.ktype) await redis.set(`car:${cartId}:ktype`, result.ktype as string, "EX", 3600);
      result.car = "Found";
    } else { result.car = "Not Found"; }
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message });
  }
}
