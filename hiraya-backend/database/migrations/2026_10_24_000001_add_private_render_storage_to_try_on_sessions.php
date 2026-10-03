<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Try-on Gallery hardening (non-destructive, additive only).
 *
 *  result_image_path   opaque reference to the ENCRYPTED render in the private
 *                      renders bucket (App\Support\RenderVault). New renders
 *                      no longer keep their Base64 in result_image_base64;
 *                      existing rows keep working until `php artisan
 *                      tryon:vault-renders` moves them.
 *  render_fingerprint  sha256 of (source photo + garments + render config +
 *                      render version) — lets an identical request reuse the
 *                      customer's own finished render instead of paying for a
 *                      new one. Indexed per user.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('try_on_sessions', function (Blueprint $table) {
            if (! Schema::hasColumn('try_on_sessions', 'result_image_path')) {
                $table->string('result_image_path', 255)->nullable();
            }
            if (! Schema::hasColumn('try_on_sessions', 'render_fingerprint')) {
                $table->string('render_fingerprint', 64)->nullable();
                $table->index(['user_id', 'render_fingerprint']);
            }
        });
    }

    public function down(): void
    {
        Schema::table('try_on_sessions', function (Blueprint $table) {
            if (Schema::hasColumn('try_on_sessions', 'render_fingerprint')) {
                $table->dropIndex(['user_id', 'render_fingerprint']);
                $table->dropColumn('render_fingerprint');
            }
            if (Schema::hasColumn('try_on_sessions', 'result_image_path')) {
                $table->dropColumn('result_image_path');
            }
        });
    }
};
