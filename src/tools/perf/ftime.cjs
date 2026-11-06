// node ftime.cjs URL [HH:MM] [runs]: the GPU time of one whole frame (draw, then a 1-pixel read that waits for it), median of 40,
// in the home view, the research view, the low view, a book being read and the clock out; and the shader programs
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
const [URL, AT = '16:30'] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL + (URL.includes('?') ? '&' : '?') + 'at=' + AT, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__lib3d && __lib3d.ISS && __lib3d.ISS.ok && performance.getEntriesByName('l3-precompiled').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 120000, polling: 200 });
  await page.waitForTimeout(2000);
  const marks = await page.evaluate(() => { const g = n => { const e = performance.getEntriesByName('l3-' + n)[0]; return e ? Math.round(e.startTime) : null; }; return { firstDraw: g('first-draw'), precompiled: g('precompiled') }; });
  const measure = () => page.evaluate(() => { const L = __lib3d, gl = L.renderer.getContext(), px = new Uint8Array(4);
    if (L.state().scale !== 0.8) { L.setRtScale(0.8); L.resize(); }   // (the picture's full scale: a slow stretch in the test may have stepped it down)
    const one = () => { L.draw(); L.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    for (let i = 0; i < 6; i++) one(); const ts = []; for (let i = 0; i < 40; i++) { const t = performance.now(); one(); ts.push(performance.now() - t); }
    ts.sort((a, b) => a - b); return +ts[20].toFixed(2); });
  const out = { marks };
  await page.evaluate(() => { __lib3d.goView(__lib3d.homeView(), 0.01); }); await page.waitForTimeout(4000); out.home = await measure();
  await page.evaluate(() => { __lib3d.LIFT.to = __lib3d.LIFT.max; }); await page.waitForTimeout(4000); out.low = await measure();
  await page.evaluate(() => { __lib3d.LIFT.to = 0; document.querySelector('.toc [data-goto="research"]').click(); }); await page.waitForTimeout(4500); out.research = await measure();
  await page.evaluate(() => { const V = __lib3d.CLOCK.view; V.on = true; V.eT = 1; document.body.classList.add('ck-out'); }); await page.waitForTimeout(3500); out.clock = await measure();
  await page.evaluate(() => { __lib3d.CLOCK.view.on = false; document.body.classList.remove('ck-out'); }); await page.waitForTimeout(2500);
  await page.evaluate(() => { const L = __lib3d, sec = L.UIS.secs.find(s => (s.en || '') === 'Economy'); L.openSection(sec);
    const bk = sec.books.find(b => b.it && b.it.li); document.querySelectorAll('#pages .item.is-current').forEach(e => e.classList.remove('is-current')); bk.it.li.classList.add('is-current', 'is-playing'); });
  await page.waitForTimeout(6000); out.present = await measure();
  const pt = await page.evaluate(() => { const L = __lib3d, bk = L.UIS.active; if (!bk || !bk.hero) return null; const g = bk.hero.geometry; g.computeBoundingBox(); const v = g.boundingBox.getCenter(new (L.camera.position.constructor)()).applyMatrix4(bk.hero.matrixWorld).project(L.camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; });
  if (pt) { await page.mouse.move(pt.x, pt.y); await page.waitForTimeout(300); await page.mouse.click(pt.x, pt.y); }
  await page.waitForTimeout(5000); out.reading = await measure();
  out.programs = await page.evaluate(() => __lib3d.renderer.info.programs.length);
  out.scale = await page.evaluate(() => __lib3d.state().scale);
  console.log(JSON.stringify(out)); console.log(errs.length ? errs.join('\n') : 'no errors'); await browser.close();
})();
