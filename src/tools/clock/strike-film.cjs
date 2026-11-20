// node strike-film.cjs URL OUT: the strike in slow motion (CLOCK.t0.rate 0.05): 12 pictures of the bell across the hour
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [URL, OUT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await p.goto(URL + '?at=10:00', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.CLOCK.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.waitForTimeout(1200); await p.mouse.click(900, 40);
  await p.evaluate(() => { const C = __lib3d.CLOCK, V = C.view; V.on = true; V.eT = 0; V.held = -1e9; document.body.classList.add('ck-out'); const d = new Date(); d.setHours(2, 59, 59, 0); C.t0 = { at: d.getTime(), from: performance.now() + 3200, rate: 0.05 }; });
  await p.waitForTimeout(3000);   // (out and still; then 1 s of the clock's time before the hour = 20 s here, so: jump to 0.1 s before)
  await p.evaluate(() => { const C = __lib3d.CLOCK, d = new Date(); d.setHours(2, 59, 59, 900); C.t0 = { at: d.getTime(), from: performance.now(), rate: 0.05 }; });
  const shots = [];
  for (let i = 0; i < 12; i++) {
    await p.mouse.move(900 + i, 40);
    const st = await p.evaluate(() => { const C = __lib3d.CLOCK; return [((performance.now() - C.t0.from) * C.t0.rate - 100).toFixed(0), (C.ham.a * 57.2958).toFixed(2), C.blows, !!C.large]; });
    const f = `${OUT}-${String(i).padStart(2, '0')}.png`; await p.screenshot({ path: f, clip: { x: 640, y: 60, width: 560, height: 330 } }); shots.push(st.join('|'));
    await p.waitForTimeout(i < 2 ? 500 : 260);
  }
  console.log(shots.join('  ')); console.log(errs.length ? errs : 'no errors');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
