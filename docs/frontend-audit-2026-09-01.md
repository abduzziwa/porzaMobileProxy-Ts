# Porza App — Complete Audit: Auth / Cart / Checkout / Endpoints
_Read-only, current state as of 2026-09-01. Feeds the follow-up implementation prompt for gating cart/checkout behind login._

## Executive summary

The app runs two parallel, coexisting systems:

1. **Legacy `/v1` + `/v2` stack** — SQLite session (`uniqueDeviceId`/`cartId`/`phpsessid`/`loggedIn`), no real auth, mostly orphaned in navigation but not fully dead: one live add-to-cart path (`POST /v2/cart/addProduct`) and one live legacy product-detail page are still reachable today.
2. **Current `/v3` stack** — SecureStore-based (`device_id`/`user_id`/`proxy_key`/`server_key`), RSA-encrypted login. The repo root has `PROXY_API_CONTRACT.md` (dated 2026-07-15) — the frontend team's own record of the guest-checkout contract this app was just built against. That doc documents exactly the direction the backend is now reversing; it's reproduced in full below and needs a rewrite once the new auth-gated flow ships.

**Most important finding:** cart is not gated by login anywhere today, and neither is most of checkout — a "continue as guest / log in instead" choice already exists, but only at the checkout step. **There is no signup screen in the app at all** — "create account" opens an external website. If cart is going to require an account, building signup is the first gap to close, not just gating.

---

## PROXY_API_CONTRACT.md (repo root, full text — the frontend team's own record of the current guest-checkout contract)

> For the backend/proxy team. Describes every endpoint the app calls, the `device_id` / `user_id` identity model, and what changed with the move to guest checkout (2026-07-15). Base URL: `EXPO_PUBLIC_PROXY_URL` (`API_ENDPOINT_V3`), all calls are `POST` with a JSON body unless noted.

### 0. ⚠️ Urgent — product/brand images blocked by Cloudflare (not a frontend bug, unrelated to this migration)

Verified 2026-07-15: every image URL returned by the API (`product.image`, `product.images[].url`/`url_thumb`, `brand.logo`) points at `zoekonderdeel.nl` / `de.zoekonderdeel.nl`, and **every one of those URLs currently returns `HTTP 403` with response header `Cf-Mitigated: challenge`** — Cloudflare's Managed Challenge / Bot Fight Mode is blocking the request before it reaches the origin. Confirmed via direct `curl`, both hosts, regardless of User-Agent. Blocks all images for all users. No frontend fix exists — needs a Cloudflare WAF/Page Rule exemption for `/assets/modules/mod_ecommerce/`.

### 1. Identity model

| Field | Type | Lifetime | Meaning |
|---|---|---|---|
| `device_id` | `string` | Permanent — generated once on install (`expo-application` vendor/android ID, or random UUID fallback), stored in SecureStore, never changes, never null | Identifies the physical device/install |
| `user_id` | `number \| null` | Set only after successful login; cleared on logout | Identifies the logged-in account. **`null` means guest.** |

What changed: the app used to require a non-null `user_id` before calling almost any endpoint. It now sends `user_id: null` **explicitly** (never omits it) for guests. Proxy must treat `(device_id, user_id: null)` as a valid anonymous identity, keyed by `device_id`.

### 2. Auth & device (`services/v3AuthService.ts`)
```
POST device/check — guest-OK, called once per launch
  Request:  { proxy_key: string|null, server_key: string|null, device_id: string, user_id: number|null }
  Response: { authorised: true, server_key } | { authorised: false, public_key }

POST auth/login
  Request:  { token: string (RSA-encrypted email+password), device_id, app_version, platform }
  Response: { proxy_key, server_key, user_id } | { authorised: false, error }

POST auth/me — account-only          { user_id, device_id } → { success, user }
POST auth/sessions — account-only    { user_id, device_id } → { success, total, sessions[] }
POST auth/logout — account-only      { user_id, device_id, logout_all? }
POST auth/forgot-password            { email } → { success: true }
```

### 3. Browsing (guest-OK)
`categories`, `categories/sub`, `products`, `products/data`, `products/filters`, `products/relevant`, `search` — all now take `user_id: number|null`, previously blocked client-side unless logged in.

`categories/sub` and `search` both take a **new** `ktype_ids?: number[]` field — sent whenever a car is selected, omitted for guests/no-car-selected. Backend filtering behavior on `search` by `ktype_ids` is unconfirmed — field is currently sent but may have no effect.

`Product` shape: `product_id, sku, ean, seo_url, product_type, product_type_id, brand:{id,name,logo}|null, price_ex_vat, price_inc_vat, vat_percentage, in_stock, internal_stock, external_stock, call_to_order, favourite, image, images[], oe_numbers[], usage_numbers[], categories[]`.

### 4. Vehicle selection (guest-OK) — `services/v3CarService.ts`
```
POST car/get     { device_id, user_id: number|null } → { data: SelectedVehicle|null }
POST car/select  { device_id, user_id: number|null, licence_plate, country } → { success, carFound, data }
POST car/remove  { device_id, user_id: number|null }
```

### 5. Cart (guest-OK) — `services/v3CartService.ts`
```
POST cart/add     { device_id, user_id: number|null, product_id, quantity } → { success, cart_item }
POST cart/remove  { device_id, user_id: number|null, product_id }           → { success }
POST cart/update  { device_id, user_id: number|null, product_id, quantity } → { success, cart_item }
POST cart/get     { device_id, user_id: number|null }                      → { success, items, total_items, total_quantity }
POST cart/clear   { device_id, user_id: number|null }                      → { success }
```

### 6. Liked / Last-seen (guest-OK)
```
POST liked/toggle   { device_id, user_id: number|null, product_id } → { success, liked }
POST liked/get       { device_id, user_id: number|null }            → { success, product_ids, total }
POST liked/get       { device_id, user_id: number|null, language? } → { success, products, total }  (product-hydrated variant, same endpoint)
POST liked/check     { device_id, user_id: number|null, product_ids } → { success, liked_ids }  (defined, never called — dead)

POST last-seen/add   { device_id, user_id: number|null, product_id }
POST last-seen/get   { device_id, user_id?: number|null, limit?, language? } → { success, total, products }
```

### 7. Checkout (guest-OK) — `services/v3CheckoutService.ts`
```
POST order/getPublicKey  { device_id, user_id: number|null } → { public_key }
POST shipping/options    { device_id, user_id: number|null, language? } → { success, language, shipping_options:[{id,name,price,price_label,free}] }
POST address/get         { device_id, user_id: number|null } → { success, address: SavedAddress|null }  (null for guests, expected)

POST orders/create ⚠️ must succeed with user_id: null
  Request:  { device_id, user_id: number|null, encrypted_address }
  Response: { success, order_id?, external_order_id?, error? }
```
`encrypted_address` is the RSA-encrypted billing/shipping form, including `billing_email` (required for every checkout, guest or not). No plaintext address is ever sent alongside it.

### 8. Orders — account-only, unchanged — `services/v3OrdersService.ts`
```
POST orders/proxy-list    { device_id, user_id: number } → { success, total, orders: OrderListItem[] }
POST orders/proxy-detail  { device_id, user_id: number, order_id } → { success, order?: OrderDetail, error? }
```
Note: `OrderDetail.delivery_address` already comes back with a **plaintext** `billing_email` + full name/address — the proxy already decrypts and stores `encrypted_address` queryably per order.

### 9. Open item — guest order lookup (not built yet)
Product decision: a guest's order should be findable later via `billing_email` + `device_id` (no account). Needs a new `orders/guest-detail` endpoint:
```
Request:  { device_id, email, order_id }
Response: { success, order?: OrderDetail, error? }
```
Since `orders/proxy-detail` already returns plaintext `billing_email`, this just needs to authorize by `(device_id, email)` matching the order's stored address instead of `user_id`. Frontend has a hook point (Account tab, guest state) but hasn't built the UI — waiting on this endpoint.

### 10. Checklist for proxy team (as written by the frontend team, 2026-07-15)
- Accept `user_id: null` (not omitted) on every guest-OK endpoint, scoped by `device_id`.
- Confirm `orders/create` works end-to-end for `user_id: null`.
- Decide guest→login data-merge behavior for cart/liked/last-seen.
- Add `orders/guest-detail` per §9.

**Needs clarification:** this doc is ~6 weeks stale relative to today (2026-09-01) and documents exactly the guest-checkout direction the backend is now reversing. Treat it as "how the frontend currently thinks the contract works," not current ground truth — the implementation prompt should explicitly say this doc needs a rewrite once the new gated flow ships.

---

## 1. Screen inventory — every screen, its trigger, auth requirement, and every endpoint it calls

**Navigation shell** (detail in §7): Root stack (`app/_layout.tsx:408-424`): `index`, `(tabs)`, `v3Login`, `modal`, `v3CheckoutPage`, `v3ShippingPage`, `v3OrderConfirmPage`, `v3VehicleScanner`, `v3EanScanner`. Bottom tabs (`app/(tabs)/_layout.tsx:1583-1609`) visible: `HomeCategoryPage`, `PromotionsPage`, `CartPage`, `v3NotificationsPage`, `v3AccountPage`. Hidden (`href: null`, still routable): `v3CartPage`, `MyPorzaPage`.

Global calls fired on every launch regardless of screen: `POST device/check` (`v3AuthContext.tsx:48-81`, body `{proxy_key, server_key, device_id, user_id}`); `POST car/get` (`V3VehicleProvider`, `{device_id, user_id}`); `POST liked/get` (`V3LikedProvider`, `{device_id, user_id}`); `POST last-seen/get` (`V3LastSeenProvider`, `{device_id, user_id, limit:20}`); `POST device/push-token` (`useV3PushRegistration`, `{device_id, fcm_token, platform}`, fire-and-forget, retried next launch on failure).

| Screen | File | Reached from | Login required? | Endpoints called |
|---|---|---|---|---|
| Splash/bootstrap | `app/index.tsx` | App launch | No | none directly — redirects to `/(tabs)/HomeCategoryPage` |
| Login | `app/v3Login.tsx` → `components/v3LoginScreen.tsx` | `v3AccountPage/index.tsx:160`; `v3CheckoutPage.tsx:452` (`redirectTo=checkout`) | N/A — this is the gate | `POST auth/login {token, device_id}`; `POST auth/forgot-password {email}` |
| **Signup** | **Does not exist.** "Account aanmaken" (`v3LoginScreen.tsx:383-395`) opens `Linking.openURL("https://nl.ci120.s02.corenio.com/mijn-rekening#")` | Login screen button | — | none — no `/v3/auth/signup` function exists anywhere |
| Home / category browse | `app/(tabs)/HomeCategoryPage/index.tsx` | Tab bar, launch redirect | No | `POST categories {device_id, user_id, language, ktype_ids?}` |
| Subcategory list | `app/(tabs)/HomeCategoryPage/SubCategoryPage.tsx` | Category tap | No | `POST categories/sub {device_id, user_id, parent_id, language, ktype_ids?}` |
| Product list | `app/(tabs)/HomeCategoryPage/v3ProductsPage.tsx` | Subcategory tap | No | `POST products/filters {...}`; `POST products {device_id, user_id, category_ids, ktype_ids?, brand_ids?, property_ids?, language, page, limit}` |
| Search results | `app/(tabs)/HomeCategoryPage/SearchResultsPage.tsx` | Header search submit; EAN scanner result | No | `POST search {device_id, user_id, query, language, page, per_page, ktype_ids?}` |
| Product detail (v3, primary) | `app/(tabs)/HomeCategoryPage/v3ProductExtendedPage.tsx` | `v3ProductsPage.tsx:536`, `SearchResultsPage.tsx`, `v3RelevantProducts.tsx:158` | No | `POST products/data {...}`; heart tap → `POST liked/toggle` (only call site app-wide); view → `POST last-seen/add` (fire-and-forget); add-to-cart → `POST cart/add` |
| **Product detail (legacy v1, still live!)** | `app/(tabs)/HomeCategoryPage/ProductExtendedPage.tsx` | `CustomHeaderHomeTab.tsx:773-776` — home header's own search-dropdown result tap | No | `v1/home/getProductById`; `v1/products/viewed`; `v1/favourites/check`; add-to-cart → **`POST /v2/cart/addProduct`** |
| Add vehicle (plate/VIN) | `app/(tabs)/HomeCategoryPage/AddCarPage.tsx` | Rendered by `Header.tsx` whenever no vehicle selected | No | `POST car/select {device_id, user_id, licence_plate, country}` |
| VIN/plate scanner | `app/v3VehicleScanner.tsx` | `AddCarPage.tsx:1330` | No | none — on-device OCR only |
| EAN barcode scanner | `app/v3EanScanner.tsx` | `CustomHeaderHomeTab.tsx:675` | No | none directly — routes to search results with scanned code |
| **Cart** | `app/(tabs)/v3CartPage.tsx` (also wraps the visible `CartPage` tab) | Tab bar; router.push from cart-animation | **No — not gated at all** | `POST cart/get`; `POST cart/add`; `POST cart/update`; `POST cart/remove`; `POST cart/clear` |
| Checkout — entry/address | `app/v3CheckoutPage.tsx` | `v3CartPage.tsx:279` | No — has its own guest/login "choice" screen | `POST order/getPublicKey`; `POST address/get` (logged-in only) |
| Checkout — shipping/confirm | `app/v3ShippingPage.tsx` | `v3CheckoutPage.tsx:384` | No | `POST shipping/options`; `POST orders/create` |
| Order confirmation | `app/v3OrderConfirmPage.tsx` | `v3ShippingPage.tsx:179-182` after successful order | No | none — pure route-param display |
| Order list | `app/(tabs)/v3AccountPage/v3OrdersPage.tsx` | `v3AccountPage/index.tsx:185` | Not blocked client-side, but `orders/proxy-list` needs a real `user_id` | `POST orders/proxy-list {device_id, user_id}` |
| Order detail | `app/(tabs)/v3AccountPage/v3OrderDetailPage.tsx` | `v3OrdersPage.tsx:72` | Same as above | `POST orders/proxy-detail {device_id, user_id, order_id}` |
| Account / "log in" surface | `app/(tabs)/v3AccountPage/index.tsx` | Tab bar | No — shows guest state + inline login CTA | `POST auth/me`, `POST auth/sessions`, `POST auth/logout` — all gated on `isAuthorised && user_id !== null` |
| Liked / favourites | `app/(tabs)/v3AccountPage/v3LikedPage.tsx` | `v3AccountPage/index.tsx:174` | No | `POST liked/get` (product-hydrated variant) |
| Recently viewed | `app/(tabs)/v3AccountPage/v3LastSeenPage.tsx` | `v3AccountPage/index.tsx:180` | No | `POST last-seen/get` (product-hydrated variant) |
| Promotions (placeholder) | `app/(tabs)/PromotionsPage.tsx` | Tab bar | No | none — static empty state |
| **Notifications list** | `app/(tabs)/v3NotificationsPage.tsx` | Tab bar; push tap | **Yes — already gated**: `if (!isReady \|\| !isAuthorised) return;` blocks fetch, renders login-required empty state | `POST notifications/list`; `POST notifications/unread-count` |
| Notification detail | `app/(tabs)/v3NotificationsDetailPage.tsx` | `v3NotificationsPage.tsx:62` | Inherits parent gating | `POST notifications/detail`; tap-to-read → `POST notifications/read`; "mark all read" → `POST notifications/read-all` |

**The `v3NotificationsPage` `isReady && isAuthorised` guard + login-required empty state is the only existing hard-gate precedent in the codebase — the closest template for how to gate cart/checkout.**

### Confirmed dead / orphaned screens (do not build on these — flag for a deletion decision)

| File | Why dead |
|---|---|
| `app/Login.tsx` (~4000 lines) | File-based routing, but its only caller (`MyPorzaPage/index.tsx:765`) sits inside an orphaned tree — dead in practice. Uses legacy `/v1/account/login`. |
| `app/(tabs)/MyPorzaPage/*` (`index.tsx`, `MyData.tsx`, `Orders.tsx`, `OrderPage.tsx`, `ConfirmData.tsx`) | `href: null`; nothing outside this folder navigates in. Fully self-referential. Uses legacy `/v1/account/*`, `/v1/account/getOrders`, `/v1/account/getOrderDetails`. `Orders.tsx`/`OrderPage.tsx` render a richer price/VAT breakdown than the live v3 order screens. |
| `app/(tabs)/MyPorzaPage/_layout.tsx:91` Login sub-route | References `app/(tabs)/MyPorzaPage/Login.tsx`, which does not exist — broken reference. |
| `app/(tabs)/CartPage.tsx` lines 1-5308, 5411-5646 (`CartPageInner`) | Dead cart history plus one live-but-unreachable legacy `/v2/cart` implementation. |
| `app/(tabs)/HomeCategoryPage/ProductsPage.tsx` (15,941 lines) | Only entry point, `SubCategoryItem.tsx`, is itself never rendered anywhere — orphaned, including its own live `/v2/cart/addProduct` and `v1/home/getbrands` etc. references. |
| `CarBrandList.tsx`, `BrandModelList.tsx`, `CarVersionsList.tsx` | Live legacy implementation (`v1/home/getbrands`, `v1/home/getModels`, `v1/home/setCar`), but only entry point (manual brand/model link in `AddCarPage.tsx`) is commented out. |
| `components/cart/CartItem.tsx`, `CartSummary.tsx` | Only imported by the dead `CartPageInner` above. |
| `components/Utility/session.ts` `clearSessionPhpsessid()`, `hooks/SessionContext.tsx`, `hooks/UserStateContext.tsx` | Defined, never mounted into the live provider tree. |
| `HomeCategoryPage/_layout.tsx:33` `FiltersPage` Stack.Screen | `FiltersModal.tsx` similarly unreferenced. |
| `app/modal.tsx` | Boilerplate, unused. |
| `services/v3LikedService.ts` `checkLiked()` (`liked/check`) | Defined, never called anywhere in the app. |

**Live inconsistency, flagged:** the home-tab header's search dropdown (`CustomHeaderHomeTab.tsx`) fetches results from the **v3 search endpoint** but navigates to the **legacy v1** `ProductExtendedPage.tsx`, while full search (`SearchResultsPage.tsx`) correctly navigates to the v3 detail page. Two different, simultaneously-reachable "add to cart" implementations exist depending on which search UI was used.

---

## 2. Auth / session state

Storage — `expo-secure-store`, keys in `hooks/v3AuthContext.tsx:7-10`:
```ts
const PROXY_KEY_STORE = "PROXY_KEY";
const SERVER_KEY_STORE = "SERVER_KEY";
const USER_ID_STORE = "USER_ID";
const PUBLIC_KEY_STORE = "PUBLIC_KEY";
// plus DEVICE_ID_KEY = "DEVICE_ID" in services/v3DeviceService.ts (shared)
```
On login (`v3AuthContext.tsx:92-94`) writes `proxy_key`, `server_key`, `user_id`; on logout (`v3AuthContext.tsx:112-115`) deletes those three (`device_id` survives).

A **second, independent legacy identity system** exists in parallel: `expo-sqlite` table `session` (`uniqueDeviceId`, `cartId`, `phpsessid`, `loggedIn` 0/1), written by `hooks/use-init-user.ts` (near-duplicated in another hook), used by the live legacy `ProductExtendedPage.tsx` path.

**Single source of truth:** `useV3Auth().isAuthorised` — consumed in 35 files, and it genuinely is the one true flag for the v3 stack. Applied **inconsistently by design**: `hooks/v3CartContext.tsx` and `app/(tabs)/v3CartPage.tsx` never check it (only `device_id`/`isReady`) — this is exactly the mechanism that lets guest cart work today.

`POST /v3/device/check` — called once on mount, `hooks/v3AuthContext.tsx`, body `{proxy_key, server_key, device_id, user_id}`. Branch:
```ts
if (result.authorised) {
  // store server_key, keep existing user_id, isAuthorised = user_id !== null
} else {
  // clear server_key, store public_key for future login, user_id -> null
}
```
`isReady` only flips true in the `finally` block — most screens wait on this.

**Existing 401 handling: none, anywhere, in the cart/checkout stack.** `CartService`'s generic `post()` only branches on `res.ok`, throwing one undifferentiated `Error("v3Cart <path> failed: <status>")` for any non-2xx (400/401/500 alike). Every call site in `hooks/v3CartContext.tsx` does a bare `catch { reload(); }` — no status inspection, no forced logout, no user-facing error, no redirect to login. A 401 today would silently revert an optimistic UI update and re-fetch, indistinguishable from any other transient failure.

---

## 3. Cart screens — exact current behavior

Live cart screen: `app/(tabs)/v3CartPage.tsx`, backed by `hooks/v3CartContext.tsx` + `services/v3CartService.ts`.

### Add-to-cart — TWO live, parallel paths today

**Path A (v3, primary)** — from `v3ProductExtendedPage.tsx` and product cards carrying a `productId` (e.g. `ProductPeekCard.tsx`):
```ts
// hooks/v3CartContext.tsx:98-130
const addToCart = useCallback(async (product_id, quantity = 1, origin?) => {
  if (!isReady || !device_id) return;   // NOTE: no auth check
  // optimistic local update, then:
  const res = await CartService.addToCart({ device_id, user_id, product_id, quantity });
  ...
}, [...]);
```
`POST /v3/cart/add`, no Authorization header, body: `{ "device_id": "<string>", "user_id": null, "product_id": <number>, "quantity": <number> }`

**Path B (legacy v2, still live)** — reached only via `CustomHeaderHomeTab.tsx`'s search dropdown → legacy `ProductExtendedPage.tsx`:
```ts
// components/Utility/addToCart.ts:42-62
export async function addToCartRequest(session, productId) {
  const { API_URL } = getExtra();
  const response = await fetch(`${API_URL}/v2/cart/addProduct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uniqueDeviceId: session.uniqueDeviceId,
      cartId: session.cartId,
      phpsessid: session.phpsessid,
      productId: String(productId),
    }),
  });
  return response.json();
}
```
Guarded only by `if (!session...)` — an anonymous device session, not a login check.

**Correction to an earlier automated finding:** `ProductsPage.tsx`'s own `addToCartRequest` call is not actually reachable — its only router entry point, `SubCategoryItem.tsx`, is never rendered anywhere (confirmed dead). Only the search-dropdown → legacy product-detail-page route into Path B is genuinely live.

**Needs clarification:** any backend auth requirement must cover both `/v3/cart/*` and this live `/v2/cart/addProduct` path, or the legacy path remains an unauthenticated bypass — reachable from the home header's search bar.

### Opening the cart (logged-out user)
```ts
// hooks/v3CartContext.tsx:69-83
CartService.getCart({ device_id, user_id })   // POST /v3/cart/get, {device_id, user_id: null}
  .then(res => { if (res.success) setItems(res.items ?? []); })
  .catch(() => {});   // failures silently swallowed
```
On failure or a genuinely empty cart, `v3CartPage.tsx:141-2xx` renders the same generic empty-state UI — **no distinction** between "call failed/401" and "cart truly has nothing in it."

### Update / remove / clear

| Endpoint | Body | UI trigger |
|---|---|---|
| `POST /v3/cart/update` | `{device_id, user_id, product_id, quantity}` | quantity stepper (`v3CartContext.tsx:145-161`); quantity ≤ 0 redirects into `removeFromCart` |
| `POST /v3/cart/remove` | `{device_id, user_id, product_id}` | trash icon per row |
| `POST /v3/cart/clear` | `{device_id, user_id}` | "clear cart" button, confirmed via `Alert.alert` |

### Guest-cart UI concept
**None on the cart screen itself** — no banner, no conditional-on-logged-in state anywhere in `v3CartPage.tsx`. The only guest/login distinction in the whole flow is one step downstream, at checkout (§5).

### Types
```ts
// services/v3CartService.ts:3-13
export interface CartItem { product_id: number; quantity: number; ... }
export interface CartResponse { success: boolean; items: CartItem[]; total_items: number; total_quantity: number; }
```
Product display data (title/price/image/sku) is fetched separately and joined client-side in `v3CartPage.tsx:150-166` — the cart backend only ever deals in `product_id`/`quantity`.

---

## 4. Login / signup screens — exact current behavior

**Signup: does not exist.** No `/v3/auth/signup` function anywhere in `services/v3AuthService.ts`; "Account aanmaken" (`v3LoginScreen.tsx:383-395`) just opens `https://nl.ci120.s02.corenio.com/mijn-rekening#` in a browser. **This is the biggest gap for the follow-up prompt** — if cart now requires an account, there's currently no in-app way to create one.

**Login screen:** `components/v3LoginScreen.tsx` — email + password fields, client-side validation is just a non-empty check (`v3LoginScreen.tsx:177-181`). No format/regex validation beyond that.

**Encryption — confirmed RSA-OAEP-SHA256 of `{email, password}`:**
```ts
// services/v3CryptoService.ts:7-29
function rsaEncrypt(data, publicKeyPem) {
  const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
  return publicKey.encrypt(
    forge.util.encodeUtf8(JSON.stringify(data)),
    "RSA-OAEP",
    { md: forge.md.sha256.create(), mgf1: { md: forge.md.sha256.create() } },
  ); // then base64
}
export function encryptCredentials(email, password, publicKeyPem) {
  return rsaEncrypt({ email, password }, publicKeyPem);
}
```
Note: checkout's address encryption uses a **different** function, `encryptData()` — hybrid AES-256-GCM + RSA-OAEP-SHA256 envelope (`{ek, iv, ct, tg}`) — not the same scheme as login. Don't conflate the two.

**Failed login:**
```ts
// services/v3AuthService.ts (loginRequest)
if (!res.ok) throw new Error(res.status >= 500 ? "server_error" : "auth_error");
if (data.authorised === false) throw new Error("invalid_credentials");
// v3LoginScreen.tsx:177-198
catch (err) {
  const msg = err.message === "invalid_credentials" ? t.loginErrorCredentials
    : err.message === "server_error" ? t.loginErrorServer
    : t.loginErrorNetwork;   // "auth_error" falls through here, misleading
  triggerError(msg);
}
```
**Needs clarification:** `"auth_error"` (any non-5xx failure) is mapped to a network error message, not a credentials error — pre-existing bug, adjacent to whatever gets touched next.

**Failed signup:** not applicable — no signup exists.

**Forgot password:** exists, fire-and-forget, silent on both success and failure:
```ts
// v3LoginScreen.tsx:200-210
const handleForgotPassword = async () => {
  if (!email.trim()) { triggerError(t.loginErrorEmpty); return; }
  try { await forgotPasswordRequest(email.trim().toLowerCase()); }
  catch { /* silent — proxy sends the email regardless */ }
};
```
No toast/confirmation either way, no in-app reset-link handling.

**Post-login navigation — fixed destination with a single hardcoded redirect map:**
```ts
// v3LoginScreen.tsx:95-104,118-122
const REDIRECT_ROUTES = { checkout: "/v3CheckoutPage" };
const destination = (redirectTo && REDIRECT_ROUTES[redirectTo]) || "/(tabs)/HomeCategoryPage";
useEffect(() => { if (isAuthorised) router.replace(destination); }, [isAuthorised]);
```
Only `v3CheckoutPage.tsx:452` currently passes `redirectTo=checkout`; every other entry point (e.g. `v3AccountPage/index.tsx:160`) lands on Home regardless of origin.

**No generic "you must log in" gate component exists anywhere** (grep'd repo-wide). Closest precedents: (a) `v3CheckoutPage.tsx`'s guest/login "choice" screen (offers guest as first-class, not a block — §5), and (b) `v3NotificationsPage.tsx`'s `isAuthorised` guard + login-required empty state (an actual hard gate — **best template to reuse**).

---

## 5. Checkout screen

Files: `app/v3CheckoutPage.tsx` (address form) → `app/v3ShippingPage.tsx` (shipping/order-place) → `app/v3OrderConfirmPage.tsx` (confirmation).

**`encrypted_address` payload** — 19 keys total, built in `v3ShippingPage.tsx`:
```ts
const addressPayload = {
  billing_firstname, billing_lastname, billing_email, billing_phone,
  billing_address, billing_addressnumber, billing_postalcode, billing_city, billing_companyname,
  shipping_different: form.shipping_different,
  shipping_firstname, shipping_lastname, shipping_phone, shipping_address,
  shipping_addressnumber, shipping_postalcode, shipping_city, shipping_companyname, // "" if not different, not omitted
  shipping_option_id: selectedShippingId,
};
const encrypted_address = await encryptData(addressPayload, publicKey);
```
Sent as `POST orders/create {device_id, user_id, encrypted_address}` — every field travels inside the ciphertext.

**"Ship to a different address" toggle:** collected AND sent — `shipping_different` gates which fields are required (`v3CheckoutPage.tsx:367-378`) and are always included in the payload above. However, **nothing downstream ever displays it back** — `v3ShippingPage.tsx`'s own review card only shows `billing_*` fields, `v3OrderConfirmPage.tsx` shows nothing, and `OrderDetail.delivery_address` has no `shipping_*` fields at all — a distinct shipping address is invisible in the UI both before and after order placement, even though it's transmitted.

**Shipping options:** fetched from the backend, not hardcoded.
```ts
// services/v3CheckoutService.ts:42-48
export function getShippingOptions(params: {device_id, user_id, language?}) {
  return post("shipping/options", params);
}
// ShippingOption: { id, name, price, price_label, free }
```

**`external_order_id` is never read anywhere in the running app** — only appears in type declarations (`v3CheckoutService.ts:61` optional; `v3OrdersService.ts:16,37` required-non-optional string — a latent type inconsistency if the backend nulls it on list/detail too, currently harmless since nothing reads it). Zero hits under `app/` or `components/` actually rendering it. **Will not break, show blank, or error** from `external_order_id` always being `null`.

**Order confirmation screen** receives exactly one route param, no context, no fresh fetch:
```ts
const { orderId } = useLocalSearchParams<{ orderId: string }>();
```
populated by `v3ShippingPage.tsx:179-182` (`router.replace({pathname:"/v3OrderConfirmPage", params:{orderId:String(result.order_id)}})`). Renders a static success message, an order-number card if `orderId` exists, a "keep your receipt trail" note, and a back-to-shop button — **no items, no total, no address ever shown.**

**Auth guard on checkout: none blocking — guest checkout is a first-class, currently-supported path.**
```ts
// v3CheckoutPage.tsx:301,311-313
const { device_id, user_id, isAuthorised } = useV3Auth();
const [mode, setMode] = useState<"choice"|"saved"|"form">(
  forceForm === "1" ? "form" : isAuthorised ? "form" : "choice"
);
```
Guests land on `mode === "choice"` (lines 418-460), explicitly offering:
```tsx
<TouchableOpacity onPress={() => setMode("form")}>{t.checkoutContinueAsGuest}</TouchableOpacity>
<TouchableOpacity onPress={() => router.push("/v3Login?redirectTo=checkout")}>{t.checkoutLoginInstead}</TouchableOpacity>
```
`user_id: null` flows straight through to every checkout service call (`getPublicKey`, `getShippingOptions`, `createOrder`), all typed to accept it.

---

## 6. Order history / order detail

**List** — `v3OrdersPage.tsx`: `POST orders/proxy-list {device_id, user_id}` → `OrderListItem[]`. Renders per order: order number (`corenio_order_id` — not `id` or `external_order_id`), a status badge, recipient name+city, quantity (`total_quantity`), and date only. **No price or currency shown on the list at all.**

**Detail** — `v3OrderDetailPage.tsx`: single call, `POST orders/proxy-detail {device_id, user_id, order_id}` — everything (including line-item images/brand/sku) comes from this one response, no secondary product fetch. Renders order number/date/status, a delivery-address card (**uses `billing_*`-prefixed field names for what's labeled the delivery address** — a naming inconsistency worth flagging), and one card per line item showing thumbnail, brand name, sku, quantity, and `price_inc_vat` with a hardcoded "€" prefix (not sourced from any currency field — **there is no currency field in the type at all**).

**No `total_amount`, no order-level total/subtotal/VAT breakdown, no currency field** anywhere in the live v3 order screens or `v3OrdersService.ts` types. Only per-line-item quantity and incl.-VAT price. (Contrast: the dead `MyPorzaPage/Orders.tsx`/`OrderPage.tsx` does render a full subtotal/VAT/total breakdown from `/v1/account/getOrderDetails` — dead code today, but shows the richer UX previously existed.)

---

## 7. Navigation / routing structure

- **Library:** Expo Router (file-based, wraps `@react-navigation`) — `Stack` for the root and each nested folder, `Tabs` for the bottom bar.
- **Provider nesting** (`app/_layout.tsx:398-433`): `V3AuthProvider` → `V3VehicleProvider` → `V3CartProvider` → `V3LikedProvider` → `V3LastSeenProvider` → `V3NotificationsProvider` → `LanguageProvider` → `<Stack>`. `V3AuthProvider` wraps everything, so `useV3Auth()` is available app-wide.
- **No central navigation guard exists.** Every auth check found is a per-screen call to `useV3Auth().isAuthorised` (the one legacy exception, `hooks/session.ts`'s `isUserLoggedIn()`, is itself dead in practice). There is no wrapper component, no `_layout.tsx`-level redirect, no route-based middleware. Adding a cart/checkout gate means either (a) editing `v3CartPage.tsx`/`v3CheckoutPage.tsx`/`hooks/v3CartContext.tsx` directly, or (b) building a new reusable gate component/hook — nothing like that exists today.
- **Cart has exactly one live screen** (`v3CartPage.tsx`, rendering both the visible `CartPage` tab and the hidden `v3CartPage` route, both resolving to the same component) — a guard added there covers every "tap Cart" entry point uniformly. **Add-to-cart has two separate live code paths** (v3 context vs. legacy `addToCartRequest`) that would each need their own guard — see §3.

---

## Master endpoint reference (everything the app calls, by base)

**`/v3/device/*`** — `device/check` (global, launch), `device/push-token`
**`/v3/auth/*`** — `auth/login`, `auth/me`, `auth/sessions`, `auth/logout`, `auth/forgot-password` (no `auth/signup` exists)
**`/v3/categories`, `/v3/categories/sub`** — Home, SubCategory
**`/v3/products`, `/v3/products/data`, `/v3/products/filters`, `/v3/products/relevant`** — product list/detail/filters/recommendations
**`/v3/search`** — SearchResultsPage + header search dropdown
**`/v3/car/get`, `/v3/car/select`, `/v3/car/remove`** — vehicle selection (global + AddCarPage + "remove vehicle")
**`/v3/cart/add`, `/v3/cart/get`, `/v3/cart/update`, `/v3/cart/remove`, `/v3/cart/clear`** — cart
**`/v3/liked/toggle`, `/v3/liked/get`, `/v3/liked/check`** (defined, never called — dead) — favourites
**`/v3/last-seen/add`, `/v3/last-seen/get`** — recently viewed
**`/v3/order/getPublicKey`, `/v3/shipping/options`, `/v3/address/get`, `/v3/orders/create`** — checkout
**`/v3/orders/proxy-list`, `/v3/orders/proxy-detail`** — order history
**`/v3/notifications/list`, `/v3/notifications/unread-count`, `/v3/notifications/read`, `/v3/notifications/read-all`, `/v3/notifications/detail`** — notifications (account-only, already gated)

**Legacy, still live in parallel** (different base, `API_URL` not `EXPO_PUBLIC_PROXY_URL`): `/v2/cart/addProduct` (from the legacy product-detail page reached via home-header search), and the orphaned-but-technically-reachable `/v1/account/login`, `/v1/account/logout`, `/v1/home/getProductById`, `/v1/products/viewed`, `/v1/favourites/check`. **Fully dead legacy:** `/v1/account/getOrders`, `/v1/account/getOrderDetails`, `/v1/home/getbrands`, `/v1/home/getModels`, `/v1/home/getVersions`, `/v1/home/setCar` — unreachable from the live app today, out of scope unless that dead code is revived.

---

## Consolidated "Needs clarification" list

1. **Dual add-to-cart systems** (`/v3/cart/add` vs. live `/v2/cart/addProduct` via the home header's search dropdown → legacy product page) — any auth requirement must cover both or the legacy path is a silent bypass.
2. **No signup flow exists in-app at all** — registration is external-website-only today. If cart now requires an account, this is the first gap to close, not just login-gating.
3. `v3NotificationsPage.tsx`'s `isAuthorised` gate is the only existing hard-gate precedent — reuse as the pattern rather than inventing a new one.
4. **Search-dropdown vs. full-search inconsistency:** `CustomHeaderHomeTab.tsx` fetches v3 search results but routes to the legacy `ProductExtendedPage.tsx`; `SearchResultsPage.tsx` correctly routes to the v3 detail page. Worth fixing regardless of the migration, since it's the entry point to the legacy cart-add path in #1.
5. `OrderListItem.external_order_id` / `OrderDetail.external_order_id` typed as required-non-optional string — harmless today (nothing reads them) but a type-only lie if the backend also nulls these fields on list/detail responses, not just `orders/create`.
6. `"auth_error"` login-failure case maps to a misleading network-error message in `v3LoginScreen.tsx` — pre-existing bug, adjacent to code that will be touched.
7. Saved address's `shipping_different` and `shipping_option_id` are not hydrated back into the checkout form when loading a saved address — confirm this is intentional "always re-pick shipping" behavior.
8. Broken route reference: `MyPorzaPage/_layout.tsx` registers a Login sub-route that doesn't exist as a file. Only matters if that dead subtree is revived.
9. Legacy `Orders.tsx`/`OrderPage.tsx` show a richer price/VAT breakdown than the live v3 order screens — flag for product/design in case that UX is wanted back.
10. `PROXY_API_CONTRACT.md` is stale relative to today's direction (it documents guest checkout; this task moves partway back) — the follow-up implementation prompt should explicitly say this doc needs a rewrite, not just new code.
