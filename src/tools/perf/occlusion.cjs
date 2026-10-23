// what of the room no view ever shows: every mesh (and every instance of an instanced one) drawn in its own colour from
// every view a visitor can reach (home, each section, Books, Research; the view raised and lowered), at several window
// shapes, by day and by night; what never gets a pixel is reported (G, 23/10/2026: "những chỗ nào mà nó bị khuất em xóa")
// usage: BASE=http://127.0.0.1:PORT/ [SIZES='[[w,h],...]'] [OUT=file.json] node occlusion.cjs  (a build served by you)
// - the colour: R the mesh (1..255), G and B the instance; alpha always 1 (an alpha of 0 lost pixels: a first sweep
//   said visible books were hidden)
// - everything else that draws (dust, fireflies' sprites, lines, meshes made after the first pass) is hidden in the pass:
//   drawn in its own colours, added over the IDs, it made objects look seen; a pixel no ID could have written counts as
//   'bad:0' (should be none)
// - see-through meshes (glass, a lamp's jar) are left out and counted as seen; instanced ones list no instances
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
const fs = require('fs');
const SIZES = JSON.parse(process.env.SIZES || '[[1512,945],[1920,1080],[1280,1024],[2560,1080],[834,1194],[1024,1366],[1180,820],[900,1000]]');
const INSTALL = () => {
  window.__vis = { counts: new Map(), sig: [] };
  window.__visPass = async () => {
    const L = __lib3d, R = L.renderer, scene = L.scene, cam = L.camera, T = await import('three');
    if (!window.__visList) {   // the meshes of the picture (layer 0), in traversal order, and their ID materials
      const list = []; scene.traverse(o => { if (!o.isMesh || !(o.layers.mask & 1)) return; list.push(o); });
      window.__visList = list;
      const vs = `#include <common>\n#include <skinning_pars_vertex>\nvarying float vInst; varying vec2 vUv;\nvoid main(){\n#include <skinbase_vertex>\n#include <begin_vertex>\n#include <skinning_vertex>\n vec4 p = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n p = instanceMatrix * p; vInst = float(gl_InstanceID);\n#else\n vInst = 0.0;\n#endif\n vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * p; }`;
      const fs = `uniform float uId, uCut; uniform sampler2D uMap; varying float vInst; varying vec2 vUv;\nvoid main(){ if (uCut > 0.0 && texture2D(uMap, vUv).a < uCut) discard; gl_FragColor = vec4(uId / 255.0, mod(vInst, 256.0) / 255.0, floor(vInst / 256.0) / 255.0, 1.0); }`;
      window.__visMats = list.map((o, i) => { const m0 = [].concat(o.material)[0] || {}; const cut = m0.alphaTest > 0 && m0.map ? m0.alphaTest : 0;
        return new T.ShaderMaterial({ uniforms: { uId: { value: i + 1 }, uCut: { value: cut }, uMap: { value: cut ? m0.map : null } }, vertexShader: vs, fragmentShader: fs, side: m0.side === undefined ? T.FrontSide : m0.side, blending: T.NoBlending }); });
      window.__visRT = null;
    }
    const list = window.__visList, mats = window.__visMats, W = R.domElement.width, H = R.domElement.height, w = W, h = H;
    if (!window.__visRT || window.__visRT.width !== w) { if (window.__visRT) window.__visRT.dispose(); window.__visRT = new T.WebGLRenderTarget(w, h, { type: T.UnsignedByteType }); }
    const saved = list.map(o => [o.material, o.visible]), bg = scene.background, fog = scene.fog;
    // the see-through (glass, blended sheets) do not hide what is behind them: left out of the pass, and counted as seen
    list.forEach((o, i) => { const m0 = [].concat(o.material)[0] || {}; const seeThrough = m0.transparent && (m0.opacity === undefined || m0.opacity < 0.95 || m0.blending !== T.NormalBlending || !m0.depthWrite); o.material = mats[i]; if (seeThrough) { o.visible = false; window.__vis.counts.set(i + 1 + ':*', 1); } });
    const inList = new Set(list), off = []; scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && !inList.has(o) && o.visible) { o.visible = false; off.push(o); } });
    scene.background = null; scene.fog = null; const cc = R.getClearColor(new T.Color()), ca = R.getClearAlpha();
    R.setRenderTarget(window.__visRT); R.setClearColor(0x000000, 0); R.clear(); R.render(scene, cam); R.setRenderTarget(null); R.setClearColor(cc, ca);
    const px = new Uint8Array(w * h * 4); R.readRenderTargetPixels(window.__visRT, 0, 0, w, h, px);
    list.forEach((o, i) => { o.material = saved[i][0]; o.visible = saved[i][1]; }); scene.background = bg; scene.fog = fog; for (const o of off) o.visible = true; window.__visOff = off.length;
    const C = window.__vis.counts;
    for (let k = 0; k < px.length; k += 4) { if (px[k + 3] === 0) continue; const id = px[k]; if (!id) continue; const ii = px[k + 1] + px[k + 2] * 256, ob = list[id - 1]; const key = !ob || ii >= (ob.isInstancedMesh ? ob.count : 1) ? 'bad:0' : id + ':' + ii; C.set(key, (C.get(key) || 0) + 1); }
    if (!window.__vis.sig.length) window.__vis.sig = list.map(o => { const g = o.geometry, p = new T.Vector3(); o.getWorldPosition(p);
      const chain = []; for (let q = o; q && q !== scene; q = q.parent) chain.push(q.name || q.type);
      const mats0 = [].concat(o.material); let tex = 0; for (const m of mats0) for (const k of ['map', 'normalMap', 'roughnessMap', 'bumpMap', 'aoMap', 'emissiveMap', 'alphaMap']) { const t = m && m[k]; if (t && t.image && t.image.width) tex += t.image.width * t.image.height * 4 * 1.33; }
      return { verts: g.attributes.position.count, tris: (g.index ? g.index.count : g.attributes.position.count) / 3, inst: o.isInstancedMesh ? o.count : 0, pos: p.toArray().map(v => +v.toFixed(2)), chain: chain.slice(0, 4).join('<'), mat: mats0.map(m => m && (m.name || m.type)).join(','), texMB: +(tex / 1048576).toFixed(2), shadow: o.castShadow, name: o.name, geo: g.type, col: mats0[0] && mats0[0].color ? mats0[0].color.getHexString() : '', vis0: mats0[0] && mats0[0].visible, ud: Object.keys(o.userData || {}).join('/'), pud: o.parent ? Object.keys(o.parent.userData || {}).join('/') : '', bbox: (g.computeBoundingBox(), [g.boundingBox.min.toArray(), g.boundingBox.max.toArray()].map(a => a.map(v => +v.toFixed(3)))) }; });
    return C.size;
  };
};
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const total = new Map(); let sig = null, views = 0;
  for (const [W, H] of SIZES) for (const at of ['13:00', '22:00']) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, timezoneId: 'Australia/Sydney' }); await ctx.addInitScript(INSTALL);
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto((process.env.BASE || 'http://127.0.0.1:8799/') + '?at=' + at, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.classList.contains('l3-loaded') && performance.getEntriesByName('l3-precompiled').length, null, { timeout: 120000, polling: 200 });
    await page.waitForTimeout(2500);
    const shoot = async () => { for (const lift of [-0.3, 0, 0.45]) { await page.evaluate(l => { __lib3d.LIFT.to = l; __lib3d.LIFT.cur = l; }, lift); await page.mouse.move(W - 3, H / 2); await page.waitForTimeout(350); await page.evaluate(() => window.__visPass()); views++; } await page.evaluate(() => { __lib3d.LIFT.to = 0; __lib3d.LIFT.cur = 0; }); };
    await shoot();   // home
    const gos = await page.evaluate(() => [...document.querySelectorAll('.toc [data-goto], .toc .toc-link[data-nav]')].map((e, i) => i));
    for (const i of gos) {
      await page.evaluate(i => { const e = [...document.querySelectorAll('.toc [data-goto], .toc .toc-link[data-nav]')][i]; e && e.click(); }, i);
      await page.waitForTimeout(1700); await shoot();
    }
    const r = await page.evaluate(() => ({ counts: [...window.__vis.counts.entries()], sig: window.__vis.sig }));
    for (const [k, v] of r.counts) total.set(k, (total.get(k) || 0) + v);
    if (!sig) sig = r.sig; else if (sig.length !== r.sig.length) console.log('!! scene differs', sig.length, r.sig.length);
    console.log(W + 'x' + H, at, 'views so far', views, errs.length ? errs[0] : '');
    await ctx.close();
  }
  fs.writeFileSync(process.env.OUT || 'occlusion.json', JSON.stringify({ sig, counts: [...total.entries()], views }));
  // the report: meshes with no pixel; instanced meshes with how many instances never seen
  const seenMesh = new Map(); for (const [k, v] of total) { const [id, inst] = k.split(':'); seenMesh.set(+id, (seenMesh.get(+id) || 0) + v); }
  let hidTris = 0, hidTex = 0; const rows = [];
  sig.forEach((s, i) => { const id = i + 1; if (s.inst) { const seen = new Set(); for (const [k] of total) { const [a, b] = k.split(':'); if (+a === id && b !== '*') seen.add(+b); } const never = s.inst - seen.size; if (never > 0) rows.push(['INST', id, s.chain, s.mat, s.inst, never, s.tris, s.pos.join(',')]); }
    else if (!seenMesh.get(id)) { rows.push(['MESH', id, s.chain, s.mat, s.verts, s.tris, s.texMB, s.pos.join(','), s.shadow ? 'shadow' : '']); hidTris += s.tris; hidTex += s.texMB; } });
  for (const r of rows) console.log(r.join(' | '));
  console.log('noise pixels (should be 0):', total.get('bad:0') || 0);
  console.log('meshes', sig.length, 'views', views, 'hidden meshes', rows.filter(r => r[0] === 'MESH').length, 'their tris', hidTris, 'their texture MB (maybe shared)', +hidTex.toFixed(1));
  await browser.close();
})();
