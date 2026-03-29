import type { Request, Response } from "express";
import type { Page } from "puppeteer";
import { acquireTab, releaseTab, queue } from "../scrapers/homeScraper.js";

async function waitForFittingList(page: Page, timeoutMs: number): Promise<unknown[] | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await page.evaluate(() => {
        const w = globalThis as Record<string, unknown>;
        if (typeof w.fittingList !== "undefined" && w.fittingList !== null) return w.fittingList;
        return null;
      });
      if (result !== null) return result as unknown[];
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

export async function getFittingList(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid, url } = req.body as Record<string, string>;
    if (!uniqueDeviceId || !cartId || !phpsessid || !url) return res.status(400).json({ error: "Missing required fields" });

    const result = await queue.add(async () => {
      let tab = null;
      try {
        tab = await acquireTab();
        const page = tab.page;
        const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;
        const cookieParts = cookie.split(";").map((c) => c.trim()).filter(Boolean).map((pair) => {
          const eqIdx = pair.indexOf("=");
          return { name: eqIdx >= 0 ? pair.slice(0, eqIdx) : pair, value: eqIdx >= 0 ? pair.slice(eqIdx + 1) : "", domain: new URL(url).hostname };
        });
        if (cookieParts.length > 0) await page.setCookie(...cookieParts);

        const headers: Record<string, string> = { Referer: "" };
        if (process.env.AUTH_CREDENTIALS) headers["Authorization"] = `Basic ${process.env.AUTH_CREDENTIALS}`;
        await page.setExtraHTTPHeaders(headers);
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        await new Promise((resolve) => setTimeout(resolve, 500));

        const brandsListExists = await page.evaluate(() => {
          const w = globalThis as Record<string, unknown>;
          return typeof w.brandsList !== "undefined" && w.brandsList !== null;
        });
        if (!brandsListExists) return { success: true, data: [], message: "Page not loaded" };

        const fittingList = await waitForFittingList(page, 30000);
        if (fittingList === null) return { success: true, data: [], message: "No fitting positions" };
        return { success: true, data: fittingList || [] };
      } finally {
        if (tab) await releaseTab(tab);
      }
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", message: (error as Error).message });
  }
}
