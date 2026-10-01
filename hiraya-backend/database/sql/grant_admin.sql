-- ============================================================================
-- Hiraya — Grant Admin Access
-- ----------------------------------------------------------------------------
-- The `public.tbl_users` table stores a plain VARCHAR `role` column
--   role VARCHAR NOT NULL DEFAULT 'user'
-- with exactly two meaningful values: 'user' and 'admin'.
--
-- Run the statement for the target account. Change the email accordingly.
-- ============================================================================

-- Promote an existing account to admin.
UPDATE public.tbl_users SET role = 'admin' WHERE email = 'admin@hiraya.com';

-- Verify the change.
SELECT id, email, role FROM public.tbl_users WHERE email = 'admin@hiraya.com';

-- Demote back to a normal customer (rollback / audit).
-- UPDATE public.tbl_users SET role = 'user' WHERE email = 'admin@hiraya.com';

-- List every privileged account.
-- SELECT id, email, role FROM public.tbl_users WHERE role = 'admin' ORDER BY id;
