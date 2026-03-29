import type { Request, Response } from "express";
import { getApiWithParamsLoginForm } from "../scrapers/homeScraper.js";
import dotenv from "dotenv";
dotenv.config();

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function billingInformation(req: Request, res: Response): Promise<Response> {
  try {
    const origin = process.env.END_POINT!;
    const { phpsessid, cartId, uniqueDeviceId, ...billingData } = req.body as Record<string, unknown>;
    if (!cartId) return res.status(400).json({ success: false, error: "Missing cartId" });
    if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    if (!phpsessid) return res.status(400).json({ success: false, error: "Missing phpsessid" });

    const url = `${origin}/api/mod/ecommerce/order/setTempOrderAddress`;
    const resource: Record<string, unknown> = {
      google_api_places: billingData.google_api_places || "", billing_email: billingData.billing_email || "",
      billing_phone: billingData.billing_phone || "", billing_gender: billingData.billing_gender || 1,
      billing_firstname: billingData.billing_firstname || "", billing_lastname: billingData.billing_lastname || "",
      billing_postalcode: billingData.billing_postalcode || "", billing_addressnumber: billingData.billing_addressnumber || "",
      billing_address: billingData.billing_address || "", billing_city: billingData.billing_city || "",
      billing_country: billingData.billing_country || 1, billing_state: billingData.billing_state || 0,
      is_company: billingData.is_company || 0, billing_vatnumber: billingData.billing_vatnumber || "",
      billing_companyname: billingData.billing_companyname || "", shipping_different: billingData.shipping_different || 0,
      google_api_places_shipping: billingData.google_api_places_shipping || "", shipping_companyname: billingData.shipping_companyname || "",
      shipping_gender: billingData.shipping_gender || 1, shipping_firstname: billingData.shipping_firstname || "",
      shipping_lastname: billingData.shipping_lastname || "", shipping_postalcode: billingData.shipping_postalcode || "",
      shipping_addressnumber: billingData.shipping_addressnumber || "", shipping_address: billingData.shipping_address || "",
      shipping_city: billingData.shipping_city || "", shipping_country: billingData.shipping_country || 1,
      shipping_state: billingData.shipping_state || 0, shipping_phone: billingData.shipping_phone || "",
    };

    let data: unknown = await getApiWithParamsLoginForm(url, cartId as string, phpsessid as string, resource);
    if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }

    await delay(1500);

    let data2: unknown = await getApiWithParamsLoginForm(url, cartId as string, phpsessid as string, resource);
    if (typeof data2 === "string") { try { data2 = JSON.parse(data2); } catch {} }

    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource, data: data2, firstCallData: data });
  } catch (err) {
    console.error(`[BillingAPI] Error: ${(err as Error).message}`);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}
