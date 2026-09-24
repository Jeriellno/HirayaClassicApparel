<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->id();

            // Buyer (nullable so guest checkouts still work if allowed later)
            $table->foreignId('user_id')->nullable()->constrained()->onDelete('set null');

            // Money
            $table->decimal('total_amount', 10, 2);
            $table->decimal('dp_amount', 10, 2);        // 50% down payment
            $table->decimal('balance_amount', 10, 2);   // remaining 50%

            // 2-step flow state
            $table->enum('payment_status', ['pending', '50_paid', 'fully_paid'])->default('pending');
            $table->enum('order_status', ['pending', 'processing', 'ready_for_shipping', 'shipped'])->default('pending');

            // Shipping
            $table->enum('courier', ['lalamove', 'lbc']);
            $table->string('customer_name');
            $table->string('contact_number');
            $table->text('delivery_address');
            $table->string('tracking_booking_details')->nullable();

            // Proof of payment uploads
            $table->string('dp_proof_image_path')->nullable();
            $table->string('full_payment_proof_image_path')->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
