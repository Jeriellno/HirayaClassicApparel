<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * Fix the `waist` column type on `users`.
     *
     * WHY
     * ---
     * The five Core Body Measurements are all centimetre values with one decimal
     * place (e.g. 71.5). Four of the columns were created as `numeric(5,2)`, but
     * `waist` ended up as a plain `integer` — most likely because it was added by
     * a different migration or altered by hand against the live Supabase schema.
     *
     * The effect: saving a waist with any fractional part failed hard with
     *
     *   SQLSTATE[22P02]: invalid input syntax for type integer: "71.5"
     *
     * which surfaced to the user as "Failed to update database." and left the
     * measurements unsaved — the reason the AI Try-On never had body data to
     * work with, and why the fit recommendations never appeared.
     *
     * Aligning `waist` with its four siblings makes the whole profile writable.
     */
    public function up(): void
    {
        if (!Schema::hasColumn('users', 'waist')) {
            return;
        }

        // Postgres can widen an integer column to numeric in place, preserving
        // the existing values. `USING waist::numeric(5,2)` makes the cast
        // explicit so the change is deterministic.
        \Illuminate\Support\Facades\DB::statement(
            'ALTER TABLE users ALTER COLUMN waist TYPE numeric(5,2) USING waist::numeric(5,2)'
        );
    }

    /**
     * Reverting to `integer` would truncate any fractional values that have been
     * stored since, so the down path rounds rather than discarding the column.
     */
    public function down(): void
    {
        \Illuminate\Support\Facades\DB::statement(
            'ALTER TABLE users ALTER COLUMN waist TYPE integer USING ROUND(waist)::integer'
        );
    }
};
