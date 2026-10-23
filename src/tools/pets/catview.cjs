// the cat's skin alone (no fur), normal-shaded, from around it, in the pose it holds now (by day: the sphinx by the glass)
// argv: base out [pose-js]  (pose-js: an expression run first, e.g. to start an act)
// usage: node catview.cjs BASE OUT [js-to-run-first|-] [variants.json]   (variants: [[name, ops], ...] tried as the sphinx
// through PETS.tryPose; BONES=1 marks the hind-leg joints; VIEWS='[[name, azimuth, elevation], ...]'); a build served by you
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
const fs = require('fs');
const [base, out, pre, varsJ] = process.argv.slice(2); const VARS = varsJ ? JSON.parse(fs.readFileSync(varsJ, 'utf8')) : [['now', null]];
const VIEWS = JSON.parse(process.env.VIEWS || '[["side",90,12],["under",90,-25],["otherside",-90,12],["back3q",145,20]]');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, timezoneId: 'Australia/Sydney' })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(base + '?at=13:00', { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('l3-loaded') && performance.getEntriesByName('l3-precompiled').length && __lib3d.PETS && __lib3d.PETS.ok, null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => { const C = __lib3d.PETS.CAT; C.actT = C.huntT = C.twitchT = C.glanceT = 1e9; });   // (it stays as it lies: no acts, no hunting)
  await page.waitForTimeout(3500);
  console.log('state', JSON.stringify(await page.evaluate(() => { const C = __lib3d.PETS.CAT; return { mode: C.mode, seq: !!C.seq, place: C.place }; })));
  if (process.env.BONES) await page.evaluate(() => { window.__bones = true; });
  if (pre && pre !== '-') { await page.evaluate(pre); await page.waitForTimeout(2500); }
  for (const [vn, ops] of VARS) {
  if (ops) { await page.evaluate(ops => __lib3d.PETS.tryPose('sphinx', ops), ops); await page.waitForTimeout(1500); }
  const shots = await page.evaluate(async (VIEWS) => {
    const T = await import('three'), L = __lib3d, R = L.renderer, P = L.PETS, scene = L.scene;
    let skin = null; P.cat.traverse(o => { if (o.isSkinnedMesh && (!skin || o.geometry.attributes.position.count > skin.geometry.attributes.position.count)) skin = o; });
    const box = new T.Box3().setFromObject(skin, true), c = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3()).length();
    const fwd = new T.Vector3(0, 0, 1).applyQuaternion(P.holder.getWorldQuaternion(new T.Quaternion())); fwd.y = 0; fwd.normalize();
    const cam = new T.PerspectiveCamera(30, 4 / 3, 0.01, 20); cam.layers.set(P.layer);
    const W = 640, H = 480, rt = new T.WebGLRenderTarget(W, H, { samples: 4 }), px = new Uint8Array(W * H * 4);
    const hide = []; scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isSprite) && o !== skin && o.visible && (o.layers.mask & (1 << P.layer))) { o.visible = false; hide.push(o); } });
    const mat = new T.MeshNormalMaterial(), m0 = skin.material, bg = scene.background, fog = scene.fog; skin.material = mat; scene.background = new T.Color(0x303030); scene.fog = null;
    const out = [];
    for (const [name, az, el] of VIEWS) {
      const a = az * Math.PI / 180, e = el * Math.PI / 180, side = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), fwd);
      const dir = fwd.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).multiplyScalar(Math.cos(e)); dir.y = Math.sin(e);
      cam.position.copy(c).addScaledVector(dir, size * 1.7); cam.lookAt(c); cam.updateMatrixWorld();
      R.setRenderTarget(rt); R.setClearColor(0x303030, 1); R.clear(); R.render(scene, cam); R.setRenderTarget(null); R.readRenderTargetPixels(rt, 0, 0, W, H, px);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'), id = g.createImageData(W, H);
      for (let y = 0; y < H; y++) id.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      g.putImageData(id, 0, 0);
      if (window.__bones) { const cols = { thigh: '#ff0', shin: '#f80', foot: '#f00', toe: '#fff', ftoe: '#fff', hips: '#0ff', spine: '#0f0' };
        for (const b of skin.skeleton.bones) { const k = b.name.replace(/_[LR]$/, ''), col = cols[k]; if (!col) continue; const p = b.getWorldPosition(new T.Vector3()).project(cam);
          const x = (p.x + 1) / 2 * W, y = (1 - p.y) / 2 * H; g.fillStyle = col; g.beginPath(); g.arc(x, y, /_R$/.test(b.name) ? 5 : 3, 0, 7); g.fill(); g.strokeStyle = '#000'; g.stroke(); } }
      out.push([name, cv.toDataURL('image/png')]);
    }
    skin.material = m0; scene.background = bg; scene.fog = fog; for (const o of hide) o.visible = true; rt.dispose();
    return out;
  }, VIEWS);
  for (const [n, d] of shots) fs.writeFileSync(`${out}-${vn}-${n}.png`, Buffer.from(d.split(',')[1], 'base64'));
  }
  console.log(errs.length ? errs.join(' | ') : 'no errors'); await browser.close();
})();
