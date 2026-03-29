import type { Request, Response } from "express";
import { API } from "../services/API.js";

const BASE_URL = process.env.END_POINT!;

interface RawProduct { product_id: unknown; sku?: string; eancode?: string; title?: string; description_long?: string; description_short?: string; brand?: { id?: unknown; name?: string; logo?: string }; categories?: { category: { id?: unknown; name?: string } }[]; seourl?: string; images?: { url_thumb?: string; url?: string }[]; prices?: { consumer_ex_vat?: string }; vat_percentage?: unknown; internalStock?: number; externalStock?: number; measurements?: { weight_gram?: number; length_mm?: number; width_mm?: number; height_mm?: number; unit_type?: string }; }

function formatProduct(p: RawProduct) {
  const mainImage = p.images?.[0]?.url_thumb?.replace("https://porza.s02.corenio.com", BASE_URL) ?? "";
  const fallbackImage = p.images?.[0]?.url?.replace("https://porza.s02.corenio.com", BASE_URL) ?? "";
  const allImages = (p.images || []).map((img) => img.url_thumb?.replace("https://porza.s02.corenio.com", BASE_URL) ?? "");
  const category = p.categories?.[0]?.category;
  return { product: { id: String(p.product_id), sku: p.sku ?? "", ean: p.eancode ?? "", title: p.title ?? "", title_clean: p.title ?? "", description: p.description_long ?? "", description_short: p.description_short ?? "", productnumber: p.sku ?? "", brand: { id: p.brand?.id ?? "", name: p.brand?.name ?? "", logo: p.brand?.logo ?? "" }, category: { id: String(category?.id ?? ""), name: category?.name ?? "" }, url: `/product/${p.seourl}`, url_raw: `/${p.seourl}`, active: "active", source: "tecdoc" }, pricing: { price: parseFloat(p.prices?.consumer_ex_vat ?? "0"), page_price: parseFloat(p.prices?.consumer_ex_vat ?? "0"), currency: "€", consumer_price: p.prices?.consumer_ex_vat ?? "0", vat_percentage: String(p.vat_percentage ?? "21.00"), discount_active: "0" }, stock: { simple_text: (p.internalStock ?? 0) > 0 || (p.externalStock ?? 0) > 0 ? "Op voorraad" : "Niet op voorraad maar wel te bestellen", order_allowed: "1", total_available: String(p.internalStock ?? 0), external_available: String(p.externalStock ?? 0) }, media: { main_image: mainImage, thumbnail: mainImage, fallback: fallbackImage, all_images: allImages }, specs: { weight: String(p.measurements?.weight_gram ?? 0), length: String(p.measurements?.length_mm ?? 0), width: String(p.measurements?.width_mm ?? 0), height: String(p.measurements?.height_mm ?? 0), commodity_code: "0", unit_type: p.measurements?.unit_type || "Stuk" } };
}

export async function getProducts(req: Request, res: Response): Promise<Response> {
  let brands: string[] = [];
  try {
    const { uniqueDeviceId, cartId, phpsessid, url, page, language = "nl" } = req.body as Record<string, unknown>;
    const currentPage = (page as number) ?? 1;
    if (!uniqueDeviceId || !cartId || !phpsessid || !url) return res.status(400).json({ error: "Missing required fields" });

    const seoPath = (url as string).replace(BASE_URL, "");
    brands = ((req.body as Record<string, string[]>).brands || []).map((b: string) => b.trim().toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase()));
    const ktype = (req.body as Record<string, unknown>).ktype ?? null;
    const filters: Record<string, unknown> = { categories: [seoPath], ...(brands.length > 0 ? { brands } : {}), ...(ktype ? { ktype_ids: [ktype] } : {}) };

    const searchResult = await API("/products/search", "POST", { filters, page, limit: 10 });
    const productIds = (searchResult?.["product-ids"] as unknown[]) ?? [];
    if (productIds.length === 0) return res.status(200).json({ success: true, data: [], total_items: 0, pages: 0, current_page: currentPage });

    const productData = await API("/products/data", "POST", { products: productIds, language, options: { oenumbers: false, images: true, usageNumbers: false, measurements: true, package_measurements: false, stock: true, categories: true, brand: true }, page: 1, limit: 30 });
    const formatted = Object.values((productData?.products ?? {}) as Record<string, RawProduct>).map(formatProduct);

    return res.status(200).json({ success: true, data: formatted, total_items: searchResult.total_items, pages: searchResult.pages, current_page: currentPage });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message, data: brands });
  }
}
