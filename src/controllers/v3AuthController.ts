import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";
import { decryptProxyKey } from "../services/v3CryptoService.js";
import { corenioLogin, corenioForgotPassword } from "../services/v3CoreniService.js";
import axios from "axios";

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
