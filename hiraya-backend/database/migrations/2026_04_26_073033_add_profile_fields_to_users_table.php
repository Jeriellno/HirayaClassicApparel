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
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'height')) {
                $table->integer('height')->nullable();
            }
            if (!Schema::hasColumn('users', 'waist')) {
                $table->integer('waist')->nullable();
            }
            if (!Schema::hasColumn('users', 'chest')) {
                $table->integer('chest')->nullable();
            }
            if (!Schema::hasColumn('users', 'user_photo_url')) {
                $table->string('user_photo_url')->nullable(); // Para permanent ang portrait
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['height', 'waist', 'chest', 'user_photo_url']);
        });
    }
};