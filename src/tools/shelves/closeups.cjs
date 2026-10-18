// usage: node tools/shelves/closeups.cjs <prefix> [HH:MM] [url]: writes <prefix>-research/books/psych/econ.jpg here (a dev build served, e.g. on 8799)
// close-ups: the Research view, the Books view, one section of each, at a given hour; screenshots
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
const OUT = process.argv[2] || 'cu', AT = process.argv[3] || '13:00', URL = process.argv[4] || 'http://127.0.0.1:8799/';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 2056, height: 1540 }, deviceScaleFactor: 1, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL + '?at=' + AT, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__lib3d && __lib3d.ISS && __lib3d.ISS.ok && performance.getEntriesByName('l3-precompiled').length, null, { timeout: 120000, polling: 200 });
  const shot = async (n, f) => { await page.evaluate(f); await page.waitForTimeout(3500); await page.screenshot({ path: `${OUT}-${n}.jpg`, type: 'jpeg', quality: 85 }); };
  await shot('research', () => document.querySelector('.toc [data-goto="research"]').click());
  await shot('books', () => document.querySelector('.toc [data-goto="books"]').click());
  await shot('psych', () => { const L = __lib3d; L.openSection(L.UIS.secs.find(s => (s.en || '').startsWith('Psychology'))); });
  await shot('econ', () => { const L = __lib3d; L.openSection(L.UIS.secs.find(s => (s.en || '') === 'Economy')); });
  console.log(errs.length ? errs.join('\n') : 'no errors'); await browser.close();
})();
