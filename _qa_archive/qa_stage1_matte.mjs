/**
 * Verify STAGE 1 now emits BOTH products: the framed card AND the bare matte.
 * The matte must be transparent, trimmed tight, and free of frame/wordmark.
 */
export default async function run(page) {
  return await page.evaluate(async () => {
    const mod = await import('/src/utils/garmentCompositor.js');

    // A synthetic "admin upload": a solid garment shape on a light backdrop.
    const cv = document.createElement('canvas');
    cv.width = 800; cv.height = 900;
    const g = cv.getContext('2d');
    g.fillStyle = '#d9d4c8'; g.fillRect(0, 0, 800, 900);       // backdrop
    g.fillStyle = '#0b3d2e';                                    // garment
    g.beginPath();
    g.moveTo(400, 150); g.lineTo(250, 260); g.lineTo(290, 520);
    g.lineTo(230, 850); g.lineTo(570, 850); g.lineTo(510, 520);
    g.lineTo(550, 260); g.closePath(); g.fill();
    // a caption to prove the matte has no chance to carry it (framed card may)
    g.fillStyle = '#f4f0e6'; g.font = 'bold 60px serif';
    g.fillText('Sample', 60, 110);

    const file = await new Promise((res) => cv.toBlob(res, 'image/png'));

    const t0 = performance.now();
    const result = await mod.composeGarmentOnFrame({ garmentSource: file });
    const ms = Math.round(performance.now() - t0);

    // Inspect the framed card and the matte.
    const inspect = async (blob) => {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = url; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let transparent = 0, opaque = 0;
      let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
      for (let y = 0; y < c.height; y++) {
        for (let px = 0; px < c.width; px++) {
          const a = d[(y * c.width + px) * 4 + 3];
          if (a < 24) transparent++;
          else {
            opaque++;
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      URL.revokeObjectURL(url);
      return {
        size: `${c.width}x${c.height}`,
        transparentPct: Math.round((transparent / (c.width * c.height)) * 100),
        opaquePct: Math.round((opaque / (c.width * c.height)) * 100),
        contentBox: maxX < 0 ? null : `${minX},${minY} ${maxX - minX + 1}x${maxY - minY + 1}`,
        touchesEdge: minX === 0 || minY === 0 || maxX === c.width - 1 || maxY === c.height - 1,
      };
    };

    return {
      ms,
      framedCard: await inspect(result.blob),
      matte: await inspect(result.matte),
      hasBoth: !!(result.blob && result.matte),
      matteUrlIsBlob: typeof result.matteUrl === 'string' && result.matteUrl.startsWith('blob:'),
    };
  });
}
