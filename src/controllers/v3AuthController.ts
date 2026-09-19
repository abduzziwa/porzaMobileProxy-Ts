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

// Pure — testable without hitting Corenio. Mirrors this install's
// live-verified usergroup requirements for /users/create (confirmed
// 2026-09-06 via the bare-username probe). Returns the field names missing,
// in the same order they're checked, for a direct 400 response — an empty
// string counts as missing, not just undefined/null.
export function findMissingSignupFields(fields: {
  country?: string;
  state?: string;
  phone?: string;
  mobphone?: string;
  sex?: string;
  companyinfo?: string;
  address?: string;
}): string[] {
  return ([
    ["country", fields.country], ["state", fields.state], ["phone", fields.phone], ["mobphone", fields.mobphone],
    ["sex", fields.sex], ["companyinfo", fields.companyinfo], ["address", fields.address],
  ] as const).filter(([, v]) => !v).map(([k]) => k);
}

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

    // Deleted accounts are blocked immediately, everywhere — even though
    // Corenio itself still authenticates them (it has no concept of our
    // soft-delete), checked before any session/device write happens.
    const deletionCheck = await v3Pool.query<{ deleted: boolean; deletion_purge_at: string | null; deletion_purged_at: string | null }>(
      `SELECT deleted, deletion_purge_at, deletion_purged_at FROM v3_users WHERE user_id = $1`,
      [user_id]
    );
    if (deletionCheck.rows[0]?.deleted) {
      // deletion_purged_at present = already permanently purged, no
      // countdown to show and reactivation will be rejected too. Absent =
      // still within the grace window — frontend computes "X days left"
      // from deletion_purge_at and can offer reactivation.
      return res.status(403).json({
        authorised: false,
        account_deleted: true,
        deletion_purge_at: deletionCheck.rows[0].deletion_purge_at,
        permanently_purged: deletionCheck.rows[0].deletion_purged_at !== null,
        error: "This account is no longer able to be recovered. It is in the deletion process and cannot be recovered.",
      });
    }

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
  const missingRequired = findMissingSignupFields({ country, state, phone, mobphone, sex, companyinfo, address });
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

// Apple App Store Guideline 5.1.1(v) compliance: apps that support account
// creation must support in-app account deletion. Corenio has no delete
// endpoint, so this is a soft-delete on our side — real, permanent PII
// removal happens later via the scheduled purge job
// (src/jobs/v3AccountPurgeJob.ts), 30 days out. That 30-day window is a
// backend-only retention buffer (support/fraud disputes), NOT a "log back in
// to cancel" feature — login is blocked immediately, everywhere, the moment
// this runs (see the `deleted` check in authLogin and deviceCheck).
// Pure/testable — no DB, just the date arithmetic every caller needs.
export const ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 30;

export function computeDeletionPurgeDate(requestedAt: Date): Date {
  const purgeAt = new Date(requestedAt);
  purgeAt.setUTCDate(purgeAt.getUTCDate() + ACCOUNT_DELETION_GRACE_PERIOD_DAYS);
  return purgeAt;
}

export async function deleteAccount(req: Request, res: Response): Promise<Response> {
  const { user_id, device_id } = req.body as { user_id?: number; device_id?: string };

  if (!user_id || !device_id) {
    return res.status(400).json({ success: false, error: "Missing user_id or device_id" });
  }

  try {
    const requestedAt = new Date();
    const purgeAt = computeDeletionPurgeDate(requestedAt);

    // Idempotent: a second call from the same (already-deleted) account just
    // confirms success without resetting the original request/purge timer —
    // v3Session's own middleware would normally block a second call anyway
    // (deleted accounts fail the session check below), but this guards the
    // DB write itself against ever silently extending someone's data
    // retention window via a stray retry.
    const result = await v3Pool.query<{ deletion_purge_at: string }>(
      `UPDATE v3_users
       SET deleted = TRUE,
           deletion_requested_at = COALESCE(deletion_requested_at, $2),
           deletion_purge_at = COALESCE(deletion_purge_at, $3),
           deletion_requested_device_id = COALESCE(deletion_requested_device_id, $4)
       WHERE user_id = $1
       RETURNING deletion_purge_at`,
      [user_id, requestedAt, purgeAt, device_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Account not found" });
    }

    // Revoke every session on every device for this account — not just the
    // requesting device. Deleting an account should sign you out everywhere,
    // and this also closes the deviceCheck silent-refresh path immediately
    // rather than relying solely on the `deleted` check catching it.
    const sessions = await v3Pool.query<{ device_id: string; corenio_token: string | null }>(
      `UPDATE v3_device_sessions ds
       SET authorised = FALSE
       FROM v3_users u
       WHERE ds.user_id = u.user_id AND ds.user_id = $1
       RETURNING ds.device_id, u.corenio_token`,
      [user_id]
    );

    // Best-effort: invalidate the Corenio-side token too and clear every
    // affected device's Redis cache. Neither blocks the response — the
    // account is already soft-deleted in our own DB regardless of whether
    // these succeed.
    const corenioToken = sessions.rows[0]?.corenio_token;
    if (corenioToken) {
      corenioLogout(corenioToken).catch((err) =>
        console.error("[deleteAccount] Corenio logout failed (non-blocking):", err)
      );
    }
    for (const { device_id: sessionDeviceId } of sessions.rows) {
      redis.keys(`v3cache:${sessionDeviceId}:*`)
        .then((keys) => { if (keys.length) return redis.del(...keys); })
        .catch((err) => console.error("[deleteAccount] Redis cache clear failed (non-blocking):", err));
    }

    // Audit trail — who requested it, from which device, when.
    // v3_device_analytics.event is VARCHAR(20) — "account_delete" (14
    // chars) fits; the longer "account_deletion_requested" doesn't (that
    // full name is still used as-is for the NotificationEvent/translation
    // lookup below, a separate, much wider column).
    await v3Pool.query(
      `INSERT INTO v3_device_analytics (device_id, user_id, event, request_path, meta)
       VALUES ($1, $2, 'account_delete', '/v3/auth/delete-account', $3)`,
      [device_id, user_id, JSON.stringify({ requested_at: requestedAt.toISOString(), purge_at: purgeAt.toISOString() })]
    );

    // Confirmation notification — also doubles as a security alert: if this
    // wasn't actually the account owner, this is their signal to act.
    notifyUser({ userId: user_id, event: "account_deletion_requested" }).catch((err) =>
      console.error("[deleteAccount] Confirmation notification failed (non-blocking):", err)
    );

    console.log(`[deleteAccount] user_id=${user_id} device_id=${device_id} purge_at=${result.rows[0].deletion_purge_at}`);

    return res.json({
      success: true,
      deletion_purge_at: result.rows[0].deletion_purge_at,
    });
  } catch (err) {
    console.error("[deleteAccount] Error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

// The account has no valid session at this point (deletion revokes every
// one), so this can't go through v3Session's normal authorised-session
// check like every other authenticated endpoint — it re-verifies identity
// the same way a fresh login does (decrypt the credentials, confirm with
// Corenio directly), then reverses the deletion if it's still reversible.
// Only works while deletion_purged_at IS NULL — once the purge job has
// already anonymized the account's PII, there's nothing left to restore,
// so this intentionally rejects with the same "cannot be recovered"
// message a blocked login would give, not a different error.
export async function reactivateAccount(req: Request, res: Response): Promise<Response> {
  const { token: proxyKey, device_id, platform, app_version, language } = req.body as {
    token?: string;
    device_id?: string;
    platform?: string;
    app_version?: string;
    language?: string;
  };

  if (!proxyKey || !device_id) {
    return res.status(400).json({ success: false, error: "Missing token or device_id" });
  }

  const safeLanguage = language && ALLOWED_LANGUAGES.has(language) ? language : null;

  try {
    const { email, password } = decryptProxyKey(proxyKey);
    const loginResult = await corenioLogin(email, password);
    const { token: serverKey, user_id } = loginResult;

    const stateCheck = await v3Pool.query<{ deleted: boolean; deletion_purged_at: string | null }>(
      `SELECT deleted, deletion_purged_at FROM v3_users WHERE user_id = $1`,
      [user_id]
    );

    if (!stateCheck.rows[0]?.deleted) {
      return res.status(400).json({ success: false, error: "This account is not pending deletion." });
    }

    if (stateCheck.rows[0].deletion_purged_at !== null) {
      return res.status(403).json({
        success: false,
        account_deleted: true,
        permanently_purged: true,
        error: "This account is no longer able to be recovered. It is in the deletion process and cannot be recovered.",
      });
    }

    // Reverse the deletion — original request/purge timestamps are cleared,
    // not kept "for reference": their only job was driving the purge job's
    // countdown, and that countdown no longer applies. The account_delete
    // audit row from the original request stays in v3_device_analytics
    // untouched either way — this never rewrites history, only current state.
    await v3Pool.query(
      `UPDATE v3_users
       SET deleted = FALSE,
           deletion_requested_at = NULL,
           deletion_purge_at = NULL,
           deletion_requested_device_id = NULL,
           corenio_token = $2
       WHERE user_id = $1`,
      [user_id, serverKey]
    );

    // Same device/session upsert a normal login does — reactivation logs
    // the caller straight back in rather than requiring a second call.
    await v3Pool.query(
      `UPDATE v3_devices SET
         platform    = COALESCE($1, platform),
         app_version = COALESCE($2, app_version),
         language    = COALESCE($3, language),
         last_seen   = NOW()
       WHERE device_id = $4`,
      [platform ?? null, app_version ?? null, safeLanguage, device_id]
    );

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

    // Audit trail — reverses the state but never erases the original
    // account_delete row, so the analytics history still shows a deletion
    // was attempted and later reversed, not just "nothing happened."
    await v3Pool.query(
      `INSERT INTO v3_device_analytics (device_id, user_id, event, request_path)
       VALUES ($1, $2, 'account_reactivate', '/v3/auth/reactivate-account')`,
      [device_id, user_id]
    );

    notifyUser({ userId: user_id, event: "account_reactivated" }).catch((err) =>
      console.error("[reactivateAccount] Confirmation notification failed (non-blocking):", err)
    );

    console.log(`[reactivateAccount] user_id=${user_id} device_id=${device_id}`);

    return res.json({ success: true, proxy_key: proxyKey, server_key: serverKey, user_id });
  } catch (err) {
    const isInvalidCreds =
      (axios.isAxiosError(err) && (err.response?.status === 400 || err.response?.status === 401)) ||
      (err as { isInvalidCredentials?: boolean }).isInvalidCredentials;
    if (isInvalidCreds) {
      return res.json({ success: false, error: "invalid_credentials" });
    }
    console.error("[reactivateAccount] Error:", err);
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
