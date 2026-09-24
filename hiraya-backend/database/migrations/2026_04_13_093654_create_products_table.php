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
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->text('description')->nullable();
            $table->decimal('price', 10, 2);
            $table->string('category'); // Tops, Bottoms, Formal Men, etc.
            $table->string('subcategory')->nullable();
            $table->string('image_url')->nullable();
            
            // Structured JSON Fields
            $table->json('images')->nullable(); 
            $table->json('colors')->nullable(); 
            $table->json('sizes')->nullable();
            $table->json('size_measurements')->nullable();
            $table->json('size_stocks')->nullable();
            $table->json('attributes')->nullable();

            $table->string('material')->nullable();
            $table->string('gender')->default('unisex');
            $table->boolean('featured')->default(false);
            $table->integer('stock')->default(0);

            // Customer Interaction Signals & Tracking Counters
            $table->unsignedBigInteger('canvas_drag_count')->default(0);
            $table->unsignedBigInteger('try_on_count')->default(0);

            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};