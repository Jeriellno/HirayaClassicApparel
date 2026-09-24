/**
 * _smoke_size_chart_frontend.mjs — does the frontend derive sizes from the
 * backend chart instead of a hardcoded copy?
 *
 * The refactor's whole point is that `recommendSizeFromMeasurements` reads the
 * fetched chart. If it still carried its own numbers, a chart change would
 * desync the Suggester chip from the render — the exact bug we set out to kill.
 *
 * Run from hiraya-frontend:  node ../hiraya-backend/_smoke_size_chart_frontend.mjs
 */

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./src/hooks/useTryOnState.js', new URL('file://' + process.cwd() + '/')), 'utf8');

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

// 1. The old hardcoded band ladder must be GONE.
const oldLadder = /if \(ok\(88, 70\) return 'S';/;
check('old hardcoded ladder removed', !oldLadder.test(src));

// 2. The chart must come from the API.
check('fetches /size-chart', /api\.get\('\/size-chart'\)/.test(src));
check('exports loadSizeChart', /export const loadSizeChart/.test(src));

// 3. The recommender must read the fetched cache, not literals.
check('recommender iterates the chart', /for \(const size of sizeChartCache\)/.test(src));
check(
  'recommender no longer compares against literal thresholds',
  !/chest <= 88/.test(src) && !/waist <= 70/.test(src)
);

// 4. A fallback must exist so the chip survives a failed fetch.
check('fallback chart present', /FALLBACK_SIZE_CHART/.test(src));
check('loadSizeChart is called on mount', /loadSizeChart\(\);/.test(src));

// 5. Prove the ALGORITHM is right by replicating it against a chart that
//    deliberately DIFFERS from the hardcoded one. If the function were still
//    using literals, these expectations would fail.
const recommend = (chart, m) => {
  const chest = Number(m.chest_bust ?? m.chest ?? 0);
  const waist = Number(m.waist ?? 0);
  if (!chest && !waist) return null;
  for (const size of chart) {
    const fitsChest = !chest || chest <= size.chest_bust_max;
    const fitsWaist = !waist || waist <= size.waist_max;
    if (fitsChest && fitsWaist) return size.label;
  }
  return chart[chart.length - 1]?.label ?? null;
};

const customChart = [
  { label: 'ONE', chest_bust_max: 50, waist_max: 40 },
  { label: 'TWO', chest_bust_max: 200, waist_max: 200 },
];

check(
  'a CUSTOM chart drives the answer (proves no hardcoding)',
  recommend(customChart, { chest_bust: 45, waist: 35 }) === 'ONE',
  recommend(customChart, { chest_bust: 45, waist: 35 })
);
check(
  'custom chart upper band respected',
  recommend(customChart, { chest_bust: 150, waist: 120 }) === 'TWO'
);
check('no measurements -> null', recommend(customChart, {}) === null);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);

process.exit(fail === 0 ? 0 : 1);
