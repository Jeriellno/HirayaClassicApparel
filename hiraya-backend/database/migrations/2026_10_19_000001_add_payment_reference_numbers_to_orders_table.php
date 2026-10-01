<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PAYMENT REFERENCE NUMBERS ON ORDERS.
 *
 * Payment is manual (GCash / bank transfer + uploaded receipt), so the admin
 * verifies a payment by matching it against the store's own GCash or bank app.
 * A screenshot alone is easy to fake or reuse; the transaction reference number
 * is what the admin actually looks up. One column per payment step:
 *
 *   dp_reference_number      — the 50% down payment (checkout / DP re-upload)
 *   balance_reference_number — the remaining balance (pay-balance)
 *
 * Nullable because orders placed before this column existed have none.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (! Schema::hasColumn('orders', 'dp_reference_number')) {
                $table->string('dp_reference_number', 64)->nullable()->after('dp_proof_image_path');
            }
            if (! Schema::hasColumn('orders', 'balance_reference_number')) {
                $table->string('balance_reference_number', 64)->nullable()->after('full_payment_proof_image_path');
            }
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            foreach (['dp_reference_number', 'balance_reference_number'] as $column) {
                if (Schema::hasColumn('orders', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
