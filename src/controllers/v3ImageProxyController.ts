import type { Request, Response } from "express";
import axios from "axios";
import dns from "node:dns/promises";
import net from "node:net";
import { isAllowedImageHost } from "../services/v3ImageProxyService.js";

const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// IPv4/IPv6 ranges that must never be reachable through this proxy: loopback,
// RFC1918 private ranges, link-local (which also covers the 169.254.169.254
// cloud metadata endpoint), and unique-local/link-local IPv6.
function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fe80:")) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    return false;
  }
  return true; // not a recognisable IP at all — fail closed
}

// Defends against DNS-rebinding: even if the hostname is allowlisted, refuse
// to fetch if it currently resolves to a private/loopback/link-local address.
async function isSafeToFetch(hostname: string): Promise<boolean> {
  if (hostname.toLowerCase() === "localhost") return false;
  if (net.isIP(hostname) !== 0) return !isPrivateOrReservedIp(hostname);
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses.length) return false;
    return addresses.every((a) => !isPrivateOrReservedIp(a.address));
  } catch {
    return false; // DNS failure — fail closed
  }
}

class RejectedTarget extends Error {}

// Some Corenio-owned CDN hosts are fronted by Cloudflare with a bot challenge
// that a legitimate server-side fetch can't pass either (confirmed live:
// zoekonderdeel.nl returns `cf-mitigated: challenge` with a 403 regardless of
// User-Agent/Referer). The exact same assets are also served, path-for-path,
// from this unprotected Corenio host — rewrite to it right before fetching.
const CLOUDFLARE_BYPASS_MAP: Record<string, string> = {
  "zoekonderdeel.nl": "porza.s02.corenio.com",
};

function applyCloudflareBypass(url: URL): URL {
  const host = url.hostname.toLowerCase();
  for (const [from, to] of Object.entries(CLOUDFLARE_BYPASS_MAP)) {
    if (host === from || host.endsWith(`.${from}`)) {
      const rewritten = new URL(url.toString());
      rewritten.hostname = to;
      return rewritten;
    }
  }
  return url;
}

async function validateTarget(urlStr: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new RejectedTarget("invalid_url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RejectedTarget("unsupported_protocol");
  }
  if (!isAllowedImageHost(parsed.hostname)) {
    throw new RejectedTarget("domain_not_allowed");
  }
  if (!(await isSafeToFetch(parsed.hostname))) {
    throw new RejectedTarget("private_or_unresolvable_host");
  }
  return parsed;
}

export async function proxyImage(req: Request, res: Response): Promise<void> {
  const rawUrl = req.query.url;
  if (typeof rawUrl !== "string" || !rawUrl) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid url encoding" });
    return;
  }

  let currentUrl: URL;
  try {
    const validated = await validateTarget(decodedUrl);
    currentUrl = await validateTarget(applyCloudflareBypass(validated).toString());
  } catch (err) {
    const reason = err instanceof RejectedTarget ? err.message : "unknown";
    let hostname = "unparsable";
    try { hostname = new URL(decodedUrl).hostname; } catch { /* keep "unparsable" */ }
    console.warn(`[v3ImageProxy] Rejected — reason=${reason} host=${hostname}`);
    res.status(400).json({ error: "Image URL not allowed" });
    return;
  }

  try {
    for (let hop = 0; ; hop++) {
      const upstream = await axios.get<ArrayBuffer>(currentUrl.toString(), {
        responseType: "arraybuffer",
        timeout: FETCH_TIMEOUT_MS,
        maxRedirects: 0, // redirects are followed manually below so each hop is re-validated
        validateStatus: () => true,
        headers: { "User-Agent": "porza-image-proxy/1.0" },
      });

      if (REDIRECT_STATUSES.has(upstream.status)) {
        if (hop >= MAX_REDIRECTS) {
          console.warn(`[v3ImageProxy] Too many redirects starting at host=${currentUrl.hostname}`);
          res.status(502).json({ error: "Too many redirects" });
          return;
        }
        const location = upstream.headers["location"];
        if (!location) {
          console.warn(`[v3ImageProxy] Redirect with no Location header from host=${currentUrl.hostname}`);
          res.status(502).json({ error: "Redirect with no location" });
          return;
        }
        const nextUrl = new URL(location, currentUrl);
        try {
          const validated = await validateTarget(nextUrl.toString());
          currentUrl = await validateTarget(applyCloudflareBypass(validated).toString());
        } catch {
          console.warn(`[v3ImageProxy] Rejected redirect target host=${nextUrl.hostname}`);
          res.status(400).json({ error: "Image URL not allowed" });
          return;
        }
        continue;
      }

      if (upstream.status !== 200) {
        console.warn(`[v3ImageProxy] Upstream failure status=${upstream.status} host=${currentUrl.hostname}`);
        res.status(502).json({ error: "Failed to fetch image" });
        return;
      }

      const contentType = String(upstream.headers["content-type"] || "");
      if (!contentType.toLowerCase().startsWith("image/")) {
        const looksLikeChallenge = contentType.toLowerCase().includes("html");
        console.warn(
          `[v3ImageProxy] Invalid content-type="${contentType}" host=${currentUrl.hostname}` +
          (looksLikeChallenge ? " — possible Cloudflare challenge/HTML response" : "")
        );
        res.status(502).json({ error: "Upstream did not return an image" });
        return;
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.status(200).send(Buffer.from(upstream.data));
      return;
    }
  } catch (err) {
    const isTimeout = axios.isAxiosError(err) && err.code === "ECONNABORTED";
    console.error(
      `[v3ImageProxy] ${isTimeout ? "Timeout" : "Fetch error"} host=${currentUrl.hostname}:`,
      isTimeout ? "request timed out" : (err as Error).message
    );
    res.status(isTimeout ? 504 : 502).json({ error: isTimeout ? "Upstream image request timed out" : "Failed to fetch image" });
  }
}
