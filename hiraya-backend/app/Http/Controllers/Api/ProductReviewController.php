<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\ProductReview;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Per-product reviews written from a DELIVERED order.
 *
 * Eligibility is decided here, in the backend, never by the UI: a review is
 * accepted only for an order line that (a) belongs to the caller's own order,
 * (b) whose order is `delivered`, (c) still points at a product, and (d) has not
 * been reviewed yet. (d) is also enforced by the UNIQUE `order_item_id` index.
 */
class ProductReviewController extends Controller
{
    /** Longest accepted image data URI (~2.2 MB of image bytes). */
    private const MAX_IMAGE_CHARS = 3_000_000;

    /**
     * GET /api/reviews/mine
     *
     * Every review the signed-in customer has written, so My Orders can swap
     * "Review Product" for "View Review" on lines that are already done.
     */
    /**
     * GET /api/admin/reviews — THE ONE REVIEW LIST for the console.
     *
     * Feedback was merged into Product Reviews, so staff read a single list:
     * every verified-purchase product review plus any order-experience rating
     * customers left before the merge (type "order"). Rows are LIGHT: review
     * photos are not inlined (that is what made the old Product Reviews panel
     * time out); `has_image` tells the console to fetch one on demand from
     * /admin/product-reviews/{id}/image.
     */
    public function adminUnified(Request $request)
    {
        $limit = (int) min(max((int) $request->query('limit', 300), 1), 500);

        $reviews = ProductReview::query()
            ->with(['product:id,name', 'user:id,full_name,email', 'orderItem:id,selected_size,selected_color'])
            ->select(['id', 'user_id', 'product_id', 'order_id', 'order_item_id', 'rating', 'comment', 'created_at'])
            ->selectRaw("(image IS NOT NULL AND image <> '') AS has_image")
            ->latest()
            ->limit($limit)
            ->get()
            ->map(fn (ProductReview $r) => [
                'key' => 'review-' . $r->id,
                'type' => 'product',
                'id' => $r->id,
                'product_id' => $r->product_id,
                'product_name' => $r->product?->name,
                'size' => $r->orderItem?->selected_size,
                'color' => $r->orderItem?->selected_color,
                'order_id' => $r->order_id,
                'customer_name' => $r->user?->full_name,
                'customer_email' => $r->user?->email,
                'rating' => (int) $r->rating,
                'comment' => $r->comment,
                'has_image' => (bool) $r->has_image,
                'created_at' => optional($r->created_at)->toIso8601String(),
            ]);

        $legacy = \App\Models\Feedback::query()
            ->whereNotNull('user_id')
            ->with('user:id,full_name,email')
            ->latest()
            ->limit($limit)
            ->get()
            ->map(fn ($f) => [
                'key' => 'feedback-' . $f->id,
                'type' => 'order',
                'id' => $f->id,
                'product_id' => null,
                'product_name' => null,
                'size' => null,
                'color' => null,
                'order_id' => $f->order_id,
                'customer_name' => $f->user?->full_name ?: $f->user_name,
                'customer_email' => $f->user?->email ?: $f->user_email,
                'rating' => $f->rating !== null ? (int) $f->rating : null,
                'comment' => $f->comment,
                'has_image' => false,
                'created_at' => optional($f->created_at)->toIso8601String(),
            ]);

        return response()->json(
            $reviews->concat($legacy)->sortByDesc('created_at')->values()->take($limit)->values()
        );
    }

    /** GET /api/admin/product-reviews/{review}/image — one review photo, on demand. */
    public function adminImage(ProductReview $review)
    {
        $image = (string) $review->image;
        if (! preg_match('#^data:(image/(?:png|jpe?g|webp));base64,(.+)$#s', $image, $m)) {
            return response()->json(['message' => 'This review has no photo.'], 404);
        }

        return response(base64_decode($m[2]) ?: '', 200, [
            'Content-Type' => $m[1],
            'Cache-Control' => 'private, max-age=300',
        ]);
    }

    /**
     * GET /api/admin/product-reviews — every product review, newest first, for
     * the staff Customers Feedback screen (who, which product, which order).
     */
    public function adminIndex(Request $request)
    {
        $limit = (int) min(max((int) $request->query('limit', 200), 1), 500);

        $reviews = ProductReview::query()
            ->with(['product:id,name', 'user:id,full_name,email'])
            ->latest()
            ->limit($limit)
            ->get()
            ->map(fn (ProductReview $r) => [
                'id' => $r->id,
                'product_id' => $r->product_id,
                'product_name' => $r->product?->name,
                'order_id' => $r->order_id,
                'customer_name' => $r->user?->full_name,
                'customer_email' => $r->user?->email,
                'rating' => $r->rating,
                'comment' => $r->comment,
                'image' => $r->image,
                'created_at' => optional($r->created_at)->toIso8601String(),
            ]);

        return response()->json($reviews);
    }

    public function mine(Request $request)
    {
        $reviews = ProductReview::where('user_id', $request->user()->id)
            ->latest()
            ->get(['id', 'product_id', 'order_id', 'order_item_id', 'rating', 'comment', 'image', 'created_at']);

        return response()->json(['reviews' => $reviews]);
    }

    /**
     * POST /api/order-items/{orderItem}/review
     */
    public function store(Request $request, OrderItem $orderItem)
    {
        $user = $request->user();
        $orderItem->loadMissing('order');
        $order = $orderItem->order;

        // Someone else's line looks exactly like a missing one.
        if (! $order || (int) $order->user_id !== (int) $user->id) {
            return response()->json(['message' => 'Order item not found.'], 404);
        }

        if ($order->order_status !== 'delivered') {
            return response()->json([
                'message' => 'You can review a product once its order has been delivered.',
            ], 422);
        }

        if (! $orderItem->product_id) {
            return response()->json([
                'message' => 'This product is no longer in the catalogue and cannot be reviewed.',
            ], 422);
        }

        if (ProductReview::where('order_item_id', $orderItem->id)->exists()) {
            return response()->json(['message' => 'You have already reviewed this product.'], 422);
        }

        $validated = $request->validate([
            'rating'  => 'required|integer|min:1|max:5',
            'comment' => 'nullable|string|max:1000',
            'image'   => 'nullable|string|max:' . self::MAX_IMAGE_CHARS,
        ]);

        $image = $validated['image'] ?? null;
        if ($image !== null && $image !== '' && ! $this->isValidImageDataUri($image)) {
            return response()->json([
                'message' => 'The photo must be a JPG, PNG or WEBP image.',
                'errors'  => ['image' => ['The photo must be a JPG, PNG or WEBP image.']],
            ], 422);
        }

        try {
            $review = ProductReview::create([
                'user_id'       => $user->id,
                'product_id'    => $orderItem->product_id,
                'order_id'      => $order->id,
                'order_item_id' => $orderItem->id,
                'rating'        => $validated['rating'],
                'comment'       => isset($validated['comment']) ? trim($validated['comment']) : null,
                'image'         => $image ?: null,
            ]);
        } catch (QueryException $e) {
            // The UNIQUE index caught a double submit that raced the check above.
            // SQLSTATE 23505 (pgsql) / 23000 (mysql) = unique-constraint violation.
            if (in_array((string) ($e->errorInfo[0] ?? $e->getCode()), ['23505', '23000'], true)) {
                return response()->json(['message' => 'You have already reviewed this product.'], 422);
            }

            Log::error('Product Review Store Error: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to save your review.'], 500);
        }

        return response()->json([
            'message' => 'Thank you — your review has been posted.',
            'review'  => $review->only(['id', 'product_id', 'order_id', 'order_item_id', 'rating', 'comment', 'image', 'created_at']),
        ], 201);
    }

    /**
     * GET /api/products/{product}/reviews — PUBLIC.
     *
     * Reviewers are shown as "First L." so a public page never exposes a
     * customer's full name or email.
     */
    public function forProduct(Product $product)
    {
        $reviews = ProductReview::where('product_id', $product->id)
            ->with(['user:id,full_name', 'orderItem:id,selected_size,selected_color'])
            ->latest()
            ->limit(100)
            ->get();

        $payload = $reviews->map(fn (ProductReview $review) => [
            'id'         => $review->id,
            'rating'     => $review->rating,
            'comment'    => $review->comment,
            'image'      => $review->image,
            'reviewer'   => $this->displayName($review->user?->full_name),
            'size'       => $review->orderItem?->selected_size,
            'color'      => $review->orderItem?->selected_color,
            'created_at' => $review->created_at,
        ]);

        $count = ProductReview::where('product_id', $product->id)->count();
        $average = $count > 0
            ? round((float) ProductReview::where('product_id', $product->id)->avg('rating'), 1)
            : null;

        return response()->json([
            'reviews' => $payload,
            'count'   => $count,
            'average' => $average,
        ]);
    }

    private function isValidImageDataUri(string $value): bool
    {
        if (! preg_match('#^data:image/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\r\n]+)$#', $value, $m)) {
            return false;
        }

        $bytes = base64_decode($m[2], true);

        return $bytes !== false && @getimagesizefromstring($bytes) !== false;
    }

    private function displayName(?string $fullName): string
    {
        $parts = preg_split('/\s+/', trim((string) $fullName)) ?: [];
        $parts = array_values(array_filter($parts, fn ($p) => $p !== ''));

        if (count($parts) === 0) {
            return 'Hiraya Customer';
        }

        $first = $parts[0];
        $lastInitial = count($parts) > 1 ? ' ' . mb_strtoupper(mb_substr(end($parts), 0, 1)) . '.' : '';

        return $first . $lastInitial;
    }
}
