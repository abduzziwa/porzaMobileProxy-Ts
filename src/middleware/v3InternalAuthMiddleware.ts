import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

// Protects internal service-to-service routes (Corenio -> proxy). Distinct from
// v3SessionMiddleware, which authenticates end-user app requests and does not apply here.
export function v3InternalAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env.INTERNAL_NOTIFICATIONS_API_KEY;

  if (!expectedKey) {
    console.error("[v3InternalAuthMiddleware] Server configuration error: INTERNAL_NOTIFICATIONS_API_KEY is not set");
    res.status(503).json({ error: "Notification service unavailable" });
    return;
  }

  const providedKey = req.header("X-Internal-Api-Key");

  if (!providedKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const expectedBuffer = Buffer.from(expectedKey);
  const providedBuffer = Buffer.from(providedKey);

  const isValid =
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);

  if (!isValid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
