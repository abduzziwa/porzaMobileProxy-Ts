import v3Pool from "../db/v3Client.js";
import { sendPushNotifications } from "./v3FirebaseService.js";
import { translate, type NotificationEvent } from "../translations/index.js";

export type { NotificationEvent };

export interface NotifyUserParams {
  userId: number;
  event: NotificationEvent;
  params?: Record<string, string>;
  data?: Record<string, string>;
}

// Event-triggered push (account created, order placed, etc.) for one
// already-known user — same token-lookup shape and v3_notifications history
// table as the admin broadcast tool (v3InternalNotificationsController),
// just scoped to a single userId instead of an email list, so call sites
// don't need to know about Firebase or the history table at all. Copy comes
// from ../translations (a local lookup dictionary, no API) in the language
// of the user's most-recently-active device (v3_devices.language, kept
// fresh by deviceCheck/login/signup and by POST /v3/device/language on an
// in-app change) — call sites pass an event key + params, never raw
// strings, so every translation lives in one place.
//
// Never throws. A notification failure must never fail the signup/order
// flow that triggered it — every call site can fire-and-forget this
// (call without awaiting) without risking an unhandled rejection, since
// every failure path below is caught and logged instead of propagated.
export async function notifyUser({ userId, event, params = {}, data }: NotifyUserParams): Promise<void> {
  try {
    const userRow = await v3Pool.query<{ email: string }>(
      `SELECT email FROM v3_users WHERE user_id = $1`,
      [userId]
    );
    if (!userRow.rows.length) return;
    const email = userRow.rows[0].email;

    // A user could have multiple devices on different languages — the
    // most-recently-authenticated one is the best guess for which they're
    // actually reading this notification on.
    const langRow = await v3Pool.query<{ language: string | null }>(
      `SELECT d.language
       FROM v3_devices d
       JOIN v3_device_sessions ds ON ds.device_id = d.device_id
       WHERE ds.user_id = $1 AND ds.authorised = TRUE
       ORDER BY ds.last_auth DESC
       LIMIT 1`,
      [userId]
    );
    const language = langRow.rows[0]?.language ?? null;
    const { title, body } = translate(event, language, params);

    const history = await v3Pool.query<{ id: number }>(
      `INSERT INTO v3_notifications (user_id, recipient_email, title, body, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, email, title, body, event]
    );
    const notificationId = history.rows[0].id;

    const tokenRows = await v3Pool.query<{ fcm_token: string }>(
      `SELECT DISTINCT d.fcm_token
       FROM v3_devices d
       JOIN v3_device_sessions ds ON ds.device_id = d.device_id
       WHERE ds.user_id = $1
         AND ds.authorised = TRUE
         AND d.notifications_enabled = TRUE
         AND d.fcm_token_status = 'active'
         AND d.fcm_token IS NOT NULL`,
      [userId]
    );
    const tokens = tokenRows.rows.map((r) => r.fcm_token);

    if (tokens.length === 0) {
      await v3Pool.query(
        `UPDATE v3_notifications SET delivery_status = 'no_active_devices', updated_at = NOW() WHERE id = $1`,
        [notificationId]
      );
      return;
    }

    const result = await sendPushNotifications({ tokens, title, body, data });

    if (result.invalidTokens.length > 0) {
      await v3Pool.query(
        `UPDATE v3_devices SET fcm_token_status = 'invalid', fcm_token_updated_at = NOW() WHERE fcm_token = ANY($1::text[])`,
        [result.invalidTokens]
      );
    }

    const status = result.successCount > 0 && result.failureCount === 0 ? "sent"
      : result.successCount > 0 ? "partially_sent"
      : "failed";

    await v3Pool.query(
      `UPDATE v3_notifications
       SET delivery_status = $1, firebase_success_count = $2, firebase_failure_count = $3, updated_at = NOW()
       WHERE id = $4`,
      [status, result.successCount, result.failureCount, notificationId]
    );
  } catch (err) {
    console.error(`[notifyUser] Failed to send "${event}" notification to user ${userId} (non-blocking):`, (err as Error).message);
  }
}
