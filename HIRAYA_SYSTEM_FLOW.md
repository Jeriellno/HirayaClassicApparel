# Hiraya — Full System Flow & Logic

**AI-Driven Smart Wardrobe Stylist & Virtual Fitting Room**

Stack: React (Vite) + Tailwind + Framer Motion + React Query  •  Laravel 12 API + Sanctum  •  PostgreSQL (Supabase)  •  Images stored as URLs (public disk) and Base64 data URIs

---

## 0. High-Level Map

```text
┌──────────────────────────── FRONTEND (localhost:5173) ────────────────────────────┐
│  AuthProvider (AuthContext)  ← token + user in localStorage/sessionStorage        │
│  api/axios        ← Bearer token, per-endpoint timeouts, 401 purge               │
│  React Query      ← ['cart'], ['wishlist'], ['products'], ['outfits-recommended'] │
│  Routes (App.jsx) ← Public / Guest / Protected / Admin / Superadmin               │
└──────────────────┬────────────────┘
                                   │  JSON over /api/*  (Vite proxy → 127.0.0.1:8000)
┌──────────────────▼────────────────┐
│                         BACKEND (127.0.0.1:8000)                                  │
│  routes/api.php   ← public + `auth:sanctum` groups                               │
│  Controllers      ← Auth, Product, Garment, Cart, Wishlist, Checkout, Order,     │
│                     TryOn, Notification, Analytics                                │
│  Services         ← OutfitRecommendationService, MeasurementNormalizer           │
│  Jobs             ← ProcessTryOnJob (queue: tryon)                               │
│  Queue worker     ← `php artisan queue:listen`                                    │
└──────────────────┬────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
   PostgreSQL (Supabase)     public/storage (uploads)     Replicate / HuggingFace
   users, products,          products/*, catalog/*,      (IDM-VTON renderer)
   cart_items, wishlists,    orders/dp-proofs/*          + Gemini (image analysis)
   orders, order_items,
   try_on_sessions, …
```

---

## 1. Authentication & Session

### 1.1 Register — `POST /api/register`
`AuthController::register`
1. Validates: `full_name`, `email` (unique), `password` (min 8, **confirmed**), plus optional 5-core body measurements (`chest_bust`, `waist`, `hips`, `shoulder_width`, `sleeve_length`).
2. `User::create([... 'role' => 'user' ...])` — password hashed with `Hash::make` (bcrypt).
3. **Immediately issues a Sanctum token** (`createToken('auth_token', ['*'], now()->addDays(30))`).
4. Returns `201 { message, token, user }` — so the customer lands signed-in without a second login.

### 1.2 Login — `POST /api/login`
`AuthController::login`
1. Validated via the `Validator` facade (not `$request->validate()`) so a missing `Accept: application/json` still yields a JSON 422 instead of a 302 HTML redirect.
2. `Hash::check` against the stored bcrypt hash. **The failure message is identical for "unknown email" and "wrong password"** — prevents account enumeration.
3. Token lifetime: `remember=true` → 30 days, otherwise 24 hours.
4. Returns an **explicit** payload `{ token, user: {id, full_name, email, role} }` because the frontend routes on `user.role` (admin → `/admin`, user → `/shop`). A bare model could omit it.

### 1.3 Frontend session logic — `AuthContext.jsx`
- `readStoredUser()` safely JSON-parses the stored user (corrupt data → `null`, never throws).
- `normalizeUser()` guarantees a usable `role` string regardless of envelope (`role`, `role_name`, `roles[]`, `is_admin`).
- `persistSession(token, user, remember)` — `localStorage` (persists) vs `sessionStorage` (tab-only). Clearing the *other* tier prevents two conflicting sessions.
- `checkUser()` runs on every app load → `GET /api/user` verifies the token.
  - **401/403** → purge session (genuinely dead).
  - **Network error** → keep the stored session (a booting backend must not log the user out).
- `axios` response interceptor also purges the session on **401 for any non-auth endpoint**, and normalizes every error into `{ status, message, errors }` via `parseApiError`.

### 1.4 Password reset — `POST /api/reset-password-direct`
- Token = `hash_hmac('sha256', strtolower(email), app.key)`, compared with `hash_equals`.
- **Identical response for every outcome** (invalid token, unknown email, success) — no enumeration.
- On success: password re-hashed and **all** existing tokens revoked (`$user->tokens()->delete()`).

### 1.5 Route guards — `ProtectedRoute.jsx`
| Mode | Behaviour |
|---|---|
| unauthenticated | `loading` → `SessionGate`; `!user` → `/login` (remembers `from`) |
| role gate | `requiredRole` / `allowedRoles`; `superadmin` implicitly satisfies `admin` |
| `AdminRoute` | wrapper: `allowedRoles=['admin','superadmin']`, forbidden → `/shop` |

> ⚠️ **`BYPASS_ADMIN_AUTH = true`** (`routes/ProtectedRoute.jsx`) — **DEVELOPMENT ONLY, ON REQUEST.**
>
> The strict `role === 'admin'` / `'superadmin'` gate was blocking local access to the console, so it is currently bypassed: `/admin` and `/superadmin` now load straight from the URL bar with **no login and no token**.
>
> The backend still enforces `auth:sanctum` + `admin` on every `/api/admin/*` call, so **expect 401s** while this is on — including `POST /api/admin/products/analyze-image`, which kills the "Add New Garment" AI auto-fill and leaves the product on its ORIGINAL photo. Sign in for a fully working console.
>
> **Set back to `false` before shipping.** In production this would expose the admin shell to anyone who guesses the URL.
>
> ✅ When `false` (the shipped setting), the UI gate and the API gate agree and the console is only reachable WITH a real session token.

---

## 2. Admin → Customer Product Flow

### 2.1 Admin creates a garment
`InventoryTab.jsx` → "Add New Garment" → `ProductModal` → `POST /api/admin/products` (multipart).

`ProductController::store`:
1. `ProductRequest` validates and JSON-decodes `sizes`, `size_stocks`, `size_measurements`, `colors`, `images`, `ai_tags`, etc.
2. `handleImageUpload()` maps the **two upload slots**:
   | Form field | Stored column | Disk/path |
   |---|---|---|
   | `image_file` (raw upload) | `image_url` | `public` → `products/` |
   | `display_image_file` (AI cut-out) | `display_image_url` | `public` → `catalog/` |

   URL is built with **`Storage::disk('public')->url($path)`** (explicit disk — never the default).
3. `prepareAiTags()` merges `undertone`, `fit_type`, `body_shapes`, `occasions` into the `ai_tags` JSON.
4. `processProductInventoryAndMeasurements()` — **key logic**:
   - If `size_measurements` is supplied → use it.
   - Otherwise derive from `sizes` using the hard-coded `DEFAULT_SIZE_CHART` (XS–2XL, chest/waist/hips/shoulder/sleeve in cm).
   - **This is what makes a product eligible for personalized recommendations.**
5. `Product::create()` → one row in `products`. No "publish" step; presence in the table = live.

### 2.2 Delete / replace rules
`deleteProductImage()` **only** deletes files under the `public` disk's own base URL. Supabase/S3/data-URI references are left untouched — a remote URL can never cause a local file to be deleted.

### 2.3 Where the customer sees it
Every customer surface resolves the image as:
```
display_image_url  ||  image_url
```
- `GET /api/products` → Shop (`useShopData`, `['products']`, 5-min stale).
- `GET /api/products/{id}` → ProductDetail.
- `GET /api/products/spotlight` → Home fallback feed.

---

## 3. Browsing, Wishlist & My Bag

### 3.1 Heart = bag toggle (there is no separate wishlist store)
> The standalone wishlist was retired for the **shop heart**. The heart now reflects **`cart_items` membership**.

`useShopData.js`:
- `bagToggleMutation`:
  1. Resolves the variant: `customSize || firstSizeOf(product)` / `customColor || firstColorOf(product)`.
     (`firstSizeOf` handles sizes arriving as `["S","M"]` **or** `{"L":350,"M":350}` — indexing the object form with `[0]` used to silently default every hearted piece to `'M'`.)
  2. **Reads `/cart` fresh** before deciding add-vs-remove (a stale closure made a second quick click "add" again → quantity inflated instead of toggling off).
  3. Not in bag → `POST /api/cart`; already in bag → `DELETE /api/cart/{rowId}`.
  4. Invalidates `['cart']`, `['wishlist']`, `['outfits-recommended']`.
- `handleTryOn(product)` → adds to bag, then `navigate('/try-on')`.

### 3.2 Bag API — `CartController`
| Method | Endpoint | Logic |
|---|---|---|
| GET | `/api/cart` | `user->cartItems()->with('product')`, drops orphaned rows (deleted product), returns `{items, count(sum qty), total}` |
| POST | `/api/cart` | **Dedupe on `user_id + product_id + selected_size + selected_color`** → existing row `increment('quantity')`, else create |
| PUT | `/api/cart/{id}` | explicit quantity; `0` → delete |
| DELETE | `/api/cart/{id}` | remove row |
| DELETE | `/api/cart` | clear all |

### 3.3 The canonical `['cart']` cache shape — `utils/cartShape.js`
Three hooks consume the same React Query key. **One key = one cache entry**, so whichever resolves last would overwrite the others' shape (a bare array vs `{items,count,total}`) → My Bag reading `data.items` off an array rendered "Your bag is empty" and a hearted piece **appeared to vanish**. Fix: **every writer and reader funnels through `normalizeCartPayload()`** → always `{ items, count, total }`.

### 3.4 My Bag UI — `Cart.jsx`
- Shows distinct **Pieces selected** vs **Total units** (the backend `count` is the *sum of quantities*, which previously read as a phantom item count).
- Item rows: image, name, size/color, unit price, qty stepper (1 floor), remove, line subtotal.
- Order Summary: total, 50% DP, balance, courier note.
- **The My Bag Style Stack carousel was removed** — it ran in-browser AI background removal (~95 MB model) on every tile and blocked the page for tens of seconds.

---

## 4. AI Try-On Studio (the core feature)

### 4.1 Frontend — `AiTryOn.jsx` + `useTryOnState.js`
Three panels: **Style Stack** (left) · **Body Profile + Canvas** (center) · **Stylist Chat** (right).

**Feeds the stack (in precedence order):**
1. `['cart']` → `/api/cart` → `source: 'bag'`
2. `['wishlist']` → `/api/wishlist` → `source: 'saved'`
3. `['outfits-recommended']` → `/api/outfits/recommended` → `source: 'recommended'`

`ingest()` skips already-seen product IDs → **bag > saved > recommended**. Everything is bucketed into five layers: `top | bottom | footwear | outerwear | dress`.

> **Bug fixed:** the stack panel's row list originally had no `dress` row while the bucketer put dresses in a `dress` layer → a recommended dress was **invisible**. The `dress` row now exists and both bucketers agree.

**Measurements:** seeded from the auth user, then refreshed from `GET /api/user/measurements`; saved via `PUT /api/user/measurements` → `AuthContext.refreshUser()`.

**Generate** (`handleGenerateFitting`) — requires measurements + photo + ≥1 garment:
1. Orders garments **feet → outerwear** (`footwear, bottom, dress, top, outerwear`).
2. Resolves each image to a renderable payload in parallel (`toRenderableImage`: data URI passthrough, else `fetch` → blob → data URI).
3. `POST /api/tryon/generate` → returns `{ session_id, status }`.
4. Starts **polling** `GET /api/tryon/status/{sessionId}` every 3s (≤60 attempts = 3 min, covering the job's own 300s timeout).
5. On `completed`: sets `result_image_base64`, `ai_feedback`, `recommended_size`; stops polling. On `failed`: surfaces message + retry.

**Bag handoff** (`addWornItemsToBag`): promotes worn garments into the bag — **skips `source === 'bag'`** so quantities never double.

### 4.2 Backend — `TryOnController::initiateTryOn`
1. Validates `user_photo`(+`_base64` alias), `garments` (array or legacy `garment_photos_base64`), optional `measurements` (5-core cm).
2. Photo falls back to `$user->portrait_base64` → 422 if still blank.
3. Garments: `normaliseGarmentPhotos()` (accepts plain strings or `{category, image, name}` objects). If empty → **`hydrateGarmentsFromBag()`** pulls `cart_items` server-side and converts each to a data URI (prefers `ghost_mannequin_url` → `image_url`). If still empty → 422.
4. `normaliseMeasurements()`: backfills blanks from the user record, aliases `chest_bust ⇄ chest`.
5. Creates a **`try_on_sessions`** row: `session_id = 'tryon_'.uuid()`, `status = queued`, full photo/garments/measurements JSON.
6. `ProcessTryOnJob::dispatch($session->id)` on the **`tryon` queue**.
7. Returns **`202`** immediately with `session_id` — non-blocking.

### 4.3 Render pipeline — `ProcessTryOnJob`
- `$timeout = 300`, `$tries = 2`, `$backoff = 60`, `queue = 'tryon'`.
- Sequence: `markProcessing()` → `callVtonApi()` → on success `generateAiFitFeedback()` + `markCompleted()`, else `markFailed()`.
- **`callVtonApi` provider order:**
  1. **Replicate** (`services.replicate.token`) → `cuuupid/idm-vton`; POST prediction then **poll** the prediction URL (5s × ≤60) and download the output as Base64.
  2. **Hugging Face** (`services.huggingface.token`) → `yisol/IDM-VTON` multipart.
  3. **Mock** — with no keys configured, returns a generated placeholder SVG. *The full flow is therefore testable end-to-end without any external API key.*

> ⚠️ **Known limitation:** only `garmentPhotos[0]` is rendered. A multi-piece stack does not composite — the comment mentions layer priority, but no layering code exists.

### 4.4 Sizing heuristics — `resolveBodyMetrics` + `calculateSizeRecommendation`
- `resolveBodyMetrics`: aliases `chest_bust → chest`, derives a neutral 170 cm height when absent, and `toCentimetres()` treats values ≤60 as inches (×2.54).
- Size thresholds (cm): `S ≤88/70`, `M ≤95/77`, `L ≤102/84`, `XL ≤109/91`, else `2XL`.
- `generateAiFitFeedback()` writes the prose **plus a machine-readable `SIZE: <label>` prefix**. `TryOnController::extractRecommendedSize()` regexes that prefix so the UI gets a clean chip instead of a sentence.

### 4.5 Status polling — `checkStatus`
| status | response |
|---|---|
| `queued` | `progress: 10` |
| `processing` | `estimateProgress()` — ramps 20%→90% over ~120s, never fake-100% |
| `completed` | `progress: 100` + `result_image_base64` (+`result_image` alias) + `ai_feedback` + `recommended_size` |
| `failed` | `progress: 0` + message |

`retry()` re-queues the **same** session row (photo/stack/measurements preserved), returning `409` if already completed.

### 4.6 Stylist chat — `POST /api/tryon/chat`
**Deterministic, measurement-aware responder — no external AI call.** Answers two things: recommended size (from chest/waist), and stack composition. Returns a `reply` string.

---

## 5. Personalised Recommendations (Home Spotlight)

### 5.1 Two distinct engines — **this is the key subtlety**

| | Home Spotlight | Legacy Garment Spotlight |
|---|---|---|
| Endpoint | `GET /api/outfits/recommended` | `GET /api/garments/spotlight-recommendations` |
| Controller | `OutfitRecommendationController` | `GarmentController` |
| **Source table** | **`products`** | **`garments` + `garment_sizes`** |
| Match | score-based (tolerance 8 cm) on `size_measurements` | must satisfy `min ≤ value ≤ max` for each provided metric |
| Cache | `Cache::remember` 6 h, keyed on user + products version | none |

**`OutfitRecommendationService::getRecommendations`:**
1. Returns empty when **no** measurements exist.
2. `Product::whereNotNull('size_measurements')` → keep only those with saved measurements (`hasSavedMeasurements`).
3. Normalise each via `MeasurementNormalizer` → `evaluateProductFit()` scores each size:
   `score = mean over metrics of max(0, 1 − distance / 8cm)`, pick the best-matching size.
4. Filter `fit_score >= 60`, sort desc, take `limit`.
5. **`select()` MUST include `display_image_url`** — it narrows columns explicitly, so omitting it stripped the AI cut-out and every card silently fell back to the raw admin photo.

### 5.2 Auth requirement
Both endpoints sit behind **`auth:sanctum`**. Without it `$request->user()` is null and:
- `outfits/recommended` → always "no measurements" (nothing ever recommended, even for users who HAD them).
- `garments/spotlight-recommendations` → `Attempt to read property "bodyMeasurement" on null` → HTTP 500, so the Spotlight never showed anything.

### 5.3 Spotlight UI — `SpotlightSection.jsx`
- Guests → `Curated Spotlight` (latest products fallback).
- Signed-in **without** measurements → CTA banner "Set My Measurements" → `/account-settings`.
- The subtitle **names what is actually on screen** (match count vs "latest pieces"), instead of always claiming personalisation.

---

## 6. Checkout & Order Lifecycle

### 6.1 `POST /api/checkout` — `CheckoutController::store`
**Pricing is server-authoritative** — the client's `total_amount` is accepted but **never used**.

Inside a **DB transaction**:
1. `Product::whereIn(...)->lockForUpdate()` — row locks so two concurrent checkouts for the last unit cannot both pass.
2. Per line: verify product exists, `assertStockAvailable()` (`size_stocks[size]` if present, else aggregate `stock`).
3. Price each line from `products.price` → subtotal → **server-computed grand total**.
4. Store the DP proof: `orders/dp-proofs/*` on the `public` disk.
5. `dp = total / 2`, `balance = total − dp`.
6. `Order::create(...)` → `payment_status = pending`, `order_status = pending`.
7. `OrderItem::create()` per line **with a `product_name_snapshot`** (historic name survives a later rename).
8. `decrementStock()` — **Option A: reserve on checkout**.
9. **Cart-based checkouts only** clear `cart_items`.
10. A forged/invalid request can never deflate the amount owed; business failures return 422, unexpected ones 500.

### 6.2 Order status machine
```
              POST /checkout (DP proof)
                        │
                        ▼
            payment: pending · status: pending
                        │
        ┌───────────────┴────────────────┐
        │ admin: approve-dp              │ admin: reject-dp (+reason)
        ▼                                ▼
 payment: 50_paid                  payment: rejected
 status: processing                → STOCK RESTORED
        │                          customer re-uploads via
        │                          POST /api/orders/{id}/reupload-dp
        │
        │ customer pays balance → POST /api/orders/{id}/pay-balance
        │ admin: confirm-full-payment (proof upload)
        ▼
 payment: fully_paid · status: ready_for_shipping
        │
        │ admin: update-status → shipped (+ tracking)
        ▼
 status: shipped · tracking_booking_details set
```

**Endpoints:**
- Admin: `GET /api/admin/orders`, `GET /{order}`, `PATCH approve-dp`, `PATCH reject-dp`, `POST confirm-full-payment`, `PATCH status`, `PATCH tracking`.
- Customer: `GET /api/orders`, `GET /api/orders/{order}`, `POST /api/orders/{order}/pay-balance`, `POST /api/orders/{order}/reupload-dp`.

**Stock integrity:** reserved at checkout; a rejection **restores** every line (`restoreStock`, only for orders that actually have `order_items`). Rejection is guarded by `lockForUpdate` so an approve/reject race cannot double-release.

**Notifications:** every admin transition calls `notifyCustomer()` → `OrderStatusChanged` (in-app + mail). Wrapped in try/catch so a notification failure never blocks the status change.

---

## 7. Garment Image Rendering (two-stage pipeline)

```text
Admin upload
   ├─ image_file        → image_url          (raw photo)       public/products/*
   └─ display_image_file→ display_image_url  (AI cut-out PNG)  public/catalog/*
                                   │
              every customer surface renders:
                    display_image_url || image_url
```

**Why `display_image_url` matters everywhere:** `ProductCard`, `SpotlightSection`, `Cart`, `StyleStack*`, and `OutfitRecommendationService::select()` all prefer it. Missing it anywhere silently degrades to the busy raw photo.

**Client-side cut-out (`@imgly/background-removal`) — bounded by design:**
- Self-hosted (~95 MB) under `public/vendor/imgly/`, served same-origin (the CDN is blocked on many networks; the PHP proxy was too slow).
- Cached in IndexedDB (`HirayaImageCache`), in-flight requests de-duplicated.
- **Skipped entirely when the image is already a prepared cut-out (`.png`)** — running the model on those was pure waste.
- The image paints **immediately**; the cut-out is a progressive enhancement behind a small badge, with an **8s UI ceiling** so a tile can never look frozen.

---

## 8. Analytics

- `GET /api/analytics/wishlist-engagement` (public) — uses `Product::withCount('wishlists')`; the `wishlists()` relation on `Product` exists specifically for this.
- `POST /api/products/{id}/track-canvas` — increments `canvas_drag_count`.
- `POST /api/products/{id}/track-tryon` — increments `try_on_count`.
- `GET /api/admin/analytics/dashboard` — admin metrics.

---

## 9. Notifications

`auth:sanctum` group: `GET /api/notifications`, `POST /api/notifications/read-all`, `POST /api/notifications/{id}/read`.
Without auth, `$request->user()->notifications()` threw and a try/catch turned it into an empty 200 — hiding a broken bell behind "no notifications yet".

---

## 10. API Route Map (`routes/api.php`)

**Public:** `register`, `login`, `check-email`, `reset-password-direct`, `products`, `products/spotlight`, `products/{id}`, `garments`, `garments/catalog`, `payment-instructions`, analytics endpoints, `checkout`, `orders/{id}/pay-balance`, `orders/{id}/reupload-dp`.

**`auth:sanctum`:** `user`, `logout`, `user/profile`, `user/measurements` (GET/PUT), `garments/spotlight-recommendations`, `outfits/recommended`, `tryon/*` + `try-on/*` (initiate, generate, status, retry, history, chat), `wishlist/*` (GET/POST/PUT/DELETE), `orders` (GET), `orders/{id}`, `cart/*` (GET/POST/PUT/DELETE), `notifications/*`.

**`admin/*` (⚠️ middleware currently removed — see §11):** products CRUD, `analyze-image`, background-removal asset proxy, `wishlist-lookup`, garments upsert, orders management, analytics dashboard.

---

## 11. ⚠️ Security & Correctness Notes (must fix before production)

1. ~~`BYPASS_ADMIN_AUTH = true`~~ — **FIXED**: now `false`, so the UI gate matches the API gate.
2. ~~`/api/admin/*` middleware removed~~ — **FIXED**: the block is gated by `auth:sanctum` + `admin` (`routes/api.php`).
3. ~~No admin authorization middleware~~ — **FIXED**: `EnsureUserIsAdmin` (alias `admin`) and `EnsureUserIsSuperAdmin` (alias `superadmin`) both exist and are wired in `bootstrap/app.php`.
4. `/api/checkout` and the other customer routes are gated by `auth:sanctum`.
5. **`FILESYSTEM_DISK`** must stay `public`; a `local` default writes to `storage/app/private`, which is not web-served. (New uploads now go to the Supabase `products` bucket via `SupabaseStorage`; the local disk is only a legacy fallback.)
6. **`APP_URL` must match the host the SPA calls** (`127.0.0.1:8000`, not `localhost:8000`) — `localhost` and `127.0.0.1` are different origins for images built by `Storage::disk('public')->url()`.
7. **Legacy rows still point at local-disk URLs** (`http://127.0.0.1:8000/storage/catalog/*.png`) whose bytes no longer exist. `imageHelper.js` remaps them onto the Supabase bucket; if the object is missing too, the card falls through to `image_url` (the raw admin photo). Re-run "Create catalog image (AI)" on such products to regenerate a real cut-out.

---

## 12. Which Table Powers What?

| Feature | Table(s) |
|---|---|
| Auth, 5-core measurements, portrait | `users` |
| Shop / catalog / recommendations / try-on garments | **`products`** |
| Legacy garment spotlight engine | `garments`, `garment_sizes` **(currently empty — unused)** |
| Heart / My Bag | `cart_items` |
| Legacy wishlist (retired from the shop heart) | `wishlists` |
| Checkout, payments, shipping | `orders`, `order_items` |
| AI try-on renders | `try_on_sessions` |
| Uploaded files | `public/storage` via the disk |

**Key insight:** the live catalog is **`products`**. `garments` is a parallel system that is currently unpopulated, so the *real* personalized path is the `products`-based one (`/api/outfits/recommended`).
