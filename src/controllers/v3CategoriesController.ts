import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchCategoriesByParent, type RawCategory } from "../services/v3CoreniService.js";

const ROOT_PARENT_ID = 811;

interface SortedCategory {
  id: string;
  subcategories: { id: string }[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const categoriesSorted: SortedCategory[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../data/categories_sorted.json"), "utf8")
);

// Build ID → sort index maps once at startup
const topLevelOrder = new Map<string, number>(categoriesSorted.map((c, i) => [c.id, i]));

const subOrder = new Map<string, Map<string, number>>();
for (const cat of categoriesSorted) {
  subOrder.set(cat.id, new Map(cat.subcategories.map((s, i) => [s.id, i])));
}

function formatCategory(item: RawCategory) {
  return {
    id: String(item.id),
    name: item.name,
    seo_path: item.seo_path,
    image: item.image?.url_thumb?.replace(".thumb.500_", ".thumb.150_") ?? null,
  };
}

function sortByOrder(items: RawCategory[], orderMap: Map<string, number>) {
  return items.sort((a, b) => {
    const ai = orderMap.get(String(a.id)) ?? 9999;
    const bi = orderMap.get(String(b.id)) ?? 9999;
    return ai - bi;
  });
}

// POST /v3/categories
export async function getCategories(req: Request, res: Response): Promise<Response> {
  const { language = "en" } = req.body as { language?: string };

  try {
    const raw = await fetchCategoriesByParent(ROOT_PARENT_ID, language, req.corenioToken);
    const sorted = sortByOrder(raw, topLevelOrder);
    return res.json({ success: true, data: sorted.map(formatCategory) });
  } catch (err) {
    console.error("[getCategories] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// POST /v3/categories/sub
export async function getSubCategories(req: Request, res: Response): Promise<Response> {
  const { parent_id, language = "en" } = req.body as { parent_id?: number; language?: string };

  if (!parent_id) {
    return res.status(400).json({ success: false, error: "Missing parent_id" });
  }

  try {
    const raw = await fetchCategoriesByParent(parent_id, language, req.corenioToken);
    const orderMap = subOrder.get(String(parent_id)) ?? new Map<string, number>();
    const sorted = sortByOrder(raw, orderMap);
    return res.json({ success: true, data: sorted.map(formatCategory) });
  } catch (err) {
    console.error("[getSubCategories] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}
