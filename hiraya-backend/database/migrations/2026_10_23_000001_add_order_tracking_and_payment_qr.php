<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * 1. ORDER TRACKING — when each step happened, for the order tracker shown to
 *    customers (My Orders) and staff (Order details). All nullable: orders
 *    placed before this migration simply show the step without a date.
 *
 * 2. PAYMENT QR — the store's GCash/bank QR is uploaded by the superadmin and
 *    kept as a data URI in system_settings, so `value` grows from VARCHAR(255)
 *    to TEXT. Existing boolean values ('true'/'false') are unaffected.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            foreach (['dp_verified_at', 'fully_paid_at', 'ready_for_shipping_at', 'shipped_at', 'delivered_at'] as $column) {
                if (! Schema::hasColumn('orders', $column)) {
                    $table->timestamp($column)->nullable();
                }
            }
        });

        Schema::table('system_settings', function (Blueprint $table) {
            $table->text('value')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['dp_verified_at', 'fully_paid_at', 'ready_for_shipping_at', 'shipped_at', 'delivered_at']);
        });

        Schema::table('system_settings', function (Blueprint $table) {
            $table->string('value')->nullable()->change();
        });
    }
};
