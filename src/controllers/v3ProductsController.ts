import type { Request, Response } from "express";
import {
  fetchProductSearch,
  fetchProductsData,
  fetchProductFilters,
  type CorenioProduct,
} from "../services/v3CoreniService.js";

// ─── searchProducts ───────────────────────────────────────

export async function searchProducts(req: Request, res: Response): Promise<Response> {
  const {
    category_ids, categories, productnumbers, eancodes,
    brands, brand_ids, producttype_ids, vehicle_ids,
    ktype_ids, property_ids,
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

    const products = searchData.product_ids?.length
      ? (await fetchProductsData(searchData.product_ids, language as string).then((raw) =>
          Array.isArray(raw)
            ? raw.map(transformProduct).filter((p) => p.internal_stock > 0 || p.external_stock > 0)
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

function transformProduct(raw: CorenioProduct) {
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
      logo: raw.brand?.logo ?? "",
    },
    price_ex_vat: priceExVat,
    price_inc_vat: priceIncVat,
    vat_percentage: vatPct,
    in_stock: (raw.internalStock ?? 0) > 0 || (raw.externalStock ?? 0) > 0,
    internal_stock: raw.internalStock ?? 0,
    external_stock: raw.externalStock ?? 0,
    image: raw.images?.[0]?.url_thumb ?? null,
    images: (raw.images ?? []).map((img) => ({ id: img.id, url: img.url, url_thumb: img.url_thumb })),
    oe_numbers: (raw.oe_numbers ?? []).map((oe) => ({ manufacturer: oe.manufacturer, number: oe.number })),
    usage_numbers: (raw.usage_numbers ?? []).map((u) => ({ usage_number: u.usage_number, usagenumber_type: u.usagenumber_type })),
    categories: (raw.categories ?? []).map((c) => ({
      id: c.category?.id,
      pid: c.category?.pid,
      name: c.category?.name,
      seo_path: c.category?.seo_path,
    })),
  };
}

export async function getProductsData(req: Request, res: Response): Promise<Response> {
  const { product_ids, language = "en" } = req.body as { product_ids?: number[]; language?: string };

  if (!Array.isArray(product_ids) || product_ids.length === 0) {
    return res.status(400).json({ success: false, error: "Missing product_ids" });
  }

  console.log("[getProductsData] REQUEST product_ids:", product_ids, "language:", language);

  try {
    const raw = await fetchProductsData(product_ids, language);
    console.log("[getProductsData] RAW from Corenio:", JSON.stringify(raw, null, 2));
    const products = Array.isArray(raw) ? raw.map(transformProduct) : [];
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
    console.log("[getProductsFilters] RAW from Corenio:", JSON.stringify(raw, null, 2));
    const groups = Object.values(raw);

    let brands: { title: string; options: { title: string; id: number; count: number }[] } | null = null;
    const priorityMap = new Map<string, { id: string; title: string; options: { title: string; id: number; count: number }[] }>();
    const rest: { id: string; title: string; options: { title: string; id: number; count: number }[] }[] = [];

    for (const group of groups) {
      const options = group.filters
        .filter((f) => f.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((f) => ({ title: f.title, id: f.id, count: f.count }));

      if (!options.length) continue;

      const cleaned = { id: group.id, title: group.title, options };

      if (group.id === "brands") {
        brands = { title: group.title, options };
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
