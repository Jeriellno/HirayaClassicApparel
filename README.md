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
