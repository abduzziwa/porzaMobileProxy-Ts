// import type { Request, Response } from "express";
// import { API } from "../services/API.js";

// const BASE_URL = process.env.END_POINT!;

// function proxyImageUrl(url: string | null | undefined): string | null {
//   if (!url) return null;
//   return url.replace("https://porza.s02.corenio.com", BASE_URL);
// }

// function proxyProductImages(product: Record<string, unknown>): Record<string, unknown> {
//   if (!product?.images) return product;
//   return { ...product, images: (product.images as Record<string, string>[]).map((img) => ({ ...img, url: proxyImageUrl(img.url), url_thumb: proxyImageUrl(img.url_thumb) })) };
// }

// export async function getProductById(req: Request, res: Response): Promise<Response> {
//   try {
//     const { productId } = req.body as { productId?: string };
//     if (!productId) return res.status(400).json({ success: false, data: null, error: "Missing required field: productId" });

//     const corenioData = await API("/products/data", "POST", { products: [String(productId)], language: "en", options: { oenumbers: true, images: true, usageNumbers: true, measurements: true, package_measurements: true, stock: true, categories: true, brand: true }, page: 1, limit: 10 });

//     if (!corenioData.success) return res.status(502).json({ success: false, data: null, error: "Corenio API returned an error", message: corenioData.error_message ?? [] });

//     const proxiedProducts = Object.fromEntries(Object.entries((corenioData.products ?? {}) as Record<string, unknown>).map(([id, product]) => [id, proxyProductImages(product as Record<string, unknown>)]));

//     return res.status(200).json({ success: true, data: { ...corenioData, products: proxiedProducts } });
//   } catch (error) {
//     return res.status(500).json({ success: false, data: null, error: "Internal server error", message: (error as Error).message });
//   }
// }


import type { Request, Response } from "express";
import { API } from "../services/API.js";

const BASE_URL = process.env.END_POINT!;

function proxyImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace("https://porza.s02.corenio.com", BASE_URL);
}

function proxyProductImages(product: Record<string, unknown>): Record<string, unknown> {
  if (!product?.images) return product;
  return { ...product, images: (product.images as Record<string, string>[]).map((img) => ({ ...img, url: proxyImageUrl(img.url), url_thumb: proxyImageUrl(img.url_thumb) })) };
}

export async function getProductById(req: Request, res: Response): Promise<Response> {
  try {
    const { productId, user_lang } = req.body as { productId?: string; user_lang?: string; language?: string };
    const lang = user_lang ?? "en";
    if (!productId) return res.status(400).json({ success: false, data: null, error: "Missing required field: productId" });

    const corenioData = await API("/products/data", "POST", { products: [String(productId)], language: lang, options: { oenumbers: true, images: true, usageNumbers: true, measurements: true, package_measurements: true, stock: true, categories: true, brand: true }, page: 1, limit: 10 });
    console.log('Languageeeeee : ' + lang)
    if (!corenioData.success) return res.status(502).json({ success: false, data: null, error: "Corenio API returned an error", message: corenioData.error_message ?? [] });

    const proxiedProducts = Object.fromEntries(Object.entries((corenioData.products ?? {}) as Record<string, unknown>).map(([id, product]) => [id, proxyProductImages(product as Record<string, unknown>)]));

    return res.status(200).json({ success: true, data: { ...corenioData, products: proxiedProducts } });
  } catch (error) {
    return res.status(500).json({ success: false, data: null, error: "Internal server error", message: (error as Error).message });
  }
}