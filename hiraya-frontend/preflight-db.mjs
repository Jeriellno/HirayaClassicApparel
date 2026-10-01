/*
 * HIRAYA — preflight. READ ONLY. Makes no changes.
 * Reports the real shape of the database so the migrations are written
 * against what is actually there, not what was assumed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.resolve(__dirname, '..', 'hiraya-backend', '.env');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const client = new Client({
  host: env.DB_HOST,
  port: Number(env.DB_PORT || 5432),
  database: env.DB_DATABASE,
  user: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

const show = (rows) => console.table(rows);

(async () => {
  await client.connect();
  console.log('CONNECTED to', env.DB_HOST, '/', env.DB_DATABASE, '\n');

  const t = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name;
  `);
  console.log('=== public tables ===');
  show(t.rows.map((r) => ({ table_name: r.table_name })));

  const c = await client.query(`
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('users','system_settings','products','garments','orders','audit_logs','user_two_factors')
    order by table_name, ordinal_position;
  `);
  console.log('\n=== columns of interest ===');
  show(c.rows);

  const r = await client.query(`
    select c.relname as table, c.relrowsecurity as rls_on, c.relforcerowsecurity as rls_forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname;
  `);
  console.log('\n=== RLS status ===');
  show(r.rows);

  const p = await client.query(`
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname;
  `);
  console.log('\n=== existing policies ===');
  show(p.rows);

  const f = await client.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'hiraya%';
  `);
  console.log('\n=== existing hiraya_* functions ===');
  show(f.rows);

  const au = await client.query(`
    select
      (select count(*) from auth.users) as auth_users,
      (select count(*) from auth.mfa_factors) as mfa_factors,
      (select count(*) from auth.mfa_amr) as mfa_amr;
  `);
  console.log('\n=== auth.users / MFA state ===');
  show(au.rows);

  const staff = await client.query(`
    select u.id, u.email, u.role, u.suspended_at
    from public.users u
    where lower(u.role) in ('admin','superadmin')
    order by u.role, u.email;
  `);
  console.log('\n=== Hiraya staff accounts ===');
  show(staff.rows);

  const link = await client.query(`
    select u.email, u.role, u.auth_id, a.id as matched_auth_id
    from public.users u
    left join auth.users a on lower(a.email) = lower(u.email)
    where lower(u.role) in ('admin','superadmin')
    order by u.email;
  `);
  console.log('\n=== staff <-> auth.users match (auth_id is the new column) ===');
  show(link.rows);

  await client.end();
})().catch(async (e) => {
  console.error('\nFAILED:', e.message);
  try { await client.end(); } catch { }
  process.exit(1);
});
