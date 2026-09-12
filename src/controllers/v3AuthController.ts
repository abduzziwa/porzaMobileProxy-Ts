import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";
import { decryptProxyKey, encryptData } from "../services/v3CryptoService.js";
import { corenioLogin, corenioSignup, corenioForgotPassword, corenioWhoami, corenioLogout, parseCorenioSignupError } from "../services/v3CoreniService.js";
import { notifyUser } from "../services/v3UserNotificationService.js";
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

const ALLOWED_LANGUAGES = new Set(["en", "nl", "de"]);

export async function authLogin(req: Request, res: Response): Promise<Response> {
  const { token: proxyKey, device_id, platform, app_version, language } = req.body as {
    token?: string;
    device_id?: string;
    platform?: string;
    app_version?: string;
    language?: string;
  };

  if (!proxyKey || !device_id) {
    return res.status(400).json({ error: "Missing token or device_id" });
  }

  const safeLanguage = language && ALLOWED_LANGUAGES.has(language) ? language : null;

  try {
    const { email, password } = decryptProxyKey(proxyKey);
    const loginResult = await corenioLogin(email, password);
    const { token: serverKey, user_id } = loginResult;

    // Update device with platform + app_version + language
    await v3Pool.query(
      `UPDATE v3_devices SET
         platform    = COALESCE($1, platform),
         app_version = COALESCE($2, app_version),
         language    = COALESCE($3, language),
         last_seen   = NOW()
       WHERE device_id = $4`,
      [platform ?? null, app_version ?? null, safeLanguage, device_id]
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

    // Upsert v3_device_sessions. RETURNING (xmax = 0) is the standard
    // Postgres idiom to tell an actual INSERT apart from the ON CONFLICT
    // UPDATE path within one atomic statement — a separate SELECT-then-INSERT
    // would race under concurrent logins. inserted=true means this exact
    // (device_id, user_id) pairing has never logged in before.
    const sessionUpsert = await v3Pool.query<{ inserted: boolean }>(
      `INSERT INTO v3_device_sessions (device_id, user_id, proxy_key, server_key, authorised)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (device_id, user_id) DO UPDATE SET
         proxy_key  = EXCLUDED.proxy_key,
         server_key = EXCLUDED.server_key,
         authorised = true,
         last_auth  = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [device_id, user_id, proxyKey, serverKey]
    );
    const isNewDevice = sessionUpsert.rows[0]?.inserted === true;

    // Log 'open' event
    await v3Pool.query(
      `INSERT INTO v3_device_analytics (device_id, user_id, event, request_path) VALUES ($1, $2, 'open', '/v3/auth/login')`,
      [device_id, user_id]
    );

    await mergeGuestDataIntoAccount(device_id, user_id);

    // Fire-and-forget security notice — only for a device/account pairing
    // that's never logged in before, not every routine login.
    if (isNewDevice) {
      notifyUser({ userId: user_id, event: "new_device_login" });
    }

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
  const {
    token: proxyKey, device_id, firstname, lastname, country, phone, platform, app_version, language,
    address, address2, addressnumber, postalcode, city, state, mobphone, companyinfo, companyname,
    chambercommerce, eori_number, vatnumber, sex,
  } = req.body as {
    token?: string;
    device_id?: string;
    firstname?: string;
    lastname?: string;
    country?: string;
    phone?: string;
    platform?: string;
    app_version?: string;
    language?: string;
    address?: string;
    address2?: string;
    addressnumber?: string;
    postalcode?: string;
    city?: string;
    state?: string;
    mobphone?: string;
    companyinfo?: string;
    companyname?: string;
    chambercommerce?: string;
    eori_number?: string;
    vatnumber?: string;
    sex?: string;
  };

  if (!proxyKey || !device_id || !firstname || !lastname) {
    return res.status(400).json({ error: "Missing token, device_id, firstname, or lastname" });
  }

  // Mirrors this install's live-verified Corenio usergroup requirements for
  // /users/create (confirmed 2026-09-06 via the bare-username probe) — fail
  // fast locally with the exact field list rather than round-tripping to
  // Corenio for something we already know is incomplete.
  const missingRequired = ([
    ["country", country], ["state", state], ["phone", phone], ["mobphone", mobphone],
    ["sex", sex], ["companyinfo", companyinfo], ["address", address],
  ] as const).filter(([, v]) => !v).map(([k]) => k);
  if (missingRequired.length) {
    return res.status(400).json({ success: false, error: "missing_fields", fields: missingRequired });
  }

  // Corenio silently stores anything outside "male"/"female" unvalidated —
  // enforce it here rather than trusting Corenio to reject bad input.
  const normalizedSex = sex === "male" || sex === "female" ? sex : undefined;
  if (!normalizedSex) {
    return res.status(400).json({ success: false, error: "invalid_fields", details: { sex: "Must be 'male' or 'female'" } });
  }

  try {
    const { email, password } = decryptProxyKey(proxyKey);

    await corenioSignup({
      username: email, email, password, firstname, lastname, country, phone,
      address, address2, addressnumber, postalcode, city, state, mobphone, companyinfo, companyname,
      chambercommerce, eori_number, vatnumber, sex: normalizedSex, gender: normalizedSex,
    });

    // Separate try/catch from the signup call above: a failure here means the
    // Corenio account now genuinely exists (confirmed live, 2026-09) but
    // can't log in yet — Corenio appears to create new accounts in a
    // not-immediately-active state (401 "Invalid credentials or account is
    // not active", reproduced on multiple fresh test accounts, unchanged
    // after 30s). That's a distinct, known condition — collapsing it into
    // the generic catch below reported it as an opaque 500, which hid a
    // successful signup behind a fake "something broke" error.
    let serverKey: string;
    let user_id: number;
    try {
      ({ token: serverKey, user_id } = await corenioLogin(email, password));
    } catch (loginErr) {
      console.error("[authSignup] Account created on Corenio but immediate login failed (likely not-yet-active):", (loginErr as Error).message);
      return res.status(202).json({
        success: false,
        error: "account_pending_activation",
        message: "Your account was created but isn't active yet. Please try logging in again in a few minutes.",
      });
    }

    const safeLanguage = language && ALLOWED_LANGUAGES.has(language) ? language : null;

    // Update device with platform + app_version + language
    await v3Pool.query(
      `UPDATE v3_devices SET
         platform    = COALESCE($1, platform),
         app_version = COALESCE($2, app_version),
         language    = COALESCE($3, language),
         last_seen   = NOW()
       WHERE device_id = $4`,
      [platform ?? null, app_version ?? null, safeLanguage, device_id]
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

    // Save the address collected at signup — Corenio's own API has no way
    // to read it back later (verified live: whoami returns only
    // user_id/username/email/firstname/lastname, nothing address-related),
    // so this local copy is the only place it's recoverable from. Stored in
    // the same encrypted_data shape/table checkout already uses (v3_addresses),
    // so getSavedAddress and any future consumer (e.g. shipping options)
    // read it unmodified regardless of whether it came from here or from a
    // past order's checkout.
    try {
      const addressPayload = {
        billing_firstname: firstname,
        billing_lastname: lastname,
        billing_email: email,
        billing_phone: phone,
        billing_address: address,
        billing_addressnumber: addressnumber,
        billing_postalcode: postalcode,
        billing_city: city,
        billing_companyname: companyname,
        billing_state: state,
        billing_mobphone: mobphone,
        billing_sex: normalizedSex,
      };
      await v3Pool.query(
        `INSERT INTO v3_addresses (user_id, encrypted_data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET encrypted_data = EXCLUDED.encrypted_data, updated_at = NOW()`,
        [user_id, encryptData(addressPayload)]
      );
    } catch (err) {
      console.error("[authSignup] Failed to save signup address (non-blocking):", (err as Error).message);
    }

    // Log 'open' event
    await v3Pool.query(
      `INSERT INTO v3_device_analytics (device_id, user_id, event, request_path) VALUES ($1, $2, 'open', '/v3/auth/signup')`,
      [device_id, user_id]
    );

    await mergeGuestDataIntoAccount(device_id, user_id);

    // Fire-and-forget — notifyUser never throws, and the response to the app
    // shouldn't wait on push delivery.
    notifyUser({ userId: user_id, event: "account_created" });

    return res.json({ proxy_key: proxyKey, server_key: serverKey, user_id });
  } catch (err) {
    const signupError = parseCorenioSignupError(err);
    if (signupError?.type === "email_taken") {
      return res.status(409).json({ success: false, error: "email_already_registered" });
    }
    if (signupError?.type === "missing_fields") {
      return res.status(400).json({ success: false, error: "missing_fields", fields: signupError.fields });
    }
    if (signupError?.type === "invalid_fields") {
      return res.status(400).json({ success: false, error: "invalid_fields", details: signupError.details });
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

  // Best-effort security notice, looked up separately from the response
  // above so it can never become a side channel — the HTTP response is
  // always { success: true } regardless of whether this finds a match.
  try {
    const userRow = await v3Pool.query<{ user_id: number }>(
      `SELECT user_id FROM v3_users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    if (userRow.rows.length) {
      notifyUser({ userId: userRow.rows[0].user_id, event: "password_reset_requested" });
    }
  } catch (err) {
    console.error("[forgotPassword] Notification lookup failed (non-blocking):", (err as Error).message);
  }

  return res.json({ success: true });
}
