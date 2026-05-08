import type { Request, Response } from "express";
import {
  fetchProductSearch,
  fetchProductsData,
  fetchProductFilters,
  type CorenioProduct,
  type CorenioFilterGroup,
} from "../services/v3CoreniService.js";
import v3Pool from "../db/v3Client.js";

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
    const searchData = await fetchProductSearch(filters, language as string, page as number, limit as number);
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
      ? (await fetchProductsData(searchData.product_ids, language as string).then((raw) =>
          Array.isArray(raw)
            ? raw.map((p) => transformProduct(p, likedIds))
            : []
        ))
      : [];

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
    console.error("[searchProducts] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// ─── getProductsData ──────────────────────────────────────

export function transformProduct(raw: CorenioProduct, likedIds: Set<number> = new Set()) {
  const priceExVat = parseFloat(raw.prices?.consumer_ex_vat ?? "0") || 0;
  const vatPct = Number(raw.vat_percentage ?? 0);
  const priceIncVat = Math.round(priceExVat * (1 + vatPct / 100) * 100) / 100;

  return {
    product_id: raw.product_id,
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
    image: raw.images?.[0]?.url_thumb ?? null,
    images: (raw.images ?? []).map((img) => ({ id: img.id, url: img.url, url_thumb: img.url_thumb })),
    oe_numbers: (raw.oenumbers ?? []).map((oe) => ({ manufacturer: oe.manufacturer, number: oe.number })),
    usage_numbers: (raw.usageNumbers ?? []).map((u) => ({ usage_number: u.usage_number, usagenumber_type: u.usagenumber_type })),
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
      fetchProductsData(product_ids, language),
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

export async function getProductsFilters(req: Request, res: Response): Promise<Response> {
  const { category_ids, categories, ktype_ids, language = "en" } = req.body as Record<string, unknown>;

  const filters: Record<string, unknown> = {};
  if (Array.isArray(category_ids) && category_ids.length) filters.category_ids = category_ids;
  if (Array.isArray(categories) && categories.length)     filters.categories   = categories;
  if (Array.isArray(ktype_ids) && ktype_ids.length)       filters.ktype_ids    = ktype_ids;

  console.log("[getProductsFilters] REQUEST filters:", JSON.stringify(filters, null, 2));

  try {
    const raw = await fetchProductFilters(filters, language as string);

    type FilterOption = { title: string; id: number; count: number; icon: string };
    type FilterGroup  = { id: string; title: string; options: FilterOption[] };

    // Corenio mixes filter groups with pagination fields at root level — only keep valid groups
    const groups = Object.values(raw).filter(
      (g): g is CorenioFilterGroup =>
        typeof g === "object" && g !== null && "id" in g && Array.isArray((g as CorenioFilterGroup).filters)
    );

    let brands: { title: string; options: FilterOption[] } | null = null;
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
      ...PRIORITY_PROPERTIES.map((id) => priorityMap.get(id)).filter(Boolean),
      ...rest,
    ];

    return res.json({ success: true, brands, properties });
  } catch (err) {
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
      const fallbackSearch = await fetchProductSearch({ category_ids: [36] }, "en", 1, safeLimit);
      const fallbackProducts = fallbackSearch.product_ids?.length
        ? (await fetchProductsData(fallbackSearch.product_ids, "en"))
            .map((p) => transformProduct(p, likedSet))
        : [];
      return res.json({ success: true, products: fallbackProducts.slice(0, safeLimit), based_on: "popular" });
    }

    // Step 2 — Get top 3 category_ids from context products
    let categoryIds: number[] = [];
    if (contextIds.length > 0) {
      const productData = await fetchProductsData(contextIds, "en");
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

    const searchResult = await fetchProductSearch(searchFilters, "en", 1, 30);

    // Step 4 — Exclude already seen / liked / in cart
    const filteredIds = (searchResult.product_ids ?? [])
      .filter((id) => !excludeIds.has(id))
      .slice(0, safeLimit);

    if (!filteredIds.length) {
      return res.json({ success: true, products: [], based_on });
    }

    // Step 5 — Fetch full product data
    const likedSet = new Set(likedIds);
    const products = (await fetchProductsData(filteredIds, "en"))
      .map((p) => transformProduct(p, likedSet));

    return res.json({ success: true, products, based_on });
  } catch (err) {
    console.error("[getRelevantProducts] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}
