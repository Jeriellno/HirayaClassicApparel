<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Garment PAIRINGS — "this polo goes with that coat".
 *
 * Admins pair complementary pieces in the Add/Edit Product form; customers see
 * the pair as "Complete the Look" on the product page and as a one-tap
 * suggestion in the try-on Style Stack.
 *
 * A pairing is SYMMETRIC, so it is stored as TWO rows (A->B and B->A). That
 * keeps every read a plain `where product_id = ?` — no OR across two columns —
 * and the controller always writes and deletes both directions together.
 *
 * Both columns cascade on delete: removing a product removes its pairings,
 * instead of leaving customers a "pairs with" link to a 404.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('product_pairings')) {
            return;
        }

        Schema::create('product_pairings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignId('paired_product_id')->constrained('products')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['product_id', 'paired_product_id']);
            $table->index('paired_product_id');
        });

        /*
         * Supabase serves every `public` table over its REST API with the anon
         * key unless Row Level Security is on. RLS with NO policies closes that
         * door; Laravel connects as the table owner, which bypasses RLS, so the
         * application is unaffected (same as try_on_sessions).
         */
        if (DB::getDriverName() === 'pgsql') {
            $table = DB::getTablePrefix() . 'product_pairings';
            DB::statement("alter table \"{$table}\" enable row level security");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('product_pairings');
    }
};
