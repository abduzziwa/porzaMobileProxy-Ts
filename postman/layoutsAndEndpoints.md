# Porza App — Routing Tree, Endpoints, and Login/Signup Touchpoints

Read-only audit, built strictly from Expo Router's `_layout.tsx` registrations (not a free file search). Every `_layout.tsx` under `app/` was opened (5 total, confirmed via `find app -name "_layout.tsx"`). The tree below walks them in registration order, recursing into every nested stack before moving to the next sibling. A cross-check of every live `router.push`/`router.replace` destination against this tree follows at the end.

**Headline finding (the gap from the previous pass):** the previous free-form audit reported `app/Login.tsx` and the `MyPorzaPage` subtree as an orphaned, self-contained "top-level" legacy screen. Walking the tree strictly shows something more specific: `app/(tabs)/MyPorzaPage/_layout.tsx` registers a `Login` screen **as a sibling stack entry alongside `MyData` (step 2/3), `ConfirmData` (step 3/3), `Orders`, and `OrderPage`** — i.e., in the legacy architecture, login was a *nested step inside the order-creation stack itself*, not a top-level screen. Concretely: `app/(tabs)/MyPorzaPage/MyData.tsx` (step 2 of the legacy checkout wizard) contains a hard `useEffect` gate that runs on every mount and silently `router.replace()`s to that nested Login screen if the user isn't logged in — this is a login touchpoint embedded *inside* the order-creation flow, not a separate top-level screen visit. And critically: the target file `app/(tabs)/MyPorzaPage/Login.tsx` **does not exist** — the registration in `_layout.tsx` points at nothing. Full detail under `MyData` below.

---

## app/_layout.tsx (root)

Registers (`<Stack>` at lines 408-424), in order:

- **index** -> `app/index.tsx`
  - endpoints: none directly — renders `PorzaSplash` while `useV3Auth().isReady` is false, then `<Redirect href="/(tabs)/HomeCategoryPage">`. (Global bootstrap fired by the `V3AuthProvider` it sits under, not by this screen itself: `POST device/check {proxy_key, server_key, device_id, user_id}`.)
  - embedded login/signup UI: no

- **(tabs)** -> `app/(tabs)/_layout.tsx` **[recurse below]**

- **v3Login** -> `app/v3Login.tsx` (5-line file: `export default function V3Login() { return <V3LoginScreen />; }`, imports `components/v3LoginScreen.tsx`)
  - endpoints: `POST auth/login {token: <RSA-OAEP-SHA256 encrypted {email,password}>, device_id, app_version, platform}` (`services/v3AuthService.ts:38-59`, encryption via `services/v3CryptoService.ts:23-29 encryptCredentials()`); `POST auth/forgot-password {email}` (`v3AuthService.ts:122-130`)
  - embedded login/signup UI: **yes — this IS the login screen** (email + password fields, `secureTextEntry` on the password field). No signup form embedded — the "Account aanmaken" button (`v3LoginScreen.tsx:383-395`) does `Linking.openURL("https://nl.ci120.s02.corenio.com/mijn-rekening#")`, leaving the app entirely; there is no in-app signup form anywhere (confirmed: no `/v3/auth/signup` function exists in `v3AuthService.ts`).

- **modal** -> `app/modal.tsx`
  - endpoints: none — unmodified Expo Router starter boilerplate (`<Link href="/" dismissTo>`), not wired into any live flow
  - embedded login/signup UI: no

- **v3CheckoutPage** -> `app/v3CheckoutPage.tsx` (977 lines, read in full)
  - endpoints: `POST order/getPublicKey {device_id, user_id}` (`v3CheckoutService.ts`, called indirectly — actually this call lives in `v3ShippingPage.tsx`, see below; `v3CheckoutPage.tsx` itself only calls:) `POST address/get {device_id, user_id}` (`CheckoutService.getAddress`, `v3CheckoutPage.tsx:338`, only fires when `isAuthorised` and `forceForm !== "1"`). Also calls the external Google Places API directly (not a proxy endpoint): `POST https://places.googleapis.com/v1/places:autocomplete` and `GET https://places.googleapis.com/v1/places/{placeId}` (`v3CheckoutPage.tsx:106,144`, hardcoded API key at line 88) for the address-autocomplete `AddressSearch` component.
  - embedded login/signup UI: **checked carefully, full file read — no embedded form.** When `!isAuthorised`, this screen renders a `"choice"` mode (`v3CheckoutPage.tsx:418-460`) with two buttons: `t.checkoutContinueAsGuest` (`onPress={() => setMode("form")}`, stays on this screen) and `t.checkoutLoginInstead` (`onPress={() => router.push("/v3Login?redirectTo=checkout")}`, **navigates away** to the root `v3Login` screen with a redirect param that sends the user back to `/v3CheckoutPage` after a successful login). This is a navigate-away CTA, not an embedded form/modal — confirmed by full-file read and by a repo-wide `secureTextEntry` grep that hits only `v3LoginScreen.tsx` and legacy `Login.tsx`.

- **v3ShippingPage** -> `app/v3ShippingPage.tsx` (437 lines, read in full)
  - endpoints: `POST order/getPublicKey {device_id, user_id}` (`CheckoutService.getPublicKey`, `v3ShippingPage.tsx:92`, falls back to the auth-flow's own cached public key on failure); `POST shipping/options {device_id, user_id, language}` (`CheckoutService.getShippingOptions`, `v3ShippingPage.tsx:105`); `POST orders/create {device_id, user_id, encrypted_address}` (`CheckoutService.createOrder`, `v3ShippingPage.tsx:174` — `encrypted_address` built via `encryptData()`, a hybrid AES-256-GCM + RSA-OAEP-SHA256 envelope over a 19-key address payload, `v3ShippingPage.tsx:139-164` — **not** the same encryption function as login)
  - embedded login/signup UI: **checked carefully, full file read — none.** No `password`/`secureTextEntry`/`Modal` anywhere in the file. Guest (`user_id: null`) flows straight through every call on this screen with no gate.

- **v3OrderConfirmPage** -> `app/v3OrderConfirmPage.tsx` (166 lines, read in full)
  - endpoints: none — receives only `orderId` via `useLocalSearchParams`, no fetch of any kind
  - embedded login/signup UI: **checked carefully, full file read — none.** Purely static success content (icon, order-id card, "check your email" note, back-to-shop button).

- **v3VehicleScanner** -> `app/v3VehicleScanner.tsx` (482 lines)
  - endpoints: none — on-device OCR only, via `services/v3VehicleRecognitionService.ts` (`@react-native-ml-kit/text-recognition`, zero network calls per that file's own header comment). Completes via `router.dismissTo({pathname: ADD_CAR_PATH, params: {scannedValue, scannedMode}})` (line 85) — **note:** `ADD_CAR_PATH` is defined locally (line 31) as `"/HomeCategoryPage/AddCarPage"`, omitting the `(tabs)` group segment that every other reference to this same screen uses (`/(tabs)/HomeCategoryPage/AddCarPage`). Flagged in the cross-check section below.
  - embedded login/signup UI: no

- **v3EanScanner** -> `app/v3EanScanner.tsx` (227 lines)
  - endpoints: none — barcode scan only; on success does `router.replace({pathname: SEARCH_RESULTS_PATH, params:{urlPath: code}})` where `SEARCH_RESULTS_PATH = "/(tabs)/HomeCategoryPage/SearchResultsPage"` (line 23, correctly includes the group segment)
  - embedded login/signup UI: no

---

### app/(tabs)/_layout.tsx (nested under `(tabs)`)

Registers (`<Tabs>` at lines 1583-1609), in order:

- **HomeCategoryPage** -> `app/(tabs)/HomeCategoryPage/_layout.tsx` **[recurse below]**

- **PromotionsPage** -> `app/(tabs)/PromotionsPage.tsx` (175 lines, read in full)
  - endpoints: none — static empty-state placeholder ("Geen meldingen"), no API call at all
  - embedded login/signup UI: no

- **CartPage** -> `app/(tabs)/CartPage.tsx` (5,819 lines; lines 1-5308 and 5411-5646 are dead — see below)
  - Live export (`CartPage.tsx:5404-5406`): `export default function CartPage() { return <V3CartPage />; }` — this route just renders the same component as the hidden `v3CartPage` route below, so its endpoints and embedded-login status are identical to `v3CartPage`'s (see under `MyPorzaPage`'s sibling entry further down for the full list).
  - **Dead code inside this file, still worth reporting since it shows the pattern historically**: `CartPageInner()` (lines 5411-5646, live TypeScript but never invoked) used `useApiWithSession<CartData>("v2/cart/getCart")` (body: `{uniqueDeviceId, cartId, phpsessid, user_lang}`) and, on its "proceed to checkout" handler (`CartPage.tsx:5561-5571`), branched on `loggedIn`: if true, `router.push({pathname:"/(tabs)/MyPorzaPage/MyData", params:{cartData}})`; if false, `router.push({pathname:"/(tabs)/MyPorzaPage/Login", params:{cartData}})` — i.e. the OLD cart's "checkout" button was itself the login gate, pushing straight into the (now-broken) nested Login screen as the first step of order creation. Dead today, but the same broken-route reference as the live `MyData.tsx` gate below.
  - embedded login/signup UI: no (the live path is just a 1-line wrapper)

- **v3NotificationsPage** -> `app/(tabs)/v3NotificationsPage.tsx` (255 lines)
  - endpoints: `POST notifications/list {device_id, user_id, limit:20, offset}` and `POST notifications/unread-count {device_id, user_id}` (`v3NotificationsContext.tsx`, both gated behind `canFetch = isReady && isAuthorised && !!device_id && user_id !== null` — the only screen in the whole tree with a genuine hard auth gate on its data fetch)
  - embedded login/signup UI: no form/button — when `!isAuthorised`, renders static text only: `{t.notificationsLoginRequired}` (`v3NotificationsPage.tsx:126`), no CTA to navigate to login (confirmed by grep — the only `router.push` in this file targets the notification-detail screen, not login)

- **v3AccountPage** -> `app/(tabs)/v3AccountPage/_layout.tsx` **[recurse below]**

- **v3CartPage** `[hidden — href: null]` -> `app/(tabs)/v3CartPage.tsx` (490 lines)
  - endpoints: `POST cart/get {device_id, user_id}`; `POST cart/add {device_id, user_id, product_id, quantity}`; `POST cart/update {device_id, user_id, product_id, quantity}`; `POST cart/remove {device_id, user_id, product_id}`; `POST cart/clear {device_id, user_id}` (all via `hooks/v3CartContext.tsx` → `services/v3CartService.ts`, **none gated on `isAuthorised`** — only `device_id`/`isReady`); also fetches display data for cart line items via `POST products/data {device_id, user_id, product_ids, language}` (`v3CartPage.tsx:143-166`)
  - embedded login/signup UI: no — checked full file, no password field, no Modal, no login button. The only navigation out is `router.push("/v3CheckoutPage")` (line 279, "proceed to checkout") and `router.push("/(tabs)/HomeCategoryPage")` (line 192, empty-cart "browse" button).
  - **This is the same component rendered by the visible `CartPage` tab above** — one live screen, two route names.

- **MyPorzaPage** `[hidden — href: null]` -> `app/(tabs)/MyPorzaPage/_layout.tsx` **[recurse below]**

- **v3NotificationsDetailPage** `[hidden — href: null]` -> `app/(tabs)/v3NotificationsDetailPage.tsx` (177 lines)
  - endpoints: `POST notifications/detail {device_id, user_id, notification_id}`; tap-to-read → `POST notifications/read {device_id, user_id, notification_id}`; "mark all read" → `POST notifications/read-all {device_id, user_id}` (all via `v3NotificationsContext.tsx` / `v3NotificationsService.ts`)
  - embedded login/signup UI: no

---

#### app/(tabs)/HomeCategoryPage/_layout.tsx (nested under `HomeCategoryPage`)

Registers (`<Stack>` at lines 11-136), in order:

- **index** -> `app/(tabs)/HomeCategoryPage/index.tsx` (212 lines)
  - endpoints: `POST categories {device_id, user_id, language, ktype_ids?}` (`v3CategoryService.ts`, `index.tsx:66-71`)
  - embedded login/signup UI: no. This screen's header (`SelectedCarHeader` + `CustomHeaderHomeTab`, configured in the `_layout.tsx` `options.header`) renders `AddCarPage`'s entry point when no vehicle is selected, and the header's own search dropdown fires `POST search {device_id, user_id, query, language, page, per_page, ktype_ids?}` (`CustomHeaderHomeTab.tsx:686`, via `v3SearchService.ts`) — attributed here since the header is not itself a registered route.

- **AddCarPage** -> `app/(tabs)/HomeCategoryPage/AddCarPage.tsx` (1,666 lines)
  - endpoints: `POST car/select {device_id, user_id, licence_plate, country}` via `useV3Vehicle().selectByPlate()` (`AddCarPage.tsx:1330` pushes to the scanner; the actual plate-submit path calls `selectByPlate`, which is `services/v3CarService.ts:42-61`). No direct `fetch`/`useApiWithSession` calls found in this file itself (confirmed by grep) — all networking goes through the `V3VehicleProvider` context.
  - embedded login/signup UI: no

- **FiltersPage** -> **NO FILE.** `HomeCategoryPage/_layout.tsx:33` registers `<Stack.Screen name="FiltersPage" .../>` but no `FiltersPage.tsx` exists anywhere under `app/(tabs)/HomeCategoryPage/`. Broken registration — flagged in the cross-check section. (A separate, unrelated `components/v3FiltersModal.tsx` exists but is not this registered route and is not imported by anything registered here.)
  - endpoints: n/a — no file
  - embedded login/signup UI: n/a — no file

- **SubCategoryPage** -> `app/(tabs)/HomeCategoryPage/SubCategoryPage.tsx` (226 lines)
  - endpoints: `POST categories/sub {device_id, user_id, parent_id, language, ktype_ids?}` (`v3CategoryService.ts`, `SubCategoryPage.tsx:64-70`)
  - embedded login/signup UI: no. Shares the same header components as `index` above (`SelectedCarHeader` + `CustomHeaderHomeTab`, per `_layout.tsx:42-52`), so the same header-search endpoint (`POST search {...}`) applies here too.

- **ProductsPage** -> `app/(tabs)/HomeCategoryPage/ProductsPage.tsx` (15,941 lines; almost entirely commented history, live tail starting ~line 14964)
  - endpoints (live code, uses the legacy `useApiWithSession` wrapper which POSTs `{uniqueDeviceId, cartId, phpsessid, user_lang, ...extraFields}` to `${API_URL}/<route>`): `useApiWithSession<ProductResponse[]>("v1/home/getProducts", {url: urlPath, refresh, brands, ktype?})` (`ProductsPage.tsx:15374-15377`); `useApiWithSession<{brands, fittingList, ...}>("v1/home/getbrandsList", {url: urlPath})` (`ProductsPage.tsx:15379-15387`); add-to-cart via `components/Utility/addToCart.ts` → `POST /v2/cart/addProduct {uniqueDeviceId, cartId, phpsessid, productId}` (`ProductsPage.tsx:15628`, calling the shared `addToCartRequest`)
  - embedded login/signup UI: no
  - **Reachability note:** this screen's only entry point, `components/ui/HomeCategoryPage/SubCategoryItem.tsx` (`router.push({pathname:"/(tabs)/HomeCategoryPage/ProductsPage", ...})`), is itself never rendered anywhere in the live component tree (confirmed by grep for its own usage) — the registered route exists and is technically routable by a manual `router.push`, but nothing currently triggers that push. Reported per the tree method regardless (route is registered, per instructions).

- **v3ProductsPage** -> `app/(tabs)/HomeCategoryPage/v3ProductsPage.tsx` (689 lines)
  - endpoints: `POST products/filters {device_id, user_id, category_ids, ktype_ids?, language}` and `POST products {device_id, user_id, category_ids, ktype_ids?, brand_ids?, property_ids?, language, page, limit}` (`v3ProductsService.ts`, both called from `v3ProductsPage.tsx:302-372`)
  - embedded login/signup UI: no

- **ProductExtendedPage** -> `app/(tabs)/HomeCategoryPage/ProductExtendedPage.tsx` (6,664 lines; live tail starting at line 5819)
  - endpoints: `useApiWithSession<CorenioProductResponse>("v1/home/getProductById", {productId: itemId, language})` (`ProductExtendedPage.tsx:5822-5829`, body: `{uniqueDeviceId, cartId, phpsessid, user_lang, productId, language}`); `POST /v1/products/viewed {uniqueDeviceId, productId}` (raw fetch, `ProductExtendedPage.tsx:5864-5871`, fire-and-forget "recently viewed" tracking); `POST /v1/favourites/check {uniqueDeviceId, productId}` (raw fetch, `ProductExtendedPage.tsx:5878-...`); add-to-cart → `POST /v2/cart/addProduct {uniqueDeviceId, cartId, phpsessid, productId}` (via `addToCartRequest`, `ProductExtendedPage.tsx:5934-5938`)
  - embedded login/signup UI: no
  - **Reachability note: this legacy screen IS live** — reached via `components/components/CustomHeaderHomeTab.tsx:773-776` (the home-tab header's own inline search-dropdown result tap: `router.push({pathname:"/(tabs)/HomeCategoryPage/ProductExtendedPage", params:{item, itemId}})`). That header component is live (used by both `index` and `SubCategoryPage` above), so this legacy product-detail page and its `/v2/cart/addProduct` add-to-cart path are genuinely reachable today, in parallel with the v3 detail page below.

- **v3ProductExtendedPage** -> `app/(tabs)/HomeCategoryPage/v3ProductExtendedPage.tsx` (952 lines)
  - endpoints: `POST products/data {device_id, user_id, product_ids, language}` (`v3ProductsService.ts`); heart tap → `POST liked/toggle {device_id, user_id, product_id}` (`v3ProductExtendedPage.tsx:617`, the only call site of this endpoint in the whole app); on view → `POST last-seen/add {device_id, user_id, product_id}` (fire-and-forget); add-to-cart → `POST cart/add {device_id, user_id, product_id, quantity}` (via `useV3Cart().addToCart`)
  - embedded login/signup UI: no
  - Reached from `v3ProductsPage.tsx:536`, `SearchResultsPage.tsx:59`, `v3RelevantProducts.tsx:158`, `v3LikedPage.tsx:150`, `v3LastSeenPage.tsx:147`, and the deep-link handler in root `app/_layout.tsx:327-340`.

- **CarBrandList** -> `app/(tabs)/HomeCategoryPage/CarBrandList.tsx` (430 lines)
  - endpoints: `useApiWithSession<CarBrand[]>("v1/home/getbrands")` (`CarBrandList.tsx:152-154`, body: `{uniqueDeviceId, cartId, phpsessid, user_lang}`, no extra fields)
  - embedded login/signup UI: no
  - **Reachability note:** the only entry point into this manual brand/model/version chain — a `Link` inside `AddCarPage.tsx`'s "Handmatig selecteren" section — is commented out (`AddCarPage.tsx:629-650`). Route is registered but currently unreachable by any live tap.

- **BrandModelList** -> `app/(tabs)/HomeCategoryPage/BrandModelList.tsx` (484 lines)
  - endpoints: `useApiWithSession<BrandModel[]>("v1/home/getModels", {resource: id})` (`BrandModelList.tsx:174-177`, body: `{uniqueDeviceId, cartId, phpsessid, user_lang, resource}`)
  - embedded login/signup UI: no
  - Entry point: `components/components/addCarPage/carBrandItem.tsx:21` (`router.push({pathname:"/(tabs)/HomeCategoryPage/BrandModelList", ...})`) — live code, but only rendered by `CarBrandList.tsx` above, which is itself unreachable (see note above). On tap, `BrandModelList.tsx:189-193` pushes to `CarVersionsList`.

- **CarVersionsList** -> `app/(tabs)/HomeCategoryPage/CarVersionsList.tsx` (688 lines)
  - endpoints: `useApiWithSession<BrandModel[]>("v1/home/getVersions", {resource: `${modelId}:${versionId}`})` (`CarVersionsList.tsx:261-269`, body: `{uniqueDeviceId, cartId, phpsessid, user_lang, resource}`); on selecting a version, raw `POST /v1/home/setCar {cartId, phpsessid, uniqueDeviceId, resource: model.id}` (`CarVersionsList.tsx:288-299`), then `router.replace("/(tabs)/HomeCategoryPage")`
  - embedded login/signup UI: no
  - Same reachability caveat as above — only reachable from the orphaned `CarBrandList` → `BrandModelList` chain.

- **SearchResultsPage** -> `app/(tabs)/HomeCategoryPage/SearchResultsPage.tsx` (445 lines)
  - endpoints: `POST search {device_id, user_id, query, language, page, per_page, ktype_ids?}` (`v3SearchService.ts`, `SearchResultsPage.tsx`)
  - embedded login/signup UI: no
  - Reached from the header search submit and from `v3EanScanner.tsx`'s barcode-scan success handler. Taps a result → correctly routes to `v3ProductExtendedPage` (`SearchResultsPage.tsx:58-63`), unlike the header dropdown's own inline search which routes to the legacy `ProductExtendedPage` instead (see that entry above) — a live inconsistency between the two search UIs.

---

#### app/(tabs)/v3AccountPage/_layout.tsx (nested under `v3AccountPage`)

Registers (`<Stack>` at lines 9-20), in order:

- **index** -> `app/(tabs)/v3AccountPage/index.tsx` (519 lines, read in full)
  - endpoints: `POST auth/me {user_id, device_id}` (`getMe`, `v3AccountPage/index.tsx:82`); `POST auth/sessions {user_id, device_id}` (`getSessions`, line 83-85); `POST auth/logout {user_id, device_id, logout_all: true}` (`logoutRequest`, line 98, only from the "sign out all devices" modal action) — all three only fire when `device_id && user_id !== null` (`index.tsx:81`)
  - embedded login/signup UI: **checked carefully, full file read — no embedded form.** When `!isAuthorised`, renders a `loginCta` button (`index.tsx:156-165`): `onPress={() => router.push("/v3Login")}` — navigate-away only, no inline fields. No signup CTA on this screen at all (the only "Account aanmaken" button in the whole app lives inside `v3LoginScreen.tsx` itself, reached after tapping this login CTA).

- **v3OrdersPage** -> `app/(tabs)/v3AccountPage/v3OrdersPage.tsx` (226 lines)
  - endpoints: `POST orders/proxy-list {device_id, user_id}` (`v3OrdersService.ts`)
  - embedded login/signup UI: no

- **v3OrderDetailPage** -> `app/(tabs)/v3AccountPage/v3OrderDetailPage.tsx` (312 lines)
  - endpoints: `POST orders/proxy-detail {device_id, user_id, order_id}` (`v3OrdersService.ts`) — single call, all rendered content (line items, images, brand, price) comes from this one response
  - embedded login/signup UI: no

- **v3LikedPage** -> `app/(tabs)/v3AccountPage/v3LikedPage.tsx` (207 lines)
  - endpoints: `POST liked/get {device_id, user_id, language?}` (`getLikedProducts`, product-hydrated variant, `v3LikedService.ts:37-43`)
  - embedded login/signup UI: no

- **v3LastSeenPage** -> `app/(tabs)/v3AccountPage/v3LastSeenPage.tsx` (204 lines)
  - endpoints: `POST last-seen/get {device_id, user_id, limit?, language?}` (`getLastSeen`, product-hydrated variant, `v3LastSeenService.ts:22-29`)
  - embedded login/signup UI: no

---

#### app/(tabs)/MyPorzaPage/_layout.tsx (nested under `MyPorzaPage`)

Registers (`<Stack>` at lines 84-116), in order:

- **index** -> `app/(tabs)/MyPorzaPage/index.tsx` (1,167 lines)
  - endpoints: `POST /v1/account/logout {uniqueDeviceId, cartId, phpsessid}` (raw fetch, `index.tsx:747-755`, "sign out" action) — this is the **only** live network call in this file (confirmed by grep for `fetch(`/`useApiWithSession` — no profile/order-count fetch exists here)
  - embedded login/signup UI: no inline form. Shows `"Gastmodus"` / login button when logged out (`index.tsx:800-826`): `onPress={() => router.push("/(tabs)/MyPorzaPage/Login")}` (line 814) — **this target is the broken nested route, see below.** "Bestellingen" menu row → `router.push("/(tabs)/MyPorzaPage/Orders")` (line 846, only enabled `if (isLoggedIn)`). Logout success handler does `router.dismissAll(); router.replace("/Login")` (lines 763-765) — note this is the **root** `/Login` (unregistered in any `_layout.tsx`, but resolves via Expo Router's file-based auto-routing since `app/Login.tsx` exists), a *different* destination string from the broken nested one used elsewhere in this same file.

- **Login** -> **NO FILE.** `MyPorzaPage/_layout.tsx:91` registers `<Stack.Screen name="Login" .../>`, but no `app/(tabs)/MyPorzaPage/Login.tsx` exists anywhere in the repo (confirmed by glob). **This is the broken registration referenced by three live call sites**: `MyPorzaPage/index.tsx:814` (login button), `MyData.tsx:3745` (auth gate, below), and the dead `CartPage.tsx:5568` (`CartPageInner`, unreachable). All three would fail to navigate anywhere today if triggered — a real bug, not just dead code, since two of the three call sites are live.
  - endpoints: n/a — no file
  - embedded login/signup UI: n/a — no file, but see `MyData.tsx` immediately below for the actual gate that targets this broken route.

- **MyData** -> `app/(tabs)/MyPorzaPage/MyData.tsx` (4,399 lines; live tail from line 3708)
  - endpoints: none of its own — this screen only collects form state locally and forwards it via route params; no `fetch`/`useApiWithSession` call exists in the live code (confirmed by grep — the file's only network-adjacent code is the auth check below, which reads local SQLite session state via `useSessionInit()`, not a network call)
  - **embedded login/signup UI — THIS IS THE MISSED TOUCHPOINT.** `MyData.tsx:3708-3746` (`export default function MyData()`, the live screen):
    ```tsx
    const { session, loading } = useSessionInit();
    const [authChecked, setAuthChecked] = useState(false);
    ...
    useEffect(() => {
      if (loading) return;
      if (session?.loggedIn === 1) {
        setAuthChecked(true);
        return;
      }
      router.replace("/(tabs)/MyPorzaPage/Login");
    }, [loading]);

    if (loading || !authChecked) {
      return <ActivityIndicator .../>;   // blocks the entire form behind this gate
    }
    ```
    `MyData.tsx` is literally **"Stap 2/3 (Mijn Gegevens)"** — step 2 of the legacy 3-step order-creation wizard registered in this same `_layout.tsx` (step 1 is the cart's checkout button, step 3 is `ConfirmData` below). On every mount, before rendering the billing/shipping address form, it silently redirects to the broken `Login` route if the local SQLite session's `loggedIn` flag isn't `1`. This is exactly "a login/signup touchpoint that exists during order creation, not just as a top-level screen" — it is not a standalone screen visit, it's an auth gate embedded inside the middle of the order-creation flow itself, and its target does not exist. If reached today (nothing currently routes into `MyPorzaPage` live, see cross-check below, so it is not currently triggerable by a user — but the code path exists and would break if wired up).
    On successful validation, `handleContinue()` (line 3780-3829) forwards the full address form (billing + shipping, including `billing_vatnumber`/`billing_state`/`shipping_state` fields not present anywhere in the v3 checkout form) to `ConfirmData` via `router.push({pathname:"/(tabs)/MyPorzaPage/ConfirmData", params:{formData, cartData}})`.

- **Orders** -> `app/(tabs)/MyPorzaPage/Orders.tsx` (711 lines; live tail from line 295)
  - endpoints: `useApiWithSession("v1/account/getOrders")` (`Orders.tsx:302`, body: `{uniqueDeviceId, cartId, phpsessid, user_lang}`, no extra fields)
  - embedded login/signup UI: no explicit gate found in this file itself (relies on the tab being unreachable when logged out, per `MyPorzaPage/index.tsx`'s conditional menu row)
  - Taps a row → `router.push({pathname:"/(tabs)/MyPorzaPage/OrderPage", ...})` (`Orders.tsx:393-400`)

- **OrderPage** -> `app/(tabs)/MyPorzaPage/OrderPage.tsx` (1,756 lines; live tail from line 1132)
  - endpoints: `useApiWithSession<OrderResponse>("v1/account/getOrderDetails", {url: urlPath})` (`OrderPage.tsx:1136-1139`, body: `{uniqueDeviceId, cartId, phpsessid, user_lang, url}`)
  - embedded login/signup UI: no
  - Notably renders a full subtotal/VAT/total price breakdown (`OrderPage.tsx:1324-1411`) — richer than the live v3 `v3OrderDetailPage.tsx`, which shows only per-item quantity and incl.-VAT price with no order-level total.

- **ConfirmData** -> `app/(tabs)/MyPorzaPage/ConfirmData.tsx` (3,173 lines; live tail from line ~2513)
  - endpoints: `POST /v1/account/createOrder` (raw fetch, `ConfirmData.tsx:2612-2616`) — the actual **order-placement** call for the entire legacy flow (this is "step 3/3 — Bevestig Gegevens"). Exact body (`ConfirmData.tsx:2573-2608`):
    ```ts
    {
      uniqueDeviceId, cartId, phpsessid,
      shippingOptionId: Number(selectedShipping),   // selectedShipping defaults to "1", hardcoded local state — no shipping/options endpoint call exists in this file
      items: cart.items,                              // full cart item list, plaintext, not encrypted
      billing_firstname, billing_lastname, billing_email, billing_phone,
      billing_address, billing_addressnumber, billing_postalcode, billing_city,
      billing_state, billing_companyname, billing_vatnumber,
      shipping_firstname, shipping_lastname, shipping_address, shipping_addressnumber,
      shipping_postalcode, shipping_city, shipping_state, shipping_phone, shipping_companyname,
    }
    ```
    **No encryption at all** — the entire address + cart payload is sent in plaintext, in stark contrast to the v3 flow's RSA/AES-encrypted `encrypted_address`.
  - embedded login/signup UI: none of its own (no `password`/`secureTextEntry`/login redirect found live in this file) — it relies entirely on `MyData.tsx` having already gated access one step earlier in the same wizard.

---

## Cross-check: router.push / router.replace destinations vs. the registered tree

Every live (non-commented) `router.push(...)`, `router.replace(...)`, and `pathname:` object literal across `app/` and `components/` was grepped and checked against the tree above.

**Resolves correctly, registered as shown above** (all confirmed present in the tree): `/(tabs)/HomeCategoryPage`, `/(tabs)/HomeCategoryPage/SubCategoryPage`, `/(tabs)/HomeCategoryPage/v3ProductsPage`, `/(tabs)/HomeCategoryPage/v3ProductExtendedPage`, `/(tabs)/HomeCategoryPage/ProductExtendedPage`, `/(tabs)/HomeCategoryPage/ProductsPage`, `/(tabs)/HomeCategoryPage/BrandModelList`, `/(tabs)/HomeCategoryPage/CarVersionsList`, `/(tabs)/HomeCategoryPage/SearchResultsPage`, `/v3VehicleScanner`, `/v3EanScanner`, `/v3Login` (with and without `?redirectTo=checkout`), `/v3CheckoutPage`, `/v3ShippingPage`, `/v3OrderConfirmPage`, `/(tabs)/v3AccountPage/v3LikedPage`, `/(tabs)/v3AccountPage/v3LastSeenPage`, `/(tabs)/v3AccountPage/v3OrdersPage`, `/(tabs)/v3AccountPage/v3OrderDetailPage`, `/(tabs)/v3NotificationsDetailPage`, `/(tabs)/MyPorzaPage`, `/(tabs)/MyPorzaPage/MyData`, `/(tabs)/MyPorzaPage/Orders`, `/(tabs)/MyPorzaPage/OrderPage`, `/(tabs)/MyPorzaPage/ConfirmData`.

**Flagged — NOT found registered in any `_layout.tsx` (or registered but broken):**

1. **`/(tabs)/MyPorzaPage/Login`** — `_layout.tsx:91` *does* register a `Stack.Screen name="Login"`, but no backing file exists at `app/(tabs)/MyPorzaPage/Login.tsx`. Three live/dead call sites target it: `MyPorzaPage/index.tsx:814` (live), `MyData.tsx:3745` (live — the missed touchpoint above), `CartPage.tsx:5568` (dead, inside unreachable `CartPageInner`). **This is a genuinely broken route**, not merely unregistered — it's registered by name with nothing behind it.

2. **`/Login`** — used by `MyPorzaPage/index.tsx:765` (`router.replace("/Login")`, live, the logout handler). **Not registered in any `_layout.tsx`** (the root `app/_layout.tsx` only registers `v3Login`, never plain `Login`). It resolves anyway because `app/Login.tsx` exists as a file and Expo Router auto-discovers file-based routes independent of explicit `Stack.Screen` registration — but per this method's strict definition (tree built only from `_layout.tsx` entries), it is an **unregistered-but-file-backed** route, worth flagging as an inconsistency: two different "Login" destinations exist in the codebase (`/Login` and the broken `/(tabs)/MyPorzaPage/Login`), used interchangeably by the same file (`MyPorzaPage/index.tsx`) for two different actions (logout-redirect vs. login-button), neither matching the current live login screen (`/v3Login`).

3. **`HomeCategoryPage/FiltersPage`** — registered at `HomeCategoryPage/_layout.tsx:33` with no backing file. No live `router.push`/`router.replace` call was found targeting it (unlike the `Login` case above, nothing currently tries to navigate here), so this is a dormant broken registration rather than an active bug.

4. **`ADD_CAR_PATH` in `v3VehicleScanner.tsx:31`** — defined as `"/HomeCategoryPage/AddCarPage"`, omitting the `(tabs)` route-group segment that every other reference to this same screen uses elsewhere in the codebase (e.g. `AddCarPage.tsx` itself uses `"/(tabs)/HomeCategoryPage"` for its own back-navigation). Expo Router route groups are typically transparent in path resolution, so this likely still resolves to the correct registered screen, but it's the only place in the app that references this route without the group prefix — worth a runtime check rather than assuming it's fine, since it's inconsistent with the pattern used everywhere else.

**Not a destination but worth noting:** `components/components/CustomHeaderOtherTabs.tsx:102` — `onPress={() => backRoute ? router.push(backRoute as any) : router.back()}` — `backRoute` is a dynamic prop passed in by each caller, not a fixed string, so it can't be statically checked against the tree; every call site passing a `backRoute` prop should be checked individually if this header is touched.

---

## Summary: every login/signup touchpoint found in the app, anywhere

1. `app/v3Login.tsx` → `components/v3LoginScreen.tsx` — the one real, working login form (email + password, RSA-encrypted). Top-level root-stack screen.
2. `app/Login.tsx` — a second, entirely separate legacy login form (plaintext `POST /v1/account/login {uniqueDeviceId, cartId, phpsessid, username, password, user_lang}`), reachable only via the unregistered-but-file-backed `/Login` route from `MyPorzaPage/index.tsx`'s logout handler.
3. `app/v3CheckoutPage.tsx`'s `"choice"` screen — a **navigate-away** login CTA (`/v3Login?redirectTo=checkout`) offered alongside "continue as guest," not an embedded form.
4. `app/(tabs)/v3AccountPage/index.tsx`'s `loginCta` button — another navigate-away CTA to `/v3Login`, no redirect param.
5. `app/(tabs)/MyPorzaPage/index.tsx`'s login button — navigate-away to the broken `/(tabs)/MyPorzaPage/Login`.
6. **`app/(tabs)/MyPorzaPage/MyData.tsx`'s mount-time auth gate — the missed touchpoint.** Not a button, not a form: an automatic `router.replace()` to the broken `/(tabs)/MyPorzaPage/Login` that runs before the order-creation address form renders, embedded in step 2 of the legacy 3-step checkout wizard.

No screen anywhere in the tree embeds an actual login/signup *form* inline (confirmed by a repo-wide `secureTextEntry` grep matching only the two standalone login screens in items 1-2) — every other touchpoint is either a navigate-away button or, in `MyData.tsx`'s case, a silent redirect gate baked into the middle of a multi-step flow rather than a top-level screen.
