import type { Request, Response } from "express";
import { API } from "../services/API.js";
import pgClient from "../services/db.js";
import dotenv from "dotenv";
dotenv.config();

function formatSubCategories(newApiData: Record<string, unknown>): unknown[] {
  const baseUrl = process.env.END_POINT!;
  return Object.values(newApiData)
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !!(item as Record<string,unknown>).id)
    .map((item) => ({
      id: String(item.id),
      url: `${baseUrl}${item.seo_path as string}`,
      title: item.name,
      subitems: "0",
      cat_icon: ((item.image as Record<string, string>)?.url_thumb?.replace("https://porza.s02.corenio.com", baseUrl)?.replace(".thumb.500_", ".thumb.150_")) ?? null,
    }));
}

export async function subCatController(req: Request, res: Response): Promise<Response> {
  try {
    const { phpsessid, cartId, uniqueDeviceId, resource, language = "nl" } = req.body as Record<string, string>;
    if (!cartId) return res.status(400).json({ success: false, error: "Missing cartId" });
    if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    if (!resource) return res.status(400).json({ success: false, error: "Missing resource" });
    if (!phpsessid) return res.status(400).json({ success: false, error: "Missing phpsessid" });

    const { rows } = await pgClient.query(
      `SELECT variable_value, created_at FROM request_logs WHERE cat_id=$1 AND variable_name=$2 AND language=$3 ORDER BY created_at DESC LIMIT 1`,
      [cartId, resource, language]
    );

    if (rows.length > 0) {
      const { variable_value, created_at } = rows[0] as { variable_value: string; created_at: Date };
      const ageInDays = (Date.now() - new Date(created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (ageInDays <= 7) {
        try {
          const parsedValue = typeof variable_value === "string" ? JSON.parse(variable_value) : variable_value;
          if (parsedValue) return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource, data: parsedValue, cached: true });
        } catch { console.warn("⚠️ Failed to parse cached JSON, falling back to API"); }
      }
    }

    const rawData = await API("/categories/byParent", "POST", { parent_id: Number(resource), language, page: 1, limit: 100 });
    const items = formatSubCategories(rawData);
    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource, data: items, cached: false });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}
