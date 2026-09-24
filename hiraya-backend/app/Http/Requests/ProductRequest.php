<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ProductRequest extends FormRequest
{
    private const JSON_FIELDS = [
        'sizes', 'size_stocks', 'size_measurements',
        'colors', 'images', 'body_shapes',
        'occasions', 'ai_tags', 'garment_specifications'
    ];

    /*
     * CANONICAL AI-STYLING VOCABULARY.
     *
     * These mirror src/constants/productOptions.js on the frontend. Before this
     * guard, `occasions.*` / `body_shapes.*` accepted ANY string — so the Admin
     * console (which used 'SMART_CASUAL') and the Super Admin console (which used
     * 'BUSINESS') could each store values the OTHER could never match, and the AI
     * stylist silently failed to pair garments that were actually the same vibe.
     * Rejecting anything outside this list at the door keeps the vocabulary in
     * lock-step with both consoles.
     */
    private const OCCASIONS = [
        'CASUAL', 'FORMAL', 'BUSINESS', 'PARTY', 'STREETWEAR', 'MINIMALIST', 'TRADITIONAL',
    ];

    private const BODY_SHAPES = [
        'HOURGLASS', 'PEAR', 'APPLE', 'RECTANGLE', 'INVERTED_TRIANGLE',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        foreach (self::JSON_FIELDS as $field) {
            if ($this->has($field) && is_string($this->input($field))) {
                $decoded = json_decode($this->input($field), true);
                if (json_last_error() === JSON_ERROR_NONE) {
                    $this->merge([$field => $decoded]);
                }
            }
        }

        if ($this->has('undertone') && is_string($this->undertone)) {
            $this->merge(['undertone' => strtoupper($this->undertone)]);
        }

        if ($this->has('fit_type') && is_string($this->fit_type)) {
            $this->merge(['fit_type' => strtoupper($this->fit_type)]);
        }

        if ($this->has('featured')) {
            $this->merge([
                'featured' => filter_var($this->featured, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE)
            ]);
        }

        /*
         * Last-line canonicalisation of the AI-styling vocabulary.
         *
         * `occasions.*` / `body_shapes.*` are validated with a STRICT `Rule::in`,
         * so a value the AI phrased its own way ("Hourglass", "Inverted
         * Triangle") failed with "The selected body_shapes.0 is invalid" and the
         * whole save answered 422. `ProductImageAnalysisController` already
         * canonicalises its response, but this guard also covers the OTHER writers
         * (the Super Admin console, a stale cached analysis, or any direct API
         * caller) so no non-canonical value can ever reach the strict rule.
         *
         * Unrecognised values are DROPPED rather than passed through: leaving them
         * in would only reproduce the 422, and a tag the stylist cannot match is
         * worthless anyway.
         */
        foreach (['occasions' => self::OCCASIONS, 'body_shapes' => self::BODY_SHAPES] as $field => $canonical) {
            $values = $this->input($field);

            // Skip when the field is absent so a partial update (e.g. editing only
            // price) never wipes an existing tag set.
            if (! $this->has($field) || ! is_array($values)) {
                continue;
            }

            $this->merge([$field => $this->canonicalize($values, $canonical)]);
        }
    }

    /**
     * Map free-form AI values onto the canonical vocabulary.
     *
     * Case- and separator-insensitive, so "Hourglass", "hourglass" and
     * "INVERTED TRIANGLE" all resolve to their canonical constant. Values with no
     * canonical equivalent are dropped (they would fail the strict rule anyway).
     *
     * @param  array<int, mixed>  $values
     * @param  array<int, string> $canonical
     * @return array<int, string>
     */
    private function canonicalize(array $values, array $canonical): array
    {
        $out = [];

        foreach ($values as $value) {
            if (! is_string($value)) {
                continue;
            }

            $needle = strtoupper(trim((string) preg_replace('/[^A-Za-z0-9]+/', '_', $value)));

            if (in_array($needle, $canonical, true) && ! in_array($needle, $out, true)) {
                $out[] = $needle;
            }
        }

        return $out;
    }

    public function rules(): array
    {
        $isPost = $this->isMethod('POST') && !$this->has('_method');

        return [
            'name'                     => $isPost ? 'required|string|max:255' : 'sometimes|string|max:255',
            'price'                    => $isPost ? 'required|numeric|min:0' : 'sometimes|numeric|min:0',
            'category'                 => $isPost ? 'required|string|max:255' : 'sometimes|string|max:255',
            'subcategory'              => 'nullable|string|max:255',
            'description'              => 'nullable|string',
            'image_url'                => 'nullable|string',
            // STAGE 1 outputs: the background-replaced catalog image and the
            // occasion whose default background was used. Both optional so a
            // product saved without auto-fill still validates.
            'display_image_url'        => 'nullable|string',
            'background_occasion'      => 'nullable|string|max:50',
            'image'                    => 'nullable|image|mimes:jpeg,png,jpg,webp|max:5120',
            /*
             * The two upload slots the admin modal actually sends.
             *
             * Only `image` was validated before, so Laravel silently DISCARDED
             * both of these and `handleImageUpload()` never saw them — which is
             * why `display_image_url` was always empty and every customer
             * surface fell back to the admin's ORIGINAL photo.
             *
             *   image_file         -> the raw upload
             *   display_image_file -> the AI cut-out on the HIRAYA frame
             *   tryon_image_file   -> the BARE cut-out for virtual try-on
             *
             * SIZE BUDGET
             * -----------
             * `display_image_file` is NOT a photo — it is a RE-ENCODED PNG of the
             * composited 4:5 marketing card (black frame + gold borders +
             * reflection + wordmark) at the compositor's render size. PNG stores
             * the flat frame losslessly, so the card routinely lands in the 4-10 MB
             * range even when the source photo is under 2 MB.
             *
             * At the old uniform `max:5120` those saves failed validation, the
             * key was dropped from `validated()`, and the request still returned
             * 200 — so `display_image_url` stayed NULL while the admin saw
             * "success". Customers then fell back to the uncut original. The two
             * AI slots therefore get a `max:10240` (10 MB) budget; the raw upload
             * keeps 5 MB, which is what the UI advertises for it.
             */
            'tryon_image_file'         => 'nullable|image|mimes:jpeg,png,jpg,webp|max:10240',
            'image_file'               => 'nullable|image|mimes:jpeg,png,jpg,webp|max:5120',
            'display_image_file'       => 'nullable|image|mimes:jpeg,png,jpg,webp|max:10240',
            'images'                   => 'nullable|array',
            'colors'                   => 'nullable|array',
            'sizes'                    => 'nullable|array',
            'size_stocks'              => 'nullable|array',
            'size_measurements'        => 'nullable|array',
            'size_measurements.*'      => 'nullable|array',
            'material'                 => 'nullable|string|max:255',
            'gender'                   => 'nullable|string|max:255',
            'featured'                 => 'nullable|boolean',
            'stock'                    => 'nullable|integer|min:0',
            'undertone'                => 'nullable|string|in:WARM,COOL,NEUTRAL',
            'fit_type'                 => 'nullable|string|in:SLIM,REGULAR,LOOSE',
            'body_shapes'              => 'nullable|array',
            'body_shapes.*'            => ['string', Rule::in(self::BODY_SHAPES)],
            'occasions'                => 'nullable|array',
            'occasions.*'              => ['string', Rule::in(self::OCCASIONS)],
            'ai_tags'                  => 'nullable|array',
            'garment_specifications'   => 'nullable|array',
            '_method'                  => 'nullable|string|in:PUT,PATCH,DELETE',
        ];
    }
}