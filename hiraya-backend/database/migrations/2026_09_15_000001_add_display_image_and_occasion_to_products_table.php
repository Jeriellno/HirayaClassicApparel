<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two-stage garment presentation pipeline.
 *
 * Stage 1 (background replacement) produces a NEW catalog image where the
 * garment cutout sits on a default, occasion-matched background. Stage 2
 * (auto-fill) fills the editable details.
 *
 * The admin's ORIGINAL upload is never overwritten:
 *   - image_url          -> the raw photo the admin uploaded (kept forever)
 *   - display_image_url  -> the background-replaced image users actually see
 *
 * background_occasion records WHICH default background was used so the rule
 * "same garment / same occasion => same background" stays auditable and the
 * image can be regenerated later without re-running the AI.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->text('display_image_url')->nullable()->after('image_url');
            $table->string('background_occasion', 50)->nullable()->after('display_image_url');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn(['display_image_url', 'background_occasion']);
        });
    }
};
