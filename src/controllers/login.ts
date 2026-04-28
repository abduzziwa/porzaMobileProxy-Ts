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
import { update_or_insert_in_column } from "../services/userFingerprintService.js";
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

    const dataObj = data as Record<string, string> | null;
    console.log(dataObj)
    const loginSuccess = dataObj?.login === "success" || dataObj?.status === "success";

    if (loginSuccess) {
      sessionEmailStore.set(cartId, username);

      // ── Check device_logs for an existing cart_id linked to this email ──
      const existing = await pgClient.query<{ cart_id: string }>(
        `SELECT sl.cart_id
         FROM device_logs dl
         JOIN session_logs sl ON sl.unique_device_id = dl.unique_device_id
         WHERE dl.user_email = $1
         AND dl.unique_device_id != $2
         AND sl.cart_id IS NOT NULL
         ORDER BY sl.created_at ASC
         LIMIT 1`,
        [username, uniqueDeviceId]
      );

      let canonicalCartId: string;

      if (existing.rows.length > 0) {
        // Email already exists — just reuse that cart_id, no DB writes needed
        canonicalCartId = existing.rows[0].cart_id;
        console.log(`[LOGIN] 🔗 Email found — reusing cart_id ${canonicalCartId} for ${uniqueDeviceId}`);
      } else {
        // First time this email is seen — stamp it on this device
        canonicalCartId = cartId;
        await pgClient.query(
          `UPDATE device_logs SET user_email = $1 WHERE unique_device_id = $2`,
          [username, uniqueDeviceId]
        );
        console.log(`[LOGIN] ✅ New email stamped on device ${uniqueDeviceId} — cart_id: ${canonicalCartId}`);
      }

      // Save to app_user_state for silent re-auth
      await update_or_insert_in_column({
        udi: uniqueDeviceId,
        ene: username,
        cid: canonicalCartId,
        isLoggedIn: true,
        isLive: true,
        isInit: false,
        pwd: password,
      });

      return res.status(200).json({ success: true, cartId: canonicalCartId, uniqueDeviceId, resource, data });
    }

    return res.status(200).json({ success: true, cartId, uniqueDeviceId, resource, data });
  } catch (err) {
    console.error(`[LoginAPI] Error: ${(err as Error).message}`);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}