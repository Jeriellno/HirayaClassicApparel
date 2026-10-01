<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Lets the audit trail describe CUSTOMER ACCOUNT activity, not only staff actions.
 *
 *   actor_role       — 'user', 'admin' or 'superadmin': who performed the action.
 *                      The admin-facing audit view is filtered on it.
 *   subject_user_id  — the customer account the entry is ABOUT, so one customer's
 *                      history can be listed. No foreign key on purpose: the
 *                      entry must survive the account being deleted.
 *   ip_address       — where the request came from. Shown to the super admin
 *                      only; admins see a masked trail.
 *
 * Purely additive and nullable: existing rows and writers keep working.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('audit_logs', function (Blueprint $table) {
            if (!Schema::hasColumn('audit_logs', 'actor_role')) {
                $table->string('actor_role', 20)->nullable()->after('admin_email');
            }
            if (!Schema::hasColumn('audit_logs', 'subject_user_id')) {
                $table->unsignedBigInteger('subject_user_id')->nullable()->after('target');
                $table->index('subject_user_id');
            }
            if (!Schema::hasColumn('audit_logs', 'ip_address')) {
                $table->string('ip_address', 45)->nullable()->after('details');
            }
        });
    }

    public function down(): void
    {
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->dropIndex(['subject_user_id']);
            $table->dropColumn(['actor_role', 'subject_user_id', 'ip_address']);
        });
    }
};
