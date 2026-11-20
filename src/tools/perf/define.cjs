// node define.cjs URL HH:MM CASE...: what a part of the shaders costs, on one page (two pages side by side differ by
// ±1.5 ms from the machine alone; one page with a part compiled out and in, in turn, tells 0.3 ms). A frame's GPU time
// (a draw, then a 1-pixel read that waits for it; median of 60) in the home view and the low view, each case four times
// in turn, after the page as it is. A case, parts joined by commas:
//   +NAME        the define NAME added to every lit material        -NAME   taken off those that have it
//   hide:velvet  the meshes of a kind left out (velvet: makeVelvet's; any other word: the material's name contains it)
// e.g. node define.cjs URL 10:00 -PET_SHADE hide:velvet +NO_ROOM_BAKE
// PLAYWRIGHT: the module's path, if it is not installed here. The page must be a build served by you (build.py --pages).
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [URL, AT = '10:00', ...CASES] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 })).newPage();
  await page.goto(URL + '?at=' + AT, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__lib3d && __lib3d.ISS && __lib3d.ISS.ok && performance.getEntriesByName('l3-precompiled').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await page.waitForTimeout(2000);
  const set = c => page.evaluate(c => {
    const L = __lib3d, seen = new Set(), ops = c ? c.split(',') : [], is = (m, k) => k === 'velvet' ? !!(m.userData && m.userData.velvet) : (m.name || '').includes(k); let n = 0;
    L.scene.traverse(o => {
      const ms = [].concat(o.material || []); if (!o.isMesh || !ms.length) return;
      if (o.userData.__vis === undefined) o.userData.__vis = o.visible; o.visible = o.userData.__vis && !ops.some(p => p.startsWith('hide:') && is(ms[0], p.slice(5)));
      for (const m of ms) {
        if (seen.has(m) || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial)) continue; seen.add(m);
        const own = m.userData.__own || (m.userData.__own = { ...(m.defines || {}) }), d = { ...own };
        for (const p of ops) { if (p[0] === '+') d[p.slice(1)] = ''; else if (p[0] === '-') delete d[p.slice(1)]; }
        const a = Object.keys(m.defines || {}).sort().join(), b = Object.keys(d).sort().join(); if (a !== b) { m.defines = d; m.needsUpdate = true; n++; }
      }
    }); return n;
  }, c);
  const measure = () => page.evaluate(() => { const L = __lib3d, gl = L.renderer.getContext(), px = new Uint8Array(4); if (L.state().scale !== 0.8) { L.setRtScale(0.8); L.resize(); }
    const one = () => { L.draw(); L.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    for (let i = 0; i < 12; i++) one(); const ts = []; for (let i = 0; i < 60; i++) { const t = performance.now(); one(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return +ts[30].toFixed(1); });
  const med = a => { const s = a.filter(v => v > 8).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };   // (a take under 8 ms: the page was not drawing)
  for (const view of ['home', 'low']) {
    if (view === 'home') await page.evaluate(() => { __lib3d.goView(__lib3d.homeView(), 0.01); }); else await page.evaluate(() => { __lib3d.LIFT.to = __lib3d.LIFT.max; });
    await page.waitForTimeout(4000); const r = {};
    for (let k = 0; k < 4; k++) for (const c of ['', ...CASES]) { const n = await set(c); await page.waitForTimeout(n ? 2500 : 700); (r[c || 'as is'] = r[c || 'as is'] || []).push(await measure()); }
    await set('');
    console.log(view.padEnd(5), Object.entries(r).map(([c, a]) => `${c} ${med(a)} [${a.join(' ')}]`).join(' | '));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
