import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";
import { htmlToNotificationText } from "../services/v3NotificationContentService.js";
import { sendPushNotifications } from "../services/v3FirebaseService.js";

const MAX_RECIPIENTS = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 50_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type DeliveryStatus = "sent" | "partially_sent" | "failed" | "no_active_devices";

interface EmailCopyRequestBody {
  recipients?: unknown;
  title?: unknown;
  content?: unknown;
}

// Pure decision logic — how many of a user's tokens succeeded/failed decides
// their notification's final delivery_status. No DB/network access, so this
// is directly unit-testable without mocking pg or Firebase.
export function computeUserDeliveryOutcome(
  userTokens: string[],
  successByToken: Map<string, boolean>
): { status: DeliveryStatus; successCount: number; failureCount: number } {
  if (userTokens.length === 0) {
    return { status: "no_active_devices", successCount: 0, failureCount: 0 };
  }

  const successCount = userTokens.filter((token) => successByToken.get(token) === true).length;
  const failureCount = userTokens.length - successCount;

  if (successCount > 0 && failureCount === 0) return { status: "sent", successCount, failureCount };
  if (successCount > 0 && failureCount > 0) return { status: "partially_sent", successCount, failureCount };
  return { status: "failed", successCount, failureCount };
}

// Groups token-lookup rows by user_id, deduping a user's own repeated tokens
// (e.g. the same token showing up twice would otherwise double-count them).
export function groupTokensByUserId(rows: Array<{ fcm_token: string; user_id: number }>): Map<number, string[]> {
  const map = new Map<number, Set<string>>();
  for (const row of rows) {
    const set = map.get(row.user_id) ?? new Set<string>();
    set.add(row.fcm_token);
    map.set(row.user_id, set);
  }
  return new Map(Array.from(map.entries()).map(([userId, tokens]) => [userId, Array.from(tokens)]));
}

export function normalizeRecipients(recipients: unknown): string[] | null {
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > MAX_RECIPIENTS) {
    return null;
  }

  const normalized: string[] = [];
  for (const recipient of recipients) {
    if (typeof recipient !== "string") return null;
    const email = recipient.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) return null;
    normalized.push(email);
  }

  return Array.from(new Set(normalized));
}

export async function emailCopyNotification(req: Request, res: Response): Promise<Response> {
  const { recipients, title, content } = req.body as EmailCopyRequestBody;

  const normalizedRecipients = normalizeRecipients(recipients);
  const validTitle = typeof title === "string" && title.trim().length > 0 && title.length <= MAX_TITLE_LENGTH;
  const validContent = typeof content === "string" && content.length <= MAX_CONTENT_LENGTH;

  if (!normalizedRecipients || !validTitle || !validContent) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const notificationBody = htmlToNotificationText(content as string);

  // Resolve matching accounts and store one history row per matched user
  // (regardless of how many devices they have). Best-effort: a history-storage
  // failure must never block the existing push-delivery path below — if the
  // insert throws (e.g. migration not yet applied), we simply skip history for
  // this request and continue exactly as the pipeline did before this change.
  const notificationIdByUserId = new Map<number, number>();
  let matchedUserCount = 0;
  try {
    const matchedUsers = await v3Pool.query<{ user_id: number; email: string }>(
      `SELECT user_id, email FROM v3_users WHERE LOWER(email) = ANY($1::text[])`,
      [normalizedRecipients]
    );
    matchedUserCount = matchedUsers.rows.length;

    if (matchedUsers.rows.length > 0) {
      const inserted = await v3Pool.query<{ id: number; user_id: number }>(
        `INSERT INTO v3_notifications (user_id, recipient_email, title, body)
         SELECT t.user_id, t.email, $3, $4
         FROM UNNEST($1::int[], $2::varchar[]) AS t(user_id, email)
         RETURNING id, user_id`,
        [matchedUsers.rows.map((r) => r.user_id), matchedUsers.rows.map((r) => r.email), title, notificationBody]
      );
      for (const row of inserted.rows) notificationIdByUserId.set(row.user_id, row.id);
    }
  } catch (err) {
    console.error("[emailCopyNotification] Failed to create history rows (non-blocking):", (err as Error).message);
  }

  console.log(
    "[emailCopyNotification] recipients:",
    normalizedRecipients.length,
    "matchedUsers:",
    matchedUserCount,
    "historyRowsCreated:",
    notificationIdByUserId.size
  );

  try {
    const lookup = await v3Pool.query<{ fcm_token: string; user_id: number }>(
      `SELECT DISTINCT
           d.fcm_token,
           u.user_id
       FROM v3_devices d
       JOIN v3_device_sessions ds
           ON ds.device_id = d.device_id
       JOIN v3_users u
           ON u.user_id = ds.user_id
       WHERE LOWER(u.email) = ANY($1::text[])
         AND ds.authorised = TRUE
         AND d.notifications_enabled = TRUE
         AND d.fcm_token_status = 'active'
         AND d.fcm_token IS NOT NULL`,
      [normalizedRecipients]
    );

    const tokensByUserId = groupTokensByUserId(lookup.rows);
    const tokens = Array.from(new Set(lookup.rows.map((row) => row.fcm_token)));

    console.log("[emailCopyNotification] matchingTokens:", tokens.length);

    if (tokens.length === 0) {
      await updateDeliveryStatuses(notificationIdByUserId, tokensByUserId, []);
      return res.status(202).json({ accepted: true });
    }

    let result;
    try {
      result = await sendPushNotifications({
        tokens,
        title: title as string,
        body: notificationBody,
        data: { source: "corenio-email-copy" },
      });
    } catch (sendErr) {
      console.error("[emailCopyNotification] Firebase delivery failed:", (sendErr as Error).message);
      return res.status(502).json({ error: "Notification delivery failed" });
    }

    console.log(
      "[emailCopyNotification] successCount:",
      result.successCount,
      "failureCount:",
      result.failureCount,
      "invalidTokenCount:",
      result.invalidTokens.length
    );

    if (result.invalidTokens.length > 0) {
      await v3Pool.query(
        `UPDATE v3_devices
         SET fcm_token_status = 'invalid',
             fcm_token_updated_at = NOW()
         WHERE fcm_token = ANY($1::text[])`,
        [result.invalidTokens]
      );
    }

    await updateDeliveryStatuses(notificationIdByUserId, tokensByUserId, result.perToken);

    return res.status(202).json({ accepted: true });
  } catch (err) {
    console.error("[emailCopyNotification] Error:", (err as Error).message);
    return res.status(502).json({ error: "Notification delivery failed" });
  }
}

// Best-effort — logs and swallows failures so a status-update problem never
// turns an otherwise-successful (already-sent) push into an error response.
async function updateDeliveryStatuses(
  notificationIdByUserId: Map<number, number>,
  tokensByUserId: Map<number, string[]>,
  perToken: Array<{ token: string; success: boolean }>
): Promise<void> {
  if (notificationIdByUserId.size === 0) return;

  const successByToken = new Map(perToken.map((t) => [t.token, t.success]));

  const ids: number[] = [];
  const statuses: DeliveryStatus[] = [];
  const successCounts: number[] = [];
  const failureCounts: number[] = [];

  for (const [userId, notificationId] of notificationIdByUserId) {
    const outcome = computeUserDeliveryOutcome(tokensByUserId.get(userId) ?? [], successByToken);
    ids.push(notificationId);
    statuses.push(outcome.status);
    successCounts.push(outcome.successCount);
    failureCounts.push(outcome.failureCount);
  }

  try {
    await v3Pool.query(
      `UPDATE v3_notifications AS n
       SET delivery_status = t.status,
           firebase_success_count = t.success_count,
           firebase_failure_count = t.failure_count,
           updated_at = NOW()
       FROM UNNEST($1::int[], $2::varchar[], $3::int[], $4::int[]) AS t(id, status, success_count, failure_count)
       WHERE n.id = t.id`,
      [ids, statuses, successCounts, failureCounts]
    );
  } catch (err) {
    console.error("[emailCopyNotification] Failed to update delivery status (non-blocking):", (err as Error).message);
  }
}
