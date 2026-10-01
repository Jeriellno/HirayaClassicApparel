<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COLOR VARIANTS ON PRODUCTS.
 *
 * The product row itself is the PRIMARY colour (`colors[0]`). Every other
 * colour the same garment comes in is one entry in this JSON list, carrying
 * its OWN photos (original, background-removed card, try-on matte), optional
 * name / description overrides and its own per-size stock:
 *
 *   [{ id, color, hex, name, description, image_url, display_image_url,
 *      ghost_mannequin_url, background_occasion, size_stocks, stock }]
 *
 * See App\Support\ProductVariants for how checkout and restocks read it.
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasColumn('products', 'color_variants')) {
            Schema::table('products', function (Blueprint $table) {
                $table->json('color_variants')->nullable()->after('colors');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('products', 'color_variants')) {
            Schema::table('products', function (Blueprint $table) {
                $table->dropColumn('color_variants');
            });
        }
    }
};
