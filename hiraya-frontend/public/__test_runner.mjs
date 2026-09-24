export default async function run(page, ui) {
  // Capture any uncaught errors the module throws.
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  // Wait for the harness to publish its result.
  try {
    await page.waitForFunction(() => !!window.__TEST_RESULT__, { timeout: 25000 });
  } catch {
    return {
      ok: false,
      reason: 'result never published',
      preText: await page.evaluate(() => document.getElementById('out')?.innerText),
      errors,
    };
  }

  const result = await page.evaluate(() => window.__TEST_RESULT__);
  return { ok: !result.error, result, errors };
}
