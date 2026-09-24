<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * Recreate the missing `garments` table.
     *
     * WHY THIS MIGRATION EXISTS
     * -------------------------
     * `2026_07_23_000001_create_garments_table` is recorded as RAN in the
     * `migrations` table, but the table itself does NOT exist in the deployed
     * database — only its child `garment_sizes` was created. Every query against
     * it therefore threw:
     *
     *   SQLSTATE[42P01]: Undefined table: relation "garments" does not exist
     *
     * which broke the whole secondary catalog (`/api/garments`,
     * `/api/garments/catalog`, `POST /api/admin/garments`) and the size-based
     * Spotlight endpoint.
     *
     * Because the original migration is already marked as run, re-running the
     * old one is a no-op — hence this second, idempotent migration that repairs
     * the live schema. It is written to be safe whether or not the table exists.
     *
     * COLUMN NOTE
     * -----------
     * `description` is included even though the original migration omitted it:
     * `GarmentController::storeOrUpdate()` writes to it, so without this column
     * every admin save would fail with an unknown-column error the moment the
     * table came back.
     *
     * `image_base64` is made NULLABLE (it was NOT NULL originally). The catalog
     * flow now stores its rendered frame in `products.display_image_url` and
     * never sends `image_base64`, so a NOT NULL constraint would reject every
     * write.
     */
    public function up(): void
    {
        if (!Schema::hasTable('garments')) {
            Schema::create('garments', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->string('category'); // TOPS, BOTTOMS, DRESSES, OUTERWEAR, ...
                $table->text('description')->nullable(); // written by the controller
                $table->longText('image_base64')->nullable(); // transparent PNG data URI
                $table->integer('layer_order')->default(0);
                $table->decimal('price', 8, 2)->default(0.00);
                $table->timestamps();
            });

            return;
        }

        // The table already exists (a different environment, or a partial run):
        // patch in the columns the controller needs rather than dropping data.
        Schema::table('garments', function (Blueprint $table) {
            if (!Schema::hasColumn('garments', 'description')) {
                $table->text('description')->nullable()->after('category');
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('garments');
    }
};
