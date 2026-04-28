import type { Request, Response, NextFunction } from "express";
import v3Pool from "../db/v3Client.js";

export async function v3AuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { proxy_key, server_key, device_id } = req.body as {
    proxy_key?: string;
    server_key?: string;
    device_id?: string;
  };

  if (!proxy_key || !server_key || !device_id) {
    res.status(401).json({ error: "Unauthorised" });
    return;
  }

  try {
    const result = await v3Pool.query<{ authorised: boolean; user_id: number }>(
      `SELECT ds.authorised, u.user_id
       FROM v3_device_sessions ds
       JOIN v3_users u ON ds.user_id = u.user_id
       WHERE ds.device_id = $1 AND ds.proxy_key = $2 AND ds.server_key = $3`,
      [device_id, proxy_key, server_key]
    );

    if (result.rows.length === 0 || !result.rows[0].authorised) {
      res.status(401).json({ error: "Unauthorised" });
      return;
    }

    (req as Request & { v3UserId?: number }).v3UserId = result.rows[0].user_id;
    next();
  } catch (err) {
    console.error("[v3AuthMiddleware] Error:", (err as Error).message);
    res.status(500).json({ error: "Internal server error" });
  }
}
