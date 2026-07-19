import type { Request, Response, NextFunction } from "express";
import { cleanImagesDeep } from "../services/v3ImageProxyService.js";

// Wraps res.json so every v3 response is recursively scanned for recognised
// image fields and rewritten to point at our own image proxy — a single,
// central place instead of touching every controller. Registered before
// v3Cache so Redis always stores raw upstream URLs (a config/allowlist change
// takes effect immediately) and the transform runs fresh on every response,
// cache hit or miss.
export function v3ImageTransform(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => originalJson(cleanImagesDeep(body));
  next();
}
