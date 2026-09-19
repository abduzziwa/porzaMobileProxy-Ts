import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";
import { getPublicKey, decryptProxyKey } from "../services/v3CryptoService.js";
import { corenioLogin, corenioRefresh } from "../services/v3CoreniService.js";

const ALLOWED_PLATFORMS = new Set(["android", "ios", "unknown"]);
const MAX_DEVICE_ID_LENGTH = 255;
const MAX_FCM_TOKEN_LENGTH = 4096;
const ALLOWED_LANGUAGES = new Set(["en", "nl", "de"]);

export async function deviceCheck(req: Request, res: Response): Promise<Response> {
  const { device_id, proxy_key, server_key, platform, app_version, language, user_id } = req.body as {
    device_id: string;
    proxy_key?: string;
    server_key?: string;
    platform?: string;
    app_version?: string;
    language?: string;
    user_id?: number;
  };

  if (!device_id) return res.status(400).json({ error: "Missing device_id" });

  // language: only store a value we can actually pick copy for — an
  // unrecognised code silently keeps whatever was there before (or the
  // column default) rather than being written as garbage.
  const safeLanguage = language && ALLOWED_LANGUAGES.has(language) ? language : null;

  // 1. Upsert device + log 'open' — single transaction
  const client = await v3Pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO v3_devices (device_id, platform, app_version, language, open_count, last_seen)
       VALUES ($1, $2, $3, COALESCE($4, 'en'), 1, NOW())
       ON CONFLICT (device_id) DO UPDATE SET
         last_seen    = NOW(),
         open_count   = v3_devices.open_count + 1,
         platform     = COALESCE(EXCLUDED.platform, v3_devices.platform),
         app_version  = COALESCE(EXCLUDED.app_version, v3_devices.app_version),
         language     = COALESCE($4, v3_devices.language)`,
      [device_id, platform ?? null, app_version ?? null, safeLanguage]
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
    const sessionResult = await v3Pool.query<{
      user_id: number;
      deleted: boolean;
      deletion_purge_at: string | null;
      deletion_purged_at: string | null;
    }>(
      `SELECT ds.authorised, ds.server_key, u.user_id, u.deleted, u.deletion_purge_at, u.deletion_purged_at
       FROM v3_device_sessions ds
       JOIN v3_users u ON ds.user_id = u.user_id
       WHERE ds.device_id = $1 AND ds.proxy_key = $2 AND ds.server_key = $3`,
      [device_id, proxy_key, server_key]
    );

    if (sessionResult.rows.length === 0) {
      return res.json({ authorised: false, public_key: getPublicKey() });
    }

    // Deleted accounts are blocked immediately on the very next app open —
    // this is the primary "tell the app to sign out and wipe local data"
    // signal, since deviceCheck runs on every launch regardless of whether
    // push notifications are enabled/permitted. deletion_purge_at lets the
    // app show a countdown; permanently_purged (once deletion_purged_at is
    // set) tells it to stop showing one and hide any "reactivate" option.
    if (sessionResult.rows[0].deleted) {
      return res.status(403).json({
        authorised: false,
        account_deleted: true,
        deletion_purge_at: sessionResult.rows[0].deletion_purge_at,
        permanently_purged: sessionResult.rows[0].deletion_purged_at !== null,
        error: "This account is no longer able to be recovered. It is in the deletion process and cannot be recovered.",
      });
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

// Called when the user changes the app's language mid-session — deviceCheck
// only refreshes language on the next app open, which could be a long way
// off; this lets the app push the change immediately so any notification
// sent in between (order confirmed, payment received, etc.) already goes
// out in the right language.
export async function updateDeviceLanguage(req: Request, res: Response): Promise<Response> {
  const { device_id, language } = req.body as { device_id?: string; language?: string };

  if (typeof device_id !== "string" || device_id.trim().length === 0 || device_id.length > MAX_DEVICE_ID_LENGTH) {
    return res.status(400).json({ error: "Invalid request" });
  }
  if (typeof language !== "string" || !ALLOWED_LANGUAGES.has(language)) {
    return res.status(400).json({ error: "Invalid language" });
  }

  try {
    const result = await v3Pool.query(
      `UPDATE v3_devices SET language = $1, last_seen = NOW() WHERE device_id = $2`,
      [language, device_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Device not found" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[updateDeviceLanguage] Error:", (err as Error).message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ─── Push token registration ──────────────────────────────────────────────
// Operates only on a device row already created by deviceCheck (POST /v3/device/check).
// Never creates a device row itself.

export async function registerPushToken(req: Request, res: Response): Promise<Response> {
  const { device_id, fcm_token, platform } = req.body as {
    device_id?: string;
    fcm_token?: string;
    platform?: string;
  };

  if (
    typeof device_id !== "string" ||
    device_id.trim().length === 0 ||
    device_id.length > MAX_DEVICE_ID_LENGTH ||
    typeof fcm_token !== "string" ||
    fcm_token.trim().length === 0 ||
    fcm_token.length > MAX_FCM_TOKEN_LENGTH ||
    (platform !== undefined && !ALLOWED_PLATFORMS.has(platform))
  ) {
    return res.status(400).json({ error: "Invalid request" });
  }

  try {
    const result = await v3Pool.query(
      `UPDATE v3_devices
       SET fcm_token = $1,
           fcm_token_status = 'active',
           notifications_enabled = TRUE,
           fcm_token_updated_at = NOW(),
           last_seen = NOW(),
           platform = COALESCE($2, platform)
       WHERE device_id = $3`,
      [fcm_token, platform ?? null, device_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Device not found" });
    }

    console.log("[registerPushToken] Token registered for device:", device_id);
    return res.status(200).json({ registered: true });
  } catch (err) {
    console.error("[registerPushToken] Error:", (err as Error).message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function removePushToken(req: Request, res: Response): Promise<Response> {
  const { device_id } = req.body as { device_id?: string };

  if (typeof device_id !== "string" || device_id.trim().length === 0 || device_id.length > MAX_DEVICE_ID_LENGTH) {
    return res.status(400).json({ error: "Invalid request" });
  }

  try {
    const result = await v3Pool.query(
      `UPDATE v3_devices
       SET fcm_token = NULL,
           fcm_token_status = 'missing',
           fcm_token_updated_at = NOW(),
           last_seen = NOW()
       WHERE device_id = $1`,
      [device_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Device not found" });
    }

    console.log("[removePushToken] Token removed for device:", device_id);
    return res.status(200).json({ unregistered: true });
  } catch (err) {
    console.error("[removePushToken] Error:", (err as Error).message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
