<?php
use App\Http\Controllers\SupabaseStorageController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

/*
 * SUPABASE STORAGE, SERVED FROM THIS ORIGIN.
 *
 * The SPA asks for `/supabase-storage/storage/v1/object/public/products/<file>`
 * (see hiraya-frontend/src/utils/imageHelper.js). A same-origin subresource is
 * exempt from the document's `Cross-Origin-Embedder-Policy: require-corp`, which
 * Supabase's own host is NOT exempt from — it sends no `Cross-Origin-Resource-Policy`
 * on a plain image request, so the browser blocked every catalog image with
 * `net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep`.
 *
 * DELIBERATELY OUTSIDE THE `api` PREFIX, and unauthenticated:
 *   - `<img src>` cannot send an auth header or a cookie on a cross-origin or
 *     signed-out request, so a guarded route would break exactly the images it is
 *     meant to fix;
 *   - the objects are already world-readable (that is what a public bucket is), so
 *     there is no secret to protect. The controller enforces its own bucket and
 *     content-type allowlist, because "public bucket" must not become "proxies
 *     every path under /storage/v1/".
 *
 * This route is the FALLBACK for hosts where the front-end web server does not
 * claim the prefix itself. In development Vite's dev-server proxy answers it —
 * meaning zero PHP — and in production the Alias added to public/.htaccess routes
 * it here. See the controller for the full reasoning and the alternative setups.
 */
Route::get('/supabase-storage/{path?}', SupabaseStorageController::class)
    ->where('path', '.*')
    ->withoutMiddleware('web')
    ->name('supabase.storage');
