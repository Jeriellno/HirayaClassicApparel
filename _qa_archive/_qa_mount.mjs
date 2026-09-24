// Probe what the browser actually requests/executes when loading the SPA.
export default async function run(page, ui) {
  const seen = []
  page.on('request', (r) => seen.push(['REQ', r.resourceType(), r.url()]))
  page.on('response', (r) => seen.push(['RES', r.status(), r.url()]))
  page.on('requestfailed', (r) => seen.push(['FAIL', r.url(), r.failure()?.errorText]))
  page.on('pageerror', (e) => seen.push(['PAGEERROR', String(e)]))
  page.on('console', (m) => seen.push(['CONSOLE', m.type(), m.text().slice(0, 200)]))

  // Reload so the listeners are attached before the critical requests go out.
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 40000 })
  await page.waitForTimeout(90000)

  const state = await page.evaluate(() => ({
    readyState: document.readyState,
    scriptCount: document.querySelectorAll('script').length,
    rootChildren: document.querySelector('#root')?.children.length ?? -1,
  }))

  return { state, events: seen.slice(0, 60) }
}
