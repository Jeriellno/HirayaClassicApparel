<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * ORDER EXPERIENCE FEEDBACK. A delivered order can be rated once (1-5 stars +
 * comment) from My Orders; the row carries the order it belongs to so the
 * customer sees their rating on that order and staff see "Order #X" on it.
 * Nullable: general site feedback (the Feedback page) has no order.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('feedbacks', 'order_id')) {
            Schema::table('feedbacks', function (Blueprint $table) {
                $table->unsignedBigInteger('order_id')->nullable()->index();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('feedbacks', 'order_id')) {
            Schema::table('feedbacks', function (Blueprint $table) {
                $table->dropIndex(['order_id']);
                $table->dropColumn('order_id');
            });
        }
    }
};
