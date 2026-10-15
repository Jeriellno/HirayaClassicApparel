<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AI STYLIST PROFILE.
 *
 * `style_preference` — which collection the stylist recommends from:
 *   womenswear | menswear | both. It is separate from `gender` on purpose:
 *   `gender` decides which size chart fits the body, this decides what the
 *   customer wants to wear (a woman may prefer menswear, and vice versa).
 *   Null = follow `gender` (male -> menswear, female -> womenswear).
 *
 * `style_profile` — what the customer CONFIRMED in the stylist modal:
 *   { undertone: warm|cool|neutral, last_occasion, confirmed_at }.
 *   The photo analysis only suggests the undertone; nothing is stored until the
 *   customer confirms it.
 *
 * Both columns are nullable and additive, so existing accounts are unaffected.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'style_preference')) {
                $table->string('style_preference', 20)->nullable()->after('gender');
            }
            if (! Schema::hasColumn('users', 'style_profile')) {
                $table->json('style_profile')->nullable()->after('style_preference');
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'style_profile')) {
                $table->dropColumn('style_profile');
            }
            if (Schema::hasColumn('users', 'style_preference')) {
                $table->dropColumn('style_preference');
            }
        });
    }
};
