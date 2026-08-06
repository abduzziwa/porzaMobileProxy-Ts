import type { Request, Response, NextFunction } from "express";
import v3Pool from "../db/v3Client.js";

const PATH_EVENT_MAP: Record<string, string> = {
  "/v3/auth/login": "login",
  "/v3/auth/forgot-password": "forgot_password",
  "/v3/search": "search",
  "/v3/car/get": "vehicle_view",
  "/v3/car/select": "vehicle_search",
  "/v3/car/remove": "vehicle_remove",
  "/v3/categories": "category_view",
  "/v3/categories/sub": "category_view",
  "/v3/products": "product_search",
  "/v3/products/data": "product_view",
  "/v3/products/filters": "product_filter",
  "/v3/products/relevant": "relevant_view",
  "/v3/brands/logos": "brand_logos",
  "/v3/cart/add": "cart_add",
  "/v3/cart/remove": "cart_remove",
  "/v3/cart/update": "cart_update",
  "/v3/cart/get": "cart_view",
  "/v3/cart/clear": "cart_clear",
  "/v3/last-seen/add": "product_view",
  "/v3/last-seen/get": "last_seen_view",
  "/v3/liked/toggle": "product_like",
  "/v3/liked/get": "wishlist_view",
  "/v3/liked/check": "wishlist_check",
};

// push-token routes must only ever operate on a device row created by
// /v3/device/check — never create one, even indirectly via this auto-upsert.
const AUTO_CREATE_DEVICE_EXEMPT_PATHS = new Set(["/v3/device/push-token"]);

export async function v3Analytics(req: Request, res: Response, next: NextFunction): Promise<void> {
  // device/check is already logged as 'open' in deviceCheck controller, which
  // also upserts v3_devices — every other path needs that guarantee made here
  // instead, since guest-OK paths can now be hit before device/check ever runs.
  if (req.path === "/v3/device/check") return next();

  const bodyDeviceId = (req.body as Record<string, unknown>)?.device_id as string | undefined;
  if (bodyDeviceId && !AUTO_CREATE_DEVICE_EXEMPT_PATHS.has(req.path)) {
    try {
      await v3Pool.query(
        `INSERT INTO v3_devices (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING`,
        [bodyDeviceId]
      );
    } catch (err) {
      console.error("[v3Analytics] Failed to ensure device row:", err);
    }
  }

  const start = Date.now();

  res.on("finish", () => {
    // A 404 on an auto-create-exempt path (e.g. push-token) means the device
    // genuinely doesn't exist — logging it here would violate the FK on
    // v3_device_analytics.device_id, so skip rather than log a doomed insert.
    if (AUTO_CREATE_DEVICE_EXEMPT_PATHS.has(req.path) && res.statusCode === 404) return;

    const body = req.body as Record<string, unknown>;
    const device_id = (body.device_id as string) || null;
    const user_id = (body.user_id as number) || null;
    const event = PATH_EVENT_MAP[req.path] || "request";
    const success = res.statusCode < 400;

    const meta: Record<string, unknown> = {
      status_code: res.statusCode,
      success,
      duration_ms: Date.now() - start,
    };

    if (event === "search" && body.query) {
      meta.search_term = body.query;
    }

    v3Pool
      .query(
        `INSERT INTO v3_device_analytics (device_id, user_id, event, request_path, meta)
         VALUES ($1, $2, $3, $4, $5)`,
        [device_id, user_id, event, req.path, JSON.stringify(meta)]
      )
      .catch((err) => console.error("[v3Analytics] Failed to log:", err));
  });

  next();
}
