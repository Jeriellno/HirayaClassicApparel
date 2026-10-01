<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Restricts a route to admin (and superadmin) users.
 *
 * Registered as the 'admin' alias in bootstrap/app.php, so routes can
 * simply use ->middleware('admin').
 *
 * NOTE ON SCOPE
 * This resolves `$request->user()`, so it only works alongside a Sanctum
 * session. It checks the ROLE and nothing else — it cannot tell an aal1
 * session from an aal2 one, because that distinction lives in the Supabase
 * JWT, not in the local users table. Administrative routes therefore carry
 * BOTH `admin` and `supabase.aal2`; neither alone is sufficient.
 */
class EnsureUserIsAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        // Normalize so 'Admin', 'super_admin' and 'super-admin' all count as a
        // valid role instead of being rejected by a strict string comparison.
        $role = strtolower(str_replace(['-', '_'], '', (string) $user->role));

        if (!in_array($role, ['admin', 'superadmin'], true)) {
            return response()->json(['message' => 'Forbidden. Admin access required.'], 403);
        }

        return $next($request);
    }
}
