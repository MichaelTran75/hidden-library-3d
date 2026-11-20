// node plant.cjs URL OUT: the pointer swept over the plant, then a click on it: frames of the plant, how long the leaves move, errors
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'); const [URL, OUT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.goto(URL + '?shaders&at=10:00', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.waitForTimeout(2000);
  const [cx, cy] = await p.evaluate(() => { const L = __lib3d, g = L.PLANT.g; g.updateWorldMatrix(true, true); const v = new (L.camera.position.constructor)(0, 0.3, 0).applyMatrix4(g.matrixWorld).project(L.camera); const r = document.getElementById('lib3d').getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; });
  console.log('plant at', Math.round(cx), Math.round(cy), 'element', await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className || e.tagName) : null; }, [cx, cy]));
  const clip = { x: cx - 190, y: cy - 190, width: 380, height: 340 }; fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
  await p.mouse.move(cx - 260, cy - 10); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/00.png`, clip });
  await p.mouse.move(cx + 120, cy + 10, { steps: 8 });
  const t0 = Date.now(); let i = 1, live = true, last = 0;
  while (Date.now() - t0 < 3500) { if (i <= 11) await p.screenshot({ path: `${OUT}/${String(i).padStart(2, '0')}.png`, clip }); else await p.waitForTimeout(60); i++; live = await p.evaluate(() => __lib3d.PLANT.live); if (live) last = Date.now() - t0; }
  console.log('swept: leaves moved for about', (last / 1000).toFixed(1), 's; at rest again:', !live, '; largest bend seen (rad):', await p.evaluate(() => Math.max(...__lib3d.PLANT.L.map(l => Math.abs(l.a) + Math.abs(l.b))).toFixed(3)));
  await p.mouse.move(cx, cy, { steps: 20 }); await p.waitForTimeout(1800); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(120);
  console.log('clicked: leaves moving', await p.evaluate(() => __lib3d.PLANT.L.filter(l => Math.abs(l.a) + Math.abs(l.b) > 0.01).length), 'of', await p.evaluate(() => __lib3d.PLANT.L.length));
  await p.screenshot({ path: `${OUT}/click.png`, clip }); await p.waitForTimeout(3000);
  console.log('at rest after the click:', await p.evaluate(() => !__lib3d.PLANT.live), errs.length ? errs : 'no errors'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
