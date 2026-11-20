// node xray.cjs URL OUT: the vintage camera out of its shelf with its X-ray plate beside it (lib3d/world/camxray.js): apart
// by day (OUT-apart.png), together, by night in Vietnamese, and on a narrow window (where the plate is left out); prints the
// plate's place and size and any shader error. PLAYWRIGHT: the module's path, if it is not installed here. The page: a build
// served by you (build.py --pages DIR).
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [URL, OUT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] }); const errs = [];
  const open = async (w, h, at, vi) => { const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
    p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
    await p.goto(URL + '?at=' + at + '&shaders', { waitUntil: 'load', timeout: 120000 });
    await p.waitForFunction(() => window.__lib3d && __lib3d.VCAM && __lib3d.VCAM.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
    await p.waitForTimeout(2000); if (vi) { const t = await p.$('text=Tiếng Việt'); if (t) await t.click(); }
    await p.evaluate(() => { __lib3d.VCAM.open(); }); await p.waitForTimeout(4200); for (let i = 0; i < 4; i++) { await p.mouse.move(600 + i * 3, h - 8); await p.waitForTimeout(300); } return p; };
  let p = await open(1500, 950, '10:00', false); await p.screenshot({ path: OUT + '-apart.png' });
  await p.evaluate(() => { __lib3d.VCAM.view.eT = 0; }); await p.waitForTimeout(2200); for (let i = 0; i < 4; i++) { await p.mouse.move(600 + i * 3, 942); await p.waitForTimeout(300); } await p.screenshot({ path: OUT + '-together.png' });
  console.log('plate', JSON.stringify(await p.evaluate(() => { const e = document.querySelector('.vc-xray'), r = e.getBoundingClientRect(); return { on: e.classList.contains('is-on'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), room: __lib3d.VCAM.xray.room() }; })));
  await p.close(); p = await open(1500, 950, '21:00', true); await p.screenshot({ path: OUT + '-night-vi.png' }); await p.close();
  p = await open(1150, 760, '10:00', false); await p.screenshot({ path: OUT + '-narrow.png' });
  console.log('narrow room', await p.evaluate(() => __lib3d.VCAM.xray.room()));
  console.log(errs.length ? errs.slice(0, 4) : 'no errors'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
