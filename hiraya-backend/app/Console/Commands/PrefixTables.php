<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Renames every table in the `public` schema to the `tbl_` naming convention
 * (users -> tbl_users), or back again with --rollback.
 *
 * WHY A COMMAND AND NOT A MIGRATION
 * ---------------------------------
 * The rename includes Laravel's own `migrations` table. A migration that
 * renamed it would be recorded in a table that no longer exists under the old
 * name, and after the switch Laravel (with DB_PREFIX=tbl_) looks for
 * `tbl_migrations` — so this has to run OUTSIDE the migrator, once, as a
 * cutover. The application side is the `prefix` on the pgsql connection
 * (config/database.php, DB_PREFIX): Laravel then adds `tbl_` to every table it
 * names, so models, query builders, validation rules and schema changes keep
 * their short names in code.
 *
 * WHAT IT RENAMES, IN ONE TRANSACTION (Postgres DDL is transactional, so a
 * failure part-way leaves the database exactly as it was):
 *   1. each table                         users            -> tbl_users
 *   2. its constraints / indexes / owned  users_pkey       -> tbl_users_pkey
 *      sequences that carry its name      users_id_seq     -> tbl_users_id_seq
 *      (matches what Laravel generates for new tables, since `prefix_indexes`
 *      is on)
 *   3. the Supabase helper `hiraya_current_role()`, whose SQL body names the
 *      users table as text and would otherwise break every RLS policy using it.
 *
 * RLS policies, foreign keys, the realtime publication and column defaults
 * reference tables by OID and follow the rename on their own.
 *
 * AFTER RUNNING: set DB_PREFIX=tbl_ in .env (or DB_PREFIX= after --rollback),
 * and deploy the frontend, which reads `tbl_users` through supabase-js.
 */
class PrefixTables extends Command
{
    protected $signature = 'hiraya:prefix-tables
                            {--rollback : Strip the tbl_ prefix instead of adding it}
                            {--dry-run : Print the statements without running them}
                            {--force : Do not ask for confirmation}';

    protected $description = 'Rename all public tables to tbl_<name> (or back with --rollback).';

    private const PREFIX = 'tbl_';

    public function handle(): int
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->error('This cutover is written for PostgreSQL (Supabase) only.');
            return self::FAILURE;
        }

        $rollback = (bool) $this->option('rollback');
        $statements = $this->plan($rollback);

        if ($statements === []) {
            $this->info($rollback ? 'No tbl_ tables to restore.' : 'Every table already carries the tbl_ prefix.');
            return self::SUCCESS;
        }

        foreach ($statements as $sql) {
            $this->line($sql . ';');
        }

        if ($this->option('dry-run')) {
            $this->comment(count($statements) . ' statements (dry run, nothing executed).');
            return self::SUCCESS;
        }

        if (!$this->option('force') && !$this->confirm('Run these ' . count($statements) . ' statements now?')) {
            return self::FAILURE;
        }

        DB::transaction(function () use ($statements) {
            foreach ($statements as $sql) {
                DB::statement($sql);
            }
        });

        $this->info('Done. Now set DB_PREFIX=' . ($rollback ? '' : self::PREFIX) . ' in .env.');

        return self::SUCCESS;
    }

    /** Every statement the cutover needs, in execution order. */
    private function plan(bool $rollback): array
    {
        $tables = collect(DB::select(
            "select c.oid, c.relname
               from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind in ('r', 'p')
              order by c.relname"
        ))->filter(fn ($t) => $rollback
            ? str_starts_with($t->relname, self::PREFIX)
            : !str_starts_with($t->relname, self::PREFIX));

        $statements = [];

        foreach ($tables as $table) {
            $old = $table->relname;
            $new = $rollback ? substr($old, strlen(self::PREFIX)) : self::PREFIX . $old;
            $rename = fn (string $name) => $rollback
                ? (str_starts_with($name, $old . '_') ? $new . substr($name, strlen($old)) : null)
                : (str_starts_with($name, $old . '_') ? self::PREFIX . $name : null);

            $statements[] = sprintf('alter table public.%s rename to %s', $this->ident($old), $this->ident($new));

            // Constraints first: renaming a primary-key / unique constraint also
            // renames the index behind it, so those indexes are skipped below.
            $constraints = DB::select('select conname from pg_constraint where conrelid = ? order by conname', [$table->oid]);
            $constraintNames = [];
            foreach ($constraints as $c) {
                $constraintNames[] = $c->conname;
                $target = $rename($c->conname);
                if ($target !== null && strlen($target) <= 63) {
                    $statements[] = sprintf('alter table public.%s rename constraint %s to %s',
                        $this->ident($new), $this->ident($c->conname), $this->ident($target));
                }
            }

            $indexes = DB::select(
                'select i.relname from pg_index x join pg_class i on i.oid = x.indexrelid where x.indrelid = ? order by i.relname',
                [$table->oid]
            );
            foreach ($indexes as $i) {
                if (in_array($i->relname, $constraintNames, true)) {
                    continue;
                }
                $target = $rename($i->relname);
                if ($target !== null && strlen($target) <= 63) {
                    $statements[] = sprintf('alter index public.%s rename to %s', $this->ident($i->relname), $this->ident($target));
                }
            }

            $sequences = DB::select(
                "select s.relname
                   from pg_depend d
                   join pg_class s on s.oid = d.objid and s.relkind = 'S'
                  where d.refobjid = ? and d.deptype in ('a', 'i')
                  order by s.relname",
                [$table->oid]
            );
            foreach ($sequences as $s) {
                $target = $rename($s->relname);
                if ($target !== null && strlen($target) <= 63) {
                    $statements[] = sprintf('alter sequence public.%s rename to %s', $this->ident($s->relname), $this->ident($target));
                }
            }
        }

        if ($tables->isNotEmpty() && $this->functionExists('hiraya_current_role')) {
            $statements[] = $this->currentRoleFunction($rollback ? 'users' : self::PREFIX . 'users');
        }

        return $statements;
    }

    private function functionExists(string $name): bool
    {
        return (bool) DB::selectOne(
            "select 1 as ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = ?",
            [$name]
        );
    }

    /**
     * `hiraya_current_role()` as created by supabase/migrations/0001, pointed
     * at the given users table. Same signature, so every policy calling it
     * keeps working.
     */
    private function currentRoleFunction(string $usersTable): string
    {
        $t = 'public.' . $this->ident($usersTable);

        return <<<SQL
create or replace function public.hiraya_current_role()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as \$function\$
  select coalesce(
    (select u.role::text
       from {$t} u
      where u.auth_id = auth.uid()),
    (select u.role::text
       from {$t} u
      where lower(u.email) = lower(auth.jwt() ->> 'email'))
  );
\$function\$
SQL;
    }

    private function ident(string $name): string
    {
        return '"' . str_replace('"', '""', $name) . '"';
    }
}
