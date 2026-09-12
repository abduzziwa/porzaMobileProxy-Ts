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
  corenioOrdersList,
  corenioOrderPaymentLink,
  corenioOrderPdf,
  parseCorenioSignupError,
  isCorenioNoOrdersFoundError,
} from "../services/v3CoreniService.js";
import { getStoredCorenioCartId, retireCorenioCartId, resyncCorenioCart, type ShopperIdentity } from "../services/v3CartSessionService.js";
import { notifyUser } from "../services/v3UserNotificationService.js";
import { transformProduct } from "./v3ProductsController.js";

// "€ 97,05" -> 97.05 — Corenio pre-formats currency server-side (locale
// formatting, comma decimal separator), it never returns a raw number here.
export function parseFormattedAmount(formatted: string): number | null {
  const cleaned = formatted.replace(/[^\d,.-]/g, "").replace(",", ".");
  if (!/\d/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Live financial truth for an order comes only from Corenio — Corenio can
// adjust pricing after creation (discounts, corrections, partial payment),
// and we never store a local copy of totals, so there is no local fallback
// for `amount`. Corenio's Orders API has no per-line-item data at all (only
// item_count/item_quantity aggregates), so items always stay sourced from
// our own v3_orders.items — that gap is structural, not a bug here.
interface LiveOrderAmount {
  total: number;
  total_ex_vat: number;
  total_vat: number;
  total_paid: number;
  currency: string;
  status: string;
  // Corenio's order object carries no payment method, transaction id, or
  // paid-at timestamp — total_paid vs total is the only payment signal it
  // exposes at all, so payment_status is computed here from that (same
  // logic as /v3/orders/payment-status) rather than a separate live field.
  payment_status: PaymentStatus;
}

async function fetchLiveOrderAmount(
  corenioOrderId: number | null,
  userToken?: string | null
): Promise<{ amount: LiveOrderAmount | null; live: boolean; confirmedGone: boolean }> {
  if (!corenioOrderId) return { amount: null, live: false, confirmedGone: false };
  try {
    const liveOrder = await corenioGetOrder(corenioOrderId, userToken);
    if (!liveOrder) return { amount: null, live: false, confirmedGone: false };
    return {
      live: true,
      confirmedGone: false,
      amount: {
        total: liveOrder.total,
        total_ex_vat: liveOrder.total_ex_vat,
        total_vat: liveOrder.total_vat,
        total_paid: liveOrder.total_paid,
        currency: liveOrder.currency,
        status: liveOrder.status,
        payment_status: normalizePaymentStatus(liveOrder),
      },
    };
  } catch (err) {
    // Corenio's "No Orders Found" 404 (verified live) means this account
    // genuinely has zero orders right now — a confirmed signal, not just a
    // failed lookup. Callers use this to stop serving the local row as if
    // it still exists, instead of the previous blanket non-blocking
    // fallback that treated every failure (network blip, 5xx, or a real
    // deletion) identically.
    const confirmedGone = isCorenioNoOrdersFoundError(err);
    if (!confirmedGone) {
      console.error("[fetchLiveOrderAmount] Corenio lookup failed (non-blocking):", (err as Error).message);
    }
    return { amount: null, live: false, confirmedGone };
  }
}

// One batch call for an order list, rather than one Corenio round trip per
// row. Local v3_orders rows stay the enumeration source — Corenio's own
// GET /orders only ever shows a narrow, time-based recent window (verified
// live: older orders drop out of it entirely), so it cannot itself replace
// the local list — but status/amount for every row still comes from here
// live whenever the order is present in it. Local `status` is only a
// fallback for a row Corenio's window no longer covers or when this call
// fails outright.
async function fetchLiveOrdersMap(
  userToken?: string | null
): Promise<{ orders: Record<string, import("../services/v3CoreniService.js").CorenioOrder>; confirmedGone: boolean }> {
  try {
    const { orders } = await corenioOrdersList({ limit: 50, page: 1 }, userToken);
    return { orders: orders ?? {}, confirmedGone: false };
  } catch (err) {
    // Same distinction as fetchLiveOrderAmount: Corenio's 404 "No Orders
    // Found" (verified live) means this account genuinely has zero orders
    // right now, not just "couldn't check" — every other failure keeps the
    // existing non-blocking fallback to local rows.
    const confirmedGone = isCorenioNoOrdersFoundError(err);
    if (!confirmedGone) {
      console.error("[fetchLiveOrdersMap] Corenio lookup failed (non-blocking):", (err as Error).message);
    }
    return { orders: {}, confirmedGone };
  }
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
  // Required only for guest checkout (user_id === null) — a logged-in
  // shopper's account already carries these from signup. Corenio's own
  // /users/create rejects account creation without them (verified live,
  // 2026-09-06): state and mobphone need real values (an empty string does
  // NOT satisfy the check); billing_sex must be "male"/"female".
  billing_state?: string;
  billing_mobphone?: string;
  billing_sex?: "male" | "female";
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

  // shipping_option_id is still required for every order — it's what maps to
  // a real Corenio shipping method further down, nothing else can stand in
  // for it. billing_email/firstname/lastname are only required for a GUEST
  // order (user_id == null) — that's the one path that still needs them,
  // to provision the guest's invisible Corenio account below. A logged-in
  // user's account already carries this from signup (see /v3/shipping/options'
  // saved_address), so the order no longer needs it re-submitted — don't
  // block checkout over fields that may now legitimately arrive blank.
  if (!addr.shipping_option_id) {
    return res.status(400).json({ success: false, error: "Incomplete address data" });
  }
  if (user_id == null && (!addr.billing_email || !addr.billing_firstname || !addr.billing_lastname)) {
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
    let cartId = await getStoredCorenioCartId(shopper);
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
      // Corenio's own usergroup config requires state, mobphone and sex on
      // /users/create (verified live) — a logged-in user's account already
      // has these from signup, but a guest checkout has to supply them now
      // or account provisioning (and therefore the whole order) fails.
      const missingGuestFields = ([
        ["billing_state", addr.billing_state],
        ["billing_mobphone", addr.billing_mobphone],
        ["billing_sex", addr.billing_sex],
      ] as const).filter(([, v]) => !v).map(([k]) => k);
      if (missingGuestFields.length) {
        return res.status(400).json({ success: false, error: "missing_fields", fields: missingGuestFields });
      }
      if (addr.billing_sex !== "male" && addr.billing_sex !== "female") {
        return res.status(400).json({ success: false, error: "invalid_fields", details: { billing_sex: "Must be 'male' or 'female'" } });
      }

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
          mobphone: addr.billing_mobphone,
          state: addr.billing_state,
          sex: addr.billing_sex,
          gender: addr.billing_sex,
          // companyinfo is validation-only (required on this install even
          // for individuals, never surfaced anywhere) — always a fixed
          // placeholder, never the guest's real input. companyname is the
          // field that actually shows in Corenio's admin customer search,
          // so it carries the guest's real company name (left empty for a
          // private individual) instead — the two must not be conflated.
          companyinfo: "Particulier",
          companyname: addr.billing_companyname,
        });
        const login = await corenioLogin(addr.billing_email, guestPassword);
        corenioToken = login.token;
      } catch (err) {
        const signupError = parseCorenioSignupError(err);
        if (signupError?.type === "email_taken") {
          // A returning customer checking out as guest with an email that
          // already has a real Corenio account — we generated a random
          // password above, so we can't silently log them in. They need to
          // use the login flow instead; a bare 502 here left them no way to
          // know why checkout failed.
          return res.status(409).json({
            success: false,
            error: "email_already_registered",
            message: "An account already exists for this email — please log in to complete checkout.",
          });
        }
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
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        // Corenio dropped this cart server-side (observed after ~2 days) but
        // our DB still pointed at it. Recreate the cart and re-push every
        // locally-known item so checkout can proceed on the fresh cart_id
        // instead of dead-ending — the shopper never asked to lose their cart.
        console.error(`[createOrder] Corenio cart ${cartId} is gone (404) — resyncing`);
        try {
          cartId = await resyncCorenioCart(shopper, corenioToken);
          shippingMethods = await corenioCartShippingMethods(cartId, language, corenioToken);
        } catch (resyncErr) {
          console.error("[createOrder] Resync after dead cart failed:", (resyncErr as Error).message);
          return res.status(502).json({ success: false, error: "Could not process order" });
        }
      } else {
        console.error("[createOrder] Failed to fetch shipping methods:", (err as Error).message);
        return res.status(502).json({ success: false, error: "Could not process order" });
      }
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

    try {
      await corenioCartFinalize(cartId, corenioToken);
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

    // Corenio's finalize endpoint no longer returns order_id in its response
    // body (verified live, 2026-09: HTTP 200 with an EMPTY body) — it used
    // to, and finalizeResult.order_id silently became `undefined` once that
    // changed, writing NULL into every order's corenio_order_id since. The
    // only way left to identify the order we just created is this user's own
    // order list right after finalize — GET /orders is scoped to the
    // authenticated token, not shop-wide (verified live: a second test
    // account's list never showed another account's orders), so the highest
    // order_id there is reliably the one just placed — barring the same user
    // finalizing two orders from two devices in the exact same instant, an
    // acceptable edge case. This is no longer optional enrichment: without
    // it we cannot know the order's id at all, so unlike before, a failure
    // here does fail the response — logged distinctly because it means a
    // real, paid-for order now exists on Corenio that our own v3_orders
    // can't record.
    let orderId: number;
    let liveOrder: import("../services/v3CoreniService.js").CorenioOrder | null = null;
    try {
      const { orders } = await corenioOrdersList({ limit: 5, page: 1 }, corenioToken);
      const ids = Object.keys(orders).map(Number).filter((n) => !Number.isNaN(n));
      if (!ids.length) throw new Error("No orders returned for this user right after finalize");
      orderId = Math.max(...ids);
      liveOrder = orders[String(orderId)] ?? null;
    } catch (err) {
      console.error("[createOrder] ORDER PLACED ON CORENIO BUT ID COULD NOT BE RESOLVED — order will not appear in v3_orders:", (err as Error).message);
      return res.status(502).json({ success: false, error: "Could not process order" });
    }

    console.log(`[CORENIO_API -> DATABASE] orders/create: Corenio confirmed order ${orderId} — writing to v3_orders`);
    await v3Pool.query(
      `INSERT INTO v3_orders
         (user_id, device_id, corenio_order_id, external_order_id, corenio_cart_id, currency, total_amount, total_quantity, items, encrypted_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        user_id, device_id, orderId, null, cartId, currency, totalAmount,
        totalQuantity, JSON.stringify(items), encrypted_address,
      ]
    );

    // Guests have no v3_users row (v3_notifications.user_id is NOT NULL, FK'd
    // to it), so this is account-holders only — matches the existing
    // account-feature split below. Fire-and-forget — notifyUser never throws.
    if (user_id != null) {
      notifyUser({
        userId: user_id,
        event: "order_created",
        params: { orderId: String(orderId) },
        data: { order_id: String(orderId) },
      });
    }

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

    // liveOrder came from the same order-list call used to resolve orderId
    // above — no second Corenio round trip needed to enrich the response.
    const order = liveOrder
      ? {
          status: liveOrder.status,
          total: liveOrder.total,
          currency: liveOrder.currency,
          item_count: liveOrder.item_count,
          item_quantity: liveOrder.item_quantity,
        }
      : undefined;

    return res.json({ success: true, order_id: orderId, external_order_id: null, order });
  } catch (err) {
    console.error("[createOrder] Error:", err);
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

    let methods;
    try {
      methods = await corenioCartShippingMethods(cartId, lang, req.corenioToken);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        // Corenio no longer knows this cart (expired/dropped server-side)
        // but our DB — and the app's cart page, which only ever reads
        // v3_cart — still thinks it's live. Recreate the Corenio cart and
        // re-push every locally-known item into it, then quote shipping for
        // the fresh cart, so this resolves transparently instead of
        // returning an empty cart the shopper never asked to empty.
        console.error(`[getShippingOptions] Corenio cart ${cartId} is gone (404) — resyncing`);
        const freshCartId = await resyncCorenioCart({ deviceId: device_id, userId: user_id }, req.corenioToken);
        methods = await corenioCartShippingMethods(freshCartId, lang, req.corenioToken);
      } else {
        throw err;
      }
    }

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

    // Surface the shopper's saved address (from signup, or a past checkout)
    // alongside shipping quotes — saves the app a separate /v3/address/get
    // round trip on the same screen, and lets it tell the shopper up front
    // which address shipping will use.
    const saved_address = user_id != null ? await fetchSavedAddress(user_id) : null;

    return res.json({
      success: true,
      language: lang,
      shipping_options,
      saved_address,
      address_message: saved_address
        ? "We'll use the address you signed up with for shipping unless you choose a different one."
        : null,
    });
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
    // Confirm with Corenio before reading local rows — a confirmed 404 "No
    // Orders Found" means this account genuinely has zero orders right now
    // (deleted on Corenio's side), so the local v3_orders rows are stale.
    // Clean them up rather than just hiding them, so this doesn't need
    // rediscovering on every request.
    const { orders: liveMap, confirmedGone } = await fetchLiveOrdersMap(req.corenioToken);

    if (confirmedGone) {
      await v3Pool.query(`DELETE FROM v3_orders WHERE user_id = $1`, [user_id]);
      return res.json({ success: true, total: 0, orders: [] });
    }

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

      const liveOrder = liveMap[String(row.corenio_order_id)];
      const live = Boolean(liveOrder);
      const payment_status = live ? normalizePaymentStatus(liveOrder) : "unknown";
      if (live) notifyOnPaymentStatusChange(row.corenio_order_id, user_id, payment_status);

      return {
        id:                row.id,
        corenio_order_id:  row.corenio_order_id,
        external_order_id: row.external_order_id,
        status:            live ? liveOrder.status : row.status,
        total:             live ? liveOrder.total : null,
        currency:          live ? liveOrder.currency : null,
        payment_status,
        status_live:       live,
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
       FROM v3_orders WHERE corenio_order_id = $1 AND user_id = $2`,
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

    const { amount, live, confirmedGone } = await fetchLiveOrderAmount(row.corenio_order_id, req.corenioToken);
    // Corenio confirmed (404 "No Orders Found", not just a failed lookup)
    // that this account has zero orders right now — stop serving the local
    // row as if it still exists rather than falling back to it.
    if (confirmedGone) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    if (live && amount) notifyOnPaymentStatusChange(row.corenio_order_id, user_id, amount.payment_status);

    // Payment-link generation is a completely separate Corenio call from
    // the amount lookup above — try it for every single-order detail
    // request (no opt-in needed), unless we already have live, definite
    // confirmation the order is resolved. See fetchLivePaymentLink for the
    // likely_paid pattern-match rationale.
    let payment_url: string | null = null;
    let likely_paid = false;
    const knownResolved = amount !== null && amount.payment_status !== "pending";
    if (amount?.payment_status === "paid") {
      likely_paid = true; // confirmed live, not just inferred
    } else if (!knownResolved) {
      const linkResult = await fetchLivePaymentLink(row.corenio_order_id, req.corenioToken);
      payment_url = linkResult.payment_url;
      likely_paid = linkResult.likely_paid;
    }

    return res.json({
      success: true,
      order: {
        id:                row.id,
        corenio_order_id:  row.corenio_order_id,
        external_order_id: row.external_order_id,
        status:            live && amount ? amount.status : row.status,
        total_quantity:    row.total_quantity,
        created_at:        row.created_at,
        delivery_address,
        items:             enrichedItems,
        amount,
        amount_live:       live,
        payment_url,
        likely_paid,
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
       FROM v3_orders WHERE corenio_order_id = $1 AND device_id = $2`,
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

    const { amount, live, confirmedGone } = await fetchLiveOrderAmount(row.corenio_order_id, req.corenioToken);
    // Same confirmed-deletion handling as getProxyOrderDetail — Corenio's
    // 404 "No Orders Found" means this order genuinely no longer exists.
    if (confirmedGone) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    // Payment-link generation is a completely separate Corenio call from
    // the amount lookup above — try it for every single-order detail
    // request (no opt-in needed), unless we already have live, definite
    // confirmation the order is resolved. See fetchLivePaymentLink for the
    // likely_paid pattern-match rationale.
    let payment_url: string | null = null;
    let likely_paid = false;
    const knownResolved = amount !== null && amount.payment_status !== "pending";
    if (amount?.payment_status === "paid") {
      likely_paid = true; // confirmed live, not just inferred
    } else if (!knownResolved) {
      const linkResult = await fetchLivePaymentLink(row.corenio_order_id, req.corenioToken);
      payment_url = linkResult.payment_url;
      likely_paid = linkResult.likely_paid;
    }

    return res.json({
      success: true,
      order: {
        id:                row.id,
        corenio_order_id:  row.corenio_order_id,
        external_order_id: row.external_order_id,
        status:            live && amount ? amount.status : row.status,
        total_quantity:    row.total_quantity,
        created_at:        row.created_at,
        delivery_address,
        items:             enrichedItems,
        amount,
        amount_live:       live,
        payment_url,
        likely_paid,
      },
    });
  } catch (err) {
    console.error("[getGuestOrderDetail] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// Shared by getSavedAddress and getShippingOptions — the latter surfaces the
// same saved address (set at signup, or from a past checkout) alongside
// shipping quotes so the app can tell the shopper "we'll ship to the
// address you signed up with" without a separate round trip.
async function fetchSavedAddress(userId: number): Promise<AddressPayload | null> {
  const result = await v3Pool.query<{ encrypted_data: string }>(
    `SELECT encrypted_data FROM v3_addresses WHERE user_id = $1`,
    [userId]
  );
  if (!result.rows.length) return null;
  try {
    return decryptData<AddressPayload>(result.rows[0].encrypted_data);
  } catch (err) {
    console.error(`[fetchSavedAddress] Decrypt failed for user ${userId} (non-blocking):`, (err as Error).message);
    return null;
  }
}

// ── POST /v3/address/get ──────────────────────────────────
export async function getSavedAddress(req: Request, res: Response): Promise<Response> {
  const { user_id } = req.body as { user_id?: number };

  if (!user_id) return res.status(400).json({ success: false, error: "Missing user_id" });

  try {
    const address = await fetchSavedAddress(user_id);
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

// Corenio's paymentlink endpoint is NOT idempotent — verified live, two
// back-to-back calls for the same order returned two different Mollie
// checkout URLs (separate sessions) — so this is skipped once we already
// have live confirmation (via GET /orders) that the order is resolved.
//
// likely_paid: verified live across multiple orders — every order we've
// independently confirmed paid (378) has consistently made Corenio's
// paymentlink call 200 with an empty/malformed body (no payment_url, no
// exception thrown), while a genuinely unpaid order (379) consistently
// returns a real link, retested repeatedly as a live control over several
// hours. This is a pattern match, not a Corenio-documented status field —
// GET /orders (which would give a real status string) has been down for
// hours, so this is the best signal available in the meantime. Only the
// specific "200 with no usable payload" shape counts — a thrown exception
// (network error, 401, etc.) is a different failure and must NOT set
// likely_paid, or we'd falsely flag orders as paid during a plain outage.
async function fetchLivePaymentLink(
  corenioOrderId: number | null,
  userToken?: string | null
): Promise<{ payment_url: string | null; likely_paid: boolean }> {
  if (!corenioOrderId) return { payment_url: null, likely_paid: false };
  try {
    const link = await corenioOrderPaymentLink(
      { order_id: corenioOrderId, payment_method: HOSTED_CHECKOUT_PAYMENT_METHOD },
      userToken
    );
    if (!link?.payment_url) {
      console.error(`[fetchLivePaymentLink] Corenio returned no payment_url for order ${corenioOrderId} — matches the likely-paid empty-response pattern`);
      return { payment_url: null, likely_paid: true };
    }
    console.log(`[CORENIO_API -> DATABASE] order-detail: Corenio issued a payment link for order ${corenioOrderId}`);
    return { payment_url: link.payment_url, likely_paid: false };
  } catch (err) {
    console.error("[fetchLivePaymentLink] Corenio lookup failed (non-blocking):", (err as Error).message);
    return { payment_url: null, likely_paid: false };
  }
}

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

    // Corenio can 200 with an empty/malformed body — no exception thrown,
    // but every field on `link` ends up undefined. Verified live: this
    // used to come back here as {"success":true} with no payment_url at
    // all, which looks like success to the caller but has nothing usable.
    // Treat a missing payment_url as a real failure, not a quiet success —
    // and per the likely_paid pattern (see fetchLivePaymentLink), this
    // specific shape has consistently matched orders independently
    // confirmed paid, so surface that here too.
    if (!link?.payment_url) {
      console.error(`[requestPaymentLink] Corenio returned no payment_url for order ${order_id} — matches the likely-paid empty-response pattern`);
      return res.status(502).json({ success: false, error: "Could not create payment link", likely_paid: true });
    }

    console.log(`[CORENIO_API -> DATABASE] orders/pay: Corenio issued a payment link for order ${order_id}`);
    return res.json({
      success: true,
      payment_url: link.payment_url,
      total_unpaid: link.total_unpaid,
      payment_method: link.payment_method,
      likely_paid: false,
    });
  } catch (err) {
    console.error("[requestPaymentLink] Error:", (err as Error).message);
    return res.status(502).json({ success: false, error: "Could not create payment link" });
  }
}

const PDF_TYPES = new Set(["order", "invoice", "credit"]);

// Same brute-force-resistant check as getGuestOrderDetail: identical 404 for
// "no such order" and "wrong email" so an email can't be probed against it.
async function ownsGuestOrder(orderId: number, deviceId: string, email: string): Promise<boolean> {
  const result = await v3Pool.query<{ encrypted_address: string }>(
    `SELECT encrypted_address FROM v3_orders WHERE corenio_order_id = $1 AND device_id = $2`,
    [orderId, deviceId]
  );
  if (!result.rows.length) return false;
  try {
    const addr = decryptData<AddressPayload>(result.rows[0].encrypted_address);
    return Boolean(addr.billing_email) && addr.billing_email.trim().toLowerCase() === email.trim().toLowerCase();
  } catch {
    return false;
  }
}

// ── POST /v3/orders/pdf ────────────────────────────────────
export async function getOrderPdf(req: Request, res: Response): Promise<Response> {
  const { user_id, order_id, type = "invoice" } = req.body as {
    user_id?: number;
    order_id?: number;
    type?: string;
  };

  if (!user_id || !Number.isInteger(order_id) || !PDF_TYPES.has(type)) {
    return res.status(400).json({ success: false, error: "Missing or invalid user_id, order_id, or type" });
  }

  try {
    if (!(await ownsOrder(order_id as number, user_id))) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const pdf = await corenioOrderPdf(order_id as number, type as "order" | "invoice" | "credit", req.corenioToken);
    return res.json({ success: true, filename: pdf.filename, pdf_base64: pdf.pdf_base64 });
  } catch (err) {
    console.error("[getOrderPdf] Error:", (err as Error).message);
    return res.status(502).json({ success: false, error: "Could not fetch order PDF" });
  }
}

// ── POST /v3/orders/guest-pdf ──────────────────────────────
export async function getGuestOrderPdf(req: Request, res: Response): Promise<Response> {
  const { device_id, email, order_id, type = "invoice" } = req.body as {
    device_id?: string;
    email?: string;
    order_id?: number;
    type?: string;
  };

  if (!device_id || !email || !Number.isInteger(order_id) || !PDF_TYPES.has(type)) {
    return res.status(400).json({ success: false, error: "Missing or invalid device_id, email, order_id, or type" });
  }

  try {
    if (!(await ownsGuestOrder(order_id as number, device_id, email))) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const pdf = await corenioOrderPdf(order_id as number, type as "order" | "invoice" | "credit", req.corenioToken);
    return res.json({ success: true, filename: pdf.filename, pdf_base64: pdf.pdf_base64 });
  } catch (err) {
    console.error("[getGuestOrderPdf] Error:", (err as Error).message);
    return res.status(502).json({ success: false, error: "Could not fetch order PDF" });
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

const NOTIFIABLE_PAYMENT_STATUSES = new Set<PaymentStatus>(["paid", "cancelled", "expired", "failed"]);

// Maps to the corresponding event key in v3UserNotificationService's
// centralized, localized copy table — this file no longer owns any message
// text itself, just decides *when* to fire.
const PAYMENT_STATUS_EVENT: Partial<Record<PaymentStatus, "order_paid" | "order_cancelled" | "order_expired" | "order_failed">> = {
  paid: "order_paid",
  cancelled: "order_cancelled",
  expired: "order_expired",
  failed: "order_failed",
};

// Fires a push the FIRST time any polling/viewing path (payment-status
// check, order list, order detail) observes a resolved payment outcome for
// an order — paid, cancelled, expired, or failed. "pending"/"unknown" are
// never notifiable — there's nothing resolved to tell the user yet.
// Idempotent via last_notified_payment_status: the UPDATE's WHERE clause
// only matches (and only then do we notify) when the new status actually
// differs from what we last notified for, so repeatedly viewing the same
// resolved order never re-sends the same push, and concurrent callers can't
// double-fire — whichever request's UPDATE lands first is the only one that
// sees rowCount > 0.
async function notifyOnPaymentStatusChange(
  orderId: number,
  userId: number,
  newStatus: PaymentStatus
): Promise<void> {
  if (!NOTIFIABLE_PAYMENT_STATUSES.has(newStatus)) return;

  try {
    const updated = await v3Pool.query(
      `UPDATE v3_orders SET last_notified_payment_status = $1
       WHERE corenio_order_id = $2 AND user_id = $3
         AND last_notified_payment_status IS DISTINCT FROM $1`,
      [newStatus, orderId, userId]
    );
    if (updated.rowCount === 0) return;

    const event = PAYMENT_STATUS_EVENT[newStatus];
    if (!event) return;

    notifyUser({
      userId,
      event,
      params: { orderId: String(orderId) },
      data: { order_id: String(orderId) },
    });
  } catch (err) {
    console.error(`[notifyOnPaymentStatusChange] Failed for order ${orderId} (non-blocking):`, (err as Error).message);
  }
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

    let liveOrder = null;
    try {
      liveOrder = await corenioGetOrder(order_id as number, req.corenioToken);
    } catch (err) {
      console.error("[getPaymentStatus] GET /orders lookup failed (non-blocking):", (err as Error).message);
    }
    const status = normalizePaymentStatus(liveOrder);
    notifyOnPaymentStatusChange(order_id as number, user_id, status);

    // Fall back to the payment-link pattern only when GET /orders gave us
    // no real answer — if it already told us "paid" (or any other
    // resolved state), trust that over the heuristic.
    let likely_paid = status === "paid";
    if (status === "unknown") {
      const linkResult = await fetchLivePaymentLink(order_id as number, req.corenioToken);
      likely_paid = linkResult.likely_paid;
    }

    return res.json({
      success: true,
      status,
      total: liveOrder?.total ?? null,
      total_paid: liveOrder?.total_paid ?? null,
      currency: liveOrder?.currency ?? null,
      likely_paid,
    });
  } catch (err) {
    console.error("[getPaymentStatus] Error:", (err as Error).message);
    // A failed check is not a failed payment — never report "failed" for a
    // network/upstream error, only for a real Corenio status match above.
    return res.json({ success: true, status: "unknown", total: null, total_paid: null, currency: null, likely_paid: false });
  }
}
