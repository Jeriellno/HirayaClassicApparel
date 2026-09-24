<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Standardize body measurements across the entire HIRAYA platform.
     */
    public function up(): void
    {
        // 1. Drop Legacy Columns Safely
        $legacyColumns = ['height', 'weight', 'chest', 'shoulder', 'body_shape'];
        
        foreach ($legacyColumns as $column) {
            if (Schema::hasColumn('users', $column)) {
                Schema::table('users', function (Blueprint $table) use ($column) {
                    $table->dropColumn($column);
                });
            }
        }

        // 2. Add Standardized 5 Core Measurement Columns
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'chest_bust')) {
                $table->decimal('chest_bust', 5, 2)->nullable()->after('email');
            }
            if (!Schema::hasColumn('users', 'waist')) {
                $table->decimal('waist', 5, 2)->nullable()->after('chest_bust');
            }
            if (!Schema::hasColumn('users', 'hips')) {
                $table->decimal('hips', 5, 2)->nullable()->after('waist');
            }
            if (!Schema::hasColumn('users', 'shoulder_width')) {
                $table->decimal('shoulder_width', 5, 2)->nullable()->after('hips');
            }
            if (!Schema::hasColumn('users', 'sleeve_length')) {
                $table->decimal('sleeve_length', 5, 2)->nullable()->after('shoulder_width');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['chest_bust', 'waist', 'hips', 'shoulder_width', 'sleeve_length']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->decimal('height', 5, 2)->nullable();
            $table->decimal('weight', 5, 2)->nullable();
            $table->decimal('chest', 5, 2)->nullable();
            $table->decimal('shoulder', 5, 2)->nullable();
            $table->string('body_shape')->nullable();
        });
    }
};