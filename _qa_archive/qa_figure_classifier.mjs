/**
 * FIGURE-CLASSIFIER FIXTURE TEST
 * ==============================
 *
 * The figure-shape classifier in bodyGeometry decides whether a portrait has
 * LEGS, and that verdict CLAMPS garment hems. So it has to be proven in BOTH
 * directions:
 *
 *   - a STANDING FULL FIGURE must report `hasLegs: true`, or every legitimate
 *     full-length render gets truncated (a false negative is a regression);
 *   - a BUST CROP and a MANNEQUIN STAND must report `hasLegs: false`, or the
 *     original "dress runs 17% past the bottom of the frame" bug comes back.
 *
 * The mannequin-stand case is the one that broke the first attempt at this
 * classifier: a stand's pole is a narrow column that runs far below the hips, so
 * a test that only asked "is there a lower envelope?" answered yes to a pole.
 *
 * It draws three silhouettes with known shapes, asserts the classifier on each,
 * and additionally asserts that a dress box on a non-figure actually ENDS INSIDE
 * THE FRAME.
 *
 * A CONSTRAINT CHECK (`kind: 'constraints'`), so a regression fails CI.
 */

/*
 * THE PAGE-SIDE SCRIPT.
 *
 * A single source string rather than a serialised function: the launcher's
 * `evaluate` runs an expression, and this needs to `await import()` the real
 * geometry module. Keeping it as one string leaves that setup visible in a
 * single place.
 */
const SCRIPT = `(async () => {
  const geo = await import('/src/utils/bodyGeometry.js');

  /** Draw a silhouette from a per-row description, centred, alpha only. */
  const drawSilhouette = (W, H, spec) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#c9a58a';
    for (let y = 0; y < H; y++) {
      const row = spec(y / H);
      if (!row) continue;
      if (Array.isArray(row)) {
        // [leftWidth, gap, rightWidth] — a two-limb row.
        const lw = row[0], gap = row[1], rw = row[2];
        const total = lw + gap + rw;
        const x0 = Math.round((W - total) / 2);
        g.fillRect(x0, y, lw, 1);
        g.fillRect(x0 + lw + gap, y, rw, 1);
      } else {
        g.fillRect(Math.round((W - row) / 2), y, row, 1);
      }
    }
    return cv;
  };

  const CASES = [
    {
      name: 'standing full figure',
      expectLegs: true,
      W: 300, H: 600,
      spec: (f) => {
        if (f < 0.06) return 20;                 // head
        if (f < 0.11) return 12;                 // neck
        if (f < 0.30) return 96;                 // shoulders
        if (f < 0.50) return 80;                 // torso
        if (f < 0.56) return 74;                 // hips
        if (f < 0.97) return [26, 16, 26];       // LEGS: two columns + gap
        return 30;                               // feet
      },
    },
    {
      name: 'mannequin on a stand',
      expectLegs: false,
      W: 300, H: 600,
      spec: (f) => {
        if (f < 0.06) return 20;
        if (f < 0.11) return 12;
        if (f < 0.32) return 96;
        if (f < 0.52) return 70;
        if (f < 0.95) return 10;                 // POLE: one narrow column
        return 40;                               // base
      },
    },
    {
      name: 'head-and-shoulders bust',
      expectLegs: false,
      W: 300, H: 300,
      spec: (f) => {
        if (f < 0.12) return 20;
        if (f < 0.22) return 12;
        if (f < 0.60) return 96;
        return Math.max(6, Math.round(96 * (1 - (f - 0.6) / 0.4)));
      },
    },
  ];

  const classify = (c) =>
    new Promise((resolve) => {
      const cv = drawSilhouette(c.W, c.H, c.spec);
      const img = new Image();
      img.onload = () => {
        const sil = geo.measureSilhouette(img);
        if (!sil) return resolve({ name: c.name, expectLegs: c.expectLegs, fatal: 'measureSilhouette returned null' });
        const metrics = geo.resolveMeasurements({ chest_bust: 110, waist: 102, hips: 107, shoulder_width: 55, sleeve_length: 71 });
        const frame = geo.buildBodyFrame(sil, img.width, img.height);
        const scale = geo.derivePixelScale(frame, metrics.shoulder_width, img.height);
        const dress = geo.resolveGarmentBox('dress', frame, metrics, scale, img.width, img.height, null);
        resolve({
          name: c.name,
          expectLegs: c.expectLegs,
          hasLegs: sil.hasLegs,
          figureShape: sil.figureShape,
          dressBottomFraction: dress ? +((dress.top + dress.height) / img.height).toFixed(4) : null,
          shortenedByBust: dress ? dress.shortenedByBust : null,
        });
      };
      img.onerror = () => resolve({ name: c.name, expectLegs: c.expectLegs, fatal: 'image decode failed' });
      img.src = cv.toDataURL('image/png');
    });

  const results = [];
  for (const c of CASES) results.push(await classify(c));
  return { fatal: null, cases: results };
})()`;

export default async function run(page) {
  const raw = await page
    .evaluate(SCRIPT)
    .catch((e) => ({ fatal: 'evaluate failed: ' + (e?.message || String(e)) }));

  if (raw.fatal) {
    const checks = [{ id: 0, name: 'figure classifier', verdict: 'FAIL', why: raw.fatal }];
    return {
      kind: 'constraints',
      ok: false,
      passed: 0,
      failed: 1,
      skipped: 0,
      checks,
      report: '\n  FIGURE-CLASSIFIER FIXTURE TEST\n  ' + '='.repeat(58) + '\n  FATAL: ' + raw.fatal + '\n',
    };
  }

  const checks = raw.cases.map((c, i) => {
    const legsOk = c.hasLegs === c.expectLegs;
    // A non-figure must never produce a garment drawn past the frame bottom.
    const insideFrame = c.expectLegs ? true : c.dressBottomFraction !== null && c.dressBottomFraction <= 1.0;
    const ok = legsOk && insideFrame;
    return {
      id: i + 1,
      name: c.name,
      verdict: ok ? 'pass' : 'FAIL',
      detail: {
        hasLegs: c.hasLegs,
        expected: c.expectLegs,
        splitRatio: c.figureShape ? c.figureShape.splitRatio : null,
        bestSplitWidth: c.figureShape ? c.figureShape.bestSplitWidth : null,
        widestBodyWidth: c.figureShape ? c.figureShape.widestBodyWidth : null,
        lowerExtent: c.figureShape ? c.figureShape.lowerExtent : null,
        dressBottomFraction: c.dressBottomFraction,
        shortenedByBust: c.shortenedByBust,
      },
      why: !legsOk
        ? 'classifier said hasLegs=' + c.hasLegs + ', expected ' + c.expectLegs
        : !insideFrame
          ? 'garment bottom at ' + c.dressBottomFraction + ' of frame — drawn past the subject'
          : null,
    };
  });

  const failures = checks.filter((c) => c.verdict === 'FAIL');
  const lines = ['', '  FIGURE-CLASSIFIER FIXTURE TEST', '  ' + '='.repeat(58)];
  for (const c of checks) {
    lines.push('  [' + (c.verdict === 'pass' ? 'PASS' : 'FAIL') + '] ' + c.id + '. ' + c.name);
    for (const entry of Object.entries(c.detail)) lines.push('         ' + entry[0] + ': ' + entry[1]);
    if (c.why) lines.push('         -> ' + c.why);
  }
  lines.push('  ' + '-'.repeat(58));
  lines.push('  ' + (checks.length - failures.length) + ' passed · ' + failures.length + ' failed');
  lines.push('');

  return {
    kind: 'constraints',
    ok: failures.length === 0,
    passed: checks.length - failures.length,
    failed: failures.length,
    skipped: 0,
    checks,
    report: lines.join('\n'),
  };
}
