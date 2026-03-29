import type { Request, Response } from "express";
import { getApiWithParamsLogin } from "../scrapers/homeScraper.js";
import dotenv from "dotenv";
import * as crypto from "crypto";
import { saveUserCache } from "../services/userCacheService.js";
dotenv.config();

export const sessionEmailStore = new Map<string, string>();

export async function Login(req: Request, res: Response): Promise<Response> {
  try {
    const { phpsessid, cartId, uniqueDeviceId, username, password } = req.body as Record<string, string>;
    const origin = process.env.END_POINT!;
    const url = `${origin}/api/core/userApi/login`;
    const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;

    if (!cartId) return res.status(400).json({ success: false, error: "Missing cartId" });
    if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    if (!phpsessid) return res.status(400).json({ success: false, error: "Missing phpsessid" });
    if (!username) return res.status(400).json({ success: false, error: "Missing username" });
    if (!password) return res.status(400).json({ success: false, error: "Missing password" });

    const passwordHash = crypto.createHash("sha1").update(password).digest("hex");
    const resource = { username, password: passwordHash };

    let data: unknown = await getApiWithParamsLogin(url, cartId, uniqueDeviceId, cookie, resource);
    if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }

    const dataObj = data as Record<string, Record<string, string>> | null;
    const loginSuccess = dataObj?.data?.login === "success" || dataObj?.data?.status === "success";

    if (loginSuccess) {
      await saveUserCache({ cartId, uniqueDeviceId, phpsessid, username, passwordHash });
      sessionEmailStore.set(cartId, username);
      console.log(`[LOGIN] Cached credentials for cartId ${cartId}: ${username}`);
    }

    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource, data });
  } catch (err) {
    console.error(`[LoginAPI] Error: ${(err as Error).message}`);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}
