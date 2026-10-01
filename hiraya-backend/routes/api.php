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
use App\Http\Controllers\Api\AnalyticsController;
use App\Http\Controllers\Api\OutfitRecommendationController;
use App\Http\Controllers\Api\CheckoutController;
use App\Http\Controllers\Api\AdminOrderController;
use App\Http\Controllers\Api\AdminStockMovementController;
use App\Http\Controllers\Api\AdminAccountController;
use App\Http\Controllers\Api\AdminCustomerController;
use App\Http\Controllers\Api\SuperAdminController;
use App\Http\Controllers\Api\ApiCredentialController;
use App\Http\Controllers\Api\ApiStatusController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\CartController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\UploadController;
use App\Http\Controllers\Api\ProductReviewController;

/*
|--------------------------------------------------------------------------
| Public Auth & General Routes
|--------------------------------------------------------------------------
*/

/*
 * REGISTER + LOGIN — THROTTLED, BECAUSE THEY WERE COMPLETELY OPEN.
 *
 * Every other auth route below already carried a limit; these two did not, and
 * that made them the weakest point in the whole flow. Measured before the fix:
 * twelve consecutive wrong-password calls to POST /api/login returned
 * `401, 401, 401, ...` — twelve attempts, zero objection.
 *
 * WHY LOGIN GETS 10 AND NOT 5
 * ---------------------------
 * /login is now a SINGLE-step customer sign-in. It used to serve both halves of
 * a two-factor exchange, which is why it needed headroom for a password plus
 * several authenticator retries; that exchange now happens entirely inside
 * Supabase (see AdminSignIn.jsx) and never touches this route.
 *
 * A human mistypes a password, maybe twice. 10 per minute is generous for that
 * and still caps an automated guessing run at ten attempts. If the staff
 * console ever comes back through this endpoint, this number must be revisited
 * — it is sized for one field, not for a password plus a TOTP.
 *
 * Both limits key on IP. Behind a proxy this would key on the proxy instead, but
 * that is a deployment concern (see trustProxies), not a reason to ship no limit
 * at all.
 */
Route::post('/register', [AuthController::class, 'register'])
    ->middleware('throttle:5,1');
Route::post('/login', [AuthController::class, 'login'])
    ->middleware('throttle:10,1');
Route::post('/check-email', [AuthController::class, 'checkEmail'])
    ->middleware('throttle:20,1');

/*
 * PASSWORD RESET — three steps, all PUBLIC (the customer is locked out by
 * definition, so none of these can require a session).
 *
 *   forgot-password       issue + email a link
 *   validate-reset-token  is that link still usable? (asked before submitting)
 *   reset-password-direct consume the token and set the new password
 *
 * All three are throttled. Without a limit, `forgot-password` is a free way to
 * use this server as a mail bomb against any address, and the other two are free
 * guesses at a token. The limits are generous enough for a real human who
 * mistypes and retries, and tight enough to make automation pointless.
 */
Route::post('/forgot-password', [AuthController::class, 'forgotPassword'])
    ->middleware('throttle:5,1');
Route::post('/validate-reset-token', [AuthController::class, 'validateResetToken'])
    ->middleware('throttle:20,1');
Route::post('/reset-password-direct', [AuthController::class, 'resetPasswordDirect'])
    ->middleware('throttle:10,1');

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
/*
 * NOW STAFF-ONLY. The same reasoning as the product writes below applies: an
 * open endpoint let anyone on the internet spend the store's Gemini quota with
 * arbitrary images. The console already holds the aal2 staff session that the
 * Save button needs, so the Auto-fill button carries it too. Rate-limited so a
 * stuck retry loop cannot burn through the key.
 */
Route::middleware(['supabase.aal2', 'supabase.user', 'admin', 'throttle:30,1'])
    ->post('/products/analyze-image', [ProductImageAnalysisController::class, 'analyze']);

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
Route::middleware('throttle:20,1')->post('/tryon/verify-person', [PersonVerificationController::class, 'verify']);

/*
 * PRODUCT WRITE OPERATIONS — MOVED BACK BEHIND THE `admin` GATE.
 *
 * These used to sit here, PUBLIC, and the comment said why: the Super Admin
 * inventory Save/Edit/Delete buttons were answering 401 because they lived
 * behind `admin`, and "moving them here makes the whole inventory flow
 * functional without an admin login".
 *
 * That was a workaround for a broken session, and it cost the product its
 * security boundary. Rule 9 of the role model is explicit: authorization is
 * enforced in the BACKEND, and these routes are exactly the writes a limited
 * admin's two sections cover. Leaving them public meant ANYONE who could reach
 * the host could create, edit or DELETE catalogue products — a limited admin
 * (orders + inventory) could not, and neither could a customer, but an anonymous
 * caller could.
 *
 * WHY THE 401 CAME BACK, AND WHY IT WAS A SYMPTOM
 * The 401 was not a reason to open a door. It was the correct answer from a
 * correctly-locked route to a request carrying no valid session — the real fault
 * was upstream, in the session the console sends. The fix for a bad credential
 * is to repair the credential, not to delete the lock. A console that can save
 * its inventory only by removing authentication is not a working console, it is
 * an open one.
 *
 * Declared BEFORE the GET /products/{product} route below, exactly as before —
 * the only change is the middleware, and the reads above it are unaffected.
 */
Route::middleware(['supabase.aal2', 'supabase.user', 'admin'])
    ->group(function () {
        Route::post('/products', [ProductController::class, 'store']);
        Route::post('/products/{product}', [ProductController::class, 'update']);
        Route::put('/products/{product}', [ProductController::class, 'update']);
        Route::patch('/products/{product}/ai-tags', [ProductController::class, 'updateAiTags']);
        Route::delete('/products/{product}', [ProductController::class, 'destroy']);
    });

Route::get('/products/{product}', [ProductController::class, 'show']);
// Public, read-only: the reviews shown on a product's detail page.
Route::get('/products/{product}/reviews', [ProductReviewController::class, 'forProduct']);

Route::get('/payment-instructions', function () {
    return response()->json([
        'instructions' => config('payments.instructions'),
        'accounts'     => config('payments.accounts'),
        'qr_image_url' => config('payments.qr_image_url'),
    ]);
});

Route::middleware('throttle:60,1')->group(function () {
    Route::post('/products/{id}/track-canvas', [AnalyticsController::class, 'trackCanvas']);
    Route::post('/products/{id}/track-tryon', [AnalyticsController::class, 'trackTryOn']);
});

/*
 * Feedback intake — SIGNED-IN ACCOUNTS ONLY.
 *
 * It used to be public so a guest could type any name, which filled the Super
 * Admin "User Feedback" tab with unverifiable "Anonymous Visitor" rows. Worse,
 * outside auth:sanctum `$request->user()` was always null, so even a signed-in
 * customer's email was never recorded. Gating it means every message carries
 * the sender's real account name and email.
 */
Route::middleware('auth:sanctum')->post('/feedback', [AnalyticsController::class, 'submitFeedback']);

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
 * ADMIN INVITATION — REDEMPTION IS PUBLIC, AND THE TOKEN IS THE CREDENTIAL.
 * =========================================================================
 * The invitee has no account yet, so there is no session to authenticate with.
 * The signed, single-use, expiring token in the emailed link IS the proof of
 * identity, exactly as it is for a password reset — and it is the reason the
 * signature covers the address and the expiry rather than being a lookup key.
 *
 * THROTTLED, because these are unauthenticated endpoints that take an address
 * and a token: `accept` creates a real account and a real GoTrue identity on
 * success, so an unlimited caller could probe addresses or mass-create
 * identities. 10/min is far above what a human clicking a link can need.
 *
 * WHAT A STOLEN LINK CAN AND CANNOT DO
 * ------------------------------------
 * Can: set a password on the address it names, and enrol an authenticator.
 * Cannot: reach the console. An account created this way stays INACTIVE —
 * `mfa_enrolled_at` is null — and `ResolveSupabaseUser` refuses every console
 * route until the holder of the account completes a TOTP challenge. So a leaked
 * link yields an account that must still pass MFA, and the superadmin can see
 * it sitting unenrolled in the Admin Accounts table and revoke it.
 */
Route::middleware('throttle:10,1')->group(function () {
    Route::post('/invitations/accept', [AdminAccountController::class, 'acceptInvitation']);
    Route::get('/invitations/status', [AdminAccountController::class, 'inspectInvitation']);
});

/*
 * Admin + Superadmin operations — NOW LOCKED (this comment previously said the
 * opposite, and the code said it too).
 *
 * THIS USED TO BE PUBLIC. No sign-in gate, no session token, no role check,
 * no second factor: `/admin` and `/superadmin` rendered the panel and
 * everything it called answered for anyone who asked. Anyone who could reach
 * the host could read every order and customer, edit the catalogue, and call
 * `/admin/export` to dump the entire database. The rationale was a capstone
 * demonstration where the panel has to open for a grader with no credentials —
 * a real trade-off, and the wrong one for a system that holds customer data.
 * It is closed now.
 *
 * THE CHAIN, AND WHY IT IS THREE MIDDLEWARES IN THIS ORDER
 *
 *   supabase.aal2   the session passed a TOTP challenge    (Supabase JWT)
 *   supabase.user   that token maps to a real Hiraya user  (users table)
 *   admin           and that user is staff                  (users.role)
 *
 * Each alone leaves a hole. `admin` without `supabase.aal2` is the old bug in
 * a smaller window: a correct password on a staff account produces a perfectly
 * valid aal1 session that sails straight through. That case is the one this
 * refactor exists to close.
 *
 * `auth:sanctum` is deliberately ABSENT and its absence is not an oversight.
 * The console sends a Supabase JWT rather than a Sanctum token, because `aal`
 * exists only inside the Supabase-signed one; Sanctum cannot read it and would
 * answer 401 before the aal2 gate ever ran. `supabase.user` does that join.
 *
 * ORDER IS LOAD-BEARING. `supabase.aal2` must run BEFORE `supabase.user`:
 * the resolver trusts the email claim that aal2 has just proven, so swapping
 * them would let a forged unsigned JWT name the superadmin's address and be
 * resolved into that user before anything checked the signature.
 *
 * The storefront's own customer data — `/checkout`, `/orders`, the try-on
 * pipeline — is unchanged and still behind `auth:sanctum`, because those are
 * tied to `$request->user()->id` from a Sanctum session and are not the console.
 */
Route::middleware(['supabase.aal2', 'supabase.user', 'admin'])
    ->prefix('admin')
    ->group(function () {
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
    Route::get('/stock-adjustments', [AdminStockMovementController::class, 'index']);


    // Order management
    Route::get('/orders', [AdminOrderController::class, 'index']);
    Route::get('/orders/{order}', [AdminOrderController::class, 'show']);
    Route::get('/orders/{order}/proof/{type}', [AdminOrderController::class, 'proof'])
        ->whereIn('type', ['dp', 'balance']);
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
 | AUTHENTICATOR-APP TWO FACTOR — REMOVED
 |--------------------------------------------------------------------------
 | `/api/two-factor/{status,start,confirm,disable,recover}` and the
 | `TwoFactorController` that served them are GONE, together with `TotpService`,
 | the `UserTwoFactor` model and the `user_two_factors` table.
 |
 | They were a self-contained second factor: a secret generated locally, a TOTP
 | computed locally, a challenge string cached under `login:2fa:*`, and recovery
 | codes hashed into the project's own table. All of it is replaced by Supabase's
 | built-in MFA, where the TOTP secret, the challenge, the code verification and
 | the `aal` claim are owned by the identity provider.
 |
 | THE MIGRATION'S ONE REAL TRADE-OFF, STATED PLAINLY
 | Supabase MFA has no recovery-code feature. The old flow issued ten hashed
 | recovery codes precisely so a lost phone was not a lost account, and that
 | escape hatch does not exist on the other side. The replacement is the
 | `php artisan hiraya:reset-mfa <email>` command below, which requires server
 | access. That is strictly worse for a user and strictly better for an
 | attacker: recovery codes can be phished, shared over chat, or used by whoever
 | finds them in a drawer, whereas a CLI command needs the machine.
 |
 | Nothing on the storefront ever called these routes, so no customer-facing
 | behaviour changes. The console settings screen is now MfaEnrollment.jsx.
*/

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
 * Admin Account Management (RBAC) — SUPERADMIN-ONLY.
 *
 * THIS GROUP IS NOT PUBLIC. It was previously described here as "PUBLIC, NO
 * AUTHENTICATION ... reachable without a session by design", which was wrong on
 * the facts and dangerous as documentation: this is the most sensitive group in
 * the application — it provisions, promotes and revokes staff accounts — and the
 * comment invited the next reader to treat an open door as intentional.
 *
 * The `superadmin` middleware below is the real gate. The controller keeps its
 * own per-method `isSuperAdmin()` guards as defence-in-depth.
 *
 * The ONE remaining relaxation is an opt-in development bypass inside the
 * controllers (`devAuthBypass()`), which is off unless `ALLOW_DEV_AUTH_BYPASS` is
 * deliberately set to true and is refused outright in production. It exists so
 * the console can be developed without a live Supabase session, and it is the
 * only reason a caller without a token can reach any route in this group.
 */
Route::middleware(['supabase.aal2', 'supabase.user', 'superadmin'])
    ->prefix('admin/accounts')
    ->group(function () {
    Route::get('/', [AdminAccountController::class, 'index']);

    /*
     * THE INVITATION IS CREATED HERE, AND NOTHING ELSE IS.
     *
     * `store` is gone: an account is no longer created by the superadmin typing
     * a password. The invitee creates it by redeeming a link (see the public
     * /invitations group), so the superadmin never holds a credential that
     * belongs to someone else.
     */
    Route::post('/invite', [AdminAccountController::class, 'invite']);

    /*
     * RE-ISSUE A PENDING INVITATION.
     *
     * The link is shown exactly once, in the modal that created it, so a
     * superadmin who loses it could otherwise only wait out the 48-hour TTL —
     * `invite()` refuses an address that is already invited (a second link would
     * destroy the single-use property). This is the deliberate way through, and it
     * refuses any account that has already finished enrolling.
     */
    Route::post('/{user}/resend-invitation', [AdminAccountController::class, 'resendInvitation']);

    Route::patch('/{user}', [AdminAccountController::class, 'update']);
    Route::delete('/{user}', [AdminAccountController::class, 'destroy']);
});

/*
 * ACTIVATION — THE INVITEE MARKS THEIR OWN ACCOUNT READY.
 * =======================================================
 * Deliberately NOT under `admin/accounts`, and deliberately NOT superadmin-only:
 * the caller is the newly invited admin, who by definition holds no role the
 * superadmin group accepts yet.
 *
 * It needs the full Supabase chain — `supabase.aal2` proves a TOTP challenge was
 * passed, `supabase.user` resolves the verified email to the Laravel row — but
 * NOT `admin`, because the row this activates is still pending. Requiring
 * `admin` here would be circular: the account would have to already be usable in
 * order to prove it should become usable.
 *
 * The identity comes from the verified TOKEN, never the body, so an admin can
 * only ever activate themselves.
 */
Route::middleware(['supabase.aal2', 'supabase.user'])
    ->post('admin/accounts/mfa-enrolled', [AdminAccountController::class, 'markMfaEnrolled']);

/*
|--------------------------------------------------------------------------
| API Management Panel — credential CRUD
|--------------------------------------------------------------------------
| The WRITE side of external API key management. `GET /admin/api-status` REPORTS
| on the third-party keys; these CHANGE them, which is a different risk entirely.
|
| WHY THIS IS ITS OWN GROUP RATHER THAN A FEW LINES IN THE `/admin` GROUP
| ------------------------------------------------------------------------
| Two reasons, and the first one is a security finding, not a style preference.
|
| The surrounding `Route::prefix('admin')` group at line 349 carries NO middleware
| at all. Its own comment says so — "PUBLIC, NO AUTH. ... Both answer to anyone who
| can reach the host" — and the `admin/accounts` group above repeats the same
| decision. So that block is a deliberate, project-wide choice, and I am not
| changing it here.
|
| But these routes must not inherit it. They ACCEPT A LIVE SECRET and WRITE it to
| the database. Dropping a `POST` that stores a credential into a group with no
| auth gate would mean anyone who can reach the host can overwrite the Supabase
| service-role key and read every table in the database through it. That is a
| materially worse outcome than the export route the project already accepts, so
| these get a real gate regardless of what their neighbours do.
|
| `superadmin` alone, not `admin`: a credential can impersonate Hiraya against a
| third-party vendor, so it belongs with the audit log and the export, not with
| day-to-day catalogue work.
|
| THROTTLES ARE PER-ROUTE BECAUSE THESE ACCEPT SECRETS. An operator pasting a key
| must not be mistaken for a brute-force attempt, but an automated attacker must
| not get unlimited attempts either; the limits are loose enough for a human and
| tight enough that automation is pointless. `verify` is tighter because it makes
| an outbound call to a vendor on every hit.
*/
Route::middleware(['supabase.aal2', 'supabase.user', 'superadmin'])
    ->prefix('admin/api-credentials')
    ->group(function () {
        Route::get('/', [ApiCredentialController::class, 'index']);

        Route::post('/', [ApiCredentialController::class, 'store'])
            ->middleware('throttle:20,1');
        Route::post('/{id}/activate', [ApiCredentialController::class, 'activate'])
            ->middleware('throttle:20,1');
        Route::post('/{id}/verify', [ApiCredentialController::class, 'verify'])
            ->middleware('throttle:10,1');
        Route::delete('/{id}', [ApiCredentialController::class, 'destroy'])
            ->middleware('throttle:20,1');
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
 * Super Admin Platform Operations — settings, audit, export. PUBLIC, NO AUTH.
 *
 * `/admin/export` streams the entire database and `/admin/audit-logs` reads the
 * security trail. Both answer to anyone who can reach the host. There is no
 * middleware chain here at all, by project decision.
 */
Route::middleware(['supabase.aal2', 'supabase.user', 'superadmin'])
    ->prefix('admin')
    ->group(function () {
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
    // The four summary cards (orders, revenue, try-ons, reviews) on the dashboard.
    Route::get('/analytics/summary', [AnalyticsController::class, 'summary']);
    // Charts & Insights (revenue trend, top products, statuses, try-ons, ratings).
    Route::get('/analytics/charts', [AnalyticsController::class, 'charts']);
    // Recent try-ons/reviews + inventory, try-on and review analytics panels.
    Route::get('/analytics/overview', [AnalyticsController::class, 'overview']);
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
     * MANUAL COOLDOWN RESET (the "ligaw rotate" button).
     *
     * Clears the daily 429 cooldown on ONE pool key, identified by its MASKED
     * label. It writes no key, touches no .env — it only clears the rotation
     * cache, so a key marked 429 in error can answer again. Registered BEFORE
     * the probe route is unnecessary: Laravel matches the more specific path
     * segment count the same way, but this sits above for clarity.
     */
    Route::post('/api-status/gemini/rotate', [ApiStatusController::class, 'rotateGemini']);

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
 *   GET  /user/sizes          -> 500 Attempt to read property on null
 *   PUT  /user/sizes          -> 500 Call to a member function update() on null
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
            'preferred_fit' => 'sometimes|string|in:slim,regular,oversized',
            'gender'        => 'sometimes|nullable|string|in:male,female',
        ]);
        if ($user) {
            $user->update($validated);
        }
        return response()->json([
            'message' => 'Profile updated successfully!',
            'user'    => $user
        ]);
    });

    Route::get('/sizes', [UserController::class, 'getSizes']);
    Route::put('/sizes', [UserController::class, 'updateSizes']);
    Route::put('/password', [UserController::class, 'changePassword']);

    /*
     * Danger Zone — permanent self-service account deletion. Sits inside the
     * same auth:sanctum group so only the token owner can delete their own
     * account; the controller re-verifies the CURRENT password as proof of
     * ownership and revokes every token after deleting the row.
     */
    Route::delete('/account', [UserController::class, 'deleteAccount']);
});

/*
 * The legacy `garments` catalogue (GarmentController, /garments*) was removed:
 * `products` is the only catalogue, nothing in the SPA called those routes and
 * the tables were empty. See 2026_10_20_000003_drop_unused_legacy_tables.
 */

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
        Route::patch('/history/{sessionId}/favorite', [TryOnController::class, 'updateFavorite']);
        Route::delete('/history/{sessionId}', [TryOnController::class, 'destroyHistory']);
        Route::get('/history/{sessionId}/outfit', [TryOnController::class, 'reusableOutfit']);
        // One look in full (render + before photo), opened from the Studio's history drawer.
        Route::get('/history/{sessionId}', [TryOnController::class, 'historyDetail']);
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

/*
 * Product reviews — customer-scoped. Only the owner of a DELIVERED order can
 * review its lines; ProductReviewController enforces that (and one review per
 * order line). Throttled because the body can carry a Base64 photo.
 */
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/reviews/mine', [ProductReviewController::class, 'mine']);
    Route::post('/order-items/{orderItem}/review', [ProductReviewController::class, 'store'])
        ->middleware('throttle:20,1');
});