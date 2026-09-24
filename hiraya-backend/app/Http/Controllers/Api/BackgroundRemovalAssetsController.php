<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

class BackgroundRemovalAssetsController extends Controller
{
    /**
     * Removed: runtime proxy for the `@imgly/background-removal` assets.
     *
     * WHY IT IS GONE
     * --------------
     * The proxy solved the connectivity half of the problem (the browser cannot
     * reach `staticimgly.com`, the server can) but it was far too SLOW to keep:
     *
     *   - the assets total ~328 MB across ~85 chunks;
     *   - `php artisan serve` is single-threaded, so those requests serialise;
     *   - a single 4 MB chunk measured ~3.5s through the route;
     *   - the engine cannot begin inference until the whole model has arrived,
     *     so the caller simply appeared to hang inside `removeBackground`.
     *
     * The assets are now mirrored ONCE to `public/vendor/imgly/` by
     * `download_imgly_assets.php` and served directly by the web server, which
     * handles concurrent requests and caching natively. Nothing is fetched per
     * request, so this route is no longer needed.
     *
     * Kept as a redirect rather than deleted so any client still holding the old
     * `publicPath` keeps working through the migration instead of 404-ing mid
     * download.
     */
    public function __invoke(Request $request, string $path = '')
    {
        $path = ltrim((string) $path, '/');

        // Never allow escaping the mirrored asset root.
        if ($path === '' || str_contains($path, '..') || preg_match('#^[a-z][a-z0-9+.-]*:#i', $path)) {
            abort(404);
        }

        if (!is_file(public_path('vendor/imgly/' . $path))) {
            abort(404);
        }

        return redirect('/vendor/imgly/' . $path, 302);
    }
}
