// import type { Request, Response, NextFunction } from "express";
// import dotenv from "dotenv";
// import { getApi, getApiWithParamsLogin } from "../scrapers/homeScraper.js";
// import { updateSessionInCache, getUserCache } from "../services/userCacheService.js";
// import type { UserCacheRow } from "../types.js";

// dotenv.config();

// async function silentReLogin(cached: UserCacheRow): Promise<string | null> {
//   const origin = process.env.END_POINT!;
//   const { cartid: cartId, uniquedeviceid: uniqueDeviceId, data } = cached;
//   const { phpsessid, username, passwordHash } = data;

//   const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;

//   try {
//     await getApi(`${origin}/mijn-rekening/logout`, cartId, uniqueDeviceId, cookie, "Default");
//     console.log(`[SilentReAuth] Logged out cartId: ${cartId}`);
//   } catch (err) {
//     console.warn(`[SilentReAuth] Logout failed (continuing): ${(err as Error).message}`);
//   }

//   const resource = { username, password: passwordHash };

//   let loginData: unknown = await getApiWithParamsLogin(
//     `${origin}/api/core/userApi/login`,
//     cartId,
//     uniqueDeviceId,
//     cookie,
//     resource
//   );

//   if (typeof loginData === "string") {
//     try { loginData = JSON.parse(loginData); } catch {}
//   }

//   const loginDataObj = loginData as Record<string, Record<string, string>> | null;
//   const loginSuccess =
//     loginDataObj?.data?.login === "success" ||
//     loginDataObj?.data?.status === "success";

//   if (!loginSuccess) {
//     console.error(`[SilentReAuth] Re-login failed for cartId: ${cartId}`, loginData);
//     return null;
//   }

//   await updateSessionInCache(uniqueDeviceId, phpsessid);
//   console.log(`[SilentReAuth] Re-login success for cartId: ${cartId}`);

//   return phpsessid;
// }

// export async function silentReAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
//   const { uniqueDeviceId, cartId } = req.body as { uniqueDeviceId?: string; cartId?: string };

//   if (!uniqueDeviceId || !cartId) return next();

//   try {
//     const cached = await getUserCache(uniqueDeviceId);

//     if (!cached) {
//       console.log(`[SilentReAuth] No cache for device ${uniqueDeviceId}`);
//       return next();
//     }

//     if (cached.loggenin === 0) {
//       console.log(`[SilentReAuth] User logged out — triggering silent re-auth`);
//       const freshPhpsessid = await silentReLogin(cached);

//       if (freshPhpsessid) {
//         (req.body as Record<string, unknown>).phpsessid = freshPhpsessid;
//         req.silentReAuthed = true;
//       }
//     }
//   } catch (err) {
//     console.error(`[SilentReAuth] Middleware error: ${(err as Error).message}`);
//   }

//   next();
// }

// school

import type { Request, Response } from "express";
import pgClient from "../services/db.js";
import { getApiWithParamsLogin } from "../scrapers/homeScraper.js";
import crypto from "crypto";
import { decrypt, update_or_insert_in_column } from "../services/userFingerprintService.js";

// POST /v1/account/silent-reauth
// Called on every app open when is_logged_in = true
// Reads encrypted email + pass_wd from app_user_state, re-logs in for a fresh session
export async function silentReAuthController(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, cartId, phpsessid } = req.body as Record<string, string>;

    if (!uniqueDeviceId) {
      return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    }

    // ── Get user state — check is_logged_in and fetch credentials ──
    const result = await pgClient.query<{
      encrypted_email: string | null;
      pass_wd: string | null;
      is_logged_in: boolean;
      cart_id: string;
    }>(
      `SELECT encrypted_email, pass_wd, is_logged_in, cart_id
       FROM app_user_state
       WHERE unique_device_id = $1`,
      [uniqueDeviceId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ success: false, reason: "no_user_state" });
    }

    const row = result.rows[0];

    // Only re-auth if user was logged in and we have their credentials
    if (!row.is_logged_in) {
      return res.status(200).json({ success: false, reason: "not_logged_in" });
    }
    if (!row.encrypted_email || !row.pass_wd) {
      return res.status(200).json({ success: false, reason: "no_credentials" });
    }

    // ── Decrypt email and password ─────────────────────────────
    let email: string, password: string;
    try {
      email = decrypt(row.encrypted_email);
      password = decrypt(row.pass_wd);
    } catch {
      return res.status(200).json({ success: false, reason: "decrypt_failed" });
    }

    // ── Re-login to Porza for a fresh phpsessid ────────────────
    const origin = process.env.END_POINT!;
    const url = `${origin}/api/core/userApi/login`;
    const activeCartId = row.cart_id || cartId;
    const cookie = `cartId=${activeCartId}; eucookie=1; PHPSESSID=${phpsessid}`;
    const passwordHash = crypto.createHash("sha1").update(password).digest("hex");

    let data: unknown = await getApiWithParamsLogin(url, activeCartId, uniqueDeviceId, cookie, {
      username: email,
      password: passwordHash,
    });
    if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }

    const dataObj = data as Record<string, Record<string, string>> | null;
    const loginSuccess = dataObj?.data?.login === "success" || dataObj?.data?.status === "success";

    if (!loginSuccess) {
      console.log(`[SilentReAuth] ❌ Failed for ${uniqueDeviceId}`);
      await update_or_insert_in_column({ udi: uniqueDeviceId, isLoggedIn: false });
      return res.status(200).json({ success: false, reason: "login_failed" });
    }

    // ── Update state — fresh session active ────────────────────
    await update_or_insert_in_column({
      udi: uniqueDeviceId,
      cid: activeCartId,
      isLoggedIn: true,
      isLive: true,
    });

    console.log(`[SilentReAuth] ✅ Session refreshed for ${uniqueDeviceId} — ${email}`);

    return res.status(200).json({
      success: true,
      cartId: activeCartId,
    });

  } catch (err) {
    console.error("[SilentReAuth] Error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}