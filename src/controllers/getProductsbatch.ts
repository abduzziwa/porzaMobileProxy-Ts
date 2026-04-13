import type { Request, Response } from "express";
import { API } from "../services/API.js";

const BASE_URL = process.env.END_POINT!;

function proxyImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace("https://porza.s02.corenio.com", BASE_URL);
}

function proxyProductImages(product: Record<string, unknown>): Record<string, unknown> {
  if (!product?.images) return product;
  return {
    ...product,
    images: (product.images as Record<string, string>[]).map((img) => ({
      ...img,
      url: proxyImageUrl(img.url),
      url_thumb: proxyImageUrl(img.url_thumb),
    })),
  };
}

export async function getProductsBatch(req: Request, res: Response): Promise<Response> {
  try {
    const { productIds, user_lang, language } = req.body as {
      productIds?: string[];
      user_lang?: string;
      language?: string;
    };

    const lang = user_lang ?? language ?? "nl";

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, data: [], error: "Missing or empty productIds array" });
    }

    // Deduplicate and stringify ids
    const ids = [...new Set(productIds.map(String))];

    const corenioData = await API("/products/data", "POST", {
      products: ids,
      language: lang,
      options: {
        oenumbers: false,
        images: true,
        usageNumbers: false,
        measurements: false,
        package_measurements: false,
        stock: true,
        categories: false,
        brand: true,
      },
      page: 1,
      limit: ids.length,
    });

    if (!corenioData.success) {
      return res.status(502).json({ success: false, data: [], error: "Corenio API error" });
    }

    const proxied = Object.fromEntries(
      Object.entries((corenioData.products ?? {}) as Record<string, unknown>).map(
        ([id, product]) => [id, proxyProductImages(product as Record<string, unknown>)]
      )
    );

    // Return in same order as requested ids
    const ordered = ids
      .map((id) => proxied[id])
      .filter(Boolean) as Record<string, unknown>[];

    return res.status(200).json({ success: true, data: ordered });
  } catch (error) {
    return res.status(500).json({ success: false, data: [], error: "Internal server error", message: (error as Error).message });
  }
}