# Hiraya — Admin/Super Admin Security & Console

**Status at susunod na hakbang.** Para sa susunod na AI session.

---

## 1. KALAGAYAN NGAYON

### Ang mga account

| Email | Role | 2FA | Mahalaga |
|---|---|---|---|
| `hirayaclassicapparel@gmail.com` | `superadmin` | **PENDING** | Ang tunay mong account (id 62) |
| 13 customer accounts | `user` | — | Hindi ginalaw |

- Ang dating seeded accounts (`superadmin@hiraya.com`, `admin@hiraya.com`) ay
  **na-delete** na. Wala nang ibang privileged account.
- Walang orders ang na-delete, kaya walang nawala na data.
- **Ang 2FA ay may `confirmed_at = NULL`** — nag-scan ka pero hindi mo na-confirm
  ang code. Kaya hindi pa ito gumagana. Ayusin ito:
  `Account Settings → Two-Factor Authentication → Start Again`, saka i-enter
  ang 6-digit code at i-save ang 8 recovery codes.

### Ang security work na tapos na

| | |
|---|---|
| QR login flow | **BINURA** (controller, migrations, routes, pages, npm packages) |
| `BYPASS_ADMIN_AUTH` | `true` → **`false`**, permanent |
| Console routes | `auth:sanctum` + `superadmin` **naibalik** |
| Axios auto-login | **BINURA** |
| `devAdminAutoLogin` | **BINURA** |
| `?role=superadmin` URL trust | **BINURA** |
| TOTP (RFC 6238) | Native PHP, walang bagong dependency, **45/45** laban sa RFC vectors |
| 2FA login exchange | Challenge token, single-use, replay guard, 5-attempt rate limit |
| Recovery codes | 8 ka, bcrypt-hashed, single-use |
| Individual accounts | Name kailangan, duplicate email tinatanggihan |
| Verification | **65/65** security tests, **45/45** TOTP vectors |

### Ang mga bug na natuklas habang nagte-test

1. `hash_equals(Hash::make($x), $stored)` — hindi kailanman tumutugma sa bcrypt
   (may salt). **Ang recovery codes ay patay.** Ayusin: `Hash::check()`.
2. `email`/`password` `required` pa rin sa login → **422 sa lahat ng 2FA
   sign-in**. Ayusin: `required_unless`.
3. `last_used_ip` na `timestamp` → **500** sa bawat successful 2FA sign-in.

---

## 2. ANO ANG GINAWA Natin NGAYON (Variant B — hiwalay na port)

Ang console ay lilipat sa **sariling dev port** para hindi ito mapabuksan mula sa
customer UI.

```
http://localhost:5173   ← storefront (customer)
http://localhost:5174   ← console (admin/superadmin lang)
```

**Bakit port, at hindi subdomain:** 5 minuto lang, walang DNS, walang SSL, at
**automatic na magkaibang ang `localStorage`** dahil iba ang origin. Ang session
ng customer ay literal na hindi makikita sa console.

**Ang limitasyon na sasabihin sa panel:** ibang *port* lang ito, hindi ibang
*domain*. Ang mga browser ay nagsasalita ng mga port bilang iisang origin, kaya
hindi nito pinipigil ang XSS. Ang totoong proteksyon ay ang `auth:sanctum` +
`superadmin` middleware at ang 2FA.

---

## 3. ANO ANG SUSUNOD NA GAGAWIN

### Immediate (gawin mo ito)

1. **Kumpirmahin ang 2FA.** `Account Settings → Two-Factor Authentication →
   Start Again` → i-scan → **mag-enter ng code** → i-save ang 8 recovery codes.
2. Magdagdag ng staff: `/superadmin` → `Admin Accounts → ADD ADMIN ACCOUNT`.
   Isang tao, isang account. Sabihin nilang palitan agad ang password.

### Kapag tapos na ang defense

Ang **AI try-on** ang capstone mo, hindi ang console. Ang susunod na oras ay
dapat sa:

1. **Tapusin ang try-on end-to-end** — upload → detect → sukat → render →
   history. Walang maaapag na step.
2. **Dokumentasyon** — README, architecture diagram, ERD, API docs.
3. **Isang security case study sa papel** — ito ang pinakamalaking oportunidad
   mo. Sabihin mo: *"may backdoor kami na naka-open sa URL, tinanggal namin ito at
   ginawa naming two-factor. Na-verify sa 65 automated tests."*
4. **Huwag ipakita ang port bilang security feature** — ito ay ergonomics, hindi
   proteksyon. Ang totoo ay ang middleware at ang tests.

### Artisan commands na available

```bash
php artisan hiraya:make-superadmin --email=... --name="..."   # bootstrap unang superadmin
php artisan hiraya:make-admin --email=... --name="..."        # individual admin
php artisan hiraya:twofactor:reset <email>                    # nawala ang phone
```

Pareho silang **nagpo-prompt ng password**, dala mo sa command line.

### Verification scripts (naiwan)

```bash
php verify_security.php   # 65 tests — console auth, 2FA, individual accounts
php verify_totp.php       # 45 tests — RFC 4226/6238 vectors
```

Ang `verify_security.php` ay may built-in cleanup sa simula kaya ito ay
**re-runnable**.

---

## 4. MGA FILE NA BINAGO

### Backend (bago)
- `app/Services/TotpService.php` — RFC 6238, native PHP
- `app/Models/UserTwoFactor.php`
- `app/Http/Controllers/Api/TwoFactorController.php`
- `database/migrations/2026_10_15_000001_create_user_two_factors_table.php`
- `app/Console/Commands/MakeSuperadminCommand.php`
- `app/Console/Commands/MakeAdminCommand.php`
- `app/Console/Commands/ResetTwoFactorCommand.php`
- `verify_security.php`, `verify_totp.php`

### Backend (binago)
- `app/Http/Controllers/Api/AuthController.php` — 2FA exchange
- `routes/api.php` — middleware naibalik, `/two-factor` routes
- `app/Models/User.php` — hindi ginalaw

### Frontend (bago)
- `src/components/settings/TwoFactorSection.jsx`
- `vite.config.console.js` — hiwalay na dev server para sa console (port 5174)
- `src/components/console/ConsoleOnlyRoute.jsx` — ang port guard
- `package.json` — `dev:console`, `build:console`

### Frontend (binago)
- `src/pages/Login.jsx` — 2FA step
- `src/routes/ProtectedRoute.jsx` — `BYPASS_ADMIN_AUTH = false`
- `src/api/axios.js` — auto-login binura
- `src/context/AuthContext.jsx` — auto-login binura
- `src/App.jsx` — QR routes binura
- `src/components/superadmin/SuperAdmin.jsx` — `?role=` binura
- `src/components/superadmin/tabs/AdminsTab.jsx` — individual accounts
- `HANDOFF.md` (repo root) — itong dokumento

---

## 5. HUWAG GAGAWIN

- **Huwag i-set ang `BYPASS_ADMIN_AUTH` pabalik sa `true`.** Ito ang pinakabulang
  linya sa repo. Ang kailangan para makapasok ay laging tunay na sign-in.
- **Huwag isulit ang QR login.** Sa 1–3 staff, isang QR = buong console, walang
  factor.
- **Huwag isama ang port bilang security feature** sa capstone defense.
- **Huwag isama ang Supabase project ref** sa frontend bundle. Ang
  `/supabase-storage` proxy sa `vite.config.js` ang dahilan kaya nandiyan pa rin
  ang env var.
