<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CUSTOMER GENDER.
 *
 * Registration now asks for it (male / female) so the Home recommendation feed
 * can show menswear to men and womenswear to women, alongside the size and fit
 * style it already matched on. Products already carry `gender`
 * (Men / Women / Unisex) from the AI fill-up, so this is the missing half.
 *
 * Nullable because accounts created before this column existed have none;
 * those customers are asked to set it in Account Settings.
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasColumn('users', 'gender')) {
            Schema::table('users', function (Blueprint $table) {
                $table->string('gender', 20)->nullable()->after('preferred_fit');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'gender')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('gender');
            });
        }
    }
};
