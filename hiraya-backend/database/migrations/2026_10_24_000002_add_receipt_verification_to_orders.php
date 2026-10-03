<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * FULL PAYMENT + RECEIPT FRAUD PROTECTION (additive, non-destructive).
 *
 *  payment_status gains 'needs_review' (Verification Failed / Needs Review is
 *  'rejected' / 'needs_review'; Pending Verification is 'pending'; Verified /
 *  Paid is 'fully_paid'). '50_paid' is KEPT so historical 50/50 orders stay
 *  valid and readable — no existing row is rewritten.
 *
 *  receipt_sha256          exact-duplicate detection across orders
 *  receipt_phash           64-bit perceptual (difference) hash, hex — catches a
 *                          re-saved / re-compressed copy of the same receipt
 *  receipt_risk_level      low | medium | high  (ADVISORY ONLY)
 *  receipt_analysis        OCR/AI extraction + comparison flags (staff-only)
 *  payment_verification_method  which TRUSTED record staff checked
 *  payment_verified_by     staff user id that approved the payment
 */
return new class extends Migration
{
    public function up(): void
    {
        $constraint = DB::getTablePrefix() . 'orders_payment_status_check';
        $table = DB::getTablePrefix() . 'orders';

        DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$constraint}");
        DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS orders_payment_status_check");
        DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$constraint}
            CHECK (payment_status IN ('pending', '50_paid', 'fully_paid', 'rejected', 'needs_review'))");

        Schema::table('orders', function (Blueprint $t) {
            if (! Schema::hasColumn('orders', 'receipt_sha256')) {
                $t->string('receipt_sha256', 64)->nullable()->index();
            }
            if (! Schema::hasColumn('orders', 'receipt_phash')) {
                $t->string('receipt_phash', 16)->nullable();
            }
            if (! Schema::hasColumn('orders', 'receipt_risk_level')) {
                $t->string('receipt_risk_level', 16)->nullable();
            }
            if (! Schema::hasColumn('orders', 'receipt_analysis')) {
                $t->json('receipt_analysis')->nullable();
            }
            if (! Schema::hasColumn('orders', 'payment_verification_method')) {
                $t->string('payment_verification_method', 40)->nullable();
            }
            if (! Schema::hasColumn('orders', 'payment_verified_by')) {
                $t->unsignedBigInteger('payment_verified_by')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $t) {
            foreach (['receipt_sha256', 'receipt_phash', 'receipt_risk_level', 'receipt_analysis',
                'payment_verification_method', 'payment_verified_by'] as $column) {
                if (Schema::hasColumn('orders', $column)) {
                    $t->dropColumn($column);
                }
            }
        });

        $constraint = DB::getTablePrefix() . 'orders_payment_status_check';
        $table = DB::getTablePrefix() . 'orders';
        DB::statement("UPDATE {$table} SET payment_status = 'pending' WHERE payment_status = 'needs_review'");
        DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$constraint}");
        DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$constraint}
            CHECK (payment_status IN ('pending', '50_paid', 'fully_paid', 'rejected'))");
    }
};
