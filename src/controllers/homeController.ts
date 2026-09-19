import type { Request, Response } from "express";
import { API } from "../services/API.js";
import pgClient from "../services/db.js";

const BASEURL = process.env.END_POINT!;

function formatCategories(newApiData: Record<string, unknown>): unknown[] {
  return Object.values(newApiData)
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !!(item as Record<string,unknown>).id)
    .map((item) => ({
      id: String(item.id),
      url: item.seo_path,
      name: item.name,
      image: ((item.image as Record<string,string>)?.url_thumb ?? (item.image as string) ?? "").replace("https://porza.s02.corenio.com", BASEURL),
    }));
}

export async function homeController(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid, user_lang } = req.body as Record<string, string>;
    if (!uniqueDeviceId || !cartId || !phpsessid) {
      return res.status(400).json({ error: "Missing required fields", required: ["uniqueDeviceId", "cartId", "phpsessid"] });
    }

    const variableName = "catalogBackupJSON";
    const { rows } = await pgClient.query(
      `SELECT variable_value, created_at FROM request_logs WHERE cart_id=$1 AND variable_name=$2 ORDER BY created_at DESC LIMIT 1`,
      [cartId, variableName]
    );

    if (rows.length > 0) {
      const { variable_value, created_at } = rows[0] as { variable_value: string; created_at: Date };
      const ageInDays = (Date.now() - new Date(created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (ageInDays <= 7) {
        try {
          const parsedValue = typeof variable_value === "string" ? JSON.parse(variable_value) : variable_value;
          if (parsedValue) return res.status(200).json({ success: true, data: parsedValue, cached: true });
        } catch { console.warn("⚠️ Failed to parse cached JSON, falling back to API"); }
      }
    }

    console.log("♻️ Cache expired or missing, calling new API...");
    const rawData = await API("/categories/byParent", "POST", { parent_id: 811, language: user_lang, page: 1, limit: 100 });
    const catalogData = formatCategories(rawData);
    return res.status(200).json({ success: true, data: catalogData, cached: false });
  } catch (error) {
    console.error("Error in homeController:", (error instanceof Error ? error.message : String(error)));
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message });
  }
}
