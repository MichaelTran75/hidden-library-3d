// node catshots.cjs URL OUT [HH:MM]: the cat where it is at that hour (by day on the floor by the glass, by night on the
// chaise), seen close from its side, its front, above and behind through the page's own camera: its coat, the shade it
// leaves on what it stands or lies on (core/bake.js, PET_SHADE) and the light on its fur. Writes OUT-side.png … ; prints
// where it is and any shader error (the page is opened with ?shaders). PLAYWRIGHT: the module's path, if not installed here.
// The shade alone: run it twice, the second time with OFF=1 (__lib3d.BAKE.petOff), and lay the pictures side by side.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [URL, OUT, AT = '15:00'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await p.goto(URL + '?at=' + AT + '&shaders', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.PETS.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.addStyleTag({ content: '#l3-ui, .toc, .page, #l3-lines, .l3-label, .l3-cap, .sky, .fireflies, .wx { display: none !important; opacity: 0 !important; }' });
  await p.waitForTimeout(3000);
  if (process.env.OFF) await p.evaluate(() => { __lib3d.BAKE.petOff = true; });
  const at = await p.evaluate(() => __lib3d.PETS.holder.position.toArray().map(v => +v.toFixed(3)));
  console.log('cat at', JSON.stringify(at));
  const [x, y, z] = at;
  const views = { side: [[x + 0.15, y + 0.5, z + 1.15], [x, y + 0.12, z], 30], front: [[x + 1.1, y + 0.4, z + 0.3], [x, y + 0.12, z], 30], top: [[x + 0.3, y + 1.3, z + 0.5], [x, y + 0.05, z], 30], back: [[x - 0.2, y + 0.45, z - 1.1], [x, y + 0.12, z], 30] };
  for (const k of Object.keys(views)) {
    await p.evaluate(([pos, tgt, fov]) => { const L = __lib3d, V = L.camera.position.constructor; L.goView({ pos: new V(...pos), tgt: new V(...tgt), fov, shift: 0 }, 0.001); L.LIFT.to = 0; }, views[k]);
    for (let i = 0; i < 5; i++) { await p.mouse.move(600 + i * 3, 30); await p.waitForTimeout(350); }
    await p.screenshot({ path: `${OUT}-${k}.png` });
  }
  console.log(errs.length ? errs.slice(0, 4) : 'no errors'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
