-- =====================================================================
-- HIRAYA — link Laravel `public.users` to Supabase `auth.users`.
-- Run this BEFORE 0001_hiraya_rls_aal2.sql, which depends on `auth_id`.
-- Idempotent.
--
-- ---------------------------------------------------------------------
-- WHY THIS IS A SQL FILE AND NOT A LARAVEL MIGRATION
-- ---------------------------------------------------------------------
-- The column is needed by RLS policies, and policies are created by this
-- script. If the column only arrived via `php artisan migrate`, the very
-- first `alter table ... enable row level security` would run against a
-- schema that does not have it, and the policies would fail to compile.
-- Doing it here keeps the column and the policies in one ordered,
-- re-runnable sequence.
--
-- ---------------------------------------------------------------------
-- WHY THE LINK IS NEEDED AT ALL (option C, the gateway)
-- ---------------------------------------------------------------------
-- Supabase identifies users by a uuid (`auth.users.id`); Laravel's table has
-- a bigint `users.id` with no reference to it. Without a link, every policy
-- has to fall back to matching on email — which works, but is only as good
-- as the assumption that nobody can register an address that belongs to
-- staff. This column makes the join exact instead of inferential.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------
alter table public.users add column if not exists auth_id uuid;

-- One Hiraya account may link to at most one Supabase identity, so a
-- reversed duplicate would be ambiguous when resolving "which user is this".
create unique index if not exists users_auth_id_unique on public.users (auth_id)
where
    auth_id is not null;

comment on column public.users.auth_id is 'Supabase auth.users.id. Links this Hiraya account to the Supabase identity that owns the aal/aal2 session.';

-- ---------------------------------------------------------------------
-- 2. Backfill, matched on EXACT email.
--
--    Runs in this order for a reason: the unique index from step 1 must exist
--    first, so that if the data contains a genuine duplicate the migration
--    FAILS LOUDLY here rather than silently leaving two rows claiming the
--    same Supabase identity. A half-linked staff account is an account whose
--    role resolution silently falls back to email — exactly the kind of
--    quiet degradation this whole exercise is meant to remove.
--
--    Preview before running:
--      select u.email, u.role, a.id as auth_id
--      from public.users u
--      join auth.users a on lower(a.email) = lower(u.email);
-- ---------------------------------------------------------------------
update public.users u
set
    auth_id = a.id
from auth.users a
where
    u.auth_id is null
    and lower(a.email) = lower(u.email);

-- ---------------------------------------------------------------------
-- 3. Verification — EVERY staff account must now be linked.
--    A NULL here means that account's role will be resolved by email
--    fallback rather than by exact match, and it must be fixed before the
--    console is considered secure.
-- ---------------------------------------------------------------------
-- select u.id,
--        u.email,
--        u.role,
--        u.auth_id is not null as linked
-- from public.users u
-- where u.role in ('admin', 'superadmin')
-- order by u.role, u.email;
--
-- Expected: linked = true for every row.

-- ---------------------------------------------------------------------
-- 4. Keep the link from silently drifting.
--
--    A trigger on auth.users would need SECURITY DEFINER and a write into the
--    application schema from the auth schema, which is more privilege than
--    this is worth. The column is instead treated as written ONCE, at
--    account creation, and re-checked by the verification query above.
--
--    This is acceptable because a Hiraya account is created by Hiraya (or by
--    a superadmin through the console), not by signing up twice. What must
--    never happen is the backfill above being re-run after someone CHANGES
--    an email on only one side — which is why step 2 filters on
--    `auth_id is null` and overwrites nothing.
-- =====================================================================