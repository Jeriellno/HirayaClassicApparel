<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the RBAC fields the Super Admin "Admin Accounts" table already renders
 * (superadmin/tabs/AdminsTab.jsx): inventory_permissions, ai_rules_access,
 * is_online and last_login_at.
 *
 * These columns were being read from Supabase but never existed on the table,
 * so the console always showed OFFLINE / default values and the create form
 * could not persist the chosen permissions. Guarded with hasColumn so the
 * migration is safe on databases seeded outside of migrations.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'inventory_permissions')) {
                $table->string('inventory_permissions', 20)->nullable()->default('READ_WRITE');
            }

            if (!Schema::hasColumn('users', 'ai_rules_access')) {
                $table->boolean('ai_rules_access')->nullable()->default(true);
            }

            if (!Schema::hasColumn('users', 'is_online')) {
                $table->boolean('is_online')->default(false);
            }

            if (!Schema::hasColumn('users', 'last_login_at')) {
                $table->timestamp('last_login_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $columns = collect(['inventory_permissions', 'ai_rules_access', 'is_online', 'last_login_at'])
                ->filter(fn(string $column) => Schema::hasColumn('users', $column))
                ->all();

            if ($columns) {
                $table->dropColumn($columns);
            }
        });
    }
};
