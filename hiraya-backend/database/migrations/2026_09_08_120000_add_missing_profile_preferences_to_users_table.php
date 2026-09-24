<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'top_size')) {
                $table->string('top_size', 10)->nullable();
            }

            if (!Schema::hasColumn('users', 'bottom_size')) {
                $table->string('bottom_size', 10)->nullable();
            }

            if (!Schema::hasColumn('users', 'preferred_fit')) {
                $table->string('preferred_fit', 50)->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $columns = collect(['top_size', 'bottom_size', 'preferred_fit'])
                ->filter(fn (string $column) => Schema::hasColumn('users', $column))
                ->all();

            if ($columns) {
                $table->dropColumn($columns);
            }
        });
    }
};