// import type { Request, Response } from "express";
// import { API } from "../services/API.js";
// import { getActiveCart } from "../services/cartService.js";

// const BASE_URL = process.env.END_POINT!;

// export async function getCartV2(req: Request, res: Response): Promise<Response> {
//   try {
//     const { uniqueDeviceId, cartId, phpsessid, language = "nl" } = req.body as Record<string, string>;
//     if (!cartId || !phpsessid) return res.status(400).json({ success: false, error: "Missing required fields", required: ["cartId", "phpsessid"] });

//     const cartItems = await getActiveCart(cartId);
//     if (cartItems.length === 0) {
//       return res.status(200).json({ success: true, data: { summary: { subtotal: 0, total: 0, total_vat: 0, shipping_method: "", shipping_price: null, payment_method: "", payment_price: null, currency: "" }, items: [], products: [], meta: { item_count: 0, page: "cart", generated_at: new Date().toISOString() } } });
//     }

//     const productIds = cartItems.map((i) => i.product_id);
//     const productData = await API("/products/data", "POST", { products: productIds, language, options: { oenumbers: false, images: true, usageNumbers: false, measurements: false, package_measurements: false, stock: true, categories: false, brand: true }, page: 1, limit: 30 });
//     const rawProducts = Object.values((productData?.products ?? {}) as Record<string, unknown>) as Record<string, unknown>[];

//     let subtotal = 0, total_vat = 0, item_count = 0;
//     const items = rawProducts.map((p, index) => {
//       const cartItem = cartItems.find((i) => i.product_id === String((p as Record<string,unknown>).product_id));
//       const quantity = cartItem?.quantity ?? 1;
//       const price_each = parseFloat(((p as Record<string,Record<string,string>>).prices?.consumer_ex_vat) ?? "0");
//       const vat = parseFloat(((p as Record<string,string>).vat_percentage) ?? "21") / 100;
//       const price_total = parseFloat((price_each * quantity).toFixed(2));
//       subtotal += price_total; total_vat += parseFloat((price_total * vat).toFixed(2)); item_count += quantity;
//       const image = (((p as Record<string,Record<string,Record<string,string>>>).images?.[0] as Record<string,string>)?.url_thumb ?? "").replace("https://porza.s02.corenio.com", BASE_URL);
//       return { item_id: String(index + 1), quantity, pricing: { price_each, price_total }, product: { id: String((p as Record<string,unknown>).product_id), sku: (p as Record<string,string>).sku ?? "", ean: (p as Record<string,string>).eancode ?? "", title: (p as Record<string,string>).title ?? "", url: `/product/${(p as Record<string,string>).seourl}`, image, properties: "", user_input: "", handle_costs: "Array" } };
//     });

//     const products = items.map((i) => ({ ...i.product, quantity: i.quantity, price_each: i.pricing.price_each, price_total: i.pricing.price_total }));
//     subtotal = parseFloat(subtotal.toFixed(2)); total_vat = parseFloat(total_vat.toFixed(2));
//     const total = parseFloat((subtotal + total_vat).toFixed(2));

//     return res.status(200).json({ success: true, data: { summary: { subtotal, total, total_vat, shipping_method: "", shipping_price: null, payment_method: "", payment_price: null, currency: "" }, items, products, meta: { item_count, page: "cart", generated_at: new Date().toISOString() } } });
//   } catch (error) {
//     return res.status(500).json({ success: false, error: "Internal server error", message: (error as Error).message });
//   }
// }


import type { Request, Response } from "express";
import { API } from "../services/API.js";
import pgClient from "../services/db.js";

const BASE_URL = process.env.END_POINT!;

export async function getCartV2(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid, user_lang, language } = req.body as Record<string, string>;
    const lang = user_lang ?? language ?? "nl";

    if (!cartId || !phpsessid) {
      return res.status(400).json({ success: false, error: "Missing required fields", required: ["cartId", "phpsessid"] });
    }

    // ── Step 1: Get encrypted_email for this device ───────────
    let cartIds: string[] = [cartId];

    if (uniqueDeviceId) {
      const emailRes = await pgClient.query<{ encrypted_email: string }>(
        `SELECT encrypted_email FROM app_user_state
         WHERE unique_device_id = $1
         AND encrypted_email IS NOT NULL
         AND is_logged_in = true
         LIMIT 1`,
        [uniqueDeviceId]
      );

      if (emailRes.rows.length > 0) {
        const encEmail = emailRes.rows[0].encrypted_email;

        // ── Step 2: Get all cart_ids linked to that email ─────
        const cartIdsRes = await pgClient.query<{ cart_id: string }>(
          `SELECT DISTINCT cart_id FROM app_user_state
           WHERE encrypted_email = $1
           AND cart_id IS NOT NULL`,
          [encEmail]
        );

        cartIds = cartIdsRes.rows.map(r => r.cart_id);

        // Always include current cartId
        if (!cartIds.includes(cartId)) cartIds.push(cartId);
      }
    }

    // ── Step 3: Query cart_items for all cart_ids ─────────────
    const itemsRes = await pgClient.query<{
      cart_id: string;
      product_id: string;
      quantity: number;
    }>(
      `SELECT cart_id, product_id, quantity
       FROM cart_items
       WHERE cart_id = ANY($1)
       AND deleted = false
       AND processed = false`,
      [cartIds]
    );

    // ── Step 4: Merge by product_id, sum quantities ───────────
    const merged = new Map<string, number>();
    for (const row of itemsRes.rows) {
      const existing = merged.get(row.product_id) ?? 0;
      merged.set(row.product_id, existing + row.quantity);
    }

    if (merged.size === 0) {
      return res.status(200).json({
        success: true,
        data: {
          summary: { subtotal: 0, total: 0, total_vat: 0, shipping_method: "", shipping_price: null, payment_method: "", payment_price: null, currency: "" },
          items: [],
          products: [],
          meta: { item_count: 0, page: "cart", generated_at: new Date().toISOString() },
        },
      });
    }

    const productIds = Array.from(merged.keys());

    // ── Step 5: Fetch product data from Corenio ───────────────
    const productData = await API("/products/data", "POST", {
      products: productIds,
      language: lang,
      options: { oenumbers: false, images: true, usageNumbers: false, measurements: false, package_measurements: false, stock: true, categories: false, brand: true },
      page: 1,
      limit: productIds.length,
    });

    const rawProducts = Object.values((productData?.products ?? {}) as Record<string, unknown>) as Record<string, unknown>[];

    // ── Step 6: Build response ────────────────────────────────
    let subtotal = 0, total_vat = 0, item_count = 0;

    const items = rawProducts.map((p, index) => {
      const pid = String((p as Record<string, unknown>).product_id);
      const quantity = merged.get(pid) ?? 1;
      const price_each = parseFloat(((p as Record<string, Record<string, string>>).prices?.consumer_ex_vat) ?? "0");
      const vat = parseFloat(((p as Record<string, string>).vat_percentage) ?? "21") / 100;
      const price_total = parseFloat((price_each * quantity).toFixed(2));

      subtotal += price_total;
      total_vat += parseFloat((price_total * vat).toFixed(2));
      item_count += quantity;

      const image = (((p as Record<string, Record<string, Record<string, string>>>).images?.[0] as Record<string, string>)?.url_thumb ?? "")
        .replace("https://porza.s02.corenio.com", BASE_URL);

      return {
        item_id: String(index + 1),
        quantity,
        pricing: { price_each, price_total },
        product: {
          id: pid,
          sku: (p as Record<string, string>).sku ?? "",
          ean: (p as Record<string, string>).eancode ?? "",
          title: (p as Record<string, string>).title ?? "",
          url: `/product/${(p as Record<string, string>).seourl}`,
          image,
          properties: "",
          user_input: "",
          handle_costs: "Array",
        },
      };
    });

    const products = items.map((i) => ({
      ...i.product,
      quantity: i.quantity,
      price_each: i.pricing.price_each,
      price_total: i.pricing.price_total,
    }));

    subtotal = parseFloat(subtotal.toFixed(2));
    total_vat = parseFloat(total_vat.toFixed(2));
    const total = parseFloat((subtotal + total_vat).toFixed(2));

    return res.status(200).json({
      success: true,
      data: {
        summary: { subtotal, total, total_vat, shipping_method: "", shipping_price: null, payment_method: "", payment_price: null, currency: "" },
        items,
        products,
        meta: { item_count, page: "cart", generated_at: new Date().toISOString() },
      },
    });
  } catch (error) {
    console.error("[getCartV2] Error:", (error as Error).message);
    return res.status(500).json({ success: false, error: "Internal server error", message: (error as Error).message });
  }
}