import { useEffect, useState } from 'react';
import { getGarmentCutout } from '../utils/garmentCutout';

/**
 * useFloatingCutouts — lifts each garment image off its flat catalogue card.
 *
 * Returns a map keyed by image URL:
 *   - key missing        → still processing (render a placeholder)
 *   - `{ src, color }`   → a transparent PNG cut-out and the garment's colour
 *   - `null`             → not a flat card / not readable; use the original
 *
 * Purely presentational: it reads images the page already shows and never
 * touches product data. Results are cached per URL for the session by
 * `utils/garmentCutout.js`.
 */
export const useFloatingCutouts = (urls) => {
  const key = (urls || []).filter(Boolean).join('|');
  const [cutouts, setCutouts] = useState({});

  useEffect(() => {
    if (!key) return undefined;
    let alive = true;

    key.split('|').forEach((url) => {
      getGarmentCutout(url).then((result) => {
        if (!alive) return;
        setCutouts((current) => (url in current && current[url] === result ? current : { ...current, [url]: result }));
      });
    });

    return () => {
      alive = false;
    };
  }, [key]);

  return cutouts;
};

export default useFloatingCutouts;
