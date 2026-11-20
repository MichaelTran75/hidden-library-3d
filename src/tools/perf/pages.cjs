// node pages.cjs HH:MM URL...: a frame's GPU time in the home and low views of each page (two builds side by side), taken in turn three
// times (medians of 40; a stalled take left out). PLAYWRIGHT: the module's path, if it is not installed here.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [AT, ...URLS] = process.argv.slice(2);
(async () => {
  const res = {};
  for (let rep = 0; rep < 3; rep++) for (const URL of URLS) {
    const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
    const page = await (await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2, timezoneId: 'Australia/Sydney' })).newPage();
    await page.goto(URL + '?at=' + AT, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__lib3d && __lib3d.ISS && __lib3d.ISS.ok && performance.getEntriesByName('l3-precompiled').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 120000, polling: 200 });
    await page.waitForTimeout(2000);
    const measure = () => page.evaluate(() => { const L = __lib3d, gl = L.renderer.getContext(), px = new Uint8Array(4); if (L.state().scale !== 0.8) { L.setRtScale(0.8); L.resize(); }
      const one = () => { L.draw(); L.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      for (let i = 0; i < 6; i++) one(); const ts = []; for (let i = 0; i < 40; i++) { const t = performance.now(); one(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return +ts[20].toFixed(1); });
    const k = URL.split('/').filter(Boolean).pop(); res[k] = res[k] || { home: [], low: [] };
    await page.evaluate(() => { __lib3d.goView(__lib3d.homeView(), 0.01); }); await page.waitForTimeout(3500); let v = await measure(); if (v > 8) res[k].home.push(v);
    await page.evaluate(() => { __lib3d.LIFT.to = __lib3d.LIFT.max; }); await page.waitForTimeout(3500); v = await measure(); if (v > 8) res[k].low.push(v);
    await browser.close();
  }
  for (const k in res) console.log(k.padEnd(8), 'home', res[k].home.join(' '), '| low', res[k].low.join(' '));
})();
