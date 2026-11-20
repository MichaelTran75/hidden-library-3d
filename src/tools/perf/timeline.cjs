// node timeline.cjs URL [mbps latencyMs] : marks, resources, long tasks, frame gaps over the first 45 s
const { chromium } = require(process.env.PLAYWRIGHT);
const [URL, MBPS, LAT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const ctx = await b.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  const cdp = await ctx.newCDPSession(p); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (MBPS) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: +LAT || 40, downloadThroughput: +MBPS * 125000, uploadThroughput: 2 * 125000 });
  await p.addInitScript(() => {
    window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
    window.__gaps = []; let last = 0; const f = t => { if (last && t - last > 50) window.__gaps.push([Math.round(last), Math.round(t - last)]); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f);
    window.__cls = []; const mo = new MutationObserver(() => window.__cls.push([Math.round(performance.now()), document.documentElement.className + ' | ' + (document.body ? document.body.className : '')]));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { attributes: true, attributeFilter: ['class'] }));
  });
  await p.goto(URL + '?at=13:00', { waitUntil: 'load', timeout: 180000 });
  await p.mouse.move(700, 500);
  await p.waitForTimeout(45000);
  const r = await p.evaluate(() => ({
    nav: (n => ({ dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }))(performance.getEntriesByType('navigation')[0]),
    fcp: Math.round((performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0),
    marks: performance.getEntriesByType('mark').map(m => [m.name, Math.round(m.startTime)]),
    res: performance.getEntriesByType('resource').map(e => [e.name.replace(/^https?:\/\//, '').replace(/\?.*/, '').slice(-60), Math.round(e.startTime), Math.round(e.responseEnd), e.transferSize, e.decodedBodySize]),
    lt: window.__lt, gaps: window.__gaps, cls: window.__cls, heap: Math.round(performance.memory.usedJSHeapSize / 1048576),
  }));
  console.log('nav', JSON.stringify(r.nav), 'fcp', r.fcp, 'heap MB', r.heap, errs.length ? errs : '');
  console.log('marks', r.marks.map(m => m.join(' ')).join(' | '));
  console.log('classes'); let prev = ''; for (const [t, c] of r.cls) { if (c !== prev) console.log('  ', t, c.slice(0, 150)); prev = c; }
  console.log('resources (start end bytes)'); for (const e of r.res.sort((a, b) => a[1] - b[1])) console.log('  ', String(e[1]).padStart(6), String(e[2]).padStart(6), String(e[4]).padStart(8), e[0]);
  const sum = a => a.reduce((s, v) => s + v[1], 0);
  console.log('long tasks', r.lt.length, 'total', sum(r.lt), 'ms:', r.lt.map(l => l.join('+')).join(' '));
  console.log('frame gaps > 50 ms', r.gaps.length, ':', r.gaps.map(l => l.join('+')).join(' '));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
