import type { Request, Response } from "express";
import { API } from "../services/API.js";
import { getActiveCart } from "../services/cartService.js";

const BASE_URL = process.env.END_POINT!;

export async function getCartV2(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid, language = "nl" } = req.body as Record<string, string>;
    if (!cartId || !phpsessid) return res.status(400).json({ success: false, error: "Missing required fields", required: ["cartId", "phpsessid"] });

    const cartItems = await getActiveCart(cartId);
    if (cartItems.length === 0) {
      return res.status(200).json({ success: true, data: { summary: { subtotal: 0, total: 0, total_vat: 0, shipping_method: "", shipping_price: null, payment_method: "", payment_price: null, currency: "" }, items: [], products: [], meta: { item_count: 0, page: "cart", generated_at: new Date().toISOString() } } });
    }

    const productIds = cartItems.map((i) => i.product_id);
    const productData = await API("/products/data", "POST", { products: productIds, language, options: { oenumbers: false, images: true, usageNumbers: false, measurements: false, package_measurements: false, stock: true, categories: false, brand: true }, page: 1, limit: 30 });
    const rawProducts = Object.values((productData?.products ?? {}) as Record<string, unknown>) as Record<string, unknown>[];

    let subtotal = 0, total_vat = 0, item_count = 0;
    const items = rawProducts.map((p, index) => {
      const cartItem = cartItems.find((i) => i.product_id === String((p as Record<string,unknown>).product_id));
      const quantity = cartItem?.quantity ?? 1;
      const price_each = parseFloat(((p as Record<string,Record<string,string>>).prices?.consumer_ex_vat) ?? "0");
      const vat = parseFloat(((p as Record<string,string>).vat_percentage) ?? "21") / 100;
      const price_total = parseFloat((price_each * quantity).toFixed(2));
      subtotal += price_total; total_vat += parseFloat((price_total * vat).toFixed(2)); item_count += quantity;
      const image = (((p as Record<string,Record<string,Record<string,string>>>).images?.[0] as Record<string,string>)?.url_thumb ?? "").replace("https://porza.s02.corenio.com", BASE_URL);
      return { item_id: String(index + 1), quantity, pricing: { price_each, price_total }, product: { id: String((p as Record<string,unknown>).product_id), sku: (p as Record<string,string>).sku ?? "", ean: (p as Record<string,string>).eancode ?? "", title: (p as Record<string,string>).title ?? "", url: `/product/${(p as Record<string,string>).seourl}`, image, properties: "", user_input: "", handle_costs: "Array" } };
    });

    const products = items.map((i) => ({ ...i.product, quantity: i.quantity, price_each: i.pricing.price_each, price_total: i.pricing.price_total }));
    subtotal = parseFloat(subtotal.toFixed(2)); total_vat = parseFloat(total_vat.toFixed(2));
    const total = parseFloat((subtotal + total_vat).toFixed(2));

    return res.status(200).json({ success: true, data: { summary: { subtotal, total, total_vat, shipping_method: "", shipping_price: null, payment_method: "", payment_price: null, currency: "" }, items, products, meta: { item_count, page: "cart", generated_at: new Date().toISOString() } } });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Internal server error", message: (error as Error).message });
  }
}
