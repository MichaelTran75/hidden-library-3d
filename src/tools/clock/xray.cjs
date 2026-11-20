// node xray.cjs URL OUT: the X-ray plate beside the clock: the screen whole, the plate, its top (foliot, bell, hammer) through a beat, the hammer struck, the clock apart
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [URL, OUT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await p.goto(URL + '?at=10:00', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.CLOCK.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.waitForTimeout(1200); await p.mouse.click(900, 40);
  await p.evaluate(() => { const C = __lib3d.CLOCK; C.open(); C.view.eT = 0; C.view.held = -1e9; C.view.yaw = -0.3; }); await p.waitForTimeout(3200);
  const box = await p.evaluate(() => { const r = document.querySelector('.ck-xray').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  console.log('plate', JSON.stringify(box), 'room', await p.evaluate(() => __lib3d.CLOCK.xray.room()));
  await p.mouse.move(700, 300); await p.screenshot({ path: OUT + '-screen.png', clip: { x: 300, y: 0, width: 1212, height: 945 } });
  await p.screenshot({ path: OUT + '-plate.png', clip: box });
  for (let i = 0; i < 8; i++) { await p.mouse.move(700 + i, 300); const st = await p.evaluate(() => (__lib3d.CLOCK.pose.th * 57.2958).toFixed(1));
    await p.screenshot({ path: `${OUT}-t${i}.png`, clip: { x: box.x, y: box.y + box.height * 0.26, width: box.width, height: box.height * 0.24 } }); console.log(i, st); await p.waitForTimeout(190); }
  await p.evaluate(() => { __lib3d.CLOCK.strike(); }); await p.waitForTimeout(430); await p.screenshot({ path: OUT + '-s1.png', clip: { x: box.x, y: box.y, width: box.width, height: box.height * 0.3 } });
  await p.waitForTimeout(140); await p.screenshot({ path: OUT + '-s2.png', clip: { x: box.x, y: box.y, width: box.width, height: box.height * 0.3 } });
  await p.evaluate(() => { __lib3d.CLOCK.view.eT = 1; }); await p.waitForTimeout(2600); await p.mouse.move(705, 300); await p.waitForTimeout(500); await p.screenshot({ path: OUT + '-apart.png', clip: { x: 300, y: 0, width: 1212, height: 945 } });
  console.log(errs.length ? errs : 'no errors'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
