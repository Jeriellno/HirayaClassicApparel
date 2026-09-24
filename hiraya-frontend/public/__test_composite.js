import { measureBodyPose } from '/src/utils/bodyPose.js';
import { compositeTryOn } from '/src/utils/compositeTryOn.js';

/**
 * COMPOSITE ENGINE TEST HARNESS.
 *
 * Loads the REAL bodyPose + compositeTryOn modules from the dev server and runs
 * them against a synthetic portrait, so the pose-aware and occlusion logic can
 * be exercised WITHOUT logging in (the /try-on studio route is behind
 * ProtectedRoute).
 *
 * The synthetic portrait is a BENT body: the torso's horizontal centre drifts
 * left as it goes down, exactly what a hunched/leaning subject produces. This is
 * the case the pose-aware warp exists to handle, so it is the case we test.
 */

/* Build a synthetic cut-out portrait: a leaning body on a TRANSPARENT field, so
 * the alpha silhouette is readable (an opaque JPlet would bail to the estimated
 * frame and prove nothing about the posture path). */
const buildBentPortrait = (w = 600, h = 900) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  // Head
  ctx.fillStyle = '#8a6f5a';
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.1, w * 0.06, 0, Math.PI * 2);
  ctx.fill();

  // BENT torso: each row's centre moves LEFT as we go down (a lean/hunch).
  ctx.fillStyle = '#111';
  for (let y = Math.round(h * 0.16); y < Math.round(h * 0.62); y++) {
    const t = (y - h * 0.16) / (h * 0.46);
    const cx = w * 0.55 - t * w * 0.14;      // drifts from 55% to 41%
    const halfWidth = w * 0.11;
    ctx.fillRect(cx - halfWidth, y, halfWidth * 2, 1);
  }

  // Legs (straight, so the bend is in the torso specifically)
  ctx.fillRect(w * 0.38, h * 0.62, w * 0.07, h * 0.34);
  ctx.fillRect(w * 0.45, h * 0.62, w * 0.07, h * 0.34);

  return c;
};

/* Build a garment cut-out: a simple flat-lay top on transparency. */
const buildGarment = (w = 400, h = 500) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#2e7d5b';
  // Shoulders + bodice + sleeves
  ctx.fillRect(w * 0.18, h * 0.12, w * 0.64, h * 0.5);
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.12, w * 0.32, h * 0.06, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  return c;
};

const canvasToDataURI = (canvas) => canvas.toDataURL('image/png');

const run = async () => {
  const results = { steps: [] };

  // 1. The synthetic bent portrait -> an <img> the modules can read.
  const portraitCanvas = buildBentPortrait();
  const portraitImg = new Image();
  portraitImg.src = canvasToDataURI(portraitCanvas);
  await portraitImg.decode();

  // 2. Pose module directly.
  const pose = measureBodyPose(portraitImg);
  results.pose = {
    available: pose?.available,
    bent: pose?.bent,
    posture: pose?.posture,
    tiltRadians: pose?.tiltRadians,
    leanDirection: pose?.leanDirection,
    // Spine centre at the top vs bottom of the torso — must DIFFER for a bend.
    spineAtShoulder: pose?.spineX ? Math.round(pose.spineX(900 * 0.20)) : null,
    spineAtHip: pose?.spineX ? Math.round(pose.spineX(900 * 0.55)) : null,
  };

  // 3. The garment as a data URI the compositor accepts.
  const garmentImg = new Image();
  garmentImg.src = canvasToDataURI(buildGarment());
  await garmentImg.decode();

  // 4. Full composite.
  const out = await compositeTryOn({
    portrait: canvasToDataURI(portraitCanvas),
    garments: {
      top: { name: 'Test Top', image_url: garmentImg.src, display_image_url: garmentImg.src },
    },
    measurements: { chest_bust: 94, waist: 76, hips: 100, shoulder_width: 41, sleeve_length: 61 },
    watermark: 'TEST',
  });

  results.composite = {
    hasImage: !!out.image,
    imageLength: out.image ? out.image.length : 0,
    placed: out.placed,
    diagnostics: out.diagnostics,
  };

  window.__TEST_RESULT__ = results;
  return results;
};

run().catch((e) => {
  window.__TEST_RESULT__ = { error: String(e && e.stack ? e.stack : e) };
});
