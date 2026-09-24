<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drop the retired `wishlists` table.
 *
 * The wishlist / "Saved" bookmark tier was removed end to end: the UI (Saved
 * tab, wishlist components), the API (`/wishlist`, `/admin/wishlist-lookup`,
 * `/analytics/wishlist-engagement`), the model and its relationships. The only
 * thing left was the physical table, which stayed live in Supabase and kept the
 * feature "halfive" (rows could still exist and analytics still counted them).
 *
 * My Bag is now the single pre-purchase container, so this table has no readers
 * and no writers. Dropping it removes the last trace of the wishlist.
 *
 * The original create-*wishlists_table* migration is intentionally left in place
 * so the migration history is unchanged; this later migration does the removal.
 * NOTE: running this deletes all existing saved-item rows — that data is being
 * deliberately retired along with the feature.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('wishlists');
    }

    public function down(): void
    {
        // Recreate the table so `migrate:rollback` restores a working schema.
        Schema::create('wishlists', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->foreignId('product_id')->constrained()->onDelete('cascade');
            $table->string('selected_size')->default('M');
            $table->string('selected_color')->default('Standard');
            $table->integer('quantity')->default(1);
            $table->timestamps();
        });
    }
};
