import type { Request, Response } from "express";
import dotenv from "dotenv";

dotenv.config();

// Fallback matches the current real privacy policy page — env override lets
// the destination change (new domain, new legal page) without a redeploy.
const PRIVACY_POLICY_URL = process.env.PRIVACY_POLICY_URL || "https://zoekonderdeel.nl/privacy-policy";

export function getPrivacyPolicy(_req: Request, res: Response): void {
  // Field deliberately NOT named "url" — that key name is globally treated
  // as an image field by v3ImageTransformMiddleware (used for real product
  // images elsewhere) and gets silently rewritten to route through the
  // image proxy, corrupting this link.
  res.json({ success: true, privacy_policy_url: PRIVACY_POLICY_URL });
}
