// Local fallback image URL served from the app's own origin to avoid COEP issues.
const FALLBACK_IMAGE = '/images/placeholder.svg';

/**
 * Origin of the Laravel backend (everything before the `/api` suffix).
 */
const getBackendOrigin = () => {
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api';
  return apiBase.replace(/\/api\/?$/, '');
};

/**
 * Extract the disk-relative key from a LEGACY Laravel-disk reference, or null
 * when the reference is not one.
 *
 * WHY THIS SHAPE MUST BE REMAPPED, NOT SERVED
 * -------------------------------------------
 * Rows written before the move to Supabase still hold the backend's OWN disk
 * URL — `Storage::disk('public')->url('catalog/x.png')` produced
 * `http://127.0.0.1:8000/storage/catalog/x.png` (verified live: products #19
 * and #20 both store exactly this in `display_image_url` / `image_url`).
 *
 * That file is NOT on the app server: `storage/app/public` is gitignored, so
 * every clone/deploy ships an EMPTY tree while the database keeps a
 * valid-looking URL. Routing these to `/storage/` therefore guarantees a 403 —
 * the browser asks the Vite `/storage` proxy (dev) or the .htaccess `Alias`
 * (prod), the Laravel router script never statically serves the file, and the
 * card falls back to the "NO IMAGE" placeholder. That is the reported bug.
 *
 * The bytes for these rows DO exist — in the Supabase `products` bucket under
 * `catalog/`. So a legacy disk reference is remapped onto that bucket below,
 * which is where every reader expects catalog imagery to live anyway.
 *
 * Recognised shapes:
 *   - http://127.0.0.1:8000/storage/catalog/x.png   -> catalog/x.png
 *   - /storage/catalog/x.png                        -> catalog/x.png
 *   - storage/catalog/x.png                         -> catalog/x.png
 *   - public/catalog/x.png                          -> catalog/x.png
 *
 * Returns null for a Supabase route (`/storage/v1/object/public/...`), which is
 * NOT a backend disk path and must never be misread as one.
 */
const legacyDiskKey = (url) => {
  if (typeof url !== 'string' || url === '') return null;

  // Supabase's own route is `/storage/v1/object/public/...` — never a disk path.
  if (url.includes('/storage/v1/object/public/')) return null;

  let pathname = url;

  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const parsed = new URL(url);

      /*
       * Only OUR backend's disk is remapped. A third-party host that happens to
       * use `/storage/...` (a CDN, an S3 endpoint) is not our asset and must be
       * left for the browser to fetch directly — otherwise we would rebrand a
       * foreign URL into our bucket and 404 it.
       */
      const backendHost = new URL(getBackendOrigin()).host.toLowerCase();
      const localHosts = [backendHost, 'localhost', '127.0.0.1', '::1'];
      const sameHost = localHosts.some(
        (h) => h && h === parsed.host.toLowerCase()
      );

      if (!sameHost) return null;

      pathname = parsed.pathname;
    } catch {
      return null;
    }
  }

  // Strip the three container prefixes, in the order they nest.
  const stripped = pathname
    .replace(/^\/+/, '')
    .replace(/^storage\//, '')
    .replace(/^public\//, '')
    .replace(/^storage\//, '');

  // Only a genuine prefix match counts — a bare key (`catalog/x.png`) is left
  // to the caller's bucket fallback, not treated as a legacy disk reference.
  return stripped && stripped !== pathname.replace(/^\/+/, '') ? stripped : null;
};

/**
 * True when the path is a bare object name with no subdirectories.
 */
const isBareSupabaseObject = (path) => !path.includes('/');

/**
 * Rewrites any Supabase public storage URL to use the local same-origin proxy
 * (`/supabase-storage/...`), satisfying COEP (require-corp) rules.
 *
 * @param {string} url - Target URL or path
 * @returns {string} Same-origin proxied path or original URL
 */
export const toSupabaseStorageProxyUrl = (url) => {
  const proxied = import.meta.env.VITE_SUPABASE_STORAGE_PROXY !== 'false';
  if (!proxied || typeof url !== 'string') return url;

  // Handle absolute URLs pointing to Supabase storage
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith('/storage/v1/object/public/')) {
        return `/supabase-storage${parsed.pathname}${parsed.search}`;
      }
      return url;
    } catch {
      return url;
    }
  }

  // Handle absolute path strings already having the storage segment
  if (url.startsWith('/storage/v1/object/public/')) {
    return `/supabase-storage${url}`;
  }

  return url;
};

/**
 * Build the same-origin URL for an object in the Supabase `products` bucket.
 *
 * THIS IS WHERE CATALOG IMAGERY LIVES. Both the physical bytes (verified: the
 * `products/catalog/` prefix holds every current upload) and the rows written
 * since the Supabase move point here. A bare object name is placed under the
 * bucket's `catalog/` folder, which is the folder every upload uses.
 *
 * Deliberately tolerant of a missing `VITE_SUPABASE_URL`: it falls back to the
 * PUBLIC bucket URL shape by deriving the project ref from nothing is not
 * possible, so instead it emits the root-relative bucket path the backend
 * itself writes (`/supabase-storage/storage/v1/object/public/<bucket>/<key>`),
 * which the same-origin proxy resolves without the SPA needing the ref.
 *
 * @param {string} key    bucket-relative object key, e.g. `catalog/x.png`
 * @param {string} bucket Supabase bucket name (default: `products`)
 * @returns {string} Same-origin proxied URL
 */
const supabaseBucketUrl = (key, bucket = 'products') => {
  const cleanKey = String(key).replace(/^\/+/, '');

  const objectPath = cleanKey.startsWith(`${bucket}/`)
    ? cleanKey
    : isBareSupabaseObject(cleanKey)
    ? `${bucket}/${cleanKey}`
    : cleanKey;

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

  if (!SUPABASE_URL) {
    // No project URL configured: emit the root-relative bucket path the same
    // origin can resolve, rather than a broken absolute URL.
    return `/supabase-storage/storage/v1/object/public/${objectPath}`;
  }

  return toSupabaseStorageProxyUrl(`${SUPABASE_URL}/storage/v1/object/public/${objectPath}`);
};

/**
 * Generates the public image URL for Supabase/Laravel storage or returns fallback.
 *
 * @param {string} imagePath - Relative path, full URL, or data URI.
 * @param {string} bucket - Supabase storage bucket name (default: 'products').
 * @returns {string} The formatted display URL.
 */
export const getProductImageUrl = (imagePath, bucket = 'products') => {
  if (!imagePath || typeof imagePath !== 'string') return FALLBACK_IMAGE;

  // 1. Data URIs return as-is
  if (imagePath.startsWith('data:image')) return imagePath;

  /*
   * 2. A LEGACY Laravel-disk reference (`http://127.0.0.1:8000/storage/catalog/x.png`).
   *
   * Rows written before the move to Supabase hold this shape — verified live:
   * products #19/#20 store it in `display_image_url`. The local tree is
   * gitignored, so the file is absent from the app server and `/storage/...`
   * answers 403 (the router script never statically serves it). The bytes DO
   * live in the Supabase bucket, so the reference is REMAPPED there instead of
   * being served from `/storage/`.
   */
  const diskKey = legacyDiskKey(imagePath);
  if (diskKey) {
    return supabaseBucketUrl(diskKey, bucket);
  }

  /*
   * 3. Absolute HTTP/HTTPS URLs (including raw Supabase bucket URLs).
   *    Supabase routes are rewritten onto the same-origin proxy; anything else
   *    is left untouched for the browser to fetch directly.
   */
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return toSupabaseStorageProxyUrl(imagePath);
  }

  // 4. Already proxied paths (e.g., `/supabase-storage/...`) or root-relative paths
  if (imagePath.startsWith('/')) {
    return toSupabaseStorageProxyUrl(imagePath);
  }

  const cleanPath = imagePath.replace(/^\//, '');

  // 5. Legacy Laravel disk paths (e.g., explicitly prefixed with `storage/` or `public/`)
  //    Remapped onto the Supabase bucket: the local tree is empty on every
  //    clone, so serving `/storage/...` would only ever 403.
  if (cleanPath.startsWith('storage/') || cleanPath.startsWith('public/')) {
    const relativeStoragePath = cleanPath.replace(/^(storage|public)\//, '');
    return supabaseBucketUrl(relativeStoragePath, bucket);
  }

  // 6. Construct Supabase URL and proxy it
  return supabaseBucketUrl(cleanPath, bucket);
};

/**
 * Resolves the primary customer-facing image URL for a given product payload.
 *
 * @param {Object|string} product - API product payload object or direct string path.
 * @param {string} bucket - Storage bucket name.
 * @returns {string} Renderable image URL.
 */
export const getProductDisplayImageUrl = (product, bucket = 'products') => {
  if (!product) return FALLBACK_IMAGE;

  if (typeof product === 'string') {
    return getProductImageUrl(product, bucket);
  }

  if (typeof product === 'object') {
    const path =
      product.display_image_url ||
      product.image_url ||
      product.image_path ||
      product.image;

    return getProductImageUrl(path, bucket);
  }

  return FALLBACK_IMAGE;
};