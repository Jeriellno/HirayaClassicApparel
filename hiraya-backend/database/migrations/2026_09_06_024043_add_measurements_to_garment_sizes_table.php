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
        Schema::create('garment_sizes', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('garment_id');
            if (Schema::hasTable('garments')) {
                $table->foreign('garment_id')->references('id')->on('garments')->onDelete('cascade');
            }
            $table->string('size_label'); // e.g., S, M, L, XL
            $table->integer('stock')->default(0);

            // 5 Core Body Measurement Ranges (cm)
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
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('garment_sizes');
    }
};