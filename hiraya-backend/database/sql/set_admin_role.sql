-- ============================================================================
-- Hiraya — Admin Role Provisioning (Supabase PostgreSQL)
-- ----------------------------------------------------------------------------
-- Target schema: public.users
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query),
-- or via psql against the pooled connection string.
--
-- The backend authenticates against `public.users.role` and grants the
-- /api/admin/* surface to role IN ('admin', 'superadmin'):
--   app/Http/Middleware/EnsureUserIsAdmin.php
--   routes/api.php  -> Route::middleware(['auth:sanctum', 'admin'])
--
-- The frontend mirrors that same rule in ProtectedRoute.jsx (AdminRoute), so
-- promoting a user here is ALL that is required for them to reach /admin/dashboard.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. PREREQUISITE — ensure the role column exists with a safe default.
--    (Idempotent: safe to re-run. Matches the `role` column written by
--     AuthController::register() which explicitly sets role = 'user'.)
-- ----------------------------------------------------------------------------
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS role VARCHAR(255) NOT NULL DEFAULT 'user';

-- Constrain the column so a typo ('admni') can never grant or revoke access
-- silently. Drop-then-add keeps the script re-runnable.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
    ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'superadmin'));


-- ----------------------------------------------------------------------------
-- 1. THE REQUESTED ONE-LINER — promote an existing account to Admin.
--    Replace the email with the real administrator address.
-- ----------------------------------------------------------------------------
UPDATE public.users
SET role = 'admin'
WHERE email = 'YOUR_ADMIN_EMAIL@domain.com';


-- ----------------------------------------------------------------------------
-- 2. VERIFY — confirm exactly one row flipped and inspect the result.
-- ----------------------------------------------------------------------------
SELECT id, full_name, email, role
FROM public.users
WHERE email = 'YOUR_ADMIN_EMAIL@domain.com';


-- ----------------------------------------------------------------------------
-- 3. (OPTIONAL) SUPER ADMIN — full control of /superadmin surfaces too.
-- ----------------------------------------------------------------------------
-- UPDATE public.users
-- SET role = 'superadmin'
-- WHERE email = 'YOUR_ADMIN_EMAIL@domain.com';


-- ----------------------------------------------------------------------------
-- 4. (OPTIONAL) REVOKE — demote back to a standard customer account.
-- ----------------------------------------------------------------------------
-- UPDATE public.users
-- SET role = 'user'
-- WHERE email = 'YOUR_ADMIN_EMAIL@domain.com';
