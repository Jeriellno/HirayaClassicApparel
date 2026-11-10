# Hiraya Classic Apparel

Hiraya Classic Apparel is an e-commerce web system for a clothing brand. It lets customers browse the catalog, place orders, and use an AI-assisted virtual try-on studio and AI Stylist consultation, while admins and staff manage products, orders, reviews, and analytics through a dashboard.

Live deployment: https://hiraya-classic-apparel.vercel.app

---

## Group Members & Roles
* Jorizzel Solis – Project Manager / Lead Developer
* Jessiah Repuya, Adrianne Lazundin – Frontend / UI-UX Developer
* Kenneth Giray, Jeriel Ino Layson – Backend / Database Administrator

---

## Tech Stack
* **Frontend:** React 18, Vite, Tailwind CSS 4, React Router, TanStack Query, Framer Motion, Recharts
* **Backend:** Laravel (PHP) REST API
* **Database:** PostgreSQL hosted on Supabase (also used for storage and staff auth)
* **AI / External Services:** Google Gemini (vision), PixelAPI / FASHN (virtual try-on), Cloudflare Workers AI and Groq (fallbacks)
* **Tools & Version Control:** Git, GitHub, VS Code, Composer, npm

---

## Project Structure
```
HirayaClassicApparel/
├── hiraya-frontend/     # React + Vite single-page app
├── hiraya-backend/      # Laravel API
├── supabase/migrations/ # SQL migrations for the Supabase database
└── docs/                # Additional documentation
```

---

## System Requirements & Prerequisites
Before you begin, ensure you have the following installed on your local machine:
* Node.js (v18+) and npm
* PHP (v8.2+, with the `pdo_pgsql`, `pgsql`, `curl`, `mbstring`, `openssl`, `fileinfo` extensions enabled)
* Composer (v2+)
* Git
* A Supabase project (free tier is enough): https://supabase.com

---

## Installation & Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/Jeriellno/HirayaClassicApparel.git
cd HirayaClassicApparel
```

### 2. Backend setup (Laravel)
```bash
cd hiraya-backend
composer install
npm install
cp .env.example .env        # on Windows PowerShell: copy .env.example .env
php artisan key:generate
```

### 3. Frontend setup (React + Vite)
Open a second terminal:
```bash
cd hiraya-frontend
npm install
cp .env.example .env        # on Windows PowerShell: copy .env.example .env
```

---

## Database Setup & Configuration

The database is PostgreSQL on Supabase.

1. **Create a Supabase project** at https://supabase.com and wait until it is ready.
2. **Create the tables:** open the Supabase **SQL Editor**, then run each file inside `/supabase/migrations/` in filename order (oldest first).
   * Alternatively, after the `.env` below is filled in, run from `hiraya-backend`: `php artisan migrate`
3. **Create the storage buckets:** in Supabase **Storage**, create two **public** buckets named `products` and `backgrounds`.
4. **Configure environment variables in `hiraya-backend/.env`:**
   ```env
   DB_CONNECTION=pgsql
   DB_HOST=<your-supabase-session-pooler-host>
   DB_PORT=5432
   DB_DATABASE=postgres
   DB_USERNAME=<your-supabase-db-user>
   DB_PASSWORD=<your-supabase-db-password>
   DB_SSLMODE=require
   DB_PREFIX=tbl_

   SUPABASE_URL=https://<your-project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<from Supabase > Project Settings > API>
   SUPABASE_JWT_SECRET=<from Supabase > Project Settings > API>

   FRONTEND_URL=http://localhost:5173
   ```
   Use the **Session pooler** host (port 5432) from Supabase > Project Settings > Database.
5. **Configure environment variables in `hiraya-frontend/.env`:**
   ```env
   VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key from Supabase > Project Settings > API>
   VITE_API_URL=http://127.0.0.1:8000
   ```

### Optional: AI features (virtual try-on, AI Stylist, catalog auto-fill)
The shop, cart, orders, and admin dashboard work without these. To enable the AI features, fill in the matching keys in `hiraya-backend/.env`:

| Feature | Variables |
|---|---|
| Image analysis (Gemini) | `GEMINI_API_KEY` |
| Virtual try-on | `VTON_API_TOKEN` (PixelAPI) or `VTON_FASHN_API_TOKEN` (FASHN) |
| Person-check fallbacks | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `GROQ_API_KEY` |
| Order / invitation emails | `MAIL_USERNAME`, `MAIL_PASSWORD` (Gmail app password) |

---

## Running the Application

Run the backend and frontend in **two separate terminals**.

**Terminal 1: Backend (Laravel API)**
```bash
cd hiraya-backend
php artisan storage:link
php artisan serve
```
The API runs at `http://127.0.0.1:8000`.

**Terminal 2: Frontend (React + Vite)**
```bash
cd hiraya-frontend
npm run dev
```

**Terminal 3 (only if you use virtual try-on): Queue worker**
```bash
cd hiraya-backend
php artisan queue:work --queue=tryon,default
```

Open your browser and navigate to: `http://localhost:5173`

### Production build (frontend)
```bash
cd hiraya-frontend
npm run build
```

---

## Default Login Credentials
* **Super Admin Account:** `[hirayaclassicapparel@gmail.com]` / `[Jameshiraya1]`
* **Staff Account:** `[ilazundin@gmail.com]` / `[Adinlangsakalam1]`
* **Customer Account:** `[nel@hiraya.com]` / `[Password1]`

---

## Troubleshooting
* **`could not find driver` error:** enable `pdo_pgsql` and `pgsql` in your `php.ini`, then restart the terminal.
* **cURL error 60 (SSL certificate) on Windows:** download `cacert.pem` into `hiraya-backend/storage/certs/` and keep `HTTP_CA_BUNDLE=storage/certs/cacert.pem` in `.env`.
* **Port 5173 already in use:** `npm run dev` automatically frees it; otherwise close the other process.
* **Try-on stays "queued":** make sure the queue worker (Terminal 3) is running.














# Hiraya Classic Apparel — AI Virtual Fitting Room & Store

Hiraya is a full-stack web store for a Filipino apparel shop with an **AI virtual
try-on**, a **verified-purchase review system**, and a **staff console** for the
owner (superadmin) and staff (admin). Customers browse the catalog, try pieces on
their own photo, order with a **50% down payment or full payment**, and track the
order to delivery.

| | |
|---|---|
| **Frontend** | React 18 + Vite, Tailwind CSS, Framer Motion, TanStack Query (`hiraya-frontend/`) |
| **Backend** | Laravel 12 REST API, Sanctum (customers), Supabase JWT + MFA (staff) (`hiraya-backend/`) |
| **Database** | Supabase **PostgreSQL** (Singapore). Every table is prefixed `tbl_` (`DB_PREFIX=tbl_`) |
| **File storage** | Supabase Storage buckets `products` and `backgrounds`, served same-origin through `/supabase-storage/*` |
| **AI** | Gemini (catalog auto-fill, photo checks), FASHN → PixelAPI (virtual try-on render), with fallbacks |
| **Hosting** | Render.com — backend (Docker, Singapore) + frontend (static site) |

---

## 1. Features

### Customer (storefront)
- **Shop & product pages** — colours (variants), sizes, live stock, star rating on every card (`0.0 (0 reviews)` until the first review).
- **AI Try-On Studio** — upload a full-body photo, stack garments, render a fitting; history of past looks. One piece renders in one provider job; a **top (or outerwear) + bottom** renders in **two** jobs (bottom first, then the top on that result — the Studio says so before Generate, and a retry never re-pays the first pass). Other multi-piece mixes (dress + another piece, footwear with other pieces, two tops, 3+ pieces) are refused with a reason before anything is charged.
- **Bag & Checkout**
  - **Payment option:** *50% down payment* (secures the stock) or *Full payment*.
  - **Courier:** **LBC** (complete address required: street, barangay, city, province, 4-digit ZIP) or **Lalamove** (drop-off address; the customer books the rider).
  - Scan-to-pay QR + **required reference number** (one reference can never be reused on another order).
  - Live **3:00 PM cut-off** notice and store hours.
- **My Orders** — visual **order tracker** with dates, balance payment, Lalamove booking details, **Review Product** (1–5 stars per delivered item) and **Rate your order experience** (1–5 stars per delivered order).
- **Notifications** — status updates; *Mark all read*.
- **Connection recovery** — if the internet or backend drops, a *Reconnecting…* pill appears and every screen reloads by itself when it is back.

### Staff console (`/superadmin`)
| Section | Admin | Superadmin |
|---|:-:|:-:|
| Dashboard | work queue | full analytics |
| Inventory — add/edit products, colours, pairings, **Quick adjust** stock (± with reason) | ✓ | ✓ |
| Orders — verify payments, cancel unpaid balances, tracking, status | ✓ | ✓ |
| Customers, Customers Feedback (+ product reviews), Stock History, Audit Logs | ✓ | ✓ |
| Admin Management, System Settings (payment QR, toggles), backups | | ✓ |

Staff sign in with password **plus a TOTP authenticator (Supabase MFA, aal2)**. A verified session survives page reloads.

---

## 2. Order & payment flow (Order Guidelines)

```
Checkout ──► pending ──(staff verifies receipt)──┬─► 50% paid · processing ──(balance receipt verified)──► fully paid · ready to ship
                                                 └─► (paid in full) ─────────────────────────────────────► fully paid · ready to ship
ready to ship ──► shipped (LBC tracking no. / Lalamove booking) ──► delivered ──► reviews & order rating
```

| Rule | Where it is enforced |
|---|---|
| §1 Orders before **3:00 PM (Asia/Manila)** are processed the same day, later ones the next day | `Order::processing_date`, shown on Checkout, My Orders, admin Orders (`config/payments.php`) |
| §2 50% down payment secures the order; balance due **before courier pickup**; unpaid balances may be cancelled | `CheckoutController`, `AdminOrderController::updateStatus` (*Cancel order* records the reason, returns stock, notifies) |
| §3 Nothing ships before full payment; fully paid orders first | `updateStatus` blocks ready/shipped/delivered unless `fully_paid` |
| §4 LBC: complete delivery details · Lalamove: customer books and sends booking details | Checkout validation; `POST /orders/{id}/lalamove-booking` |
| §5 Once fully paid the order is final | Cancelling a `fully_paid` order is refused |

**Stock** is reserved at checkout (per size and colour), returned automatically when an order is cancelled or its down payment is rejected, and every change — including manual **Quick adjust** for walk-in/offline sales — is written to **Stock History** with who, when and why.

---

## 3. Running locally (Windows)

Prerequisites: PHP 8.3 at `C:\php-8.3\php.exe` (with `pdo_pgsql`, `gd`, `curl`), Composer, Node 20+.

```powershell
# Backend (kills stale PHP, starts the API on :8000 and the try-on worker watchdog)
Set-Location 'D:\Hirayaaa-main'
.\start-backend.ps1

# Frontend (http://localhost:5173)
Set-Location 'D:\Hirayaaa-main\hiraya-frontend'
npm install
npm run dev
```

- `start-backend.ps1` loads `hiraya-backend/php/hiraya-uploads.ini` (upload limits) via `PHP_INI_SCAN_DIR` — without it product saves with colour photos fail with HTTP 413.
- `hiraya-frontend/.env.development.local` points the dev server at the local API (`VITE_API_BASE_URL=http://127.0.0.1:8000`); production builds ignore it.
- `php artisan serve` is single-threaded on Windows: requests queue, so the console is slower locally than on Render.
- **Local and Render share the same Supabase database** — orders and try-ons made locally are real data, and try-on renders cost credits.

### Environment
Copy `hiraya-backend/.env.example` → `.env` and `hiraya-frontend/.env.example` → `.env`. Required secrets: `APP_KEY`, `DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `GEMINI_API_KEY`, `VTON_FASHN_API_TOKEN` / `VTON_API_TOKEN`, `MAIL_PASSWORD`; frontend `VITE_SUPABASE_ANON_KEY`.

### Useful commands
```bash
php artisan migrate                      # run new migrations (shared Supabase DB!)
php artisan test                         # backend tests (in-memory SQLite)
php artisan hiraya:make-superadmin       # bootstrap the owner account
php artisan hiraya:make-admin            # add a staff account
php artisan hiraya:reset-mfa             # staff lost their authenticator
php artisan hiraya:doctor                # health check of a running API
php artisan tryon:ensure-worker          # make sure the try-on queue worker runs
npx eslint <files>                       # frontend lint (run inside hiraya-frontend)
```

---

## 4. Deployment (Render.com)

| Service | Type | Notes |
|---|---|---|
| `Hiraya_ClassicApparel` → `https://hiraya-classicapparel.onrender.com` | Web Service, **Docker**, Singapore | `hiraya-backend/Dockerfile`: PHP 8.2 + pdo_pgsql + **GD** + **procps**, upload limits, 4 server workers, a supervised `queue:work` loop (`TRYON_WORKER_SUPERVISED=true`) |
| `HirayaClassicApparel-1` → `https://hirayaclassicapparel-1.onrender.com` | Static Site | Build `npm run build`, publish `dist`. Env: `VITE_API_BASE_URL=https://hiraya-classicapparel.onrender.com/api`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

Static site **Redirects/Rewrites** (order matters):
1. `/supabase-storage/*` → `https://hiraya-classicapparel.onrender.com/supabase-storage/*` (Rewrite)
2. `/*` → `/index.html` (Rewrite)

Backend environment on Render: everything in `.env.example`, plus `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://hiraya-classicapparel.onrender.com`, and **`FRONTEND_URL=https://hirayaclassicapparel-1.onrender.com`** (origin only, no trailing slash). Pushing to `main` auto-deploys both services.

**Admin invitation links** are built only from `FRONTEND_URL` + `/accept-invitation` (never from request headers). Locally (`FRONTEND_URL=http://localhost:5173`) an invite sent from your local backend points at your machine — open it on the same computer. For invitees elsewhere, send the invite from the deployed console, whose backend has the production `FRONTEND_URL`. With `APP_ENV=production` an unset, `http` or `localhost` value is refused before any e-mail is sent. Invitations are mailed by Laravel (not Supabase), so no Supabase redirect-URL entry is needed; the static site's `/* → /index.html` rewrite (above) is what lets the link open. After changing env vars on Render, redeploy (or restart) the backend service. The free plan sleeps after ~15 min idle — open the site a minute before a demo (or ping `/up`).

---

## 5. Repository layout

```
hiraya-backend/                 Laravel API
  app/Http/Controllers/Api/     Checkout, Order, AdminOrder, Product, ProductReview, TryOn, SuperAdmin, …
  app/Http/Middleware/          EnsureSupabaseAAL2 (staff JWT + MFA, cached JWKS)
  app/Jobs/ProcessTryOnJob.php  queued try-on render
  app/Support/                  ProductVariants (stock per colour/size), SupabaseStorage (parallel uploads)
  config/payments.php           payment accounts, cut-off, store hours
  database/migrations/
  php/hiraya-uploads.ini        PHP upload limits (local + Docker)
  Dockerfile
hiraya-frontend/                React SPA
  src/pages/                    Home, Shop, ProductDetail, AiTryOn, Cart, Checkout, MyOrders, Login, …
  src/components/superadmin/    staff console (tabs/)
  src/components/common/        OrderTracker, ConnectionWatcher, CutoffNotice, PaymentInstructions, …
  src/api/axios.js              API client (token handling, timeouts)
docs/                           security notes (MFA / aal2 verification)
start-backend.ps1               local backend launcher (Windows)
```

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Save failed (HTTP 413)` on a product with colours | PHP upload limits — start the backend with `start-backend.ps1` (local) / redeploy the Docker image |
| Staff bounced to `/login` after a reload | Fixed: verified (aal2) sessions resume. If it recurs, check the console for `[ProtectedRoute] assurance level check failed` |
| *Reconnecting…* pill stays up | The API or Supabase is unreachable — check internet; locally make sure `start-backend.ps1` is running |
| Try-on shows `worker_offline` | Locally: `php artisan tryon:ensure-worker`. On Render the Docker loop supervises the worker |
| Where does try-on time go? | `storage/logs/laravel.log`: `TryOn request timings` (garment mattes, plan, DB insert, worker check) and `TryOn render timings` (queue wait, each provider pass: submit / provider wait / download, storing the result). In dev, the browser console logs `[Hiraya] try-on timings` |
| Images missing on the deployed frontend | The `/supabase-storage/*` rewrite must be the first rule on the static site |
