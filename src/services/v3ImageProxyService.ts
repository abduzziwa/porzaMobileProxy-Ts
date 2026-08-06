// Central image URL cleaner/transformer. Every field name recognised as an
// image field anywhere in a v3 JSON response is rewritten to point at our own
// /v3/images/proxy endpoint instead of the original (Cloudflare-protected) CDN.

const PUBLIC_BASE_URL = (process.env.PUBLIC_API_BASE_URL || process.env.SERVER_URL || "").replace(/\/+$/, "");
export const IMAGE_PROXY_PATH = "/v3/images/proxy";

// Domains allowed to be fetched through the image proxy. Exact match or any
// subdomain. zoekonderdeel.nl is Corenio's image CDN (product images, brand
// logos, filter icons) — confirmed from live product/filter responses.
// Extend via IMAGE_PROXY_ALLOWED_DOMAINS="domain-a.com,domain-b.com" without a
// code deploy if Corenio adds another CDN host.
// porza.s02.corenio.com serves the exact same assets, path-for-path, as
// zoekonderdeel.nl — but without Cloudflare's bot challenge (confirmed live:
// zoekonderdeel.nl returns `cf-mitigated: challenge` to server-side fetches
// regardless of headers). See CLOUDFLARE_BYPASS_MAP in v3ImageProxyController.
const DEFAULT_ALLOWED_DOMAINS = ["zoekonderdeel.nl", "porza.s02.corenio.com"];
const EXTRA_ALLOWED_DOMAINS = (process.env.IMAGE_PROXY_ALLOWED_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

export const ALLOWED_IMAGE_DOMAINS: readonly string[] = [
  ...new Set([...DEFAULT_ALLOWED_DOMAINS, ...EXTRA_ALLOWED_DOMAINS]),
];

export function isAllowedImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ALLOWED_IMAGE_DOMAINS.some((domain) => h === domain || h.endsWith(`.${domain}`));
}

// Recognised image-bearing field names. Beyond the standard set, this codebase
// also uses `url` / `url_thumb` (product.images[] items — see transformProduct
// in v3ProductsController.ts) and `icon` (filter option icons — see
// getProductsFilters). Without these, the transformer would look complete but
// silently miss the images this app actually returns.
const IMAGE_FIELD_NAMES = new Set([
  "image", "imageUrl", "image_url", "images",
  "thumbnail", "thumbnailUrl", "thumbnail_url",
  "logo", "logoUrl", "picture", "photo", "src",
  "url", "url_thumb", "icon",
]);

function isDataUrl(value: string): boolean {
  return /^data:/i.test(value);
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isAlreadyProxied(value: string): boolean {
  if (!PUBLIC_BASE_URL) return false;
  return value.startsWith(`${PUBLIC_BASE_URL}${IMAGE_PROXY_PATH}`);
}

/**
 * Rewrites an external image URL into an absolute URL pointing at our own
 * /v3/images/proxy endpoint, if and only if it's a real, allowlisted, not-yet-
 * proxied external image URL. Every other case (null, empty, data: URL,
 * relative path, already-proxied, non-allowlisted domain, malformed URL) is
 * returned unchanged.
 */
export function cleanImageUrl<T extends string | null | undefined>(originalUrl: T): T {
  if (originalUrl === null || originalUrl === undefined) return originalUrl;
  if (typeof originalUrl !== "string") return originalUrl;
  if (originalUrl === "") return originalUrl;
  if (isDataUrl(originalUrl)) return originalUrl;
  if (isAlreadyProxied(originalUrl)) return originalUrl;
  if (!isAbsoluteHttpUrl(originalUrl)) return originalUrl; // relative path — left for existing logic to resolve

  let hostname: string;
  try {
    hostname = new URL(originalUrl).hostname;
  } catch {
    return originalUrl; // not a parseable absolute URL — leave untouched
  }

  if (!isAllowedImageHost(hostname)) {
    console.warn(`[cleanImageUrl] Skipping non-allowlisted image domain: ${hostname}`);
    return originalUrl;
  }

  if (!PUBLIC_BASE_URL) {
    console.warn("[cleanImageUrl] PUBLIC_API_BASE_URL/SERVER_URL not set — cannot build proxy URL");
    return originalUrl;
  }

  return `${PUBLIC_BASE_URL}${IMAGE_PROXY_PATH}?url=${encodeURIComponent(originalUrl)}` as T;
}

/**
 * Recursively walks any JSON-serialisable value and rewrites string values
 * found under a recognised image-field key via cleanImageUrl. Handles: a
 * single URL string, an array of URL strings, an array of image objects
 * (e.g. product.images[] = [{id, url, url_thumb}]), and arbitrarily nested
 * product/category/cart/search/order objects — nested objects are always
 * walked regardless of their parent key, so `url`/`url_thumb`/`icon` etc.
 * inside a container get matched independently by their own key names.
 */
export function cleanImagesDeep<T>(value: T): T {
  return walk(value, false) as T;
}

function walk(value: unknown, isImageField: boolean): unknown {
  if (typeof value === "string") {
    return isImageField ? cleanImageUrl(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, isImageField));
  }
  if (value instanceof Date) {
    return value;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(val, IMAGE_FIELD_NAMES.has(key));
    }
    return out;
  }
  return value;
}
