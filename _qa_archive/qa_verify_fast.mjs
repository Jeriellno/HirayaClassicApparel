/**
 * FAST combined verification: extracts both products AND times each stage, then
 * renders the two cut-outs side by side in one pass, so one run answers both
 * "did the fix work" and "how fast is it".
 */
import { writeFileSync } from 'node:fs';

export default async function run(page) {
  const result = await page.evaluate(async () => {
    const ex = await import('/src/utils/extractGarment.js');
    const SUP = 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public';

    const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });

    const products = [
      { label: 'EMERALD', obj: { raw_image_url: `${SUP}/products/catalog/1789529378546-vq9blwc.jpg`, display_image_url: `${SUP}/products/catalog/1789529379424-kivp9kr.png` } },
      { label: 'BEIGE', obj: { raw_image_url: `${SUP}/products/catalog/1789553970904-kl0wdgp.jpg`, display_image_url: `${SUP}/products/catalog/1789553972085-ktdnmgj.png` } },
    ];

    const tiles = [];
    for (const p of products) {
      const t0 = performance.now();
      const r = await ex.extractGarment(p.obj);
      const ms = Math.round(performance.now() - t0);
      const cut = r.extracted ? await load(r.url) : null;
      tiles.push({ label: p.label, cut, ms, extracted: r.extracted, reason: r.reason, size: r.extracted ? `${r.width}x${r.height}` : '-' });
    }

    // Side-by-side, on a mid-grey field so both dark and pale fabrics read.
    const H = 560;
    const gap = 14;
    const cw = tiles.map((t) => (t.cut ? Math.round(H * (t.cut.naturalWidth / t.cut.naturalHeight)) : 200));
    const cv = document.createElement('canvas');
    cv.width = cw.reduce((a, b) => a + b, 0) + gap * (tiles.length + 1);
    cv.height = H + 30;
    const g = cv.getContext('2d');
    g.fillStyle = '#5a5a5a'; g.fillRect(0, 0, cv.width, cv.height);
    g.font = 'bold 13px sans-serif'; g.fillStyle = '#fff';
    let ox = gap;
    tiles.forEach((t, i) => {
      g.fillText(`${t.label}  ${t.extracted ? t.size : t.reason}  ${t.ms}ms`, ox, 18);
      if (t.cut) g.drawImage(t.cut, ox, 26, cw[i], H);
      ox += cw[i] + gap;
    });

    return { dataUrl: cv.toDataURL('image/png'), summary: tiles.map((t) => ({ label: t.label, extracted: t.extracted, reason: t.reason, ms: t.ms, size: t.size })) };
  });

  writeFileSync('C:/hiraya/extract_final.png', Buffer.from(result.dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
  return { wrote: 'C:/hiraya/extract_final.png', summary: result.summary };
}
