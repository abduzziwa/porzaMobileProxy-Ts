import type { Request, Response } from "express";
import { postOrderFinished } from "../scrapers/homeScraper.js";

export async function paymentLink(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid } = req.body as Record<string, string>;
    if (!uniqueDeviceId || !cartId || !phpsessid) {
      return res.status(400).json({ error: "Missing required fields", required: ["uniqueDeviceId", "cartId", "phpsessid"] });
    }
    const urlEndPoint = `${process.env.END_POINT}/mijn-wagen/finished`;
    const paymentMethod = 3;
    const comments = "Deliver after 5 PM";
    const html = await postOrderFinished({ url: urlEndPoint, cartId, phpsessid, authCredentials: "cG9yemE6cG9yemE=", bodyParams: { [`radio_${paymentMethod}`]: "on", paymentradio_3: "on", customer_internalorder_id: "", comments, confirm_terms_conditions: "1" } });
    const match = html.match(/window\.paymentLink\s*=\s*'([^']+)'/);
    return res.status(200).json({ success: true, data: match ? match[1] : null });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message });
  }
}
