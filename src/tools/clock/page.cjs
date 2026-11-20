// node page.cjs URL OUT [views|strike]: the clock out of its shelf (whole / apart, a few sides), its nodes, the hammer across an hour (PLAYWRIGHT: the module's path, if it is not installed here)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [URL, OUT, MODE = 'all'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await p.goto(URL + '?at=10:00', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.CLOCK.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.waitForTimeout(1200);
  console.log(JSON.stringify(await p.evaluate(() => { const C = __lib3d.CLOCK, E = C.ESC, d = v => +(v * 180 / Math.PI).toFixed(3);
    return { nodes: Object.keys(C.nodes).join(' '), pbox: Object.keys(C.pbox).join(' '), esc: { ax: d(E.ax), te: d(E.te), rho: +E.rho.toFixed(3), b: +E.b.toFixed(3), c: +E.c.toFixed(3), drop: d(E.ea - E.e0), recoil: d(E.ea - Math.asin((C.CK.esc.d * Math.tan(C.CK.esc.beta - C.CK.esc.swing) + C.CK.esc.off / Math.cos(C.CK.esc.beta - C.CK.esc.swing) - C.CK.esc.y0) / C.CK.esc.R)), mean: d(E.mean) }, len: C.CK.strike.len, ham: d(C.ham.a) }; })));
  if (MODE !== 'strike') {
    await p.mouse.click(900, 40); await p.evaluate(() => { __lib3d.CLOCK.open(); __lib3d.CLOCK.view.eT = 0; }); await p.waitForTimeout(2800); console.log('large picture:', await p.evaluate(() => { const t = __lib3d.CLOCK.large; return t ? t.image.width + ' px' : 'no'; }));
    for (const [e, name, yaws] of [[0, 'whole', [0, 60, 150, 250]], [1, 'apart', [0, 60]]]) {
      await p.evaluate(e => { __lib3d.CLOCK.view.eT = e; }, e); await p.waitForTimeout(2200);
      for (const y of yaws) { await p.evaluate(y => { const V = __lib3d.CLOCK.view; V.yaw = y * Math.PI / 180; V.held = -1e9; V.sway = 0; }, y); await p.mouse.move(900 + Math.random() * 5, 40); await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}-${name}-${y}.png`, clip: { x: 300, y: 0, width: 1212, height: 945 } }); }
    }
  }
  if (MODE !== 'views') {   // across the hour: the hammer's angle by time
    const log = await p.evaluate(() => new Promise(done => {
      const C = __lib3d.CLOCK, d = new Date(); d.setHours(2, 59, 57, 0); C.t0 = { at: d.getTime(), from: performance.now(), rate: 1 }; const t0 = performance.now(), out = []; let last = -1;
      (function tick() { const t = performance.now() - t0; out.push([Math.round(t), +(C.ham.a * 180 / Math.PI).toFixed(2), +(C.nodes.lever.quaternion.x * 2 * 180 / Math.PI).toFixed(2), C.blows]); if (t < 6500) requestAnimationFrame(tick); else { C.t0 = null; done(out); } })();
    }));
    const hit = log.findIndex((r, i) => i && r[3] > log[i - 1][3]); console.log('frames', log.length, 'blows', log[log.length - 1][3], 'first blow at ms', hit >= 0 ? log[hit][0] : null);
    console.log('hammer / lever (deg) by time:', log.filter((r, i) => (r[0] > 2700 && r[0] < 3900) || i % 20 === 0).map(r => `${r[0]}:${r[1]}/${r[2]}`).join(' '));
  }
  console.log(errs.length ? errs : 'no errors');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
