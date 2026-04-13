// import type { Request, Response } from "express";
// import pkg from "pg";
// import dotenv from "dotenv";
// import fetch from "node-fetch";

// dotenv.config();
// const { Client } = pkg;

// const pgClient = new Client({
//   host: process.env.PG_HOST || "localhost",
//   user: process.env.PG_USER || "postgres",
//   password: process.env.PG_PASSWORD || "Root",
//   database: process.env.PG_DB || "porza_mobile",
//   port: Number(process.env.PG_PORT || 5432),
// });
// await pgClient.connect();

// interface ParsedCookies {
//   cartId?: string;
//   phpsessid?: string;
//   expiresAt?: Date;
// }

// function parseCookies(setCookieHeaders: string[]): ParsedCookies {
//   let cartId: string | undefined;
//   let phpsessid: string | undefined;
//   let expiresAt: Date | undefined;

//   for (const cookie of setCookieHeaders) {
//     if (cookie.startsWith("PHPSESSID")) {
//       phpsessid = cookie.split(";")[0].split("=")[1];
//     }
//     if (cookie.startsWith("cartId")) {
//       cartId = cookie.split(";")[0].split("=")[1];
//       const parts = cookie.split(";");
//       const expiresPart = parts.find((p) => p.trim().toLowerCase().startsWith("expires="));
//       if (expiresPart) {
//         expiresAt = new Date(expiresPart.split("=")[1].trim());
//       } else {
//         const maxAgePart = parts.find((p) => p.trim().toLowerCase().startsWith("max-age="));
//         if (maxAgePart) {
//           const maxAgeSeconds = parseInt(maxAgePart.split("=")[1].trim(), 10);
//           expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
//         }
//       }
//     }
//   }

//   return { cartId, phpsessid, expiresAt };
// }

// async function logHttpRequest(
//   uniqueDeviceId: string, method: string, endpoint: string,
//   status: number, ip: string, forwardedIp: string
// ): Promise<void> {
//   await pgClient.query(
//     `INSERT INTO http_requests (unique_device_id, method, endpoint, response_status, ip_address, forwarded_ip, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
//     [uniqueDeviceId, method, endpoint, status, ip, forwardedIp]
//   );
// }

// function isCartIdValid(createdAt: Date): boolean {
//   const yearsDiff = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365);
//   return yearsDiff < 5;
// }

// function isPhpSessionValid(updatedAt: Date): boolean {
//   const daysDiff = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
//   return daysDiff < 7;
// }

// export async function dataCollector(req: Request, res: Response): Promise<Response> {
//   try {
//     const {
//       deviceName, brand, manufacturer, modelName, deviceYearClass, totalMemory,
//       osName, osVersion, isDevice, deviceType, appName, appVersion,
//       androidId, iosIdForVendor, installationTime, appUUID, uniqueDeviceId,
//       cartId: clientCartId, phpsessid: clientPhpsessid,
//       networkType, isConnected, isInternetReachable, ipAddress,
//     } = req.body as Record<string, unknown>;

//     const clientIp =
//       (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || (ipAddress as string);

//     const deviceData = {
//       deviceName: (deviceName as string) || "Unknown",
//       brand, manufacturer, modelName, deviceYearClass, totalMemory,
//       osName, osVersion, isDevice, deviceType, appName, appVersion,
//       androidId: (androidId as string) || "N/A",
//       iosIdForVendor: (iosIdForVendor as string) || "N/A",
//       installationTime, appUUID, uniqueDeviceId,
//       networkType, isConnected, isInternetReachable, ipAddress: clientIp,
//     };

//     const existingDevice = await pgClient.query(
//       `SELECT unique_device_id FROM device_logs WHERE unique_device_id = $1`,
//       [uniqueDeviceId]
//     );
//     const isNewDevice = existingDevice.rows.length === 0;

//     if (!isNewDevice) {
//       await pgClient.query(
//         `UPDATE device_logs SET device_name=$2, brand=$3, manufacturer=$4, model_name=$5, device_year_class=$6, total_memory=$7, os_name=$8, os_version=$9, is_device=$10, device_type=$11, app_name=$12, app_version=$13, android_id=$14, ios_id_for_vendor=$15, installation_time=$16, app_uuid=$17, network_type=$18, is_connected=$19, is_internet_reachable=$20, ip_address=$21, updated_at=NOW() WHERE unique_device_id=$1`,
//         [uniqueDeviceId, deviceData.deviceName, deviceData.brand, deviceData.manufacturer, deviceData.modelName, deviceData.deviceYearClass, deviceData.totalMemory, deviceData.osName, deviceData.osVersion, deviceData.isDevice, deviceData.deviceType, deviceData.appName, deviceData.appVersion, deviceData.androidId, deviceData.iosIdForVendor, deviceData.installationTime, deviceData.appUUID, deviceData.networkType, deviceData.isConnected, deviceData.isInternetReachable, deviceData.ipAddress]
//       );
//     } else {
//       await pgClient.query(
//         `INSERT INTO device_logs (unique_device_id, device_name, brand, manufacturer, model_name, device_year_class, total_memory, os_name, os_version, is_device, device_type, app_name, app_version, android_id, ios_id_for_vendor, installation_time, app_uuid, network_type, is_connected, is_internet_reachable, ip_address, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW())`,
//         [uniqueDeviceId, deviceData.deviceName, deviceData.brand, deviceData.manufacturer, deviceData.modelName, deviceData.deviceYearClass, deviceData.totalMemory, deviceData.osName, deviceData.osVersion, deviceData.isDevice, deviceData.deviceType, deviceData.appName, deviceData.appVersion, deviceData.androidId, deviceData.iosIdForVendor, deviceData.installationTime, deviceData.appUUID, deviceData.networkType, deviceData.isConnected, deviceData.isInternetReachable, deviceData.ipAddress]
//       );
//     }

//     const porzaUrl = process.env.END_POINT!;
//     const authHeader = "Basic " + Buffer.from("porza:porza").toString("base64");

//     let cartId: string | undefined, phpsessid: string | undefined, expiresAt: Date | undefined;

//     if (!clientCartId || !clientPhpsessid) {
//       console.log("🆕 New user (no cartId/phpsessid from client), fetching credentials...");
//       const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, "X-Forwarded-For": clientIp } });
//       const raw = response.headers.raw() as Record<string, string[]>;
//       ({ cartId, phpsessid, expiresAt } = parseCookies(raw["set-cookie"] || []));

//       const existingSession = await pgClient.query(`SELECT unique_device_id FROM session_logs WHERE unique_device_id = $1`, [uniqueDeviceId]);
//       if (existingSession.rows.length > 0) {
//         await pgClient.query(`UPDATE session_logs SET cart_id=$2, phpsessid=$3, expires_at=$4, ip_address=$5, updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
//       } else {
//         await pgClient.query(`INSERT INTO session_logs (unique_device_id, cart_id, phpsessid, expires_at, ip_address, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
//       }

//       await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);
//       return res.status(200).json({ status: "success", uniqueDeviceId, cartId, phpsessid, expiresAt, isNewDevice });
//     }

//     console.log("✅ Existing user (has cartId + phpsessid), validating...");
//     const existingSession = await pgClient.query(
//       `SELECT cart_id, phpsessid, expires_at, created_at, updated_at FROM session_logs WHERE unique_device_id = $1`,
//       [uniqueDeviceId]
//     );

//     if (existingSession.rows.length === 0) {
//       console.log("⚠️ No session found in DB, creating new session...");
//       const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, "X-Forwarded-For": clientIp } });
//       const raw = response.headers.raw() as Record<string, string[]>;
//       ({ cartId, phpsessid, expiresAt } = parseCookies(raw["set-cookie"] || []));
//       await pgClient.query(`INSERT INTO session_logs (unique_device_id, cart_id, phpsessid, expires_at, ip_address, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
//       await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);
//       return res.status(200).json({ status: "success", uniqueDeviceId, cartId, phpsessid, expiresAt, isNewDevice });
//     }

//     const session = existingSession.rows[0] as { cart_id: string; phpsessid: string; expires_at: Date; created_at: Date; updated_at: Date };
//     const cartIdValid = isCartIdValid(session.created_at);
//     const phpsessidValid = isPhpSessionValid(session.updated_at);

//     if (cartIdValid && phpsessidValid && session.cart_id === clientCartId) {
//       cartId = session.cart_id; phpsessid = session.phpsessid; expiresAt = session.expires_at;
//       await pgClient.query(`UPDATE session_logs SET ip_address=$2, updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, clientIp]);
//       return res.status(200).json({ status: "success", uniqueDeviceId, cartId, phpsessid, expiresAt, isNewDevice });
//     }

//     if (cartIdValid && !phpsessidValid && session.cart_id === clientCartId) {
//       const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, Cookie: `cartId=${clientCartId as string}`, "X-Forwarded-For": clientIp } });
//       const raw = response.headers.raw() as Record<string, string[]>;
//       const { phpsessid: newPhpsessid } = parseCookies(raw["set-cookie"] || []);
//       cartId = session.cart_id; phpsessid = newPhpsessid || session.phpsessid; expiresAt = session.expires_at;
//       await pgClient.query(`UPDATE session_logs SET phpsessid=$2, ip_address=$3, updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, phpsessid, clientIp]);
//       await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);
//       return res.status(200).json({ status: "success", uniqueDeviceId, cartId, phpsessid, expiresAt, isNewDevice });
//     }

//     const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, "X-Forwarded-For": clientIp } });
//     const raw = response.headers.raw() as Record<string, string[]>;
//     ({ cartId, phpsessid, expiresAt } = parseCookies(raw["set-cookie"] || []));
//     await pgClient.query(`UPDATE session_logs SET cart_id=$2, phpsessid=$3, expires_at=$4, ip_address=$5, created_at=NOW(), updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
//     await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);
//     return res.status(200).json({ status: "success", uniqueDeviceId, cartId, phpsessid, expiresAt, isNewDevice });
//   } catch (err) {
//     console.error("❌ Error in dataCollector:", (err as Error).message);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// }




// import type { Request, Response } from "express";
// import pkg from "pg";
// import dotenv from "dotenv";
// import fetch from "node-fetch";
// import { update_or_insert_in_column } from "../services/userFingerprintService.js";

// dotenv.config();
// const { Client } = pkg;

// const pgClient = new Client({
//   host: process.env.PG_HOST || "localhost",
//   user: process.env.PG_USER || "postgres",
//   password: process.env.PG_PASSWORD || "Root",
//   database: process.env.PG_DB || "porza_mobile",
//   port: Number(process.env.PG_PORT || 5432),
// });
// await pgClient.connect();

// interface ParsedCookies {
//   cartId?: string;
//   phpsessid?: string;
//   expiresAt?: Date;
// }

// function parseCookies(setCookieHeaders: string[]): ParsedCookies {
//   let cartId: string | undefined;
//   let phpsessid: string | undefined;
//   let expiresAt: Date | undefined;

//   for (const cookie of setCookieHeaders) {
//     if (cookie.startsWith("PHPSESSID")) {
//       phpsessid = cookie.split(";")[0].split("=")[1];
//     }
//     if (cookie.startsWith("cartId")) {
//       cartId = cookie.split(";")[0].split("=")[1];
//       const parts = cookie.split(";");
//       const expiresPart = parts.find((p) => p.trim().toLowerCase().startsWith("expires="));
//       if (expiresPart) {
//         expiresAt = new Date(expiresPart.split("=")[1].trim());
//       } else {
//         const maxAgePart = parts.find((p) => p.trim().toLowerCase().startsWith("max-age="));
//         if (maxAgePart) {
//           const maxAgeSeconds = parseInt(maxAgePart.split("=")[1].trim(), 10);
//           expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
//         }
//       }
//     }
//   }
//   return { cartId, phpsessid, expiresAt };
// }

// async function logHttpRequest(
//   uniqueDeviceId: string, method: string, endpoint: string,
//   status: number, ip: string, forwardedIp: string
// ): Promise<void> {
//   try {
//     await pgClient.query(
//       `INSERT INTO http_requests (unique_device_id, method, endpoint, response_status, ip_address, forwarded_ip, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
//       [uniqueDeviceId, method, endpoint, status, ip, forwardedIp]
//     );
//   } catch { /* non-critical */ }
// }

// function isCartIdValid(createdAt: Date): boolean {
//   const yearsDiff = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365);
//   return yearsDiff < 5;
// }

// function isPhpSessionValid(updatedAt: Date): boolean {
//   const daysDiff = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
//   return daysDiff < 7;
// }

// export async function dataCollector(req: Request, res: Response): Promise<Response> {
//   try {
//     const {
//       deviceName, brand, manufacturer, modelName, deviceYearClass, totalMemory,
//       osName, osVersion, isDevice, deviceType, appName, appVersion,
//       androidId, iosIdForVendor, installationTime, appUUID, uniqueDeviceId,
//       cartId: clientCartId, phpsessid: clientPhpsessid,
//       networkType, isConnected, isInternetReachable, ipAddress,
//     } = req.body as Record<string, unknown>;

//     const clientIp =
//       (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || (ipAddress as string);

//     const deviceData = {
//       deviceName: (deviceName as string) || "Unknown",
//       brand, manufacturer, modelName, deviceYearClass, totalMemory,
//       osName, osVersion, isDevice, deviceType, appName, appVersion,
//       androidId: (androidId as string) || "N/A",
//       iosIdForVendor: (iosIdForVendor as string) || "N/A",
//       installationTime, appUUID, uniqueDeviceId,
//       networkType, isConnected, isInternetReachable, ipAddress: clientIp,
//     };

//     // ── device_logs ────────────────────────────────────────────
//     const existingDevice = await pgClient.query(
//       `SELECT unique_device_id FROM device_logs WHERE unique_device_id = $1`,
//       [uniqueDeviceId]
//     );
//     const isNewDevice = existingDevice.rows.length === 0;

//     if (!isNewDevice) {
//       await pgClient.query(
//         `UPDATE device_logs SET device_name=$2, brand=$3, manufacturer=$4, model_name=$5, device_year_class=$6, total_memory=$7, os_name=$8, os_version=$9, is_device=$10, device_type=$11, app_name=$12, app_version=$13, android_id=$14, ios_id_for_vendor=$15, installation_time=$16, app_uuid=$17, network_type=$18, is_connected=$19, is_internet_reachable=$20, ip_address=$21, updated_at=NOW() WHERE unique_device_id=$1`,
//         [uniqueDeviceId, deviceData.deviceName, deviceData.brand, deviceData.manufacturer, deviceData.modelName, deviceData.deviceYearClass, deviceData.totalMemory, deviceData.osName, deviceData.osVersion, deviceData.isDevice, deviceData.deviceType, deviceData.appName, deviceData.appVersion, deviceData.androidId, deviceData.iosIdForVendor, deviceData.installationTime, deviceData.appUUID, deviceData.networkType, deviceData.isConnected, deviceData.isInternetReachable, deviceData.ipAddress]
//       );
//     } else {
//       await pgClient.query(
//         `INSERT INTO device_logs (unique_device_id, device_name, brand, manufacturer, model_name, device_year_class, total_memory, os_name, os_version, is_device, device_type, app_name, app_version, android_id, ios_id_for_vendor, installation_time, app_uuid, network_type, is_connected, is_internet_reachable, ip_address, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW())`,
//         [uniqueDeviceId, deviceData.deviceName, deviceData.brand, deviceData.manufacturer, deviceData.modelName, deviceData.deviceYearClass, deviceData.totalMemory, deviceData.osName, deviceData.osVersion, deviceData.isDevice, deviceData.deviceType, deviceData.appName, deviceData.appVersion, deviceData.androidId, deviceData.iosIdForVendor, deviceData.installationTime, deviceData.appUUID, deviceData.networkType, deviceData.isConnected, deviceData.isInternetReachable, deviceData.ipAddress]
//       );
//     }

//     // ── session_logs ───────────────────────────────────────────
//     const porzaUrl = process.env.END_POINT!;
//     const authHeader = "Basic " + Buffer.from("porza:porza").toString("base64");

//     let cartId: string | undefined, phpsessid: string | undefined, expiresAt: Date | undefined;

//     if (!clientCartId || !clientPhpsessid) {
//       console.log("🆕 New user (no cartId/phpsessid from client), fetching credentials...");
//       const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, "X-Forwarded-For": clientIp } });
//       const raw = response.headers.raw() as Record<string, string[]>;
//       ({ cartId, phpsessid, expiresAt } = parseCookies(raw["set-cookie"] || []));

//       const existingSession = await pgClient.query(`SELECT unique_device_id FROM session_logs WHERE unique_device_id = $1`, [uniqueDeviceId]);
//       if (existingSession.rows.length > 0) {
//         await pgClient.query(`UPDATE session_logs SET cart_id=$2, phpsessid=$3, expires_at=$4, ip_address=$5, updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
//       } else {
//         await pgClient.query(`INSERT INTO session_logs (unique_device_id, cart_id, phpsessid, expires_at, ip_address, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
//       }
//       await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);

//     } else {
//       console.log("✅ Existing user (has cartId + phpsessid), validating...");
//       const existingSession = await pgClient.query(
//         `SELECT cart_id, phpsessid, expires_at, created_at, updated_at FROM session_logs WHERE unique_device_id = $1`,
//         [uniqueDeviceId]
//       );

//       if (existingSession.rows.length === 0) {
//         console.log("⚠️ No session found in DB, creating new session...");
//         const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, "X-Forwarded-For": clientIp } });
//         const raw = response.headers.raw() as Record<string, string[]>;
//         ({ cartId, phpsessid, expiresAt } = parseCookies(raw["set-cookie"] || []));
//         await pgClient.query(`INSERT INTO session_logs (unique_device_id, cart_id, phpsessid, expires_at, ip_address, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
//         await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);

//       } else {
//         const session = existingSession.rows[0] as { cart_id: string; phpsessid: string; expires_at: Date; created_at: Date; updated_at: Date };
//         const cartIdValid = isCartIdValid(session.created_at);
//         const phpsessidValid = isPhpSessionValid(session.updated_at);

//         if (cartIdValid && phpsessidValid && session.cart_id === clientCartId) {
//           cartId = session.cart_id; phpsessid = session.phpsessid; expiresAt = session.expires_at;
//           await pgClient.query(`UPDATE session_logs SET ip_address=$2, updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, clientIp]);

//         } else if (cartIdValid && !phpsessidValid && session.cart_id === clientCartId) {
//           const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, Cookie: `cartId=${clientCartId as string}`, "X-Forwarded-For": clientIp } });
//           const raw = response.headers.raw() as Record<string, string[]>;
//           const { phpsessid: newPhpsessid } = parseCookies(raw["set-cookie"] || []);
//           cartId = session.cart_id; phpsessid = newPhpsessid || session.phpsessid; expiresAt = session.expires_at;
//           await pgClient.query(`UPDATE session_logs SET phpsessid=$2, ip_address=$3, updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, phpsessid, clientIp]);
//           await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);

//         } else {
//           const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, "X-Forwarded-For": clientIp } });
//           const raw = response.headers.raw() as Record<string, string[]>;
//           ({ cartId, phpsessid, expiresAt } = parseCookies(raw["set-cookie"] || []));
//           await pgClient.query(`UPDATE session_logs SET cart_id=$2, phpsessid=$3, expires_at=$4, ip_address=$5, created_at=NOW(), updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
//           await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);
//         }
//       }
//     }

//     // ── app_user_state init ────────────────────────────────────
//     // Creates row if new, only touches last_updated_at if exists
//     try {
//       await update_or_insert_in_column({
//         udi: uniqueDeviceId as string,
//         cid: cartId!,
//         isLoggedIn: false,
//         isLive: true,
//         isInit: true,
//       });
//     } catch (err) {
//       console.error("⚠️ app_user_state init failed (non-critical):", (err as Error).message);
//     }

//     return res.status(200).json({ status: "success", uniqueDeviceId, cartId, phpsessid, expiresAt, isNewDevice });

//   } catch (err) {
//     console.error("❌ Error in dataCollector:", (err as Error).message);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// }

// school

import type { Request, Response } from "express";
import pkg from "pg";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { update_or_insert_in_column } from "../services/userFingerprintService.js";

dotenv.config();
const { Client } = pkg;

const pgClient = new Client({
  host: process.env.PG_HOST || "localhost",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "Root",
  database: process.env.PG_DB || "porza_mobile",
  port: Number(process.env.PG_PORT || 5432),
});
await pgClient.connect();

interface ParsedCookies {
  cartId?: string;
  phpsessid?: string;
  expiresAt?: Date;
}

function parseCookies(setCookieHeaders: string[]): ParsedCookies {
  let cartId: string | undefined;
  let phpsessid: string | undefined;
  let expiresAt: Date | undefined;

  for (const cookie of setCookieHeaders) {
    if (cookie.startsWith("PHPSESSID")) {
      phpsessid = cookie.split(";")[0].split("=")[1];
    }
    if (cookie.startsWith("cartId")) {
      cartId = cookie.split(";")[0].split("=")[1];
      const parts = cookie.split(";");
      const expiresPart = parts.find((p) => p.trim().toLowerCase().startsWith("expires="));
      if (expiresPart) {
        expiresAt = new Date(expiresPart.split("=")[1].trim());
      } else {
        const maxAgePart = parts.find((p) => p.trim().toLowerCase().startsWith("max-age="));
        if (maxAgePart) {
          const maxAgeSeconds = parseInt(maxAgePart.split("=")[1].trim(), 10);
          expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
        }
      }
    }
  }
  return { cartId, phpsessid, expiresAt };
}

async function logHttpRequest(
  uniqueDeviceId: string, method: string, endpoint: string,
  status: number, ip: string, forwardedIp: string
): Promise<void> {
  try {
    await pgClient.query(
      `INSERT INTO http_requests (unique_device_id, method, endpoint, response_status, ip_address, forwarded_ip, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [uniqueDeviceId, method, endpoint, status, ip, forwardedIp]
    );
  } catch { /* non-critical */ }
}

function isCartIdValid(createdAt: Date): boolean {
  const yearsDiff = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365);
  return yearsDiff < 5;
}

function isPhpSessionValid(updatedAt: Date): boolean {
  const daysDiff = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysDiff < 7;
}

export async function dataCollector(req: Request, res: Response): Promise<Response> {
  try {
    const {
      deviceName, brand, manufacturer, modelName, deviceYearClass, totalMemory,
      osName, osVersion, isDevice, deviceType, appName, appVersion,
      androidId, iosIdForVendor, installationTime, appUUID, uniqueDeviceId,
      cartId: clientCartId, phpsessid: clientPhpsessid,
      networkType, isConnected, isInternetReachable, ipAddress,
    } = req.body as Record<string, unknown>;

    const clientIp =
      (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || (ipAddress as string);

    const deviceData = {
      deviceName: (deviceName as string) || "Unknown",
      brand, manufacturer, modelName, deviceYearClass, totalMemory,
      osName, osVersion, isDevice, deviceType, appName, appVersion,
      androidId: (androidId as string) || "N/A",
      iosIdForVendor: (iosIdForVendor as string) || "N/A",
      installationTime, appUUID, uniqueDeviceId,
      networkType, isConnected, isInternetReachable, ipAddress: clientIp,
    };

    // ── device_logs ────────────────────────────────────────────
    const existingDevice = await pgClient.query(
      `SELECT unique_device_id FROM device_logs WHERE unique_device_id = $1`,
      [uniqueDeviceId]
    );
    const isNewDevice = existingDevice.rows.length === 0;

    if (!isNewDevice) {
      await pgClient.query(
        `UPDATE device_logs SET device_name=$2, brand=$3, manufacturer=$4, model_name=$5, device_year_class=$6, total_memory=$7, os_name=$8, os_version=$9, is_device=$10, device_type=$11, app_name=$12, app_version=$13, android_id=$14, ios_id_for_vendor=$15, installation_time=$16, app_uuid=$17, network_type=$18, is_connected=$19, is_internet_reachable=$20, ip_address=$21, updated_at=NOW() WHERE unique_device_id=$1`,
        [uniqueDeviceId, deviceData.deviceName, deviceData.brand, deviceData.manufacturer, deviceData.modelName, deviceData.deviceYearClass, deviceData.totalMemory, deviceData.osName, deviceData.osVersion, deviceData.isDevice, deviceData.deviceType, deviceData.appName, deviceData.appVersion, deviceData.androidId, deviceData.iosIdForVendor, deviceData.installationTime, deviceData.appUUID, deviceData.networkType, deviceData.isConnected, deviceData.isInternetReachable, deviceData.ipAddress]
      );
    } else {
      await pgClient.query(
        `INSERT INTO device_logs (unique_device_id, device_name, brand, manufacturer, model_name, device_year_class, total_memory, os_name, os_version, is_device, device_type, app_name, app_version, android_id, ios_id_for_vendor, installation_time, app_uuid, network_type, is_connected, is_internet_reachable, ip_address, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW())`,
        [uniqueDeviceId, deviceData.deviceName, deviceData.brand, deviceData.manufacturer, deviceData.modelName, deviceData.deviceYearClass, deviceData.totalMemory, deviceData.osName, deviceData.osVersion, deviceData.isDevice, deviceData.deviceType, deviceData.appName, deviceData.appVersion, deviceData.androidId, deviceData.iosIdForVendor, deviceData.installationTime, deviceData.appUUID, deviceData.networkType, deviceData.isConnected, deviceData.isInternetReachable, deviceData.ipAddress]
      );
    }

    // ── session_logs ───────────────────────────────────────────
    const porzaUrl = process.env.END_POINT!;
    const authHeader = "Basic " + Buffer.from("porza:porza").toString("base64");

    let cartId: string | undefined, phpsessid: string | undefined, expiresAt: Date | undefined;

    if (!clientCartId || !clientPhpsessid) {
      console.log("🆕 New user (no cartId/phpsessid from client), fetching credentials...");
      const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, "X-Forwarded-For": clientIp } });
      const raw = response.headers.raw() as Record<string, string[]>;
      ({ cartId, phpsessid, expiresAt } = parseCookies(raw["set-cookie"] || []));

      const existingSession = await pgClient.query(`SELECT unique_device_id FROM session_logs WHERE unique_device_id = $1`, [uniqueDeviceId]);
      if (existingSession.rows.length > 0) {
        await pgClient.query(`UPDATE session_logs SET cart_id=$2, phpsessid=$3, expires_at=$4, ip_address=$5, updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
      } else {
        await pgClient.query(`INSERT INTO session_logs (unique_device_id, cart_id, phpsessid, expires_at, ip_address, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
      }
      await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);

    } else {
      console.log("✅ Existing user (has cartId + phpsessid), validating...");
      const existingSession = await pgClient.query(
        `SELECT cart_id, phpsessid, expires_at, created_at, updated_at FROM session_logs WHERE unique_device_id = $1`,
        [uniqueDeviceId]
      );

      if (existingSession.rows.length === 0) {
        console.log("⚠️ No session found in DB, creating new session...");
        const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, "X-Forwarded-For": clientIp } });
        const raw = response.headers.raw() as Record<string, string[]>;
        ({ cartId, phpsessid, expiresAt } = parseCookies(raw["set-cookie"] || []));
        await pgClient.query(`INSERT INTO session_logs (unique_device_id, cart_id, phpsessid, expires_at, ip_address, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
        await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);

      } else {
        const session = existingSession.rows[0] as { cart_id: string; phpsessid: string; expires_at: Date; created_at: Date; updated_at: Date };
        const cartIdValid = isCartIdValid(session.created_at);
        const phpsessidValid = isPhpSessionValid(session.updated_at);

        if (cartIdValid && phpsessidValid && session.cart_id === clientCartId) {
          cartId = session.cart_id; phpsessid = session.phpsessid; expiresAt = session.expires_at;
          await pgClient.query(`UPDATE session_logs SET ip_address=$2, updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, clientIp]);

        } else if (cartIdValid && !phpsessidValid && session.cart_id === clientCartId) {
          const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, Cookie: `cartId=${clientCartId as string}`, "X-Forwarded-For": clientIp } });
          const raw = response.headers.raw() as Record<string, string[]>;
          const { phpsessid: newPhpsessid } = parseCookies(raw["set-cookie"] || []);
          cartId = session.cart_id; phpsessid = newPhpsessid || session.phpsessid; expiresAt = session.expires_at;
          await pgClient.query(`UPDATE session_logs SET phpsessid=$2, ip_address=$3, updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, phpsessid, clientIp]);
          await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);

        } else {
          const response = await fetch(porzaUrl, { method: "GET", headers: { Authorization: authHeader, "X-Forwarded-For": clientIp } });
          const raw = response.headers.raw() as Record<string, string[]>;
          ({ cartId, phpsessid, expiresAt } = parseCookies(raw["set-cookie"] || []));
          await pgClient.query(`UPDATE session_logs SET cart_id=$2, phpsessid=$3, expires_at=$4, ip_address=$5, created_at=NOW(), updated_at=NOW() WHERE unique_device_id=$1`, [uniqueDeviceId, cartId, phpsessid, expiresAt, clientIp]);
          await logHttpRequest(uniqueDeviceId as string, req.method, porzaUrl, response.status, clientIp, clientIp);
        }
      }
    }

    // ── app_user_state init ────────────────────────────────────
    // If email is provided (re-init after login), check if that email
    // already has a canonical cart_id and use that instead
    const { email: clientEmail } = req.body as Record<string, unknown>;
    let canonicalCartId = cartId!;

    if (clientEmail) {
      try {
        const { encrypt } = await import("../services/userFingerprintService.js");
        const encEmail = encrypt(clientEmail as string);

        const emailLookup = await pgClient.query<{ cart_id: string }>(
          `SELECT cart_id FROM app_user_state
           WHERE encrypted_email = $1
           AND cart_id IS NOT NULL
           AND unique_device_id != $2
           LIMIT 1`,
          [encEmail, uniqueDeviceId]
        );

        if (emailLookup.rows.length > 0) {
          canonicalCartId = emailLookup.rows[0].cart_id;
          console.log(`[DataCollector] 🔗 Email match found — using canonical cart_id: ${canonicalCartId} for ${uniqueDeviceId as string}`);

          // Also update session_logs to use the canonical cart_id
          await pgClient.query(
            `UPDATE session_logs SET cart_id = $1, updated_at = NOW() WHERE unique_device_id = $2`,
            [canonicalCartId, uniqueDeviceId]
          );
        }
      } catch (err) {
        console.warn("⚠️ Email cart lookup failed (non-critical):", (err as Error).message);
      }
    }

    try {
      await update_or_insert_in_column({
        udi: uniqueDeviceId as string,
        cid: canonicalCartId,
        isLoggedIn: false,
        isLive: true,
        isInit: true,
      });
    } catch (err) {
      console.error("⚠️ app_user_state init failed (non-critical):", (err as Error).message);
    }

    return res.status(200).json({ status: "success", uniqueDeviceId, cartId: canonicalCartId, phpsessid, expiresAt, isNewDevice });

  } catch (err) {
    console.error("❌ Error in dataCollector:", (err as Error).message);
    return res.status(500).json({ error: "Internal server error" });
  }
}