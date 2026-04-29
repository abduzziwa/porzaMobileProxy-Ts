import type { Request, Response, NextFunction } from "express";
import v3Pool from "../db/v3Client.js";

// Endpoints that don't require an authorised session
const EXEMPT_PATHS = new Set([
  "/v3/device/check",
  "/v3/auth/login",
  "/v3/auth/forgot-password",
]);

export async function v3Session(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (EXEMPT_PATHS.has(req.path)) return next();

  const body = req.body as Record<string, unknown>;
  const device_id = (body.device_id ?? body.unique_device_id) as string | undefined;
  const user_id = body.user_id as number | undefined;

  if (!device_id || !user_id) {
    res.status(400).json({ error: "Missing device_id or user_id" });
    return;
  }

  try {
    const result = await v3Pool.query(
      `SELECT 1 FROM v3_device_sessions WHERE device_id = $1 AND user_id = $2 AND authorised = true`,
      [device_id, user_id]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "Unauthorised" });
      return;
    }

    next();
  } catch (err) {
    console.error("[v3Session] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
