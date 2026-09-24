<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Restricts a route to superadmin users only.
 *
 * Registered as the 'superadmin' alias in bootstrap/app.php, so routes can
 * simply use ->middleware('superadmin'). This is the stricter sibling of
 * EnsureUserIsAdmin: the ordinary admin console is shared by admin AND
 * superadmin, but Super-Admin-exclusive surfaces (provisioning admins,
 * system settings, audit logs) must not be reachable by a plain admin.
 */
class EnsureUserIsSuperAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        // Normalize so 'Super Admin', 'super_admin' and 'super-admin' all count.
        $role = strtolower(str_replace(['-', '_'], '', (string) $user->role));

        if ($role !== 'superadmin') {
            return response()->json(['message' => 'Forbidden. Super Admin access required.'], 403);
        }

        return $next($request);
    }
}
