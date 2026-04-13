// import type { Request, Response } from "express";
// import { getApiWithParamsLogin } from "../scrapers/homeScraper.js";
// import dotenv from "dotenv";
// import * as crypto from "crypto";
// import { saveUserCache } from "../services/userCacheService.js";
// dotenv.config();

// export const sessionEmailStore = new Map<string, string>();

// export async function Login(req: Request, res: Response): Promise<Response> {
//   try {
//     const { phpsessid, cartId, uniqueDeviceId, username, password } = req.body as Record<string, string>;
//     const origin = process.env.END_POINT!;
//     const url = `${origin}/api/core/userApi/login`;
//     const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;

//     if (!cartId) return res.status(400).json({ success: false, error: "Missing cartId" });
//     if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
//     if (!phpsessid) return res.status(400).json({ success: false, error: "Missing phpsessid" });
//     if (!username) return res.status(400).json({ success: false, error: "Missing username" });
//     if (!password) return res.status(400).json({ success: false, error: "Missing password" });

//     const passwordHash = crypto.createHash("sha1").update(password).digest("hex");
//     const resource = { username, password: passwordHash };

//     let data: unknown = await getApiWithParamsLogin(url, cartId, uniqueDeviceId, cookie, resource);
//     if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }

//     const dataObj = data as Record<string, Record<string, string>> | null;
//     const loginSuccess = dataObj?.data?.login === "success" || dataObj?.data?.status === "success";

//     if (loginSuccess) {
//       await saveUserCache({ cartId, uniqueDeviceId, phpsessid, username, passwordHash });
//       sessionEmailStore.set(cartId, username);
//       console.log(`[LOGIN] Cached credentials for cartId ${cartId}: ${username}`);
//     }

//     return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource, data });
//   } catch (err) {
//     console.error(`[LoginAPI] Error: ${(err as Error).message}`);
//     return res.status(500).json({ success: false, error: (err as Error).message });
//   }
// }


// import type { Request, Response } from "express";
// import { getApiWithParamsLogin } from "../scrapers/homeScraper.js";
// import { update_or_insert_in_column } from "../services/userFingerprintService.js";
// import dotenv from "dotenv";
// import * as crypto from "crypto";
// dotenv.config();

// export const sessionEmailStore = new Map<string, string>();

// export async function Login(req: Request, res: Response): Promise<Response> {
//   try {
//     const { phpsessid, cartId, uniqueDeviceId, username, password } = req.body as Record<string, string>;
//     const origin = process.env.END_POINT!;
//     const url = `${origin}/api/core/userApi/login`;
//     const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;

//     if (!cartId) return res.status(400).json({ success: false, error: "Missing cartId" });
//     if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
//     if (!phpsessid) return res.status(400).json({ success: false, error: "Missing phpsessid" });
//     if (!username) return res.status(400).json({ success: false, error: "Missing username" });
//     if (!password) return res.status(400).json({ success: false, error: "Missing password" });

//     const passwordHash = crypto.createHash("sha1").update(password).digest("hex");
//     const resource = { username, password: passwordHash };

//     let data: unknown = await getApiWithParamsLogin(url, cartId, uniqueDeviceId, cookie, resource);
//     if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }

//     // const dataObj = data as Record<string, Record<string, string>> | null;
//     // const loginSuccess = dataObj?.data?.login === "success" || dataObj?.data?.status === "success";

//      await update_or_insert_in_column({
//         udi: uniqueDeviceId,
//         ene: username,
//         cid: cartId,
//         isLoggedIn: true,
//         isLive: true,
//         isInit: false,
//       });

//       console.log(`[LOGIN] ✅ app_user_state saved for ${uniqueDeviceId} — email: ${username}`);

//     return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource, data });
//   } catch (err) {
//     console.error(`[LoginAPI] Error: ${(err as Error).message}`);
//     return res.status(500).json({ success: false, error: (err as Error).message });
//   }
// }

// schoool

import type { Request, Response } from "express";
import { getApiWithParamsLogin } from "../scrapers/homeScraper.js";
import { update_or_insert_in_column, encrypt } from "../services/userFingerprintService.js";
import pgClient from "../services/db.js";
import dotenv from "dotenv";
import * as crypto from "crypto";
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
      sessionEmailStore.set(cartId, username);

      // ── Check if this email already has a cart_id from another device ──
      // If yes: return that cart_id so all devices share the same cart
      const encEmail = encrypt(username);

      const existing = await pgClient.query<{ cart_id: string }>(
        `SELECT cart_id FROM app_user_state
         WHERE encrypted_email = $1
         AND cart_id IS NOT NULL
         AND unique_device_id != $2
         LIMIT 1`,
        [encEmail, uniqueDeviceId]
      );

      const canonicalCartId = existing.rows.length > 0
        ? existing.rows[0].cart_id   // reuse existing cart for this email
        : cartId;                     // first login — keep current cart

      if (existing.rows.length > 0) {
        console.log(`[LOGIN] 🔗 Email already has cart_id ${canonicalCartId} — reusing for ${uniqueDeviceId}`);
      }

      // Save to app_user_state with the canonical cart_id + encrypted credentials
      await update_or_insert_in_column({
        udi: uniqueDeviceId,
        ene: username,
        cid: canonicalCartId,
        isLoggedIn: true,
        isLive: true,
        isInit: false,
        pwd: password, // stored encrypted in pass_wd for silent re-auth on app open
      });

      console.log(`[LOGIN] ✅ app_user_state saved for ${uniqueDeviceId} — email: ${username} — cartId: ${canonicalCartId}`);

      return res.status(200).json({ success: true, cartId: canonicalCartId, uniqueDeviceId, resource, data });
    }

    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource, data });
  } catch (err) {
    console.error(`[LoginAPI] Error: ${(err as Error).message}`);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}