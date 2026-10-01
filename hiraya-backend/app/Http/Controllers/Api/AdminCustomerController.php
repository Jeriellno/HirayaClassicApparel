<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\TryOnSession;
use App\Models\User;
use App\Notifications\TryOnRestored;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Customer management for the Super Admin console's "Customers" tab.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * The console could list and act on ADMIN accounts only (AdminAccountController
 * filters `role IN admin, superadmin`). Customers — the majority of the data,
 * and the people named in the feedback and analytics tabs — were invisible.
 * A super admin could export the whole users table but not read one customer.
 *
 * ACCESS — TWO LEVELS
 * -------------------
 * READS (`index`, `show`) are open to admins AND the super admin, because
 * admins audit customer accounts. What comes back differs by role:
 *
 *   superadmin — the full record: real email, saved sizes, gender, lifetime
 *                value. The super admin owns the platform.
 *   admin      — a LIMITED record: masked email, account status, dates and
 *                order count. Enough to audit an account, not to profile a
 *                person.
 *
 * The reduction happens HERE, server-side, so hand-editing the frontend
 * cannot reveal more. Every profile a staff member opens is itself written to
 * the audit trail, so the super admin can see who looked at whom.
 *
 * WRITES (`suspend`, `reactivate`) stay superadmin-only: the route sits in the
 * superadmin group and the per-method guard below is defence-in-depth.
 *
 * SUSPENSION IS ENFORCED, NOT DECORATIVE
 * --------------------------------------
 * `suspend()` sets `suspended_at`, and AuthController::login refuses a
 * suspended account — so this changes real behaviour instead of writing a flag
 * nothing reads (the exact trap the removed Canvas Assets / AI Rules tabs fell
 * into).
 */
class AdminCustomerController extends Controller
{
    /**
     * GET /api/admin/customers
     *
     * Lists every CUSTOMER (role = 'user'), newest first, with an optional
     * `search` over name/email and a `status` filter (all|active|suspended).
     */
    public function index(Request $request)
    {
        if (!$this->isStaff($request->user()) && !$this->devAuthBypass()) {
            return response()->json(['message' => 'Only staff can view customers.'], 403);
        }

        $request->validate([
            'search' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'string', 'in:all,active,suspended'],
        ]);

        $query = User::query()->where('role', 'user');

        $search = trim((string) $request->query('search', ''));
        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('full_name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        $status = $request->query('status', 'all');
        if ($status === 'active') {
            $query->whereNull('suspended_at');
        } elseif ($status === 'suspended') {
            $query->whereNotNull('suspended_at');
        }

        $customers = $query
            ->orderByDesc('id')
            ->get([
                'id',
                'full_name',
                'email',
                'role',
                'suspended_at',
                'last_login_at',
                'created_at',
            ]);

        if (!$this->isSuperAdmin($request->user())) {
            $customers = $customers->map(fn (User $c) => [
                'id' => $c->id,
                'full_name' => $c->full_name,
                'email' => AuditLog::maskEmail($c->email),
                'role' => $c->role,
                'suspended_at' => $c->suspended_at,
                'last_login_at' => $c->last_login_at,
                'created_at' => $c->created_at,
            ]);
        }

        return response()->json($customers);
    }

    /**
     * GET /api/admin/customers/{user}
     *
     * One customer's profile: saved body measurements, order count and lifetime
     * value. This is what makes the tab useful — a super admin can see WHO a
     * customer is, not just that they exist.
     */
    public function show(Request $request, User $user)
    {
        if (!$this->isStaff($request->user()) && !$this->devAuthBypass()) {
            return response()->json(['message' => 'Only staff can view customers.'], 403);
        }

        if (strtolower((string) $user->role) !== 'user') {
            return response()->json(['message' => 'That account is not a customer.'], 404);
        }

        // Opening a profile is itself an auditable act.
        $this->writeAudit($request, 'VIEW_CUSTOMER_PROFILE', "Opened the profile of {$user->email} (#{$user->id})", $user->id);

        if (!$this->isSuperAdmin($request->user())) {
            /*
             * LIMITED VIEW. Order STATUSES are included (an admin already works
             * the orders queue), but no amounts, sizes, gender or real email.
             */
            $orders = $user->orders()->get(['id', 'payment_status', 'order_status', 'created_at']);

            return response()->json([
                'id' => $user->id,
                'full_name' => $user->full_name,
                'email' => AuditLog::maskEmail($user->email),
                'suspended_at' => $user->suspended_at,
                'last_login_at' => $user->last_login_at,
                'created_at' => $user->created_at,
                'order_count' => $orders->count(),
                'orders' => $orders,
                'limited' => true,
            ]);
        }

        $orders = $user->orders()->get(['id', 'total_amount', 'payment_status', 'order_status', 'created_at']);

        return response()->json([
            'id' => $user->id,
            'full_name' => $user->full_name,
            'email' => $user->email,
            'suspended_at' => $user->suspended_at,
            'last_login_at' => $user->last_login_at,
            'created_at' => $user->created_at,
            'gender' => $user->gender,
            'sizes' => [
                'upper_body_size' => $user->upper_body_size,
                'lower_body_size' => $user->lower_body_size,
                'preferred_fit'   => $user->preferred_fit,
            ],
            'order_count' => $orders->count(),
            // Lifetime value counts only FULLY PAID orders — a pending down
            // payment is not revenue and must not inflate the figure.
            'lifetime_value' => (float) $orders
                ->where('payment_status', 'fully_paid')
                ->sum('total_amount'),
            'orders' => $orders,
            'limited' => false,
        ]);
    }

    /**
     * GET /api/admin/customers/{user}/try-ons
     *
     * The customer's virtual try-on history — INCLUDING looks they deleted
     * (soft-deleted, `deleted_at` set). Staff use it when a customer writes in
     * asking for a deleted try-on back. Light rows: one small thumbnail each.
     */
    public function tryOns(Request $request, User $user)
    {
        if (!$this->isStaff($request->user()) && !$this->devAuthBypass()) {
            return response()->json(['message' => 'Only staff can view customers.'], 403);
        }

        $history = app(TryOnController::class);
        $sessions = TryOnSession::withTrashed()
            ->where('user_id', $user->id)
            ->where('status', TryOnSession::STATUS_COMPLETED)
            ->whereNotNull('result_image_base64')
            ->select(['id', 'session_id', 'history_title', 'garment_metadata_json', 'result_image_base64', 'created_at', 'deleted_at'])
            ->latest()
            ->limit(60)
            ->get()
            ->map(function (TryOnSession $s) use ($history) {
                $garments = $history->historyGarments($s);

                return [
                    'session_id' => $s->session_id,
                    'title' => $history->historyTitle($s, $garments),
                    'garments' => collect($garments)->pluck('name')->filter()->values(),
                    'thumbnail' => $history->historyThumbnail($s->result_image_base64),
                    'created_at' => optional($s->created_at)->toIso8601String(),
                    'deleted_at' => optional($s->deleted_at)->toIso8601String(),
                ];
            });

        return response()->json($sessions);
    }

    /**
     * POST /api/admin/customers/{user}/try-ons/{sessionId}/restore
     *
     * Puts a try-on the customer deleted back into their history and tells
     * them (bell notification + e-mail).
     */
    public function restoreTryOn(Request $request, User $user, string $sessionId)
    {
        if (!$this->isStaff($request->user()) && !$this->devAuthBypass()) {
            return response()->json(['message' => 'Only staff can restore try-ons.'], 403);
        }

        $session = TryOnSession::onlyTrashed()
            ->where('user_id', $user->id)
            ->where('session_id', $sessionId)
            ->first();
        if (!$session) {
            return response()->json(['message' => 'That try-on is not in the deleted list.'], 404);
        }

        $session->restore();

        try {
            $user->notify(new TryOnRestored($session));
        } catch (\Throwable $e) {
            // The restore stands even if the e-mail could not be sent.
            Log::warning('Try-on restore notification failed: ' . $e->getMessage());
        }

        $this->writeAudit($request, 'RESTORE_TRYON', "Restored try-on {$sessionId} for {$user->email} (#{$user->id}) and notified the customer", $user->id);

        return response()->json(['message' => 'Try-on restored and the customer was notified.']);
    }

    /**
     * PATCH /api/admin/customers/{user}/suspend
     *
     * Suspends a customer. A suspended account is refused at login.
     */
    public function suspend(Request $request, User $user)
    {
        if (!$this->isSuperAdmin($request->user()) && !$this->devAuthBypass()) {
            return response()->json(['message' => 'Only a Super Admin can suspend customers.'], 403);
        }

        if (strtolower((string) $user->role) !== 'user') {
            return response()->json(['message' => 'That account is not a customer.'], 404);
        }

        // Guard rail: never let an operator suspend their OWN account. That
        // would lock the acting super admin out on the next sign-in.
        if ($request->user() && $user->id === $request->user()->id) {
            return response()->json(['message' => 'You cannot suspend your own account.'], 422);
        }

        if ($user->suspended_at !== null) {
            return response()->json(['message' => 'That customer is already suspended.'], 200);
        }

        $user->forceFill(['suspended_at' => now()])->save();

        // Revoke live sessions so a suspended customer is signed out now, not
        // only on their next login attempt.
        $user->tokens()->delete();

        $this->writeAudit($request, 'SUSPEND_CUSTOMER', "{$user->email} (#{$user->id})", $user->id);

        return response()->json([
            'message' => 'Customer suspended.',
            'customer' => $user->only(['id', 'full_name', 'email', 'suspended_at', 'last_login_at', 'created_at']),
        ]);
    }

    /**
     * PATCH /api/admin/customers/{user}/reactivate
     */
    public function reactivate(Request $request, User $user)
    {
        if (!$this->isSuperAdmin($request->user()) && !$this->devAuthBypass()) {
            return response()->json(['message' => 'Only a Super Admin can reactivate customers.'], 403);
        }

        if (strtolower((string) $user->role) !== 'user') {
            return response()->json(['message' => 'That account is not a customer.'], 404);
        }

        if ($user->suspended_at === null) {
            return response()->json(['message' => 'That customer is not suspended.'], 200);
        }

        $user->forceFill(['suspended_at' => null])->save();

        $this->writeAudit($request, 'REACTIVATE_CUSTOMER', "{$user->email} (#{$user->id})", $user->id);

        return response()->json([
            'message' => 'Customer reactivated.',
            'customer' => $user->only(['id', 'full_name', 'email', 'suspended_at', 'last_login_at', 'created_at']),
        ]);
    }

    /** Records a privileged action on the security trail. */
    private function writeAudit(Request $request, string $action, string $details, ?int $subjectUserId = null): void
    {
        try {
            AuditLog::create([
                'admin_email' => $request->user()?->email,
                'actor_role' => $request->user() ? strtolower(str_replace(['-', '_'], '', (string) $request->user()->role)) : null,
                'action' => $action,
                'target' => 'CUSTOMERS',
                'subject_user_id' => $subjectUserId,
                'details' => $details,
                'ip_address' => $request->ip(),
            ]);
        } catch (\Throwable $e) {
            // The action already succeeded; a failed trail write must not turn
            // it into an error the operator reads as "nothing happened".
            Log::warning('Customer audit log write failed: ' . $e->getMessage());
        }
    }

    /** True for admin and superadmin — anyone allowed to audit customers. */
    private function isStaff(?User $user): bool
    {
        return $user instanceof User
            && in_array(strtolower(str_replace(['-', '_'], '', (string) $user->role)), ['admin', 'superadmin'], true);
    }

    /** True when the given user is a superadmin. */
    private function isSuperAdmin(?User $user): bool
    {
        return $user instanceof User
            && strtolower(str_replace(['-', '_'], '', (string) $user->role)) === 'superadmin';
    }

    /**
     * DEV ONLY — an explicit, opt-in auth bypass (mirrors AdminAccountController).
     *
     * The previous body was `return !app()->isProduction();`, a NEGATIVE test that
     * enabled the bypass in `local`, `testing`, `staging` and in any environment
     * with an unset or misspelled `APP_ENV`. It now requires the deliberate
     * `ALLOW_DEV_AUTH_BYPASS=true`, and is hard-refused in production.
     */
    private function devAuthBypass(): bool
    {
        if (app()->isProduction()) {
            return false;
        }

        return (bool) config('app.allow_dev_auth_bypass', false);
    }
}
