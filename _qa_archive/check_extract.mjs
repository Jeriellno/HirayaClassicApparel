import { writeFileSync } from 'node:fs';

/**
 * Run the REAL extractGarment on both live products and render source vs cut-out
 * side by side, so the result can be inspected directly.
 */
export default async function run(page) {
  const result = await page.evaluate(async () => {
    const mod = await import('/src/utils/extractGarment.js');
    const SUP = 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public';

    const load = (src) => new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i);
      i.onerror = () => r(null);
      i.src = src;
    });

    const products = [
      {
        label: 'EMERALD',
        raw_image_url: SUP + '/products/catalog/1789529378546-vq9blwc.jpg',
      },
      {
        label: 'BEIGE',
        raw_image_url: SUP + '/products/catalog/1789553970904-kl0wdgp.jpg',
      },
    ];

    const tiles = [];

    for (const p of products) {
      const r = await mod.extractGarment(p);
      const rawSrc = await mod.toReadableSource(p.raw_image_url);
      const rawImg = await load(rawSrc);
      const cutImg = r.extracted ? await load(r.url) : null;

      let stats = null;
      if (cutImg) {
        const cv = document.createElement('canvas');
        cv.width = cutImg.naturalWidth;
        cv.height = cutImg.naturalHeight;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(cutImg, 0, 0);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        let opaque = 0;
        for (let k = 3; k < d.length; k += 4) {
          if (d[k] > 16) opaque++;
        }
        stats = {
          w: cv.width,
          h: cv.height,
          opaquePct: Math.round((opaque / (cv.width * cv.height)) * 1000) / 10,
        };
      }

      tiles.push({ label: p.label, rawImg, cutImg, info: r, stats });
    }

    const H = 500;
    const sw = Math.round(H * 0.8);
    const gap = 10;
    const colW = sw * 2 + gap;

    const cvOut = document.createElement('canvas');
    cvOut.width = colW * tiles.length + gap;
    cvOut.height = H + 30;
    const g = cvOut.getContext('2d');

    for (let y = 0; y < cvOut.height; y += 12) {
      for (let x = 0; x < cvOut.width; x += 12) {
        g.fillStyle = ((x / 12 + y / 12) % 2) ? '#cccccc' : '#eeeeee';
        g.fillRect(x, y, 12, 12);
      }
    }

    g.font = 'bold 12px sans-serif';
    let ox = gap;

    for (const t of tiles) {
      g.fillStyle = '#000';
      g.fillText(t.label + ' RAW source', ox, 14);
      if (t.rawImg) g.drawImage(t.rawImg, ox, 22, sw, H);

      const ox2 = ox + sw + gap;
      g.fillStyle = t.info.extracted ? '#0a6b0a' : '#aa0000';
      g.fillText(t.label + ' EXTRACTED ' + (t.info.extracted ? 'ok' : String(t.info.reason)), ox2, 14);
      if (t.cutImg) g.drawImage(t.cutImg, ox2, 22, sw, H);

      ox += colW + gap;
    }

    return {
      dataUrl: cvOut.toDataURL('image/png'),
      summary: tiles.map((t) => ({
        label: t.label,
        extracted: t.info.extracted,
        reason: t.info.reason,
        seamRow: t.info.reflectionSeam,
        size: t.stats ? t.stats.w + 'x' + t.stats.h : null,
        opaquePct: t.stats ? t.stats.opaquePct : null,
      })),
    };
  });

  const base64 = result.dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync('C:/hiraya/extract_final.png', Buffer.from(base64, 'base64'));

  return { wrote: 'C:/hiraya/extract_final.png', summary: result.summary };
}
