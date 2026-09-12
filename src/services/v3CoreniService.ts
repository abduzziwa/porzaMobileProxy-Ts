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

// Tags every outgoing Corenio call in PM2 logs with [CORENIO_API], regardless of
// which function above made it — one place instead of a log line per call
// site. Method + path + status only, matching the rest of this codebase's
// logging discipline: never the request/response body (could carry
// passwords, tokens, or full addresses) and never headers (carry the API
// key and per-user bearer token).
corenioClient.interceptors.request.use((config) => {
  console.log(`[CORENIO_API] -> ${(config.method ?? "?").toUpperCase()} ${config.url}`);
  return config;
});
corenioClient.interceptors.response.use(
  (response) => {
    console.log(`[CORENIO_API] <- ${response.status} ${(response.config.method ?? "?").toUpperCase()} ${response.config.url}`);
    return response;
  },
  (error) => {
    const status = error.response?.status ?? "ERROR";
    const method = (error.config?.method ?? "?").toUpperCase();
    console.log(`[CORENIO_API] <- ${status} ${method} ${error.config?.url}`);
    return Promise.reject(error);
  }
);

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

// Field names verified live against this install's own usergroup config
// (2026-09-06, via the bare-username probe technique the Corenio doc
// documents). REQUIRED here (beyond always-required username): firstname,
// lastname, address, country, state, phone, mobphone, sex, companyinfo.
// Two of those don't match the generic API doc's field names — confirmed by
// probe, not guessed: this install checks "sex", not "gender", and
// "companyinfo", not "companyname" — sending the doc's names satisfies
// nothing; Corenio just silently ignores the unrecognised key and still
// reports the real one missing. addressnumber/postalcode/city are NOT
// required (bare "address" alone satisfies the check) but are obviously
// still needed for a deliverable address.
export interface CorenioSignupPayload {
  username: string;
  email: string;
  password: string;
  firstname: string;
  lastname: string;
  country?: string;
  phone?: string;
  // Address fields — optional, additive. Needed so guest checkout can create
  // an invisible Corenio account carrying a real address: per the live spec,
  // GET /carts/{id}/shippingmethods/{language} computes eligibility from
  // "the cart's contents and shipping address", and the only place an address
  // exists anywhere in the API is here, on account creation. No Carts/Orders
  // endpoint accepts an address itself.
  address?: string;
  address2?: string;
  addressnumber?: string;
  postalcode?: string;
  city?: string;
  state?: string;
  mobphone?: string;
  // Two distinct, easily-confused fields (per a partner-supplied integration
  // note — unverified against this install by us, but safe to honor either
  // way): companyinfo is validation-only, never surfaced anywhere, and any
  // non-empty placeholder satisfies the required-field check on this
  // install. companyname is what actually shows in Corenio's own admin
  // customer search — leave it empty for a private individual, set it for a
  // real B2B signup. Never copy one into the other.
  companyinfo?: string;
  companyname?: string;
  chambercommerce?: string;
  eori_number?: string;
  vatnumber?: string;
  // The required-field check (confirmed live, 2026-09-06) only checks for
  // the presence of "sex", not "gender" — sending "sex" alone with no
  // "gender" key does NOT produce a false missing-field error, contrary to
  // a partner note claiming otherwise. Whether persistence additionally
  // needs "gender" alongside it is unverified (would require completing a
  // real signup, which we've deliberately avoided so far) — both are sent
  // below as a costless precaution. Corenio only recognises "male"/"female"
  // (or 1/0) on either field — anything else is stored back unvalidated
  // rather than rejected (confirmed live), so callers must restrict to
  // these two before sending, not rely on Corenio to catch bad input.
  sex?: "male" | "female";
  gender?: "male" | "female";
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

// Corenio's signup 400s come in two shapes that look identical at the HTTP
// level (both status 400) but mean opposite things for the frontend:
//   missing required field(s) -> error_message.details is a comma STRING,
//     e.g. "firstname,lastname,country"
//   bad/duplicate field value  -> error_message.details is an OBJECT,
//     e.g. { "username": "Allready exists" } (that's Corenio's own typo,
//     matched verbatim below rather than relied on for string-matching)
// Blindly treating "any 400" as "email already registered" (the previous
// behaviour) misreports a validation failure as a duplicate-account error.
export type CorenioSignupErrorType = "missing_fields" | "email_taken" | "invalid_fields";

export interface CorenioSignupErrorInfo {
  type: CorenioSignupErrorType;
  fields?: string[];                  // missing_fields
  details?: Record<string, string>;   // email_taken / invalid_fields
}

export function parseCorenioSignupError(err: unknown): CorenioSignupErrorInfo | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 400) return null;

  const data = err.response.data as { error_message?: { details?: unknown } } | undefined;
  const details = data?.error_message?.details;

  if (typeof details === "string") {
    return { type: "missing_fields", fields: details.split(",").map((f) => f.trim()).filter(Boolean) };
  }

  if (details && typeof details === "object") {
    const detailsObj = details as Record<string, string>;
    if (typeof detailsObj.username === "string") {
      return { type: "email_taken", details: detailsObj };
    }
    return { type: "invalid_fields", details: detailsObj };
  }

  return null;
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

  // Corenio's response is an object keyed by product_id — JS always iterates
  // integer-like object keys in ascending numeric order regardless of the
  // actual response order, so a bare Object.values() silently discards
  // whatever order the caller requested (recency for recently-viewed,
  // relevance rank for search, liked-at for liked products, cart order,
  // order line-item order — every one of this function's callers passes an
  // intentionally ordered id list). Re-order explicitly instead.
  return reorderByRequestedIds(product_ids, res.data?.products ?? {});
}

// Pure — testable without hitting Corenio. A product_id Corenio didn't
// return (e.g. discontinued) is simply dropped, matching prior behavior.
export function reorderByRequestedIds<T>(ids: number[], byId: Record<string, T>): T[] {
  return ids.map((id) => byId[String(id)]).filter((v): v is T => v !== undefined);
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

// ─── Carts (replaces the removed /sales/order one-shot flow) ─────────────
// Every function here is a thin typed wrapper matching the live
// docs.corenio.com spec exactly (pulled and verified directly, not assumed).
// Sequencing (cart create -> items -> shipping -> finalize) and the
// write-through cache design live in the controllers, not here.
//
// corenioCartAddItem/UpdateItem/RemoveItems below use /carts/{cart_id}/items
// (no "/cart/" segment) — this is the documented, currently-working path,
// confirmed live across postman-logs-v5/v6 (2026-09-01). Earlier test
// rounds (v1-v3) found a server-side bug where this exact path 401'd and a
// "/carts/cart/{cart_id}/items" workaround was needed instead — that bug
// was fixed server-side and the paths reverted to the documented ones. If
// these ever start failing with a generic {"error":"auth required!"} 401
// again, that workaround is the first thing to try, not a client bug here.

export interface CorenioCartCreateResult {
  cart_id: number;
}

export async function corenioCartCreate(userToken?: string | null): Promise<CorenioCartCreateResult> {
  const res = await corenioClient.post<CorenioCartCreateResult>(
    "/api/v1.0/carts/create",
    {},
    { headers: corenioHeaders(userToken) }
  );
  return res.data;
}

export interface CorenioCartAddItemPayload {
  product_id: number;
  quantity: number;
  configuration_id?: number;
  user_input?: Record<string, unknown>;
}

export interface CorenioCartAddItemResult {
  item_id: number;
}

export async function corenioCartAddItem(
  cartId: number,
  payload: CorenioCartAddItemPayload,
  userToken?: string | null
): Promise<CorenioCartAddItemResult> {
  const res = await corenioClient.post<CorenioCartAddItemResult>(
    `/api/v1.0/carts/${cartId}/items`,
    payload,
    { headers: corenioHeaders(userToken) }
  );
  return res.data;
}

export interface CorenioCartUpdateItemResult {
  cart_id: number;
  cartitem_id: number;
  new_quantity: number;
}

export async function corenioCartUpdateItem(
  cartId: number,
  cartItemId: number,
  quantity: number,
  userToken?: string | null
): Promise<CorenioCartUpdateItemResult> {
  const res = await corenioClient.patch<CorenioCartUpdateItemResult>(
    `/api/v1.0/carts/${cartId}/items/${cartItemId}`,
    { quantity },
    { headers: corenioHeaders(userToken) }
  );
  return res.data;
}

export interface CorenioCartRemoveItemsResult {
  removed: number[];
}

export async function corenioCartRemoveItems(
  cartId: number,
  cartItemIds: number[],
  userToken?: string | null
): Promise<CorenioCartRemoveItemsResult> {
  const res = await corenioClient.delete<CorenioCartRemoveItemsResult>(
    `/api/v1.0/carts/${cartId}/items`,
    { data: { cartitem_ids: cartItemIds }, headers: corenioHeaders(userToken) }
  );
  return res.data;
}

export async function corenioCartDelete(cartId: number, userToken?: string | null): Promise<{ removed: number }> {
  const res = await corenioClient.delete<{ removed: number }>(
    `/api/v1.0/carts/${cartId}`,
    { headers: corenioHeaders(userToken) }
  );
  return res.data;
}

export interface CorenioShippingMethod {
  id: number;
  icon: string;
  icon_thumb: string;
  title: string;
  description: string;
  // price_ex_vat comes back as a numeric string (e.g. "7.00"), not a number —
  // confirmed against the live response, not assumed from the spec.
  price: { currency?: string; vat_percentage?: number; price_ex_vat?: string };
}

export async function corenioCartShippingMethods(
  cartId: number,
  language: "nl" | "en" | "de",
  userToken?: string | null
): Promise<CorenioShippingMethod[]> {
  const res = await corenioClient.get<{ shipping_methods: CorenioShippingMethod[] }>(
    `/api/v1.0/carts/${cartId}/shippingmethods/${language}`,
    { headers: corenioHeaders(userToken) }
  );
  return res.data.shipping_methods ?? [];
}

export interface CorenioCartSetShippingResult {
  shipping_method_id: number;
  shipping_method: string;
  currency?: string;
  shipping_price_ex_vat: number;
  shipping_price_vat: number;
}

export async function corenioCartSetShipping(
  cartId: number,
  shippingMethodId: number,
  userToken?: string | null
): Promise<CorenioCartSetShippingResult> {
  const res = await corenioClient.post<CorenioCartSetShippingResult>(
    `/api/v1.0/carts/${cartId}/shipping`,
    { shipping_method_id: shippingMethodId },
    { headers: corenioHeaders(userToken) }
  );
  return res.data;
}

export interface CorenioCartFinalizeResult {
  order_id: number;
}

export async function corenioCartFinalize(cartId: number, userToken?: string | null): Promise<CorenioCartFinalizeResult> {
  const res = await corenioClient.post<CorenioCartFinalizeResult>(
    `/api/v1.0/carts/${cartId}/finalize`,
    {},
    { headers: corenioHeaders(userToken) }
  );
  return res.data;
}

export interface CorenioCartSummary {
  cart_id: number;
  helpdeskcode: string;
  item_quantity: number;
  item_subtotal: string;
  shipping: string;
  total_vat: string;
  total_ex_vat: string;
  total: string;
}

// Used once, right before finalize, purely to capture the total for our own
// v3_orders.total_amount — this is the only endpoint that returns a price
// breakdown for a cart. Not cached (see plan: cart state is never cached).
//
// Path is bare /api/v1.0/carts, NOT /carts/list — verified live across two
// separate test rounds (postman-logs-v5/v6): /carts/list returns an empty
// body (200, 0 bytes, text/html) while bare /carts returns real data.
export async function corenioCartsList(
  limit: number,
  page: number,
  userToken?: string | null
): Promise<Record<string, CorenioCartSummary>> {
  const res = await corenioClient.get<{ carts?: Record<string, CorenioCartSummary> }>(
    "/api/v1.0/carts",
    { params: { limit, page }, headers: corenioHeaders(userToken) }
  );
  return res.data.carts ?? {};
}

// ─── Orders (new, replaces the removed /sales/order/* status/tracking) ───

// Real shape, verified live against production Corenio (2026-09-01) — the
// OpenAPI spec left this undocumented ("OrderListDTO", no fixed schema).
// No per-line-item array — only item_count/item_quantity aggregates.
export interface CorenioOrder {
  order_id: number;
  currency: string;
  status: string;
  billing: {
    email: string;
    firstname: string;
    lastname: string;
    companyname: string;
    address_street: string;
    address_housenumber: string;
    postalcode: string;
    city: string;
    country: string;
    country_id: number;
    country_code: string;
    [key: string]: unknown;
  };
  shipping: {
    method: string;
    price_ex_vat: unknown;
    address: Record<string, string>;
  };
  item_count: number;
  item_quantity: number;
  total_vat: number;
  total_ex_vat: number;
  total_paid: number;
  total: number;
}

export async function corenioOrdersList(
  params: { limit?: number; page?: number; language?: string; status?: string; date_from?: string; date_till?: string },
  userToken?: string | null
): Promise<{ orders: Record<string, CorenioOrder>; total_items: number; pages: number; current_page: number }> {
  const res = await corenioClient.get<{ orders: Record<string, CorenioOrder>; total_items: number; pages: number; current_page: number }>(
    "/api/v1.0/orders",
    { params, headers: corenioHeaders(userToken) }
  );
  return res.data;
}

// Corenio's list endpoint doesn't return 200+empty when an account has no
// orders — it returns 404 with error_message.details "No Orders Found"
// (verified live, 2026-09-11). That's a real, confirmed signal — distinct
// from a network blip, timeout, or 5xx — so callers can trust it as "this
// account genuinely has zero orders right now," not just "couldn't check."
export function isCorenioNoOrdersFoundError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 404;
}

// Corenio has no "get one order by id" endpoint — GET /orders only supports
// limit/page/language/status/date_from/date_till, never an order_id filter.
// A just-finalized order is always the most recent, so it's reliably on
// page 1 at the max page size — this is a live lookup, not a DB read, used
// right after finalize to enrich the checkout response with real Corenio
// data instead of just the bare order_id.
export async function corenioGetOrder(orderId: number, userToken?: string | null): Promise<CorenioOrder | null> {
  const { orders } = await corenioOrdersList({ limit: 30, page: 1 }, userToken);
  return orders[String(orderId)] ?? null;
}

export interface CorenioOrderPdfResult {
  order_id: number;
  filename: string;
  pdf_base64: string;
}

export async function corenioOrderPdf(
  orderId: number,
  type: "order" | "invoice" | "credit",
  userToken?: string | null
): Promise<CorenioOrderPdfResult> {
  const res = await corenioClient.get<CorenioOrderPdfResult>(
    `/api/v1.0/orders/${orderId}/pdf/${type}`,
    { headers: corenioHeaders(userToken) }
  );
  return res.data;
}

export interface CorenioPaymentLinkResult {
  order_id: number;
  total_unpaid: number;
  payment_method: string;
  payment_url: string;
}

export async function corenioOrderPaymentLink(
  payload: { order_id: number; payment_method: number; payment_amount?: number },
  userToken?: string | null
): Promise<CorenioPaymentLinkResult> {
  const res = await corenioClient.post<CorenioPaymentLinkResult>(
    "/api/v1.0/orders/paymentlink",
    payload,
    { headers: corenioHeaders(userToken) }
  );
  return res.data;
}
