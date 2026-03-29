import type { Request, Response } from "express";
import { getVariable } from "../scrapers/homeScraper.js";

export async function getsearchResults(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid, url, brandSetting, page } = req.body as Record<string, unknown>;
    if (!uniqueDeviceId || !cartId || !phpsessid) return res.status(400).json({ error: "Missing required fields" });
    const cookie = `cartId=${cartId as string}; eucookie=1; PHPSESSID=${phpsessid as string}`;
    let urlWithPage = url as string;
    if (page && (page as number) > 1) urlWithPage = `${url as string}?page=${page as number}`;
    const urlEndPoint = `${process.env.END_POINT}/zoekresultaten/${urlWithPage}`;
    const variableName = brandSetting ? "brandsList" : "searchResults";
    const results = await getVariable(urlEndPoint, cartId as string, cookie, "", variableName, true);
    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message });
  }
}
