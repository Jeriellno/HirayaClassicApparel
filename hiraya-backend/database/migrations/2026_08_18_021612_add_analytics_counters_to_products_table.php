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
        Schema::table('products', function (Blueprint $table) {
            if (!Schema::hasColumn('products', 'canvas_drag_count')) {
                $table->unsignedBigInteger('canvas_drag_count')->default(0);
            }
            if (!Schema::hasColumn('products', 'try_on_count')) {
                $table->unsignedBigInteger('try_on_count')->default(0);
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            if (Schema::hasColumn('products', 'canvas_drag_count')) {
                $table->dropColumn('canvas_drag_count');
            }
            if (Schema::hasColumn('products', 'try_on_count')) {
                $table->dropColumn('try_on_count');
            }
        });
    }
};