<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('size_charts', function (Blueprint $table) {
            $table->id();
            $table->string('category');       // TOPS, BOTTOMS, DRESSES, OUTERWEAR, FORMAL_MEN, FORMAL_WOMEN
            $table->string('gender');         // Men, Women, Unisex
            $table->string('size_label');     // S, M, L, XL, 2XL, 32, 42, etc.

            // 5 Core Body Measurements (cm) — min/max ranges
            $table->decimal('chest_bust_min', 5, 2)->nullable();
            $table->decimal('chest_bust_max', 5, 2)->nullable();
            $table->decimal('waist_min', 5, 2)->nullable();
            $table->decimal('waist_max', 5, 2)->nullable();
            $table->decimal('hips_min', 5, 2)->nullable();
            $table->decimal('hips_max', 5, 2)->nullable();
            $table->decimal('shoulder_width_min', 5, 2)->nullable();
            $table->decimal('shoulder_width_max', 5, 2)->nullable();
            $table->decimal('sleeve_length_min', 5, 2)->nullable();
            $table->decimal('sleeve_length_max', 5, 2)->nullable();

            $table->timestamps();

            // Prevent duplicate entries for the same category/gender/size combination
            $table->unique(['category', 'gender', 'size_label'], 'size_charts_unique');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('size_charts');
    }
};
