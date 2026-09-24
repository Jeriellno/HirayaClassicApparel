<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Serves Supabase Storage objects from THIS origin.
 *
 * WHY THIS EXISTS
 * ---------------
 * The SPA runs CROSS-ORIGIN ISOLATED: `Cross-Origin-Embedder-Policy: require-corp`
 * is set on every document (see public/.htaccess) because `onnxruntime-web` needs
 * `SharedArrayBuffer` to run the on-device person-segmentation model
 * multi-threaded. That is a ~6s mask instead of ~22s, so the header is not
 * negotiable.
 *
 * The price of `require-corp` is that EVERY cross-origin subresource must opt in,
 * either with `Cross-Origin-Resource-Policy: cross-origin` or by being fetched as
 * CORS. A bare `<img src>` is NOT a CORS request, and Supabase Storage answers one
 * with `access-control-allow-origin: *` but NO CORP header — so the browser
 * rejects it:
 *
 *   GET https://<ref>.supabase.co/storage/v1/object/public/products/catalog/x.png
 *   net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
 *
 * That was the reported bug: the admin uploads a garment cut-out, the row is
 * public and correct, and every catalog surface (Home, Shop, Wishlist, Cart, Quick
 * View, Orders) paints nothing. The bytes were never the problem; the browser
 * refused to paint them.
 *
 * THE FIX, AND WHY IT IS A PROXY RATHER THAN A HEADER
 * ---------------------------------------------------
 * `Cross-Origin-Resource-Policy` cannot be added to a response we do not control.
 * Supabase is a SaaS host: we cannot make it emit CORP for bucket objects. So the
 * request is routed back through this app instead. A SAME-ORIGIN subresource is
 * exempt from COEP entirely, so the image loads AND the page stays cross-origin
 * isolated — the speed fix survives, which removing COEP would not have allowed.
 *
 * WHY NOT SIMPLY FETCH THE FILE IN THE SPA AND INLINE IT AS A data: URI
 * --------------------------------------------------------------------
 * `utils/compositeTryOn.js` already falls back to that, but only for the images a
 * canvas must read (a data: URI is same-origin, so it also solves TAINTING). Doing
 * it for every catalog tile would mean re-downloading and base64-expanding every
 * grid image on the client, and it would not fix a plain `<img>` on Shop or Home.
 * The proxy fixes all of them, at one place, with the bytes still streamed.
 *
 * WHY THE SPA DOES NOT POINT AT THIS ROUTE
 * ----------------------------------------
 * `utils/imageHelper.js` cannot know whether the host it is running on serves this
 * route (the SPA may be hosted somewhere this backend is not mounted). So it emits
 * a ROOT-RELATIVE `/supabase-storage/...`, and the WEB SERVER owns the decision:
 *
 *   - Development: Vite's dev-server proxy answers it (see vite.config.js) — no PHP
 *     in the path, which matters because `php artisan serve` is single-threaded and
 *     would serialise an image-heavy grid.
 *   - Production (Laravel serving the built SPA): the Alias in public/.htaccess
 *     sends it to public/index.php, which reaches this controller.
 *   - Production (front-end web server + separate API host): that server must proxy
 *     the prefix itself; the Apache snippet is in the .htaccess comment.
 *
 * WHICH MAKES THIS THE FALLBACK PATH, NOT THE PRIMARY ONE. It is correct and safe,
 * but on a shared/cheap host a busy catalog grid is better served by the front-end
 * server (nginx `proxy_pass` / Apache `ProxyPass`) or by an object CDN than by PHP.
 */
class SupabaseStorageController extends Controller
{
    /**
     * The public-object path in Supabase's Storage API.
     *
     * The SPA emits `/supabase-storage/storage/v1/object/public/products/<file>`, so
     * the BUCKET NAME lives after this prefix — not at the start of the path. Getting
     * that wrong is not a cosmetic slip: an allowlist matched against the raw path
     * start never fires, and every image 404s while the route looks perfectly correct
     * in `route:list`.
     */
    private const OBJECT_PATH_PREFIX = 'storage/v1/object/public/';

    /**
     * Buckets this route is allowed to serve.
     *
     * This is an ALLOWLIST, not a nicety: without it the route would forward every
     * path under `/storage/v1/`, which includes the Storage API surface (list,
     * move, delete, object signing) and would take the project's private buckets
     * along with it. Only these are customer-facing images.
     */
    private const ALLOWED_BUCKETS = [
        'products/',
        'backgrounds/',
    ];

    /**
     * Content types worth proxying. Anything else 404s rather than being streamed
     * blind, so a crafted path cannot use this origin to launder an arbitrary file.
     */
    private const ALLOWED_MIME = [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/webp',
        'image/avif',
        'image/gif',
        'image/svg+xml',
        'image/bmp',
    ];

    /**
     * Stream a public Supabase Storage object through this origin.
     *
     * The route is registered WITHOUT the `api` prefix and WITHOUT auth: the
     * objects it serves are already world-readable (that is what a "public bucket"
     * means), so requiring a token would only break `<img src>` tags, which cannot
     * send one.
     */
    public function __invoke(Request $request, string $path = '')
    {
        // Supabase public objects never contain a query string, so the path is taken
        // verbatim. (Nothing here reads or forwards `?download=`-style parameters, so
        // dropping them is also the safe default.)
        $objectPath = ltrim((string) $path, '/');

        // ── Guard 1: shape ──────────────────
        // No traversal, no scheme-relative or absolute URL (which would turn this
        // into an open proxy if the base URL ever came from user input).
        if (
            $objectPath === ''
            || str_contains($objectPath, '..')
            || preg_match('#^[a-z][a-z0-9+.-]*:#i', $objectPath)
            || str_starts_with($objectPath, '//')
        ) {
            abort(404);
        }

        // ── Guard 2: it must be a PUBLIC OBJECT path ────────────────────
        // `str_starts_with` against the CONSTANT is deliberate. Matching the bucket
        // with a regex would reopen the traversal hole Guard 1 exists to close: in
        // `storage/v1/object/public/products/../../sessions/secret.png` the string
        // starts with a valid bucket prefix AND satisfies `.*`, so only the literal
        // `..` check stops it. Keeping the check literal makes that explicit.
        if (!str_starts_with($objectPath, self::OBJECT_PATH_PREFIX)) {
            abort(404);
        }

        $bucketPath = substr($objectPath, strlen(self::OBJECT_PATH_PREFIX));

        // ── Guard 3: bucket allowlist ───────
        $allowedBucket = false;
        foreach (self::ALLOWED_BUCKETS as $bucket) {
            if (str_starts_with($bucketPath, $bucket)) {
                $allowedBucket = true;
                break;
            }
        }

        if (!$allowedBucket) {
            abort(404);
        }


        $baseUrl = rtrim((string) config('services.supabase.url'), '/');

        if ($baseUrl === '') {
            // Misconfigured rather than missing: say so in the log instead of
            // rendering the generic "no image" tile with no explanation, which is
            // what made the original COEP failure so hard to attribute.
            logger()->warning('SupabaseStorageController: SUPABASE_URL is not configured; cannot serve /supabase-storage.');
            abort(503, 'Storage proxy is not configured.');
        }

        // Rebuilt from the validated pieces rather than concatenating the raw path,
        // so nothing can survive into the upstream URL that Guard 1–3 did not clear.
        $target = $baseUrl . '/' . self::OBJECT_PATH_PREFIX . $bucketPath;

        try {
            /*
             * `withOptions(['stream' => true])` is deliberate and important.
             *
             * These are catalog images (hundreds of KB, occasionally a few MB). The
             * default non-streamed client buffers the whole body into a PHP string
             * and then copies it again to build the response — two full copies of
             * the payload in memory, per request, on a route a product grid hits
             * dozens of times at once. Streaming caps memory at the chunk size.
             *
             * No timeout cap on the body read: a slow image should arrive late, not
             * fail. The connection timeout still applies so a dead host cannot hang
             * a worker forever.
             */
            $response = Http::timeout(20)
                ->connectTimeout(5)
                ->withOptions(['stream' => true])
                ->get($target);
        } catch (\Throwable $e) {
            logger()->warning('SupabaseStorageController: upstream request failed.', [
                'object' => $objectPath,
                'error' => $e->getMessage(),
            ]);

            // 502, not 404: the object may exist and the network is the problem.
            // The SPA's `onError` shows the local placeholder either way, but the
            // distinction is what makes this debuggable from the network tab.
            abort(502, 'Storage upstream unreachable.');
        }

        if ($response->status() === 404) {
            // Genuinely absent upstream (deleted object, or a row still holding a
            // path from before the migration). Propagate the 404 so it is visibly
            // different from a blocked/unreachable image.
            abort(404);
        }

        if (!$response->successful()) {
            logger()->warning('SupabaseStorageController: upstream returned an error.', [
                'object' => $objectPath,
                'status' => $response->status(),
            ]);

            /*
             * Supabase answers a NON-EXISTENT public object with **400**, not 404
             * (verified: `/storage/v1/object/public/backgrounds/x.png` -> 400 with
             * `{"statusCode":"404"}` in the body). Reporting that as 502 would be
             * actively misleading — the upstream is perfectly healthy, the object
             * simply is not there — and it is the difference between "the proxy is
             * down" and "this product's file is gone" when reading the network tab.
             *
             * Narrowed deliberately to 400: any OTHER 4xx/5xx keeps its own status,
             * so a genuine upstream fault is still not disguised as a missing file.
             */
            if ($response->status() === 400) {
                abort(404);
            }

            abort(502, 'Storage upstream error.');
        }

        $contentType = strtolower(trim(explode(';', (string) $response->header('Content-Type'))[0]));

        if (!in_array($contentType, self::ALLOWED_MIME, true)) {
            // The bucket is public, but this route is not a general-purpose mirror.
            logger()->warning('SupabaseStorageController: refused non-image content.', [
                'object' => $objectPath,
                'content_type' => $contentType,
            ]);

            abort(404);
        }

        $stream = $response->toPsrResponse()->getBody();

        return new StreamedResponse(
            function () use ($stream) {
                // Rewind defensively: some PSR-7 streams are not at position 0 after
                // the header pass, and reading from mid-stream truncates the image.
                if ($stream->isSeekable()) {
                    $stream->rewind();
                }

                while (!$stream->eof()) {
                    echo $stream->read(8192);

                    // Flush per chunk so the browser can paint the image while the
                    // rest is still arriving, instead of waiting for the full body.
                    if (ob_get_level() > 0) {
                        ob_flush();
                    }
                    flush();
                }
            },
            200,
            [
                'Content-Type' => $contentType,
                'Content-Length' => (string) $response->header('Content-Length'),

                // ------------------------------------------------------------------
                // THE HEADER THAT ACTUALLY FIXES THE BUG.
                //
                // A same-origin image never needs CORP — but this response is NOT
                // always same-origin: the SPA may be served from a different host
                // than this API (that is the whole reason the SPA only emits a
                // relative path and lets the web server decide). When it IS
                // cross-origin, the document's `require-corp` demands this header or
                // the image is blocked exactly as Supabase's was.
                //
                // `cross-origin` is correct and safe here: these objects are already
                // public read-only assets, so the header grants the browser no access
                // it could not get with curl. It is also what the mirrored
                // `/vendor/imgly/*` chunks already send.
                // ------------------------------------------------------------------
                'Cross-Origin-Resource-Policy' => 'cross-origin',

                // Public, immutable objects (the filename carries a timestamp/random
                // suffix, so a given URL never changes contents). Absence of this
                // header upstream is why the browser re-validated every catalog
                // thumbnail on every render of every page.
                'Cache-Control' => 'public, max-age=86400, stale-while-revalidate=604800',

                // Let the browser sniff nothing it is not told.
                'X-Content-Type-Options' => 'nosniff',
            ]
        );
    }
}
