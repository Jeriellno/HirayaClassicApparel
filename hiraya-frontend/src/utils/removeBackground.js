/**
 * removeBackground — garment background-removal pipeline for the AI Style Stack.
 *
 * Gives the Style Stack clean, background-free garment CUTOUTS so the stack
 * reads like a wardrobe of floating garments instead of a grid of product
 * photos with busy backdrops.
 *
 * STRATEGY (fastest available first):
 *   1. IndexedDB cache            — a previously cut-out image is instant + free.
 *   2. Express API endpoint       — optional server-side RMBG when
 *                                   `VITE_BG_REMOVAL_ENDPOINT` is configured
 *                                   (offloads the heavy model from the browser).
 *   3. Client-side WASM engine    — `@imgly/background-removal`, runs fully
 *                                   offline in the browser. This is the default.
 *   4. Graceful fallback          — if every stage fails, the ORIGINAL image is
 *                                   returned so a card is never left blank.
 *
 * The function is idempotent and safe to call concurrently: identical URLs
 * share a single in-flight promise, so scroll-thrashing the stack can never
 * kick off the same expensive removal twice.
 */

import { removeBackground as imglyRemoveBackground } from '@imgly/background-removal';
import { isKnownStartTimeError } from './runtimeGuards';

// --- Asset host -------------------------------------------------------------

/**
 * Where the engine loads its ONNX model + WASM runtime from.
 *
 * Two failure modes had to be solved here:
 *
 *  1. The package default (`https://staticimgly.com/...`) is blocked on many
 *     networks -> `net::ERR_PROXY_CONNECTION_FAILED` -> silent fallback to the
 *     admin's ORIGINAL photo.
 *
 *  2. Proxying those ~95 MB of assets through a PHP route instead is far too
 *     SLOW: `php artisan serve` is single-threaded, so every chunk serialises
 *     (~3.5s per 4 MB), and the engine cannot start inference until the whole
 *     model has arrived. That is what made `removeBackground` appear to hang.
 *
 * So the assets are mirrored ONCE into the backend's `public/vendor/imgly/`
 * (see `download_imgly_assets.php`) and served as plain static files, which the
 * web server handles concurrently and caches. Nothing is fetched per request.
 *
 * Override with VITE_BG_REMOVAL_PUBLIC_PATH to point somewhere else.
 *
 * WHY THIS IS RELATIVE (and not the backend's absolute URL)
 * ---------------------------------------------------------
 * Two independent bugs made an absolute cross-origin URL fail:
 *
 *  1. CORS. The app runs on the Vite origin (localhost:5173) while the backend
 *     is on 127.0.0.1:8000. `php artisan serve` serves any path that exists on
 *     disk BEFORE Laravel boots, so Laravel's CORS middleware never runs for
 *     these files and no `Access-Control-Allow-Origin` header is attached. The
 *     browser blocked every asset fetch:
 *
 *       Access to fetch at '.../vendor/imgly/resources.json' from origin
 *       'http://localhost:5173' has been blocked by CORS policy
 *
 *     Requesting them from the SAME origin (`/vendor/imgly/...`) side-steps
 *     CORS entirely, and Vite's dev-server proxy (see vite.config.js) forwards
 *     the request to the backend. In production the SPA and the mirrored assets
 *     are served from one origin, so this stays same-origin there too.
 *
 *  2. URL base resolution. The engine resolves every asset relative to this
 *     value with `new URL("resources.json", publicPath)`. URL resolution treats
 *     the last path segment as a FILE and drops it, so a base of
 *     `/vendor/imgly` resolved `resources.json` to `/vendor/resources.json` —
 *     the `imgly/` segment was silently eaten, giving a 404 and an instant
 *     fallback to the admin's ORIGINAL photo. The trailing slash below is
 *     therefore load-bearing.
 */
const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api';
// `.../api` -> the app root that actually serves `public/`.
const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

/**
 * Force exactly one trailing slash. A bare `URL` base silently loses its last
 * segment (see above), so this must never be allowed to be slashless, even if
 * VITE_BG_REMOVAL_PUBLIC_PATH is set without one.
 */
const withTrailingSlash = (path) => (path.endsWith('/') ? path : `${path}/`);

/*
 * WHY IT MUST BE AN ABSOLUTE, SAME-ORIGIN URL WITH A TRAILING SLASH
 * -----------------------------------------------------------------
 * The engine does `new URL("resources.json", config.publicPath)` (see
 * `loadAsBlob` in the package). That single call imposes BOTH constraints:
 *
 *   - It must be ABSOLUTE. `new URL(x, '/vendor/imgly/')` throws
 *     `TypeError: Invalid base URL`, because a relative string is not a valid
 *     URL base. (It is not resolved against `location`.)
 *
 *   - It must END IN '/'. `new URL('resources.json', 'https://h/vendor/imgly')`
 *     treats `imgly` as the file segment and returns
 *     `https://h/vendor/resources.json` — a 404 that made removal fail
 *     instantly and keep the admin's original photo.
 *
 * So we build an ABSOLUTE url from the page's OWN origin, which keeps the
 * request same-origin (no CORS involvement) while still satisfying `new URL()`.
 * Vite's dev-server proxy forwards `/vendor/imgly/*` to the backend — see
 * vite.config.js. `VITE_BG_REMOVAL_PUBLIC_PATH` can override this when the
 * assets live somewhere else, as long as that origin sends the CORS header
 * (config/cors.php lists `vendor/imgly/*` for exactly that case).
 */
const resolvePublicPath = () => {
  const configured = import.meta.env?.VITE_BG_REMOVAL_PUBLIC_PATH;

  if (configured) {
    // A configured RELATIVE path is absolute-ised against the page origin so the
    // `new URL()` call above cannot throw "Invalid base URL".
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return withTrailingSlash(configured.startsWith('/') ? `${base}${configured}` : configured);
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : BACKEND_ORIGIN;
  return `${origin}/vendor/imgly/`;
};

const PUBLIC_PATH = resolvePublicPath();

// --- Config -----------------------------------------------------------------

/**
 * Optional server-side processor (an external RMBG service, if you run one).
 *
 * Unset by default. The in-browser engine is the primary path and works fine
 * once it can reach its model files — which this app serves through its own
 * backend (see PUBLIC_PATH below), because client networks commonly block the
 * upstream `staticimgly.com` host with `net::ERR_PROXY_CONNECTION_FAILED`.
 *
 * Configure VITE_BG_REMOVAL_ENDPOINT only if you want to offload removal to a
 * separate service; it must accept `{ image: "data:image/...;base64,..." }`.
 */
const API_ENDPOINT = import.meta.env?.VITE_BG_REMOVAL_ENDPOINT || '';

/** Set VITE_BG_REMOVAL_LOCAL_ONLY=true to skip the external service entirely. */
const LOCAL_ONLY = String(import.meta.env?.VITE_BG_REMOVAL_LOCAL_ONLY || '') === 'true';

/** Set VITE_BG_REMOVAL_DISABLED=true to bypass AI removal entirely (debugging). */
const REMOVAL_DISABLED = String(import.meta.env?.VITE_BG_REMOVAL_DISABLED || '') === 'true';

const DB_NAME = 'HirayaImageCache';
const DB_VERSION = 1;
const STORE_NAME = 'transparent_images';
/** Bump to invalidate every cached cut-out (e.g. after a model upgrade). */
const CACHE_NAMESPACE = 'v1';

// --- IndexedDB cache --------------------------------------------------------

let dbPromise = null;

const openDB = () => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      // A private-mode / quota failure must not break the pipeline — we simply
      // run without a cache.
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
};

const cacheKeyFor = (url) => `${CACHE_NAMESPACE}::${url}`;

const getCached = async (url) => {
  const db = await openDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(cacheKeyFor(url));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

const setCached = async (url, blob) => {
  const db = await openDB();
  if (!db) return;

  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, cacheKeyFor(url));
  } catch (err) {
    console.warn('[Hiraya] Could not cache transparent image:', err);
  }
};

// --- In-flight de-duplication ----------------------------------------------

/** url -> Promise<Blob|null>. Shared so concurrent callers reuse one removal. */
const inFlight = new Map();

// --- Server-side processor --------------------------------------------------

/**
 * Normalise any image reference into a `data:image/...;base64,...` string.
 * Handles data URIs (passthrough), blob:/http(s) URLs and File/Blob objects by
 * reading them into a canvas-free Blob -> data URI conversion.
 */
const toDataUri = async (input) => {
  if (!input) return null;
  if (typeof input === 'string' && input.startsWith('data:image')) return input;

  try {
    let blob;
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      blob = input;
    } else {
      const res = await fetch(input);
      if (!res.ok) return null;
      blob = await res.blob();
    }

    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

/**
 * POST the image to the optional Express/RMBG endpoint and read back a blob.
 * Returns null when the endpoint is unconfigured or the request fails, which
 * lets the caller fall through to the in-browser engine.
 */
const removeViaApi = async (imageUrl) => {
  if (!API_ENDPOINT || LOCAL_ONLY) return null;

  try {
    /*
     * The Laravel endpoint expects `{ image: "data:image/...;base64,..." }`,
     * but callers may hand us a blob: URL or a remote http(s) URL. Normalise
     * every input to a data URI first so one code path serves them all.
     */
    const dataUri = await toDataUri(imageUrl);
    if (!dataUri) return null;

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ image: dataUri }),
      signal: AbortSignal.timeout?.(90000),
    });

    if (!response.ok) return null;

    // Accept either a raw image body or { image: "data:image/png;base64,..." }.
    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('image/')) return await response.blob();

    const payload = await response.json();
    // Server shape: { data: { image: "data:image/png;base64,..." } }
    const resultImage =
      payload?.data?.image ||
      payload?.image ||
      payload?.result_image ||
      payload?.data;
    if (typeof resultImage === 'string' && (resultImage.startsWith('data:') || resultImage.startsWith('http'))) {
      const res = await fetch(resultImage);
      return await res.blob();
    }

    return null;
  } catch {
    // Unreachable endpoint is expected in dev — silently fall through.
    return null;
  }
};

// --- Client-side (WASM) processor -------------------------------------------

/*
 * Hard ceiling for one in-browser removal.
 *
 * First run downloads ~95 MB of model before inference, so the window is
 * generous — but it must be finite. Without it, an engine that stalls waiting
 * on assets (the failure that looked like a freeze) would leave the caller
 * awaiting forever and the UI stuck on "analyzing".
 */
const WASM_TIMEOUT_MS = 180000;

const removeViaWasm = async (imageUrl, onProgress) => {
  const job = imglyRemoveBackground(imageUrl, {
    // Load the self-hosted assets, never the blocked CDN nor the PHP proxy.
    publicPath: PUBLIC_PATH,
    /*
     * Pin the model + device to match the self-hosted files.
     *
     * The engine defaults to `device: "cpu"` with `model: "medium"`
     * (= `isnet_fp16`), which is exactly what `download_imgly_assets.php`
     * mirrors. Being explicit means a future package default change cannot
     * silently start requesting a model we never downloaded — which would
     * stall the engine mid-load, looking like a hang.
     */
    device: 'cpu',
    model: 'isnet_fp16',
    progress: (key, current, total) => {
      if (!onProgress || !total) return;
      // Report the model download + inference as one monotonic 0..1 scale.
      try {
        onProgress(Math.min(1, current / total));
      } catch {
        /* progress reporting must never break the pipeline */
      }
    },
  });

  return await Promise.race([
    job,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Background removal timed out after ${WASM_TIMEOUT_MS}ms.`));
      }, WASM_TIMEOUT_MS);
    }),
  ]);
};

// --- Public API -------------------------------------------------------------

/**
 * Remove the background from a garment image.
 *
 * @param {string} imageUrl      Absolute URL, relative Supabase path or data URI.
 * @param {Object} [options]
 * @param {Function} [options.onProgress]  (0..1) progress callback.
 * @param {boolean}  [options.skipCache]   Force a fresh removal.
 * @returns {Promise<{ url: string, blob: Blob|null, fromCache: boolean }>}
 *          `url` is always renderable — it falls back to `imageUrl` on failure.
 */
export const removeImageBackground = async (imageUrl, options = {}) => {
  const { onProgress, skipCache = false } = options;

  if (!imageUrl) return { url: '', blob: null, fromCache: false };
  if (REMOVAL_DISABLED) return { url: imageUrl, blob: null, fromCache: false };
  // Already a transparent/foreign asset we shouldn't reprocess.
  if (typeof document === 'undefined') return { url: imageUrl, blob: null, fromCache: false };

  // 1. Cache hit.
  if (!skipCache) {
    const cached = await getCached(imageUrl);
    if (cached) {
      return { url: URL.createObjectURL(cached), blob: cached, fromCache: true };
    }
  }

  // 2. De-duplicate identical concurrent requests.
  if (inFlight.has(imageUrl)) {
    const blob = await inFlight.get(imageUrl);
    return {
      url: blob ? URL.createObjectURL(blob) : imageUrl,
      blob,
      fromCache: false,
    };
  }

  const job = (async () => {
    // Server first (when configured), then the in-browser WASM engine.
    let blob = await removeViaApi(imageUrl);

    if (!blob) {
      blob = await removeViaWasm(imageUrl, onProgress);
    }

    if (blob) await setCached(imageUrl, blob);
    return blob;
  })();

  inFlight.set(imageUrl, job);

  try {
    const blob = await job;
    return {
      url: blob ? URL.createObjectURL(blob) : imageUrl,
      blob,
      fromCache: false,
    };
  } catch (error) {
    // The WASM engine can throw a recoverable `startTime` TypeError; either
    // way the original garment photo is still perfectly viewable.
    if (isKnownStartTimeError(error)) {
      console.warn('[Hiraya] Background removal hit a recoverable startTime error; keeping the original image.');
    } else {
      console.error('[Hiraya] Background removal failed, falling back to the original:', error);
    }
    return { url: imageUrl, blob: null, fromCache: false };
  } finally {
    inFlight.delete(imageUrl);
  }
};

/** Frees an object URL produced by `removeImageBackground` (no-op for others). */
export const releaseBackgroundUrl = (url) => {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* already revoked */
    }
  }
};

/**
 * THE single background-removal entry point for the product consoles.
 *
 * BOTH the Admin and the Super Admin "Add / Edit Garment" flows call THIS, so
 * there is exactly one place that decides how a product image is made
 * background-free — instead of each console re-implementing the same
 * remove -> clean -> frame sequence.
 *
 * It removes the garment's background and composes it onto the one shared
 * HIRAYA catalog frame, returning the two artifacts the product save needs:
 *
 *   display.blob -> uploaded as `display_image_file` -> `display_image_url`
 *                   (what the storefront shows; NEVER the raw photo)
 *   matte.blob   -> uploaded as `tryon_image_file`   -> `ghost_mannequin_url`
 *                   (the bare transparent cut-out the virtual try-on prefers)
 *
 * `composeGarmentOnFrame` (the compositor, STAGE 1) is loaded LAZILY here so the
 * ~95 MB removal engine and the frame assets are only pulled in the moment a
 * photo is actually processed, never on a cold console load.
 *
 * @param {File|Blob|string} garmentSource  The admin's uploaded photo (File/Blob) or a URL.
 * @param {Object} [options]
 * @param {Function} [options.onProgress]   (0..1) progress for the cut-out step.
 * @returns {Promise<{ display: {blob: Blob|null, url: string}, matte: {blob: Blob|null}, ok: boolean }>}
 *          `ok` is false when the background could not be removed (caller keeps
 *          the original photo and should tell the user to retry).
 */
export const generateGarmentCatalogImage = async (garmentSource, options = {}) => {
  if (!garmentSource) {
    return { display: { blob: null, url: '' }, matte: { blob: null }, ok: false };
  }

  const { composeGarmentOnFrame } = await import('./garmentCompositor');
  const composite = await composeGarmentOnFrame({ garmentSource, onProgress: options.onProgress });

  return {
    display: { blob: composite.blob || null, url: composite.url || '' },
    matte: { blob: composite.matte || null },
    // A framed cut-out is the WHOLE point: without it there is no catalog image.
    ok: Boolean(composite.blob),
  };
};

export default removeImageBackground;
