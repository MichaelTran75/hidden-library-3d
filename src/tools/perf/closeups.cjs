// node closeups.cjs URL OUT [HH:MM]: the tables, the pot, the lamps, the sofa, the floor, the ceiling, the shelves, the books and a frame post seen close through the page's own camera (the real picture); ONLY=pot,lamp for some (PLAYWRIGHT: the module's path, if it is not installed here) SHADERS=1: shader errors to the console (?shaders)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [URL, OUT, AT = '10:00'] = process.argv.slice(2);
const VIEWS = {   // name: [camera, target, fov, about]; about: 'stump' (the stump table's top), 'lamp' (the table lamp), 'floor' (the floor lamp's shade): camera and target from there
  room: [[-0.6, 1.5, -2.6], [-0.9, 0.55, -6.2], 46],
  ctable: [[0.35, 0.95, -5.25], [-0.32, 0.38, -6.3], 30],
  ctop: [[-0.05, 0.78, -5.75], [-0.32, 0.42, -6.3], 26],
  cleg: [[0.25, 0.3, -5.6], [-0.2, 0.2, -6.25], 24],
  stump: [[0.75, 0.75, 0.95], [0, 0.3, 0], 30, 'stump'],
  stumpTop: [[0.3, 0.55, 0.45], [0, 0.03, 0], 30, 'stump'],
  stumpSide: [[0.55, 0.05, 0.7], [0, -0.25, 0], 26, 'stump'],
  pot: [[0.3, 0.3, 0.42], [0, 0.07, 0], 28, 'stump'],
  potRim: [[0.16, 0.3, 0.24], [0.02, 0.1, 0.02], 26, 'stump'],
  plant: [[0.5, 0.55, 0.75], [0, 0.35, 0], 30, 'stump'],
  lamp: [[0.5, 0.42, 0.7], [0, 0.24, 0], 28, 'lamp'],
  lampBase: [[0.2, 0.2, 0.3], [0, 0.12, 0], 28, 'lamp'],
  lampShade: [[0.28, 0.5, 0.42], [0, 0.39, 0], 28, 'lamp'],
  floorLamp: [[-0.75, -0.25, 0.95], [0, -0.1, 0], 28, 'floor'],
  floorShade: [[-0.3, -0.05, 0.42], [0, -0.1, 0], 30, 'floor'],
  sofa: [[-0.3, 1.25, -4.4], [-1.1, 0.5, -7.2], 40],
  floor: [[-0.1, 0.55, -4.3], [-0.7, 0, -5.0], 30],
  floorNear: [[0.6, 0.28, -4.9], [0.2, 0, -5.3], 30],
  shelf: [[1.9, 1.35, -5.6], [3.9, 1.3, -6.2], 34],
  shelfNear: [[1.72, 1.36, -5.75], [2.45, 1.2, -5.95], 26],
  books: [[1.78, 1.02, -6.5], [2.4, 0.98, -6.62], 22],
  frame: [[-0.55, 1.25, -4.1], [-1.31, 1.12, -4.55], 30],
  ceil: [[0.5, 1.5, -3.6], [0.4, 6.2, -5.2], 38],
  backShelf: [[0.6, 1.3, -6.6], [0.9, 1.25, -8.6], 30],
  velvet: [[0.75, 1.05, -5.9], [0.75, 0.42, -7.3], 34],
  velvetNear: [[0.55, 0.75, -6.75], [0.75, 0.45, -7.3], 30],
  velvetArm: [[0.2, 0.9, -6.3], [1.9, 0.5, -7.1], 30],
  pillow: [[-0.2, 0.95, -6.6], [-0.35, 0.7, -7.5], 28],
  plantNear: [[-0.55, 1.05, -5.35], [-0.93, 0.92, -5.85], 30],
};
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.goto(URL + '?at=' + AT + (process.env.SHADERS ? '&shaders' : ''), { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.PETS.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.addStyleTag({ content: '#l3-ui, .toc, .page, #l3-lines, .l3-label, .l3-cap, .sky, .fireflies, .wx { display: none !important; opacity: 0 !important; }' });
  await p.waitForTimeout(2500);
  console.log(JSON.stringify(await p.evaluate(() => { const L = __lib3d, s = L.LIGHTS.sofa, t = L.LIGHTS.table; return { sofa: s.position.toArray().map(v => +v.toFixed(2)), lamp: t.position.toArray().map(v => +v.toFixed(2)), R: L.MAT ? Object.keys(L.MAT).length : 0 }; })));
  for (const k of (process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(VIEWS))) {
    let [pos, tgt, fov, rel] = VIEWS[k];
    if (rel) { const c = await p.evaluate(rel => { const L = __lib3d; let o = null; if (rel === 'lamp') o = L.LIGHTS.table; else if (rel === 'floor') o = L.LIGHTS.floor.userData.glow.parent; else L.scene.traverse(m => { if (m.isMesh && m.geometry.type === 'CylinderGeometry' && Math.abs(m.geometry.parameters.radiusTop - 0.31) < 1e-6 && m.material.type === 'MeshStandardMaterial') o = m; }); return o ? o.getWorldPosition(o.position.clone()).toArray() : [0, 0.5, 0]; }, rel); pos = pos.map((v, i) => v + c[i]); tgt = tgt.map((v, i) => v + c[i]); }
    await p.evaluate(([pos, tgt, fov]) => { const L = __lib3d, V = L.camera.position.constructor; L.goView({ pos: new V(...pos), tgt: new V(...tgt), fov, shift: 0 }, 0.001); L.LIFT.to = 0; }, [pos, tgt, fov]);
    for (let i = 0; i < 4; i++) { await p.mouse.move(600 + i * 3, 30); await p.waitForTimeout(350); }
    await p.screenshot({ path: `${OUT}-${k}.png` });
  }
  console.log(errs.length ? errs : 'no errors'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
