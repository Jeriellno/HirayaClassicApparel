import { writeFileSync } from 'node:fs';

/**
 * Compare candidate SOURCES (raw jpg vs display card) and dump their colour
 * histograms so I can design a detector that separates garment from artwork.
 */
export default async function run(page) {
  const out = await page.evaluate(async () => {
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

    const analyse = async (url, label) => {
      const dataUri = await toDataUri(url);
      const img = await load(dataUri);
      const S = 200;
      const cv = document.createElement('canvas');
      cv.width = S;
      cv.height = S;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, S, S);
      const d = cx.getImageData(0, 0, S, S).data;

      // Luma histogram in 16 buckets.
      const hist = new Array(16).fill(0);
      // Corner colours (background candidates).
      const corners = [
        [0, 0], [S - 1, 0], [0, S - 1], [S - 1, S - 1],
      ].map(([x, y]) => {
        const i = (y * S + x) * 4;
        return [d[i], d[i + 1], d[i + 2]];
      });

      let opaque = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 16) opaque++;
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        hist[Math.min(15, Math.floor(l / 16))]++;
      }

      // Central column vertical profile: where does the garment start/end?
      const col = Math.floor(S / 2);
      const profile = [];
      for (let y = 0; y < S; y += 4) {
        const i = (y * S + col) * 4;
        profile.push([y, d[i], d[i + 1], d[i + 2]]);
      }

      return {
        label,
        size: { w: img.naturalWidth, h: img.naturalHeight },
        alphaPct: Math.round((opaque / (S * S)) * 1000) / 10,
        corners,
        hist,
        centerColumn: profile.filter((_, k) => k % 3 === 0),
      };
    };

    return [
      await analyse(`${SUP}/products/catalog/1789529379424-kivp9kr.png`, 'Emerald DISPLAY card'),
      await analyse(`${SUP}/products/catalog/1789529378546-vq9blwc.jpg`, 'Emerald RAW jpg'),
      await analyse(`${SUP}/products/catalog/1789553972085-ktdnmgj.png`, 'Beige DISPLAY card'),
      await analyse(`${SUP}/products/catalog/1789553970904-kl0wdgp.jpg`, 'Beige RAW jpg'),
    ];
  });

  return out;
}
