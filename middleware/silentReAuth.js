import dotenv from "dotenv";
import { getApi, getApiWithParamsLogin } from "../src/scrapers/homeScraper.js";
import { updateSessionInCache, getUserCache } from "../src/services/userCacheService.js";
dotenv.config();
async function silentReLogin(cached) {
    const origin = process.env.END_POINT;
    const { cartid: cartId, uniquedeviceid: uniqueDeviceId, data } = cached;
    const { phpsessid, username, passwordHash } = data;
    const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;
    try {
        await getApi(`${origin}/mijn-rekening/logout`, cartId, uniqueDeviceId, cookie, "Default");
        console.log(`[SilentReAuth] Logged out cartId: ${cartId}`);
    }
    catch (err) {
        console.warn(`[SilentReAuth] Logout failed (continuing): ${err.message}`);
    }
    const resource = { username, password: passwordHash };
    let loginData = await getApiWithParamsLogin(`${origin}/api/core/userApi/login`, cartId, uniqueDeviceId, cookie, resource);
    if (typeof loginData === "string") {
        try {
            loginData = JSON.parse(loginData);
        }
        catch { }
    }
    const loginDataObj = loginData;
    const loginSuccess = loginDataObj?.data?.login === "success" ||
        loginDataObj?.data?.status === "success";
    if (!loginSuccess) {
        console.error(`[SilentReAuth] Re-login failed for cartId: ${cartId}`, loginData);
        return null;
    }
    await updateSessionInCache(uniqueDeviceId, phpsessid);
    console.log(`[SilentReAuth] Re-login success for cartId: ${cartId}`);
    return phpsessid;
}
export async function silentReAuth(req, res, next) {
    const { uniqueDeviceId, cartId } = req.body;
    if (!uniqueDeviceId || !cartId)
        return next();
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
                req.body.phpsessid = freshPhpsessid;
                req.silentReAuthed = true;
            }
        }
    }
    catch (err) {
        console.error(`[SilentReAuth] Middleware error: ${err.message}`);
    }
    next();
}
//# sourceMappingURL=silentReAuth.js.map