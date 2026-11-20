// node pointer.cjs URL OUT: the clock by the pointer: on its shelf, hovered, opened by a click, its bell struck, apart / together, closed
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [URL, OUT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await (await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await p.goto(URL + '?at=10:00', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.CLOCK.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.waitForTimeout(1500);
  const at = await p.evaluate(() => { const L = __lib3d, C = L.CLOCK, b = C.box, v = C.holder.position.clone().set(b[0], b[1] + b[4] / 2, b[2]).project(L.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }).catch(e => null);
  console.log('clock on screen at', at && at.map(v => Math.round(v)));
  const clip = { x: Math.max(0, at[0] - 170), y: Math.max(0, at[1] - 200), width: 340, height: 400 };
  await p.mouse.move(900, 500); await p.waitForTimeout(600); await p.screenshot({ path: OUT + '-shelf.png', clip });
  await p.mouse.move(at[0], at[1]); await p.waitForTimeout(700); await p.screenshot({ path: OUT + '-hover.png', clip });
  console.log('hover', await p.evaluate(() => [__lib3d.CLOCK.hover, +__lib3d.CLOCK.out.toFixed(2)]));
  await p.mouse.click(at[0], at[1]); await p.waitForTimeout(3600);
  const st = () => p.evaluate(() => { const C = __lib3d.CLOCK, V = C.view; return { on: V.on, k: +V.k.toFixed(2), e: +V.e.toFixed(2), large: C.large ? C.large.image.width : 0, rt: C.PI.rt ? C.PI.rt.width + 'x' + C.PI.rt.height : null, blows: C.blows, audio: C.ctx ? C.ctx.state : null, bell: V.rects && V.rects.bell && V.rects.bell.map(v => Math.round(v)) }; });
  let s = await st(); console.log('opened', JSON.stringify(s));
  const r = s.bell; await p.mouse.click((r[0] + r[2]) / 2, (r[1] + r[3]) / 2); await p.waitForTimeout(1500); s = await st(); console.log('bell clicked', JSON.stringify(s));
  await p.mouse.click((r[0] + r[2]) / 2, (r[1] + r[3]) / 2 + 330); await p.waitForTimeout(1800); s = await st(); console.log('clock clicked', JSON.stringify(s));
  await p.screenshot({ path: OUT + '-out.png', clip: { x: 300, y: 0, width: 1212, height: 945 } });
  await p.keyboard.press('Escape'); await p.waitForTimeout(2600); s = await st(); console.log('closed', JSON.stringify(s));
  await p.mouse.move(900, 500); await p.waitForTimeout(500); await p.screenshot({ path: OUT + '-back.png', clip });
  console.log(errs.length ? errs : 'no errors'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
