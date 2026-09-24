import { writeFileSync } from 'node:fs';

/**
 * Render a side-by-side comparison of the source card vs the extracted cut-out,
 * then write it to disk so I can LOOK at the result.
 */
export default async function run(page) {
  const dataUrl = await page.evaluate(async () => {
    const mod = await import('/src/utils/extractGarment.js');
    const SUP = 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public';

    const toDataUri = async (url) => {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onloadend = () => resolve(fr.result);
        fr.readAsDataURL(blob);
      });
    };

    const load = (src) => new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    });

    const cases = [
      { label: 'EMERALD', url: `${SUP}/products/catalog/1789529379424-kivp9kr.png` },
      { label: 'BEIGE', url: `${SUP}/products/catalog/1789553972085-ktdnmgj.png` },
    ];

    const H = 560;
    const tiles = [];

    for (const c of cases) {
      const dataUri = await toDataUri(c.url);
      const r = await mod.extractGarment(dataUri);
      const srcImg = await load(dataUri);
      const cutImg = await load(r.url);
      tiles.push({ label: c.label, srcImg, cutImg });
    }

    const tw = Math.round(H / 1.25); // card aspect 1000x1250
    const totalW = (tw * 2 + 20) * tiles.length + 20;
    const cv = document.createElement('canvas');
    cv.width = totalW;
    cv.height = H + 20;
    const cx = cv.getContext('2d');

    // Checkerboard so transparency is visible.
    for (let y = 0; y < cv.height; y += 16) {
      for (let x = 0; x < cv.width; x += 16) {
        cx.fillStyle = ((x / 16 + y / 16) % 2) ? '#c9c9c9' : '#f2f2f2';
        cx.fillRect(x, y, 16, 16);
      }
    }

    let ox = 20;
    cx.fillStyle = '#111';
    cx.font = 'bold 13px sans-serif';

    for (const t of tiles) {
      cx.fillText(`${t.label} — source card`, ox, 14);
      cx.drawImage(t.srcImg, ox, 20, tw, H);
      ox += tw + 10;
      cx.fillText(`${t.label} — extracted`, ox, 14);
      if (t.cutImg) {
        const cw = Math.round(t.cutImg.naturalWidth * (H / t.cutImg.naturalHeight));
        cx.drawImage(t.cutImg, ox, 20, cw, H);
        ox += Math.max(cw, tw) + 20;
      } else {
        ox += tw + 20;
      }
    }

    return cv.toDataURL('image/png');
  });

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync('C:/hiraya/extract_compare.png', Buffer.from(base64, 'base64'));

  return { wrote: 'C:/hiraya/extract_compare.png', ok: true };
}
