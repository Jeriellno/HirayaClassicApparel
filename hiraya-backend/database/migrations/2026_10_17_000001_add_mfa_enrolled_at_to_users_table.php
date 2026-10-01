<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds `mfa_enrolled_at` — the flag that makes an invited admin account ACTIVE.
 *
 * WHY A SEPARATE TIMESTAMP FROM `created_at`
 * ------------------------------------------
 * An invited admin exists in two states, and the difference matters:
 *
 *   created, mfa_enrolled_at = null   -> has a password, has NO second factor.
 *                                        Must not reach the console.
 *   created, mfa_enrolled_at = set    -> holds a verified TOTP factor.
 *                                        Fully active.
 *
 * Without this column there is no way to tell "an account that was provisioned
 * and then enrolled its authenticator" from "an account that was provisioned and
 * never finished", and the second kind must not be usable. The whole point of
 * the invitation flow is that an admin cannot exist in an active state without
 * their own MFA, and that guarantee needs somewhere to live.
 *
 * WHY A TIMESTAMP AND NOT A BOOLEAN
 * ---------------------------------
 * Same reasoning as `suspended_at`: it records BOTH whether enrolment happened
 * and WHEN, and "since when" is the first question asked when auditing which
 * admin accounts were active during an incident. A boolean answers only half.
 *
 * EXISTING ACCOUNTS ARE BACKFILLED AS ENROLLED
 * --------------------------------------------
 * Every staff account that already exists was provisioned before this column,
 * and the accounts currently signing in are already required to hold aal2 (see
 * EnsureSupabaseAAL2). Marking them enrolled with `created_at` is the honest
 * statement of what is already true, and it means this migration cannot lock
 * the current owner out of their own console — which is the one failure mode a
 * migration of an auth column must never have.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasColumn('users', 'mfa_enrolled_at')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('mfa_enrolled_at')->nullable()->after('suspended_at');
        });

        /*
         * Backfill ONLY the privileged roles. A customer row has no business
         * carrying an MFA timestamp, and setting one would muddy the meaning of
         * the column: it is "this staff account is console-ready", not "this row
         * exists".
         */
        \Illuminate\Support\Facades\DB::table('users')
            ->whereIn('role', ['admin', 'superadmin'])
            ->whereNull('mfa_enrolled_at')
            ->update(['mfa_enrolled_at' => \Illuminate\Support\Facades\DB::raw('created_at')]);
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'mfa_enrolled_at')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('mfa_enrolled_at');
            });
        }
    }
};