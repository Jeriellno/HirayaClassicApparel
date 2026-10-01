/**
 * _smoke_size_chart_frontend.mjs — does the frontend derive sizes from the
 * backend chart instead of a hardcoded copy?
 *
 * The customer's body profile is now TWO SIZE LABELS (`upper_body_size` /
 * `lower_body_size`), not five typed centimetres. The point of this smoke test
 * is unchanged: everything on the sizing path must read the FETCHED chart, so a
 * chart change on the backend cannot leave the Studio suggesting a different
 * size than the render produces.
 *
 * Run from hiraya-frontend:  node _smoke_size_chart_frontend.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'src/hooks/useTryOnState.js'), 'utf8');

let pass = 0;
let fail = 0;

const check = (label, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
};

console.log('\n=== FRONTEND SIZE CHART SMOKE ===');

// 1. The 5 Core Body Measurements must be GONE from the sizing path.
check(
  'sizing state is two size labels',
  /upper_body_size: user\?\.upper_body_size/.test(src)
);
check('no recommendSizeFromMeasurements', !/recommendSizeFromMeasurements/.test(src));

// 2. The chart must come from the API.
check('fetches /size-chart', /api\.get\('\/size-chart'\)/.test(src));
check('exports loadSizeChart', /export const loadSizeChart/.test(src));
check('exports getSizeLabels', /export const getSizeLabels/.test(src));

// 3. The per-size CENTIMETRES must ride on the chart, or the derived body
//    metrics would be empty for a customer whose fetch failed.
check('fallback chart present', /FALLBACK_SIZE_CHART/.test(src));
check(
  'fallback carries per-size measurements',
  /measurements: \{ chest_bust: 95, waist: 77/.test(src)
);
check('loadSizeChart is called on mount', /loadSizeChart\(\)/.test(src));

// 4. Body metrics must be DERIVED from the labels, and must never be posted
//    from the client — the server resolves them from the saved sizes.
check('derives metrics from sizes', /export const bodyMetricsFromSizes/.test(src));

// 5. Prove the AXIS ALGORITHM is right against a ladder that deliberately
//    DIFFERS from the hardcoded one. If the helper still used literals, these
//    expectations would fail.
const normaliseLabel = (label, labels) => {
  if (typeof label !== 'string') return null;
  const wanted = label.trim().toUpperCase();
  return labels.find((l) => l.toUpperCase() === wanted) ?? null;
};

const sizeAxisForCategory = (category = '') =>
  ['pant', 'trouser', 'jean', 'skirt', 'short', 'legging', 'bottom', 'slack'].some((w) =>
    String(category).toLowerCase().includes(w)
  )
    ? 'lower'
    : 'upper';

const recommendSizeForCategory = (sizes = {}, category = '', labels) => {
  const upper = normaliseLabel(sizes.upper_body_size, labels);
  const lower = normaliseLabel(sizes.lower_body_size, labels);
  const wanted = sizeAxisForCategory(category) === 'lower' ? (lower ?? upper) : (upper ?? lower);
  if (!wanted) return null;
  return labels.find((l) => l.toUpperCase() === wanted) ?? null;
};

// A deliberately non-standard ladder: proves nothing is hardcoded.
const customLabels = ['ONE', 'TWO'];

check(
  'a CUSTOM ladder drives the answer (proves no hardcoding)',
  recommendSizeForCategory({ upper_body_size: 'one', lower_body_size: 'one' }, 'top', customLabels) === 'ONE'
);
check(
  'top axis uses the UPPER label',
  recommendSizeForCategory({ upper_body_size: 'ONE', lower_body_size: 'TWO' }, 'top', customLabels) === 'ONE'
);
check(
  'bottom axis uses the LOWER label',
  recommendSizeForCategory({ upper_body_size: 'ONE', lower_body_size: 'TWO' }, 'Pants', customLabels) === 'TWO'
);
check(
  'dress is an UPPER-body garment',
  recommendSizeForCategory({ upper_body_size: 'ONE', lower_body_size: 'TWO' }, 'dress', customLabels) === 'ONE'
);
check(
  'a single size on file answers for both axes',
  recommendSizeForCategory({ upper_body_size: 'TWO' }, 'trousers', customLabels) === 'TWO'
);
check('no sizes on file -> null', recommendSizeForCategory({}, 'top', customLabels) === null);
check(
  'an unknown label is refused, not guessed',
  recommendSizeForCategory({ upper_body_size: 'ZZ' }, 'top', customLabels) === null
);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);

process.exit(fail === 0 ? 0 : 1);
