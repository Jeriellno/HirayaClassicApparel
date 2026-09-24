<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Persist the Style Stack CATEGORY of every garment sent for a try-on render.
 *
 * WHY
 * ---
 * The Gemini renderer is told which body region each garment image belongs to
 * ("IMAGE 2 = the outerwear, worn over everything else"). That instruction is
 * what keeps a jacket on the torso and a pair of jeans on the legs instead of
 * every piece landing on the chest.
 *
 * The category was never stored, so TryOnPreProcessor had to GUESS the layer
 * from the garment's position in the array — which it documented honestly as
 * "Without a vision classifier we cannot label the garment". The consequence was
 * that a 2-piece stack (top + footwear) was described to the model as
 * "inner layer, only visible at the collar and cuffs" for the first image and
 * "top, upper torso, sleeves down the arms" for the second: the shoes were
 * instructed to be worn as a shirt.
 *
 * The Studio knows the real category at selection time, so it is carried through
 * and stored here. `garment_categories_json` is index-aligned with the existing
 * `garment_photos_json`.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('try_on_sessions', function (Blueprint $table) {
            if (!Schema::hasColumn('try_on_sessions', 'garment_categories_json')) {
                $table->json('garment_categories_json')->nullable()->after('garment_photos_json');
            }
        });
    }

    public function down(): void
    {
        Schema::table('try_on_sessions', function (Blueprint $table) {
            if (Schema::hasColumn('try_on_sessions', 'garment_categories_json')) {
                $table->dropColumn('garment_categories_json');
            }
        });
    }
};
