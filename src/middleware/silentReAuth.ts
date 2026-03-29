import type { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import { getApi, getApiWithParamsLogin } from "../scrapers/homeScraper.js";
import { updateSessionInCache, getUserCache } from "../services/userCacheService.js";
import type { UserCacheRow } from "../types.js";

dotenv.config();

async function silentReLogin(cached: UserCacheRow): Promise<string | null> {
  const origin = process.env.END_POINT!;
  const { cartid: cartId, uniquedeviceid: uniqueDeviceId, data } = cached;
  const { phpsessid, username, passwordHash } = data;

  const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;

  try {
    await getApi(`${origin}/mijn-rekening/logout`, cartId, uniqueDeviceId, cookie, "Default");
    console.log(`[SilentReAuth] Logged out cartId: ${cartId}`);
  } catch (err) {
    console.warn(`[SilentReAuth] Logout failed (continuing): ${(err as Error).message}`);
  }

  const resource = { username, password: passwordHash };

  let loginData: unknown = await getApiWithParamsLogin(
    `${origin}/api/core/userApi/login`,
    cartId,
    uniqueDeviceId,
    cookie,
    resource
  );

  if (typeof loginData === "string") {
    try { loginData = JSON.parse(loginData); } catch {}
  }

  const loginDataObj = loginData as Record<string, Record<string, string>> | null;
  const loginSuccess =
    loginDataObj?.data?.login === "success" ||
    loginDataObj?.data?.status === "success";

  if (!loginSuccess) {
    console.error(`[SilentReAuth] Re-login failed for cartId: ${cartId}`, loginData);
    return null;
  }

  await updateSessionInCache(uniqueDeviceId, phpsessid);
  console.log(`[SilentReAuth] Re-login success for cartId: ${cartId}`);

  return phpsessid;
}

export async function silentReAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { uniqueDeviceId, cartId } = req.body as { uniqueDeviceId?: string; cartId?: string };

  if (!uniqueDeviceId || !cartId) return next();

  try {
    const cached = await getUserCache(uniqueDeviceId);

    if (!cached) {
      console.log(`[SilentReAuth] No cache for device ${uniqueDeviceId}`);
      return next();
    }

    if (cached.loggenin === 0) {
      console.log(`[SilentReAuth] User logged out — triggering silent re-auth`);
      const freshPhpsessid = await silentReLogin(cached);

      if (freshPhpsessid) {
        (req.body as Record<string, unknown>).phpsessid = freshPhpsessid;
        req.silentReAuthed = true;
      }
    }
  } catch (err) {
    console.error(`[SilentReAuth] Middleware error: ${(err as Error).message}`);
  }

  next();
}
