<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Console batch: demo orders, restorable try-on history, admin contact info,
 * support tickets — and the removal of two permission columns nothing enforced.
 *
 *   orders.is_demo                 Demo orders made from Orders Management for
 *                                  presentations. Excluded from analytics and
 *                                  removable in one click.
 *   try_on_sessions.deleted_at     A customer's "delete" now HIDES the session
 *                                  (soft delete), so staff can restore it to the
 *                                  customer's history when they ask.
 *   users.contact_number           The admin's contact number, recorded when the
 *                                  super admin creates the account.
 *   support_tickets                "Contact Support" messages from the console.
 *   users.ai_rules_access,         Dropped. AI Rules was removed earlier and no
 *   users.inventory_permissions    code ever enforced either flag, so the
 *                                  checkboxes promised access control that did
 *                                  not exist.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'is_demo')) {
                $table->boolean('is_demo')->default(false)->index();
            }
        });

        Schema::table('try_on_sessions', function (Blueprint $table) {
            if (!Schema::hasColumn('try_on_sessions', 'deleted_at')) {
                $table->softDeletes();
            }
        });

        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'contact_number')) {
                $table->string('contact_number', 30)->nullable();
            }
        });

        Schema::table('users', function (Blueprint $table) {
            foreach (['ai_rules_access', 'inventory_permissions'] as $column) {
                if (Schema::hasColumn('users', $column)) {
                    $table->dropColumn($column);
                }
            }
        });

        if (!Schema::hasTable('support_tickets')) {
            Schema::create('support_tickets', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->string('sender_name');
                $table->string('sender_email');
                $table->string('sender_role', 20)->nullable();
                $table->string('category', 30);
                $table->string('subject', 150);
                $table->text('message');
                $table->string('status', 20)->default('open')->index();
                $table->timestamp('resolved_at')->nullable();
                $table->timestamps();
            });

            // Not reachable through Supabase's public REST API (see product_pairings).
            if (DB::getDriverName() === 'pgsql') {
                DB::statement('alter table "' . DB::getTablePrefix() . 'support_tickets" enable row level security');
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('support_tickets');
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('contact_number');
            $table->string('inventory_permissions')->nullable();
            $table->boolean('ai_rules_access')->nullable();
        });
        Schema::table('try_on_sessions', fn (Blueprint $table) => $table->dropSoftDeletes());
        Schema::table('orders', fn (Blueprint $table) => $table->dropColumn('is_demo'));
    }
};
