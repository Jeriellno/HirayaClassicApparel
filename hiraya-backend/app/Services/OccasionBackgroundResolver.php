<?php

namespace App\Services;

use Illuminate\Support\Str;

/**
 * OccasionBackgroundResolver
 *
 * Maps an AI-detected occasion (or a garment category) onto the ONE default
 * background configured for it in `config/hiraya_backgrounds.php`, and resolves
 * that background to a public URL in Supabase Storage.
 *
 * Deliberately deterministic: the same input ALWAYS yields the same background.
 * That is the core business rule — "same garment / same occasion => same
 * background" — so there is no randomness anywhere in this class.
 */
class OccasionBackgroundResolver
{
    /**
     * Resolve a raw occasion string (or null) to a canonical occasion key.
     *
     * Accepts free-form AI output such as "Beach Wear" or "SUMMER" and matches
     * it, case- and separator-insensitively, against every configured alias.
     * Falls back to the configured default occasion.
     */
    public function resolveOccasionKey(?string $occasion): string
    {
        $occasions = config('hiraya_backgrounds.occasions', []);
        $default = config('hiraya_backgrounds.default', 'everyday');

        if (! $occasion) {
            return array_key_exists($default, $occasions) ? $default : array_key_first($occasions);
        }

        // Normalise: lowercase, collapse any non-alphanumeric run to a single
        // space so "beach-wear", "beach_wear" and "beach wear" all match.
        $needle = Str::of($occasion)->lower()->replaceMatches('/[^a-z0-9]+/', chr(32))->trim()->value();

        /*
         * Matching is done in TWO passes so a specific alias can never be
         * stolen by a broader one:
         *
         *   PASS 1 — exact equality against the key or any alias.
         *            This is unambiguous "formal" == "formal".
         *
         *   PASS 2 — word-boundary CONTAINMENT (needle inside alias, or alias
         *            inside needle). Bidirectional containment is required so
         *            "business casual" still finds the `business` alias while
         *            the exact pass has already claimed the plain "casual"
         *            case for `everyday`.
         *
         * Doing exact-first is what stops "Formal" being mis-matched to the
         * `cultural` alias "formal cultural" and "Casual" to "casual summer".
         */
        $containsMatch = null;

        foreach ($occasions as $key => $meta) {
            $aliases = array_map(
                fn ($a) => Str::of($a)->lower()->replaceMatches('/[^a-z0-9]+/', chr(32))->trim()->value(),
                array_merge([$key], $meta['aliases'] ?? [])
            );

            // PASS 1: exact match wins immediately.
            if (in_array($needle, $aliases, true)) {
                return $key;
            }

            // PASS 2: remember the first containment hit, but keep looking
            // for an exact match in the remaining occasions.
            if ($containsMatch === null) {
                foreach ($aliases as $alias) {
                    if ($alias !== '' && (str_contains($needle, $alias) || str_contains($alias, $needle))) {
                        $containsMatch = $key;
                        break;
                    }
                }
            }
        }

        if ($containsMatch !== null) {
            return $containsMatch;
        }

        return array_key_exists($default, $occasions) ? $default : array_key_first($occasions);
    }

    /**
     * Resolve from the AI's `occasions` array, preferring the FIRST occasion it
     * reported (Gemini lists the most relevant occasion first).
     *
     * @param  array<int, string>  $occasions
     */
    public function resolveFromOccasions(array $occasions): string
    {
        foreach ($occasions as $occasion) {
            if (is_string($occasion) && trim($occasion) !== '') {
                $key = $this->resolveOccasionKey($occasion);

                // A real match (not just the fallback) wins immediately.
                if ($key !== config('hiraya_backgrounds.default')) {
                    return $key;
                }
            }
        }

        // Nothing matched cleanly — resolve the first occasion (or the default).
        return $this->resolveOccasionKey($occasions[0] ?? null);
    }

    /**
     * The human-readable label for a canonical occasion key (for display on the
     * customer's shop surfaces)."
     */
    public function labelForKey(string $occasionKey): string
    {
        return (string) data_get(
            config('hiraya_backgrounds.occasions'),
            "{$occasionKey}.label",
            $occasionKey,
        );
    }
}
