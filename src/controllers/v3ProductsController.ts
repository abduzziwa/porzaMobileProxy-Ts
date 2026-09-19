import type { Request, Response } from "express";
import crypto from "crypto";
import "../types.js"; // side-effect only — registers the req.corenioToken Express augmentation
import {
  fetchProductSearch,
  fetchProductsData,
  fetchProductFilters,
  isCorenioNoResultsError,
  type CorenioProduct,
  type CorenioProductProperty,
  type CorenioFilterGroup,
} from "../services/v3CoreniService.js";
import v3Pool from "../db/v3Client.js";
import redis from "../services/v3RedisService.js";

// ─── Brand logo URL ───────────────────────────────────────
const BRAND_LOGO_URL = process.env.BRAND_LOGO_URL || "";
const CUSTOMER_CARE_NUMBER = process.env.CUSTOMER_CARE_NUMBER || null;
console.log(`[v3Products] BRAND_LOGO_URL: ${BRAND_LOGO_URL || "NOT SET"}`);
console.log(`[v3Products] CUSTOMER_CARE_NUMBER: ${CUSTOMER_CARE_NUMBER || "NOT SET"}`);

function brandLogoUrl(id: unknown): string {
  if (!BRAND_LOGO_URL || !id) return "";
  return BRAND_LOGO_URL.replace("[BRAND_ID]", String(id));
}

// ─── getBrandLogos ────────────────────────────────────────

export function getBrandLogos(req: Request, res: Response): Response {
  const { brand_ids } = req.body as { brand_ids?: number[] };

  if (!Array.isArray(brand_ids) || brand_ids.length === 0) {
    return res.status(400).json({ success: false, error: "Provide brand_ids array" });
  }

  const logos: Record<number, string> = {};
  brand_ids.forEach((id) => { logos[id] = brandLogoUrl(id); });
  return res.json({ success: true, logos });
}

// ─── searchProducts ───────────────────────────────────────

// Sorting lives entirely server-side, on purpose: the frontend renders
// whatever order this returns and never re-sorts client-side. That's what
// keeps sort priority changeable by redeploying the backend alone — no app
// build, no store review — even after a version is already live on
// customers' phones. Lower number = shown first. Pure/testable.
export function productSortPriority(p: { in_stock: boolean; fitting_position: string | null }): number {
  if (p.in_stock && p.fitting_position) return 0;
  if (p.in_stock) return 1;
  if (p.fitting_position) return 2;
  return 3;
}

export async function searchProducts(req: Request, res: Response): Promise<Response> {
  const {
    category_ids, categories, productnumbers, eancodes,
    brands, brand_ids, producttype_ids, vehicle_ids,
    ktype_ids, property_ids, user_id,
    language = "en", page = 1, limit = 20,
  } = req.body as Record<string, unknown>;

  const filters: Record<string, unknown> = {};
  if (Array.isArray(category_ids) && category_ids.length)       filters.category_ids    = category_ids;
  if (Array.isArray(categories) && categories.length)           filters.categories      = categories;
  if (Array.isArray(productnumbers) && productnumbers.length)   filters.productnumbers  = productnumbers;
  if (Array.isArray(eancodes) && eancodes.length)               filters.eancodes        = eancodes;
  if (Array.isArray(brands) && brands.length)                   filters.brands          = brands;
  if (Array.isArray(brand_ids) && brand_ids.length)             filters.brand_ids       = brand_ids;
  if (Array.isArray(producttype_ids) && producttype_ids.length) filters.producttype_ids = producttype_ids;
  if (Array.isArray(vehicle_ids) && vehicle_ids.length)         filters.vehicle_ids     = vehicle_ids;
  if (Array.isArray(ktype_ids) && ktype_ids.length)             filters.ktype_ids       = ktype_ids;
  if (Array.isArray(property_ids) && property_ids.length)       filters.property_ids    = property_ids;

  console.log("[searchProducts] REQUEST filters:", JSON.stringify(filters, null, 2));

  try {
    const searchData = await fetchProductSearch(filters, language as string, page as number, limit as number, req.corenioToken);
    console.log("[searchProducts] IDs from Corenio:", searchData.product_ids, "total:", searchData.total_items);

    let likedIds = new Set<number>();
    if (user_id && searchData.product_ids?.length) {
      const likedResult = await v3Pool.query(
        `SELECT product_id FROM v3_liked_products WHERE user_id = $1 AND product_id = ANY($2)`,
        [user_id, searchData.product_ids]
      );
      likedIds = new Set(likedResult.rows.map((r: { product_id: number }) => r.product_id));
    }

    const products = searchData.product_ids?.length
      ? (await fetchProductsData(searchData.product_ids, language as string, req.corenioToken).then((raw) =>
          Array.isArray(raw)
            ? raw.map((p) => transformProduct(p, likedIds))
            : []
        ))
      : [];

    // In-stock + known fitting position first, then in-stock alone, then the
    // rest — Corenio's own ordering (relevance/popularity) stays intact
    // within each tier. Array.prototype.sort is stable in Node, so this
    // doesn't shuffle ties.
    products.sort((a, b) => productSortPriority(a) - productSortPriority(b));

    console.log("[searchProducts] RESPONSE products count:", products.length);

    return res.json({
      success: true,
      products,
      total_items: searchData.total_items,
      pages: searchData.pages,
      current_page: searchData.current_page,
      items_per_page: searchData.items_per_page,
    });
  } catch (err) {
    if (isCorenioNoResultsError(err)) {
      console.log("[searchProducts] Corenio: no products matched these filters");
      return res.json({
        success: true,
        products: [],
        total_items: 0,
        pages: 0,
        current_page: page as number,
        items_per_page: limit as number,
      });
    }
    console.error("[searchProducts] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ─── getProductsData ──────────────────────────────────────

export interface CleanProductProperty {
  name: string;
  value: string;
  units: string;
  icon: string;
}

// Corenio fully localizes property NAMES, not just values — confirmed live
// against the same real product in all 3 supported app languages:
//   en: "fitting position" | nl: "passende positie" | de: "Einbaulage"
// Matching on the English string alone silently returns null for every
// non-English request even when the data exists. One entry per supported
// language — add here if a 4th language is ever added.
const FITTING_POSITION_NAMES = new Set(["fitting position", "passende positie", "einbaulage"]);

// Corenio's "fitting position" is pulled out into its own dedicated field —
// the single highest-priority spec for this app — everything else stays in
// the general properties list. `description` is deliberately dropped
// entirely: on "fitting position" specifically it's several KB of generic
// marketing HTML (identical boilerplate on every product that has it, not
// product-specific content) — verified live, not worth ever sending to the
// app. Pure/testable — no Corenio call, just reshaping what's already there.
export function extractProductProperties(
  raw: CorenioProductProperty[] | undefined
): { fitting_position: string | null; properties: CleanProductProperty[] } {
  const all = raw ?? [];
  const fitting = all.find((p) => FITTING_POSITION_NAMES.has(p.name?.toLowerCase() ?? ""));
  const rest = all.filter((p) => !FITTING_POSITION_NAMES.has(p.name?.toLowerCase() ?? ""));
  return {
    fitting_position: fitting?.value ?? null,
    properties: rest.map((p) => ({
      name: p.name,
      value: p.value,
      units: p.units ?? "",
      icon: p.icon ?? "",
    })),
  };
}

export function transformProduct(raw: CorenioProduct, likedIds: Set<number> = new Set()) {
  const priceExVat = parseFloat(raw.prices?.consumer_ex_vat ?? "0") || 0;
  const vatPct = Number(raw.vat_percentage ?? 0);
  const priceIncVat = Math.round(priceExVat * (1 + vatPct / 100) * 100) / 100;
  const { fitting_position, properties } = extractProductProperties(raw.properties);

  return {
    product_id: raw.product_id,
    name: raw.title ?? "",
    sku: raw.sku ?? "",
    ean: raw.eancode ?? "",
    seo_url: raw.seourl ?? "",
    product_type: raw.product_type ?? "",
    product_type_id: raw.product_type_id ?? 0,
    brand: {
      id: raw.brand?.id ?? "",
      name: raw.brand?.name ?? "",
      logo: brandLogoUrl(raw.brand?.id),
    },
    price_ex_vat: priceExVat,
    price_inc_vat: priceIncVat,
    vat_percentage: vatPct,
    in_stock: (raw.internalStock ?? 0) > 0 || (raw.externalStock ?? 0) > 0,
    internal_stock: raw.internalStock ?? 0,
    external_stock: raw.externalStock ?? 0,
    call_to_order: ((raw.internalStock ?? 0) === 0 && (raw.externalStock ?? 0) === 0) || priceExVat === 0 ? CUSTOMER_CARE_NUMBER : null,
    favourite: likedIds.has(Number(raw.product_id)),
    fitting_position,
    properties,
    image: raw.images?.[0]?.url_thumb ?? null,
    images: (raw.images ?? []).map((img) => ({ id: img.id, url: img.url, url_thumb: img.url_thumb })),
    oe_numbers: (raw.oenumbers ?? []).map((oe) => ({ manufacturer: oe.manufacturer, number: oe.number })),
    // usagenumber_type comes back from Corenio with stray leading whitespace
    // (e.g. " IC Index") — confirmed straight from their raw response, not
    // introduced by us. Never meaningful to preserve in a display label.
    usage_numbers: (raw.usageNumbers ?? []).map((u) => ({
      usage_number: u.usage_number,
      usagenumber_type: u.usagenumber_type?.trim() || null,
    })),
    categories: (raw.categories ?? []).map((c) => ({
      id: c.category?.id,
      pid: c.category?.pid,
      name: c.category?.name,
      seo_path: c.category?.seo_path,
    })),
  };
}

export async function getProductsData(req: Request, res: Response): Promise<Response> {
  const { product_ids, user_id, language = "en" } = req.body as { product_ids?: number[]; user_id?: number; language?: string };

  if (!Array.isArray(product_ids) || product_ids.length === 0) {
    return res.status(400).json({ success: false, error: "Missing product_ids" });
  }

  console.log("[getProductsData] REQUEST product_ids:", product_ids, "language:", language);

  try {
    const [raw, likedResult] = await Promise.all([
      fetchProductsData(product_ids, language, req.corenioToken),
      user_id
        ? v3Pool.query(`SELECT product_id FROM v3_liked_products WHERE user_id = $1 AND product_id = ANY($2)`, [user_id, product_ids])
        : Promise.resolve({ rows: [] as { product_id: number }[] }),
    ]);
    const likedIds = new Set(likedResult.rows.map((r: { product_id: number }) => r.product_id));
    console.log("[getProductsData] RAW from Corenio:", JSON.stringify(raw, null, 2));
    const products = Array.isArray(raw) ? raw.map((p) => transformProduct(p, likedIds)) : [];
    console.log("[getProductsData] RESPONSE products count:", products.length);
    return res.json({ success: true, products });
  } catch (err) {
    console.error("[getProductsData] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ─── getProductsFilters ───────────────────────────────────

const PRIORITY_PROPERTIES = [
  "property_3563",
  "property_3958",
  "property_3960",
  "property_3962",
  "property_1363",
  "property_3954",
];

// Filter facets for a given (filters, language) combo are identical for every
// caller — no device_id or user_id involved — so this is shared across everyone,
// via a two-tier cache: Redis first (fast, in-memory), Postgres behind it
// (durable, survives a Redis flush/restart). Both are keyed identically —
// sha256(filters+language), no device_id — unlike the per-device Redis cache
// used elsewhere, so a Redis miss still shares the Postgres hit across every
// caller instead of degrading into a per-device cache.
// A row older than this is refetched from Corenio on whichever request happens
// to land next; no background job needed. Bump down (e.g. 30 min) for fresher
// facets at the cost of more Corenio calls, or up for fewer calls.
const FILTERS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FILTERS_REDIS_TTL_SECONDS = FILTERS_CACHE_TTL_MS / 1000;
const filtersRedisKey = (cacheKey: string) => `v3filters:${cacheKey}`;

export interface FiltersPayload {
  success: true;
  brands: { title: string; options: { title: string; id: number; count: number; icon: string; logo: string }[] } | null;
  properties: { id: string; title: string; options: { title: string; id: number; count: number; icon: string }[] }[];
}

// Does the actual Corenio call + transform + cache write (both Postgres and
// Redis). Shared by getProductsFilters (on a cache miss) and the background
// warmup job (src/jobs/v3FiltersWarmupJob.ts) — one code path, so the cache
// a real request populates and the cache the warmup job pre-populates are
// byte-identical in shape. Throws on a genuine Corenio failure (including
// isCorenioNoResultsError for "no filters for this combination") — callers
// decide how to handle that themselves.
export async function refreshFiltersCache(
  filters: Record<string, unknown>,
  language: string
): Promise<FiltersPayload> {
  const cacheKey = crypto.createHash("sha256").update(JSON.stringify({ filters, language })).digest("hex");
  const redisKey = filtersRedisKey(cacheKey);

  const raw = await fetchProductFilters(filters, language);

  type FilterOption = { title: string; id: number; count: number; icon: string };
  type FilterGroup  = { id: string; title: string; options: FilterOption[] };

  // Corenio mixes filter groups with pagination fields at root level — only keep valid groups
  const groups = Object.values(raw).filter(
    (g): g is CorenioFilterGroup =>
      typeof g === "object" && g !== null && "id" in g && Array.isArray((g as CorenioFilterGroup).filters)
  );

  let brands: FiltersPayload["brands"] = null;
  const priorityMap = new Map<string, FilterGroup>();
  const rest: FilterGroup[] = [];

  for (const group of groups) {
    const options = group.filters
      .filter((f: CorenioFilterGroup["filters"][0]) => f.count > 0)
      .sort((a: CorenioFilterGroup["filters"][0], b: CorenioFilterGroup["filters"][0]) => b.count - a.count)
      .map((f: CorenioFilterGroup["filters"][0]) => ({ title: f.title, id: f.id, count: f.count, icon: f.icon ?? "" }));

    if (!options.length) continue;

    const cleaned: FilterGroup = { id: group.id, title: group.title, options };

    if (group.id === "brands") {
      const brandOptions = options.map((o) => ({
        ...o,
        logo: brandLogoUrl(o.id),
      }));
      brands = { title: group.title, options: brandOptions };
    } else if (PRIORITY_PROPERTIES.includes(group.id)) {
      priorityMap.set(group.id, cleaned);
    } else {
      rest.push(cleaned);
    }
  }

  const properties = [
    ...(PRIORITY_PROPERTIES.map((id) => priorityMap.get(id)).filter(Boolean) as FilterGroup[]),
    ...rest,
  ];

  const payload: FiltersPayload = { success: true, brands, properties };

  await v3Pool.query(
    `INSERT INTO v3_filters_cache (cache_key, filters, language, data, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (cache_key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [cacheKey, JSON.stringify(filters), language, JSON.stringify(payload)]
  );
  redis.setex(redisKey, FILTERS_REDIS_TTL_SECONDS, JSON.stringify(payload))
    .catch((err: Error) => console.error("[refreshFiltersCache] Redis write error (non-fatal):", err.message));

  return payload;
}

export async function getProductsFilters(req: Request, res: Response): Promise<Response> {
  const { category_ids, categories, ktype_ids, language = "en" } = req.body as Record<string, unknown>;

  const filters: Record<string, unknown> = {};
  if (Array.isArray(category_ids) && category_ids.length) filters.category_ids = category_ids;
  if (Array.isArray(categories) && categories.length)     filters.categories   = categories;
  if (Array.isArray(ktype_ids) && ktype_ids.length)       filters.ktype_ids    = ktype_ids;

  const cacheKey = crypto
    .createHash("sha256")
    .update(JSON.stringify({ filters, language }))
    .digest("hex");
  const redisKey = filtersRedisKey(cacheKey);

  try {
    // L1: Redis — same shared key as Postgres, just faster. A read error here
    // (Redis down, etc.) falls through to Postgres rather than failing the
    // request — Redis is a speed optimization, never a hard dependency.
    try {
      const redisHit = await redis.get(redisKey);
      if (redisHit) return res.json(JSON.parse(redisHit));
    } catch (err) {
      console.error("[getProductsFilters] Redis read error (non-fatal, falling back to Postgres):", (err as Error).message);
    }

    const cached = await v3Pool.query<{ data: Record<string, unknown>; updated_at: string }>(
      `SELECT data, updated_at FROM v3_filters_cache WHERE cache_key = $1`,
      [cacheKey]
    );

    if (cached.rows.length) {
      const age = Date.now() - new Date(cached.rows[0].updated_at).getTime();
      if (age < FILTERS_CACHE_TTL_MS) {
        // Warm Redis so the next identical request (from any user) skips
        // Postgres entirely — fire-and-forget, doesn't delay this response.
        redis.setex(redisKey, FILTERS_REDIS_TTL_SECONDS, JSON.stringify(cached.rows[0].data))
          .catch((err: Error) => console.error("[getProductsFilters] Redis write error (non-fatal):", err.message));
        return res.json(cached.rows[0].data);
      }
    }

    console.log("[getProductsFilters] REQUEST filters:", JSON.stringify(filters, null, 2));

    const payload = await refreshFiltersCache(filters, language as string);
    return res.json(payload);
  } catch (err) {
    if (isCorenioNoResultsError(err)) {
      console.log("[getProductsFilters] Corenio: no filters available for these filters");
      return res.json({ success: true, brands: null, properties: [] });
    }
    console.error("[getProductsFilters] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ─── getRelevantProducts ──────────────────────────────────

export async function getRelevantProducts(req: Request, res: Response): Promise<Response> {
  const { device_id, user_id, ktype_ids, limit = 10 } = req.body as {
    device_id?: string;
    user_id?: number;
    ktype_ids?: number[];
    limit?: number;
  };

  const safeLimit = Math.min(Math.max(1, Number(limit)), 50);

  try {
    // Step 1 — Get context from DB in parallel
    const [lastSeenResult, likedResult, cartResult] = await Promise.all([
      device_id
        ? v3Pool.query(`SELECT product_id FROM v3_last_seen WHERE device_id = $1 ORDER BY seen_at DESC LIMIT 20`, [device_id])
        : Promise.resolve({ rows: [] as { product_id: number }[] }),
      user_id
        ? v3Pool.query(`SELECT product_id FROM v3_liked_products WHERE user_id = $1`, [user_id])
        : Promise.resolve({ rows: [] as { product_id: number }[] }),
      user_id
        ? v3Pool.query(`SELECT product_id FROM v3_cart WHERE user_id = $1`, [user_id])
        : Promise.resolve({ rows: [] as { product_id: number }[] }),
    ]);

    const lastSeenIds: number[] = lastSeenResult.rows.map((r: { product_id: number }) => r.product_id);
    const likedIds: number[]    = likedResult.rows.map((r: { product_id: number }) => r.product_id);
    const cartIds: number[]     = cartResult.rows.map((r: { product_id: number }) => r.product_id);
    const excludeIds = new Set([...lastSeenIds, ...likedIds, ...cartIds]);
    const contextIds = [...new Set([...lastSeenIds, ...likedIds])];

    const hasVehicle = Array.isArray(ktype_ids) && ktype_ids.length > 0;

    // Fallback — no context and no vehicle
    if (contextIds.length === 0 && !hasVehicle) {
      const likedSet = new Set(likedIds);
      const fallbackSearch = await fetchProductSearch({ category_ids: [36] }, "en", 1, safeLimit, req.corenioToken);
      const fallbackProducts = fallbackSearch.product_ids?.length
        ? (await fetchProductsData(fallbackSearch.product_ids, "en", req.corenioToken))
            .map((p) => transformProduct(p, likedSet))
        : [];
      return res.json({ success: true, products: fallbackProducts.slice(0, safeLimit), based_on: "popular" });
    }

    // Step 2 — Get top 3 category_ids from context products
    let categoryIds: number[] = [];
    if (contextIds.length > 0) {
      const productData = await fetchProductsData(contextIds, "en", req.corenioToken);
      const categoryCount = new Map<number, number>();
      for (const p of productData) {
        for (const c of p.categories ?? []) {
          const id = Number(c.category?.id);
          if (id) categoryCount.set(id, (categoryCount.get(id) ?? 0) + 1);
        }
      }
      categoryIds = [...categoryCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id]) => id);
    }

    // Step 3 — Search Corenio
    let based_on: "vehicle" | "history" | "popular" = "history";
    const searchFilters: Record<string, unknown> = {};
    if (categoryIds.length) searchFilters.category_ids = categoryIds;
    if (hasVehicle) {
      searchFilters.ktype_ids = ktype_ids;
      based_on = "vehicle";
    }

    const searchResult = await fetchProductSearch(searchFilters, "en", 1, 30, req.corenioToken);

    // Step 4 — Exclude already seen / liked / in cart
    const filteredIds = (searchResult.product_ids ?? [])
      .filter((id) => !excludeIds.has(id))
      .slice(0, safeLimit);

    if (!filteredIds.length) {
      return res.json({ success: true, products: [], based_on });
    }

    // Step 5 — Fetch full product data
    const likedSet = new Set(likedIds);
    const products = (await fetchProductsData(filteredIds, "en", req.corenioToken))
      .map((p) => transformProduct(p, likedSet));

    return res.json({ success: true, products, based_on });
  } catch (err) {
    console.error("[getRelevantProducts] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}
