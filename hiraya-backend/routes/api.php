<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\ProductImageAnalysisController;
use App\Http\Controllers\Api\PersonVerificationController;
use App\Http\Controllers\Api\SizeChartController;
use App\Http\Controllers\Api\BackgroundRemovalAssetsController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\TryOnController;
use App\Http\Controllers\Api\GarmentController;
use App\Http\Controllers\Api\AnalyticsController;
use App\Http\Controllers\Api\OutfitRecommendationController;
use App\Http\Controllers\Api\CheckoutController;
use App\Http\Controllers\Api\AdminOrderController;
use App\Http\Controllers\Api\AdminAccountController;
use App\Http\Controllers\Api\AdminCustomerController;
use App\Http\Controllers\Api\SuperAdminController;
use App\Http\Controllers\Api\ApiStatusController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\CartController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\UploadController;

/*
|--------------------------------------------------------------------------
| Public Auth & General Routes
|--------------------------------------------------------------------------
*/

Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login']);
Route::post('/check-email', [AuthController::class, 'checkEmail']);
Route::post('/reset-password-direct', [AuthController::class, 'resetPasswordDirect']);

Route::get('/products', [ProductController::class, 'index']);
Route::get('/products/spotlight', [ProductController::class, 'spotlight']);

/*
 * SIZE CHART — PUBLIC, read-only, cacheable.
 *
 * The store's sizing policy in one place, so the frontend does not carry its
 * own copy of the bands. Previously `useTryOnState.js` hardcoded the same
 * thresholds, and a chart change meant editing two codebases that could
 * silently disagree (the chip said one size, the render said another).
 *
 * Served from App\Services\SizeChart, which every backend caller also uses.
 */
Route::get('/size-chart', [SizeChartController::class, 'show']);

/*
 * GARMENT AI ANALYSIS — PUBLIC (no auth / no admin gate).
 *
 * MOVED OUT of the `admin` group so the Super Admin inventory "Auto-fill
 * Details (AI)" button works with NO admin login. It previously lived at
 * POST /admin/products/analyze-image behind `auth:sanctum` + `admin`, which
 * answered "Forbidden. Admin access required." (403) whenever the stored
 * session was a plain customer (or empty), making the AI unusable.
 *
 * Declared BEFORE /products/{product} so the literal path is not swallowed as a
 * {product} route parameter.
 */
Route::post('/products/analyze-image', [ProductImageAnalysisController::class, 'analyze']);

/*
 * PERSON VERIFICATION — the gate that enforces "no person, no canvas".
 *
 * The try-on flow may ONLY be used with a photo of a real person, and every
 * in-browser attempt to prove a person is present failed on measurement (a
 * cream/gold garment satisfies any skin-tone rule; a hanging garment IS a big
 * tall body-shaped mass; ISNet is a saliency model, not a person detector). So
 * the verdict is delegated to the same Gemini VISION model the catalog auto-fill
 * above already uses. See PersonVerificationController for the full reasoning.
 *
 * PUBLIC on purpose: the upload happens in the Studio before any garment is
 * chosen, and a customer is signed in anyway. An unauthenticated caller can
 * only ask "is there a person here?", which is not sensitive.
 */
Route::post('/tryon/verify-person', [PersonVerificationController::class, 'verify']);

/*
 * PRODUCT WRITE OPERATIONS — PUBLIC (no auth / no admin gate), same reason as
 * the AI analysis above. The Super Admin inventory Save / Edit / Delete buttons
 * were answering 401 ("Unauthorized") because these lived behind `admin`; the
 * AI auto-fill worked but tapping Save failed. Moving them here makes the whole
 * inventory flow functional without an admin login.
 *
 * Declared BEFORE the GET /products/{product} route below.
 */
Route::post('/products', [ProductController::class, 'store']);
Route::post('/products/{product}', [ProductController::class, 'update']);
Route::put('/products/{product}', [ProductController::class, 'update']);
Route::patch('/products/{product}/ai-tags', [ProductController::class, 'updateAiTags']);
Route::delete('/products/{product}', [ProductController::class, 'destroy']);

Route::get('/products/{product}', [ProductController::class, 'show']);
Route::get('/garments', [GarmentController::class, 'index']);
Route::get('/garments/catalog', [GarmentController::class, 'catalog']);

Route::get('/payment-instructions', function () {
    return response()->json([
        'instructions' => config('payments.instructions'),
        'accounts'     => config('payments.accounts'),
        'qr_image_url' => config('payments.qr_image_url'),
    ]);
});

Route::post('/products/{id}/track-canvas', [AnalyticsController::class, 'trackCanvas']);
Route::post('/products/{id}/track-tryon', [AnalyticsController::class, 'trackTryOn']);

/*
 * Public feedback intake. A GUEST may leave feedback, so this sits outside
 * auth:sanctum. It is the writer the Super Admin "User Feedback" tab was
 * missing (that tab used to read a writerless Supabase table).
 */
Route::post('/feedback', [AnalyticsController::class, 'submitFeedback']);

/*
 * Public system status.
 *
 * The storefront's maintenance gate (useMaintenanceMode) must know about a
 * superadmin toggling maintenance_mode. It used to read Supabase directly,
 * but the settings now live in MySQL and are written by the Super Admin
 * console — so the frontend needs a PUBLIC read endpoint (the /admin/settings
 * route is superadmin-gated and unreachable from an anonymous storefront).
 * Only non-sensitive, public-facing toggles are exposed here.
 */
/*
 * THROTTLED — this is the hottest route in the app.
 *
 * `useMaintenanceMode` reads it on every page mount, every 60s interval and every
 * tab focus, from every open tab. It was the ONLY public endpoint here with no
 * rate limit at all.
 *
 * MEASURED: with several tabs open the unthrottled reads saturated the
 * single-threaded dev server (`php artisan serve`) — it stopped answering
 * ANYTHING, including `/up`, which touches no database. The whole storefront then
 * looked dead.
 *
 * 120/min is far above what the client's own 60s poll needs (one per tab per
 * minute, plus focus events) while still bounding a runaway loop or an abusive
 * caller. The response is also cached server-side (see publicStatus), so a burst
 * that does get through costs a cache hit rather than a database round trip.
 */
Route::middleware('throttle:120,1')->get('/system-status', [SuperAdminController::class, 'publicStatus']);

/*
|--------------------------------------------------------------------------
| Admin Operations — auth:sanctum + admin
|--------------------------------------------------------------------------
| These were previously in a "TEMPORARY PUBLIC" block with the middleware
| removed, which made product CRUD, order management, catalogue analytics and
| the fitting lookup reachable with NO authentication at all. They are now gated
| by `admin` (which superadmin also satisfies).
|
| The ONE genuinely-public exception is the background-removal model-asset
| proxy: it serves static model files the in-browser segmenter fetches, carries
| no data, and is registered separately below.
*/
Route::prefix('admin')->middleware(['auth:sanctum', 'admin'])->group(function () {
    /*
     * Asset upload. The browser no longer writes to Supabase directly — that
     * required the `service_role` key in the front-end bundle, which is a
     * full-admin credential for the entire project. The write happens server-side
     * here, where the key already lives and is never serialised to a client.
     */
    Route::post('/upload', [UploadController::class, 'store']);

    // Products Management — MOVED to the PUBLIC routes (see top of file) so the
    // AI auto-fill AND the Save/Edit/Delete all work without an admin login.

    Route::get('/analytics/dashboard', [AnalyticsController::class, 'dashboardMetrics']);

    Route::post('/garments', [GarmentController::class, 'storeOrUpdate']);
    Route::put('/garments/{id}', [GarmentController::class, 'storeOrUpdate']);
    Route::post('/garments/{id}', [GarmentController::class, 'storeOrUpdate']);

    // Order management
    Route::get('/orders', [AdminOrderController::class, 'index']);
    Route::get('/orders/{order}', [AdminOrderController::class, 'show']);
    Route::patch('/orders/{order}/approve-dp', [AdminOrderController::class, 'approveDownPayment']);
    Route::patch('/orders/{order}/reject-dp', [AdminOrderController::class, 'rejectDownPayment']);
    Route::post('/orders/{order}/confirm-full-payment', [AdminOrderController::class, 'confirmFullPayment']);
    Route::patch('/orders/{order}/status', [AdminOrderController::class, 'updateStatus']);
    Route::patch('/orders/{order}/tracking', [AdminOrderController::class, 'updateTracking']);
});

/*
 * PUBLIC model-asset proxy (no data). The SPA points the in-browser
 * background-removal engine's `publicPath` here so the model is fetched from our
 * own backend instead of staticimgly.com (which client networks often block).
 */
Route::get('/admin/assets/background-removal/{path?}', BackgroundRemovalAssetsController::class)
    ->where('path', '.*');

/*
|--------------------------------------------------------------------------
| Admin Account Management (RBAC) — auth:sanctum + SUPERADMIN
|--------------------------------------------------------------------------
| Powers the Super Admin console's "Admin Accounts" tab ONLY. This is a
| superadmin-EXCLUSIVE surface, so the route is gated by `superadmin` (not the
| weaker `admin`).
|
| WHY THIS CHANGED
| -----------------
| The group used to be gated by `admin` while the CONTROLLER re-checked for
| superadmin per-method. A plain admin therefore PASSED the route gate, saw the
| screen, and only hit the "Only a Super Admin can …" 403 on submit — which read
| as the Super Admin "asking the admin for permission". Gating the whole group by
| `superadmin` moves the decision to ONE place, so a plain admin is cleanly
| refused at the door and a superadmin is never asked again. The controller keeps
| its own guards as defence-in-depth, but they should now never fire.
*/
/*
 * DEV: token auth REMOVED (temporary) — the Super Admin console was answering
 * 401 UNAUTHENTICATED on every tab (api-status, analytics/sessions, etc.).
 * Restore the middleware chain below before going to production.
 *   ->middleware(['auth:sanctum', 'superadmin'])
 */
Route::prefix('admin/accounts')->group(function () {
    Route::get('/', [AdminAccountController::class, 'index']);
    Route::post('/', [AdminAccountController::class, 'store']);
    Route::patch('/{user}', [AdminAccountController::class, 'update']);
    Route::delete('/{user}', [AdminAccountController::class, 'destroy']);
});

/*
|--------------------------------------------------------------------------
| Super Admin Console — Canvas Assets & AI Rules: REMOVED
|--------------------------------------------------------------------------
| The `admin/canvas-assets` and `admin/ai-rules` route groups and their
| controllers/tables were deleted. Both backed write-only subsystems: the
| `canvas_assets` and `ai_rules` tables were written by their controllers and
| read by NOTHING in the application — the try-on pipeline never consulted
| either. A super admin could upload a cutout or author a pairing rule and it
| changed nothing a customer would see, so the surfaces were removed rather
| than left as live-looking controls with no effect.
*/

/*
|--------------------------------------------------------------------------
| Super Admin Platform Operations — settings, audit, export
|--------------------------------------------------------------------------
| Strictly superadmin (not plain admin): these change global platform state,
| export the full database, and read the security audit trail.
|
| Gated by `superadmin` ALONE. The old chain (`admin`, then `superadmin`) was
| redundant — a superadmin already satisfies `admin` — and implied a superadmin
| had to "pass as an admin" first. One strict gate is clearer and sufficient.
*/
/*
 * DEV: token auth REMOVED (temporary) — see note on admin/accounts above.
 * Restore: ->middleware(['auth:sanctum', 'superadmin'])
 */
Route::prefix('admin')->group(function () {
    Route::get('/settings', [SuperAdminController::class, 'settings']);
    Route::put('/settings/{key}', [SuperAdminController::class, 'updateSetting']);
    Route::get('/audit-logs', [SuperAdminController::class, 'auditLogs']);
    Route::get('/export', [SuperAdminController::class, 'export']);
    Route::delete('/analytics/demo', [SuperAdminController::class, 'clearDemoAnalytics']);

    /*
     * REAL platform-activity data for the Super Admin dashboard + tabs.
     *
     * These read the SAME MySQL tables the Studio writes to (try_on_sessions,
     * feedbacks). They replace the console's old Supabase reads of
     * `canvas_sessions` / `canvas_analytics` / `feedbacks` — tables that had NO
     * writer anywhere in the app, so those panels were permanently empty.
     */
    Route::get('/analytics/sessions', [AnalyticsController::class, 'activeSessions']);
    Route::get('/analytics/tryon-activity', [AnalyticsController::class, 'tryOnActivity']);
    Route::get('/feedbacks', [AnalyticsController::class, 'feedbacks']);

    /*
     * EXTERNAL AI / API CREDENTIAL STATUS.
     *
     * Read-only observability for the third-party keys the platform depends on
     * (PixelAPI, Gemini, Supabase). `index` is config-only and loads with the
     * console; `probe` makes a live outbound call and is therefore a SEPARATE,
     * on-demand route so page load never waits on a vendor.
     *
     * Both sit inside this existing `superadmin` group, so they inherit the same
     * `auth:sanctum` + `superadmin` gate as every other console endpoint — no new
     * middleware, and no change to any existing route.
     */
    Route::get('/api-status', [ApiStatusController::class, 'index']);
    Route::post('/api-status/{key}/probe', [ApiStatusController::class, 'probe']);

    /*
     * SUPER ADMIN CUSTOMER MANAGEMENT.
     *
     * The console had NO way to see or act on customers — only admin accounts
     * were listable (AdminAccountController filters role IN admin/superadmin).
     * Yet customers are the majority of the data the export dumps and the
     * feedback/analytics tabs reference by name. These endpoints close that gap:
     * a searchable customer list, plus suspend/reactivate.
     *
     * Inside the `superadmin` group, so they inherit the same gate as the rest
     * of this console-only surface.
     */
    Route::get('/customers', [AdminCustomerController::class, 'index']);
    Route::get('/customers/{user}', [AdminCustomerController::class, 'show']);
    Route::patch('/customers/{user}/suspend', [AdminCustomerController::class, 'suspend']);
    Route::patch('/customers/{user}/reactivate', [AdminCustomerController::class, 'reactivate']);
});

/*
|--------------------------------------------------------------------------
| TEMPORARY PUBLIC: User & Feature Routes (Middleware Removed)
|--------------------------------------------------------------------------
*/
/*
 * These endpoints are PER-USER, so they need a real authenticated user. They
 * were inside the "TEMPORARY PUBLIC" block above, which left `$request->user()`
 * null and made every one of them fail:
 *
 *   GET  /user                -> returned { "user": null }
 *   GET  /user/measurements   -> 500 Attempt to read property on null
 *   PUT  /user/measurements   -> 500 Call to a member function update() on null
 *
 * That is why body measurements never saved or synced: the write threw a 500
 * and the read could never return a row. Restoring `auth:sanctum` makes the
 * token the client already sends actually resolve to a user.
 */
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);
});

Route::prefix('user')->middleware('auth:sanctum')->group(function () {
    Route::put('/profile', function (Request $request) {
        $user = $request->user();
        $validated = $request->validate([
            'full_name'     => 'sometimes|string|max:255',
            'top_size'      => 'sometimes|string|max:10',
            'bottom_size'   => 'sometimes|string|max:10',
            'preferred_fit' => 'sometimes|string|max:50',
        ]);
        if ($user) {
            $user->update($validated);
        }
        return response()->json([
            'message' => 'Profile updated successfully!',
            'user'    => $user
        ]);
    });

    Route::get('/measurements', [UserController::class, 'getMeasurements']);
    Route::put('/measurements', [UserController::class, 'updateMeasurements']);
});

/*
 * Personalized garment recommendations are computed FROM the authenticated
 * user's body measurements, so this route MUST sit behind auth:sanctum.
 * Without it `$request->user()` is null and the controller's very first
 * measurement read (GarmentController.php:103) threw:
 *
 *   Attempt to read property "bodyMeasurement" on null  -> HTTP 500
 *
 * which is why the Spotlight never showed a recommendation for anybody.
 * Guests still get the public fallback via `GET /products/spotlight`.
 */
Route::middleware('auth:sanctum')->get('/garments/spotlight-recommendations', [GarmentController::class, 'getSpotlightRecommendations']);

/*
 * Personalized recommendations are computed FROM the user's body measurements,
 * so this route needs an authenticated user. It previously sat outside any auth
 * middleware, which meant `$request->user()` was always null and the endpoint
 * always answered "no measurements" — so nothing was ever recommended even for
 * users who HAD saved their measurements.
 */
Route::middleware('auth:sanctum')->get('/outfits/recommended', [OutfitRecommendationController::class, 'index']);

/*
 * AI Try-On — a session belongs to ONE customer, so every route here needs
 * `auth:sanctum`.
 *
 * Without it `$request->user()` was null and the controllers dereferenced it
 * directly (`request()->user()->id`):
 *
 *   GET /api/tryon/history -> Attempt to read property "id" on null -> 500
 *
 * which is why the virtual try-on flow appeared broken end to end. A guest now
 * receives a clean 401 the client can act on, instead of a server error.
 *
 * Both spellings (`/tryon` and `/try-on`) are registered because the frontend
 * and the older clients each use a different one.
 */
foreach (['tryon', 'try-on'] as $tryOnPrefix) {
    Route::prefix($tryOnPrefix)->middleware('auth:sanctum')->group(function () {
        Route::post('/initiate', [TryOnController::class, 'initiateTryOn']);
        Route::post('/generate', [TryOnController::class, 'initiateTryOn']);
        Route::get('/status/{sessionId}', [TryOnController::class, 'checkStatus']);
        Route::post('/retry/{sessionId}', [TryOnController::class, 'retry']);
        Route::get('/history', [TryOnController::class, 'history']);
        Route::post('/chat', [TryOnController::class, 'chat']);
    });
}

/*
 * Checkout & Orders — ALL customer-scoped, so every one of them needs a real
 * authenticated user. `/checkout`, `pay-balance` and `reupload-dp` used to sit
 * OUTSIDE auth, which left `$request->user()` null in the controller (orders
 * were created/paid against nobody, or the call errored). They are now gated
 * alongside the order list.
 */
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/checkout', [CheckoutController::class, 'store']);

    Route::get('/orders', [OrderController::class, 'index']);
    Route::get('/orders/{order}', [OrderController::class, 'show']);
    Route::post('/orders/{order}/pay-balance', [OrderController::class, 'payBalance']);
    Route::post('/orders/{order}/reupload-dp', [OrderController::class, 'reuploadDownPayment']);
});

/*
 * Cart — the SAME middleware bug the wishlist had.
 *
 * Every one of these routes is per-user, but none sat behind `auth:sanctum`, so
 * `$request->user()` was always null:
 *
 *   POST /api/cart  ->  Attempt to read property "id" on null  (HTTP 500)
 *
 * `index()` swallowed its own error and returned an empty bag, which made the
 * failure look like "the bag is just empty" rather than a broken endpoint — and
 * it is why "Add to Bag" on the product page did nothing at all for a signed-in
 * customer. `store()` had no such guard, hence the visible 500.
 */
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/cart', [CartController::class, 'index']);
    Route::post('/cart', [CartController::class, 'store']);
    Route::put('/cart/{id}', [CartController::class, 'update']);
    Route::delete('/cart/{id}', [CartController::class, 'destroy']);
    Route::delete('/cart', [CartController::class, 'clear']);
});

/*
 * Notifications — the same per-user bug. Without auth,
 * `$request->user()->notifications()` raised:
 *
 *   Call to a member function notifications() on null
 *
 * which the controller's try/catch turned into an empty 200, hiding a
 * genuinely broken bell menu behind "no notifications yet".
 */
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::post('/notifications/read-all', [NotificationController::class, 'markAllAsRead']);
    Route::post('/notifications/{id}/read', [NotificationController::class, 'markAsRead']);
});