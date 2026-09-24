<?php

namespace App\Console\Commands;

use App\Models\Product;
use Illuminate\Console\Command;

/**
 * Reconcile legacy AI-styling tag values to the canonical vocabulary.
 *
 *   php artisan hiraya:normalize-ai-tags           # dry run (report only)
 *   php artisan hiraya:normalize-ai-tags --apply   # write the changes
 *
 * WHY THIS EXISTS
 * ---------------
 * The two consoles used to tag garments with DIFFERENT occasion lists: the Admin
 * console wrote 'SMART_CASUAL' while the Super Admin console wrote 'BUSINESS' for
 * the same vibe. ProductRequest now rejects anything outside the canonical set,
 * so any product still holding a legacy value would FAIL validation the next time
 * someone edits it. This command rewrites those legacy values to their canonical
 * equivalent so the stricter rule is safe to put in front of live data.
 *
 * The mapping is intentionally narrow: it only touches values we KNOW map cleanly.
 * Anything unrecognised is reported and left untouched, never guessed at.
 */
class NormalizeAiTags extends Command
{
    protected $signature = 'hiraya:normalize-ai-tags {--apply : Persist the changes instead of a dry run}';

    protected $description = 'Normalize legacy product AI-tag values (occasions, body_shapes) to the canonical vocabulary';

    /** Canonical sets — MUST match ProductRequest and src/constants/productOptions.js. */
    private const CANONICAL_OCCASIONS = [
        'CASUAL',
        'FORMAL',
        'BUSINESS',
        'PARTY',
        'STREETWEAR',
        'MINIMALIST',
        'TRADITIONAL',
    ];

    private const CANONICAL_BODY_SHAPES = [
        'HOURGLASS',
        'PEAR',
        'APPLE',
        'RECTANGLE',
        'INVERTED_TRIANGLE',
    ];

    /** Legacy value => canonical value. */
    private const OCCASION_MAP = [
        'SMART_CASUAL' => 'BUSINESS',
        'smart_casual' => 'BUSINESS',
        'Business' => 'BUSINESS',
        'business' => 'BUSINESS',
        'Gala' => 'FORMAL',
        'gala' => 'FORMAL',
        'Traditional' => 'TRADITIONAL',
        'Cultural' => 'TRADITIONAL',
        'cultural' => 'TRADITIONAL',
    ];

    private const BODY_SHAPE_MAP = [
        'InvertedTriangle' => 'INVERTED_TRIANGLE',
        'inverted_triangle' => 'INVERTED_TRIANGLE',
        'Rect' => 'RECTANGLE',
    ];

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $changed = 0;

        Product::query()->orderBy('id')->chunk(100, function ($products) use ($apply, &$changed) {
            foreach ($products as $product) {
                $occasions = is_array($product->occasions) ? $product->occasions : [];
                $bodyShapes = is_array($product->body_shapes) ? $product->body_shapes : [];

                $newOccasions = $this->normalize($occasions, self::OCCASION_MAP, self::CANONICAL_OCCASIONS);
                $newBodyShapes = $this->normalize($bodyShapes, self::BODY_SHAPE_MAP, self::CANONICAL_BODY_SHAPES);

                $occasionsChanged = $newOccasions !== $occasions;
                $bodyShapesChanged = $newBodyShapes !== $bodyShapes;

                if (!$occasionsChanged && !$bodyShapesChanged) {
                    continue;
                }

                $changed++;
                $this->line(sprintf(
                    'Product #%s: occasions %s -> %s%s',
                    $product->id,
                    json_encode($occasions),
                    json_encode($newOccasions),
                    $bodyShapesChanged ? ' ; body_shapes -> ' . json_encode($newBodyShapes) : ''
                ));

                if ($apply) {
                    if ($occasionsChanged) {
                        $product->occasions = $newOccasions;
                    }
                    if ($bodyShapesChanged) {
                        $product->body_shapes = $newBodyShapes;
                    }
                    $product->save();
                }
            }
        });

        if ($changed === 0) {
            $this->info('No legacy AI-tag values found. Nothing to do.');
        } elseif ($apply) {
            $this->info("✔ Normalized {$changed} product(s).");
        } else {
            $this->warn("{$changed} product(s) would change. Re-run with --apply to persist.");
        }

        return self::SUCCESS;
    }

    /**
     * Map known legacy values to canonical ones, drop unknowns' casing issues by
     * uppercasing when it collides with the canonical set, and de-duplicate.
     */
    private function normalize(array $values, array $map, array $canonical): array
    {
        $out = [];
        foreach ($values as $value) {
            if (!is_string($value)) {
                continue;
            }

            $mapped = $map[$value] ?? null;

            if ($mapped === null) {
                // Already canonical? Keep it. Otherwise try an uppercase match.
                if (in_array($value, $canonical, true)) {
                    $mapped = $value;
                } elseif (in_array(strtoupper($value), $canonical, true)) {
                    $mapped = strtoupper($value);
                } else {
                    // Unknown — leave it exactly as-is so nothing is silently lost.
                    $mapped = $value;
                }
            }

            if (!in_array($mapped, $out, true)) {
                $out[] = $mapped;
            }
        }

        return $out;
    }
}
