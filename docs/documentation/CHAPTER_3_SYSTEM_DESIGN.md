# CHAPTER 3 — System Design and Methodology

## 3.1 Introduction

This chapter presents the design of the system and the methodology used to build it. It
covers the architectural style, the component design, the data design, the interface
design, the control and security design, and the AI rendering pipeline design.

## 3.2 Development Methodology

The system was developed using an **incremental, evidence-driven methodology**. The
process for each feature was:

1. **Audit** — inspect the existing code and record the actual current behaviour,
   including behaviour that contradicts the code's own comments.
2. **Specify** — write down what the feature must do and, just as importantly, what it
   must not claim to do.
3. **Design** — decide where the logic belongs, with particular attention to which
   component owns which responsibility.
4. **Implement** — build it, keeping the failure paths as first-class as the success
   path.
5. **Verify** — prove it works, by running it rather than by reasoning about it.
6. **Document** — record what was verified and what was not.

This methodology has one distinguishing characteristic, and it explains most of the
codebase's shape. Because the hardest part of this system is the behaviour of
third-party services that cannot be fully predicted, the design treats **failure
identification and honest reporting** as first-class requirements rather than as
afterthoughts. A feature that cannot be verified is not marked complete; it is marked
unverified, and the limitation is written down.

## 3.3 Architectural Style

The system is a **three-tier, client–server architecture with an asynchronous worker
tier**, deployed as a service-oriented web application.

```
┌──────────────────────────────────────────────────────────────────┐
│  PRESENTATION TIER — React 18 + Vite (static SPA)                │
│  Pages · Components · Hooks · TanStack Query cache · AuthContext  │
└───────────────────────────┬──────────────────────────────────────┘
                            │ HTTPS / JSON
┌───────────────────────────▼──────────────────────────────────────┐
│  APPLICATION TIER — Laravel 12 REST API (stateless)               │
│  Controllers · Middleware chain · Services · Jobs · Models       │
└──────┬─────────────────────────────────────┬────────────────────┘
       │                                     │ HTTPS (server-side)
┌──────▼──────────────────────┐  ┌───────────▼─────────────────────┐
│  DATA TIER                  │  │  EXTERNAL AI PROVIDERS           │
│  Supabase PostgreSQL        │  │  VTON API (PixelAPI / FASHN)     │
│  Supabase Storage buckets   │  │  Gemini (vision + image)         │
│  Supabase Auth (aal2, MFA)  │  │  Hugging Face (self-host option) │
└─────────────────────────────┘  └─────────────────────────────────┘
```

### 3.3.1 Why a stateless API

The frontend is a single-page application. It talks to the API over JSON with bearer
tokens and holds no server-side session. This makes the API horizontally scalable and
lets the frontend and backend be deployed independently — necessary here because they
are hosted as two separate Render services.

The staff console is the deliberate exception to "one auth mechanism". Customers use
Sanctum personal access tokens; staff use Supabase Auth JWTs. The reason is specific:
Supabase's assurance level (`aal`) exists only inside a Supabase-signed token, so
`EnsureSupabaseAAL2` must read a Supabase JWT. Sanctum cannot see `aal`, so a
`auth:sanctum` gate on console routes would answer 401 before the assurance-level check
ever ran.

### 3.3.2 Why an asynchronous worker tier

Constraint C-4 states that a render can take well over a minute. A synchronous HTTP
request cannot wait that long without risking a proxy timeout. Therefore the render is
dispatched to a queued job, the session row moves to `processing`, and the client polls
a status endpoint. The Docker image runs a supervised `queue:work` loop, and a local
watchdog command does the same on a developer machine.

## 3.4 Component Design

### 3.4.1 Frontend components

| Component group | Responsibility |
|---|---|
| `pages/` | One component per route: Home, Shop, ProductDetail, AiTryOn, Cart, Checkout, MyOrders, AccountSettings, Login, Register, Feedback, and the console pages. |
| `components/home/` | The storefront landing experience: hero, how-it-works, product rail, footer CTA, guest and signed-in variants. |
| `components/product/` | Product presentation: gallery, card, variant selector, size table, reviews, fit-match badge, "complete the look", and the floating stage. |
| `components/tryon/` | The studio: photo guide, style stack, garment cards, canvas, stylist chat, history panel, side drawer. |
| `components/common/` | Shared UI: navbar, order tracker, connection watcher, cut-off notice, payment instructions, notification bell, modals, toasts, skeletons. |
| `components/account/` | Order tabs, Lalamove booking form, product review modal, order experience rating. |
| `components/settings/` | Account settings: personal info, sizes, security, MFA enrolment, preferences, virtual try-on, danger zone. |
| `components/superadmin/` | The staff console: layout, dashboard, and one component per tab (inventory, orders, customers, feedback, stock history, audit logs, analytics, admins, settings). |
| `hooks/` | Data and behaviour hooks: `useCart`, `useShopData`, `useTryOnState`, `useOutfitRecommendations`, `useMaintenanceMode`, `useConfirm`. |
| `utils/` | Pure helpers: photo validation, preparation, body geometry, fit checks, garment compositing, category helpers, order policy, formatting. |
| `context/` | `AuthContext` (token and user state, axios interceptors) and `PreferencesContext` (theme, locale, motion). |
| `api/axios.js` | The single API client: base URL, token injection, timeouts, error normalisation, reconnect behaviour. |

### 3.4.2 Backend components

| Layer | Responsibility |
|---|---|
| Controllers (`Api/`) | HTTP boundary. Validate, authorise, delegate, shape the response. Business logic is kept out of controllers where a service exists for it. |
| Middleware | The access-control chain: `EnsureSupabaseAAL2`, `ResolveSupabaseUser`, `EnsureUserIsAdmin`, `EnsureUserIsSuperAdmin`. |
| Services | Domain logic that is too substantial for a controller: renderers, try-on pre-processing, measurement parsing and normalisation, size charts, outfit recommendations, credential storage, key pools, storage helpers, health tracking. |
| Jobs | `ProcessTryOnJob` — the asynchronous render orchestrator and the provider chain dispatcher. |
| Support | Variant-aware stock, garment pairing, local assets, account audit, provider health. |
| Models | Eloquent models for users, products, orders, order items, cart items, reviews, feedback, notifications, try-on sessions, stock movements, audit logs, credentials, settings, size charts, provider health. |
| Console commands | Operational tooling: create superadmin, create admin, reset MFA, ensure the try-on worker, watch the worker, health check, provider probe, table prefixing, key rotation. |

### 3.4.3 Separation into services

The renderer is the clearest example of why services exist. `VtonApiRenderer` owns the
entire provider protocol — endpoint, authentication, payload field names, category
vocabulary, synchronous and asynchronous response handling, polling, and error
classification. The job that calls it knows none of that. Because the provider details
come from a config slot, changing vendors is a configuration change.

## 3.5 Data Design

### 3.5.1 Naming and conventions

- Every table is prefixed `tbl_` (`DB_PREFIX=tbl_`). Raw SQL uses `DB::getTablePrefix()`
  so the prefix is applied in exactly one place.
- Money is stored in integer minor units (NFR-6).
- Status columns are constrained strings with a defined set of legal transitions.
- Try-on portraits and renders are stored as Base64 data URIs in long-text columns.

### 3.5.2 Entity relationship summary

The core entities and their relationships are:

- A **user** has one role, optional body sizes, a cart, orders, notifications, reviews,
  feedback, and many try-on sessions.
- A **product** has many **colour variants**. Each colour has per-size stock.
- A **product** may have **pairings** (other products that complete the look).
- An **order** has many **order items**, each referencing a product, colour, and size.
  An order carries a payment state, a delivery method, a courier reference, and a
  processing date.
- A **product review** belongs to one order item and one product, and exists only when
  that order item was delivered.
- A **try-on session** belongs to one user and stores the before photo, the render plan,
  the render result, the status, and history fields (favourite, deleted, restored).
- A **stock movement** records one change to one size and colour of one product, with
  actor, time, quantity, and reason.
- An **audit log** records a privileged action with actor, subject, action, and detail.
- A **provider health event** records a renderer's failure or recovery.

### 3.5.3 Order state machine

The order state machine is the design's most safety-critical element, because the shop
accepts a partly paid order.

```
Checkout ──► pending ──(staff verifies receipt)──┬─► 50% paid · processing
                                                │      │
                                                │      └──(balance verified)──► fully paid · ready to ship
                                                │
                                                └──(paid in full)──────────────────────────────► fully paid · ready to ship

ready to ship ──► shipped (courier reference recorded) ──► delivered ──► reviews & order rating
```

Invariants enforced in the backend:

1. Orders before the 15:00 Asia/Manila cut-off are processed the same day; later orders
   the next day.
2. A 50% down payment secures the order; the balance is due before courier pickup; an
   unpaid balance may be cancelled.
3. Nothing ships before full payment — the status update refuses ready, shipped, and
   delivered unless the order is fully paid.
4. LBC requires complete delivery details; Lalamove requires the customer to submit
   booking details.
5. Once fully paid, the order is final — cancellation is refused.

## 3.6 Interface and User Experience Design

The interface uses a "glassmorphism" visual language: translucent panels, soft shadows,
and a charcoal-and-gold palette, implemented as design variables in a single stylesheet.

Key interface decisions and their reasons:

- **The photo guide precedes the upload.** A short illustrated guide raises the quality
  of the first photograph, which is the single biggest determinant of render quality.
- **The style stack is visible and editable.** The customer sees exactly which garments
  are layered before rendering, which supports FR-19.
- **Render status is visible and honest.** The interface shows which engine produced the
  result and names the garment actually rendered, not the whole stack.
- **The order tracker is a visual timeline**, not a status string, with dates, the
  balance, and the courier reference.
- **The cut-off notice appears at the point of decision** (checkout, orders, and the
  console), not only in a footer.
- **A connection watcher runs globally.** When the API or the network drops, a
  *Reconnecting…* pill appears; on recovery, active queries are invalidated so screens
  refresh themselves without a manual reload (NFR-10).
- **Reviews and the badge show `0.0 (0 reviews)`** until a real review exists, so the
  interface never displays a fabricated rating.

## 3.7 Security Design

Security is designed as a chain, because a single check always leaves a hole.

### 3.7.1 The staff console chain

```
supabase.aal2  →  supabase.user  →  admin  (or superadmin)
     │                  │                │
 TOTP proved       JWT maps to a     role is staff
                     users row
```

Each middleware alone is insufficient, and the order is load-bearing:

- `admin` without `supabase.aal2` would accept a correct password that produced an
  `aal1` session — the exact bug this chain exists to close.
- `supabase.user` trusts the email claim that `supabase.aal2` has just verified, so
  `aal2` must run first; otherwise a forged unsigned token could name the superadmin's
  address and be resolved into that user.
- `auth:sanctum` is deliberately absent on console routes, because it would answer 401
  before the assurance-level check ran.

Controllers keep their own role checks as defence-in-depth, but with the route gate in
place they should never fire.

### 3.7.2 Other security measures

- **Throttling** on registration, login, password reset, invitation redemption, provider
  analysis, stock adjust, and support submission, sized per endpoint.
- **Write-only credentials.** API credentials are stored server-side and never returned
  to the client; the client sees only a masked label.
- **Server-side uploads.** The browser never writes to Supabase Storage directly,
  because that would require the service-role key in the frontend bundle — a
  full-admin credential for the whole project.
- **Password policy** enforced in the frontend and re-checked on the backend.
- **Single-use, expiring, signed tokens** for password reset and staff invitation.
- **Invitation accounts start inactive** and cannot reach the console until they complete
  a TOTP challenge, so a leaked invitation link yields an account that is still gated.
- **Role-based field reduction** — customer data is masked for admins, full for the
  superadmin.
- **Account deletion** re-verifies the current password and revokes every token.

## 3.8 AI Rendering Pipeline Design

This is the core of the "AI assisted styling" contribution, and it is designed around
the measured behaviour of real providers.

### 3.8.1 The chain

```
                    ┌──────────────────────────┐
  session row  ───► │  ProcessTryOnJob (queue)  │
  (processing)      └────────────┬─────────────┘
                                 │  try each slot with its own token
                 ┌───────────────┼───────────────┐
                 ▼               ▼               ▼
           VtonApiRenderer  GeminiRenderer  HuggingFaceRenderer
           (dedicated VTON) (general image)  (self-host option)
                 │               │               │
                 └───────────────┼───────────────┘
                                 │  all unavailable / failed
                                 ▼
                    Browser 2D composite fallback
                    (free, offline, guaranteed)
```

The chain is built from measured facts, not preferences:

- A dedicated VTON model produces materially better garment placement than a general
  image model, so the VTON slot is tried first.
- A general image generator is billed-only for image output; a free key returns a quota
  error, so it cannot be the guaranteed path.
- Some open research try-on models are non-commercial, and are therefore excluded.
- A provider that runs one job at a time will refuse or fold concurrent submissions, so
  a busy result is treated as retryable rather than a failure of the input.

### 3.8.2 The provider-neutral renderer

`VtonApiRenderer` is one class that serves every paid VTON vendor. FASHN and PixelAPI
differ only in field names and category vocabularies, and all of that lives in a config
slot. The renderer:

- accepts a person photo and a garment image;
- picks **one most-significant garment** (dress > outerwear > top > bottom > inner) and
  says so, rather than pretending a full stack rendered;
- handles both synchronous and asynchronous (submit-then-poll) provider responses;
- classifies outcomes into codes: `renderer_busy`, `renderer_unreachable`,
  `renderer_safety_unavailable`, `renderer_no_image`, `renderer_rejected`,
  `renderer_unauthorized`, `renderer_payment_required`, `not_configured`;
- returns `not_configured` rather than throwing when no token is present;
- redacts Base64 image payloads from its logs.

### 3.8.3 Retry policy

Only three outcomes are retried: `renderer_busy`, `renderer_unreachable`, and
`renderer_safety_unavailable`. Each is a transient condition that a later attempt can
change. Everything else — a rejection, a missing image, an auth or quota failure — is
permanent for that payload, and retrying it would burn minutes for an answer that will
not change.

The job's own timeout is set above the renderer's poll window, so the renderer always
gives up with its real reason before the worker kills the job. This ordering was chosen
deliberately: the reverse would mark jobs failed with a generic reason and destroy the
diagnostic.

### 3.8.4 Pre-processing

`TryOnPreProcessor` prepares inputs before they are sent to a provider — resizing,
orientation, and format normalisation — to reduce the chance of a provider-side
rejection and to keep payload size within limits. Measurement parsing and normalisation
are separate services, so a body measurement and a garment measurement are interpreted
by the same rules.

### 3.8.5 Provider health observability

Each renderer outcome is recorded as a provider health event. The console's health
display and the API-status panel read these, and a superadmin can probe a single
provider live. This is what makes FR-24 and FR-57 possible, and it is what allows an
operator to distinguish "the AI is broken" from "this one key is rate-limited".

## 3.9 Methodology Applied to the AI Feature

The AI feature is the part of the system where design and reality diverge most, so the
methodology of §3.2 is applied most strictly here.

- The capability boundary is documented before implementation, not discovered after.
- The guaranteed fallback is designed in from the start, not added after the first
  failure.
- Every render is verified by looking at the output image, not only by reading a
  success flag or an automated score.
- A measurement harness built for the 2D composite is explicitly marked as unproven
  against an AI render, so its numbers are not presented as evidence of quality.
- Failures that were not root-caused are recorded as unrooted, not folded into a general
  "known issues" statement.

## 3.10 Conclusion of Chapter 3

This chapter presented the methodology, the three-tier architecture, the component and
data design, the order state machine, the security chain, and the AI rendering pipeline.
Chapter 4 presents the implementation of these designs.
