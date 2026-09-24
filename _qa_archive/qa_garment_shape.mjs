/**
 * GARMENT SHAPE DUMP
 * ==================
 *
 * Runs the constraint validator's own analysis and prints the ISOLATED garment
 * mask's per-row width, so constraint 3's verdict can be read against the real
 * shape. This matters because the mask is built from a base-vs-render diff that
 * has to survive the compositor's vignette, watermark and occlusion passes — if
 * those leak in, the profile is meaningless and the check reports a misleading
 * `skipped`.
 *
 * A DIAGNOSTIC — no `kind`, so the launcher reports NO VERDICT.
 */
import { ANALYSE, T } from './qa_tryon_constraints.mjs';

export default async function run(page, ui = {}) {
  const raw = await page
    .evaluate(ANALYSE, { thresholds: T, portrait: ui.portraitDataUri || null, profileOnly: false })
    .catch((e) => ({ fatal: 'evaluate failed: ' + (e?.message || String(e)) }));

  if (raw.fatal) {
    console.log('\n  GARMENT SHAPE DUMP — ' + raw.fatal + '\n');
    return { ok: false, fatal: raw.fatal };
  }

  const g = raw.geometry;
  const widths = g.garmentRowWidths || [];
  const nonZero = widths.filter((w) => w > 0);

  console.log('\n  GARMENT SHAPE DUMP');
  console.log('  ' + '='.repeat(62));
  console.log(`  garment rows   ${g.garmentTop}..${g.garmentBottom}   (${nonZero.length} occupied)`);
  console.log(`  body rows      ${g.bodyTop}..${g.bodyBottom}   shoulder@${g.shoulderRow}`);
  console.log(`  width range    min ${Math.min(...nonZero)}  max ${Math.max(...nonZero)}`);
  console.log('  ' + '-'.repeat(62));
  console.log('    row   width');
  const step = Math.max(1, Math.floor(widths.length / 30));
  for (let i = 0; i < widths.length; i += step) {
    console.log(`    ${String(g.garmentTop + i).padStart(4)}   ${String(widths[i]).padStart(5)}  ${'#'.repeat(Math.min(60, Math.round(widths[i] / 3)))}`);
  }
  console.log('  ' + '-'.repeat(62));

  const mean = nonZero.reduce((s, v) => s + v, 0) / (nonZero.length || 1);
  const variance = nonZero.reduce((s, v) => s + (v - mean) ** 2, 0) / (nonZero.length || 1);
  console.log(`  mean ${mean.toFixed(1)}   CV ${(Math.sqrt(variance) / mean).toFixed(4)}`);
  console.log(`  vignette-explained pixels: ${g.pixelsExplainedByVignette}`);
  console.log(`  discarded as non-garment:  ${g.nonGarmentPixelsDiscarded}`);
  console.log(`  border-excluded:           ${g.borderPixelsExcluded}`);
  console.log('');

  return { ok: true };
}
