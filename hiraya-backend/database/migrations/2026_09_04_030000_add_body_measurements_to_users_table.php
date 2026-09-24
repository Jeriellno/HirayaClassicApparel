<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Body measurement fields captured during Registration so the
     * AI Virtual Try-On module can calculate accurate fit recommendations
     * without requiring the user to re-enter their metrics.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->decimal('weight',   5, 2)->nullable()->after('chest');
            $table->decimal('hips',     5, 2)->nullable()->after('waist');
            $table->decimal('shoulder', 5, 2)->nullable()->after('hips');
            $table->string('body_shape', 50)->nullable()->after('shoulder');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['weight', 'hips', 'shoulder', 'body_shape']);
        });
    }
};
