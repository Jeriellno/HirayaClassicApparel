/**
 * Verify extractGarment against the REAL catalog card in a headless browser.
 * Loads the built app (so Vite module resolution works), then inlines the same
 * extraction logic via the module the app already bundles.
 */
export default async function run(page, ui) {
  const result = await page.evaluate(async () => {
    // Reach the module the app bundled, through the dev/build module graph.
    const mod = await import('/src/utils/extractGarment.js').catch(() => null);
    if (!mod) return { error: 'could not import extractGarment module' };

    /*
     * The fix under test: FETCH the bytes (a CORS-enabled response) and turn them
     * into a same-origin data URI. Once the image is a data URI its canvas is no
     * longer tainted, so extraction can actually read pixels.
     */
    const toDataUri = async (url) => {
      const res = await fetch(url);
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onloadend = () => resolve({ dataUri: fr.result, bytes: blob.size, type: blob.type });
        fr.onerror = () => resolve({ error: 'FileReader failed' });
        fr.readAsDataURL(blob);
      });
    };

    const SUP = 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public';
    const cases = [
      {
        label: 'Emerald — DIRECT supabase (expect taint)',
        url: `${SUP}/products/catalog/1789529379424-kivp9kr.png`,
      },
      {
        label: 'Emerald — fetched to data URI (the fix)',
        url: `${SUP}/products/catalog/1789529379424-kivp9kr.png`,
        viaFetch: true,
      },
      {
        label: 'Beige — fetched to data URI (the fix)',
        url: `${SUP}/products/catalog/1789553972085-ktdnmgj.png`,
        viaFetch: true,
      },
      {
        label: 'Beige — RAW jpeg via fetch (the "raw" slot)',
        url: `${SUP}/products/catalog/1789553970904-kl0wdgp.jpg`,
        viaFetch: true,
      },
    ];

    const out = [];

    for (const c of cases) {
      let src = c.url;
      let fetched = null;

      if (c.viaFetch) {
        fetched = await toDataUri(c.url);
        if (fetched.error) {
          out.push({ label: c.label, error: 'fetch failed: ' + fetched.error });
          continue;
        }
        src = fetched.dataUri;
      }

      const before = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = src;
      });

      const r = await mod.extractGarment(src);

      // Measure the produced cut-out: dimensions + how much is transparent.
      let after = null;
      if (r?.url) {
        after = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const cv = document.createElement('canvas');
            cv.width = img.naturalWidth;
            cv.height = img.naturalHeight;
            const cx = cv.getContext('2d', { willReadFrequently: true });
            cx.drawImage(img, 0, 0);
            let transparent = 0;
            let total = 0;
            let opaque = 0;
            let minX = cv.width, maxX = -1, minY = cv.height, maxY = -1;
            try {
              const d = cx.getImageData(0, 0, cv.width, cv.height).data;
              for (let y = 0; y < cv.height; y += 2) {
                for (let x = 0; x < cv.width; x += 2) {
                  const a = d[(y * cv.width + x) * 4 + 3];
                  total++;
                  if (a < 16) transparent++;
                }
              }
              // Full-resolution bounds of what is still visible.
              const full = cx.getImageData(0, 0, cv.width, cv.height).data;
              for (let y = 0; y < cv.height; y++) {
                for (let x = 0; x < cv.width; x++) {
                  if (full[(y * cv.width + x) * 4 + 3] > 16) {
                    opaque++;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                  }
                }
              }
            } catch (e) {
              resolve({ error: String(e) });
              return;
            }
            resolve({
              w: cv.width,
              h: cv.height,
              transparentPct: Math.round((transparent / total) * 1000) / 10,
              opaquePct: Math.round((opaque / (cv.width * cv.height)) * 1000) / 10,
              contentBox: { minX, minY, maxX, maxY },
            });
          };
          img.onerror = () => resolve({ error: 'cutout failed to load' });
          img.src = r.url;
        });
      }

      out.push({
        label: c.label,
        sourceSize: before,
        extracted: r?.extracted,
        reason: r?.reason,
        cutoutSize: after ? { w: after.w, h: after.h } : null,
        cutoutTransparentPct: after?.transparentPct,
        cutoutOpaquePct: after?.opaquePct,
        cutoutContentBox: after?.contentBox,
        cutoutError: after?.error,
      });
    }

    return { results: out };
  });

  return result;
}
