<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-product customer reviews, tied to the exact order line that was received.
 *
 * WHY A REVIEW HANGS OFF `order_item_id`
 * --------------------------------------
 * The rule is "one delivered product/order item = one review". Keying the review
 * on the order line (UNIQUE) makes that a database guarantee rather than a
 * controller check that two quick clicks could race past. It also proves the
 * reviewer actually bought and received the piece: the controller only accepts a
 * line whose order belongs to the caller and is `delivered`.
 *
 * `product_id` is stored alongside so the product page can list its reviews with
 * one indexed read, and it survives a product delete as NULL (same policy as
 * order_items) so review history is not destroyed with the catalogue row.
 *
 * `image` is an optional Base64 data URI in a longText, per the project's image
 * architecture (uploads bypass the filesystem).
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('product_reviews')) {
            return;
        }

        Schema::create('product_reviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('order_item_id')->unique()->constrained('order_items')->cascadeOnDelete();

            $table->unsignedTinyInteger('rating'); // 1..5
            $table->text('comment')->nullable();
            $table->longText('image')->nullable();

            $table->timestamps();

            $table->index(['product_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_reviews');
    }
};
