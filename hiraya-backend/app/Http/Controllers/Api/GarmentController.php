<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Garment;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class GarmentController extends Controller
{
    public function index(Request $request)
    {
        $garments = Garment::with('sizes')
            ->when($request->filled('category'), fn($q) => $q->where('category', $request->input('category')))
            ->orderBy('created_at', 'desc')
            ->paginate($request->input('per_page', 20));

        return response()->json($garments);
    }

    public function catalog(Request $request)
    {
        $garments = Garment::with(['sizes' => fn($q) => $q->where('stock', '>', 0)])
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($garments);
    }

    public function storeOrUpdate(Request $request, $id = null)
    {
        $validated = $request->validate([
            'name'                        => 'required|string|max:255',
            'description'                 => 'nullable|string',
            'price'                       => 'required|numeric|min:0',
            'category'                    => 'required|string|max:255',
            'sizes'                       => 'required|array|min:1',
            'sizes.*.size_label'          => 'required|string',
            'sizes.*.stock'               => 'required|integer|min:0',
            'sizes.*.chest_bust_min'      => 'nullable|numeric|min:0',
            'sizes.*.chest_bust_max'      => 'nullable|numeric|gte:sizes.*.chest_bust_min',
            'sizes.*.waist_min'           => 'nullable|numeric|min:0',
            'sizes.*.waist_max'           => 'nullable|numeric|gte:sizes.*.waist_min',
            'sizes.*.hips_min'            => 'nullable|numeric|min:0',
            'sizes.*.hips_max'            => 'nullable|numeric|gte:sizes.*.hips_min',
            'sizes.*.shoulder_width_min'  => 'nullable|numeric|min:0',
            'sizes.*.shoulder_width_max'  => 'nullable|numeric|gte:sizes.*.shoulder_width_min',
            'sizes.*.sleeve_length_min'   => 'nullable|numeric|min:0',
            'sizes.*.sleeve_length_max'   => 'nullable|numeric|gte:sizes.*.sleeve_length_min',
        ]);

        return DB::transaction(function () use ($validated, $id) {
            $garment = Garment::updateOrCreate(
                ['id' => $id],
                [
                    'name'        => $validated['name'],
                    'description' => $validated['description'] ?? null,
                    'price'       => $validated['price'],
                    'category'    => $validated['category'],
                ]
            );

            $existingSizeIds = collect($validated['sizes'])->pluck('id')->filter();
            $garment->sizes()->whereNotIn('id', $existingSizeIds)->delete();

            foreach ($validated['sizes'] as $sizeData) {
                $garment->sizes()->updateOrCreate(
                    ['id' => $sizeData['id'] ?? null],
                    [
                        'size_label'         => $sizeData['size_label'],
                        'stock'              => $sizeData['stock'],
                        'chest_bust_min'     => $sizeData['chest_bust_min'] ?? null,
                        'chest_bust_max'     => $sizeData['chest_bust_max'] ?? null,
                        'waist_min'          => $sizeData['waist_min'] ?? null,
                        'waist_max'          => $sizeData['waist_max'] ?? null,
                        'hips_min'           => $sizeData['hips_min'] ?? null,
                        'hips_max'           => $sizeData['hips_max'] ?? null,
                        'shoulder_width_min' => $sizeData['shoulder_width_min'] ?? null,
                        'shoulder_width_max' => $sizeData['shoulder_width_max'] ?? null,
                        'sleeve_length_min'  => $sizeData['sleeve_length_min'] ?? null,
                        'sleeve_length_max'  => $sizeData['sleeve_length_max'] ?? null,
                    ]
                );
            }

            return response()->json([
                'message' => 'Product and measurements saved successfully.',
                'data'    => $garment->load('sizes')
            ], 200);
        });
    }

    /**
     * Get Spotlight Recommendations matching logged-in user body measurements
     */
    public function getSpotlightRecommendations(Request $request)
    {
        $user = $request->user();

        /*
         * Measurements live as COLUMNS ON `users` — there is no
         * `bodyMeasurement`/`bodyMeasurements` relation on the User model.
         * The previous code dereferenced one of those phantom relations with
         * `$user->bodyMeasurement?->chest_bust`, which null-safes the RELATION
         * but not `$user` itself. With no auth middleware on the route, `$user`
         * was null and the whole endpoint 500'd:
         *
         *   Attempt to read property "bodyMeasurement" on null
         *
         * A guest now gets the same non-personalized fallback as a user who
         * simply has not filled their profile in yet.
         */
        if (! $user) {
            return response()->json([
                'has_measurements' => false,
                'recommendations'  => $this->catalogGarments(),
            ]);
        }

        $chest    = $user->chest_bust;
        $waist    = $user->waist;
        $hips     = $user->hips;
        $shoulder = $user->shoulder_width;
        $sleeve   = $user->sleeve_length;

        $hasMeasurements = ($chest || $waist || $hips || $shoulder || $sleeve);

        if (!$hasMeasurements) {
            return response()->json([
                'has_measurements' => false,
                'recommendations'  => $this->catalogGarments(),
            ]);
        }

        // Query Garments where size min-max fits user measurements
        $recommendedGarments = $this->catalogGarments(function ($query) use ($chest, $waist, $hips, $shoulder, $sleeve) {
            $query->whereHas('sizes', function ($q) use ($chest, $waist, $hips, $shoulder, $sleeve) {
                $q->where(function ($inner) use ($chest, $waist, $hips, $shoulder, $sleeve) {
                    if ($chest) {
                        $inner->where('chest_bust_min', '<=', $chest)
                              ->where('chest_bust_max', '>=', $chest);
                    }
                    if ($waist) {
                        $inner->where('waist_min', '<=', $waist)
                              ->where('waist_max', '>=', $waist);
                    }
                    if ($hips) {
                        $inner->where('hips_min', '<=', $hips)
                              ->where('hips_max', '>=', $hips);
                    }
                    if ($shoulder) {
                        $inner->where('shoulder_width_min', '<=', $shoulder)
                              ->where('shoulder_width_max', '>=', $shoulder);
                    }
                    if ($sleeve) {
                        $inner->where('sleeve_length_min', '<=', $sleeve)
                              ->where('sleeve_length_max', '>=', $sleeve);
                    }
                });
            });
        });

        /*
         * When the garment catalog has no size-matching entry, fall back to the
         * main `products` feed so the Spotlight is never empty for a user who
         * HAS saved measurements — an empty grid reads as a broken feature.
         */
        if ($recommendedGarments->isEmpty()) {
            $recommendedGarments = Product::latest()->take(8)->get();
        }

        return response()->json([
            'has_measurements' => true,
            'user_measurements' => [
                'chest_bust'     => $chest,
                'waist'          => $waist,
                'hips'           => $hips,
                'shoulder_width' => $shoulder,
                'sleeve_length'  => $sleeve
            ],
            'recommendations' => $recommendedGarments,
        ]);
    }

    /**
     * Read up to 8 entries from the `garments` catalog, optionally constrained.
     *
     * The table is now guaranteed to exist (see the
     * `recreate_missing_garments_table` migration, which repaired a schema that
     * was recorded as migrated but was absent from the live database — the cause
     * of `SQLSTATE[42P01] relation "garments" does not exist` on this endpoint).
     *
     * The caller still falls back to `products` when this returns an empty set,
     * so a catalog with no size-matching entry never leaves the Spotlight blank.
     */
    private function catalogGarments(?callable $constrain = null)
    {
        $query = Garment::with('sizes');

        if ($constrain) {
            $constrain($query);
        }

        return $query->take(8)->get();
    }
}