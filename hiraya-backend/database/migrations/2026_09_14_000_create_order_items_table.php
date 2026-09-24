<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds real line items to an order, so an order is an actual record of what
 * was bought rather than a bare money envelope.
 *
 * unit_price / line_total are SNAPSHOTS taken at checkout time, so later edits
 * to a product's price never rewrite order history.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->onDelete('cascade');
            // Keep the row if a product is deleted, so history stays intact.
            $table->foreignId('product_id')->nullable()->constrained()->onDelete('set null');

            $table->string('product_name_snapshot');
            $table->string('selected_size')->default('M');
            $table->string('selected_color')->default('Standard');
            $table->integer('quantity')->default(1);
            $table->decimal('unit_price', 10, 2);
            $table->decimal('line_total', 10, 2);

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_items');
    }
};
