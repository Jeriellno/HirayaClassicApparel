<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Drops the legacy `user_two_factors` table.
 *
 * The second factor moved to Supabase's built-in MFA, where the TOTP secret,
 * the challenge, the code verification and the `aal` claim are all owned by the
 * identity provider. Nothing in the application reads this table any more:
 * TwoFactorController, the UserTwoFactor model and TotpService have all been
 * deleted, and AuthController::login no longer references a factor at all.
 *
 * WHY A NEW MIGRATION RATHER THAN EDITING THE ORIGINAL
 * The original `create_user_two_factors_table` migration was DELETED rather
 * than modified, because it is already recorded in the `migrations` table on
 * any deployed database. Editing an applied migration does nothing there — the
 * table would survive and this drop would never be queued. Removing the file
 * plus adding this one leaves a single, honest history: the table was created,
 * and then it was dropped.
 *
 * The data is deliberately NOT archived. The rows contain TOTP secrets and
 * hashed recovery codes for a mechanism that no longer exists; keeping them
 * would be keeping live credentials for a dead system.
 *
 * IRREVERSIBLE UP. `down()` recreates an EMPTY table purely so a rollback does
 * not crash on a missing relation — it does not restore the deleted secrets,
 * and could not.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('user_two_factors')) {
            Schema::drop('user_two_factors');
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('user_two_factors')) {
            return;
        }

        Schema::create('user_two_factors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('secret', 255);
            $table->json('recovery_codes')->nullable();
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->string('last_used_ip', 45)->nullable();
            $table->bigInteger('last_totp_step')->nullable();
            $table->timestamps();

            $table->unique('user_id');
        });
    }
};
