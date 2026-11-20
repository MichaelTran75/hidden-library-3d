// PLAYWRIGHT=<its folder> node switch.cjs URL OUT: day (16:00) to night (20:30) and back once the page is all made: long tasks during each switch, a shot after each
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [URL, OUT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 1, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  await p.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); });
  await p.goto(URL + '?at=16:00', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && performance.getEntriesByName('l3-precompiled').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.waitForTimeout(3000);
  for (const [h, m, name] of [[20, 30, 'night'], [10, 0, 'day']]) {
    const t0 = await p.evaluate(([h, m]) => { const d = new Date(); d.setHours(h, m, 0, 0); __lib3d.setClock(d); return performance.now(); }, [h, m]);
    await p.waitForTimeout(12000);
    const r = await p.evaluate(t0 => ({ lt: window.__lt.filter(x => x[0] >= t0).map(x => x[1]), late: (__lib3d.WARM ? __lib3d.WARM.late : []).filter(s => +s.split('@')[1] >= t0), progs: __lib3d.renderer.info.programs.length }), t0);
    await p.screenshot({ path: `${OUT}-${name}.png` });
    console.log(name, 'long tasks', JSON.stringify(r.lt), 'late', r.late.length, 'programs', r.progs);
  }
  console.log(errs.length ? errs : 'no errors'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
