<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drops the dead `is_online` column from `users`.
 *
 * WHY IT IS DEAD
 * --------------
 * `is_online` was added by 2026_10_03_000001 with the RBAC fields, but NO code
 * path ever wrote it and nothing read it. The Admin console's STATUS column used
 * to render `admin.is_online` — which is exactly why every account showed the
 * same stale value — and it has since been replaced by "Last Seen", derived from
 * `last_login_at`, a field the login endpoint genuinely records.
 *
 * A boolean presence flag that no writer maintains is worse than no flag: it
 * looks like live state and is always wrong. Rather than keep a column that can
 * only mislead, it is removed; `last_login_at` answers the same question with a
 * value that is actually written.
 *
 * Guarded by hasColumn so re-running against a database where it was already
 * dropped is a no-op instead of a crash. `down()` restores the column so the
 * change is reversible.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('users', 'is_online')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('is_online');
        });
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'is_online')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->boolean('is_online')->default(false)->after('ai_rules_access');
        });
    }
};
