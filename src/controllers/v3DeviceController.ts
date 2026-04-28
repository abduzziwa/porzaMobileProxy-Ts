import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";
import { getPublicKey, decryptProxyKey } from "../services/v3CryptoService.js";
import { corenioLogin, corenioRefresh } from "../services/v3CoreniService.js";

export async function deviceCheck(req: Request, res: Response): Promise<Response> {
  const { device_id, proxy_key, server_key, platform, app_version, user_id } = req.body as {
    device_id: string;
    proxy_key?: string;
    server_key?: string;
    platform?: string;
    app_version?: string;
    user_id?: number;
  };

  if (!device_id) return res.status(400).json({ error: "Missing device_id" });

  // 1. Upsert device + log 'open' — single transaction
  const client = await v3Pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO v3_devices (device_id, platform, app_version, open_count, last_seen)
       VALUES ($1, $2, $3, 1, NOW())
       ON CONFLICT (device_id) DO UPDATE SET
         last_seen    = NOW(),
         open_count   = v3_devices.open_count + 1,
         platform     = COALESCE(EXCLUDED.platform, v3_devices.platform),
         app_version  = COALESCE(EXCLUDED.app_version, v3_devices.app_version)`,
      [device_id, platform ?? null, app_version ?? null]
    );

    await client.query(
      `INSERT INTO v3_device_analytics (device_id, user_id, event, request_path) VALUES ($1, $2, 'open', '/v3/device/check')`,
      [device_id, user_id ?? null]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    console.error("[deviceCheck] DB error:", (err as Error).message);
    return res.status(500).json({ error: "Internal server error" });
  }
  client.release();

  // 2. No keys → not logged in
  if (!proxy_key || !server_key) {
    return res.json({ authorised: false, public_key: getPublicKey() });
  }

  // 3. Verify session exists
  try {
    const sessionResult = await v3Pool.query<{ user_id: number }>(
      `SELECT ds.authorised, ds.server_key, u.user_id
       FROM v3_device_sessions ds
       JOIN v3_users u ON ds.user_id = u.user_id
       WHERE ds.device_id = $1 AND ds.proxy_key = $2 AND ds.server_key = $3`,
      [device_id, proxy_key, server_key]
    );

    if (sessionResult.rows.length === 0) {
      return res.json({ authorised: false, public_key: getPublicKey() });
    }

    const { user_id } = sessionResult.rows[0];

    // 4. Try refresh first
    try {
      const refreshed = await corenioRefresh(server_key);
      const newToken = refreshed.token;

      await v3Pool.query(
        `UPDATE v3_device_sessions SET server_key = $1, last_auth = NOW() WHERE device_id = $2 AND user_id = $3`,
        [newToken, device_id, user_id]
      );
      await v3Pool.query(
        `UPDATE v3_users SET corenio_token = $1 WHERE user_id = $2`,
        [newToken, user_id]
      );

      return res.json({ authorised: true, server_key: newToken, user_id });
    } catch {
      // 5. Refresh failed — decrypt proxy_key and do a full re-login
      try {
        const credentials = decryptProxyKey(proxy_key);
        const loginResult = await corenioLogin(credentials.email, credentials.password);
        const newToken = loginResult.token;

        await v3Pool.query(
          `UPDATE v3_device_sessions SET server_key = $1, last_auth = NOW() WHERE device_id = $2 AND user_id = $3`,
          [newToken, device_id, user_id]
        );
        await v3Pool.query(
          `UPDATE v3_users SET corenio_token = $1 WHERE user_id = $2`,
          [newToken, user_id]
        );

        return res.json({ authorised: true, server_key: newToken, user_id });
      } catch {
        return res.json({ authorised: false, public_key: getPublicKey() });
      }
    }
  } catch (err) {
    console.error("[deviceCheck] Error:", (err as Error).message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
