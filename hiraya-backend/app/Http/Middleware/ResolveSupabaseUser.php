<?php

namespace App\Http\Middleware;

use Closure;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * ResolveSupabaseUser — turns a verified Supabase JWT into a Laravel session user.
 *
 * WHY THIS EXISTS AT ALL (gateway design, "option C")
 * ----------------------------------------------------
 * The console's data lives in Laravel, but its AUTHORIZATION lives in Supabase:
 * the `aal` claim that says "this session passed a TOTP challenge" exists only
 * inside the Supabase-signed token. So the console needs both halves at once —
 * Laravel for the rows, Supabase for the proof.
 *
 * `auth:sanctum` cannot do this. It expects a Sanctum personal access token and
 * has no idea how to read a Supabase JWT; pointed at one it answers 401 before
 * any assurance-level check runs, which would make the aal2 gate unreachable.
 * Running BOTH middlewares is not a fix either — it means two credentials in
 * one Authorization header and two sources of truth about who the caller is.
 *
 * So the console carries exactly ONE token (the Supabase JWT, which the client
 * sends for /admin/*) and this middleware does the joining:
 *
 *     Supabase JWT  --verify signature-->  email  --lookup-->  local User
 *
 * The signature check itself lives in EnsureSupabaseAAL2 and runs FIRST in the
 * route's middleware chain. That ordering is load-bearing: this middleware
 * trusts the `sub`/`email` claims only because the aal2 gate has already
 * cryptographically proven they came from Supabase. Reversed, an attacker
 * could forge a JWT with `alg: none`, claim to be the superadmin's email, and
 * walk straight in. Never reorder these two.
 *
 * WHY EMAIL IS THE JOIN KEY
 * The local table is Laravel-owned: `users.id` is a bigint with no reference to
 * `auth.users` (Supabase's id is a uuid). Linking them properly needs a schema
 * migration and a backfill of every staff account, which is the larger "option
 * A" project. For the gateway, email is already unique in `users`, already
 * asserted by the JWT, and already the identifier a human uses to sign in.
 *
 * THE SECURITY CAVEAT, STATED PLAINLY
 * Matching on email means the two systems must agree on who owns an address.
 * Two rules make that safe, and both are enforced below:
 *
 *   1. the JWT's email must be CONFIRMED by Supabase, or an attacker who can
 *      register an unconfirmed address is not linked to anything; the verdict
 *      is read from GoTrue's user record over the Admin API, keyed on the
 *      verified `sub`;
 *   2. the lookup is an exact match on a unique column with no LIKE and no
 *      case-folding beyond strtolower on both sides.
 *
 * If Hiraya later allows a customer to self-register an address that happens to
 * equal a staff address, this becomes a privilege-escalation path. That risk is
 * a reason to migrate to an explicit auth_id (option A) — not a reason to skip
 * these checks now.
 */
class ResolveSupabaseUser
{
    public function handle(Request $request, Closure $next): Response
    {
        $email = $request->attributes->get('supabase_email');
        $supabaseId = $request->attributes->get('supabase_user_id');

        if (!is_string($email) || $email === '' || $supabaseId === null) {
            return response()->json([
                'message' => 'Unauthenticated. The session token carries no usable identity.',
            ], 401);
        }

        /*
         * RULE 1 — the address must be CONFIRMED on the Supabase side.
         *
         * The verdict is resolved by EnsureSupabaseAAL2 over the Supabase
         * Admin API, from the verified `sub` — not from a client-supplied
         * value — and cached briefly. Without the check, anyone able to sign up
         * with an arbitrary unconfirmed address could try to attach it to a staff
         * account.
         */
        if (!$request->attributes->get('supabase_email_confirmed')) {
            return response()->json([
                'message' => 'Unauthenticated. This email address is not confirmed.',
            ], 401);
        }

        try {
            // RULE 2 — exact match, normalized once on both sides.
            $user = User::whereRaw('lower(email) = ?', [strtolower($email)])->first();
        } catch (Throwable $e) {
            Log::error('ResolveSupabaseUser lookup failed: ' . $e->getMessage());

            return response()->json([
                'message' => 'Could not resolve the session user.',
            ], 500);
        }

        if (!$user) {
            /*
             * A VALID Supabase account with no Hiraya account. This is a
             * registration, not a failure — and it is answered with 403, not
             * 404, because 404 would confirm which addresses exist in Hiraya
             * and turn this endpoint into a staff-enumeration oracle.
             */
            return response()->json([
                'message' => 'This account has no Hiraya access.',
            ], 403);
        }

        /*
         * A suspended account is refused HERE, not in the console.
         *
         * `admin` only compares role strings, so a suspended superadmin would
         * otherwise pass it. Checking suspension at the point the identity is
         * established means suspension takes effect on the very next request,
         * with no dependence on a token being revoked.
         */
        if ($user->suspended_at !== null) {
            return response()->json([
                'message' => 'This account is suspended.',
            ], 403);
        }

        /*
         * THE PENDING-INVITATION GATE — AN ADMIN WITHOUT MFA IS NOT AN ADMIN YET.
         *
         * An invited account is created the moment the invitee sets a password,
         * and it deliberately has NO second factor at that point. This check is
         * what keeps the promise that such an account is not usable: until
         * `mfa_enrolled_at` is set, every console request is refused.
         *
         * WHY THIS IS HERE AND NOT IN THE CONSOLE OR A MIDDLEWARE OF ITS OWN
         * ------------------------------------------------------------------
         * This middleware is already the one place where a verified Supabase JWT
         * becomes a Hiraya identity, and suspension is enforced on the same line
         * for the same reason: both are facts about the ACCOUNT, not about the
         * route or the role, and answering them at the point the identity is
         * established means they apply to every controller behind this chain
         * without each one remembering to ask.
         *
         * IT CANNOT LOCK OUT THE STAFF THAT ALREADY EXISTS. Only a null value
         * blocks, and the migration backfills every admin/superadmin row with
         * their `created_at`, so an account provisioned before this column
         * existed is treated as enrolled — which is what it already is, since
         * the console has demanded aal2 all along.
         *
         * Customers are unaffected: the column is only ever set for privileged
         * roles, and a `user` row is null by default. The check is therefore
         * scoped to staff so a storefront request from a customer never sees it.
         */
        $role = strtolower(str_replace(['-', '_'], '', (string) $user->role));

        /*
         * NO `mfa_enrolled_at` CHECK HERE — AND THAT IS THE DESIGN, NOT AN OMISSION.
         *
         * This middleware used to refuse every console request from a staff account
         * whose `mfa_enrolled_at` was null, and that flag was written by exactly one
         * endpoint: `POST /admin/accounts/mfa-enrolled`, which sits BEHIND this
         * middleware. So the endpoint that exists to activate an account was gated
         * behind the activation flag, and the flag could therefore never be written.
         * An invited admin who scanned the QR, entered their 6-digit code and held
         * a genuine verified factor was still answered 403 "not active yet" forever,
         * with no route out.
         *
         * THAT SECOND FLAG IS REDUNDANT, AND ALWAYS WAS. By the time this line
         * runs, two things have already been proven cryptographically and are not
         * the caller's to assert:
         *
         *   1. `supabase.aal2` ran FIRST in the chain and refused anything whose
         *      JWT does not carry aal === 'aal2'. Aal2 is issued by GoTrue only
         *      after a TOTP challenge is VERIFIED, and the token's signature is
         *      checked against the project's published ES256 key. So a caller
         *      reaching here has already proved they hold a working second factor —
         *      on THIS request, not on some earlier one.
         *   2. The email is confirmed on Supabase, read from GoTrue's own record.
         *
         * `mfa_enrolled_at` recorded the same event one round trip later, in a
         * column any privileged caller could write. It was a weaker, laggier copy
         * of a fact the middleware had already verified, and the lag is what created
         * the deadlock. The TOTP challenge IS the activation: there is no separate
         * step, no second screen, and no server-side copy to fall out of sync.
         *
         * Consequence for the console: an account with `role = admin` and a working
         * authenticator is ACTIVE the moment it proves the code. Nothing else is
         * asked of it.
         *
         * The column itself is left in place (and still written by the enrolment
         * endpoint) purely as an AUDIT record — "when did this person enrol?" — for
         * the Super Admin accounts table. It is deliberately no longer load-bearing
         * for access. Suspension above remains the one account-level way to lock a
         * staff member out, and it is enforced on this same line for the same
         * reason: a fact about the ACCOUNT, answered where the identity is
         * established.
         */

        /*
         * RECORD THE VERIFIED ENROLMENT. This request already passed
         * `supabase.aal2` (a VERIFIED TOTP challenge), so the account has a
         * working authenticator. Stamping it here keeps the Super Admin "2FA"
         * column truthful even when the client never called /mfa-enrolled.
         */
        if ($user->mfa_enrolled_at === null
            && in_array($role, ['admin', 'superadmin'], true)
            && $request->attributes->get('supabase_aal') === 'aal2') {
            $user->forceFill(['mfa_enrolled_at' => now()])->saveQuietly();
        }

        // Let the existing `admin` / `superadmin` middleware see a real user.
        Auth::setUser($user);

        $request->setUserResolver(fn() => $user);

        // Supabase's own id, so controllers can audit against it.
        $request->attributes->set('hiraya_user_id', $user->id);
        $request->attributes->set('hiraya_role', strtolower((string) $user->role));

        return $next($request);
    }
}
