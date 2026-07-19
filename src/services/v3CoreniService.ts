import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.CORENIO_BASE_URL || "https://api.corenio.com";
const API_KEY = process.env.CORENIO_API_KEY || process.env.API_KEY || "";


const corenioClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
});

// Single source of truth for Corenio auth headers — every call in this file
// (and API.ts, the legacy fetch-based client) routes through this. Purely
// additive: Authorization: Bearer <API_KEY> is always kept (proven to work
// today), api-key is added alongside it for consistency with Corenio's own
// convention (seen on whoami), and when the call is made on behalf of a
// specific logged-in user, their own Corenio session token is attached too —
// in addition to, never instead of, the API key.
export function corenioHeaders(userToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    "api-key": API_KEY,
  };
  if (userToken) headers.bearer = userToken;
  return headers;
}

export interface CorenioLoginResult {
  token: string;
  user_id: number;
}

export interface CorenioRefreshResult {
  token: string;
  expires_in: number;
}

export async function corenioLogin(username: string, password: string): Promise<CorenioLoginResult> {
  const res = await corenioClient.post<CorenioLoginResult>(
    "/api/v1.0/users/auth/login",
    { username, password },
    { headers: corenioHeaders() }
  );
  if (!res.data || !(res.data as unknown as Record<string, unknown>).token) {
    throw Object.assign(new Error("invalid_credentials"), { isInvalidCredentials: true });
  }
  return res.data;
}

export async function corenioRefresh(token: string): Promise<CorenioRefreshResult> {
  const res = await corenioClient.post<CorenioRefreshResult>(
    "/api/v1.0/users/auth/refresh",
    {},
    { headers: corenioHeaders(token) }
  );
  return res.data;
}

export async function corenioLogout(token: string): Promise<void> {
  await corenioClient.post(
    "/api/v1.0/users/auth/logout",
    {},
    { headers: corenioHeaders(token) }
  );
}

export async function corenioWhoami(token: string): Promise<{ user_id: number; email: string; firstname: string; lastname: string }> {
  const res = await corenioClient.post<{ user_id: number; email: string; firstname: string; lastname: string }>(
    "/api/v1.0/users/auth/whoami",
    {},
    { headers: corenioHeaders(token) }
  );
  return res.data;
}

export async function corenioForgotPassword(email: string): Promise<void> {
  await corenioClient.post("/api/v1.0/users/auth/forgot-password", { email }, { headers: corenioHeaders() });
}

export interface CorenioSignupPayload {
  username: string;
  email: string;
  password: string;
  firstname: string;
  lastname: string;
  country?: string;
  phone?: string;
}

export interface CorenioSignupResult {
  id: number;
  success: boolean;
}

export async function corenioSignup(payload: CorenioSignupPayload): Promise<CorenioSignupResult> {
  const res = await corenioClient.post<CorenioSignupResult>("/api/v1.0/users/create", payload, {
    headers: corenioHeaders(),
  });
  return res.data;
}

export interface RawCategory {
  id: number;
  name: string;
  seo_path: string;
  image?: { url_thumb?: string };
}

export async function fetchCategoriesByParent(
  parentId: number,
  language: string,
  userToken?: string | null
): Promise<RawCategory[]> {
  const res = await corenioClient.post<Record<string, unknown>>(
    "/api/v1.0/categories/byParent",
    { parent_id: parentId, language, page: 1, limit: 100 },
    { headers: corenioHeaders(userToken) }
  );
  return Object.values(res.data).filter(
    (item): item is RawCategory =>
      typeof item === "object" && item !== null && !!(item as RawCategory).id
  );
}

// ─── Vehicles ─────────────────────────────────────────────

export async function searchVehicleByPlate(
  plate: string,
  country: string,
  userToken?: string | null
): Promise<Record<string, Record<string, unknown>>> {
  const res = await corenioClient.post<{ success?: boolean; vehicles?: Record<string, Record<string, unknown>> }>(
    "/api/v1.0/vehicles/search",
    { filters: { licenseplates: [plate] }, language: "en", page: 1, limit: 1, country },
    { headers: corenioHeaders(userToken) }
  );
  return res.data?.vehicles ?? {};
}

// ─── Products ─────────────────────────────────────────────

export interface CorenioProductSearchResponse {
  product_ids: number[];
  total_items: number;
  pages: number;
  current_page: number;
  items_per_page: number;
}

export interface CorenioProduct {
  product_id: unknown;
  sku?: string;
  eancode?: string;
  seourl?: string;
  product_type?: string;
  product_type_id?: number;
  prices?: { consumer_ex_vat?: string };
  vat_percentage?: unknown;
  internalStock?: number;
  externalStock?: number;
  brand?: { id?: unknown; name?: string; logo?: string };
  images?: { id?: number; url?: string; url_thumb?: string }[];
  oenumbers?: { manufacturer: string; number: string }[];
  usageNumbers?: { usage_number: string; usagenumber_type: string }[];
  categories?: { category: { id?: unknown; pid?: unknown; name?: string; seo_path?: string } }[];
}

export interface CorenioFilterGroup {
  id: string;
  title: string;
  filters: { id: number; title: string; count: number; icon?: string }[];
}

export async function fetchProductSearch(
  filters: Record<string, unknown>,
  language: string,
  page: number,
  limit: number,
  userToken?: string | null
): Promise<CorenioProductSearchResponse> {
  console.log("[fetchProductSearch] SENDING to Corenio:", JSON.stringify({ filters, language, page, limit }, null, 2));
  const res = await corenioClient.post<Record<string, unknown>>(
    "/api/v1.0/products/search",
    { filters, language, page, limit },
    { headers: corenioHeaders(userToken) }
  );
  console.log("[fetchProductSearch] RAW Corenio response:", JSON.stringify(res.data, null, 2));

  // Corenio uses hyphens and inconsistent naming — normalise here
  return {
    product_ids: (res.data["product-ids"] as number[]) || [],
    total_items: (res.data.total_items as number) || 0,
    pages: (res.data.pages as number) || 0,
    current_page: (res.data.current_page as number) || 1,
    items_per_page: (res.data.items_per_pages as number) || (res.data.items_per_page as number) || 20,
  };
}

export async function fetchProductsData(
  product_ids: number[],
  language: string,
  userToken?: string | null
): Promise<CorenioProduct[]> {
  const res = await corenioClient.post<{ products?: Record<string, CorenioProduct> }>(
    "/api/v1.0/products/data",
    {
      products: product_ids,
      language,
      options: {
        oenumbers: true,
        images: true,
        usageNumbers: true,
        measurements: false,
        package_measurements: false,
        stock: true,
        categories: true,
        brand: true,
      },
      page: 1,
      limit: product_ids.length,
    },
    { headers: corenioHeaders(userToken) }
  );
  console.log("[fetchProductsData] RAW Corenio response:", JSON.stringify(res.data, null, 2));
  return Object.values(res.data?.products ?? {});
}

export async function fetchProductFilters(
  filters: Record<string, unknown>,
  language: string,
  userToken?: string | null
): Promise<Record<string, CorenioFilterGroup>> {
  const res = await corenioClient.post<{ filters?: Record<string, CorenioFilterGroup> }>(
    "/api/v1.0/products/search/filters",
    { filters, language, page: 1, limit: 10 },
    { headers: corenioHeaders(userToken) }
  );
  return res.data.filters ?? {};
}
