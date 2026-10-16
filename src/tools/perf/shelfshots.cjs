// node shelfshots.cjs URL outPrefix : views of the tall shelf's decor rows (day and night), console errors, decor count
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
(async () => {
  const [url, out] = process.argv.slice(2);
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errs = []; page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 200)); }); page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  for (const at of ['15:00', '20:00']) {
    await page.goto(url + '?at=' + at, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__lib3d && window.__lib3d.state().ready && !window.__lib3d.state().hold && document.body.classList.contains('lib3d-on'), null, { timeout: 120000, polling: 200 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => ({ cells: __lib3d.DECOR.length, used: __lib3d.DECOR.used, calls: __lib3d.renderer.info.render.calls, tris: __lib3d.renderer.info.render.triangles, programs: __lib3d.renderer.info.programs.length }));
    console.log(at, JSON.stringify(info));
    const views = [[0.6, 3.0, -3.2, 2.28, 2.95, -6.6, 40], [0.6, 3.0, -1.0, 2.28, 2.95, -3.6, 40], [0.6, 3.0, 1.2, 2.28, 2.95, -1.0, 40], [0.9, 3.0, -5.6, 2.28, 2.95, -8.4, 40]];
    for (let i = 0; i < views.length; i++) {
      await page.evaluate(v => { const L = __lib3d, V = L.camera.position.constructor; L.goView({ pos: new V(v[0], v[1], v[2]), tgt: new V(v[3], v[4], v[5]), fov: v[6], shift: 0 }, 0.05); }, views[i]);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}_${at.replace(':', '')}_${i}.png` });
    }
  }
  console.log(errs.slice(0, 20).join('\n') || 'no errors');
  await browser.close();
})();
