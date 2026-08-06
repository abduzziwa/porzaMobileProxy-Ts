import type { Request, Response, NextFunction } from "express";

// Routes whose body/response must never hit the generic logger below —
// currently the internal notifications endpoint, which carries recipient
// emails, notification content, and (in headers, handled separately by
// v3InternalAuthMiddleware) the internal API key.
const REDACTED_LOG_PATHS = new Set(["/v1/internal/notifications/email-copy"]);

export function buildRequestLogEntry(
  path: string,
  method: string,
  url: string,
  body: unknown,
  response: unknown
): { method: string; url: string; body: unknown; response: unknown } {
  if (REDACTED_LOG_PATHS.has(path)) {
    return { method, url, body: "[redacted]", response: "[redacted]" };
  }
  return { method, url, body, response };
}

export function v3RequestLogger(req: Request, res: Response, next: NextFunction): void {
  const originalSend = res.send.bind(res);
  res.send = function (body: unknown) {
    console.log("Request/Response Log:", buildRequestLogEntry(req.path, req.method, req.url, req.body, body));
    return originalSend(body);
  };
  next();
}
