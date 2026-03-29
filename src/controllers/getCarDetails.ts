import type { Request, Response } from "express";
import { getVariable } from "../scrapers/homeScraper.js";
import redis from "../services/redisClient.js";

export async function getCarDetails(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid } = req.body as Record<
      string,
      string
    >;
    if (!uniqueDeviceId || !cartId || !phpsessid)
      return res.status(400).json({ error: "Missing required fields" });
    const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;
    const url = `${process.env.END_POINT}/?jsonAbdul=1`;
    const IMG_HOST = process.env.END_POINT!;
    const car_details = (await getVariable(
      url,
      cartId,
      cookie,
      "",
      "car_details",
    )) as Record<string, unknown>;
    const ktype = await redis.get(`car:${cartId}:ktype`);
    const normalized = {
      ...car_details,
      MANUFACTURER_ICON_URL: car_details?.MANUFACTURER_ICON_URL
        ? `${IMG_HOST}${car_details.MANUFACTURER_ICON_URL as string}`
        : null,
      ktype,
    };
    return res.status(200).json({ success: true, data: normalized });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      message: (error as Error).message,
    });
  }
}
