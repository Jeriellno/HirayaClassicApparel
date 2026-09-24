<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Creates the four tables the Super Admin console reads/writes:
 *
 *   canvas_assets   — transparent PNG cutouts for the virtual fitting canvas
 *   ai_rules        — stylist pairing rules (target item -> recommended item)
 *   system_settings — key/value feature toggles (maintenance, AI engine, ...)
 *   audit_logs      — security trail of privileged actions
 *
 * These were previously living ONLY in Supabase, which meant the console could
 * show a phantom list and any write (upload asset / add rule / toggle) silently
 * no-op'd whenever Supabase was not reachable. Moving them into Laravel/MySQL
 * gives the console one source of truth, matching the products + admin-accounts
 * migrations that already made the same switch.
 *
 * Each create is guarded with hasTable so re-running against a database where
 * the tables already exist is a no-op instead of a crash.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('canvas_assets')) {
            Schema::create('canvas_assets', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->string('asset_url');
                $table->string('mime_type', 100)->default('image/png');
                // uploader is nullable: a seed/admin-created asset may have no owner.
                $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('ai_rules')) {
            Schema::create('ai_rules', function (Blueprint $table) {
                $table->id();
                $table->string('item_name');
                $table->string('recommended_item');
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('system_settings')) {
            Schema::create('system_settings', function (Blueprint $table) {
                $table->id();
                $table->string('key')->unique();
                $table->string('value')->nullable();
                $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('audit_logs')) {
            Schema::create('audit_logs', function (Blueprint $table) {
                $table->id();
                $table->string('admin_email')->nullable();
                $table->string('action');
                $table->string('target')->nullable();
                $table->text('details')->nullable();
                $table->timestamps();

                $table->index('created_at');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('system_settings');
        Schema::dropIfExists('ai_rules');
        Schema::dropIfExists('canvas_assets');
    }
};
