# CHAPTER 4 — System Implementation

## 4.1 Introduction

This chapter describes the implementation of the designs presented in Chapter 3. It
covers the environment, the technology stack, the implementation of each subsystem, the
database schema, the API surface, and the deployment. Code identifiers below refer to
the actual files in the repository.

## 4.2 Development and Runtime Environment

### 4.2.1 Local development environment

| Component | Specification |
|---|---|
| Operating system | Windows (developer workstation) |
| PHP | 8.3 at `C:\php-8.3\php.exe`, with `pdo_pgsql`, `gd`, and `curl` |
| Composer | Dependency manager for the backend |
| Node.js | 20 or newer, with npm |
| Database | Supabase PostgreSQL (Singapore region), shared with the deployed environment |
| Local API server | `php artisan serve` on `127.0.0.1:8000` |
| Local frontend server | Vite dev server on `localhost:5173` |
| Shell | PowerShell |

Two environment quirks materially affect the work and are worth recording:

- `start-backend.ps1` loads `hiraya-backend/php/hiraya-uploads.ini` via
  `PHP_INI_SCAN_DIR`. Without it, product saves that include colour photographs fail with
  HTTP 413, because PHP's default per-file upload limit is small.
- `php artisan serve` is single-threaded on Windows, so concurrent API requests queue.
  The console is therefore noticeably slower locally than in the cloud. The Docker image
  sets `PHP_CLI_SERVER_WORKERS=4` to avoid this in the deployed environment.

### 4.2.2 Production environment

| Component | Specification |
|---|---|
| Backend hosting | Render.com Web Service, Docker image, Singapore region |
| Backend runtime | PHP 8.2 CLI with `pdo_pgsql`, `pdo_mysql`, and `gd` |
| Frontend hosting | Render.com Static Site built with `npm run build`, publishing `dist` |
| Process model | 4 server workers plus a supervised `queue:work` loop |
| Database | Supabase PostgreSQL, the same instance the local environment uses |
| Object storage | Supabase Storage buckets `products` and `backgrounds` |

The shared database is a deliberate development choice with a consequence that must be
stated: orders and try-on sessions created locally are real data in the shared database,
and try-on renders consume real provider credits.

## 4.3 Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend framework | React 18 with Vite | Component model suited to the studio's interactive state; fast builds |
| Styling | Tailwind CSS with a custom design-token stylesheet | Consistent glassmorphism language with a single source of design variables |
| Animation | Framer Motion | The interface's motion is part of its product identity |
| Server state | TanStack Query | Cache invalidation, polling, and layout refetch on mutation |
| Frontend routing and state | React Router, `AuthContext`, `PreferencesContext` | Token management, protected routes, preferences |
| Backend framework | Laravel 12 (stateless REST API) | Mature routing, middleware, queue, and validation |
| Customer auth | Laravel Sanctum (personal access tokens) | Stateless tokens suited to an SPA |
| Staff auth | Supabase Auth with TOTP MFA | Provides the `aal` claim required for console access |
| Database | Supabase PostgreSQL | Managed, with prefix-isolated tables for this project |
| Object storage | Supabase Storage | Catalog and background images, served same-origin |
| AI — catalog and vision | Google Gemini | Product detail auto-fill, photo checks, person verification |
| AI — virtual try-on | VTON API (PixelAPI or FASHN, configurable) | Purpose-built garment try-on models |
| AI — fallback | Hugging Face serverless inference; local 2D canvas composite | Development and offline options |
| HTTP client (backend) | Guzzle via Laravel's HTTP client | Provider API calls |
| Local tooling | Composer, npm, ESLint, PHPUnit | Dependencies, linting, tests |

## 4.4 Database Implementation

### 4.4.1 Table prefixing

Every table is created with the `tbl_` prefix through a `DB_PREFIX` environment value.
Raw SQL therefore goes through `DB::getTablePrefix()` so the prefix is applied in one
place only. A dedicated console command exists to apply the prefix to existing tables.

### 4.4.2 Core schema

The following tables implement the entities described in §3.5.

**`users`** — identity and profile. Beyond the standard columns, the table carries a
`role` (`user` / `admin` / `superadmin`), a `suspended_at` timestamp, `mfa_enrolled_at`,
`last_login_at`, a `portrait_base64` long-text column for the customer's photo, standard
body sizes, display preferences (preferred fit, gender, full name), and size data
maintained by a dedicated standardisation migration.

**`products`** — the catalogue. Carries name, description, price, category, fabric,
`ai_tags`, analytics counters, `display_image` and `occasion`, garment specification
columns, and a `color_variants` JSON column. A separate migration repairs the shape of
the per-size data so variants are structured consistently.

**`orders`** — the order header. Carries the customer, status, payment option, payment
state, amounts in integer minor units, courier and delivery details, the payment
reference number, receipt proof, tracking data, and the processing date. A later
migration adds the `delivered` and `rejected` statuses.

**`order_items`** — one line per product, colour, and size, with its own price and its
own review reference.

**`cart_items`** — the persistent server-side bag.

**`try_on_sessions`** — the try-on record. Stores the customer, the input photo as
Base64, the selected garments and their categories, the render plan, the render result,
the status, the engine that produced it, the renderer's feedback message, and history
fields: favourite, deleted, and restored.

**`product_reviews`** — one review per delivered order line, with a 1–5 star rating, a
body, and an optional photograph.

**`feedbacks`** — customer messages, linked to an order where relevant.

**`notifications`** — user-facing status updates with read state.

**`product_stock_movements`** — the single writer of stock changes: product, colour,
size, quantity delta, reason, actor, and timestamp.

**`audit_logs`** — privileged actions with actor, subject, action, and detail.

**`api_credentials`** — third-party credentials, stored server-side with a masked label
and never returned to the client.

**`system_settings`** — key/value settings including maintenance mode, the payment QR,
public feature toggles, the order cut-off, and store hours.

**`size_charts`** — the store's sizing policy, served by a public endpoint so the
frontend does not carry its own copy of the bands.

**`provider_health_events`** — renderer failures and recoveries.

**`product_pairings`** — products that complete a look.

### 4.4.3 Notable schema decisions

- **Money in minor units.** A dedicated migration enforces integer minor-unit storage so
  no rounding error accumulates across an order total, a balance, and a refund.
- **Stock derived from movements.** Stock is never written directly. The quantity is the
  sum of its movements, which makes every change attributable by construction
  (satisfying NFR-7 and FR-49).
- **Base64 in long-text.** Try-on images are stored as data URIs so a render and its
  source photo remain together and restorable. The trade-off is a large row, which is
  why GD is installed in the Docker image: the history endpoint shrinks renders to
  thumbnails rather than shipping full-size images in one JSON response.
- **Settings as key/value rows.** Settings are read on the storefront's hot path, so the
  public status endpoint is cached server-side and rate-limited.
- **Legacy tables dropped.** An unused legacy catalogue and a dead `is_online` column
  were removed by migration rather than left in place, because a table nothing reads is
  indistinguishable from a feature that silently does nothing.

## 4.5 Backend Implementation

### 4.5.1 Routing and the access-control chain

All routes are declared in `routes/api.php`. Each group carries an explicit middleware
chain, and the file documents why each chain is what it is.

- **Public reads:** product list, product detail, product reviews, the size chart, the
  payment instructions, and the public system status.
- **Customer routes** (`auth:sanctum`): cart, checkout, orders, balance payment,
  Lalamove booking, notifications, product reviews, feedback, sizes, profile, password,
  account deletion, outfit recommendations, and the whole try-on surface.
- **Staff routes** (`supabase.aal2`, `supabase.user`, `admin`): uploads, work summary,
  stock adjustments, stock history, orders and payment verification, tracking, customers
  (masked), audit logs, console audit events, product reviews, feedback, and support.
- **Superadmin routes** (`supabase.aal2`, `supabase.user`, `superadmin`): settings, the
  payment QR, database export, analytics, API credential management, provider status and
  probing, customer suspension, and staff account management.

Two design points in this file are load-bearing:

- **The AI garment-analysis endpoint is staff-only.** It was originally public to work
  around a broken console session; that workaround let anyone with network access spend
  the store's AI quota with arbitrary images. The fix for a bad credential is to repair
  the credential, not to delete the lock.
- **The try-on surface is fully authenticated.** A try-on session belongs to one
  customer, so every try-on route requires a session; without one the controller
  dereferenced a null user and returned a 500 instead of a 401.

### 4.5.2 Authentication

Customer registration and login use hashed passwords and issue a Sanctum personal
access token. Login is throttled. A password-strength rule is enforced in the frontend
and re-validated on the backend. Password reset issues a single-use, expiring, signed
link.

Staff authentication is entirely within Supabase: password plus TOTP. The
`EnsureSupabaseAAL2` middleware verifies the Supabase JWT signature (with a cached
JWKS), requires assurance level 2, and rejects anything else. `ResolveSupabaseUser`
maps the verified email to a `users` row. Invitation redemption creates an account that
remains inactive — unable to reach the console — until the holder completes a TOTP
challenge; the superadmin can see such accounts in the staff table and revoke them.

The project's own earlier design note records the honest trade-off here: Supabase MFA has
no recovery-code feature, so a staff member who loses their authenticator must be
recovered with a server-side command. That is strictly worse for the user and strictly
better for an attacker, because recovery codes can be phished or found, while the command
requires machine access.

### 4.5.3 The try-on pipeline

`TryOnController` receives the customer's photo and garment selection, records a
`try_on_sessions` row in a pending state, and dispatches `ProcessTryOnJob`. The job:

1. Pre-processes the photo and the garment image.
2. Iterates the configured renderer slots, each gated on its own token.
3. Calls the provider-neutral renderer for the first slot whose token is present.
4. Classifies the outcome into a code and decides whether to retry.
5. On success, stores the result image, the engine name, and the renderer's own
   feedback, and marks the session complete.
6. On exhaustion, marks the session with the honest reason and records a provider health
   event.

The client polls `GET /api/tryon/status/{sessionId}` while the job runs, and the
interface shows the status. Retryable outcomes are re-attempted with a bounded number of
tries; permanent outcomes are not.

The chain's terminal tier is the browser 2D composite. The job's own timeout is set
above the renderer's poll window so the renderer always reports its real reason before
the worker ends the job — a deliberate ordering, since the reverse would replace a
specific diagnostic with a generic failure.

### 4.5.4 Catalog intelligence

A staff-only endpoint accepts a product image and returns suggested catalogue fields —
category, colour tags, fabric, description — and an AI tag set, using Gemini vision.
This is what powers the console's "Auto-fill Details" action, and it is rate-limited so
a retry loop cannot burn the store's quota. A companion command normalises AI tags into
a consistent vocabulary.

A separate, public, rate-limited endpoint verifies that a real person is present in an
uploaded try-on photo, using the same vision model. The reasoning is recorded in the
controller: purely client-side attempts to prove a person was present failed on
measurement — a cream or gold garment satisfies any skin-tone rule, a hanging garment is
itself a large body-shaped mass, and the saliency model used is not a person detector —
so the verdict is delegated to a vision model. It is public on purpose, because the upload
happens in the studio before any garment is chosen and the only question asked is "is
there a person here?", which is not sensitive.

### 4.5.5 Recommendations and fit matching

Recommendations are computed from the customer's stored measurements and served by a
dedicated endpoint that requires a session, because the computation needs the user. Fit
matching compares the garment's measurements with the customer's sizes using a shared
measurement parser and normaliser, and displays a badge. Both the sizing policy and the
garment measurement interpretation are served by backend services so the frontend cannot
silently disagree with the backend about which size a body maps to.

## 4.6 Frontend Implementation

### 4.6.1 Application shell and routing

The single-page application defines its routes in `App.jsx`, guarded by a protected-route
wrapper that checks both the presence of a session and, for console routes, the
assurance level. A global connection watcher observes network and API health; on loss it
shows a *Reconnecting…* pill, and on recovery it invalidates active queries so every
screen reloads itself.

### 4.6.2 API client

`api/axios.js` is the single HTTP client. It injects the bearer token, applies a
request timeout, normalises errors into a consistent shape, and distinguishes a network
failure from an application error so the connection watcher can react to the former only.

### 4.6.3 The try-on studio

The studio is the most interactive screen. Its flow is:

1. **Photo guide** — illustrated instructions precede the upload.
2. **Upload and client-side validation** — the file is read into a Base64 data URI in the
   browser, and validated for framing, lighting, and resolution before submission.
3. **Person verification** — the photo is submitted to the verification endpoint; the
   studio proceeds only on a positive verdict.
4. **Style stack** — the customer selects garments and layers them; the stack is visible
   and editable.
5. **Render** — a session is created, the job is dispatched, and the client polls status.
6. **Result** — the render is displayed with the engine that produced it and the
   renderer's own feedback naming the garment actually rendered.
7. **History** — past looks can be re-opened, favourited, deleted, and restored.

The studio also hosts a stylist chat and the fit-match badge, so the customer has both
a visual answer and a written one.

### 4.6.4 Storefront and checkout

The shop, product, cart, and checkout screens implement the catalogue, variant selection,
the bag, the two payment options, the payment accounts and QR, the required reference
number, the courier choice with its differing address requirements, and the cut-off
notice. Checkout computes and displays the order's processing date from the cut-off rule.

### 4.6.5 The staff console

The console is a tabbed interface with a role-aware shell. Admins see a work queue,
inventory, orders, customers, feedback, stock history, and audit logs. The superadmin
additionally sees analytics, admin management, system settings, credential management, and
export. Data loads lazily per tab rather than all at once, and inventory supports
per-variant quick stock adjust with a required reason.

## 4.7 Deployment Implementation

### 4.7.1 Backend container

The `Dockerfile` builds a PHP 8.2 CLI image with `pdo_pgsql`, `pdo_mysql`, and `gd`; it
installs the same upload-limit configuration the local launcher uses, sets four server
workers, and starts the API alongside a supervised queue loop. `procps` is installed so
the worker's watchdog can inspect running processes.

### 4.7.2 Frontend static site

The frontend is built with `npm run build` and published from `dist`. Two rewrites are
configured, and their order is significant: `/supabase-storage/*` is rewritten to the
backend's storage proxy first, then everything else falls back to `index.html` so
client-side routes resolve. Reversing the order breaks every catalog image.

### 4.7.3 Storage proxying

Catalog images are served to the browser through the backend's own storage proxy at
`/supabase-storage/*`, so image requests are same-origin with the frontend and do not
depend on the browser reaching Supabase directly. The public background-removal model
assets are likewise served from the backend so the browser does not depend on a
third-party CDN that some networks block.

## 4.8 Conclusion of Chapter 4

This chapter described the environment, the stack, and the implementation of the
database, backend, frontend, and deployment, tying each part back to the design of
Chapter 3. Chapter 5 presents the testing, evaluation, and conclusion.
