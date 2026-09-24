<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the `suspended_at` flag the Super Admin "Customers" tab needs.
 *
 * WHY A TIMESTAMP, NOT A BOOLEAN
 * ------------------------------
 * A nullable timestamp records BOTH facts a suspension has to carry — whether
 * the account is suspended (non-null) and WHEN it happened. A boolean would
 * answer only the first and lose the audit-relevant "since when", which is the
 * question asked first whenever a customer disputes a suspension.
 *
 * Enforcement: AuthController::login refuses a suspended account, so the flag
 * is not decorative — a suspended customer genuinely cannot sign in.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('users', 'suspended_at')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('suspended_at')->nullable()->after('last_login_at');
        });
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'suspended_at')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('suspended_at');
            });
        }
    }
};
