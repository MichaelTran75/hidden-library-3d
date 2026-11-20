// PLAYWRIGHT=<its folder> node touch.cjs URL: the pointer and the hen (kept still by it; swept fast at it; a click on it), and a click on the cat
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 1, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.goto(process.argv[2] + '?shaders&at=10:00', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.PETS.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.evaluate(() => { __lib3d.LIFT.to = __lib3d.LIFT.max; }); await p.waitForTimeout(2500);   // (the low view: the hen whole)
  const at = (dx = 0, dy = 0, dz = 0, cat) => p.evaluate(([dx, dy, dz, cat]) => { const L = __lib3d, P = L.PETS, V = L.camera.position.constructor, h = P.holder.position; const v = (cat ? new V(h.x + dx, h.y + 0.07 + dy, h.z + dz) : new V(P.hen.x + dx, -0.1 + dy, P.hen.z + dz)).project(L.camera); const r = document.getElementById('lib3d').getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, [dx, dy, dz, cat]);
  const kinds = async (ms) => { const seen = []; const e = Date.now() + ms; while (Date.now() < e) { const k = await p.evaluate(() => { const H = __lib3d.PETS.hen; return (H.act ? H.act.kind + (H.act.run ? '(run)' : '') : '-') + (H.air ? '^' : ''); }); if (seen[seen.length - 1] !== k) seen.push(k); await p.waitForTimeout(60); } return seen.join(' '); };
  // 1. still beside it
  await p.evaluate(() => { const H = __lib3d.PETS.hen; H.x = -2.2; H.z = -5.0; H.yaw = 1.5; H.act = null; H.queue = [{ kind: 'stand', dur: 6 }]; });
  let [x, y] = await at(0.25, 0, -0.4); console.log("pointer at", Math.round(x), Math.round(y)); await p.mouse.move(x, y); await p.waitForTimeout(100); await p.mouse.move(x + 1, y);
  console.log('still by it :', await kinds(6500), '| feathers', await p.evaluate(() => __lib3d.PETS.hen.box.map(v => +v.toFixed(2)).join(',')));
  // 2. swept fast at it
  await p.evaluate(() => { const H = __lib3d.PETS.hen; H.act = null; H.queue = [{ kind: 'stand', dur: 6 }]; }); await p.mouse.move(700, 300); await p.waitForTimeout(7000);
  const [hx, hy] = await at(0, 0.2, 0); await p.mouse.move(hx + 260, hy - 30); await p.waitForTimeout(80); await p.mouse.move(hx, hy, { steps: 6 });
  console.log('swept at it :', await kinds(3500));
  await p.screenshot({ path: 'touch-hen.png', clip: { x: Math.max(0, hx - 260), y: Math.max(0, hy - 260), width: 520, height: 380 } });
  // 3. a click on it
  await p.mouse.move(700, 300); await p.waitForTimeout(7500); const [cx, cy] = await at(0, 0.2, 0); await p.mouse.move(cx + 3, cy + 3, { steps: 30 }); await p.waitForTimeout(300); await p.mouse.down(); await p.mouse.up();
  console.log('clicked     :', await kinds(3000));
  // 4. a click on the cat
  const [kx, ky] = await at(0, 0.02, 0, true); await p.mouse.move(kx + 40, ky - 60); await p.mouse.move(kx, ky, { steps: 25 }); await p.waitForTimeout(500);
  const before = await p.evaluate(() => ({ on: __lib3d.PETS.touch.on, press: __lib3d.PETS.CAT.press.d })); await p.mouse.down(); await p.mouse.up();
  let low = 0; for (let i = 0; i < 12; i++) { await p.waitForTimeout(25); low = Math.min(low, await p.evaluate(() => __lib3d.PETS.CAT.press.d)); }
  console.log('cat poked   : part under the pointer', before.on, '; its body gave', (low * 1000).toFixed(1), 'mm; twitch', await p.evaluate(() => __lib3d.PETS.touch.twitch.toFixed(2)));
  console.log(errs.length ? errs : 'no errors'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
