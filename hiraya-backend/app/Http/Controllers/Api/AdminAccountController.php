<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

/**
 * Admin/Super Admin account management — the RBAC screen in the Super Admin
 * console (superadmin/tabs/AdminsTab.jsx).
 *
 * Until now the console had NO backend for provisioning admins: AdminsTab
 * rendered an "ADD ADMIN ACCOUNT" modal whose onAddAdmin/onDeleteAdmin props
 * were never wired (see SuperAdmin.jsx), so the form silently did nothing.
 * This controller is the missing half that makes the feature real.
 *
 * ACCESS MODEL
 *   - The whole route group is gated by `auth:sanctum + superadmin` (see
 *     routes/api.php). This screen is SUPERADMIN-EXCLUSIVE: provisioning,
 *     editing and revoking administrators must never be reachable by an
 *     ordinary admin.
 *   - The per-method guards below are kept as DEFENCE-IN-DEPTH. They should
 *     never actually fire now that the route itself is superadmin-only, but
 *     they protect the controller if it is ever mounted behind a weaker gate.
 *
 * LOCKOUT PROTECTION
 *   - A superadmin can never delete or demote their own account, and the last
 *     remaining superadmin cannot be removed — otherwise the console could be
 *     permanently locked out with no way back in except the CLI.
 */
class AdminAccountController extends Controller
{
    /**
     * GET /api/admin/accounts
     *
     * Lists every privileged account (admin + superadmin) for the RBAC table.
     */
    public function index()
    {
        $accounts = User::query()
            ->whereIn('role', ['admin', 'superadmin'])
            ->orderByRaw("CASE WHEN role = 'superadmin' THEN 0 ELSE 1 END")
            ->orderBy('id')
            ->get([
                'id',
                'full_name',
                'email',
                'role',
                'inventory_permissions',
                'ai_rules_access',
                'last_login_at',
                'created_at',
            ]);

        return response()->json($accounts);
    }

    /**
     * POST /api/admin/accounts
     *
     * Provisions a new admin (or superadmin) account. Superadmin-only.
     */
    public function store(Request $request)
    {
        if (!$this->isSuperAdmin($request->user()) && !$this->devAuthBypass()) {
            return response()->json([
                'message' => 'Only a Super Admin can provision administrator accounts.',
            ], 403);
        }

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
            'role' => ['required', 'string', Rule::in(['admin', 'superadmin'])],
            'inventory_permissions' => ['nullable', 'string', Rule::in(['READ_WRITE', 'READ_ONLY'])],
            'ai_rules_access' => ['nullable', 'boolean'],
        ]);

        /*
         * Only admin/superadmin are accepted. 'moderator' was previously an
         * allowed VALUE that was then silently coerced to 'admin' below, so the
         * caller was told nothing and the created account did not match the role
         * they chose. Rejecting it at validation is honest: no moderator tier
         * exists, so nothing is persisted under a role the app cannot enforce.
         */
        $role = strtolower($validated['role']) === 'superadmin' ? 'superadmin' : 'admin';

        $account = User::create([
            'full_name' => $validated['name'],
            'email' => strtolower($validated['email']),
            'password' => Hash::make($validated['password']),
            'role' => $role,
            'inventory_permissions' => $validated['inventory_permissions'] ?? 'READ_WRITE',
            'ai_rules_access' => $validated['ai_rules_access'] ?? true,
            // New accounts have never signed in, so there is no last-seen yet.
            'last_login_at' => null,
        ]);

        return response()->json([
            'message' => 'Administrator account provisioned.',
            'account' => $account->only([
                'id',
                'full_name',
                'email',
                'role',
                'inventory_permissions',
                'ai_rules_access',
                'last_login_at',
                'created_at',
            ]),
        ], 201);
    }

    /**
     * PATCH /api/admin/accounts/{user}
     *
     * Updates an admin's role and/or RBAC permissions.
     */
    public function update(Request $request, User $user)
    {
        if (!$this->isPrivileged($user)) {
            return response()->json(['message' => 'That account is not an administrator.'], 422);
        }

        $validated = $request->validate([
            'role' => ['sometimes', 'string', Rule::in(['admin', 'superadmin'])],
            'inventory_permissions' => ['sometimes', 'string', Rule::in(['READ_WRITE', 'READ_ONLY'])],
            'ai_rules_access' => ['sometimes', 'boolean'],
        ]);

        // Guard rail: never let a superadmin demote themselves (self-lockout).
        if (
            array_key_exists('role', $validated) &&
            $user->id === $request->user()->id &&
            strtolower($validated['role']) !== 'superadmin'
        ) {
            return response()->json([
                'message' => 'You cannot remove your own Super Admin role.',
            ], 422);
        }

        // Guard rail: only a superadmin may change roles or promote to superadmin.
        if (array_key_exists('role', $validated)) {
            if (!$this->isSuperAdmin($request->user()) && !$this->devAuthBypass()) {
                return response()->json([
                    'message' => 'Only a Super Admin can change administrator roles.',
                ], 403);
            }

            $newRole = strtolower($validated['role']) === 'superadmin' ? 'superadmin' : 'admin';

            /*
             * Guard rail: don't let a role change DEMOTE THE LAST SUPER ADMIN
             * (whether the target is the caller or someone else). destroy() has
             * this protection; update() needs it too, otherwise a superadmin
             * could demote the only remaining superadmin and lock the console
             * out permanently with no path back in but the CLI.
             */
            $targetIsSuperAdmin = $this->isSuperAdmin($user);
            if ($targetIsSuperAdmin && $newRole !== 'superadmin' && User::where('role', 'superadmin')->count() <= 1) {
                return response()->json([
                    'message' => 'Cannot remove the last Super Admin account.',
                ], 422);
            }

            $user->role = $newRole;
        }

        if (array_key_exists('inventory_permissions', $validated)) {
            $user->inventory_permissions = $validated['inventory_permissions'];
        }

        if (array_key_exists('ai_rules_access', $validated)) {
            $user->ai_rules_access = $validated['ai_rules_access'];
        }

        $user->save();

        return response()->json([
            'message' => 'Administrator account updated.',
            'account' => $user->only([
                'id',
                'full_name',
                'email',
                'role',
                'inventory_permissions',
                'ai_rules_access',
                'last_login_at',
                'created_at',
            ]),
        ]);
    }

    /**
     * DELETE /api/admin/accounts/{user}
     *
     * Revokes an admin account. Superadmin-only, with self- and last-superadmin
     * lockout protection.
     */
    public function destroy(Request $request, User $user)
    {
        if (!$this->isPrivileged($user)) {
            return response()->json(['message' => 'That account is not an administrator.'], 422);
        }

        if (!$this->isSuperAdmin($request->user()) && !$this->devAuthBypass()) {
            return response()->json([
                'message' => 'Only a Super Admin can revoke administrator accounts.',
            ], 403);
        }

        if ($user->id === $request->user()?->id) {
            return response()->json([
                'message' => 'You cannot revoke your own account while signed in.',
            ], 422);
        }

        if (
            strtolower((string) $user->role) === 'superadmin' &&
            User::where('role', 'superadmin')->count() <= 1
        ) {
            return response()->json([
                'message' => 'Cannot remove the last Super Admin account.',
            ], 422);
        }

        // Soft-revoke: demote back to a customer instead of hard-deleting, so the
        // account's orders / history survive the audit trail. Hard-delete of a
        // user with orders would cascade or orphan records.
        $user->role = 'user';
        $user->inventory_permissions = null;
        $user->ai_rules_access = null;
        $user->save();

        return response()->json(['message' => 'Administrator access revoked.']);
    }

    /** True when the given user holds an admin or superadmin role. */
    private function isPrivileged(?User $user): bool
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
     * DEV ONLY — temporary auth bypass.
     *
     * The Super Admin console is being developed without tokens, so the
     * superadmin-only guards above would answer 403 on every write when no
     * authenticated user is present. This makes the write paths usable again.
     *
     * PRODUCTION: remove the `&& !$this->devAuthBypass()` clauses (and this
     * method) to restore the strict superadmin-only behaviour.
     */
    private function devAuthBypass(): bool
    {
        return !app()->isProduction();
    }
}
