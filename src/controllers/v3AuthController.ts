import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";
import { decryptProxyKey } from "../services/v3CryptoService.js";
import { corenioLogin, corenioSignup, corenioForgotPassword, corenioWhoami, corenioLogout } from "../services/v3CoreniService.js";
import redis from "../services/v3RedisService.js";
import axios from "axios";

// Additive merge: a guest's device-scoped cart/liked/vehicle selection becomes
// theirs once they log in on that same device. Cart quantities sum, liked
// products dedupe, vehicle selection is last-write-wins (single value, not a set).
// Non-fatal — login must still succeed even if a merge step fails.
async function mergeGuestDataIntoAccount(device_id: string, user_id: number): Promise<void> {
  try {
    await v3Pool.query(
      `INSERT INTO v3_cart (device_id, user_id, product_id, quantity)
       SELECT device_id, $2, product_id, quantity FROM v3_cart WHERE device_id = $1 AND user_id IS NULL
       ON CONFLICT (user_id, product_id) WHERE user_id IS NOT NULL
       DO UPDATE SET quantity = v3_cart.quantity + EXCLUDED.quantity, updated_at = NOW()`,
      [device_id, user_id]
    );
    await v3Pool.query(`DELETE FROM v3_cart WHERE device_id = $1 AND user_id IS NULL`, [device_id]);

    await v3Pool.query(
      `INSERT INTO v3_liked_products (device_id, user_id, product_id)
       SELECT device_id, $2, product_id FROM v3_liked_products WHERE device_id = $1 AND user_id IS NULL
       ON CONFLICT (user_id, product_id) WHERE user_id IS NOT NULL DO NOTHING`,
      [device_id, user_id]
    );
    await v3Pool.query(`DELETE FROM v3_liked_products WHERE device_id = $1 AND user_id IS NULL`, [device_id]);

    await v3Pool.query(
      `INSERT INTO v3_device_vehicles (device_id, user_id, selected_car, updated_at)
       SELECT device_id, $2, selected_car, NOW() FROM v3_device_vehicles WHERE device_id = $1 AND user_id IS NULL
       ON CONFLICT (device_id, user_id) DO UPDATE SET selected_car = EXCLUDED.selected_car, updated_at = NOW()`,
      [device_id, user_id]
    );
    await v3Pool.query(`DELETE FROM v3_device_vehicles WHERE device_id = $1 AND user_id IS NULL`, [device_id]);
  } catch (err) {
    console.error("[mergeGuestDataIntoAccount] Error (non-fatal):", err);
  }
}

export async function authLogin(req: Request, res: Response): Promise<Response> {
  const { token: proxyKey, device_id, platform, app_version } = req.body as {
    token?: string;
    device_id?: string;
    platform?: string;
    app_version?: string;
  };

  if (!proxyKey || !device_id) {
    return res.status(400).json({ error: "Missing token or device_id" });
  }

  try {
    const { email, password } = decryptProxyKey(proxyKey);
    const loginResult = await corenioLogin(email, password);
    const { token: serverKey, user_id } = loginResult;

    // Update device with platform + app_version
    await v3Pool.query(
      `UPDATE v3_devices SET
         platform    = COALESCE($1, platform),
         app_version = COALESCE($2, app_version),
         last_seen   = NOW()
       WHERE device_id = $3`,
      [platform ?? null, app_version ?? null, device_id]
    );

    // Upsert v3_users
    await v3Pool.query(
      `INSERT INTO v3_users (user_id, email, corenio_token)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         email         = EXCLUDED.email,
         corenio_token = EXCLUDED.corenio_token`,
      [user_id, email, serverKey]
    );

    // Upsert v3_device_sessions
    await v3Pool.query(
      `INSERT INTO v3_device_sessions (device_id, user_id, proxy_key, server_key, authorised)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (device_id, user_id) DO UPDATE SET
         proxy_key  = EXCLUDED.proxy_key,
         server_key = EXCLUDED.server_key,
         authorised = true,
         last_auth  = NOW()`,
      [device_id, user_id, proxyKey, serverKey]
    );

    // Log 'open' event
    await v3Pool.query(
      `INSERT INTO v3_device_analytics (device_id, user_id, event, request_path) VALUES ($1, $2, 'open', '/v3/auth/login')`,
      [device_id, user_id]
    );

    await mergeGuestDataIntoAccount(device_id, user_id);

    return res.json({ proxy_key: proxyKey, server_key: serverKey, user_id });
  } catch (err) {
    const isInvalidCreds =
      (axios.isAxiosError(err) && (err.response?.status === 400 || err.response?.status === 401)) ||
      (err as { isInvalidCredentials?: boolean }).isInvalidCredentials;
    if (isInvalidCreds) {
      return res.json({ authorised: false, error: "invalid_credentials" });
    }
    console.error("[authLogin] Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function authSignup(req: Request, res: Response): Promise<Response> {
  const { token: proxyKey, device_id, firstname, lastname, country, phone, platform, app_version } = req.body as {
    token?: string;
    device_id?: string;
    firstname?: string;
    lastname?: string;
    country?: string;
    phone?: string;
    platform?: string;
    app_version?: string;
  };

  if (!proxyKey || !device_id || !firstname || !lastname) {
    return res.status(400).json({ error: "Missing token, device_id, firstname, or lastname" });
  }

  try {
    const { email, password } = decryptProxyKey(proxyKey);

    await corenioSignup({ username: email, email, password, firstname, lastname, country, phone });
    const { token: serverKey, user_id } = await corenioLogin(email, password);

    // Update device with platform + app_version
    await v3Pool.query(
      `UPDATE v3_devices SET
         platform    = COALESCE($1, platform),
         app_version = COALESCE($2, app_version),
         last_seen   = NOW()
       WHERE device_id = $3`,
      [platform ?? null, app_version ?? null, device_id]
    );

    // Upsert v3_users
    await v3Pool.query(
      `INSERT INTO v3_users (user_id, email, corenio_token)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         email         = EXCLUDED.email,
         corenio_token = EXCLUDED.corenio_token`,
      [user_id, email, serverKey]
    );

    // Upsert v3_device_sessions
    await v3Pool.query(
      `INSERT INTO v3_device_sessions (device_id, user_id, proxy_key, server_key, authorised)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (device_id, user_id) DO UPDATE SET
         proxy_key  = EXCLUDED.proxy_key,
         server_key = EXCLUDED.server_key,
         authorised = true,
         last_auth  = NOW()`,
      [device_id, user_id, proxyKey, serverKey]
    );

    // Log 'open' event
    await v3Pool.query(
      `INSERT INTO v3_device_analytics (device_id, user_id, event, request_path) VALUES ($1, $2, 'open', '/v3/auth/signup')`,
      [device_id, user_id]
    );

    await mergeGuestDataIntoAccount(device_id, user_id);

    return res.json({ proxy_key: proxyKey, server_key: serverKey, user_id });
  } catch (err) {
    const isDuplicate = axios.isAxiosError(err) && (err.response?.status === 400 || err.response?.status === 409);
    if (isDuplicate) {
      return res.status(409).json({ success: false, error: "email_already_registered" });
    }
    console.error("[authSignup] Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getMe(req: Request, res: Response): Promise<Response> {
  const { user_id, device_id } = req.body as { user_id?: number; device_id?: string };

  if (!user_id || !device_id) return res.status(400).json({ success: false, error: "Missing user_id or device_id" });

  try {
    const result = await v3Pool.query(
      `SELECT corenio_token FROM v3_users WHERE user_id = $1`,
      [user_id]
    );

    if (!result.rows.length || !result.rows[0].corenio_token) {
      return res.status(401).json({ success: false, error: "User not found or not authorised" });
    }

    const data = await corenioWhoami(result.rows[0].corenio_token as string);
    return res.json({ success: true, user: data });
  } catch (err) {
    console.error("[getMe] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function getActiveSessions(req: Request, res: Response): Promise<Response> {
  const { user_id, device_id } = req.body as { user_id?: number; device_id?: string };

  if (!user_id || !device_id) return res.status(400).json({ success: false, error: "Missing user_id or device_id" });

  try {
    const result = await v3Pool.query(
      `SELECT
         ds.device_id,
         ds.authorised,
         ds.last_auth,
         ds.created_at  AS session_created,
         d.platform,
         d.app_version,
         d.last_seen
       FROM v3_device_sessions ds
       JOIN v3_devices d ON d.device_id = ds.device_id
       WHERE ds.user_id = $1
       ORDER BY d.last_seen DESC`,
      [user_id]
    );

    const sessions = result.rows.map((row: {
      device_id: string;
      authorised: boolean;
      last_auth: string;
      session_created: string;
      platform: string;
      app_version: string;
      last_seen: string;
    }) => ({
      device_id: row.device_id,
      is_current: row.device_id === device_id,
      platform: row.platform ?? null,
      app_version: row.app_version ?? null,
      authorised: row.authorised,
      last_seen: row.last_seen,
      last_auth: row.last_auth,
      session_created: row.session_created,
    }));

    return res.json({ success: true, total: sessions.length, sessions });
  } catch (err) {
    console.error("[getActiveSessions] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function authLogout(req: Request, res: Response): Promise<Response> {
  const { user_id, device_id, logout_all = false } = req.body as {
    user_id?: number;
    device_id?: string;
    logout_all?: boolean;
  };

  if (!user_id || !device_id) return res.status(400).json({ success: false, error: "Missing user_id or device_id" });

  try {
    const userResult = await v3Pool.query(
      `SELECT corenio_token FROM v3_users WHERE user_id = $1`,
      [user_id]
    );

    // Call Corenio logout if we have a token — fire and forget, don't block on failure
    if (userResult.rows.length && userResult.rows[0].corenio_token) {
      corenioLogout(userResult.rows[0].corenio_token as string).catch((err) =>
        console.error("[authLogout] Corenio logout failed (non-blocking):", err)
      );
    }

    // Clear session(s) from DB
    if (logout_all) {
      await v3Pool.query(`DELETE FROM v3_device_sessions WHERE user_id = $1`, [user_id]);
    } else {
      await v3Pool.query(`DELETE FROM v3_device_sessions WHERE device_id = $1 AND user_id = $2`, [device_id, user_id]);
    }

    // Clear Redis cache for this device
    const keys = await redis.keys(`v3cache:${device_id}:*`);
    if (keys.length) await redis.del(...keys);

    return res.json({ success: true });
  } catch (err) {
    console.error("[authLogout] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export async function forgotPassword(req: Request, res: Response): Promise<Response> {
  const { email } = req.body as { email?: string };

  if (!email) return res.status(400).json({ error: "Missing email" });

  try {
    await corenioForgotPassword(email);
  } catch {
    // Swallow errors — never confirm whether email exists
  }

  return res.json({ success: true });
}
