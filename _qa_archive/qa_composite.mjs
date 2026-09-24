import { writeFileSync } from 'node:fs';

/**
 * Render the REAL compositeTryOn end-to-end on a synthetic full-body portrait
 * (with an alpha silhouette, which is what the silhouette scanner needs) and
 * dump the result so the fit can actually be looked at.
 */
export default async function run(page) {
  const result = await page.evaluate(async () => {
    const mod = await import('/src/utils/compositeTryOn.js');
    const SUP = 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public';

    const load = (src) => new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i);
      i.onerror = () => r(null);
      i.src = src;
    });

    /*
     * Build a synthetic "uploaded photo": a standing human silhouette on a
     * transparent background, 800x1200, so measureSilhouette() can find a
     * shoulder line, torso centre and body height. This stands in for a user's
     * uploaded cut-out portrait.
     */
    const buildPortrait = () => {
      const W = 800, H = 1200;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');

      // Sculpt a rough standing figure with feet -> head.
      const cx = 400;
      // legs
      g.fillStyle = '#c9a58a';
      g.beginPath(); g.roundRect(cx - 70, 700, 60, 460, 20); g.fill();
      g.beginPath(); g.roundRect(cx + 10, 700, 60, 460, 20); g.fill();
      // torso
      g.beginPath(); g.roundRect(cx - 120, 340, 240, 380, 40); g.fill();
      // arms
      g.beginPath(); g.roundRect(cx - 175, 350, 60, 330, 25); g.fill();
      g.beginPath(); g.roundRect(cx + 115, 350, 60, 330, 25); g.fill();
      // neck + head
      g.beginPath(); g.roundRect(cx - 30, 280, 60, 70, 15); g.fill();
      g.beginPath(); g.arc(cx, 230, 75, 0, Math.PI * 2); g.fill();

      // A soft gradient of "existing light" from the LEFT, so the lighting
      // sampler has something real to measure.
      const grd = g.createLinearGradient(0, 0, W, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';

      return cv.toDataURL('image/png');
    };

    const portrait = buildPortrait();

    const garments = {
      dress: {
        name: 'Emerald Dress',
        raw_image_url: `${SUP}/products/catalog/1789529378546-vq9blwc.jpg`,
        display_image_url: `${SUP}/products/catalog/1789529379424-kivp9kr.png`,
      },
    };

    const measurements = {
      chest_bust: 88, waist: 70, hips: 96, shoulder_width: 38, sleeve_length: 58,
    };

    const out = await mod.compositeTryOn({ portrait, garments, measurements, watermark: 'Hiraya' });

    return {
      placed: out.placed,
      diagnostics: out.diagnostics,
      portrait,
      image: out.image,
    };
  });

  // Stitch portrait (left) and composite (right) side by side for comparison.
  const composite = await page.evaluate(async ({ portrait, image }) => {
    const load = (src) => new Promise((r) => {
      const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src;
    });
    const p = await load(portrait);
    const c = await load(image);
    const H = 640;
    const pw = Math.round(H * (p.naturalWidth / p.naturalHeight));
    const cw = Math.round(H * (c.naturalWidth / c.naturalHeight));
    const gap = 12;
    const cv = document.createElement('canvas');
    cv.width = pw + cw + gap * 3;
    cv.height = H + 34;
    const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    g.font = 'bold 13px sans-serif'; g.fillStyle = '#fff';
    g.fillText('UPLOADED PORTRAIT', gap, 18);
    g.drawImage(p, gap, 26, pw, H);
    g.fillStyle = '#9cff9c';
    g.fillText('COMPOSITE OUTPUT (current)', gap * 2 + pw, 18);
    g.drawImage(c, gap * 2 + pw, 26, cw, H);
    return cv.toDataURL('image/png');
  }, { portrait: result.portrait, image: result.image });

  writeFileSync('C:/hiraya/composite_current.png', Buffer.from(composite.replace(/^data:image\/png;base64,/, ''), 'base64'));

  return {
    wrote: 'C:/hiraya/composite_current.png',
    placed: result.placed,
    diagnostics: result.diagnostics,
  };
}
