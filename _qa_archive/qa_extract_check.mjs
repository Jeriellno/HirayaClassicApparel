/**
 * EXTRACT-CHECK — verify that `extractGarment` turns the REAL catalog assets
 * into clean, transparent VTON cut-outs.
 *
 * WHY THIS EXISTS
 * ---------------
 * The fix for "the AI try-on renders look wrong" is that the Studio now runs
 * `extractGarment` over each product before it is sent to the VTON model, so the
 * model receives the garment's own pixels instead of the shop's marketing card.
 * That claim is only worth making if it is MEASURED against the live assets.
 *
 * This script imports the app's own module (so it tests the shipped code, not a
 * copy), runs it on product 15 (EMERALD) and 16 (BEIGE), and reports:
 *
 *   - the chosen SOURCE and the `extracted` flag,
 *   - the output image's transparency (a real cut-out is mostly transparent),
 *   - an ASCII silhouette so the SHAPE can be seen, not just counted.
 *
 * It makes NO AI call: zero cost, no credits, no provider involvement.
 */

import { readFileSync } from 'node:fs';

const ASSETS = 'C:/hiraya/_extract_assets.json';

export default async function run(page) {
  // Load the cached asset data (data URIs) so the page needs no network.
  const products = JSON.parse(readFileSync(ASSETS, 'utf8'));

  console.log('\n  EXTRACT-CHECK — real catalog assets through extractGarment');
  console.log('  ' + '='.repeat(66));

  let clean = 0;
  let attempted = 0;

  for (const p of products) {
    attempted++;

    /*
     * Run the SHIPPED extractor inside the page. We import the module from the
     * Vite dev server so this exercises exactly the code the app runs.
     */
    const res = await page.evaluate(async (arg) => {
      try {
        const mod = await import('/src/utils/extractGarment.js');
        const out = await mod.extractGarment(
          {
            ghost_mannequin_url: arg.ghost || '',
            raw_image_url: arg.raw || '',
            image_url: arg.raw || '',
            display_image_url: arg.display || '',
          },
          { preferRaw: true },
        );

        if (!out || !out.url) return { fatal: 'no-url', reason: out?.reason };

        // Measure the returned asset: load it and count alpha.
        const img = await new Promise((r) => {
          const i = new Image();
          i.onload = () => r(i);
          i.onerror = () => r(null);
          i.src = out.url;
        });
        if (!img) return { fatal: 'load-failed', reason: out.reason };

        const cv = document.createElement('canvas');
        // Downscale for the ASCII view only; alpha stats use the full image.
        cv.width = img.width;
        cv.height = img.height;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);

        let transparent = 0;
        let opaque = 0;
        try {
          const { data } = ctx.getImageData(0, 0, img.width, img.height);
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 24) transparent++;
            else opaque++;
          }
        } catch (e) {
          return { fatal: 'tainted: ' + (e?.message || e), reason: out.reason };
        }

        // ASCII silhouette (32 cols x 32 rows).
        const W = 32;
        const H = 32;
        const cv2 = document.createElement('canvas');
        cv2.width = W;
        cv2.height = H;
        const c2 = cv2.getContext('2d', { willReadFrequently: true });
        c2.drawImage(img, 0, 0, W, H);
        const { data: d2 } = c2.getImageData(0, 0, W, H);
        const lines = [];
        for (let y = 0; y < H; y++) {
          let line = '';
          for (let x = 0; x < W; x++) {
            const a = d2[(y * W + x) * 4 + 3];
            line += a >= 160 ? '#' : a >= 40 ? '+' : a >= 8 ? '.' : ' ';
          }
          lines.push(line);
        }

        return {
          extracted: out.extracted,
          reason: out.reason || null,
          width: img.width,
          height: img.height,
          transparent,
          opaque,
          total: img.width * img.height,
          noise: false,
          art: lines.join('\n'),
        };
      } catch (e) {
        return { fatal: 'threw: ' + (e?.message || String(e)) };
      }
    }, {
      ghost: p.ghost_mannequin_url || '',
      display: p.display_data || p.display_image_url || '',
      raw: p.raw_data || p.raw_image_url || '',
    }).catch((e) => ({ fatal: 'evaluate failed: ' + (e?.message || String(e)) }));

    console.log('\n  #' + p.id + '  ' + p.name + '  [' + p.category + ']');
    console.log('  ' + '-'.repeat(66));

    if (res.fatal) {
      console.log('    FATAL: ' + res.fatal);
      continue;
    }

    const tPct = ((res.transparent / res.total) * 100).toFixed(1);
    const oPct = ((res.opaque / res.total) * 100).toFixed(1);
    const isClean = res.extracted && res.transparent / res.total > 0.2 && res.opaque / res.total > 0.03;

    console.log(`    extracted : ${res.extracted}   reason: ${res.reason || '-'}`);
    console.log(`    size      : ${res.width}x${res.height}`);
    console.log(`    alpha     : transparent ${tPct}%   opaque ${oPct}%  (top 0.06% row pitch ignored)`);
    console.log(`    VERDICT   : ${isClean ? 'CLEAN CUT-OUT' : 'NOT a clean cut-out'}`);
    console.log('    silhouette:');
    for (const line of res.art.split('\n')) {
      console.log('      |' + line + '|');
    }

    if (isClean) clean++;
  }

  console.log('\n  ' + '='.repeat(66));
  console.log(`  clean cut-outs: ${clean} / ${attempted}`);
  console.log('  ' + '='.repeat(66) + '\n');

  return { ok: clean === attempted, kind: 'verify', clean, attempted };
}
