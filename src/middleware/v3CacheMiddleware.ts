import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import redis from "../services/v3RedisService.js";

const TTL_MAP: Record<string, number> = {
  "/v3/products":          300,    // 5 min — stock/price sensitive
  "/v3/products/data":     300,    // 5 min — stock/price sensitive
  "/v3/products/relevant": 300,    // 5 min — stock-dependent
  // /v3/products/filters is NOT here on purpose — it has its own shared,
  // DB-backed cache (v3_filters_cache) keyed by category/ktype/language only,
  // not per-device, since the facet list is identical for every caller.
  "/v3/categories":        86400,  // 24 hours — never changes
  "/v3/categories/sub":    86400,  // 24 hours — never changes
  "/v3/auth/me":           86400,  // 24 hours — user profile rarely changes
  "/v3/liked/get":         60,     // 1 min — invalidated immediately on toggle anyway
  "/v3/last-seen/get":     60,     // 1 min — invalidated immediately on add anyway
};

export async function v3Cache(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ttl = TTL_MAP[req.path];
  if (!ttl) return next();

  const body   = req.body as Record<string, unknown>;
  const device = (body.device_id as string) || "anon";
  const hash   = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  const key    = `v3cache:${device}:${req.path}:${hash}`;

  try {
    const cached = await redis.get(key);
    if (cached) {
      console.log(`[v3Cache] ✅ HIT  ${req.path} — served from Redis (device: ${device})`);
      res.setHeader("X-Cache", "HIT");
      res.json(JSON.parse(cached));
      return;
    }
    console.log(`[v3Cache] ❌ MISS ${req.path} — fetching from Corenio (device: ${device})`);
  } catch (err) {
    console.error("[v3Cache] Redis read error:", err);
  }

  // Cache miss — intercept res.json to store the response
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    res.setHeader("X-Cache", "MISS");
    if (res.statusCode === 200) {
      redis.setex(key, ttl, JSON.stringify(body))
        .then(() => console.log(`[v3Cache] 💾 STORED ${req.path} (TTL: ${ttl}s)`))
        .catch((err: Error) => console.error("[v3Cache] Redis write error:", err));
    }
    return originalJson(body);
  };

  next();
}
