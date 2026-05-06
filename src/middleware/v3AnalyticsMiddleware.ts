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

export function v3Analytics(req: Request, res: Response, next: NextFunction): void {
  // device/check is already logged as 'open' in deviceCheck controller
  if (req.path === "/v3/device/check") return next();

  const start = Date.now();

  res.on("finish", () => {
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
