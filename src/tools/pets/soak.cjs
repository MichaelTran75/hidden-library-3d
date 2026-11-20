// PLAYWRIGHT=<its folder> node soak.cjs URL: every act of the cat and the hen in turn, by day; a trip to the sofa and back; errors, NaNs in their state
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 1, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.goto(process.argv[2] + '?shaders&at=10:00', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.PETS.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  let mm = 0; const wake = setInterval(() => { mm++; p.mouse.move(1400 + (mm % 5) * 10, 60 + (mm % 3) * 8).catch(() => {}); }, 1500);
  const bad = () => p.evaluate(() => { const P = __lib3d.PETS, h = P.holder.position, H = P.hen, u = H.u; const v = [h.x, h.y, h.z, H.x, H.z, H.yaw, u.uNeckA.value.x, u.uNeckA.value.y, u.uNeckA.value.z, u.uTailA.value.z, u.uPuff.value, ...H.feet]; let nan = v.some(x => !Number.isFinite(x));
    P.cat.traverse(o => { if (o.isBone && !(Number.isFinite(o.quaternion.x) && Number.isFinite(o.position.y))) nan = true; });
    return { nan, cat: [h.x, h.y, h.z].map(x => +x.toFixed(2)).join(','), hen: [H.x, H.z].map(x => +x.toFixed(2)).join(','), seq: !!P.CAT.seq, mode: P.CAT.mode, henIn: H.x > -2.6 && H.x < -1.7 && H.z > -5.9 && H.z < -4.3 }; });
  for (const k of ['groom', 'loaf', 'sniff', 'doze', 'watch', 'hunt', 'stroll']) {
    await p.evaluate(k => { const P = __lib3d.PETS; P.act(k); if (k === 'loaf' || k === 'doze') setTimeout(() => { const s = P.CAT.seq; if (s && s.steps[0].dur > 4) s.steps[0].dur = 4; }, 100); }, k);
    for (let i = 0; i < 100; i++) { await p.waitForTimeout(500); const r = await bad(); if (r.nan) { console.log('NaN during', k); break; } if (!r.seq && i > 2) { console.log(k, 'done after', (i + 1) / 2, 's; cat at', r.cat, 'hen', r.hen, r.henIn ? '' : 'HEN OUT'); break; } if (i === 99) console.log(k, 'still running after 50 s', JSON.stringify(r)); }
  }
  await p.evaluate(() => __lib3d.PETS.henDo('preen', 'shake', 'alert', 'scratch', 'back', 'peer', 'peck', 'walk', 'turn', 'walk')); await p.waitForTimeout(12000); console.log('hen acts', JSON.stringify(await bad()));
  for (const to of ['night', 'day']) { await p.evaluate(to => __lib3d.PETS.trip(to), to); for (let i = 0; i < 90; i++) { await p.waitForTimeout(500); const r = await bad(); if (r.nan) { console.log('NaN on trip'); break; } if (r.mode === 'still' && !r.seq) { console.log('trip', to, 'done after', (i + 1) / 2, 's at', r.cat); break; } } }
  // a stroll cut short by nightfall: it goes to the sofa from where it is
  await p.evaluate(() => { __lib3d.PETS.act('stroll'); }); await p.waitForTimeout(9000); const mid = await bad();
  await p.evaluate(() => { const d = new Date(); d.setHours(21, 0, 0, 0); __lib3d.setClock(d); }); let jump = 0, prev = null;
  for (let i = 0; i < 120; i++) { await p.waitForTimeout(250); const r = await p.evaluate(() => { const h = __lib3d.PETS.holder.position; return [h.x, h.y, h.z, __lib3d.PETS.CAT.mode === 'still' && !__lib3d.PETS.CAT.seq]; }); if (prev) jump = Math.max(jump, Math.hypot(r[0] - prev[0], r[2] - prev[2])); prev = r; if (r[3] && i > 20) break; }
  console.log('stroll then nightfall: mid-stroll at', mid.cat, '; largest move in 0.25 s:', jump.toFixed(2), 'm; ends', JSON.stringify(await bad()));
  clearInterval(wake); console.log(errs.length ? errs : 'no errors'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
