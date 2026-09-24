<?php

/**
 * DEV ONLY — clear the DEAD image references on a product row.
 *
 * Product #19 stores:
 *   display_image_url   = http://127.0.0.1:8000/storage/catalog/lJamb….png   (404 — file gone)
 *   ghost_mannequin_url = http://127.0.0.1:8000/storage/catalog/0yvUc….png   (404 — file gone)
 *   image_url           = /supabase-storage/…/1789728007966-7k5biae.jpg       (200 — REAL)
 *
 * Those are LEGACY local-disk URLs written before the move to Supabase. The
 * bytes no longer exist anywhere, so every customer card first tries a dead
 * reference, logs a 400/404, and only THEN falls through to image_url. This
 * nulls the two dead columns so the card resolves image_url directly.
 *
 * `image_url` is deliberately NOT touched — it is a valid Supabase object.
 * Re-generating a proper cut-out is still the job of the admin's
 * "Create catalog image (AI)" button; this only removes the broken references.
 *
 *   php _clean_dead_image_refs.php
 */
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Product;
use Illuminate\Support\Facades\Http;

$productId = 19;

$product = Product::find($productId);
if (! $product) {
    echo "No product #{$productId}.\n";
    exit(1);
}

/** True only when the reference is a legacy local-disk URL that no longer resolves. */
function isDeadLegacyRef(?string $ref): bool
{
    $ref = trim((string) $ref);
    if ($ref === '') {
        return false;
    }

    // Only the backend's own dead disk shape — never a Supabase/remote object.
    if (! str_contains($ref, '127.0.0.1:8000/storage/') && ! str_contains($ref, 'localhost:8000/storage/')) {
        return false;
    }

    // The local tree is gitignored/empty, so a HEAD will not find it. We treat
    // the shape itself as dead, and confirm with a quick request for the record.
    try {
        $status = Http::timeout(6)->head($ref)->status();
        echo "  probe {$ref} -> HTTP {$status}\n";
    } catch (\Throwable $e) {
        echo "  probe {$ref} -> unreachable\n";
    }

    return true;
}

$changed = [];

foreach (['display_image_url', 'ghost_mannequin_url'] as $column) {
    $current = $product->{$column};
    echo "#{$product->id} {$column} = " . ($current ?: '(empty)') . "\n";

    if (isDeadLegacyRef($current)) {
        $product->{$column} = null;
        $changed[] = $column;
    }
}

if ($changed) {
    $product->save();
    echo "\nCleared: " . implode(', ', $changed) . " on product #{$product->id}.\n";
} else {
    echo "\nNothing to clear.\n";
}

$product->refresh();
echo "image_url (kept) : " . ($product->image_url ?: '(empty)') . "\n";
echo "display_image_url : " . ($product->display_image_url ?: '(null)') . "\n";
echo "ghost_mannequin_url : " . ($product->ghost_mannequin_url ?: '(null)') . "\n";
