import type { Request, Response } from "express";
import v3Pool from "../db/v3Client.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

interface NotificationRow {
  id: number;
  title: string;
  body: string;
  source: string;
  read_at: string | null;
  created_at: string;
}

interface PublicNotification {
  id: number;
  title: string;
  body: string;
  source: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

// Explicit whitelist — never forwards recipient_email or user_id even if a
// caller accidentally selects them onto the row in the future.
export function toPublicNotification(row: NotificationRow): PublicNotification {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    source: row.source,
    is_read: row.read_at !== null,
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

export function parsePagination(rawLimit: unknown, rawOffset: unknown): { limit: number; offset: number } | null {
  const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit);
  const offset = rawOffset === undefined ? 0 : Number(rawOffset);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return null;
  if (!Number.isInteger(offset) || offset < 0) return null;

  return { limit, offset };
}

// ── POST /v3/notifications/list ───────────────────────────
export async function listNotifications(req: Request, res: Response): Promise<Response> {
  const { user_id, limit: rawLimit, offset: rawOffset } = req.body as {
    user_id?: number;
    limit?: unknown;
    offset?: unknown;
  };

  if (!user_id) return res.status(400).json({ error: "Missing user_id" });

  const pagination = parsePagination(rawLimit, rawOffset);
  if (!pagination) return res.status(400).json({ error: "Invalid pagination" });
  const { limit, offset } = pagination;

  try {
    const [rowsResult, unreadResult] = await Promise.all([
      v3Pool.query<NotificationRow>(
        `SELECT id, title, body, source, read_at, created_at
         FROM v3_notifications
         WHERE user_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [user_id, limit + 1, offset]
      ),
      v3Pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM v3_notifications WHERE user_id = $1 AND read_at IS NULL`,
        [user_id]
      ),
    ]);

    const hasMore = rowsResult.rows.length > limit;
    const notifications = rowsResult.rows.slice(0, limit).map(toPublicNotification);

    return res.json({
      notifications,
      pagination: { limit, offset, has_more: hasMore },
      unread_count: parseInt(unreadResult.rows[0].count, 10),
    });
  } catch (err) {
    console.error("[listNotifications] Error:", (err as Error).message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ── POST /v3/notifications/unread-count ───────────────────
export async function getUnreadCount(req: Request, res: Response): Promise<Response> {
  const { user_id } = req.body as { user_id?: number };
  if (!user_id) return res.status(400).json({ error: "Missing user_id" });

  try {
    const result = await v3Pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM v3_notifications WHERE user_id = $1 AND read_at IS NULL`,
      [user_id]
    );
    return res.json({ unread_count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error("[getUnreadCount] Error:", (err as Error).message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ── POST /v3/notifications/read ────────────────────────────
export async function markNotificationRead(req: Request, res: Response): Promise<Response> {
  const { user_id, notification_id } = req.body as { user_id?: number; notification_id?: number };

  if (!user_id || !Number.isInteger(notification_id)) {
    return res.status(400).json({ error: "Missing or invalid user_id or notification_id" });
  }

  try {
    const result = await v3Pool.query(
      `UPDATE v3_notifications
       SET read_at = COALESCE(read_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [notification_id, user_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    return res.json({ updated: true });
  } catch (err) {
    console.error("[markNotificationRead] Error:", (err as Error).message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ── POST /v3/notifications/read-all ────────────────────────
export async function markAllNotificationsRead(req: Request, res: Response): Promise<Response> {
  const { user_id } = req.body as { user_id?: number };
  if (!user_id) return res.status(400).json({ error: "Missing user_id" });

  try {
    const result = await v3Pool.query(
      `UPDATE v3_notifications SET read_at = NOW(), updated_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
      [user_id]
    );

    return res.json({ updated: true, updated_count: result.rowCount ?? 0 });
  } catch (err) {
    console.error("[markAllNotificationsRead] Error:", (err as Error).message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ── POST /v3/notifications/detail ──────────────────────────
export async function getNotificationDetail(req: Request, res: Response): Promise<Response> {
  const { user_id, notification_id } = req.body as { user_id?: number; notification_id?: number };

  if (!user_id || !Number.isInteger(notification_id)) {
    return res.status(400).json({ error: "Missing or invalid user_id or notification_id" });
  }

  try {
    const result = await v3Pool.query<NotificationRow>(
      `SELECT id, title, body, source, read_at, created_at
       FROM v3_notifications WHERE id = $1 AND user_id = $2`,
      [notification_id, user_id]
    );

    if (!result.rows.length) return res.status(404).json({ error: "Notification not found" });

    return res.json({ notification: toPublicNotification(result.rows[0]) });
  } catch (err) {
    console.error("[getNotificationDetail] Error:", (err as Error).message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
