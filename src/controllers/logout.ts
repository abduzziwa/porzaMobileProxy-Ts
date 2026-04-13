// import type { Request, Response } from "express";
// import { getApi } from "../scrapers/homeScraper.js";
// import { markUserLoggedOut } from "../services/userCacheService.js";

// export async function Logout(req: Request, res: Response): Promise<Response> {
//   try {
//     const { phpsessid, cartId, uniqueDeviceId } = req.body as Record<
//       string,
//       string
//     >;
//     const origin = process.env.END_POINT!;
//     const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;

//     if (!cartId)
//       return res.status(400).json({ success: false, error: "Missing cartId" });
//     if (!uniqueDeviceId)
//       return res
//         .status(400)
//         .json({ success: false, error: "Missing uniqueDeviceId" });
//     if (!phpsessid)
//       return res
//         .status(400)
//         .json({ success: false, error: "Missing phpsessid" });

//     const url = `${origin}/mijn-rekening/logout`;
//     let data: unknown = await getApi(url, cartId, uniqueDeviceId, cookie, "");
//     if (typeof data === "string") {
//       try {
//         data = JSON.parse(data);
//       } catch {}
//     }

//     await markUserLoggedOut(cartId);
//     console.log(`[LOGOUT] Marked cartId ${cartId} as logged out in cache`);

//     return res
//       .status(200)
//       .json({ success: true, cartId, uniqueDeviceId, resource: "", data });
//   } catch (err) {
//     console.error(`[LogoutAPI] Error: ${(err as Error).message}`);
//     return res
//       .status(500)
//       .json({ success: false, error: (err as Error).message });
//   }
// }


import type { Request, Response } from "express";
import { getApi } from "../scrapers/homeScraper.js";
import { update_or_insert_in_column } from "../services/userFingerprintService.js";

export async function Logout(req: Request, res: Response): Promise<Response> {
  try {
    const { phpsessid, cartId, uniqueDeviceId } =
      req.body as Record<string, string>;

    if (!cartId) return res.status(400).json({ success: false, error: "Missing cartId" });
    if (!uniqueDeviceId) return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    if (!phpsessid) return res.status(400).json({ success: false, error: "Missing phpsessid" });

    const origin = process.env.END_POINT!;
    const cookie = `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`;
    const url = `${origin}/mijn-rekening/logout`;

    let data: unknown = await getApi(url, cartId, uniqueDeviceId, cookie, "");
    if (typeof data === "string") { try { data = JSON.parse(data); } catch {} }

    // Mark logged out in fingerprint
    // Encrypted credentials are kept — so silent re-auth can work next time
    await update_or_insert_in_column({ udi: uniqueDeviceId, isLoggedIn: false, isInit: false });
    console.log(`[LOGOUT] Device ${uniqueDeviceId} logged out`);

    return res.status(200).json({ success: true, cartId, uniqueDeviceId, data });
  } catch (err) {
    console.error(`[Logout] Error: ${(err as Error).message}`);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
}