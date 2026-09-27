<?php

/**
 * Verification for the product-delete fix.
 *
 *  1. Delete a real product whose image lives in Supabase -> the row is gone and
 *     the object is removed (or reported as best-effort), status 200.
 *  2. Simulate the reported transport failure (an unreachable storage host) and
 *     prove the row STILL deletes -> this is the bug: it used to 500 and delete
 *     nothing.
 *
 * Run:  php _verify_product_delete.php
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Product;
use App\Http\Controllers\Api\ProductController;

$controller = new ProductController();

echo '=== Product delete verification ===' . PHP_EOL;

/* ---------------------------------------------------------------------------
 * 1. A real row via the controller, image pointing at Supabase.
 * ------------------------------------------------------------------------ */
$product = Product::create([
    'name'              => '__verify_delete__ ' . bin2hex(random_bytes(4)),
    'price'             => 1,
    'category'          => 'TOPS',
    'image_url'         => 'catalog/__verify_missing__.png',
    'display_image_url' => null,
    'ghost_mannequin_url' => null,
]);
$id = $product->id;
echo "1. Created product #{$id}" . PHP_EOL;

$response = $controller->destroy($id);
$status   = method_exists($response, 'getStatusCode') ? $response->getStatusCode() : 'n/a';
$stillThere = Product::find($id) !== null;

echo "   destroy() status      = {$status}" . PHP_EOL;
echo '   row still present     = ' . ($stillThere ? 'YES (FAIL)' : 'NO (OK)') . PHP_EOL;

/* ---------------------------------------------------------------------------
 * 2. The regression: point at a host that cannot be reached. Before the fix the
 *    ConnectionException escaped deleteProductImage() and the delete 500'd with
 *    the row intact. It must now return 200 and remove the row.
 * ------------------------------------------------------------------------ */
config(['services.supabase.url' => 'https://127.0.0.1:9']); // nothing listening

$product2 = Product::create([
    'name'              => '__verify_delete_unreachable__ ' . bin2hex(random_bytes(4)),
    'price'             => 1,
    'category'          => 'TOPS',
    'image_url'         => '/supabase-storage/storage/v1/object/public/products/catalog/__verify__.png',
    'display_image_url' => null,
    'ghost_mannequin_url' => null,
]);
$id2 = $product2->id;
echo PHP_EOL . "2. Created product #{$id2} with an UNREACHABLE storage host" . PHP_EOL;

$start = microtime(true);
$response2 = $controller->destroy($id2);
$elapsed = round(microtime(true) - $start, 2);
$status2 = method_exists($response2, 'getStatusCode') ? $response2->getStatusCode() : 'n/a';
$stillThere2 = Product::find($id2) !== null;

echo "   destroy() status      = {$status2}" . PHP_EOL;
echo "   took                  = {$elapsed}s" . PHP_EOL;
echo '   row still present     = ' . ($stillThere2 ? 'YES (FAIL)' : 'NO (OK)') . PHP_EOL;

echo PHP_EOL . ((!$stillThere && !$stillThere2)
    ? 'RESULT: PASS — deletes succeed even when storage is unreachable.'
    : 'RESULT: FAIL — a row survived the delete.') . PHP_EOL;

/* Cleanup anything left by a failed run. */
Product::where('id', $id)->delete();
Product::where('id', $id2)->delete();
