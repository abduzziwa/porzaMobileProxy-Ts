import type { Request, Response } from "express";
import crypto from "crypto";
import "../types.js"; // side-effect only — registers the req.corenioToken Express augmentation
import v3Pool from "../db/v3Client.js";
import { decryptData, getPublicKey } from "../services/v3CryptoService.js";
import {
  fetchProductsData,
  corenioSignup,
  corenioLogin,
  corenioCartShippingMethods,
  corenioCartSetShipping,
  corenioCartsList,
  corenioCartFinalize,
  corenioGetOrder,
  corenioOrderPaymentLink,
} from "../services/v3CoreniService.js";
import { getStoredCorenioCartId, retireCorenioCartId, type ShopperIdentity } from "../services/v3CartSessionService.js";
import { transformProduct } from "./v3ProductsController.js";

// "€ 97,05" -> 97.05 — Corenio pre-formats currency server-side (locale
// formatting, comma decimal separator), it never returns a raw number here.
export function parseFormattedAmount(formatted: string): number | null {
  const cleaned = formatted.replace(/[^\d,.-]/g, "").replace(",", ".");
  if (!/\d/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

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
  const { user_id = null, device_id, encrypted_address } = req.body as {
    user_id?: number | null;
    device_id?: string;
    encrypted_address?: string;
  };

  if (!device_id || !encrypted_address) {
    return res.status(400).json({ success: false, error: "Missing device_id or encrypted_address" });
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

  const { language: rawLanguage } = req.body as { language?: string };
  const language: Lang = (["en", "nl", "de"].includes(rawLanguage ?? "") ? rawLanguage : "en") as Lang;
  const shopper: ShopperIdentity = { deviceId: device_id, userId: user_id };

  try {
    const cartResult = user_id != null
      ? await v3Pool.query<{ product_id: number; quantity: number }>(
          `SELECT product_id, quantity FROM v3_cart WHERE user_id = $1`,
          [user_id]
        )
      : await v3Pool.query<{ product_id: number; quantity: number }>(
          `SELECT product_id, quantity FROM v3_cart WHERE device_id = $1 AND user_id IS NULL`,
          [device_id]
        );

    if (!cartResult.rows.length) {
      return res.status(400).json({ success: false, error: "Cart is empty" });
    }

    const items = cartResult.rows.map((r) => ({
      product_id: String(r.product_id),
      amount: Number(r.quantity),
    }));
    const totalQuantity = items.reduce((sum, i) => sum + i.amount, 0);

    // The Corenio cart already exists and already holds these exact items —
    // built up incrementally by /v3/cart/add while the shopper was browsing.
    // If it's missing here, our own v3_cart and Corenio have gone out of
    // sync; safer to fail than to silently finalize an empty/wrong cart.
    const cartId = await getStoredCorenioCartId(shopper);
    if (cartId === null) {
      console.error("[createOrder] No Corenio cart_id on file for this shopper despite non-empty local cart");
      return res.status(502).json({ success: false, error: "Cart is out of sync, please try again" });
    }

    // Shipping-method eligibility is address-dependent per Corenio's own
    // spec ("based on its contents and shipping address"), and address only
    // ever exists on a Corenio account (nowhere in the Carts API itself).
    // A logged-in user's account already has one; a guest gets an invisible
    // one created here, Corenio-side only — never written to our own
    // v3_users/v3_device_sessions, so this stays a guest in our own system.
    let corenioToken = req.corenioToken;
    if (user_id == null) {
      try {
        const guestPassword = crypto.randomBytes(24).toString("hex");
        await corenioSignup({
          username: addr.billing_email,
          email: addr.billing_email,
          password: guestPassword,
          firstname: addr.billing_firstname,
          lastname: addr.billing_lastname,
          address: addr.billing_address,
          addressnumber: addr.billing_addressnumber,
          postalcode: addr.billing_postalcode,
          city: addr.billing_city,
          country: "NL",
          phone: addr.billing_phone,
          companyname: addr.billing_companyname,
        });
        const login = await corenioLogin(addr.billing_email, guestPassword);
        corenioToken = login.token;
      } catch (err) {
        console.error("[createOrder] Guest account provisioning failed:", (err as Error).message);
        return res.status(502).json({ success: false, error: "Could not process order" });
      }
    }

    // Match the app's shipping_option_id against Corenio's real methods for
    // this cart. KNOWN GAP: our shipping_option_id values are proxy-invented
    // (see getShippingOptions below) and have not yet been verified to line
    // up with Corenio's real shipping_method_id values — this match is
    // expected to need correcting once that's confirmed against a live call.
    let shippingMethods;
    try {
      shippingMethods = await corenioCartShippingMethods(cartId, language, corenioToken);
    } catch (err) {
      console.error("[createOrder] Failed to fetch shipping methods:", (err as Error).message);
      return res.status(502).json({ success: false, error: "Could not process order" });
    }
    const matchedMethod = shippingMethods.find((m) => m.id === addr.shipping_option_id);
    if (!matchedMethod) {
      console.error("[createOrder] shipping_option_id", addr.shipping_option_id, "did not match any Corenio shipping method — mapping needs verification");
      return res.status(502).json({ success: false, error: "Selected shipping method is unavailable" });
    }

    try {
      await corenioCartSetShipping(cartId, matchedMethod.id, corenioToken);
    } catch (err) {
      console.error("[createOrder] Failed to set shipping method:", (err as Error).message);
      return res.status(502).json({ success: false, error: "Could not process order" });
    }

    // Capture the total for our own revenue tracking before finalize —
    // best-effort, non-critical: a failure here must not block the order.
    let totalAmount: number | null = null;
    let currency = "EUR";
    try {
      const carts = await corenioCartsList(30, 1, corenioToken);
      const summary = carts[String(cartId)];
      if (summary) {
        totalAmount = parseFormattedAmount(summary.total);
      }
    } catch (err) {
      console.error("[createOrder] Failed to capture cart total (non-blocking):", (err as Error).message);
    }

    let finalizeResult;
    try {
      finalizeResult = await corenioCartFinalize(cartId, corenioToken);
    } catch (err) {
      console.error("[createOrder] Finalize failed:", (err as Error).message);
      return res.status(502).json({ success: false, error: "Could not process order" });
    }

    if (user_id != null) {
      await v3Pool.query(`DELETE FROM v3_cart WHERE user_id = $1`, [user_id]);
    } else {
      await v3Pool.query(`DELETE FROM v3_cart WHERE device_id = $1 AND user_id IS NULL`, [device_id]);
    }
    await retireCorenioCartId(shopper);

    console.log(`[CORENIO_API -> DATABASE] orders/create: Corenio confirmed order ${finalizeResult.order_id} — writing to v3_orders`);
    await v3Pool.query(
      `INSERT INTO v3_orders
         (user_id, device_id, corenio_order_id, external_order_id, corenio_cart_id, currency, total_amount, total_quantity, items, encrypted_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        user_id, device_id, finalizeResult.order_id, null, cartId, currency, totalAmount,
        totalQuantity, JSON.stringify(items), encrypted_address,
      ]
    );

    // Saved address is an account feature — guests have nothing to save to
    // (address/get already returns null for them, which is expected).
    if (user_id != null) {
      await v3Pool.query(
        `INSERT INTO v3_addresses (user_id, encrypted_data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET encrypted_data = EXCLUDED.encrypted_data, updated_at = NOW()`,
        [user_id, encrypted_address]
      );
    }

    // Pull the just-created order back from Corenio live (not our own DB —
    // our v3_orders row is essentials-only by design) so the confirmation
    // screen can show real status/total instead of just a bare id. Corenio
    // has no "get one order" endpoint, so this pages GET /orders and finds
    // it by id — a freshly finalized order is always the most recent, so
    // it's reliably on page 1. Best-effort: the order is already placed and
    // paid-for status doesn't change this response's success — if this
    // lookup fails or the order isn't found yet, fall back to the bare id
    // exactly as before rather than failing an already-successful checkout.
    let order: { status: string; total: number; currency: string; item_count: number; item_quantity: number } | undefined;
    try {
      const liveOrder = await corenioGetOrder(finalizeResult.order_id, corenioToken);
      if (liveOrder) {
        order = {
          status: liveOrder.status,
          total: liveOrder.total,
          currency: liveOrder.currency,
          item_count: liveOrder.item_count,
          item_quantity: liveOrder.item_quantity,
        };
      }
    } catch (err) {
      console.error("[createOrder] Failed to fetch live order for confirmation (non-blocking):", (err as Error).message);
    }

    // external_order_id no longer exists on the new finalize response (it
    // only returns order_id) — key kept for response-shape compatibility.
    return res.json({ success: true, order_id: finalizeResult.order_id, external_order_id: null, order });
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

const FREE_LABEL: Record<Lang, string> = { en: "Free", nl: "Gratis", de: "Kostenlos" };

// Was a static, proxy-invented list (ids 1/2/3/4/8) that never matched
// Corenio's real shipping_method_ids — only id 1 ever really existed,
// so every other option silently 502'd at checkout. Now fetches Corenio's
// real methods for the shopper's actual cart (same one write-through
// /v3/cart/add already built while they were browsing) and maps them into
// the same {id, name, price, price_label, free} shape the app already
// expects, so no app-side change is needed to consume this fix.
export async function getShippingOptions(req: Request, res: Response): Promise<Response> {
  const { language, device_id, user_id = null } = req.body as {
    language?: string;
    device_id?: string;
    user_id?: number | null;
  };
  const lang: Lang = (["en", "nl", "de"].includes(language ?? "") ? language : "en") as Lang;

  if (!device_id) return res.status(400).json({ success: false, error: "Missing device_id" });

  try {
    const cartId = await getStoredCorenioCartId({ deviceId: device_id, userId: user_id });
    if (cartId === null) {
      // No active cart yet — nothing to quote shipping for.
      return res.json({ success: true, language: lang, shipping_options: [] });
    }

    const methods = await corenioCartShippingMethods(cartId, lang, req.corenioToken);

    const shipping_options = methods.map((m) => {
      const priceExVat = Number(m.price?.price_ex_vat ?? 0);
      return {
        id: m.id,
        name: m.title,
        price: priceExVat,
        price_label: priceExVat === 0 ? FREE_LABEL[lang] : `+€ ${priceExVat.toFixed(2).replace(".", ",")}`,
        free: priceExVat === 0,
      };
    });

    return res.json({ success: true, language: lang, shipping_options });
  } catch (err) {
    console.error("[getShippingOptions] Error:", (err as Error).message);
    return res.status(502).json({ success: false, error: "Could not fetch shipping options" });
  }
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
        const products = await fetchProductsData(productIds, language, req.corenioToken);
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

// ── POST /v3/orders/guest-detail ──────────────────────────
// Guest order lookup: no account exists, so authorise by (device_id, email)
// matching the order's stored delivery address instead of by user_id.
export async function getGuestOrderDetail(req: Request, res: Response): Promise<Response> {
  const { device_id, email, order_id, language = "en" } = req.body as {
    device_id?: string;
    email?: string;
    order_id?: number;
    language?: string;
  };

  if (!device_id || !email || !order_id) {
    return res.status(400).json({ success: false, error: "Missing device_id, email or order_id" });
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
       FROM v3_orders WHERE id = $1 AND device_id = $2`,
      [order_id, device_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const row = result.rows[0];

    let delivery_address: AddressPayload | null = null;
    try {
      delivery_address = decryptData<AddressPayload>(row.encrypted_address);
    } catch {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    // Never reveal whether an order_id exists on this device — same 404 for
    // "no such order" and "wrong email" so email can't be brute-forced against it.
    if (!delivery_address.billing_email || delivery_address.billing_email.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const productIds = (row.items ?? []).map((i) => Number(i.product_id));
    let enrichedItems: unknown[] = row.items ?? [];

    if (productIds.length) {
      try {
        const products = await fetchProductsData(productIds, language, req.corenioToken);
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
    console.error("[getGuestOrderDetail] Error:", err);
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

// order_id here is always the real Corenio order_id (what createOrder()
// already returns to the app) — never our own local v3_orders.id.
async function ownsOrder(orderId: number, userId: number): Promise<boolean> {
  const result = await v3Pool.query(
    `SELECT 1 FROM v3_orders WHERE corenio_order_id = $1 AND user_id = $2`,
    [orderId, userId]
  );
  return result.rows.length > 0;
}

// Fixed at "Online Payments" (Corenio payment_method id 3) — the hosted-
// checkout option that lets the customer pick their own method (iDEAL,
// card, Apple Pay, Google Pay, etc.) on Mollie's own page. Verified live:
// this is the only payment_method value we've seen return a real Mollie
// checkout URL. Deliberately not exposed as a request parameter — the app
// never needs to know Corenio's internal payment-method ID scheme.
const HOSTED_CHECKOUT_PAYMENT_METHOD = 3;

// ── POST /v3/orders/pay ───────────────────────────────────
export async function requestPaymentLink(req: Request, res: Response): Promise<Response> {
  const { user_id, order_id } = req.body as { user_id?: number; order_id?: number };

  if (!user_id || !Number.isInteger(order_id)) {
    return res.status(400).json({ success: false, error: "Missing or invalid user_id or order_id" });
  }

  try {
    if (!(await ownsOrder(order_id as number, user_id))) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const link = await corenioOrderPaymentLink(
      { order_id: order_id as number, payment_method: HOSTED_CHECKOUT_PAYMENT_METHOD },
      req.corenioToken
    );

    console.log(`[CORENIO_API -> DATABASE] orders/pay: Corenio issued a payment link for order ${order_id}`);
    return res.json({
      success: true,
      payment_url: link.payment_url,
      total_unpaid: link.total_unpaid,
      payment_method: link.payment_method,
    });
  } catch (err) {
    console.error("[requestPaymentLink] Error:", (err as Error).message);
    return res.status(502).json({ success: false, error: "Could not create payment link" });
  }
}

export type PaymentStatus = "paid" | "pending" | "failed" | "cancelled" | "expired" | "unknown";

// Pure — testable without hitting Corenio. "paid" is decided by the
// numeric total_paid/total comparison (fields we've verified live), never
// by matching an exact status string — we have never observed what
// Corenio's real "paid" status string actually is (no test order has been
// paid yet), so relying on numbers here is the only reliable signal.
// Anything not clearly cancelled/expired/failed defaults to "pending" —
// matches the explicit requirement that an unrecognised state must never
// be shown as failed.
export function normalizePaymentStatus(
  order: { status: string; total: number; total_paid: number } | null
): PaymentStatus {
  if (!order) return "unknown"; // not found — may just be outside Corenio's
  // narrow recent-orders visibility window (verified: as short as a few
  // hours), NOT proof the order failed. Never treat "unknown" as "failed".
  if (order.total > 0 && order.total_paid >= order.total) return "paid";
  const s = order.status.toLowerCase();
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("expir")) return "expired";
  if (s.includes("fail")) return "failed";
  return "pending";
}

// ── POST /v3/orders/payment-status ────────────────────────
export async function getPaymentStatus(req: Request, res: Response): Promise<Response> {
  const { user_id, order_id } = req.body as { user_id?: number; order_id?: number };

  if (!user_id || !Number.isInteger(order_id)) {
    return res.status(400).json({ success: false, error: "Missing or invalid user_id or order_id" });
  }

  try {
    if (!(await ownsOrder(order_id as number, user_id))) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const liveOrder = await corenioGetOrder(order_id as number, req.corenioToken);
    const status = normalizePaymentStatus(liveOrder);

    return res.json({
      success: true,
      status,
      total: liveOrder?.total ?? null,
      total_paid: liveOrder?.total_paid ?? null,
      currency: liveOrder?.currency ?? null,
    });
  } catch (err) {
    console.error("[getPaymentStatus] Error:", (err as Error).message);
    // A failed check is not a failed payment — never report "failed" for a
    // network/upstream error, only for a real Corenio status match above.
    return res.json({ success: true, status: "unknown", total: null, total_paid: null, currency: null });
  }
}
