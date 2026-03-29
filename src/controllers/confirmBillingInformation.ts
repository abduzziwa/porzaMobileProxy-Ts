import type { Request, Response } from "express";
import { getCheckoutData } from "../scrapers/homeScraper.js";

export async function confirmBillingInformation(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid } = req.body as Record<string, string>;
    if (!uniqueDeviceId || !cartId || !phpsessid) {
      return res.status(400).json({ error: "Missing required fields", required: ["uniqueDeviceId", "cartId", "phpsessid"] });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const Checkout = await getCheckoutData(cartId, phpsessid);
    return res.status(200).json({ success: true, data: Checkout });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message });
  }
}
