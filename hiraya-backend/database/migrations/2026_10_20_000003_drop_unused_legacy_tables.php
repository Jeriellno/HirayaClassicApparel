<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * DROP THE LEGACY TABLES NOTHING USES ANY MORE.
 *
 *   garments, garment_sizes — a second, older catalogue. `products` is the only
 *                             catalogue the shop, console and try-on read; the
 *                             GarmentController / Garment models were removed.
 *   ai_rules, canvas_assets — the "AI Stylist Config" and "Canvas Assets"
 *                             consoles, already retired (see routes/api.php).
 *
 * All four were EMPTY when this was written. As a guard, a table that has
 * gained rows since is left alone rather than dropped with data in it.
 */
return new class extends Migration {
    private const TABLES = ['garment_sizes', 'garments', 'ai_rules', 'canvas_assets'];

    public function up(): void
    {
        foreach (self::TABLES as $table) {
            if (Schema::hasTable($table) && DB::table($table)->count() === 0) {
                Schema::drop($table);
            }
        }
    }

    public function down(): void
    {
        // Intentionally irreversible: the tables were empty and their code is gone.
    }
};
