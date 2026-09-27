# Diagnostic & verification scripts

One-off developer tools for debugging Hiraya. **Not** part of the app — nothing in
`app/` or `routes/` references them. They live here so the repo root stays clean
and so the checks that once caught a real bug stay available as regression guards.

Run them from the backend root so autoloading and the `.env` resolve the same way
the queue worker sees them:

```bash
cd hiraya-backend
php scripts/_db_latency.php
```

## Regression guards (re-run these after touching the area they cover)

| Script | Question it answers |
|---|---|
| `_smoke_stylist_chat.php` | Does the intent-aware stylist chat still work without browsing? |
| `_smoke_stylist_knowledge.php` | Is the Hiraya grounding still in effect? |
| `_smoke_stylist_inspect.php` | What is the real reply + source for one question? |
| `_smoke_catalog_match.php` | Can the stylist MATCH a garment end-to-end? |
| `_smoke_future_garment.php` | Does it pick up garments added *after* deploy? |
| `_smoke_catalog_sizes.php` | What does the catalog actually contain for sizes? |
| `_smoke_size_chart_http.php` | Does `GET /api/size-chart` serve JSON? |
| `_smoke_size_chart_source.php` | Is the size chart really one source of truth? |
| `_verify_product_delete.php` | Does the product-delete fix hold at the data layer? |
| `_verify_delete_http.php` | Does the exact SuperAdmin `DELETE` call succeed end-to-end? |
| `_verify_supabase_storage.php` | Does `SupabaseStorage` really write an object and read it back? |
| `verify_font_glyph.php` | Do the downloaded woff2 files contain the PESO SIGN (U+20B1)? |

## Environment & queue

| Script | Purpose |
|---|---|
| `_preflight_tryon.php` | DB reachability, queue, storage before running VTON for real |
| `_hf_config.php` | Confirms the HF VTON config resolves in the *worker's* environment |
| `_queue_state.php` | Pending/failed jobs + try-on heartbeat |
| `_failed_jobs.php` | Recent `failed_jobs` rows with the exception head |
| `_dump_session.php` | Every attribute of the newest try-on session |
| `_probe_login.php` | Probes the login API exactly as the browser does |

## Latency

| Script | Purpose |
|---|---|
| `_db_latency.php` | Supabase round-trip: one trivial SELECT + a connect |
| `_tcp_latency.php` | Raw TCP latency to the pooler, measured outside Laravel |

## Maintenance & local QA setup

| Script | Purpose |
|---|---|
| `_clean_dead_image_refs.php` | Clear DEAD image references on a product row |
| `_set_dev_admin_password.php` | Set a known local password on the admin account |
| `_set_test_password.php` | Set a known local password on a test user |
| `_seed_qa_measurements.php` | Give user #1 the 5-core body measurements the try-on flow needs |

`_set_*` and `_seed_*` write to the local database — do not point them at production.

## Password reset

The reset-flow suite lives one level up, next to the app it exercises:

```bash
cd hiraya-backend
php verify-reset.php            # all suites
php verify-reset.php token      # one suite: token | templates | flow | mail
```

Exit code 0 only if every suite passes, so it can gate a deploy.
