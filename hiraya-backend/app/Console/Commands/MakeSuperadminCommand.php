<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\SupabaseIdentity;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * CREATES THE ONE SUPER ADMIN. RUN ONCE, FROM THE SERVER CONSOLE.
 * =============================================================
 *
 * WHY THIS EXISTS NOW
 * -------------------
 * Until now the only way to get a superadmin was to open /superadmin — which is
 * exactly the hole that has now been closed. The console requires a signed-in
 * superadmin to get in, so a fresh deployment with no superadmin is a chicken-
 * and-egg problem. This command is the way out: it runs on the machine, not
 * through the web, and it is the ONLY way to create the first one.
 *
 * IT DOES NOT PRINT A PASSWORD, AND IT DOES NOT TAKE ONE ON THE COMMAND LINE.
 * ------------------------------------------------------------
 * Both matter:
 *   - a password typed as an argument lands in the shell history and in `ps`
 *     output for every other user on the machine
 *   - a password printed to the terminal ends up in scrollback, in a screen
 *     share, and in a pasted log
 *
 * So it prompts, twice, with confirmation hidden, and you type it yourself.
 *
 * THE FIRST SUPER ADMIN IS THE ONE THAT MATTERS MOST
 * -------------------------------------------------
 * This account can export the entire database and read the audit trail. It
 * should have an authenticator app on it, which the command reminds you to set
 * up immediately after signing in. Nothing is enforced on day one — a lockout
 * on the very first login, with no way back except another terminal, is a worse
 * outcome than a window of vulnerability you can close in thirty seconds.
 */
class MakeSuperadminCommand extends Command
{
    protected $signature = 'hiraya:make-superadmin
                            {--email= : The account email. Prompted if omitted.}
                            {--name= : The owner\'s name. Prompted if omitted.}';

    protected $description = 'Create the Super Admin account (the only way to bootstrap the console).';

    public function handle(): int
    {
        $this->newLine();
        $this->line('  <options=bold>Hiraya — Super Admin Setup</>');
        $this->line('  Creates the account that can reach /superadmin.');
        $this->newLine();

        $email = strtolower(trim($this->option('email') ?: $this->ask('Email address')));
        $name = trim($this->option('name') ?: $this->ask('Full name'));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('That is not a valid email address.');
            return self::FAILURE;
        }

        $existing = User::where('email', $email)->first();

        if ($existing) {
            /*
             * PROMOTING AN EXISTING CUSTOMER.
             *
             * This is the common case: the owner already shops on the site and
             * just needs to run the console. The row is REUSED rather than
             * duplicated, so their orders, measurements and wishlist survive
             * promotion — creating a second row with the same address would be
             * refused by the unique index anyway.
             */
            if ($existing->role === 'superadmin') {
                $this->warn("  {$email} is already a Super Admin. Nothing to do.");
                return self::SUCCESS;
            }

            if (!$this->confirm("  {$email} already exists as a {$existing->role}. Promote it to Super Admin?", true)) {
                $this->line('  Cancelled. Nothing was changed.');
                return self::SUCCESS;
            }

            $existing->forceFill([
                'full_name' => $name ?: $existing->full_name,
                'role' => 'superadmin',
                'inventory_permissions' => $existing->inventory_permissions ?? 'READ_WRITE',
                'ai_rules_access' => $existing->ai_rules_access ?? true,
            ])->save();

            $this->newLine();
            $this->info("  {$email} is now a Super Admin.");
            $this->remindAboutTwoFactor($existing);

            return self::SUCCESS;
        }

        /*
         * A NEW ACCOUNT. The password is validated with the SAME shared rule the
         * sign-up form and the reset endpoint use, so a password the console
         * accepts here is not one the login endpoint would later reject.
         */
        $password = $this->secret('Password (at least 8 characters, 1 uppercase, 1 number)');
        $confirmation = $this->secret('Confirm password');

        $validator = Validator::make(
            ['password' => $password, 'password_confirmation' => $confirmation],
            ['password' => ['required', 'string', new PasswordStrength, 'confirmed']],
            [
                'password.confirmed' => 'The two passwords do not match.',
            ]
        );

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error('  ' . $error);
            }
            return self::FAILURE;
        }

        /*
         * THE SUPABASE IDENTITY IS CREATED FIRST.
         * =========================================
         * This command used to write only the `users` row and then tell the owner to
         * "make sure this account has a Supabase identity" — with no way in the
         * application to do that, and no way to check whether it had been done. The
         * result was that the command whose entire purpose is to get you INTO the
         * console was itself the thing locking you out of it: Laravel would accept
         * the password and GoTrue would refuse it, forever.
         *
         * Both rows are now written here, and a GoTrue refusal aborts before the
         * Laravel row exists, so a failed run leaves nothing half-created.
         */
        $this->newLine();
        $this->line('  Creating the staff sign-in identity...');

        try {
            $authId = SupabaseIdentity::createWithPassword($email, $password, $name);
        } catch (\Throwable $e) {
            $this->error('  ' . $e->getMessage());
            $this->line('  Nothing was created. Fix the configuration and run it again.');

            return self::FAILURE;
        }

        $this->info('  Staff sign-in identity created.');

        $user = User::create([
            'full_name' => $name,
            'email' => $email,
            'password' => Hash::make($password),
            'role' => 'superadmin',
            'auth_id' => $authId,
            'inventory_permissions' => 'READ_WRITE',
            'ai_rules_access' => true,
        ]);

        $this->newLine();
        $this->info("  Super Admin created: {$email}");
        $this->remindAboutTwoFactor($user);

        return self::SUCCESS;
    }

    /**
     * The one thing that must happen next, said plainly.
     *
     * Enforcement is deliberately NOT switched on here. A superadmin locked out
     * of their own account on the very first sign-in, with the only remedy being
     * another terminal, is a self-inflicted outage — and the fix command exists
     * but needs the console to be reachable, which it would not be. So the
     * control is recommended loudly rather than forced silently, and can be made
     * mandatory per-environment once a second recovery path is in place.
     */
    private function remindAboutTwoFactor(User $user): void
    {
        /*
         * Read the factor list from Supabase's own table, via the auth_id link.
         * A missing auth_id is treated as "not enrolled" rather than an error,
         * because at this point the account has just been created and the
         * backfill in 0002_link_supabase_auth_users.sql has not seen it yet.
         */
        $has = false;

        if ($user->auth_id) {
            try {
                $has = DB::table('auth.mfa_factors')
                    ->where('user_id', $user->auth_id)
                    ->where('factor_type', 'totp')
                    ->where('status', 'verified')
                    ->exists();
            } catch (\Throwable) {
                $has = false;
            }
        }

        $this->newLine();
        if ($has) {
            $this->line('  <fg=yellow>An authenticator app is already enrolled on this account.</>');
        } else {
            $this->line('  <fg=yellow>NEXT STEP — do this now, before anything else:</>');
            $this->line('    1. Sign in at /login with the password you just set');
            $this->line('    2. The form will show the authenticator setup — scan the QR with');
            $this->line('       Google Authenticator or 1Password, and enter the 6 digits');
            $this->line('    3. You will land on /superadmin');
            $this->newLine();
            $this->line('    The password alone does not open the console. The 6-digit code is');
            $this->line('    required, and this account can export the whole database.');
        }
        $this->newLine();
    }
}
