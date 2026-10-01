<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * CREATES AN INDIVIDUAL ADMIN ACCOUNT WITHOUT THE WEB CONSOLE.
 * =============================================================
 *
 * This is the answer to a question the Admin Accounts tab cannot answer on its
 * own: who creates the FIRST admin? Provisioning an admin requires a signed-in
 * superadmin, so a deployment that has one superadmin and no admins cannot add
 * any through the UI. This can, from the machine.
 *
 * ONE ROW, ONE PERSON
 * -------------------
 * The command takes a name and an email and refuses to skip either. There is no
 * "create a shared admins login" path here and no way to create an account with
 * no name, because a shared account is the single thing that makes an audit log
 * meaningless and makes revoking one person's access impossible without cutting
 * off everyone else. Every privileged row in this system should be traceable to a
 * human being.
 *
 * The password is prompted for, never passed as an argument, for the same reason
 * as in MakeSuperadminCommand: an argument lands in shell history and in `ps`
 * output.
 */
class MakeAdminCommand extends Command
{
    protected $signature = 'hiraya:make-admin
                            {--email= : The account email. Prompted if omitted.}
                            {--name= : The person\'s name. Prompted if omitted.}
                            {--role=admin : admin | superadmin}';

    protected $description = 'Create an individual admin account (one person, one account).';

    public function handle(): int
    {
        $this->newLine();
        $this->line('  <options=bold>Hiraya — Admin Account</>');
        $this->line('  One named person, one account. Do not share a login.');
        $this->newLine();

        $email = strtolower(trim($this->option('email') ?: $this->ask('Email address')));
        $name = trim($this->option('name') ?: $this->ask('Full name'));
        $role = strtolower(trim($this->option('role'))) === 'superadmin' ? 'superadmin' : 'admin';

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('  That is not a valid email address.');
            return self::FAILURE;
        }

        /*
         * A NAME IS MANDATORY, NOT COSMETIC.
         *
         * The Admin Accounts table shows a last-seen column, and that column is
         * only honest if the row is a person. "admin" or "hiraya staff" as a name
         * means the audit trail records an initials badge and nothing else.
         */
        if ($name === '') {
            $this->error('  A name is required. An admin account must be attributable to a person.');
            return self::FAILURE;
        }

        $existing = User::where('email', $email)->first();

        if ($existing) {
            if ($existing->role === $role) {
                $this->warn("  {$email} is already a {$role}. Nothing to do.");
                return self::SUCCESS;
            }

            if (!$this->confirm("  {$email} already exists as a {$existing->role}. Change it to {$role}?", false)) {
                $this->line('  Cancelled. Nothing was changed.');
                return self::SUCCESS;
            }

            $existing->forceFill([
                'role' => $role,
            ])->save();

            $this->newLine();
            $this->info("  {$email} is now a {$role}.");
            return self::SUCCESS;
        }

        $password = $this->secret('Temporary password (at least 8 characters, 1 uppercase, 1 number)');
        $confirmation = $this->secret('Confirm password');

        if ($password !== $confirmation) {
            $this->error('  The two passwords do not match.');
            return self::FAILURE;
        }

        if (strlen($password) < 8 || !preg_match('/[A-Z]/', $password) || !preg_match('/[0-9]/', $password)) {
            $this->error('  Password must be at least 8 characters and contain 1 uppercase letter and 1 number.');
            return self::FAILURE;
        }

        $user = User::create([
            'full_name' => $name,
            'email' => $email,
            'password' => bcrypt($password),
            'role' => $role,
        ]);

        $this->newLine();
        $this->info("  {$role} created: {$email}");

        if ($role === 'superadmin') {
            $this->line('  <fg=yellow>This is a Super Admin. Enrol an authenticator app on it immediately.</>');
        } else {
            $this->line('  <fg=yellow>Ask them to sign in and change the password you just set.</>');
        }

        $this->newLine();

        return self::SUCCESS;
    }
}
