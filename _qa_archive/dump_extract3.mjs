import { writeFileSync } from 'node:fs';

/**
 * Render source vs extracted for both products, so I can LOOK at the result.
 */
export default async function run(page) {
  const dataUrl = await page.evaluate(async () => {
    const mod = await import('/src/utils/extractGarment.js');
    const SUP = 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public';

    const load = (src) => new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    });

    // The real garment objects as the app builds them.
    const garments = [
      {
        label: 'EMERALD',
        raw_image_url: `${SUP}/products/catalog/1789529378546-vq9blwc.jpg`,
        display_image_url: `${SUP}/products/catalog/1789529379424-kivp9kr.png`,
      },
      {
        label: 'BEIGE',
        raw_image_url: `${SUP}/products/catalog/1789553970904-kl0wdgp.jpg`,
        display_image_url: `${SUP}/products/catalog/1789553972085-ktdnmgj.png`,
      },
    ];

    const tiles = [];
    for (const g of garments) {
      const r = await mod.extractGarment(g);
      // Load the RAW source through the same inliner so the comparison canvas is
      // not tainted by a direct cross-origin <img>.
      const rawImg = await load(await mod.toReadableSource(g.raw_image_url));
      const cutImg = await load(r.url);
      tiles.push({ label: g.label, rawImg, cutImg, info: r });
    }

    const H = 540;
    const sw = Math.round(H / 1.25);   // raw is 1080x1350
    const totalW = (sw * 2 + 16) * tiles.length + 16;
    const cv = document.createElement('canvas');
    cv.width = totalW;
    cv.height = H + 26;
    const cx = cv.getContext('2d');

    // Checkerboard reveals transparency.
    for (let y = 0; y < cv.height; y += 14) {
      for (let x = 0; x < cv.width; x += 14) {
        cx.fillStyle = ((x / 14 + y / 14) % 2) ? '#c9c9c9' : '#f4f4f4';
        cx.fillRect(x, y, 14, 14);
      }
    }

    let ox = 16;
    cx.fillStyle = '#111';
    cx.font = 'bold 12px sans-serif';

    for (const t of tiles) {
      cx.fillText(`${t.label} RAW source`, ox, 12);
      cx.drawImage(t.rawImg, ox, 20, sw, H);
      ox += sw + 8;

      cx.fillText(`${t.label} EXTRACTED (${t.info.extracted ? 'ok' : t.info.reason})`, ox, 12);
      if (t.cutImg) {
        const cw = Math.round(t.cutImg.naturalWidth * (H / t.cutImg.naturalHeight));
        cx.drawImage(t.cutImg, ox, 20, cw, H);
        ox += Math.max(cw, sw) + 8;
      } else {
        ox += sw + 8;
      }
    }

    return cv.toDataURL('image/png');
  });

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync('C:/hiraya/extract_compare2.png', Buffer.from(base64, 'base64'));
  return { wrote: 'C:/hiraya/extract_compare2.png' };
}
