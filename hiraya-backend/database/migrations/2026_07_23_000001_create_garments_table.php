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
        Schema::create('garments', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('category'); // top, bottom, dress, outerwear
            $table->longText('image_base64'); // Transparent PNG payload as Base64 Data URI
            $table->integer('layer_order')->default(0); // Z-index for layering
            $table->decimal('price', 8, 2)->default(0.00); // Optional price
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('garments');
    }
};