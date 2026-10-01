<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\SupabaseIdentity;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;

/**
 * SyncStaffIdentityCommand — REPAIRS AN STAFF ACCOUNT THAT CANNOT BE SIGNED INTO.
 * =================================================================================
 *
 * THE FAILURE THIS EXISTS TO FIX
 * ------------------------------
 * A staff account is two rows: `users` (Laravel) and `auth.users` (Supabase). A
 * staff sign-in checks the password against BOTH, and the console is authorized by
 * the Supabase JWT. Every provisioning path before this command wrote only the
 * Laravel row, so an account could exist that was provably unsignable-in:
 *
 *     /login  ->  POST /api/login  ->  Laravel Hash::check  ->  PASS
 *             ->  Supabase sign-in ->  400 Invalid login credentials
 *
 * Nothing in the application could recover from that. The only remedy was the
 * Supabase Dashboard, clicked by hand, which is not a recovery path — it is an
 * admission that the tool has none.
 *
 * WHY THIS IS A SEPARATE COMMAND AND NOT A FLAG
 * ----------------------------------------------
 * The dangerous half of this is that a WRONG guess at the correct password produces
 * a NEW lockout: the Laravel password and the GoTrue password would drift apart
 * again, and the owner who is already locked out would no longer be able to fix it
 * with the password they know. So this command NEVER invents a password. It has two
 * modes, and both are explicit:
 *
 *   --check                 report only, change nothing. Always safe.
 *   --set-password          copy the PLAINTEXT password you type into GoTrue.
 *   (no flag)               copy the password from the LARAVEL row into GoTrue.
 *                           This is the right answer almost every time, because
 *                           the Laravel row is the one that works today.
 *
 * THE DEFAULT MODE IS THE ONLY ONE THAT CANNOT MAKE THINGS WORSE
 * --------------------------------------------------------------
 * With no flag, the plaintext password cannot be read — Laravel stores only a
 * bcrypt hash, and a hash is not reversible. So the command PROMPTS for it and then
 * verifies it against the Laravel row before writing it anywhere. If the typed
 * password does not match Laravel, nothing is written. A user who cannot remember
 * the password is told to use `--set-password` with a NEW one instead, which is
 * their choice to make and is a deliberate reset rather than a sync.
 *
 * NEITHER MODE PRINTS A PASSWORD, AND NEITHER LOGS ONE.
 */
class SyncStaffIdentityCommand extends Command
{
    protected $signature = 'hiraya:sync-staff-identity
                            {email? : The staff account to inspect or repair.}
                            {--check : Report the state of both rows and change nothing.}
                            {--set-password : Write a NEW password to BOTH systems, replacing the old one.}';

    protected $description = 'Report or repair the Supabase identity of a staff account (password, not MFA).';

    public function handle(): int
    {
        $this->newLine();
        $this->line('  <options=bold>Hiraya — Staff Identity Sync</>');
        $this->line('  Repairs accounts where Laravel and Supabase disagree on the password.');
        $this->newLine();

        if (!SupabaseIdentity::connection()) {
            $this->error('  Supabase is not configured.');
            $this->line('  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in hiraya-backend/.env,');
            $this->line('  then run: php artisan config:clear');
            $this->newLine();

            return self::FAILURE;
        }

        $email = SupabaseIdentity::canonicalEmail(
            $this->argument('email') ?: $this->ask('Staff email address')
        );

        $user = User::where('email', $email)->first();

        if (!$user) {
            $this->error("  No Hiraya account found for {$email}.");

            return self::FAILURE;
        }

        $role = strtolower((string) $user->role);

        if (!in_array($role, ['admin', 'superadmin'], true)) {
            /*
             * A customer never signs in through Supabase, so a missing or mismatched
             * GoTrue password is not a defect on their account — it is simply
             * irrelevant. Saying that plainly beats syncing a password nobody will
             * ever type.
             */
            $this->warn("  {$email} is a {$role} account, not staff.");
            $this->line('  Customers sign in through Laravel only. Nothing to do.');
            $this->newLine();

            return self::SUCCESS;
        }

        $authId = SupabaseIdentity::findAuthId($email);
        $linkedId = $user->auth_id;
        $isBroken = $authId === null || ($linkedId && $linkedId !== $authId);

        $this->line("  Email        {$email}");
        $this->line("  Role         {$role}");
        $this->line('  Laravel row  present (password hash stored)');
        $this->line('  Supabase id  ' . ($authId ?: '<MISSING>'));
        $this->line('  users.auth_id ' . ($linkedId ?: '<null>'));
        $this->newLine();

        if ($this->option('check')) {
            $this->reportVerdict($authId, $linkedId);
            $this->newLine();

            return self::SUCCESS;
        }

        if ($this->option('set-password')) {
            return $this->resetBoth($user, $email);
        }

        return $this->syncFromLaravel($user, $email, $authId);
    }

    /** Report only. Never writes. */
    private function reportVerdict(?string $authId, ?string $linkedId): void
    {
        if ($authId === null) {
            $this->error('  BROKEN: no Supabase identity exists for this address.');
            $this->line('  The account can never be signed into — Laravel accepts the password');
            $this->line('  and Supabase has never heard of it.');
            $this->newLine();
            $this->line('  Fix:  php artisan hiraya:sync-staff-identity ' . '  (no flags)');
            $this->line('  or:   php artisan hiraya:sync-staff-identity --set-password');
            return;
        }

        if ($linkedId && $linkedId !== $authId) {
            $this->error('  BROKEN: users.auth_id does not match the Supabase identity.');
            $this->line("    users.auth_id : {$linkedId}");
            $this->line("    Supabase id   : {$authId}");
            $this->line('  The two systems may be reading different accounts. Re-run the link');
            $this->line('  migration, then sync the password.');
            return;
        }

        $this->info('  Identity is linked.');
        $this->line('  Passwords may still differ — GoTrue stores a separate hash that cannot');
        $this->line('  be read back. If sign-in is refused after the password is accepted,');
        $this->line('  re-run this command with no flags to push the Laravel password across.');
    }

    /**
     * THE DEFAULT MODE — copy the working password across.
     *
     * The password is PROMPTED for and VERIFIED against the Laravel row before it is
     * written to GoTrue. That verification is the whole safety property: it means
     * this command cannot desynchronise an account that is currently working, because
     * it will only ever write a password that already authenticates against Laravel.
     */
    private function syncFromLaravel(User $user, string $email, ?string $authId): int
    {
        $this->line('  Re-enter the password that works on the Hiraya sign-in form.');
        $this->line('  It is checked against the Laravel row before anything is written.');
        $this->newLine();

        $password = (string) $this->secret('Current password');
        $confirm = (string) $this->secret('Confirm password');

        if ($password !== $confirm) {
            $this->error('  The two passwords did not match. Nothing was changed.');

            return self::FAILURE;
        }

        if (!Hash::check($password, $user->password)) {
            /*
             * THE MOST IMPORTANT BRANCH IN THIS COMMAND.
             *
             * Writing an unverified password here is precisely how an account gets
             * locked out FOREVER: the GoTrue hash would stop matching the Laravel
             * hash, and since Laravel stores only a one-way hash, the owner could no
             * longer recover by re-trying — they would have forgotten the only
             * password that works anywhere.
             */
            $this->error('  That password is not this account\'s password. Nothing was changed.');
            $this->line('  If you do not know it, use --set-password to choose a NEW one:');
            $this->line('    php artisan hiraya:sync-staff-identity ' . $email . ' --set-password');
            $this->newLine();

            return self::FAILURE;
        }

        $this->newLine();

        if ($authId === null) {
            $this->line('  Creating the Supabase identity with the verified password...');

            try {
                $newId = SupabaseIdentity::createWithPassword($email, $password, $user->full_name);
            } catch (\Throwable $e) {
                $this->error('  ' . $e->getMessage());

                return self::FAILURE;
            }

            $user->forceFill(['auth_id' => $newId])->save();
            $this->info("  Supabase identity created and linked: {$newId}");
        } else {
            $this->line('  Writing the verified password to the existing Supabase identity...');

            try {
                SupabaseIdentity::setPassword($email, $password);
            } catch (\Throwable $e) {
                $this->error('  ' . $e->getMessage());

                return self::FAILURE;
            }

            $this->info('  Supabase password updated.');

            if (!$user->auth_id) {
                $user->forceFill(['auth_id' => $authId])->save();
                $this->line('  users.auth_id backfilled.');
            }
        }

        $this->newLine();
        $this->info('  Done. Sign in at /login with this password, then set up the authenticator.');
        $this->line('  A password alone does not open /superadmin — the 6-digit code is required too.');
        $this->newLine();

        return self::SUCCESS;
    }

    /**
     * `--set-password` — choose a NEW password and write it to BOTH systems.
     *
     * This is the deliberate reset, for an owner who does not know the current
     * password. Both rows MUST be written, or the next sign-in recreates the exact
     * mismatch this command was run to remove. The Supabase write happens FIRST so
     * that a refusal leaves the account in the old (known, reported) broken state
     * rather than in a new one where the working password no longer works.
     */
    private function resetBoth(User $user, string $email): int
    {
        $this->line('  Choose a NEW password. It replaces the current one in BOTH systems.');
        $this->newLine();

        $password = (string) $this->secret('New password (min 8, 1 uppercase, 1 number)');
        $confirm = (string) $this->secret('Confirm new password');

        if ($password !== $confirm) {
            $this->error('  The two passwords did not match. Nothing was changed.');

            return self::FAILURE;
        }

        if (strlen($password) < 8 || !preg_match('/[A-Z]/', $password) || !preg_match('/\d/', $password)) {
            $this->error('  Password must be at least 8 characters, with 1 uppercase letter and 1 number.');
            $this->line('  Nothing was changed.');

            return self::FAILURE;
        }

        $this->newLine();
        $this->line('  Writing the new password to the Supabase identity first...');

        try {
            $authId = SupabaseIdentity::findAuthId($email);

            if ($authId) {
                SupabaseIdentity::setPassword($email, $password);
                $this->info('  Supabase password updated.');
            } else {
                $authId = SupabaseIdentity::createWithPassword($email, $password, $user->full_name);
                $this->info('  Supabase identity created.');
            }
        } catch (\Throwable $e) {
            $this->error('  ' . $e->getMessage());
            $this->line('  The Hiraya password was NOT changed, so nothing is more broken than before.');

            return self::FAILURE;
        }

        $user->forceFill([
            'auth_id' => $authId ?: $user->auth_id,
            'password' => Hash::make($password),
        ])->save();

        $this->info('  Hiraya password updated.');

        $this->newLine();
        $this->info('  Both systems now hold the same password.');
        $this->line('  Sign in at /login, then set up the authenticator on the verification step.');
        $this->newLine();

        return self::SUCCESS;
    }
}
