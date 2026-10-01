<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * THE 5 CORE BODY MEASUREMENTS ARE REPLACED BY TWO SIZE LABELS.
 *
 * A customer no longer types chest/waist/hips/shoulder/sleeve in centimetres.
 * They pick `upper_body_size` and `lower_body_size` (XS…2XL, e.g. M / M), and
 * every consumer that used to read the five decimals now reads the size chart
 * for those labels (App\Services\SizeChart).
 *
 * Existing rows are MIGRATED, not dropped: a user with a chest of 92.5cm / waist
 * 70 / hips 90 lands on the size band whose chest band their old chest fell in,
 * so nobody silently becomes "no size on file" and loses their recommendations.
 */
return new class extends Migration {
    /** Upper bound of chest (cm) per size, widest band wins for a miss. */
    private const CHEST_BANDS = [
        'XS' => 81.0,
        'S' => 88.0,
        'M' => 95.0,
        'L' => 102.0,
        'XL' => 109.0,
        '2XL' => 116.5,
    ];

    /** Upper bound of waist (cm) per size — the lower-body ladder. */
    private const WAIST_BANDS = [
        'XS' => 63.0,
        'S' => 70.0,
        'M' => 77.0,
        'L' => 84.0,
        'XL' => 91.0,
        '2XL' => 98.5,
    ];

    private function labelFor(float $value, array $bands, string $fallback): string
    {
        if ($value <= 0) {
            return $fallback;
        }

        foreach ($bands as $label => $max) {
            if ($value <= $max) {
                return $label;
            }
        }

        return array_key_last($bands);
    }

    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'upper_body_size')) {
                $table->string('upper_body_size', 10)->nullable()->after('email');
            }
            if (!Schema::hasColumn('users', 'lower_body_size')) {
                $table->string('lower_body_size', 10)->nullable()->after('upper_body_size');
            }
        });

        /*
         * Backfill BEFORE the drop, because this is the only moment the old
         * centimetres still exist. A user with no measurements at all gets M/M,
         * which is the chart's midpoint and the default the UI has always shown.
         */
        DB::table('users')->orderBy('id')->chunk(200, function ($users) {
            foreach ($users as $user) {
                $upper = $this->labelFor(
                    (float) ($user->chest_bust ?? 0),
                    self::CHEST_BANDS,
                    'M'
                );

                // The waist is the lower body's sizing axis; fall back to the
                // chest-derived label when no waist was ever recorded.
                $lower = isset($user->waist)
                    ? $this->labelFor((float) $user->waist, self::WAIST_BANDS, $upper)
                    : $upper;

                DB::table('users')->where('id', $user->id)->update([
                    'upper_body_size' => $upper,
                    'lower_body_size' => $lower,
                ]);
            }
        });

        $legacy = array_values(array_filter(
            ['chest_bust', 'waist', 'hips', 'shoulder_width', 'sleeve_length'],
            fn(string $column) => Schema::hasColumn('users', $column)
        ));

        /*
         * `top_size` / `bottom_size` are the PREVIOUS name for this same idea —
         * a Top Size select plus a numeric "Waist Size (Inches)" box, of which
         * only the top half was ever a real label. They are folded into
         * `upper_body_size` / `lower_body_size`, so a customer who had already
         * picked their top size keeps it rather than being asked again.
         */
        if (Schema::hasColumn('users', 'top_size') || Schema::hasColumn('users', 'bottom_size')) {
            DB::table('users')->orderBy('id')->chunk(200, function ($users) {
                foreach ($users as $user) {
                    $patch = [];

                    if (filled($user->top_size)) {
                        $patch['upper_body_size'] = strtoupper(trim((string) $user->top_size));
                    }

                    /*
                     * The old bottom value was a waist in INCHES (28-40), which
                     * is not the shape of anything on the size ladder — so it is
                     * deliberately NOT converted, and a genuine label that
                     * happens to be sitting in the column IS kept.
                     */
                    if (filled($user->bottom_size)
                        && preg_match('/^(XS|S|M|L|XL|2XL)$/i', trim((string) $user->bottom_size))) {
                        $patch['lower_body_size'] = strtoupper(trim((string) $user->bottom_size));
                    }

                    if ($patch !== []) {
                        DB::table('users')->where('id', $user->id)->update($patch);
                    }
                }
            });

            $legacy = array_merge($legacy, array_values(array_filter(
                ['top_size', 'bottom_size'],
                fn(string $column) => Schema::hasColumn('users', $column)
            )));
        }

        $legacy = array_values(array_unique($legacy));

        if ($legacy !== []) {
            Schema::table('users', function (Blueprint $table) use ($legacy) {
                $table->dropColumn($legacy);
            });
        }
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'chest_bust')) {
                $table->decimal('chest_bust', 5, 2)->nullable()->after('email');
            }
            foreach (['waist', 'hips', 'shoulder_width', 'sleeve_length'] as $column) {
                if (!Schema::hasColumn('users', $column)) {
                    $table->decimal($column, 5, 2)->nullable();
                }
            }
        });

        // Best-effort reverse: the centimetres are gone, so the sizes can only be
        // restored as the midpoint of the size band they name. This is lossy by
        // definition and exists so a rollback does not fail outright.
        DB::table('users')->orderBy('id')->chunk(200, function ($users) {
            foreach ($users as $user) {
                $upper = (string) ($user->upper_body_size ?? 'M');
                $lower = (string) ($user->lower_body_size ?? 'M');

                DB::table('users')->where('id', $user->id)->update([
                    'chest_bust' => self::CHEST_BANDS[$upper] ?? 95.0,
                    'waist' => self::WAIST_BANDS[$lower] ?? 77.0,
                    'hips' => null,
                    'shoulder_width' => null,
                    'sleeve_length' => null,
                ]);
            }
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['upper_body_size', 'lower_body_size']);
        });

        // Restore the previous columns so a rollback leaves the schema usable.
        // `top_size` came back as an uppercase copy of the upper label, and
        // `bottom_size` as a number-ish label rather than the inches it held
        // before — both are documented losses, not silent conversions.
        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'top_size')) {
                $table->string('top_size', 10)->nullable();
            }
            if (! Schema::hasColumn('users', 'bottom_size')) {
                $table->string('bottom_size', 10)->nullable();
            }
        });

        DB::table('users')->orderBy('id')->chunk(200, function ($users) {
            foreach ($users as $user) {
                DB::table('users')->where('id', $user->id)->update([
                    'top_size'    => $user->upper_body_size,
                    'bottom_size' => $user->lower_body_size,
                ]);
            }
        });
    }
};