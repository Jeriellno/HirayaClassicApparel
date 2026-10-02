# Hiraya — Handoff (kalagayan ngayon, Oktubre 2, 2026)

Para sa susunod na session (tao man o AI). Ang buong paliwanag ng system ay nasa
[README.md](README.md); ito ang **ano ang bago, ano ang dapat bantayan, at ano
ang susunod**.

---

## 1. Kalagayan ng deployment

| | |
|---|---|
| Backend | Render Web Service `Hiraya_ClassicApparel` (Docker, **Singapore**) — `https://hiraya-classicapparel.onrender.com` |
| Frontend | Render Static Site `HirayaClassicApparel-1` — `https://hirayaclassicapparel-1.onrender.com` |
| Database | Supabase PostgreSQL (Singapore) — **iisa para sa local at Render** |
| Lumang backend | `hirayaclassicapparel.onrender.com` (Oregon) — tinanggal na; mabagal dahil malayo sa DB |

- Naka-**suspend** ang dalawang Render service sa ngayon. I-resume sa dashboard, saka
  *Manual Deploy → Deploy latest commit* (frontend: *Clear build cache & deploy*).
- Backend env sa Render: `APP_ENV=production`, `APP_DEBUG=false`,
  `APP_URL=https://hiraya-classicapparel.onrender.com`.
- Static-site rewrites: `/supabase-storage/*` → backend (una), `/*` → `/index.html`.

---

## 2. Mga ginawa sa session na ito (buod)

### Deployment at backend reliability
- BOM sa `config/hiraya_backgrounds.php` na sumisira sa bawat response (CORS, images).
- Docker: GD (thumbnails), procps, upload limits, supervised queue worker
  (`TRYON_WORKER_SUPERVISED=true`), 4 na server worker.
- Try-on worker detection: maling grep pattern (`[q]queue:work`) na nagpaparami ng
  worker at umuubos ng memory/credits — naayos.
- `EnsureSupabaseAAL2`: kinukuha dati ang JWKS sa internet sa **bawat** admin request
  → cache muna, may last-known-good fallback. Hindi na rin naka-cache ang palyang
  email-confirmation lookup.
- Product save na may kulay: **sabay-sabay na upload** ng mga larawan (Http::pool),
  180s na hintay sa client, `shrinkForUpload` bago i-upload, PHP upload limits
  (`hiraya-backend/php/hiraya-uploads.ini`, ginagamit ng `start-backend.ps1` at Docker).
- axios: tinatanggal ng interceptor ang `/` sa unahan ng URL — kaya dati walang
  Supabase token ang product writes at 15s ang timeout ng lahat. Naayos (tingnan
  ang paalala sa §4).
- MFA: hindi na bumabalik sa `/login` ang verified na staff kapag nag-reload.
- `ConnectionWatcher`: kusang bumabawi ang lahat ng screen pagbalik ng internet.

### Orders, payment at stock (Order Guidelines)
- 3:00 PM cut-off (`config/payments.php`), store hours, `Order::processing_date`.
- **Full payment o 50% down payment** sa Checkout; ang full payment ay diretso sa
  *fully paid · ready to ship* pagka-verify.
- **Cancel order (unpaid balance)** sa admin — may dahilan, ibinabalik ang stock,
  inaabisuhan ang customer. Hindi na mache-cancel ang fully paid.
- LBC: kumpletong address (street, barangay, city, province, ZIP). Lalamove:
  drop-off address; ang customer ang nagpapadala ng booking details sa My Orders.
- Payment QR (System Settings), required na reference number na hindi
  puwedeng gamitin ulit, checklist sa admin para i-match sa GCash/bank app.
- Order tracker (customer at admin) gamit ang mga bagong timestamp.
- Stock: naitatala na ang bawat kulay sa Stock History; **Quick adjust** (± na may
  dahilan) para sa walk-in / offline sales.
- Checkout mula sa bag ay dating 500 (`Collection::delete`) — naayos.

### Reviews at feedback
- Kita na ang 1–5 star picker (halos invisible dati ang outline).
- Bawat product card: rating o `0.0 (0 reviews)`.
- **Rate your order experience** (isang beses kada delivered order) — lumalabas sa
  Customers Feedback na may "Order #X" at ang mga produktong binili.
- **Product Reviews** panel sa Customers Feedback (admin at superadmin).
- Required na ang bituin sa lahat ng feedback (dating may tahimik na default na 5★).

### Migrations na pinatakbo sa Supabase
- `2026_10_23_000001_add_order_tracking_and_payment_qr` — mga timestamp ng order,
  `system_settings.value` → TEXT.
- `2026_10_23_000002_add_order_id_to_feedbacks`.

---

## 3. Susunod na gagawin

1. **I-resume ang Render** at patakbuhin ang public smoke test (CORS, image rewrite,
   SPA routes, customer API).
2. **I-upload ang GCash QR** sa *System Settings → Payment QR*.
3. Subukan nang mano-mano ang mga bahaging kailangan ng MFA (hindi kayang i-test
   nang awtomatiko): Edit Product na may 3 kulay, Cancel order, Quick adjust,
   Customers Feedback.
4. Ayusin ang lumang test `tests/Feature/OrderVisibilityTest` — gumagamit pa ng
   Sanctum para sa `/api/admin/orders` na Supabase aal2 na ngayon.
5. (Opsyonal) Uptime pinger sa `https://hiraya-classicapparel.onrender.com/up`
   kada 10 minuto para hindi matulog ang free plan.

---

## 4. Mga paalala (huwag kalimutan)

- **Iisang database ang local at Render.** Ang test na order/try-on sa local ay
  totoong data, at may bayad ang bawat try-on render.
- **`src/api/axios.js` ay nagtatanggal ng `/` sa unahan ng URL** bago tumakbo ang
  mga matcher. Anumang bagong URL rule ay dapat mag-normalize sa leading `/`.
- **Raw SQL** (`selectRaw`, `DB::select`, `DB::raw`) ay dapat gumamit ng
  `DB::getTablePrefix()` — `tbl_` ang prefix ng bawat table.
- Ang local backend ay **`C:\php-8.3\php.exe`** (mula sa `start-backend.ps1`), hindi
  ang PHP sa PATH. Iba ang `php.ini` nila.
- Huwag i-run ang `vite build` sa local kapag mababa ang memory — namamatay pati
  ang dev server.
- Huwag ibalik ang `/clear-everything` o anumang public na maintenance route.
