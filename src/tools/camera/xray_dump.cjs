// node xray_dump.cjs URL OUT.json: every mesh of the vintage camera as the page has it, whole (the model's shell and what
// camparts.js makes inside it), its triangles in millimetres in the camera's own frame (x toward the rewind side, y up,
// z out along the lens): what xray.py draws the X-ray plate from. PLAYWRIGHT: the module's path, if not installed here.
// The page: a build served by you (build.py --pages DIR).
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright'); const fs = require('fs');
const [URL, OUT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await p.goto(URL + '?at=10:00', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.VCAM && __lib3d.VCAM.ok, null, { timeout: 180000, polling: 200 });
  const r = await p.evaluate(() => { const V = __lib3d.VCAM, g = V.group, out = {}; g.updateMatrixWorld(true); const inv = V.core.matrixWorld.clone().invert(), v = g.position.clone();
    g.traverse(o => { if (!o.isMesh || (o.name.startsWith('shell:') && o.name !== 'shell:0')) return; const M = inv.clone().multiply(o.matrixWorld), P = o.geometry.attributes.position, I = o.geometry.index, pos = [];
      const n = I ? I.count : P.count; for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, I ? I.getX(i) : i).applyMatrix4(M); pos.push(+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)); }
      let name = o.name === 'shell:0' ? 'shell' : o.name, k = 0; while (out[name + '#' + k]) k++; out[name + '#' + k] = pos; });   // (pieces of one name told apart: #0, #1 …)
    return out; });
  fs.writeFileSync(OUT, JSON.stringify(r)); console.log(Object.keys(r).length, 'meshes,', Object.values(r).reduce((n, a) => n + a.length / 9, 0), 'triangles'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
