import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";
import { decryptData, getPublicKey } from "../services/v3CryptoService.js";
import { API } from "../services/API.js";
import { fetchProductsData } from "../services/v3CoreniService.js";
import { transformProduct } from "./v3ProductsController.js";

interface AddressPayload {
  billing_firstname: string;
  billing_lastname: string;
  billing_email: string;
  billing_phone: string;
  billing_address: string;
  billing_addressnumber: string;
  billing_postalcode: string;
  billing_city: string;
  billing_companyname?: string;
  shipping_different?: boolean;
  shipping_firstname?: string;
  shipping_lastname?: string;
  shipping_phone?: string;
  shipping_address?: string;
  shipping_addressnumber?: string;
  shipping_postalcode?: string;
  shipping_city?: string;
  shipping_companyname?: string;
  shipping_option_id: number;
}

// ── POST /v3/orders/create ────────────────────────────────
export async function createOrder(req: Request, res: Response): Promise<Response> {
  const { user_id, device_id, encrypted_address } = req.body as {
    user_id?: number;
    device_id?: string;
    encrypted_address?: string;
  };

  if (!user_id || !device_id || !encrypted_address) {
    return res.status(400).json({ success: false, error: "Missing user_id, device_id or encrypted_address" });
  }

  let addr: AddressPayload;
  try {
    addr = decryptData<AddressPayload>(encrypted_address);
  } catch {
    return res.status(400).json({ success: false, error: "Failed to decrypt address" });
  }

  if (!addr.billing_email || !addr.billing_firstname || !addr.billing_lastname || !addr.shipping_option_id) {
    return res.status(400).json({ success: false, error: "Incomplete address data" });
  }

  try {
    const cartResult = await v3Pool.query<{ product_id: number; quantity: number }>(
      `SELECT product_id, quantity FROM v3_cart WHERE user_id = $1`,
      [user_id]
    );

    if (!cartResult.rows.length) {
      return res.status(400).json({ success: false, error: "Cart is empty" });
    }

    const items = cartResult.rows.map((r) => ({
      product_id: String(r.product_id),
      amount: Number(r.quantity),
    }));

    const useDifferentShipping = !!addr.shipping_different;

    const receiver = {
      companyname: (useDifferentShipping ? addr.shipping_companyname : addr.billing_companyname) ?? "",
      firstname: (useDifferentShipping ? addr.shipping_firstname : undefined) ?? addr.billing_firstname,
      lastname: (useDifferentShipping ? addr.shipping_lastname : undefined) ?? addr.billing_lastname,
      address: (useDifferentShipping ? addr.shipping_address : undefined) ?? addr.billing_address,
      address2: "",
      addressnumber: (useDifferentShipping ? addr.shipping_addressnumber : undefined) ?? addr.billing_addressnumber,
      postalcode: (useDifferentShipping ? addr.shipping_postalcode : undefined) ?? addr.billing_postalcode,
      city: (useDifferentShipping ? addr.shipping_city : undefined) ?? addr.billing_city,
      state: "",
      country: "Netherlands",
      email: addr.billing_email,
      phone: (useDifferentShipping ? addr.shipping_phone : undefined) ?? addr.billing_phone,
    };

    const orderPayload = {
      external_order_id: "",
      items,
      shipping: { shipping_option_id: addr.shipping_option_id, receiver },
      user_email: addr.billing_email,
    };
    console.log("[createOrder] Sending to Corenio:", JSON.stringify(orderPayload, null, 2));

    const corenioResult = await API("/sales/order", "POST", orderPayload) as { order_id: number; external_order_id: string };

    await v3Pool.query(`DELETE FROM v3_cart WHERE user_id = $1`, [user_id]);

    const totalQuantity = items.reduce((sum, i) => sum + i.amount, 0);

    await v3Pool.query(
      `INSERT INTO v3_orders (user_id, device_id, corenio_order_id, external_order_id, total_quantity, items, encrypted_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user_id, device_id, corenioResult.order_id, corenioResult.external_order_id ?? "", totalQuantity, JSON.stringify(items), encrypted_address]
    );

    await v3Pool.query(
      `INSERT INTO v3_addresses (user_id, encrypted_data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET encrypted_data = EXCLUDED.encrypted_data, updated_at = NOW()`,
      [user_id, encrypted_address]
    );

    return res.json({ success: true, order_id: corenioResult.order_id, external_order_id: corenioResult.external_order_id });
  } catch (err) {
    console.error("[createOrder] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ── POST /v3/orders/list ──────────────────────────────────
export async function getOrders(req: Request, res: Response): Promise<Response> {
  const { user_id } = req.body as { user_id?: number };

  if (!user_id) return res.status(400).json({ success: false, error: "Missing user_id" });

  try {
    const result = await v3Pool.query(
      `SELECT id, corenio_order_id, external_order_id, status, total_quantity, created_at
       FROM v3_orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [user_id]
    );
    return res.json({ success: true, orders: result.rows, total: result.rows.length });
  } catch (err) {
    console.error("[getOrders] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ── POST /v3/orders/detail ────────────────────────────────
export async function getOrderDetail(req: Request, res: Response): Promise<Response> {
  const { user_id, order_id } = req.body as { user_id?: number; order_id?: number };

  if (!user_id || !order_id) return res.status(400).json({ success: false, error: "Missing user_id or order_id" });

  try {
    const result = await v3Pool.query(
      `SELECT id, corenio_order_id, external_order_id, status, total_quantity, items, created_at
       FROM v3_orders WHERE id = $1 AND user_id = $2`,
      [order_id, user_id]
    );

    if (!result.rows.length) return res.status(404).json({ success: false, error: "Order not found" });

    return res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    console.error("[getOrderDetail] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ── POST /v3/order/getPublicKey ───────────────────────────
export function getOrderPublicKey(_req: Request, res: Response): Response {
  return res.json({ success: true, public_key: getPublicKey() });
}

// ── POST /v3/shipping/options ─────────────────────────────
type Lang = "en" | "nl" | "de";

const SHIPPING_LABELS: Record<Lang, { free: string; options: string[] }> = {
  en: { free: "Free", options: ["PostNL", "Pick up Pelt Belgium", "Pick up Venlo", "Pick up Eindhoven", "Dachser"] },
  nl: { free: "Gratis", options: ["PostNL", "Ophalen Pelt België", "Ophalen Venlo", "Ophalen Eindhoven", "Dachser"] },
  de: { free: "Kostenlos", options: ["PostNL", "Abholung Pelt Belgien", "Abholung Venlo", "Abholung Eindhoven", "Dachser"] },
};

const SHIPPING_IDS   = [1, 2, 3, 4, 8] as const;
const SHIPPING_PRICE = [7.00, 0, 0, 0, 0] as const;

export function getShippingOptions(req: Request, res: Response): Response {
  const { language } = req.body as { language?: string };
  const lang: Lang = (["en", "nl", "de"].includes(language ?? "") ? language : "en") as Lang;
  const labels = SHIPPING_LABELS[lang];

  const shipping_options = SHIPPING_IDS.map((id, i) => ({
    id,
    name: labels.options[i],
    price: SHIPPING_PRICE[i],
    price_label: SHIPPING_PRICE[i] === 0 ? labels.free : `+€ ${SHIPPING_PRICE[i].toFixed(2).replace(".", ",")}`,
    free: SHIPPING_PRICE[i] === 0,
  }));

  return res.json({ success: true, language: lang, shipping_options });
}

// ── POST /v3/orders/proxy-list ───────────────────────────
export async function getProxyOrderList(req: Request, res: Response): Promise<Response> {
  const { user_id } = req.body as { user_id?: number };

  if (!user_id) return res.status(400).json({ success: false, error: "Missing user_id" });

  try {
    const result = await v3Pool.query<{
      id: number;
      corenio_order_id: number;
      external_order_id: string;
      status: string;
      total_quantity: number;
      items: { product_id: string; amount: number }[];
      encrypted_address: string;
      created_at: string;
    }>(
      `SELECT id, corenio_order_id, external_order_id, status, total_quantity, items, encrypted_address, created_at
       FROM v3_orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [user_id]
    );

    const orders = result.rows.map((row) => {
      let recipient: { name: string; city: string } | null = null;
      try {
        const addr = decryptData<AddressPayload>(row.encrypted_address);
        recipient = {
          name: `${addr.billing_firstname} ${addr.billing_lastname}`.trim(),
          city: addr.billing_city,
        };
      } catch {
        // non-fatal
      }

      return {
        id:                row.id,
        corenio_order_id:  row.corenio_order_id,
        external_order_id: row.external_order_id,
        status:            row.status,
        total_quantity:    row.total_quantity,
        item_count:        (row.items ?? []).length,
        created_at:        row.created_at,
        recipient,
      };
    });

    return res.json({ success: true, total: orders.length, orders });
  } catch (err) {
    console.error("[getProxyOrderList] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ── POST /v3/orders/proxy-detail ─────────────────────────
export async function getProxyOrderDetail(req: Request, res: Response): Promise<Response> {
  const { user_id, order_id, language = "en" } = req.body as {
    user_id?: number;
    order_id?: number;
    language?: string;
  };

  if (!user_id || !order_id) {
    return res.status(400).json({ success: false, error: "Missing user_id or order_id" });
  }

  try {
    const result = await v3Pool.query<{
      id: number;
      corenio_order_id: number;
      external_order_id: string;
      status: string;
      total_quantity: number;
      items: { product_id: string; amount: number }[];
      encrypted_address: string;
      created_at: string;
    }>(
      `SELECT id, corenio_order_id, external_order_id, status, total_quantity, items, encrypted_address, created_at
       FROM v3_orders WHERE id = $1 AND user_id = $2`,
      [order_id, user_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const row = result.rows[0];

    // Decrypt delivery address
    let delivery_address: AddressPayload | null = null;
    try {
      delivery_address = decryptData<AddressPayload>(row.encrypted_address);
    } catch {
      // Address decryption failure is non-fatal — still return the rest
    }

    // Enrich items with product data from Corenio
    const productIds = (row.items ?? []).map((i) => Number(i.product_id));
    let enrichedItems: unknown[] = row.items ?? [];

    if (productIds.length) {
      try {
        const products = await fetchProductsData(productIds, language);
        const quantityMap = new Map(
          (row.items ?? []).map((i) => [Number(i.product_id), i.amount])
        );
        enrichedItems = products.map((p) => ({
          ...transformProduct(p),
          quantity: quantityMap.get(Number(p.product_id)) ?? 1,
        }));
      } catch {
        // Corenio unavailable — fall back to raw items
      }
    }

    return res.json({
      success: true,
      order: {
        id:                row.id,
        corenio_order_id:  row.corenio_order_id,
        external_order_id: row.external_order_id,
        status:            row.status,
        total_quantity:    row.total_quantity,
        created_at:        row.created_at,
        delivery_address,
        items:             enrichedItems,
      },
    });
  } catch (err) {
    console.error("[getProxyOrderDetail] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ── POST /v3/address/get ──────────────────────────────────
export async function getSavedAddress(req: Request, res: Response): Promise<Response> {
  const { user_id } = req.body as { user_id?: number };

  if (!user_id) return res.status(400).json({ success: false, error: "Missing user_id" });

  try {
    const result = await v3Pool.query<{ encrypted_data: string }>(
      `SELECT encrypted_data FROM v3_addresses WHERE user_id = $1`,
      [user_id]
    );

    if (!result.rows.length) return res.json({ success: true, address: null });

    const address = decryptData<AddressPayload>(result.rows[0].encrypted_data);
    return res.json({ success: true, address });
  } catch (err) {
    console.error("[getSavedAddress] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}
