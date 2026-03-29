import type { Request, Response } from "express";
import { acquireTab, releaseTab } from "../scrapers/homeScraper.js";

export async function getHelpDeskCode(req: Request, res: Response): Promise<Response> {
  let tab = null;
  try {
    const { cartId, phpsessid } = req.body as Record<string, string>;
    if (!cartId || !phpsessid) return res.status(400).json({ error: "Missing required fields", required: ["cartId", "phpsessid"] });

    const urlEndPoint = process.env.END_POINT!;
    tab = await acquireTab();
    const page = tab.page;

    const headers: Record<string, string> = { Referer: "" };
    if (process.env.AUTH_CREDENTIALS) headers["Authorization"] = `Basic ${process.env.AUTH_CREDENTIALS}`;
    await page.setExtraHTTPHeaders(headers);

    const cookieString = `cartId="${cartId}"; eucookie=1; PHPSESSID="${phpsessid}"`;
    const cookies = cookieString.split(";").map((c) => {
      const [name, value] = c.split("=");
      return { name: name.trim(), value: value.replace(/"/g, "").trim(), domain: new URL(urlEndPoint).hostname };
    });
    if (cookies.length) await page.setCookie(...cookies);

    await page.goto(urlEndPoint, { waitUntil: "networkidle2" });
    await page.waitForFunction("window.helpdeskcode !== undefined && window.helpdeskcode !== null", { timeout: 10000 });

    const helpDeskCode = await page.evaluate(() => {
      const w = globalThis as Record<string, unknown>;
      if (!w.helpdeskcode) return null;
      const obj = (Array.isArray(w.helpdeskcode) ? (w.helpdeskcode as Record<string,string>[])[0] : w.helpdeskcode) as Record<string, string>;
      return obj.helpDeskCodeHere || obj.helpDeskCode || null;
    });

    if (!helpDeskCode) return res.status(500).json({ error: "helpDeskCode not found on page" });

    await releaseTab(tab);
    tab = null;

    return res.status(200).json({ success: true, data: { helpDeskCode } });
  } catch (error) {
    if (tab) await releaseTab(tab);
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message });
  }
}
