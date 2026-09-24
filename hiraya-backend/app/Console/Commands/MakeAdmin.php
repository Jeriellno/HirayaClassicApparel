<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * Promote (or demote) an existing account's role directly from the CLI.
 *
 *   php artisan hiraya:make-admin admin@hiraya.com
 *   php artisan hiraya:make-admin admin@hiraya.com --role=superadmin
 *   php artisan hiraya:make-admin admin@hiraya.com --role=user
 *
 * This is the safe, auditable path used in production because it goes through
 * Eloquent (so any model observers / events fire) instead of a raw SQL console.
 */
class MakeAdmin extends Command
{
    protected $signature = 'hiraya:make-admin
                            {email : The email address of the account to update}
                            {--role=admin : The role to assign (user, admin or superadmin)}';

    protected $description = 'Grant or revoke admin/superadmin access for a Hiraya account';

    public function handle(): int
    {
        $email = strtolower(trim((string) $this->argument('email')));
        $role = strtolower(trim((string) $this->option('role')));

        if (!in_array($role, ['admin', 'superadmin', 'user'], true)) {
            $this->error("Invalid role '{$role}'. Allowed: user, admin, superadmin.");

            return self::FAILURE;
        }

        $user = User::where('email', $email)->first();

        if (!$user) {
            $this->error("No account found for {$email}.");

            return self::FAILURE;
        }

        $user->role = $role;
        $user->save();

        $this->info("✔ {$user->email} role set to '{$role}'.");

        return self::SUCCESS;
    }
}
