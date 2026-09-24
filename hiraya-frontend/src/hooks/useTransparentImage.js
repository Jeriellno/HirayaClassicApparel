import { useState, useEffect } from 'react';
import { removeBackground } from '@imgly/background-removal';
import { isKnownStartTimeError } from '../utils/runtimeGuards';

/*
 * GLOBAL KILL SWITCH for the in-browser background remover.
 *
 * This engine throws an unrecoverable, UNCAUGHT error out of its own
 * animation-frame callback:
 *
 *   Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')
 *       at et.reportAllChanges
 *
 * It escapes the surrounding try/catch because it fires asynchronously, and it
 * takes the WHOLE React tree down with it (blank Studio). The cut-out is the
 * admin pipeline's job (`display_image_url`), so this hook now short-circuits
 * and simply returns the original image. Kept as a named constant so the engine
 * can be re-enabled deliberately later, never by accident.
 */
const CLIENT_CUTOUT_ENABLED = false;

/**
 * The engine's default asset host (staticimgly.com) is blocked on restrictive
 * networks, so its ~95 MB of model files are mirrored into the backend's
 * `public/vendor/imgly/` and served as static files. Same setting
 * `utils/removeBackground` uses — keep the two in sync.
 *
 * SAME-ORIGIN + TRAILING SLASH, both load-bearing:
 *
 *  - A relative `/vendor/imgly/` resolves against the page's origin, so the
 *    request is NOT cross-origin and never hits a CORS block. (Laravel's
 *    built-in server serves files that exist on disk before the framework
 *    boots, so no CORS header is ever attached to them.) Vite's dev-server
 *    proxy forwards it to the backend — see vite.config.js.
 *
 *  - The engine does `new URL("resources.json", publicPath)`, which drops the
 *    last segment of the base when there is no trailing slash. Without it,
 *    `resources.json` resolved to `/vendor/resources.json` (404) instead of
 *    `/vendor/imgly/resources.json`, and removal failed instantly.
 */
const withTrailingSlash = (path) => (path.endsWith('/') ? path : `${path}/`);

/*
 * An ABSOLUTE, same-origin URL with a trailing slash is required:
 *
 *  - `new URL("resources.json", publicPath)` inside the engine THROWS
 *    `TypeError: Invalid base URL` if `publicPath` is relative, so it cannot be
 *    a bare '/vendor/imgly/'.
 *  - Without the trailing slash the last segment is treated as a file and
 *    dropped, resolving to `/vendor/resources.json` (404) rather than
 *    `/vendor/imgly/resources.json`.
 *
 * Building it from the page's own origin keeps the request same-origin, so no
 * CORS block applies; the Vite dev-server proxy forwards it to the backend.
 */
const resolvePublicPath = () => {
  const configured = import.meta.env?.VITE_BG_REMOVAL_PUBLIC_PATH;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  if (configured) {
    return withTrailingSlash(configured.startsWith('/') ? `${origin}${configured}` : configured);
  }

  return `${origin}/vendor/imgly/`;
};

const PUBLIC_PATH = resolvePublicPath();

// Simple IndexedDB cache para hindi na i-reprocess ang parehong image
const DB_NAME = 'HirayaImageCache';
const STORE_NAME = 'transparent_images';

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const getCachedImage = async (key) => {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
};

const setCachedImage = async (key, blob) => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(blob, key);
  } catch (err) {
    console.warn('Failed to cache transparent image:', err);
  }
};

export const useTransparentImage = (originalImageUrl) => {
  const [transparentUrl, setTransparentUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!originalImageUrl) return;

    // Cut-out disabled: hand back the original image and do no work at all.
    // This is what keeps the Studio from crashing on the startTime TypeError.
    if (!CLIENT_CUTOUT_ENABLED) {
      setTransparentUrl(originalImageUrl);
      setIsProcessing(false);
      return undefined;
    }

    let isMounted = true;
    let objectUrl = null;

    /*
     * Stop showing the spinner after this window even though removal continues.
     * The first run needs the ~95 MB model before any inference happens, which
     * is what made a tile appear to hang for ~30 s. The caller now always gets a
     * renderable image immediately, so this only governs the small "processing"
     * badge, never whether pixels are on screen.
     */
    const uiTimer = setTimeout(() => {
      if (isMounted) setIsProcessing(false);
    }, 8000);

    const processImage = async () => {
      setIsProcessing(true);

      // 1. Check IndexedDB Cache muna
      const cachedBlob = await getCachedImage(originalImageUrl);
      if (cachedBlob && isMounted) {
        objectUrl = URL.createObjectURL(cachedBlob);
        setTransparentUrl(objectUrl);
        setIsProcessing(false);
        return;
      }

      // 2. Kung wala sa cache, iproseso gamit ang Client-side AI Engine
      try {
        // The bundled WASM engine can throw a `startTime` TypeError from a
        // stray animation-frame/measure callback. Wrapping the await keeps that
        // contained so the caller always gets a renderable URL back.
        const imageBlob = await removeBackground(originalImageUrl, {
          // Load the self-hosted assets, never the blocked CDN.
          publicPath: PUBLIC_PATH,
          device: 'cpu',
          model: 'isnet_fp16',
          progress: (key, current, total) => {
            // Optional: pwede mag-log ng progress kung kinakailangan
          },
        });

        if (isMounted) {
          await setCachedImage(originalImageUrl, imageBlob);
          objectUrl = URL.createObjectURL(imageBlob);
          setTransparentUrl(objectUrl);
        }
      } catch (error) {
        if (isKnownStartTimeError(error)) {
          // Non-fatal: the garment photo itself is still perfectly viewable.
          console.warn('[Hiraya] Background removal hit a recoverable startTime error; using the original image.');
        } else {
          console.error('AI Background Removal Failed, falling back to original:', error);
        }
        if (isMounted) {
          setTransparentUrl(originalImageUrl); // Fallback kung sakaling mag-fail ang AI
        }
      } finally {
        if (isMounted) setIsProcessing(false);
      }
    };

    processImage();

    return () => {
      isMounted = false;
      clearTimeout(uiTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [originalImageUrl]);

  return { transparentUrl, isProcessing };
};