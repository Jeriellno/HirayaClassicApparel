<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Money-integrity additions to `orders`:
 *
 * 1. `rejected` becomes a valid payment_status so an admin can turn down a bad
 *    down-payment proof instead of leaving the order stuck in `pending`.
 * 2. `rejection_reason` explains the rejection to the customer.
 * 3. `balance_proof_submitted_at` lets the admin tell "customer hasn't paid"
 *    apart from "customer paid, waiting for my confirmation".
 *
 * NOTE ON POSTGRES: Laravel's ->enum() compiles to a varchar + CHECK constraint
 * rather than a native enum type. Widening the allowed values therefore means
 * dropping and recreating that constraint by hand.
 */
return new class extends Migration {
    public function up(): void
    {
        // 1. Widen the payment_status CHECK constraint to include 'rejected'.
        DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check');
        DB::statement("
            ALTER TABLE orders
            ADD CONSTRAINT orders_payment_status_check
            CHECK (payment_status IN ('pending', '50_paid', 'fully_paid', 'rejected'))
        ");

        // 2. Add the rejection + balance-tracking columns.
        Schema::table('orders', function (Blueprint $table) {
            $table->text('rejection_reason')->nullable()->after('payment_status');
            $table->timestamp('balance_proof_submitted_at')->nullable()->after('full_payment_proof_image_path');
            $table->timestamp('dp_submitted_at')->nullable()->after('dp_proof_image_path');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['rejection_reason', 'balance_proof_submitted_at', 'dp_submitted_at']);
        });

        DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check');
        DB::statement("
            ALTER TABLE orders
            ADD CONSTRAINT orders_payment_status_check
            CHECK (payment_status IN ('pending', '50_paid', 'fully_paid'))
        ");
    }
};
