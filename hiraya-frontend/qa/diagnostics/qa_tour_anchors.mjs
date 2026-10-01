import fs from 'node:fs';
import path from 'node:path';

/*
 * Verifies that every `element:` selector in src/lib/tourSteps.js actually
 * matches a `data-tour="..."` attribute somewhere in src/ — the exact failure
 * mode that made the old Home tour silently skip its "browse" step.
 *
 * Run: node qa/diagnostics/qa_tour_anchors.mjs
 */
const SRC = path.resolve('src');

const stepsSrc = fs.readFileSync(path.join(SRC, 'lib/tourSteps.js'), 'utf8');

const selectors = [...stepsSrc.matchAll(/element:\s*'\[data-tour="([^"]+)"\]'/g)].map((m) => m[1]);

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx|js|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
};

const files = walk(SRC);
const source = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const declared = new Set([...source.matchAll(/data-tour="([^"]+)"/g)].map((m) => m[1]));

const missing = selectors.filter((s) => !declared.has(s));
const unused = [...declared].filter(
  (d) => !selectors.includes(d) && d !== 'tour-launcher'
);

console.log(`selectors in tourSteps.js : ${selectors.length}`);
console.log(`data-tour anchors in src/ : ${declared.size}`);
console.log(`\nMISSING (tour points at nothing): ${missing.length ? missing.join(', ') : 'none'}`);
console.log(`UNUSED  (anchor no tour uses)   : ${unused.length ? unused.join(', ') : 'none'}`);

process.exit(missing.length ? 1 : 0);
