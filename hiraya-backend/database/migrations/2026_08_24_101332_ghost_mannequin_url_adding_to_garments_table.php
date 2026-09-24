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
    Schema::table('products', function (Blueprint $table) { // Baguhin ang 'garments' dito
        $table->text('ghost_mannequin_url')->nullable()->after('image_url');
    });
}

public function down(): void
{
    Schema::table('products', function (Blueprint $table) { // Baguhin din dito
        $table->dropColumn('ghost_mannequin_url');
    });
}
};
