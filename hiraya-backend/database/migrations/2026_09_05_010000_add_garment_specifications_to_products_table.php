<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Add a structured `garment_specifications` JSON column to the
     * `products` table.
     *
     * The shape of the JSON allows the Outfit Recommendation engine to
     * perform numeric tolerance matching against the user's 5 Core Body
     * Measurements (`chest_bust`, `waist`, `hips`, `shoulder_width`,
     * `sleeve_length`).
     *
     * Example payload:
     * {
     *   "M": {
     *     "chest_bust":     [86, 94],
     *     "waist":          [70, 78],
     *     "hips":           [92, 100],
     *     "shoulder_width": [40, 44],
     *     "sleeve_length":  [60, 64]
     *   },
     *   "L": { ... }
     * }
     *
     * The legacy `size_measurements` column is retained for backward
     * compatibility with the existing product detail page.
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->json('garment_specifications')->nullable()->after('size_measurements');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('garment_specifications');
        });
    }
};
