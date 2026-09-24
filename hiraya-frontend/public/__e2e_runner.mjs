export default async function run(page, ui) {
  // Run the REAL composite engine in the page, using the customer's actual
  // uploaded photo and a REAL catalog garment image, then screenshot the output.
  const result = await page.evaluate(async () => {
    const { compositeTryOn } = await import('/src/utils/compositeTryOn.js');

    // 1. The customer's uploaded photo (transparent-background mannequin).
    const portrait = new Image();
    portrait.src = '/_dbg_upload.webp';
    await portrait.decode();

    // 2. A REAL catalog garment from the database.
    const garmentUrl =
      'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public/products/catalog/1789553972085-ktdnmgj.png';
    const garment = new Image();
    garment.src = garmentUrl;

    const out = await compositeTryOn({
      portrait: portrait.src,
      garments: {
        dress: { name: 'Beige Off-Shoulder A-Line Dress', display_image_url: garmentUrl, image_url: garmentUrl },
      },
      measurements: { chest_bust: 90, waist: 75, hips: 96, shoulder_width: 40, sleeve_length: 60 },
      watermark: 'TEST',
    });

    return {
      hasImage: !!out.image,
      len: out.image ? out.image.length : 0,
      placed: out.placed,
      diag: {
        poseRead: out.diagnostics.poseRead,
        posture: out.diagnostics.posture,
        bent: out.diagnostics.bent,
        occlusionReady: out.diagnostics.occlusionReady,
        fittedTo: out.diagnostics.fittedTo,
        cutouts: out.diagnostics.cutouts,
        cutoutFallbacks: out.diagnostics.cutoutFallbacks,
        skipped: out.diagnostics.skipped,
      },
      image: out.image,
    };
  });

  // Render the output into the page for the screenshot.
  const has = await page.evaluate(async (dataUri) => {
    if (!dataUri) return false;
    const img = new Image();
    img.src = dataUri;
    await img.decode();
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    document.body.style.background = '#111';
    img.style.width = '100%';
    img.style.display = 'block';
    document.body.appendChild(img);
    return true;
  }, result.image);

  return { ...result, image: undefined, renderedForShot: has };
}
