// the unjoined ES modules, loaded as they are: errors, and the day picture against the joined build's
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
const crypto = require('crypto');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  for (const url of process.argv.slice(2)) {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })).newPage();
    const errs = [], mods = new Set(); page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
    page.on('request', r => { if (r.url().includes('/lib3d')) mods.add(r.url()); });
    await page.goto(url + '?at=15:00', { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__lib3d && __lib3d.state().ready && !__lib3d.state().hold && document.body.classList.contains('lib3d-on'), null, { timeout: 120000, polling: 100 }).catch(e => errs.push('never ready'));
    await page.waitForTimeout(2500);
    const img = await page.evaluate(() => { const L = __lib3d; L.renderer.setAnimationLoop(null); L.clock.getElapsedTime = () => 10; L.applyRefCamera(); L.draw(); return L.renderer.domElement.toDataURL('image/png'); }).catch(e => 'none');
    console.log(url, 'module files fetched', mods.size, 'picture', crypto.createHash('sha1').update(img).digest('hex').slice(0, 12), errs.length ? 'ERRORS ' + errs.join(' / ') : 'no errors');
    await page.close();
  }
  await browser.close();
})();
