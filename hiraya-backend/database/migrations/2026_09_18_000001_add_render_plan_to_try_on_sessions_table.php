<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Persist the try-on pre-processing render plan on the session.
 *
 * WHY
 * ---
 * The AI fitting was rendering an undersized, unaligned garment because the
 * generator received only the raw garment photo plus a vague "make it fit"
 * instruction. The plan produced by App\Services\TryOnPreProcessor carries the
 * derived geometry — frame-relative scale ratios, vertical pose anchors, the
 * lighting brief and the layer order — and must survive from the HTTP request
 * that created it to the queue worker that renders it.
 *
 * Stored as JSON so the plan can gain fields (new anchors, new lighting
 * statistics) without a further migration.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('try_on_sessions', function (Blueprint $table) {
            if (!Schema::hasColumn('try_on_sessions', 'render_plan_json')) {
                $table->json('render_plan_json')->nullable()->after('measurements_json');
            }
        });
    }

    public function down(): void
    {
        Schema::table('try_on_sessions', function (Blueprint $table) {
            if (Schema::hasColumn('try_on_sessions', 'render_plan_json')) {
                $table->dropColumn('render_plan_json');
            }
        });
    }
};
