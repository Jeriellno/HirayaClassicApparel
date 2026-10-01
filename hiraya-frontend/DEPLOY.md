# DEPLOYMENT — SINGLE DOMAIN
# =========================
#
# The console and the storefront are TWO BUILDS served from ONE domain. There is
# no subdomain, and there is no port in production.
#
#     hiraya.com/                -> dist/
#     hiraya.com/superadmin      -> dist-console/
#
# Why two builds if they are both on the same domain? Because they must not be
# downloadable from each other. The console bundle is emitted to its own
# directory so that deploying the shop does not publish the admin UI as a static
# asset anyone can fetch and read.
#
#
# 1. BUILD
# --------
#
# Two commands, two output folders:
#
#     npm run build            -> dist/
#     npm run build:console    -> dist-console/
#
# `dist/` is the storefront. `dist-console/` is the console. Both are complete
# SPAs with their own index.html.
#
#
# 2. FOLDER LAYOUT ON THE SERVER
# ------------------------------
#
# Put the two builds in SEPARATE folders, side by side:
#
#     /var/www/hiraya/
#         ├── shop/        <- contents of dist/
#         └── console/     <- contents of dist-console/
#
# Then point the document root at `shop/`, and add an alias for the console.
#
#
# 3. APACHE
# ---------
#
# In the VirtualHost for hiraya.com:
#
#     DocumentRoot /var/www/hiraya/shop
#
#     # The console SPA. The alias maps /superadmin onto the console build so
#     # the shop's document root stays the only one.
#     Alias /superadmin /var/www/hiraya/console
#
#     <Directory /var/www/hiraya/shop>
#         Options -Indexes +FollowSymLinks
#         AllowOverride All
#         Require all granted
#     </Directory>
#
#     <Directory /var/www/hiraya/console>
#         Options -Indexes +FollowSymLinks
#         AllowOverride All
#         Require all granted
#     </Directory>
#
# Add a rewrite rule so client-side routes inside each SPA resolve to its own
# index.html. WITHOUT this, refreshing on /superadmin gives a 404 — the browser
# asks the server for a file that does not exist, because the app is an SPA and
# has no such route on disk.
#
#     <IfModule mod_rewrite.c>
#         RewriteEngine On
#
#         # Console first — it must be matched before the SPA catch-all.
#         RewriteCond %{REQUEST_URI} ^/superadmin
#         RewriteCond %{REQUEST_FILENAME} !-f
#         RewriteRule ^/superadmin(/.*)?$ /superadmin/index.html [L]
#
#         # Everything else is the storefront SPA.
#         RewriteCond %{REQUEST_FILENAME} !-f
#         RewriteCond %{REQUEST_FILENAME} !-d
#         RewriteRule . /index.html [L]
#     </IfModule>
#
#
# 4. NGINX (if that is what you are on)
# -------------------------------------
#
#     root /var/www/hiraya/shop;
#     index index.html;
#
#     location /superadmin {
#         alias /var/www/hiraya/console;
#         try_files $uri $uri/ /console/index.html;
#     }
#
#     location / {
#         try_files $uri $uri/ /index.html;
#     }
#
#
# 5. THE BACKEND STAYS WHERE IT IS
# --------------------------------
#
# The Laravel API does not move. It is a separate origin (or at least a separate
# path) reached by the frontend's `VITE_API_BASE_URL`:
#
#     https://hiraya.com/api/
#
# Sanctum must be told which domains may send an authenticated request, or
# every API call from the storefront will be refused as a CORS failure.
#
# In `config/cors.php` (Laravel 11) or `config/sanctum.php`:
#
#     'supports_credentials' => true,
#     'allowed_origins' => ['https://hiraya.com', 'https://www.hiraya.com'],
#
# This is the single most common reason a first production deploy "works
# everywhere except the admin login": the browser strips the Authorization
# header on a cross-origin request the server did not explicitly allow.
#
#
# 6. THE PORT SPLIT IS DEV-ONLY, AND COMPILES OUT
# -----------------------------------------------
#
# The console dev server on port 5174 exists so the two apps have separate
# browser origins while you work. It is gated on `import.meta.env.DEV`, which
# Vite replaces with the literal `false` in a production build — so the check is
# not merely skipped at runtime, it is not in the shipped JavaScript at all.
#
# In production the console is simply the `/superadmin` route, reached the same
# way it always was, and the only thing gating it is the backend middleware.
#
#
# 7. WHAT IS AND IS NOT PROTECTED
# -------------------------------
#
# Worth being precise about, because it is easy to overstate:
#
#   PROTECTED — every console endpoint is behind `auth:sanctum` + `superadmin`
#              middleware (32 of 32 routes), and the superadmin's sign-in also
#              requires a TOTP code. `verify_security.php` asserts all of it.
#
#   NOT PROTECTED — the console is on the same origin as the shop, so a genuine
#              XSS in the storefront would run with the superadmin's session
#              available. A subdomain would fix that. For a one-to-three-person
#              operation it is a reasonable trade, and it should be described
#              accurately rather than claimed as more than it is.
#
#
# 8. CHECKLIST BEFORE GOING LIVE
# -------------------------------
#
#   [ ] `npm run build` and `npm run build:console` both complete
#   [ ] The two output folders are deployed to SEPARATE directories
#   [ ] The document root points at the storefront only
#   [ ] The rewrite rules are in place (refresh on /superadmin must not 404)
#   [ ] `VITE_API_BASE_URL` in the production env points at the real API
#   [ ] CORS allows the production domain, with credentials
#   [ ] `APP_ENV=production` and `APP_DEBUG=false`
#   [ ] A real superadmin exists: `php artisan hiraya:make-superadmin`
#   [ ] That account has an authenticator app enrolled
#   [ ] The seeded `superadmin@hiraya.com` and `admin@hiraya.com` are GONE
#   [ ] `grep -r "BYPASS_ADMIN_AUTH" src/` shows `false`
#   [ ] The Supabase service_role key is not in the frontend bundle
#
