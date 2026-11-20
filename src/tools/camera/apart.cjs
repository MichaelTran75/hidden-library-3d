// node apart.cjs URL OUT [scene,scene…]: the vintage camera out of its shelf and apart, with only some of its parts shown,
// seen from a chosen side, the picture cut to those parts (OUT-scene.png); the scenes named all* show every part with the
// names. Prints shader errors (the page is opened with ?shaders). PLAYWRIGHT: the module's path, if it is not installed here.
// The page: a build served by you (build.py --pages DIR).
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright'); const fs = require('fs');
const [URL, OUT, ONLY] = process.argv.slice(2);
const ALL = ['lens', 'front', 'iris', 'rear', 'mbox', 'screen', 'prism', 'eye', 'top', 'rewind', 'lever', 'dial', 'release', 'body', 'shutter', 'gov', 'gears', 'film', 'plate', 'back', 'bottom', 'case'];
const SCENES = {   // name: [the parts shown, how far it is turned from facing the lens (rad), how far tipped]
  top: [['body', 'shutter', 'gov', 'gears', 'mbox', 'screen'], 0.5, 1.0],
  top2: [['body', 'shutter', 'gov', 'gears'], 3.6, 0.9],
  back: [['body', 'shutter', 'gov', 'gears', 'mbox'], Math.PI + 0.35, 0.2],
  backFilm: [['body', 'shutter', 'film', 'plate', 'back'], Math.PI - 0.5, 0.25],
  front: [['body', 'shutter', 'gov', 'gears'], 0.3, 0.1],
  bottom: [['body', 'shutter', 'gov', 'gears', 'bottom'], 0.4, -1.0],
  mbox: [['mbox', 'screen', 'prism', 'eye'], 0.9, 0.25],
  mboxBack: [['mbox', 'screen', 'prism', 'eye'], Math.PI - 0.7, 0.3],
  lens: [['lens', 'front', 'iris', 'rear'], 1.25, 0.12],
  lensBack: [['lens', 'front', 'iris', 'rear'], Math.PI - 0.6, 0.15],
  inside: [['shutter', 'gov', 'gears', 'film', 'plate', 'screen', 'prism', 'eye', 'front', 'iris', 'rear'], 0.7, 0.3],
  inside2: [['shutter', 'gov', 'gears', 'film', 'plate', 'screen', 'prism', 'eye', 'front', 'iris', 'rear'], Math.PI + 0.6, 0.3],
  all: [ALL, 0.45, 0.32], all2: [ALL, Math.PI + 0.5, 0.32], all3: [ALL, 1.4, 0.2], all4: [ALL, -1.1, 0.5],
};
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await p.goto(URL + '?at=10:00&shaders', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.VCAM && __lib3d.VCAM.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const V = __lib3d.VCAM; V.PI.dpr = 2; V.open(); }); await p.waitForTimeout(3500);
  for (const k of (ONLY ? ONLY.split(',') : Object.keys(SCENES))) {
    const [keys, yaw, tilt] = SCENES[k], whole = keys.length === ALL.length;
    // (apart, the page itself turns it 0.95 rad from facing the lens: taken off here)
    await p.addStyleTag({ content: `.ck-out-ui.vc-ui { opacity: ${whole ? 1 : 0} !important; }` });   // (its parts' names only when all of it is shown)
    await p.evaluate(([keys, yaw, tilt]) => { const V = __lib3d.VCAM; for (const [k, q] of Object.entries(V.parts)) for (const pc of q.pieces) pc.off = !keys.includes(k); V.tilt = tilt; V.view.yaw = yaw - 0.95; V.view.held = 0; V.view.sway = 0; }, [keys, yaw, tilt]);
    for (let i = 0; i < 5; i++) { await p.mouse.move(700 + i * 3, 940); await p.waitForTimeout(300); }
    const r = await p.evaluate(keys => { const V = __lib3d.VCAM, R = [1e9, 1e9, -1e9, -1e9]; for (const k of keys) { const q = V.view.rects[k]; if (!q) continue; R[0] = Math.min(R[0], q[0]); R[1] = Math.min(R[1], q[1]); R[2] = Math.max(R[2], q[2]); R[3] = Math.max(R[3], q[3]); } return R; }, keys);
    const pad = 16, x = Math.max(0, r[0] - pad), y = Math.max(0, r[1] - pad), w = Math.min(1500, r[2] + pad) - x, h = Math.min(950, r[3] + pad) - y;
    await p.screenshot({ path: `${OUT}-${k}.png`, ...(whole ? {} : { clip: { x, y, width: Math.max(50, w), height: Math.max(50, h) } }) });
  }
  console.log(errs.length ? errs.slice(0, 4) : 'no errors'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
