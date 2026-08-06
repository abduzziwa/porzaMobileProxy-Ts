import type { Request, Response, NextFunction } from "express";
import v3Pool from "../db/v3Client.js";

// Endpoints that need no identity at all
const EXEMPT_PATHS = new Set([
  "/v3/device/check",
  "/v3/auth/login",
  "/v3/auth/signup",
  "/v3/auth/forgot-password",
]);

// Endpoints a guest (device_id only, user_id: null) may call — browsing, cart,
// liked, last-seen, vehicle selection, and checkout all work anonymously now.
const GUEST_OK_PATHS = new Set([
  "/v3/categories",
  "/v3/categories/sub",
  "/v3/products",
  "/v3/products/data",
  "/v3/products/filters",
  "/v3/products/relevant",
  "/v3/brands/logos",
  "/v3/search",
  "/v3/car/get",
  "/v3/car/select",
  "/v3/car/remove",
  "/v3/cart/add",
  "/v3/cart/remove",
  "/v3/cart/update",
  "/v3/cart/get",
  "/v3/cart/clear",
  "/v3/liked/toggle",
  "/v3/liked/get",
  "/v3/liked/check",
  "/v3/last-seen/add",
  "/v3/last-seen/get",
  "/v3/order/getPublicKey",
  "/v3/shipping/options",
  "/v3/address/get",
  "/v3/orders/create",
  "/v3/orders/guest-detail",
  "/v3/device/push-token",
]);

export async function v3Session(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (EXEMPT_PATHS.has(req.path)) return next();

  const body = req.body as Record<string, unknown>;
  const device_id = (body.device_id ?? body.unique_device_id) as string | undefined;
  const user_id = (body.user_id ?? null) as number | null;

  if (!device_id) {
    res.status(400).json({ error: "Missing device_id" });
    return;
  }

  // Guest request (user_id explicitly null) — trust device_id alone on guest-OK paths,
  // reject anywhere that still requires a real account.
  if (user_id === null) {
    if (GUEST_OK_PATHS.has(req.path)) return next();
    res.status(401).json({ error: "Unauthorised" });
    return;
  }

  // A user_id was supplied — verify it regardless of path, guest-OK or not,
  // since the caller is claiming to be logged in. Piggyback the user's stored
  // Corenio token onto this same query (no extra round trip) so every
  // downstream controller/service can attach it to Corenio calls via
  // req.corenioToken instead of each doing its own lookup.
  try {
    const result = await v3Pool.query<{ corenio_token: string | null }>(
      `SELECT u.corenio_token
       FROM v3_device_sessions ds
       JOIN v3_users u ON u.user_id = ds.user_id
       WHERE ds.device_id = $1 AND ds.user_id = $2 AND ds.authorised = true`,
      [device_id, user_id]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "Unauthorised" });
      return;
    }

    req.corenioToken = result.rows[0].corenio_token;
    next();
  } catch (err) {
    console.error("[v3Session] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
