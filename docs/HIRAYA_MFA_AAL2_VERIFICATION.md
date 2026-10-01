# HIRAYA — Supabase MFA / AAL2 Verification Guide
### "AI-Assisted Styling For Hiraya" — title defense runbook

**Architecture in force: option C (the gateway).** Authorization lives in
Supabase (`aal` claim); data lives in Laravel/Postgres. Laravel is the gateway
for the console; RLS is defence in depth.

---

## 0. Before you start — read this

The following are **true of this project** and were verified against it:

- The backend is **already PostgreSQL**. `DB_CONNECTION=pgsql` points at the
  **same Supabase project** as the frontend (`qnyskltxjfdsvncaehvh`). There is
  no MySQL anywhere and none was introduced.
- The real table names are Laravel's. An earlier draft of the RLS script
  referenced `profiles` and `system_configs`; **neither exists.** The tables are
  `users`, `system_settings`, `products`, `garments`, `orders`, `audit_logs`.

---

## 1. Run the SQL, in this order

Supabase Dashboard → **SQL Editor** → New query.

| Order | File | What it does |
|---|---|---|
| 1 | `supabase/migrations/0002_link_supabase_auth_users.sql` | Adds `users.auth_id` (uuid) + backfills it from `auth.users` by exact email |
| 2 | `supabase/migrations/0001_hiraya_rls_aal2.sql` | Enables RLS and creates every `aal2` policy |

**Order matters.** The policies read `users.auth_id`. Running the RLS file
first fails to compile.

### 1a. Confirm the backfill linked every staff account

```sql
select id, email, role, auth_id is not null as linked
from public.users
where role in ('admin','superadmin');
```

**Every row must show `linked = t`.** A `false` means that account's role
resolves by email fallback rather than exact match — fix it before continuing.

---

## 2. Configure the backend secret

In `hiraya-backend/.env`:

```
SUPABASE_JWT_SECRET=<Supabase Dashboard → Project Settings → API → JWT Secret>
```

Copy it from `hiraya-backend/.env.example`, which documents why. Then:

```powershell
cd hiraya-backend
php artisan config:clear
php artisan route:list --path=api/admin
```

> ⚠️ `SUPABASE_JWT_SECRET` can mint a token claiming **any** role and **any**
> `aal`. A leak defeats the control entirely. Never prefix it `VITE_` — that
> compiles it into the browser bundle.

**What `route:list` must show:** every `api/admin/*` route listing
`supabase.aal2,supabase.user,admin` (or `...,superadmin`). If any shows only
`admin`, the gate did not apply.

---

## 3. Enroll an authenticator (once, per staff account)

The enrollment UI is `MfaEnrollment.jsx`. To use it you must already be `aal2`
or you will lock yourself out — see the recovery path in §6.

1. Sign in at `/login` (email + password) — the one form, for every role.
2. You land on the enrollment step. You have **no factor yet**, so the form
   switches to the authenticator setup instead of asking for a code.
3. Create the factor directly, then reload:

```js
// Browser console, while signed in as the staff account
const { data } = await supabase.auth.mfa.enroll({
  factorType: 'totp',
  friendlyName: 'Hiraya Authenticator',
});
console.log(data.totp.secret);   // type this into Google Authenticator
```

4. Confirm it:

```js
const { data: s } = await supabase.auth.getSession();
await supabase.auth.mfa.challengeAndVerify({
  factorId: '<the id from step 3>',
  code: '<the 6 digits from your app>',
});
```

5. Open **Console → Settings → Two-Factor Authentication** — the badge must now
   read **`aal2`**, and the factor must be listed as *verified*.

---

## 4. Test the five cases that matter

Run these in order. Each has exactly one correct answer.

| # | Scenario | Expected |
|---|---|---|
| 1 | Staff signs in with password, **stops at the TOTP prompt** | Browser sits on `/login`; console does **not** render |
| 2 | Staff enters the correct code | Lands on `/superadmin`, badge shows `aal2` |
| 3 | **aal1** session calls `GET /api/admin/orders` | **403** — `current_aal: "aal1"` |
| 4 | **No token** calls `GET /api/admin/orders` | **401** |
| 5 | **Customer** (aal1) calls `GET /api/admin/orders` | **401** at `supabase.user` (no Hiraya identity is established for them on this path) |

### Checking case 3 by hand

Open `/admin` in DevTools → Application → Local Storage → Supabase. Copy the
`access_token` **while still on the password screen (before the TOTP step)**
and run:

```powershell
curl.exe -i http://127.0.0.1:8000/api/admin/orders `
  -H "Authorization: Bearer <AAL1_TOKEN>" `
  -H "Accept: application/json"
```

Expected: `HTTP/1.1 403 Forbidden` with `"current_aal":"aal1"`.

Repeat with the **aal2** token (after completing the TOTP step): expected
`200 OK`.

### 4a. Proving RLS independently of the browser

This is the check that matters for a defense, because it bypasses React,
`ProtectedRoute` and Laravel entirely — it asks the *database* directly.

```sql
-- Run as a staff user, from the SQL editor with a JWT set, or via PostgREST
-- with the anon key + the user's access token.
select 'aal2 staff' as who, count(*) from public.system_settings;  -- expect rows
```

Then repeat with an **aal1** staff token. Expect **zero rows** on every one of:
`system_settings`, `orders`, `users` (other rows), and every write on
`products` / `garments`.

`garments` and `products` are the deliberate exception for **reads** — the
storefront lists the catalogue anonymously, so those two have a public read
policy. **Writes** remain `aal2`-only. That asymmetry is intentional; verify
writes are refused, not reads.

---

## 5. Negative tests worth running before you defend

```powershell
# Forged unsigned JWT (alg: none) naming the superadmin
curl.exe -i http://127.0.0.1:8000/api/admin/export -H "Authorization: Bearer <forged>"   # 401

# A valid aal1 token against a superadmin-only route
curl.exe -i http://127.0.0.1:8000/api/admin/export -H "Authorization: Bearer <AAL1>"    # 403

# An old Sanctum token (no dots)
curl.exe -i http://127.0.0.1:8000/api/admin/orders -H "Authorization: Bearer <sanctum>"  # 401
```

The forged-JWT test is the one that proves **middleware order**. It only fails
safe because `supabase.aal2` runs *before* `supabase.user`. Swapping those two
aliases in `routes/api.php` turns this from 401 into full superadmin access.

---

## 6. If you lock yourself out

The console is now genuinely closed, which means a mistake can keep you out.

```sql
-- Remove the factor for a specific user (Dashboard → Authentication → Users
-- → the user → Factors, or:)
delete from auth.mfa_factors where user_id = '<uuid>';
```

Then the next sign-in reports *"Authenticator not set up"* instead of showing an
impossible prompt, and §3 can be repeated.

---

## 7. Legacy 2FA — REMOVED (complete)

The Laravel second factor is gone. It is not a parallel path any more; there is
exactly one, and it is Supabase's.

| Removed | Replacement |
|---|---|
| `POST /login` two-step challenge branch | `200 { mfa_required, role }` → the code step inside `/login` |
| The second staff door (`/admin/login`, `AdminSignIn.jsx`) | gone — one form, `Login.jsx`, branches on the role |
| A separate MFA route (`/admin/verify-2fa`, `AdminVerifyTwoFactor.jsx`) | gone — a `step` state inside `/login` |
| A second console (`MainDashboard.jsx` + `components/admin/`) | gone — `/superadmin` renders the one console |
| `login:2fa:*` cache keys | Supabase's own challenge/session |
| `TwoFactorController.php` | `supabase.auth.mfa.*` |
| `TotpService.php` (hand-written RFC 6238) | Supabase-verified TOTP |
| `UserTwoFactor.php` model | `auth.mfa_factors` |
| `user_two_factors` table | *dropped*, not archived |
| `TwoFactorSection.jsx` | `MfaEnrollment.jsx` (now mounted) |
| Customer TOTP UI in `Login.jsx` | the MFA step of that same `Login.jsx` |
| `hiraya:twofactor:reset` command | `hiraya:reset-mfa` |
| `verify_totp.php` | deleted |

### Deploy order — this matters

`0002` → `0001` → `php artisan migrate` → restart. The migration drops
`user_two_factors`; the code no longer reads it, so running the migration
before the code is deployed is what would break a running instance.

### The one capability that was lost

**There are no recovery codes any more.** The old flow issued ten hashed
recovery codes so a lost phone was survivable by the owner alone. Supabase MFA
has no equivalent — the secret never leaves the identity provider.

The replacement is `php artisan hiraya:reset-mfa <email>`, which needs server
access. This is worse for a user and better for an attacker: recovery codes get
phished and shared, a CLI command does not. If a defense panel asks "what if
staff lose their phone?", this is the honest answer — say the CLI, not a
recovery code that no longer exists.
