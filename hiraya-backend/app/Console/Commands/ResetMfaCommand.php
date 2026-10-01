<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * THE WAY BACK IN WHEN THE PHONE IS GONE.
 * =========================================
 *
 * This is now the ONLY recovery path for a locked-out staff account, and that
 * is a deliberate change rather than an oversight.
 *
 * The removed Laravel 2FA issued ten hashed recovery codes alongside enrollment,
 * so a lost phone was survivable by the account owner alone. Supabase's built-in
 * MFA has no recovery-code feature — the factor secret never leaves the
 * identity provider, so there is nothing for us to store a fallback against.
 * The trade is real and worth stating plainly: a staff member who loses their
 * phone now needs someone with server access, where before they could have used
 * a code from a drawer. That is worse for the user and better for an attacker,
 * because recovery codes get phished, shared over chat, and left in drawers.
 *
 * IT REQUIRES SERVER ACCESS, WHICH IS THE POINT
 * ---------------------------------------------
 * Anyone who can run this is already on the machine. No web endpoint can do
 * this, deliberately — otherwise a hijacked aal2 session could strip its own
 * second factor, which is exactly the attack the factor exists to stop.
 *
 * It clears the factor. It does NOT set a password, does NOT print a secret and
 * does NOT create an account.
 */

/*
 * THE CLASS NAME MUST MATCH THE FILE NAME
 * ----------------------------------------
 * This was `ResetTwoFactorCommand` inside `ResetMfaCommand.php`. PSR-4 autoloading
 * resolves a class by deriving the path from the class name, so a class whose name
 * does not match its file is never autoloadable — and in Laravel 11 commands are
 * discovered by scanning `app/Console/Commands`, so the file was found but the
 * class inside it was not. The result was the most confusing failure available:
 *
 *   ERROR  Command "hiraya:reset-mfa" is not defined.
 *
 * The command existed, the signature existed, the help text was right there in the
 * source — and the only recovery path from a locked-out staff account was
 * unreachable with no error pointing at the cause.
 */
class ResetMfaCommand extends Command
{
    protected $signature = 'hiraya:reset-mfa
                            {email : The account to clear the authenticator factor from.}
                            {--force : Skip the confirmation prompt. For automation and CI only.}';

    protected $description = 'Remove a lost/unusable Supabase authenticator factor. Requires server access.';

    public function handle(): int
    {
        $email = strtolower(trim($this->argument('email')));

        $user = User::where('email', $email)->first();

        if (! $user) {
            $this->error("  No Hiraya account found for {$email}.");

            return self::FAILURE;
        }

        if (! in_array(strtolower((string) $user->role), ['admin', 'superadmin'], true)) {
            /*
             * Only staff can hold a factor, since only staff sign in through the
             * console. Saying so plainly beats a confusing "no factors found" on
             * a customer address.
             */
            $this->warn("  {$email} is a {$user->role} account. Customers do not use an authenticator.");

            return self::SUCCESS;
        }

        // The Supabase identity, found through the users.auth_id link.
        $authId = $user->auth_id;

        if (! $authId) {
            $this->error('  This account is not linked to a Supabase identity.');
            $this->line('  Run supabase/migrations/0002_link_supabase_auth_users.sql to backfill auth_id.');

            return self::FAILURE;
        }

        try {
            $factors = DB::table('auth.mfa_factors')
                ->where('user_id', $authId)
                ->where('factor_type', 'totp')
                ->get(['id', 'status', 'friendly_name']);
        } catch (\Throwable $e) {
            $this->error('  Could not read auth.mfa_factors: ' . $e->getMessage());
            $this->line('  This must run against the Supabase Postgres database directly.');

            return self::FAILURE;
        }

        if ($factors->isEmpty()) {
            $this->warn("  {$email} has no authenticator enrolled. Nothing to do.");

            return self::SUCCESS;
        }

        /*
         * CONFIRMED, AND THE STATE IS STATED FIRST.
         *
         * This removes a security control from a high-privilege account. The
         * prompt names the account and lists what is about to be destroyed, so
         * nobody runs it against the wrong address in a hurry.
         */
        $this->newLine();
        $this->line("  Account : {$user->email}  ({$user->role})");
        $this->line('  Factors : ' . $factors->count());
        foreach ($factors as $factor) {
            /*
             * THE ELVIS OPERATOR IS COMPUTED BEFORE INTERPOLATION.
             * `{$factor->friendly_name ?: 'Authenticator'}` is a PARSE ERROR — a
             * `?:` cannot sit inside `{...}` in a double-quoted string. It reads as
             * one literal expression to the lexer, so this file has never been
             * valid PHP, which is why the command was never discovered:
             *
             *   ERROR  Command "hiraya:reset-mfa" is not defined.
             *
             * The failure pointed at the class name, but the real cause was this
             * one line. Both had to be fixed for the command to exist at all.
             */
            $name = $factor->friendly_name ?: 'Authenticator';

            $this->line("    - {$name}  [{$factor->status}]");
        }
        $this->newLine();
        $this->warn('  After this, the account is aal1 only and CANNOT open the console.');

        /*
         * `--force` EXISTS BECAUSE A PIPE DOES NOT SATISFY THIS PROMPT.
         *
         * `confirm()` reads from the console's input handle, so `echo y | php
         * artisan hiraya:reset-mfa ...` does not answer it — the command sees no
         * input and falls through to the `false` default, reporting "Cancelled.
         * Nothing was changed." while having changed nothing at all. That is a
         * genuinely dangerous failure: the operator is told the reset did not
         * happen, retries, and hits the same wall, with no hint that the flag
         * they wanted was ignored rather than unrecognised.
         *
         * A named flag cannot be silently dropped, so non-interactive callers
         * have something that actually works. It is deliberately NOT the default
         * — an interactive human still has to name the account they are about to
         * strip of a security control.
         */
        if (! $this->option('force') && ! $this->confirm('  Remove the authenticator factor from this account?', false)) {
            $this->line('  Cancelled. Nothing was changed.');

            return self::SUCCESS;
        }

        try {
            $deleted = DB::table('auth.mfa_factors')
                ->where('user_id', $authId)
                ->where('factor_type', 'totp')
                ->delete();
        } catch (\Throwable $e) {
            $this->error('  Failed to delete the factor: ' . $e->getMessage());

            return self::FAILURE;
        }

        $this->newLine();
        $this->info("  Removed {$deleted} factor(s).");
        $this->newLine();
        $this->line('  <fg=yellow>The account cannot reach /admin until it re-enrols.</>');
        $this->line('  Re-enrol from the browser console while signed in:');
        $this->line('    const { data } = await supabase.auth.mfa.enroll({ factorType: "totp" });');
        $this->line('    await supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code });');
        $this->newLine();

        return self::SUCCESS;
    }
}
