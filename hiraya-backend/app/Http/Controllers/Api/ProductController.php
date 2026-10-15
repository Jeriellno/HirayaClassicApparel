<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\WritesAuditTrail;
use App\Http\Controllers\Controller;
use App\Http\Requests\ProductRequest;
use App\Models\Product;
use App\Services\SizeChart;
use App\Support\ProductTaxonomy;
use App\Support\ProductVariants;
use App\Support\SupabaseStorage;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

class ProductController extends Controller
{
    use WritesAuditTrail;

    /*
     * DEFAULT_SIZE_CHART used to be a private constant here, duplicating the
     * same numbers the stylist, the render job and the pre-processor each held.
     * It now lives in App\Services\SizeChart so a chart change is made once.
     *
     * See `processProductInventoryAndMeasurements()` for how it is used: as the
     * per-size fallback when an admin supplies no measurements of their own.
     */

    public function index(Request $request): JsonResponse
    {
        try {
            // Pairings ride along so the shop, the admin form and the try-on
            // stack can all show "pairs well with" without a request per card.
            // + review count and average, for the star rating on shop cards.
            $query = Product::with('pairedProducts')
                ->withCount('reviews')
                ->withAvg('reviews', 'rating')
                ->latest();

            // Optional ?category= / ?subcategory= filters. Without them the
            // response is the full catalog, exactly as before.
            $category = trim((string) $request->query('category', ''));
            if ($category !== '') {
                $query->whereRaw('UPPER(category) = ?', [ProductTaxonomy::normaliseCategory($category)]);
            }
            $subcategory = trim((string) $request->query('subcategory', ''));
            if ($subcategory !== '') {
                $query->whereRaw('LOWER(subcategory) = ?', [mb_strtolower($subcategory)]);
            }

            $products = $query->get();
            return response()->json($products, 200);
        } catch (\Throwable $e) {
            Log::error('Error fetching products: ' . $e->getMessage());
            return response()->json(['message' => 'Products could not be loaded right now.'], 500);
        }
    }

    public function spotlight(Request $request): JsonResponse
    {
        try {
            $user = $request->user();

            /*
             * The 5 Core measurements are COLUMNS ON `users`; there is no
             * `bodyMeasurements` relation on the User model. The old
             * `$user->bodyMeasurements ?? $user` fell back to `$user` only by
             * accident (Eloquent returns null for an undefined attribute), so
             * the real source of truth was always `$user` itself. Read it
             * directly instead of relying on a relation that does not exist.
             */
            $userMeasurements = $user;

            if ($userMeasurements && $this->hasValidMeasurements($userMeasurements)) {
                $matchedProducts = $this->getPersonalizedSpotlight($userMeasurements);

                if ($matchedProducts->isNotEmpty()) {
                    return response()->json([
                        'type'    => 'personalized',
                        'message' => 'Garments matched to your body measurements',
                        'data'    => $matchedProducts
                    ], 200);
                }
            }

            $latestProducts = Product::withCount('reviews')->withAvg('reviews', 'rating')->latest()->take(8)->get();

            return response()->json([
                'type'    => 'default',
                'message' => 'Latest garments spotlight',
                'data'    => $latestProducts
            ], 200);
        } catch (\Throwable $e) {
            Log::error('Error fetching spotlight recommendations: ' . $e->getMessage());
            return response()->json(['message' => 'Products could not be loaded right now.'], 500);
        }
    }

    public function show($id): JsonResponse
    {
        $product = Product::with('pairedProducts')->find($id);
        if (!$product) {
            return response()->json(['message' => 'Product not found'], 404);
        }
        return response()->json($product, 200);
    }

    public function store(ProductRequest $request): JsonResponse
    {
        try {
            $validated = $request->validated();
            $validated = $this->handleImageUpload($request, $validated);
            $validated = $this->handleColorVariants($request, $validated);
            $validated = $this->prepareAiTags($validated);
            $validated = $this->processProductInventoryAndMeasurements($validated, $request);

            // Refuse an impossible pairing BEFORE anything is written.
            $this->assertPairable($request, $validated['category'] ?? null, null);

            $product = Product::create($validated);

            $this->syncPairings($request, $product);

            $this->writeAudit(
                $request,
                'CREATE_PRODUCT',
                'PRODUCTS',
                'New product #' . $product->id . ' (' . $product->name . ') created at '
                    . $product->price . ' with ' . $product->stock . ' in stock.',
            );

            return response()->json([
                'success' => true,
                'data'    => $product->load('pairedProducts')
            ], 201);
        } catch (ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('Error storing product: ' . $e->getMessage());
            return response()->json(['message' => 'The product could not be saved. Please try again.'], 500);
        }
    }

    public function update(ProductRequest $request, $id): JsonResponse
    {
        try {
            $product = Product::find($id);
            if (!$product) {
                return response()->json(['message' => 'Product not found'], 404);
            }

            $validated = $request->validated();
            $validated = $this->handleImageUpload($request, $validated, $product);
            $validated = $this->handleColorVariants($request, $validated, $product);
            $validated = $this->prepareAiTags($validated, is_array($product->ai_tags) ? $product->ai_tags : []);
            $validated = $this->processProductInventoryAndMeasurements($validated, $request);

            /*
             * SNAPSHOT BEFORE THE WRITE. `$product` is a live Eloquent model and
             * `$product->update()` mutates it in place, so the pre-edit values have
             * to be captured while they still exist. Diffing afterwards would compare
             * the product against itself and report that nothing changed, every time.
             */
            $before = $product->toArray();

            // Checked against the category this edit is saving, which may be new.
            $this->assertPairable($request, $validated['category'] ?? $product->category, (int) $product->id);

            $product->update($validated);

            $this->syncPairings($request, $product);

            /*
             * Record the edit on the security trail.
             *
             * The diff is taken against the model as it was loaded at line 109, which
             * is still the pre-edit state because `$product->update()` mutates in
             * place — so `$before` has to be snapshotted BEFORE that call, not read
             * from the model afterwards. Reading it afterwards would compare the
             * product to itself and always report "no tracked field changed".
             */
            $changes = $this->describeChanges($before, $validated, [
                'name', 'description', 'price', 'category', 'subcategory', 'stock',
                'body_shapes', 'undertone', 'occasions', 'fit_type', 'sku',
            ]);

            $this->writeAudit(
                $request,
                'UPDATE_PRODUCT',
                'PRODUCTS',
                'Product #' . $product->id . ' (' . $product->name . ') edited.'
                    . ($changes ? ' Changed — ' . $changes : ' No tracked field changed.'),
            );

            return response()->json([
                'success' => true,
                'data'    => $product->load('pairedProducts')
            ], 200);
        } catch (ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('Error updating product: ' . $e->getMessage());
            return response()->json(['message' => 'The product changes could not be saved. Please try again.'], 500);
        }
    }

    /**
     * PATCH /api/admin/products/{product}/ai-tags
     *
     * Updates ONLY the AI styling tags of a product (body_shapes, undertone,
     * occasions, fit_type) without touching price/stock/images. Used by the
     * Admin "AI Styling Tags" tab.
     */
    public function updateAiTags(Request $request, $id): JsonResponse
    {
        try {
            $product = Product::find($id);
            if (!$product) {
                return response()->json(['message' => 'Product not found'], 404);
            }

            $validated = $request->validate([
                'undertone'    => 'nullable|string|in:WARM,COOL,NEUTRAL',
                'fit_type'     => 'nullable|string|in:SLIM,REGULAR,LOOSE',
                'body_shapes'  => 'nullable|array',
                'body_shapes.*'=> 'string',
                'occasions'    => 'nullable|array',
                'occasions.*'  => 'string',
                'ai_tags'      => 'nullable|array',
            ]);

            // Merge into the existing tags so a partial payload (e.g. only
            // body_shapes) never wipes the other AI attributes.
            $merged = $this->prepareAiTags(
                $validated,
                is_array($product->ai_tags) ? $product->ai_tags : []
            );

            $product->update(['ai_tags' => $merged['ai_tags'] ?? $product->ai_tags]);

            /*
             * The AI tags decide which customers this product is recommended to, so
             * a change here is a merchandising decision rather than a typo fix and
             * belongs on the trail under its own action. It is separate from
             * UPDATE_PRODUCT on purpose: this endpoint touches only the tags, and
             * reporting it as a general product edit would hide the fact that the
             * styling rules were what moved.
             */
            $this->writeAudit(
                $request,
                'UPDATE_AI_TAGS',
                'PRODUCTS',
                'AI styling tags for product #' . $product->id . ' (' . $product->name . ') set to '
                    . (json_encode($product->fresh()->ai_tags) ?: 'none') . '.',
            );

            return response()->json([
                'success' => true,
                'data'    => $product->fresh(),
            ], 200);
        } catch (\Throwable $e) {
            Log::error('Error updating AI tags: ' . $e->getMessage());
            return response()->json(['message' => 'The styling tags could not be saved. Please try again.'], 500);
        }
    }

    /** The requested partner products, minus the product itself. */
    private function requestedPartners(Request $request, ?int $selfId)
    {
        $ids = collect($request->input('paired_product_ids') ?? [])
            ->map(fn ($id) => (int) $id)
            ->reject(fn ($id) => $id <= 0 || $id === $selfId)
            ->unique()
            ->values();

        return Product::query()->whereIn('id', $ids)->get(['id', 'name', 'category']);
    }

    /**
     * Throws a 422 when a requested pair breaks the outfit rule (GarmentPairing).
     * Called before the product is written, so a refused pairing saves nothing.
     */
    private function assertPairable(Request $request, ?string $category, ?int $selfId): void
    {
        if (!$request->has('paired_product_ids')) {
            return;
        }

        $refused = $this->requestedPartners($request, $selfId)->reject(
            fn (Product $p) => \App\Support\GarmentPairing::compatible($category, $p->category)
        );

        if ($refused->isNotEmpty()) {
            throw ValidationException::withMessages([
                'paired_product_ids' => 'These pieces cannot be paired with a ' . strtolower((string) $category) . ': '
                    . $refused->map(fn ($p) => $p->name . ' (' . strtolower((string) $p->category) . ')')->implode(', ')
                    . '. Pair garments worn on different layers — e.g. a top with outerwear or bottoms.',
            ]);
        }
    }

    /**
     * Replaces this product's pairings with `paired_product_ids`, both directions.
     *
     * Runs only when the field was SENT, so an edit from a client that does not
     * know about pairings never wipes them; an empty array is the explicit
     * "unpair everything". `assertPairable` has already vetted the list.
     */
    private function syncPairings(Request $request, Product $product): void
    {
        if (!$request->has('paired_product_ids')) {
            return;
        }

        $partners = $this->requestedPartners($request, (int) $product->id);

        $before = $product->pairedProducts()->pluck('name')->sort()->values()->all();

        DB::transaction(function () use ($product, $partners) {
            DB::table('product_pairings')
                ->where('product_id', $product->id)
                ->orWhere('paired_product_id', $product->id)
                ->delete();

            $now = now();
            $rows = [];
            foreach ($partners as $partner) {
                $rows[] = ['product_id' => $product->id, 'paired_product_id' => $partner->id, 'created_at' => $now, 'updated_at' => $now];
                $rows[] = ['product_id' => $partner->id, 'paired_product_id' => $product->id, 'created_at' => $now, 'updated_at' => $now];
            }
            if ($rows) {
                DB::table('product_pairings')->insert($rows);
            }
        });

        $after = $partners->pluck('name')->sort()->values()->all();
        if ($before !== $after) {
            $this->writeAudit(
                $request,
                'UPDATE_PAIRINGS',
                'PRODUCTS',
                'Product #' . $product->id . ' (' . $product->name . ') pairings: '
                    . ($before ? implode(', ', $before) : '—') . ' -> ' . ($after ? implode(', ', $after) : '—') . '.',
            );
        }
    }

    public function destroy(Request $request, $id): JsonResponse
    {
        $product = Product::find($id);
        if (!$product) {
            return response()->json(['message' => 'Product not found'], 404);
        }

        /*
         * CAPTURE THE IDENTITY BEFORE THE DELETE.
         *
         * Once `$product->delete()` runs, the model is gone and `->name` reads null,
         * so an audit entry written afterwards could only say "product #12 deleted"
         * with nothing to identify what was actually removed from the catalog. The
         * name and price are copied out now, while they still exist, because a
         * deletion is the one audit entry that can never be reconstructed from the
         * database later.
         */
        $deletedId = $product->id;
        $deletedName = $product->name;
        $deletedPrice = $product->price;

        /*
         * IMAGE CLEANUP IS BEST-EFFORT AND MUST NEVER BLOCK THE DELETE.
         *
         * The product row is the thing the admin asked to remove; the bucket
         * objects are an optimisation that keeps the store from accumulating
         * orphans. These two are NOT coupled, and the original code coupled them:
         * it called `deleteProductImage()` first, with no guard, so ANY failure in
         * the storage layer aborted the whole request BEFORE `$product->delete()`.
         *
         * The observed failure was a transport error reaching Supabase
         * (`cURL error 60: unable to get local issuer certificate` on a host whose
         * PHP has no CA bundle). Every delete answered 500 and removed nothing — a
         * row that could not be deleted for as long as the network misbehaved.
         *
         * Each slot is wrapped on its own so one bad reference cannot skip the
         * others, and the row deletion below is deliberately outside the attempt:
         * the product is gone even if the bucket is unreachable. Any object left
         * behind is a cosmetic orphan, recoverable later, never a user-facing error.
         */
        $variantImages = [];
        foreach (ProductVariants::all($product) as $variant) {
            array_push($variantImages, $variant['image_url'] ?? null, $variant['display_image_url'] ?? null, $variant['ghost_mannequin_url'] ?? null);
        }

        foreach ([$product->image_url, $product->display_image_url, $product->ghost_mannequin_url, ...$variantImages] as $reference) {
            try {
                $this->deleteProductImage($reference);
            } catch (\Throwable $e) {
                Log::warning('Product delete: image cleanup skipped.', [
                    'product_id' => $product->id,
                    'reference'  => $reference,
                    'error'      => $e->getMessage(),
                ]);
            }
        }

        try {
            $product->delete();

            $this->writeAudit(
                $request,
                'DELETE_PRODUCT',
                'PRODUCTS',
                'Product #' . $deletedId . ' (' . $deletedName . ') deleted from the catalog; it was listed at '
                    . $deletedPrice . '.',
            );
        } catch (\Throwable $e) {
            Log::error('Error deleting product: ' . $e->getMessage());

            return response()->json(['message' => 'Could not delete the product. Please try again.'], 500);
        }

        return response()->json(['message' => 'Product deleted successfully'], 200);
    }

    /**
     * Persist the uploaded image files and map them onto the two URL columns.
     *
     * THE TWO SLOTS
     * -------------
     * The admin modal sends the uploads in one multipart request:
     *
     *   image_file         -> the original upload          -> `image_url`
     *   display_image_file -> the AI cut-out on the frame  -> `display_image_url`
     *   tryon_image_file   -> the BARE cut-out (no frame,  -> `ghost_mannequin_url`
     *                         no wordmark, no caption)
     *
     * `image` is kept as a legacy alias for the original so older clients (and any
     * direct API call) keep working.
     *
     * WHY THE THIRD SLOT EXISTS
     * -------------------------
     * `display_image_file` is a MARKETING CARD — the cut-out composited onto a
     * black frame with gold borders, a reflection and the HIRAYA wordmark. That is
     * right for the shop grid, but it is a terrible input to virtual try-on: the
     * try-on must recover the garment's own pixels from it, and the frame,
     * reflection and wordmark share the card's tones, so the recovery is lossy and
     * the product-name caption welded to the garment's shoulder is unremovable.
     *
     * `ghost_mannequin_url` is the column `TryOnController` already prefers as "the
     * cleanest VTON input", and until now nothing populated it. `tryon_image_file`
     * fills it with the bare transparent cut-out, so try-on receives clean fabric
     * and needs no recovery guesswork at all.
     *
     * WHY THIS WAS BROKEN
     * -------------------
     * Only `image` was handled. The admin UI has never sent `image` — it sends
     * `image_file` + `display_image_file` — so NEITHER upload was ever stored and
     * `display_image_url` stayed NULL for every product. Every customer surface
     * resolves its image as `display_image_url || image_url`, so they all showed
     * the raw original photo instead of the finished catalog image.
     */
    private function handleImageUpload(Request $request, array $validated, ?Product $product = null): array
    {
        // The ORIGINAL upload. `image` is a legacy alias of `image_file`.
        $originalFile = $request->file('image_file') ?? $request->file('image');

        if ($originalFile) {
            if ($product && $product->image_url) {
                $this->deleteProductImage($product->image_url);
            }

            /*
             * Stored in the Supabase `products` bucket, NOT on the local disk.
             *
             * The local `public` disk was the original target and it cannot work
             * here: `storage/app/public` is gitignored, so every deploy produced
             * an empty tree while the database kept a valid-looking
             * `display_image_url` — the reported "403 then NO IMAGE" bug, with the
             * rows intact and the bytes simply absent. See App\Support\SupabaseStorage
             * for the full reasoning (and why this is the REST API rather than the
             * S3 driver).
             */
            $validated['image_url'] = SupabaseStorage::putUploadedFile($originalFile, 'products');
        }

        /*
         * The AI cut-out that every customer-facing surface should display.
         *
         * It is replaced on a new upload and preserved otherwise: an edit that
         * does not re-run auto-fill must not wipe an existing cut-out.
         */
        if ($request->hasFile('display_image_file')) {
            if ($product && $product->display_image_url) {
                $this->deleteProductImage($product->display_image_url);
            }

            $validated['display_image_url'] = SupabaseStorage::putUploadedFile(
                $request->file('display_image_file'),
                'catalog'
            );
        } elseif ($request->file('display_image_file') !== null) {
            /*
             * A file WAS posted but is not a valid upload — almost always a
             * validation rejection (over the size cap, or a mime the rule does
             * not allow). `validated()` drops invalid keys, and because
             * `display_image_file` is nullable the whole request STILL returns
             * 200, so this used to be completely silent: the admin saw
             * "success" and the shop kept rendering the uncut original.
             *
             * Log it loudly so the cause is visible in `storage/logs` instead of
             * having to be reverse-engineered from an empty column.
             */
            Log::warning('display_image_file was posted but discarded before storage', [
                'product_id'    => optional($product)->id,
                'original_name' => $request->file('display_image_file')?->getClientOriginalName(),
                'client_size'   => $request->file('display_image_file')?->getSize(),
                'upload_error'  => $request->file('display_image_file')?->getError(),
            ]);
        }

        /*
         * The BARE cut-out for virtual try-on (see the header note).
         *
         * Stored under `catalog/` alongside the framed card. Replaced on a new
         * upload and preserved otherwise, exactly like the display slot.
         */
        if ($request->hasFile('tryon_image_file')) {
            if ($product && $product->ghost_mannequin_url) {
                $this->deleteProductImage($product->ghost_mannequin_url);
            }

            $validated['ghost_mannequin_url'] = SupabaseStorage::putUploadedFile(
                $request->file('tryon_image_file'),
                'catalog'
            );
        } elseif ($request->file('tryon_image_file') !== null) {
            // Same silent-drop hazard as the display slot above.
            Log::warning('tryon_image_file was posted but discarded before storage', [
                'product_id'    => optional($product)->id,
                'original_name' => $request->file('tryon_image_file')?->getClientOriginalName(),
                'client_size'   => $request->file('tryon_image_file')?->getSize(),
                'upload_error'  => $request->file('tryon_image_file')?->getError(),
            ]);
        }

        // No slot should ever be written as a raw attribute.
        unset(
            $validated['image'],
            $validated['image_file'],
            $validated['display_image_file'],
            $validated['tryon_image_file'],
        );

        return $validated;
    }

    /**
     * COLOR VARIANTS — store each variant's photos and normalise its stock.
     *
     * Image URLs are NEVER taken from the request body: a variant keeps the
     * URLs already stored under its id, and only an uploaded file
     * (`variant_*_files[<id>]`) can replace them. Every variant must end up
     * with a background-removed card, so a colour can never be listed with no
     * picture. Variants dropped from the list have their photos deleted.
     *
     * `colors` is rebuilt as [primary colour, ...variant colours] so every
     * older surface that reads `colors` still lists the full set.
     */
    private function handleColorVariants(Request $request, array $validated, ?Product $product = null): array
    {
        $existing = [];
        foreach (ProductVariants::all($product ?? new Product()) as $variant) {
            if (isset($variant['id'])) {
                $existing[$variant['id']] = $variant;
            }
        }

        unset($validated['variant_image_files'], $validated['variant_display_files'], $validated['variant_tryon_files']);

        if (! array_key_exists('color_variants', $validated)) {
            return $validated;
        }

        $primary = trim((string) (($validated['colors'] ?? [])[0] ?? (($product?->colors ?? [])[0] ?? '')));
        $seen = $primary !== '' ? [strtolower($primary)] : [];
        $out = [];

        // Upload every new colour photo in ONE parallel batch (see putUploadedFiles).
        $uploadFields = [
            'variant_image_files'   => ['image_url', 'products'],
            'variant_display_files' => ['display_image_url', 'catalog'],
            'variant_tryon_files'   => ['ghost_mannequin_url', 'catalog'],
        ];
        $pending = [];
        foreach ($validated['color_variants'] ?? [] as $incoming) {
            foreach ($uploadFields as $field => [$column, $folder]) {
                $file = $request->file("{$field}.{$incoming['id']}");
                if ($file) {
                    $pending[$incoming['id'] . '|' . $column] = [$file, $folder];
                }
            }
        }
        $uploaded = SupabaseStorage::putUploadedFiles($pending);
        // Replaced photos are removed AFTER the response is sent, so the save
        // does not wait on storage deletes either.
        $replaced = [];

        foreach ($validated['color_variants'] ?? [] as $incoming) {
            $id = $incoming['id'];
            $color = trim($incoming['color']);
            if (in_array(strtolower($color), $seen, true)) {
                throw ValidationException::withMessages([
                    'color_variants' => ["The colour \"{$color}\" is listed more than once."],
                ]);
            }
            $seen[] = strtolower($color);

            $stored = $existing[$id] ?? [];
            $variant = [
                'id'                  => $id,
                'color'               => $color,
                'hex'                 => $incoming['hex'] ?? null,
                'name'                => filled($incoming['name'] ?? null) ? trim($incoming['name']) : null,
                'description'         => filled($incoming['description'] ?? null) ? trim($incoming['description']) : null,
                'image_url'           => $stored['image_url'] ?? null,
                'display_image_url'   => $stored['display_image_url'] ?? null,
                'ghost_mannequin_url' => $stored['ghost_mannequin_url'] ?? null,
                'background_occasion' => $incoming['background_occasion'] ?? ($stored['background_occasion'] ?? null),
            ];

            foreach ($uploadFields as [$column]) {
                if (isset($uploaded[$id . '|' . $column])) {
                    if (! empty($variant[$column])) {
                        $replaced[] = $variant[$column];
                    }
                    $variant[$column] = $uploaded[$id . '|' . $column];
                }
            }

            if (empty($variant['display_image_url'])) {
                throw ValidationException::withMessages([
                    'color_variants' => ["Please upload a photo for the {$color} colour."],
                ]);
            }

            $sizeStocks = [];
            foreach ((array) ($incoming['size_stocks'] ?? []) as $size => $qty) {
                $sizeStocks[(string) $size] = max(0, (int) $qty);
            }
            $variant['size_stocks'] = $sizeStocks;
            $variant['stock'] = array_sum($sizeStocks);

            $out[] = $variant;
            unset($existing[$id]);
        }

        // Variants removed in this save: their photos are no longer referenced.
        foreach ($existing as $removed) {
            foreach (['image_url', 'display_image_url', 'ghost_mannequin_url'] as $column) {
                if (! empty($removed[$column])) {
                    $replaced[] = $removed[$column];
                }
            }
        }
        if ($replaced !== []) {
            app()->terminating(function () use ($replaced) {
                foreach ($replaced as $url) {
                    $this->deleteProductImage($url);
                }
            });
        }

        $validated['color_variants'] = $out;
        $validated['colors'] = array_values(array_filter(array_merge(
            [$primary],
            array_column($out, 'color'),
        ), fn ($c) => $c !== ''));

        return $validated;
    }

    /**
     * Delete a previously stored product image, but ONLY when it is a file this
     * application owns — in the Supabase `products` bucket, or (for rows written
     * before the move) on the local `public` disk.
     *
     * THE OLD IMPLEMENTATION WAS UNSAFE
     * ---------------------------------
     * It did `str_replace('/storage/', '', parse_url($url, PHP_URL_PATH))` and
     * deleted whatever came out. Two ways that goes wrong:
     *
     *  1. A REMOTE image (Supabase / S3), e.g.
     *     `https://<proj>.supabase.co/storage/v1/object/public/products/a.jpg`
     *     parses to the path `/storage/v1/object/public/products/a.jpg`; the
     *     replace strips `/storage/` leaving
     *     `v1/object/public/products/a.jpg`, which does not exist locally, so the
     *     delete is a silent no-op — the real asset leaks forever.
     *
     *  2. More seriously, ANY path whose shape happened to match a local file
     *     would be deleted, so a URL from a different host could remove an
     *     unrelated local asset.
     *
     * EVERY REFERENCE IS MATCHED AGAINST A KNOWN PREFIX, never parsed apart. A
     * reference that matches neither prefix is left strictly alone: it may be a
     * data URI, a CDN, or a host this app does not own, and none of those are
     * ours to delete.
     */
    private function deleteProductImage(?string $imageUrl): void
    {
        if (!$imageUrl) {
            return;
        }

        /*
         * 1. A Supabase object. `keyFromReference` recognises every shape a row
         *    can hold (absolute bucket URL, the `/supabase-storage/...` proxy
         *    path, or a bare `catalog/x.png` key) and returns null for anything
         *    that is not one of our objects.
         */
        $objectKey = SupabaseStorage::keyFromReference($imageUrl);
        if ($objectKey !== null) {
            SupabaseStorage::delete($objectKey);

            return;
        }

        /*
         * 2. A LEGACY local-disk reference, e.g.
         *    `http://127.0.0.1:8000/storage/catalog/x.png`. These rows predate the
         *    move to Supabase and their files are usually already gone, so this is
         *    a best-effort cleanup that must never throw.
         *
         *    Anchored on the PUBLIC disk's OWN base URL with a trailing slash, so
         *    a lookalike host such as `.../storage-evil/...` cannot pass the test.
         */
        $disk = Storage::disk('public');
        $baseUrl = rtrim($disk->url(''), '/').'/';

        if (!str_starts_with($imageUrl, $baseUrl)) {
            // Not ours (data URI, external CDN, …). Leave it alone.
            return;
        }

        $relativePath = ltrim(substr($imageUrl, strlen($baseUrl)), '/');
        if ($relativePath !== '' && $disk->exists($relativePath)) {
            $disk->delete($relativePath);
        }
    }

    private function prepareAiTags(array $validated, array $existingAiTags = []): array
    {
        $aiKeys = ['undertone', 'fit_type', 'body_shapes', 'occasions'];
        $aiTags = $validated['ai_tags'] ?? $existingAiTags;

        foreach ($aiKeys as $key) {
            if (array_key_exists($key, $validated)) {
                $aiTags[$key] = $validated[$key];
            }
        }

        if (!empty($aiTags)) {
            $validated['ai_tags'] = $aiTags;
        }

        return $validated;
    }

    private function processProductInventoryAndMeasurements(array $validated, Request $request): array
    {
        if ($request->has('stock')) {
            $validated['stock'] = $request->input('stock');
        }

        $sizeStocks = $request->input('size_stocks', $request->input('stocks', null));
        if ($sizeStocks) {
            $validated['size_stocks'] = is_string($sizeStocks) ? json_decode($sizeStocks, true) : $sizeStocks;
        }

        $incomingMeasurements = $request->input('size_measurements', null);
        if ($incomingMeasurements) {
            $measurements = is_string($incomingMeasurements) ? json_decode($incomingMeasurements, true) : $incomingMeasurements;
            $measurements = is_array($measurements) ? $measurements : [];

            // Any stocked size the payload carries no numbers for gets the
            // standard chart, so the shop's size guide covers every size sold.
            foreach ((array) ($validated['sizes'] ?? []) as $key => $value) {
                $label = is_array($value) ? ($value['size_label'] ?? $value['size'] ?? $key) : (is_string($key) ? $key : $value);
                if (is_string($label) && ! isset($measurements[$label])) {
                    $chartEntry = SizeChart::measurementsFor($label);
                    if ($chartEntry !== null) {
                        $measurements[$label] = $chartEntry;
                    }
                }
            }

            $validated['size_measurements'] = $measurements;
        } else {
            /*
             * No measurements supplied -> fall back to the standard chart for
             * each size the garment actually comes in. `sizes` may be the
             * intended LIST of labels or a legacy label=>qty MAP, so the label
             * is resolved from either shape before the lookup.
             */
            $sizesInput = $validated['sizes'] ?? [];
            if (is_array($sizesInput)) {
                $sizeMeasurements = [];
                foreach ($sizesInput as $key => $value) {
                    $sizeLabel = is_array($value)
                        ? ($value['size_label'] ?? $value['size'] ?? $key)
                        : (is_string($key) ? $key : $value);

                    $chartEntry = SizeChart::measurementsFor((string) $sizeLabel);

                    if ($chartEntry !== null) {
                        $sizeMeasurements[$sizeLabel] = $chartEntry;
                    }
                }
                if (!empty($sizeMeasurements)) {
                    $validated['size_measurements'] = $sizeMeasurements;
                }
            }
        }

        return $validated;
    }

    private function hasValidMeasurements($m): bool
    {
        return !empty($m->chest_bust) && !empty($m->waist) && !empty($m->hips);
    }

    private function getPersonalizedSpotlight($userM)
    {
        $tolerance = 3.0;

        return Product::withCount('reviews')->withAvg('reviews', 'rating')->latest()->get()->filter(function ($product) use ($userM, $tolerance) {
            $sizeMeasurements = $product->size_measurements;

            if (!is_array($sizeMeasurements)) {
                return false;
            }

            foreach ($sizeMeasurements as $sizeLabel => $measurements) {
                $chest = $measurements['chest_bust'] ?? $measurements['chest_bust_min'] ?? null;
                $waist = $measurements['waist'] ?? $measurements['waist_min'] ?? null;
                $hips  = $measurements['hips'] ?? $measurements['hips_min'] ?? null;

                if ($chest && $waist && $hips) {
                    $chestMatch = abs($chest - $userM->chest_bust) <= $tolerance;
                    $waistMatch = abs($waist - $userM->waist) <= $tolerance;
                    $hipsMatch  = abs($hips - $userM->hips) <= $tolerance;

                    if ($chestMatch && $waistMatch && $hipsMatch) {
                        return true;
                    }
                }
            }

            return false;
        })->values()->take(8);
    }
}