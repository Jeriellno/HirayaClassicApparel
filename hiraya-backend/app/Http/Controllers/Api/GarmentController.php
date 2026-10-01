<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\WritesAuditTrail;
use App\Http\Controllers\Controller;
use App\Models\Garment;
use App\Models\Product;
use App\Services\SizeChart;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class GarmentController extends Controller
{
    use WritesAuditTrail;
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
        /*
         * A GARMENT IS BEING CREATED OR EDITED — capture the before-image first.
         *
         * The read happens BEFORE `updateOrCreate` so the diff below can report what
         * actually moved, and it is deliberately scoped to `$id`: a create has no
         * prior state, and a null lookup there would silently "find" nothing and make
         * every new garment look like an edit of an empty record.
         *
         * `with('sizes')` is what makes the size/measurement changes visible. The
         * garment's own columns are only a fraction of what this endpoint writes —
         * the size chart (stock per size, and the fit ranges that decide who the
         * garment is recommended to) lives in a related table, so auditing only the
         * parent would report "name updated" for an admin who had really just rebuilt
         * an entire size chart.
         */
        $before = $id
            ? Garment::with('sizes')->find($id)
            : null;

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

        return DB::transaction(function () use ($request, $validated, $id, $before) {
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

            $garment->refresh()->load('sizes');

            /*
             * WRITE THE TRAIL ENTRY, INSIDE THE TRANSACTION.
             *
             * The audit write is the LAST thing in the transaction so that a failing
             * insert rolls the whole edit back, rather than committing a change to
             * the catalog that the Super Admin's audit tab has no record of. The
             * opposite trade — commit the edit, then try to log it — is what produces
             * the silent gaps this trail is supposed to eliminate, because a failed
             * write there is swallowed and the row is simply gone.
             *
             * An EDIT is reported as a diff ("price: 1200 -> 1450") so the entry is
             * useful months later. A CREATE has no before-image, so it is reported
             * with the record's identity and its starting values instead.
             */
            $watched = ['name', 'description', 'price', 'category', 'size_chart', 'stock'];
            $after = [
                'name' => $garment->name,
                'description' => $garment->description,
                'price' => $garment->price,
                'category' => $garment->category,
                'size_chart' => $garment->sizes->map(fn($s) => $s->size_label . '=' . $s->stock)->implode(', '),
                'stock' => $garment->sizes->sum('stock'),
            ];

            $changes = $before ? $this->describeChanges($before->toArray() + ['size_chart' => null, 'stock' => null], $after, $watched) : null;

            $this->writeAudit(
                $request,
                $before ? 'UPDATE_GARMENT' : 'CREATE_GARMENT',
                'GARMENTS',
                $before
                    ? 'Garment #' . $garment->id . ' (' . $garment->name . ') edited.'
                        . ($changes ? ' Changed — ' . $changes : ' No tracked field changed.')
                    : 'New garment #' . $garment->id . ' (' . $garment->name . ') created at '
                        . $garment->price . ' in ' . $garment->category . '. Sizes: ' . $after['size_chart'] . '.',
            );

            return response()->json([
                'message' => 'Product and measurements saved successfully.',
                'data'    => $garment
            ], 200);
        });
    }

    /**
     * Get Spotlight Recommendations matching the logged-in user's sizes.
     *
     * The five body measurements are gone. This now matches on the SIZE the
     * customer wears (upper for torso garments, lower for bottoms), which is
     * the only signal the profile carries.
     */
    public function getSpotlightRecommendations(Request $request)
    {
        $user = $request->user();

        /*
         * The customer's sizing profile lives as COLUMNS ON `users` — there is no
         * `bodyMeasurement`/`bodyMeasurements` relation on the User model.
         * The previous code dereferenced one of those phantom relations with
         * `$user->bodyMeasurement?->chest_bust`, which null-safes the RELATION
         * but not `$user` itself. With no auth middleware on the route, `$user`
         * was null and the whole endpoint 500'd:
         *
         *   Attempt to read property "bodyMeasurement" on null
         *
         * A guest now gets the same non-personalized fallback as a user who
         * simply has not set their sizes yet.
         */
        if (! $user) {
            return response()->json([
                'has_sizes' => false,
                'recommendations' => $this->catalogGarments(),
            ]);
        }

        $upper = SizeChart::normaliseLabel($user->upper_body_size);
        $lower = SizeChart::normaliseLabel($user->lower_body_size);

        if ($upper === null && $lower === null) {
            return response()->json([
                'has_sizes' => false,
                'recommendations' => $this->catalogGarments(),
            ]);
        }

        /*
         * A garment is a candidate when it is stocked in EITHER of the
         * customer's sizes. Constraining to one axis would hide every top from
         * someone whose upper and lower sizes differ (a common M-top / L-trouser
         * combination), and the garment's own category decides which size
         * actually governs the cut anyway.
         */
        $wantedSizes = array_values(array_unique(array_filter([$upper, $lower])));

        $recommendedGarments = $this->catalogGarments(function ($query) use ($wantedSizes) {
            $query->whereHas('sizes', function ($q) use ($wantedSizes) {
                $q->whereIn('size_label', $wantedSizes)
                  ->where('stock', '>', 0);
            });
        });

        /*
         * When the garment catalog has no size-matching entry, fall back to the
         * main `products` feed so the Spotlight is never empty for a user who
         * HAS set their sizes — an empty grid reads as a broken feature.
         */
        if ($recommendedGarments->isEmpty()) {
            $recommendedGarments = Product::latest()->take(8)->get();
        }

        return response()->json([
            'has_sizes' => true,
            'user_sizes' => [
                'upper_body_size' => $upper,
                'lower_body_size' => $lower,
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