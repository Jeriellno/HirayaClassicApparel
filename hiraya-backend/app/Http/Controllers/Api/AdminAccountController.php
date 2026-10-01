<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Rules\PasswordStrength;
use App\Services\AdminInvitationService;
use App\Support\SupabaseIdentity;
use Illuminate\Http\Request;
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
                'mfa_enrolled_at',
                'created_at',
            ]);

        return response()->json($accounts);
    }

    /**
     * POST /api/admin/accounts/invite
     *
     * THE INVITATION FLOW — SUPERADMIN-ONLY.
     *
     * WHY THIS REPLACES "CREATE THE ACCOUNT AND TYPE A PASSWORD"
     * -----------------------------------------------------------
     * The previous `store()` below created the account outright with a password
     * the SUPERADMIN chose. Two problems, and the second is the reason this
     * endpoint exists:
     *
     *   1. A password two people know cannot be attributed. The audit trail keys
     *      on the account, so an action taken with a boss-typed password cannot
     *      honestly be assigned to one person.
     *   2. MFA IS PROOF OF POSSESSION, so the superadmin would have had to enrol
     *      the TOTP factor too — and a factor enrolled by someone else is a
     *      factor SHARED with them. Every admin would then hold the same
     *      authenticator as the owner, and revoking one admin would revoke
     *      nothing.
     *
     * An invitation inverts both: the invitee chooses their password and enrols
     * their OWN factor, and this endpoint never sees either.
     *
     * NOTHING IS CREATED HERE. No `users` row, no GoTrue identity. Both are
     * created at acceptance (see `acceptInvitation`), which is what stops an
     * account from existing in a half-provisioned state.
     */
    public function invite(Request $request, AdminInvitationService $invitations)
    {
        if (!$this->isSuperAdmin($request->user()) && !$this->devAuthBypass()) {
            return response()->json([
                'message' => 'Only a Super Admin can invite administrators.',
            ], 403);
        }

        /*
         * NO `name` FIELD. The invitation is addressed to an ADDRESS, and the
         * only person who knows how the invitee wants to be shown is the invitee.
         * Requiring a name here would be the superadmin typing a display name on
         * behalf of someone they may not have met, and would have to be editable
         * anyway. The account derives a readable name from the address at
         * acceptance.
         */
        /*
         * CANONICALISE FIRST, THEN VALIDATE — the order matters.
         *
         * This used to validate `unique:users,email` against the RAW, as-typed
         * address and only canonicalise afterwards (`SupabaseIdentity::canonicalEmail`
         * lower-cases and normalises). The uniqueness check and the value that got
         * written were therefore computed from two different strings: an address
         * that differed from its canonical form only in case or spacing passed the
         * "is this already taken?" test and then collided on insert, and — worse —
         * the SUPPOSED-CANONICAL duplicate check in the service could be dodged by
         * re-inviting the same person with different casing.
         *
         * `$request->merge()` puts the canonical form into the input BEFORE the
         * rules run, so `unique`, the value stored, and the value the token is
         * bound to are all the same string.
         */
        $request->merge([
            'email' => SupabaseIdentity::canonicalEmail((string) $request->input('email')),
        ]);

        /*
         * RULE 2 + RULE 3 — ONE SUPERADMIN ONLY, AND IT IS NEVER INVITED.
         *
         * This used to accept `Rule::in(['admin', 'superadmin'])`, which meant a
         * superadmin could mint a second superadmin by inviting one. That breaks
         * the two rules the whole role model rests on: Hiraya has exactly ONE
         * superadmin, and that account is PROVISIONED, never invited.
         *
         * The narrower rule is not a convenience — the invitation flow cannot
         * safely create a superadmin even in principle. It mints the role from the
         * SIGNED TOKEN (AdminInvitationService::roleFromToken), so the authority is
         * decided by whoever issued the link. Letting that path produce a
         * superadmin would mean the one power in the system that can rewrite
         * settings, provision staff and read the audit trail is itself
         * distributable through a link in an inbox.
         *
         * `admin` is the ONLY role this endpoint can issue. Promoting somebody to
         * superadmin remains possible deliberately, by an existing superadmin
         * through PATCH /admin/accounts/{user} (see update(), which also guards
         * the self-demotion and last-superadmin lockout cases) — that is a
         * deliberate act by the one account that already holds the power, not a
         * side effect of writing out an invitation.
         */
        $validated = $request->validate([
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'role' => ['required', 'string', Rule::in(['admin'])],
        ], [
            'role.in' => 'Only the admin role can be invited. Hiraya has a single Super Admin, '
                . 'and that account is provisioned directly rather than invited.',
            /*
             * THE CONSOLE SENDS THE ROLE UPPERCASED (`formData.role.toUpperCase()` in
             * AdminsTab), so a rejected promotion arrives here as 'SUPERADMIN' and would
             * otherwise fall through to the generic `in` message. Without this key the
             * superadmin sees a bare "The selected role is invalid", which says nothing
             * about the rule it just hit. Fail-closed either way — both rules refuse.
             */
            'role' => 'Only the admin role can be invited. Hiraya has a single Super Admin, '
                . 'and that account is provisioned directly rather than invited.',
        ]);

        $email = $validated['email'];

        /*
         * AN ADDRESS THAT ALREADY HAS A GOTRUE IDENTITY BUT NO HIRAYA ROW IS A
         * HALF-ACCOUNT FROM AN EARLIER FAILED RUN, and inviting it would create
         * a SECOND identity that could never sign in. Refusing is the honest
         * answer, and it names the way out.
         */
        if (SupabaseIdentity::findAuthId($email) !== null) {
            return response()->json([
                'message' => 'A sign-in identity already exists for that address. '
                    . 'Remove it in Supabase, or use a different address.',
            ], 422);
        }

        try {
            $result = $invitations->invite(
                $email,
                $validated['role'],
                (string) ($request->user()?->email ?? 'A Hiraya Super Admin'),
            );
        } catch (\App\Exceptions\InvitationPendingException $e) {
            /*
             * AN INVITATION FOR THIS ADDRESS WAS ALREADY ISSUED AND IS STILL LIVE.
             *
             * 409, not 422: the request was well-formed and the address is not
             * already an account — it is simply already invited. The body carries
             * the EXISTING invitation's expiry so the console can say when it
             * lapses, and `resend: true` names the way forward, because "someone
             * already invited this person" is only useful information if the
             * superadmin can act on it.
             */
            return response()->json([
                'message' => $e->getMessage(),
                'invitation_pending' => true,
                'expires_at' => $e->expiresAt(),
                'resend' => true,
            ], 409);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 502);
        }

        return response()->json([
            'message' => "Invitation sent to {$email}.",
            'email' => $email,
            'role' => strtolower($validated['role']) === 'superadmin' ? 'superadmin' : 'admin',
            'expires_at' => $result['expires_at'],
            // Handed back so the console can offer "copy the link" when mail
            // delivery is unavailable in a development environment.
            'invitation_url' => $result['url'],
        ], 201);
    }

    /**
     * GET /api/invitations/{token}  (PUBLIC)
     *
     * Tells the acceptance page what it is accepting, so it can describe the role
     * and refuse a dead link BEFORE the invitee chooses a password. Mirrors
     * `validate-reset-token`.
     */
    public function inspectInvitation(Request $request, AdminInvitationService $invitations)
    {
        $validated = $request->validate([
            'email' => ['required', 'email'],
            'token' => ['required', 'string'],
        ]);

        if (!$invitations->tokenIsValid($validated['email'], $validated['token'])) {
            return response()->json([
                'valid' => false,
                'message' => 'This invitation is invalid, expired, or has already been used.',
            ], 410);
        }

        return response()->json([
            'valid' => true,
            'email' => SupabaseIdentity::canonicalEmail($validated['email']),
            // Read from the SIGNED token, so the page can name the role it is
            // accepting. Tampering with it invalidates the signature, and the
            // same value is what `accept()` writes — this copy is for display
            // only.
            'role' => $invitations->roleFromToken($validated['email'], $validated['token']),
        ]);
    }

    /**
     * POST /api/invitations/accept  (PUBLIC — the token IS the credential)
     *
     * Creates the account and stops. The account is INACTIVE — it has a password
     * but no second factor — and `markMfaEnrolled()` below is the only thing that
     * activates it.
     */
    public function acceptInvitation(Request $request, AdminInvitationService $invitations)
    {
        /*
         * NO `role` IN THE BODY.
         *
         * The role is read from the HMAC-signed token inside the service, so the
         * value that decides a new account's authority is never something a
         * client can send. The acceptance page does not submit one.
         */
        $validated = $request->validate([
            'email' => ['required', 'email'],
            'token' => ['required', 'string'],
            /*
             * THE SHARED RULE, NOT `min:8`.
             *
             * This endpoint originally validated only a length, while the page in
             * front of it enforces the full policy (8 chars, 1 uppercase, 1
             * number). That is exactly the drift `App\Rules\PasswordStrength`
             * exists to prevent: a weak password typed straight into the API would
             * have been accepted by the server and refused by the form, so the
             * form's promise would have meant nothing — and an ADMIN password in
             * particular must never be the weak one.
             */
            'password' => ['required', 'confirmed', new PasswordStrength('password')],
        ]);

        try {
            $user = $invitations->accept(
                $validated['email'],
                $validated['token'],
                $validated['password'],
            );
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json([
            'message' => 'Password set. Next, enroll your authenticator app.',
            'email' => $user->email,
            'role' => $user->role,
            /*
             * Stated explicitly so the client cannot mistake this for a finished
             * sign-up. The account exists and can authenticate with its password,
             * but it cannot reach the console until a verified factor exists.
             */
            'mfa_required' => true,
        ], 201);
    }

    /**
     * POST /api/admin/accounts/mfa-enrolled — RECORDS WHEN AN AUTHENTICATOR WAS SET UP.
     *
     * This is an AUDIT WRITE and nothing more. It is no longer load-bearing for
     * access.
     *
     * It used to be the single writer of `mfa_enrolled_at`, and `ResolveSupabaseUser`
     * refused every console request until that column was set — so this endpoint WAS
     * the activation, and because it sat behind the very check it had to satisfy, no
     * invited admin could ever pass it. The deadlock is gone: a staff account is
     * active the moment `supabase.aal2` accepts its request, because that middleware
     * verifies a completed TOTP challenge cryptographically. There is no server-side
     * flag left to be in sync with.
     *
     * WHAT IS STILL TRUE HERE, AND WHY IT IS KEPT. The route is NOT open: it keeps
     * the full `supabase.aal2` + `supabase.user` chain, so the caller has genuinely
     * verified a second factor, and the identity written to is `$request->user()` —
     * resolved from the just-verified token, never from the request body. Nobody can
     * mark anybody else's account enrolled, and nobody can call this without a TOTP.
     *
     * The column now answers one question the token cannot: WHEN did this person
     * enrol? That is the Super Admin accounts table's "activated" column, and it is
     * worth having in the audit trail.
     */
    public function markMfaEnrolled(Request $request)
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($user->mfa_enrolled_at === null) {
            $user->mfa_enrolled_at = now();
            $user->save();

            \App\Models\AuditLog::create([
                'admin_email' => $user->email,
                'action' => 'MFA_ENROLLED',
                'target' => strtoupper((string) $user->role),
                'details' => 'Authenticator enrolled; account activated.',
            ]);
        }

        return response()->json([
            'message' => 'Two-factor authentication confirmed.',
            'mfa_enrolled_at' => $user->mfa_enrolled_at?->toIso8601String(),
        ]);
    }

    /**
     * POST /api/admin/accounts  — REMOVED. USE `invite` INSTEAD.
     *
     * The method that created an account outright, with a password the SUPERADMIN
     * chose, is gone. `store` is not merely unrouted: it has been deleted,
     * because leaving it in place would be a trap. It compiles, it is documented,
     * and it would grant full superadmin access to anyone with a session — one
     * careless `Route::post('/admin/accounts', ...)` away from being live again,
     * and it would reintroduce the exact property the invitation flow exists to
     * remove: the superadmin holding a credential that belongs to someone else.
     *
     * The replacement is `invite()` above, which creates NOTHING and lets the
     * invitee set their own password and enroll their own authenticator.
     */


    /**
     * POST /api/admin/accounts/{user}/resend-invitation
     *
     * RE-ISSUE the invitation for an account that is still pending activation.
     *
     * The console shows the invitation link exactly ONCE, in the modal that created
     * it. Without this endpoint a superadmin who closed that modal before copying
     * the link had no recovery except waiting out the 48-hour TTL — the invitee
     * simply could not be let in, and `invite()` would refuse the address for the
     * same reason. This is the deliberate way through.
     */
    public function resendInvitation(Request $request, User $user, AdminInvitationService $invitations)
    {
        if (!$this->isSuperAdmin($request->user()) && !$this->devAuthBypass()) {
            return response()->json([
                'message' => 'Only a Super Admin can resend an invitation.',
            ], 403);
        }

        /*
         * ONLY A STILL-PENDING ACCOUNT.
         *
         * `mfa_enrolled_at !== null` means the invitee finished: the account is
         * active and there is nothing to resend. Refusing here keeps this endpoint
         * from being reachable way to mint a fresh sign-in link for a working admin,
         * which would be a privilege-escalation primitive rather than a convenience.
         */
        if ($user->mfa_enrolled_at !== null) {
            return response()->json([
                'message' => 'That account is already active. Use a password reset instead.',
            ], 422);
        }

        try {
            $result = $invitations->resend($user->email, (string) ($request->user()?->email ?? 'A Hiraya Super Admin'));
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json([
            'message' => "A fresh invitation was sent to {$user->email}.",
            'email' => $user->email,
            'role' => $user->role,
            'expires_at' => $result['expires_at'],
            // Same reason as `invite()`: the link is handed back so it can be
            // delivered by hand when no SMTP host is configured.
            'invitation_url' => $result['url'],
        ], 200);
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
     * DEV ONLY — an EXPLICIT, OPT-IN auth bypass.
     *
     * WHAT WAS WRONG WITH `return !app()->isProduction();`
     * ---------------------------------------------------
     * That is a NEGATIVE test, so it enables the bypass for every environment
     * that is not the single literal string `production`: `local`, `testing`,
     * `staging`, `development`, a typo like `prodution`, and — because
     * `config/app.php` defaults `APP_ENV` to `production` only when the variable
     * is ABSENT — any deployment that leaves it unset or empty. This is the most
     * sensitive controller in the application (it provisions, promotes and
     * revokes staff accounts), and on such a deployment every guard below
     * (`isSuperAdmin`) silently stopped applying to anyone who could reach the
     * route.
     *
     * It was ALSO a self-documenting lockout the author never noticed: the
     * comment said "PRODUCTION: remove these clauses", which means the bypass was
     * meant to be temporary and was still shipped months later.
     *
     * WHAT REPLACES IT
     * ---------------
     * A POSITIVE test against a config flag that defaults to false. Being off
     * unless a human deliberately sets `ALLOW_DEV_AUTH_BYPASS=true` means the
     * failure mode of forgetting about this code is "the console asks for a
     * token", not "the console is open to the internet".
     *
     * It is ALSO hard-refused in production, so even setting the variable there
     * cannot re-open the hole — the two conditions must both hold.
     */
    private function devAuthBypass(): bool
    {
        if (app()->isProduction()) {
            return false;
        }

        return (bool) config('app.allow_dev_auth_bypass', false);
    }
}
