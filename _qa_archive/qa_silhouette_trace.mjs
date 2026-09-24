/**
 * SILHOUETTE TRACE
 * ================
 *
 * Answers ONE question with evidence: on a REAL portrait, where does the engine
 * think the shoulders are, and is that right?
 *
 * The composite render anchors the dress low. `measureSilhouette()` picks the
 * shoulder line as "the widest row in the upper 40% of the figure", so a body
 * part that is wider than the shoulders and sits in that window will be mistaken
 * for them. This dumps the raw per-row envelope so we can SEE which row wins and
 * why, instead of guessing.
 */
import { writeFileSync } from 'node:fs';

export default async function run(page, ui = {}) {
  const out = await page.evaluate(async (portraitDataUri) => {
    const geo = await import('/src/utils/bodyGeometry.js');

    const load = (src) =>
      new Promise((r) => {
        const i = new Image();
        if (typeof src === 'string' && !src.startsWith('data:')) i.crossOrigin = 'anonymous';
        i.onload = () => r(i);
        i.onerror = () => r(null);
        i.src = src;
      });

    const img = await load(portraitDataUri);
    if (!img) return { fatal: 'could not load portrait' };

    const sil = geo.measureSilhouette(img);
    if (!sil) return { fatal: 'measureSilhouette returned null (no readable alpha silhouette)', w: img.width, h: img.height };

    /* --- rebuild the same scan the geometry uses, so we can see every row --- */
    const SCAN = 220;
    const scanW = SCAN;
    const scanH = Math.max(1, Math.round(SCAN * (img.height / img.width)));

    const probe = document.createElement('canvas');
    probe.width = scanW;
    probe.height = scanH;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, scanW, scanH);
    const { data } = ctx.getImageData(0, 0, scanW, scanH);

    const rows = [];
    for (let y = 0; y < scanH; y++) {
      let minX = -1;
      let maxX = -1;
      for (let x = 0; x < scanW; x++) {
        if (data[(y * scanW + x) * 4 + 3] > 200) {
          if (minX === -1) minX = x;
          maxX = x;
        }
      }
      rows.push(minX === -1 ? null : { minX, maxX, width: maxX - minX + 1 });
    }

    const topRow = rows.findIndex(Boolean);
    let bottomRow = scanH - 1;
    while (bottomRow > 0 && !rows[bottomRow]) bottomRow--;
    const bodyHeightFraction = (bottomRow - topRow) / scanH;
    const upperLimit = Math.round(topRow + bodyHeightFraction * scanH * 0.4);

    /* Per-row profile as a compact map: row, % of body height, width, centre. */
    const profile = [];
    for (let y = topRow; y <= bottomRow; y++) {
      const r = rows[y];
      const pctBody = ((y - topRow) / (bottomRow - topRow)) * 100;
      profile.push({
        y,
        pctBody: +pctBody.toFixed(1),
        width: r ? r.width : 0,
        centreX: r ? Math.round((r.minX + r.maxX) / 2) : null,
        inShoulderWindow: y <= upperLimit,
        // Mirrors bodyGeometry: the widest row AT OR ABOVE this one.
        isRunningMax: r ? r.width >= Math.max(...rows.slice(topRow, y + 1).filter(Boolean).map((q) => q.width)) : false,
      });
    }

    const widestInWindow = profile.filter((p) => p.inShoulderWindow).reduce((a, b) => (b.width > a.width ? b : a), { width: -1 });
    const widestOverall = profile.reduce((a, b) => (b.width > a.width ? b : a), { width: -1 });

    /* --- what the engine then does with it --- */
    const frame = geo.buildBodyFrame(sil, img.width, img.height);
    const metrics = geo.resolveMeasurements({ chest_bust: 110, waist: 102, hips: 107, shoulder_width: 55, sleeve_length: 71 });
    const scale = geo.derivePixelScale(frame, metrics.shoulder_width, img.height);
    const dressBox = geo.resolveGarmentBox('dress', frame, metrics, scale, img.width, img.height, null);

    return {
      fatal: null,
      image: { w: img.width, h: img.height },
      scan: { scanW, scanH, topRow, bottomRow, bodyHeightFraction: +bodyHeightFraction.toFixed(4), upperLimit },
      silhouette: {
        bodyTop: +sil.bodyTop.toFixed(4),
        bodyBottom: +sil.bodyBottom.toFixed(4),
        bodyHeightFraction: +sil.bodyHeightFraction.toFixed(4),
        shoulderFraction: +sil.shoulderFraction.toFixed(4),
        shoulderY_px: Math.round(sil.shoulderFraction * img.height),
        shoulderPaPx: Math.round(sil.shoulderPx),
        torsoCentreX: Math.round(sil.torsoCentreX),
        hasLegs: sil.hasLegs,
        subjectBottom: +sil.subjectBottom.toFixed(4),
        figureShape: sil.figureShape,
      },
      shoulderRowChosen: Math.round(sil.shoulderFraction * scanH),
      widestInWindow,
      widestOverall,
      profile,
      frame: {
        isEstimated: frame.isEstimated,
        shoulderFraction: +frame.shoulderFraction.toFixed(4),
        shoulderY_px: Math.round(frame.shoulderFraction * img.height),
        bodyTop: +frame.bodyTop.toFixed(4),
        bodyBottom: +frame.bodyBottom.toFixed(4),
        hasLegs: frame.hasLegs,
        subjectBottom: frame.subjectBottom,
      },
      metrics,
      scale,
      dressBox: dressBox
        ? {
          left: Math.round(dressBox.left),
          top: Math.round(dressBox.top),
          width: Math.round(dressBox.width),
          height: Math.round(dressBox.height),
          centreX: Math.round(dressBox.centreX),
          topAsFrameFraction: +(dressBox.top / img.height).toFixed(4),
          bottomAsFrameFraction: +((dressBox.top + dressBox.height) / img.height).toFixed(4),
          clampedToSubject: dressBox.clampedToSubject,
          shortenedByBust: dressBox.shortenedByBust,
        }
        : null,
    };
  }, ui.portraitDataUri || null);

  if (out.fatal) {
    console.log('\n  SILHOUETTE TRACE — could not run: ' + out.fatal + '\n');
    return { ok: false, fatal: out.fatal };
  }

  const L = [];
  L.push('');
  L.push('  SILHOUETTE TRACE');
  L.push('  ' + '='.repeat(70));
  L.push(`  portrait      ${out.image.w}x${out.image.h}`);
  L.push(`  scan          ${out.scan.scanW}x${out.scan.scanH}   body rows ${out.scan.topRow}..${out.scan.bottomRow}`);
  L.push(`  shoulder win  rows ${out.scan.topRow}..${out.scan.upperLimit}  (top 40% of body)`);
  L.push('  ' + '-'.repeat(70));
  L.push('  WHAT THE SCANNER SEES');
  L.push(`    bodyTop            ${out.silhouette.bodyTop}  (row ${Math.round(out.silhouette.bodyTop * out.scan.scanH)})`);
  L.push(`    bodyBottom         ${out.silhouette.bodyBottom}`);
  L.push(`    shoulderFraction   ${out.silhouette.shoulderFraction}  -> row ${out.shoulderRowChosen}  y=${out.silhouette.shoulderY_px}px`);
  L.push(`    shoulderPx         ${out.silhouette.shoulderPaPx} px wide`);
  L.push(`    torsoCentreX       ${out.silhouette.torsoCentreX} px`);
  L.push('  ' + '-'.repeat(70));
  L.push('  WIDEST ROW CONTEST');
  L.push(`    widest IN window   row ${out.widestInWindow.y}  width ${out.widestInWindow.width}  (${out.widestInWindow.pctBody}% of body height)`);
  L.push(`    widest OVERALL     row ${out.widestOverall.y}  width ${out.widestOverall.width}  (${out.widestOverall.pctBody}% of body height)`);
  const winner = out.profile.find((p) => p.y === Math.round(out.silhouette.shoulderFraction * out.scan.scanH));
  L.push(`    chosen             row ${Math.round(out.silhouette.shoulderFraction * out.scan.scanH)}  width ${winner ? winner.width : '?'}  (${winner ? winner.pctBody : '?'}% of body height)`);
  L.push('    rule               shoulder = the FIRST row reaching 80% of the widest upper-');
  L.push('                       torso row, i.e. the TOP of the shoulder plateau.');
  /*
   * This is now a NOTE, not a warning.
   *
   * The scanner DELIBERATELY no longer picks the widest row in the window: on a
   * figure whose hips are wider than its shoulders, the widest upper-torso row is
   * a HIP row, and anchoring there hung garments from the hips. Choosing an
   * earlier, narrower row is the fix working, so reporting it as an anomaly would
   * send the reader looking for a bug that is not there.
   */
  if (winner && out.widestInWindow && winner.y !== out.widestInWindow.y) {
    L.push(`    note: the chosen row is ABOVE the widest row in the window (row ${out.widestInWindow.y}).`);
    L.push('          That is the plateau rule doing its job — the wider row was the hip flare.');
  }
  L.push('  ' + '-'.repeat(70));
  L.push('  PER-ROW ENVELOPE (width, sampled every ~2% of body height)');
  L.push('     row   %body  width  centre   in-win');
  let lastPct = -5;
  for (const p of out.profile) {
    if (p.pctBody - lastPct < 2 && p.y !== out.silhouette.shoulderFraction * out.scan.scanH) continue;
    lastPct = p.pctBody;
    const mark = p.isRunningMax ? ' <-- widest so far' : '';
    L.push(`    ${String(p.y).padStart(4)}  ${String(p.pctBody).padStart(5)}  ${String(p.width).padStart(5)}  ${String(p.centreX).padStart(6)}   ${p.inShoulderWindow ? 'yes' : 'no '}${mark}`);
  }
  L.push('  ' + '-'.repeat(70));
  L.push('  RESULTING DRESS BOX');
  if (out.dressBox) {
    L.push(`    left ${out.dressBox.left}  top ${out.dressBox.top}  w ${out.dressBox.width}  h ${out.dressBox.height}`);
    L.push(`    spans ${(out.dressBox.topAsFrameFraction * 100).toFixed(1)}% .. ${(out.dressBox.bottomAsFrameFraction * 100).toFixed(1)}% of frame height`);
    L.push(`    shoulder is at ${(out.frame.shoulderFraction * 100).toFixed(1)}% of frame height`);
  }
  L.push(`    pxPerCm ${out.scale.pxPerCm.toFixed(2)}  (source: ${out.scale.source})`);
  L.push('  ' + '-'.repeat(70));
  L.push('  FIGURE TYPE');
  const fs = out.silhouette.figureShape;
  L.push(`    hasLegs            ${out.silhouette.hasLegs}`);
  L.push(`    subjectBottom      ${(out.silhouette.subjectBottom * 100).toFixed(1)}% of frame height`);
  if (fs) {
    L.push(`    lower envelope     ${fs.lowerEnvelope}px vs widest ${fs.widestBodyWidth}px`);
    L.push(`    leg split          on ${(fs.splitRatio * 100).toFixed(1)}% of deep-lower rows, widest span ${fs.bestSplitWidth}px`);
    L.push(`    lower extent       ${(fs.lowerExtent * 100).toFixed(1)}% of frame height below the hip line`);
    L.push(`    verdict            ${fs.hasLegs ? 'FULL FIGURE' : 'BUST CROP — no leg envelope measured'}`);
  }
  if (out.dressBox) {
    if (out.dressBox.shortenedByBust) {
      L.push('    !! the dress hem was CLAMPED to the subject — the photo is not a full figure');
    } else if (out.dressBox.clampedToSubject) {
      L.push('    note: hem clamped to the subject extent');
    } else {
      L.push('    dress fits inside the figure — no clamp applied');
    }
  }
  L.push('  ' + '='.repeat(70));
  L.push('');

  console.log(L.join('\n'));

  writeFileSync('C:/hiraya/qa_silhouette_trace.json', JSON.stringify(out, null, 2));
  console.log('  full trace written to C:/hiraya/qa_silhouette_trace.json\n');

  // A DIAGNOSTIC, not a constraint check. `kind` deliberately omitted so the
  // launcher reports NO VERDICT rather than implying the fitting was validated.
  return { silhouette: out.silhouette, dressBox: out.dressBox, frame: out.frame };
}
