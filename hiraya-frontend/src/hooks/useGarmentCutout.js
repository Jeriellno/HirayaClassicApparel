/**
 * useGarmentCutout — resolves a single garment image into a background-free
 * cut-out for the own Style Stack, via the shared `removeBackground` utility.
 *
 * Responsibilities:
 *   - kicks off removal once per image URL,
 *   - exposes `isProcessing` so the card can show a gold loading shimmer,
 *   - revokes the object URL on unmount / URL change (no blob leak),
 *   - never leaves the card blank: `src` falls back to the original image.
 *
 * @param {string} imageUrl  garment image (URL, relative path or data URI)
 * @param {boolean} [enabled=true]  skip processing when false
 */
import { useEffect, useRef, useState } from 'react';
import { removeImageBackground, releaseBackgroundUrl } from '../utils/removeBackground';

/*
 * GLOBAL KILL SWITCH — see useTransparentImage for the full explanation.
 * The `@imgly` engine throws an UNCAUGHT `TypeError: ... reading 'startTime'`
 * from its own rAF callback, which crashes the entire React tree. Disabled here
 * for the same reason: the admin pipeline already provides the cut-out.
 */
const CLIENT_CUTOUT_ENABLED = false;

/*
 * HARD CEILING for one cut-out attempt.
 *
 * The engine needs a ~95 MB model on its FIRST run before it can infer, and on
 * a cold cache / slow link that easily exceeds 30 s. The card must never look
 * stuck for that long, so if removal has not finished inside this window we stop
 * waiting, KEEP the original product photo, and let the tile be fully usable.
 * `removeImageBackground` still runs to completion in the background and caches
 * its result, so a later visit to this garment shows the cut-out instantly.
 */
const CUTOUT_UI_TIMEOUT_MS = 8000;

export const useGarmentCutout = (imageUrl, enabled = true) => {
  const [src, setSrc] = useState(imageUrl || '');
  const [isProcessing, setIsProcessing] = useState(false);
  const objectUrlRef = useRef(null);

  useEffect(() => {
    // Reset to the raw image when there is nothing to process, and short-circuit
    // entirely while the crashing client-side engine is disabled.
    if (!imageUrl || !enabled || !CLIENT_CUTOUT_ENABLED) {
      setSrc(imageUrl || '');
      setIsProcessing(false);
      return undefined;
    }

    let isMounted = true;
    setIsProcessing(true);
    // Show the original immediately so the row never pops in blank.
    setSrc(imageUrl);

    /*
     * Stop SHOWING the spinner after the ceiling even though the work continues.
     * This is the difference between "the app is frozen" and "the photo is here,
     * the polish is still coming".
     */
    const uiTimer = setTimeout(() => {
      if (isMounted) setIsProcessing(false);
    }, CUTOUT_UI_TIMEOUT_MS);

    (async () => {
      const { url } = await removeImageBackground(imageUrl);
      if (!isMounted) {
        // Component unmounted mid-flight — clean up the URL we just made.
        releaseBackgroundUrl(url);
        return;
      }
      if (url && url.startsWith('blob:')) objectUrlRef.current = url;
      setSrc(url || imageUrl);
      setIsProcessing(false);
    })();

    return () => {
      isMounted = false;
      clearTimeout(uiTimer);
      if (objectUrlRef.current) {
        releaseBackgroundUrl(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [imageUrl, enabled]);

  return { src, isProcessing };
};

export default useGarmentCutout;
