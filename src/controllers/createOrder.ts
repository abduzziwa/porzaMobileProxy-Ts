import type { Request, Response } from "express";
import { API } from "../services/API.js";
import { markCartProcessed } from "../services/cartService.js";

interface OrderItem { product_id?: string; product_sku?: string; quantity: number; }

export async function createOrder(req: Request, res: Response): Promise<Response> {
  try {
    const { cartId, shippingOptionId, items, billing_firstname, billing_lastname, billing_email, billing_phone, billing_address, billing_addressnumber, billing_postalcode, billing_city, billing_companyname, shipping_firstname, shipping_lastname, shipping_phone, shipping_address, shipping_addressnumber, shipping_postalcode, shipping_city, shipping_companyname } = req.body as Record<string, unknown>;

    if (!(items as OrderItem[])?.length) return res.status(400).json({ success: false, error_message: ["Geen producten gevonden."] });
    if (!shippingOptionId) return res.status(400).json({ success: false, error_message: ["Geen verzendmethode geselecteerd."] });
    if (!billing_email) return res.status(400).json({ success: false, error_message: ["E-mailadres ontbreekt."] });

    const orderItems = (items as OrderItem[]).map((item) => ({
      ...(item.product_id ? { product_id: String(item.product_id) } : { product_sku: String(item.product_sku).replace(/\s+/g, "") }),
      amount: Number(item.quantity) || 1,
    }));

    const payload = {
      external_order_id: "",
      items: orderItems,
      shipping: {
        shipping_option_id: Number(shippingOptionId),
        receiver: { companyname: (shipping_companyname || billing_companyname || "") as string, firstname: (shipping_firstname || billing_firstname) as string, lastname: (shipping_lastname || billing_lastname) as string, address: (shipping_address || billing_address) as string, address2: "", addressnumber: (shipping_addressnumber || billing_addressnumber) as string, postalcode: (shipping_postalcode || billing_postalcode) as string, city: (shipping_city || billing_city) as string, state: "", country: "Netherlands", email: billing_email as string, phone: (shipping_phone || billing_phone) as string },
      },
      user_email: billing_email as string,
    };

    console.log("📤 Corenio order payload:", JSON.stringify(payload, null, 2));
    const result = await API("/sales/order", "POST", payload as Record<string, unknown>);

    if (result?.order_id && cartId) { await markCartProcessed(cartId as string); console.log(`[createOrder] Cart ${cartId as string} marked as processed ✓`); }

    return res.status(200).json({ success: true, order_id: result.order_id, external_order_id: result.external_order_id });
  } catch (err) {
    return res.status(500).json({ success: false, error_message: [(err as Error).message || "Er ging iets mis bij het aanmaken van de bestelling."] });
  }
}
