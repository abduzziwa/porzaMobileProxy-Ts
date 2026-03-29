import type { Request, Response } from "express";
import { getVariable } from "../scrapers/homeScraper.js";
import pgClient from "../services/db.js";

export async function getCarBrands(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid } = req.body as Record<string, string>;
    if (!uniqueDeviceId || !cartId || !phpsessid) return res.status(400).json({ error: "Missing required fields" });
    const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;
    const url = `${process.env.END_POINT}/?jsonAbdulBrand=1`;
    const variableName = "carBrand";

    const { rows } = await pgClient.query(`SELECT variable_value, created_at FROM request_logs WHERE url=$1 AND cat_id=$2 AND variable_name=$3 ORDER BY created_at DESC LIMIT 1`, [url, cartId, variableName]);
    if (rows.length > 0) {
      const { variable_value, created_at } = rows[0] as { variable_value: string; created_at: Date };
      const ageInDays = (Date.now() - new Date(created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (ageInDays <= 3) {
        try {
          const parsedValue = typeof variable_value === "string" ? JSON.parse(variable_value) : variable_value;
          if (parsedValue) return res.status(200).json({ success: true, data: parsedValue });
        } catch { console.warn("⚠️ Failed to parse cached JSON, falling back to scraper"); }
      }
    }

    const carBrands = await getVariable(url, cartId, cookie, "", variableName);
    return res.status(200).json({ success: true, data: carBrands });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message });
  }
}
