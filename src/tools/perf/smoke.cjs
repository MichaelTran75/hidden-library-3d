// desktop: room shows, no errors, module fetched once; phone: module and lib.glb never fetched
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
(async () => {
  const url = process.argv[2], browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  for (const [name, vp] of [['desktop', { width: 1512, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport: vp, deviceScaleFactor: 2 })).newPage();
    const errs = [], reqs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
    page.on('request', r => reqs.push(r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 60)));
    const t0 = Date.now(); await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    if (name === 'desktop') { await page.waitForFunction(() => document.body.classList.contains('lib3d-on'), null, { timeout: 120000, polling: 100 }); console.log('room shown after', Date.now() - t0, 'ms'); }
    else await page.waitForTimeout(4000);
    const st = await page.evaluate(() => ({ cls: document.documentElement.className, on: document.body.classList.contains('lib3d-on'), cards: document.querySelectorAll('.page').length }));
    console.log(name, JSON.stringify(st), '| lib3d.js requests:', reqs.filter(u => u.includes('lib3d.js')).length, '| lib.glb:', reqs.filter(u => u.includes('lib.glb')).length, '| three:', reqs.filter(u => u.includes('three')).length, '| errors:', errs.join(' / ') || 'none');
    await page.close();
  }
  await browser.close();
})();
