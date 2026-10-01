-- =====================================================================
-- HIRAYA — Supabase Postgres: RLS + Authenticator Assurance Level (AAL)
-- Title: "AI-Assisted Styling For Hiraya"
--
-- Run in  Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Idempotent: safe to re-run.
--
-- ---------------------------------------------------------------------
-- READ THIS FIRST — WHY THERE IS NO `profiles` TABLE
-- ---------------------------------------------------------------------
-- An earlier draft of this file keyed every policy on `public.profiles`.
-- That table DOES NOT EXIST in this project. The real schema is Laravel's,
-- created by the migrations in hiraya-backend/database/migrations:
--
--   public.users            (id bigint, email, password, role, suspended_at)
--   public.products / garments / garment_sizes
--   public.orders / order_items
--   public.system_settings      <- NOT system_configs
--   public.audit_logs, feedbacks, api_credentials, try_on_sessions
--
-- So the policies below join on `public.users`, and rely on the `auth_id`
-- column added by 0003_link_supabase_auth_users.sql. Run 0003 FIRST.
--
-- THE MODEL
--   aal1  password only          -> role 'user'        (customer/student)
--   aal2  password + TOTP factor -> role 'admin' | 'superadmin'
--
-- Every admin policy requires BOTH conditions together:
--     1. role IN ('admin','superadmin')   (from public.users)
--     2. (select auth.jwt() ->> 'aal') = 'aal2'
-- Neither alone is sufficient, and the second is what makes the first
-- meaningful: a password-only staff session is a real session and is still
-- refused.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Helper functions
-- ---------------------------------------------------------------------
-- SECURITY DEFINER so a policy can read `users` without recursing through
-- that table's own RLS policies (an infinite loop Postgres rejects).
create or replace function public.hiraya_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- Preferred: the exact link added by 0003. bigint -> uuid, no ambiguity.
    (select u.role::text
       from public.users u
      where u.auth_id = auth.uid()),
    -- Fallback for accounts not yet backfilled: exact email match only.
    -- `=`, never LIKE, so this cannot be widened into a prefix match.
    (select u.role::text
       from public.users u
      where lower(u.email) = lower(auth.jwt() ->> 'email'))
  );
$$;

-- TRUE only for a session that actually completed the TOTP step.
-- 'aal1', NULL and a missing claim are all deliberately NOT enough.
create or replace function public.hiraya_is_aal2()
returns boolean
language sql
stable
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;

-- The single condition every admin policy uses: role AND aal2, together.
create or replace function public.hiraya_is_privileged_aal2()
returns boolean
language sql
stable
as $$
  select public.hiraya_current_role() in ('admin', 'superadmin')
     and public.hiraya_is_aal2();
$$;

-- Restrict EXECUTE: these must not be runnable by anon.
revoke all on function public.hiraya_current_role()           from public, anon;
revoke all on function public.hiraya_is_aal2()                from public, anon;
revoke all on function public.hiraya_is_privileged_aal2()     from public, anon;
grant execute on function public.hiraya_current_role()       to authenticated, service_role;
grant execute on function public.hiraya_is_aal2()            to authenticated, service_role;
grant execute on function public.hiraya_is_privileged_aal2() to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 1. users — the role table itself.
--    Customers read and update ONLY their own row, and cannot change `role`:
--    the update policy re-asserts the existing role in its WITH CHECK, so a
--    self-promotion to superadmin is rejected by the DATABASE even if the
--    client sends role='superadmin'. This is the single most important
--    policy in the file — without it, RLS protects the catalogue while the
--    role column itself stays writable by anyone.
-- ---------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.users force row level security;

drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select to authenticated
  using (
    auth_id = auth.uid()
    or lower(email) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update to authenticated
  using (auth_id = auth.uid() or lower(email) = lower(auth.jwt() ->> 'email'))
  with check (
    (auth_id = auth.uid() or lower(email) = lower(auth.jwt() ->> 'email'))
    -- The role this row already has must be unchanged by the update.
    and role = public.hiraya_current_role()
  );

drop policy if exists users_admin_read on public.users;
create policy users_admin_read on public.users
  for select to authenticated
  using (public.hiraya_is_privileged_aal2());

drop policy if exists users_admin_update on public.users;
create policy users_admin_update on public.users
  for update to authenticated
  using (public.hiraya_is_privileged_aal2())
  with check (public.hiraya_is_privileged_aal2());

drop policy if exists users_admin_insert on public.users;
create policy users_admin_insert on public.users
  for insert to authenticated
  with check (public.hiraya_is_privileged_aal2());

drop policy if exists users_admin_delete on public.users;
create policy users_admin_delete on public.users
  for delete to authenticated
  using (public.hiraya_is_privileged_aal2());


-- ---------------------------------------------------------------------
-- 2. system_settings — superadmin only.
--    (Not `system_configs`; that name was wrong. The table created by
--    create_superadmin_tables is `system_settings`.)
-- ---------------------------------------------------------------------
alter table public.system_settings enable row level security;
alter table public.system_settings force row level security;

drop policy if exists system_settings_select_aal2 on public.system_settings;
create policy system_settings_select_aal2 on public.system_settings
  for select to authenticated
  using (public.hiraya_current_role() = 'superadmin' and public.hiraya_is_aal2());

drop policy if exists system_settings_insert_aal2 on public.system_settings;
create policy system_settings_insert_aal2 on public.system_settings
  for insert to authenticated
  with check (public.hiraya_current_role() = 'superadmin' and public.hiraya_is_aal2());

drop policy if exists system_settings_update_aal2 on public.system_settings;
create policy system_settings_update_aal2 on public.system_settings
  for update to authenticated
  using (public.hiraya_current_role() = 'superadmin' and public.hiraya_is_aal2())
  with check (public.hiraya_current_role() = 'superadmin' and public.hiraya_is_aal2());

drop policy if exists system_settings_delete_aal2 on public.system_settings;
create policy system_settings_delete_aal2 on public.system_settings
  for delete to authenticated
  using (public.hiraya_current_role() = 'superadmin' and public.hiraya_is_aal2());


-- ---------------------------------------------------------------------
-- 3. products + garments — catalogue.
--    Public READ (the storefront lists the catalogue anonymously), staff
--    WRITE at aal2 only. This is the pattern to copy for any public-read,
--    staff-write table.
-- ---------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.products force row level security;

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated
  using (true);

drop policy if exists products_admin_insert on public.products;
create policy products_admin_insert on public.products
  for insert to authenticated
  with check (public.hiraya_is_privileged_aal2());

drop policy if exists products_admin_update on public.products;
create policy products_admin_update on public.products
  for update to authenticated
  using (public.hiraya_is_privileged_aal2())
  with check (public.hiraya_is_privileged_aal2());

drop policy if exists products_admin_delete on public.products;
create policy products_admin_delete on public.products
  for delete to authenticated
  using (public.hiraya_is_privileged_aal2());

alter table public.garments enable row level security;
alter table public.garments force row level security;

drop policy if exists garments_public_read on public.garments;
create policy garments_public_read on public.garments
  for select to anon, authenticated
  using (true);

drop policy if exists garments_admin_insert on public.garments;
create policy garments_admin_insert on public.garments
  for insert to authenticated
  with check (public.hiraya_is_privileged_aal2());

drop policy if exists garments_admin_update on public.garments;
create policy garments_admin_update on public.garments
  for update to authenticated
  using (public.hiraya_is_privileged_aal2())
  with check (public.hiraya_is_privileged_aal2());

drop policy if exists garments_admin_delete on public.garments;
create policy garments_admin_delete on public.garments
  for delete to authenticated
  using (public.hiraya_is_privileged_aal2());


-- ---------------------------------------------------------------------
-- 4. orders — a customer reads THEIR OWN orders at aal1 (order history is
--    not an admin surface), but staff read and edit ALL orders at aal2.
--    An aal1 admin therefore cannot see the order queue at all.
-- ---------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.orders force row level security;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated
  using (
    user_id = (select u.id from public.users u
                where u.auth_id = auth.uid()
                   or lower(u.email) = lower(auth.jwt() ->> 'email'))
  );

drop policy if exists orders_admin_read on public.orders;
create policy orders_admin_read on public.orders
  for select to authenticated
  using (public.hiraya_is_privileged_aal2());

drop policy if exists orders_admin_insert on public.orders;
create policy orders_admin_insert on public.orders
  for insert to authenticated
  with check (public.hiraya_is_privileged_aal2());

drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders
  for update to authenticated
  using (public.hiraya_is_privileged_aal2())
  with check (public.hiraya_is_privileged_aal2());

drop policy if exists orders_admin_delete on public.orders;
create policy orders_admin_delete on public.orders
  for delete to authenticated
  using (public.hiraya_is_privileged_aal2());


-- ---------------------------------------------------------------------
-- 5. audit_logs — append-only trail of aal2 staff actions.
--    Insert-only by design: there is deliberately NO update or delete
--    policy, so history cannot be rewritten through the API even by a
--    superadmin. The Laravel console writes these server-side with the
--    service role; the browser only ever inserts.
-- ---------------------------------------------------------------------
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

drop policy if exists audit_logs_insert_aal2 on public.audit_logs;
create policy audit_logs_insert_aal2 on public.audit_logs
  for insert to authenticated
  with check (public.hiraya_is_privileged_aal2());

drop policy if exists audit_logs_read_superadmin on public.audit_logs;
create policy audit_logs_read_superadmin on public.audit_logs
  for select to authenticated
  using (public.hiraya_current_role() = 'superadmin' and public.hiraya_is_aal2());


-- ---------------------------------------------------------------------
-- 6. VERIFICATION — run this after every deployment.
--
--    Every listed table must show relrowsecurity = true, and no policy may
--    reference a condition other than hiraya_is_privileged_aal2 /
--    hiraya_is_aal2 / hiraya_current_role.
-- ---------------------------------------------------------------------
-- select c.relname       as table,
--        c.relrowsecurity as rls_on,
--        p.polyname,
--        p.polcmd
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- left join pg_policy p on p.polrelid = c.oid
-- where n.nspname = 'public'
--   and c.relname in ('users','system_settings','products','garments','orders','audit_logs')
-- order by c.relname, p.polyname;
