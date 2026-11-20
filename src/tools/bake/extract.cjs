// node extract.cjs URL OUT: the room as the page builds it, for the light's bake (bake.mjs). Writes OUT/scene.bin (every
// still, opaque thing in the room as triangles in the room's own metres, then each triangle's colour) and
// OUT/scene.json (how many, the room's box, its windows' lights and its lamps as they are by night).
// What is left out: glass and anything see-through, the animals, what stands outside, the rug's pile (its base is in).
// The books are boxes (4000 of them). PLAYWRIGHT: the module's path, if it is not installed here.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright'); const fs = require('fs'), path = require('path');
const [URL, OUT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, timezoneId: 'Australia/Sydney' })).newPage();
  p.on('pageerror', e => console.log('page error:', String(e)));
  await p.goto(URL + '?at=15:00', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.PETS.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.waitForTimeout(3000);
  const meta = await p.evaluate(() => {
    const L = __lib3d, T = L.camera.position.constructor, M4 = L.camera.matrixWorld.constructor, v = new T(), a = new T(), b = new T(), c = new T(), m = new M4();
    L.scene.updateMatrixWorld(true);
    const rects = L.LIGHTS.rects.map(r => { const q = r.getWorldQuaternion(new L.camera.quaternion.constructor());
      return { c: r.getWorldPosition(new T()).toArray(), u: new T(1, 0, 0).applyQuaternion(q).multiplyScalar(r.width / 2).toArray(), v: new T(0, 1, 0).applyQuaternion(q).multiplyScalar(r.height / 2).toArray(), n: new T(0, 0, -1).applyQuaternion(q).toArray() }; });
    const left = L.LIGHTS.rects[0], back = L.LIGHTS.rects[1], front = L.LIGHTS.rects[2], xL = left.position.x + 0.05, H = left.height, zB = back.position.z + 0.05, zF = front.position.z - 0.05;
    let xW = -1e9; { const f = L.scene.children.find(o => o.isGroup && o.children.some(c => c.material === L.MAT.floor)); const fl = f.children.find(c => c.material === L.MAT.floor); fl.geometry.computeBoundingBox(); xW = fl.geometry.boundingBox.clone().applyMatrix4(fl.matrixWorld).max.x - 0.2; }
    const box = { min: [xL - 0.25, -0.05, zB - 0.25], max: [xW + 0.05, H + 0.05, zF + 0.25] }, inBox = (q, e = 0) => q.x > box.min[0] - e && q.x < box.max[0] + e && q.y > box.min[1] - e && q.y < box.max[1] + e && q.z > box.min[2] - e && q.z < box.max[2] + e;
    // the lamps, as they stand by night (fx/hour.js applyHour at k = 1)
    const lamps = [], lamp = (o, I, role) => { const P = o.getWorldPosition(new T()), e = { role, p: P.toArray(), I, col: o.color.toArray(), dist: o.distance, decay: o.decay };
      if (o.isSpotLight) { e.d = o.target.getWorldPosition(new T()).sub(P).normalize().toArray(); e.cosO = Math.cos(o.angle); e.cosI = Math.cos(o.angle * (1 - o.penumbra)); } lamps.push(e); };
    lamp(L.LIGHTS.table.userData.light, 7, 'table'); lamp(L.LIGHTS.floor.userData.light, 32, 'floor'); lamp(L.LIGHTS.floor.userData.pt, 5, 'floorPt');
    if (L.LIGHTS.pendant) lamp(L.LIGHTS.pendant.userData.light, 40, 'pendant');
    for (const s of L.NIGHT.spots.slice(0, 2)) lamp(s.sp, 55 * s.k, 'down');   // (the two over the sofa: lights)
    for (const d of L.NIGHT.down) { const P = new T(...d.p), c = new L.LIGHTS.sun.color.constructor(d.color);   // (the six baked whole: fx/night.js)
      lamps.push({ role: 'baked', p: d.p, I: d.I, col: c.toArray(), dist: d.dist, decay: d.decay, d: new T(...d.t).sub(P).normalize().toArray(), cosO: Math.cos(d.angle), cosI: Math.cos(d.angle * (1 - d.pen)) }); }
    // a picture's mean colour (linear), times the material's own
    const lin = x => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4), means = new Map();
    const mapMean = t => { if (!t || !t.image) return [1, 1, 1]; if (means.has(t)) return means.get(t); let r = [1, 1, 1];
      try { const im = t.image; let d = null;
        if (im.data && im.width) { d = []; const n = im.width * im.height, st = Math.max(1, Math.floor(n / 4000)); for (let i = 0; i < n; i += st) d.push(im.data[i * 4], im.data[i * 4 + 1], im.data[i * 4 + 2], 255); }
        else { const cv = document.createElement('canvas'); cv.width = cv.height = 24; const g = cv.getContext('2d'); g.drawImage(im, 0, 0, 24, 24); d = g.getImageData(0, 0, 24, 24).data; }
        let s = [0, 0, 0], n = 0; for (let i = 0; i < d.length; i += 4) { s[0] += lin(d[i] / 255); s[1] += lin(d[i + 1] / 255); s[2] += lin(d[i + 2] / 255); n++; } r = s.map(x => x / n);
      } catch (e) { /* a picture that cannot be read: white */ }
      means.set(t, r); return r; };
    const albedo = mt => { const U = mt.userData || {}; if (U.wood) { const A = U.wood.uWLight.value, B = U.wood.uWDark.value; return [(A.r + B.r) / 2, (A.g + B.g) / 2, (A.b + B.b) / 2]; }
      const k = mapMean(mt.map), col = mt.color || { r: 1, g: 1, b: 1 }; return [col.r * k[0], col.g * k[1], col.b * k[2]]; };
    const P = [], C = [], names = {}; let skipped = 0;
    const tri = (alb) => { P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); C.push(alb[0], alb[1], alb[2]); };
    const BOXI = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
    const addGeo = (g, mw, alb) => { const pos = g.attributes.position, ix = g.index, n = ix ? ix.count : pos.count;
      for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(pos, ix ? ix.getX(i) : i).applyMatrix4(mw); b.fromBufferAttribute(pos, ix ? ix.getX(i + 1) : i + 1).applyMatrix4(mw); c.fromBufferAttribute(pos, ix ? ix.getX(i + 2) : i + 2).applyMatrix4(mw); tri(alb); } };
    L.scene.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || !(o.layers.mask & 1)) return; for (let q = o; q; q = q.parent) if (!q.visible) return;
      const mt = [].concat(o.material)[0], g = o.geometry; if (!mt || !(mt.isMeshStandardMaterial || mt.isMeshPhysicalMaterial) || mt.transparent || mt.opacity < 0.9 || !g || !g.attributes.position) return;
      if (o.userData.twin || mt.userData.noBake) return;
      if (!g.boundingBox) g.computeBoundingBox(); const alb = albedo(mt), nt = (g.index ? g.index.count : g.attributes.position.count) / 3, key = (mt.name || mt.type) + ' ' + (o.name || o.parent.name || '');
      if (o.isInstancedMesh) {
        if (nt > 3000) { skipped++; return; }   // (the rug's pile, a tree's leaves)
        const bb = g.boundingBox, col = o.instanceColor, k = [0, 0, 0];
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); v.copy(bb.min).add(bb.max).multiplyScalar(0.5).applyMatrix4(m); if (!inBox(v)) continue;
          const al = col ? [alb[0] * col.getX(i), alb[1] * col.getY(i), alb[2] * col.getZ(i)] : alb;
          if (o.count > 600) { const q = []; for (let j = 0; j < 8; j++) q.push(new T(j & 1 ? bb.max.x : bb.min.x, j & 2 ? bb.max.y : bb.min.y, j & 4 ? bb.max.z : bb.min.z).applyMatrix4(m));
            if (q[0].distanceTo(q[7]) < 0.01) continue;   // (a book put away)
            for (let j = 0; j < 36; j += 3) { a.copy(q[BOXI[j]]); b.copy(q[BOXI[j + 1]]); c.copy(q[BOXI[j + 2]]); tri(al); } }
          else addGeo(g, m, al);
          names[key] = (names[key] || 0) + 1; }
        return;
      }
      v.copy(g.boundingBox.min).add(g.boundingBox.max).multiplyScalar(0.5).applyMatrix4(o.matrixWorld); if (!inBox(v, 0.1)) return;
      addGeo(g, o.matrixWorld, alb); names[key] = (names[key] || 0) + nt;
    });
    window.__bakeP = new Float32Array(P); window.__bakeC = new Float32Array(C);
    return { tris: C.length / 3, box, room: { xL, xW, zB, zF, H }, rects: rects.map((r, i) => ({ ...r, L: [1.15, 1.2, 1.2][i] })), lamps, skipped, names };
  });
  const chunk = async (name) => { const n = await p.evaluate(nm => window[nm].byteLength, name), parts = [], step = 6e6;
    for (let o = 0; o < n; o += step) parts.push(Buffer.from(await p.evaluate(([nm, o, e]) => { const u = new Uint8Array(window[nm].buffer, o, Math.min(e, window[nm].byteLength) - o); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); }, [name, o, o + step]), 'base64'));
    return Buffer.concat(parts); };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'scene.bin'), Buffer.concat([await chunk('__bakeP'), await chunk('__bakeC')]));
  const names = meta.names; delete meta.names; fs.writeFileSync(path.join(OUT, 'scene.json'), JSON.stringify(meta));
  console.log(meta.tris, 'triangles; box', JSON.stringify(meta.box), '; lamps', meta.lamps.length, '; left out (too fine to count as boxes):', meta.skipped);
  console.log(Object.entries(names).sort((x, y) => y[1] - x[1]).slice(0, 40).map(([k, n]) => `${n} ${k}`).join('\n'));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
