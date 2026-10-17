import './velvet.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { R, tick } from '../core/base.js';
import { MAT } from './materials.js';
import { room } from './room.js';
import { poufGeometry } from './pouf.js';
import { buildRug } from './rug.js';
import { candleJar, floorLamp, pendantLamp, plant, stumpTable, tableLamp } from './furniture.js';
import { LIGHTS } from './lights.js';
import { paintLightly } from '../fx/post.js';
import { bolsterGeometry, makeVelvet } from './velvet.js';

/* contact AO baked into vertex colour: nearest occluding point of another part in front of the surface,
   plus a darkening towards the floor. Parts are compared in world space.                                 */
function bakeContactAO(targets, occluders, { R = 0.11, strength = 0.78, floorFade = 0.16 } = {}) {
  const cell = R, key = (x, y, z) => ((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096); const grid = new Map(); const v = new THREE.Vector3(), nv = new THREE.Vector3();
  for (const { mesh, id } of occluders) {
    mesh.updateWorldMatrix(true, false); const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); const k = key(Math.floor(v.x / cell), Math.floor(v.y / cell), Math.floor(v.z / cell)); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(v.x, v.y, v.z, id); }
  }
  for (const { mesh, id } of targets) {
    mesh.updateWorldMatrix(true, false); const g = mesh.geometry, p = g.attributes.position, n = g.attributes.normal; const col = new Float32Array(p.count * 3);
    const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); nv.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      const cx = Math.floor(v.x / cell), cy = Math.floor(v.y / cell), cz = Math.floor(v.z / cell); let occ = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const a = grid.get(key(cx + dx, cy + dy, cz + dz)); if (!a) continue;
        for (let j = 0; j < a.length; j += 4) {
          if (a[j + 3] === id) continue; const qx = a[j] - v.x, qy = a[j + 1] - v.y, qz = a[j + 2] - v.z; const d = Math.sqrt(qx * qx + qy * qy + qz * qz);
          if (d > R || d < 1e-5) continue; const c = (qx * nv.x + qy * nv.y + qz * nv.z) / d; if (c < 0.1) continue;
          const w = 1 - d / R; occ = Math.max(occ, w * w * (0.35 + 0.65 * c));
        }
      }
      const ao = (1 - strength * occ) * THREE.MathUtils.lerp(0.5, 1, THREE.MathUtils.smoothstep(v.y, 0, floorFade));
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
}
function flatBook(src, yaw = 0, s = 1) {
  // GLB books stand upright (thickness x, height y, depth z): lay them on the cover, bottom-centre at the origin
  const m = new THREE.Mesh(src.geometry, src.material); m.rotation.set(0, 0, Math.PI / 2); m.scale.setScalar(s); m.castShadow = m.receiveShadow = true;
  const inner = new THREE.Group(); inner.add(m); inner.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(m); const c = b.getCenter(new THREE.Vector3());
  m.position.set(-c.x, -b.min.y, -c.z); const g = new THREE.Group(); g.add(inner); inner.rotation.y = yaw; g.userData.h = b.max.y - b.min.y; return g;
}
async function buildFurniture(A) {   // async: it yields between its heavy parts so the page stays responsive while it loads
  const F = new THREE.Group(); room.add(F); const B = A.byName;
  // ---- sofa (re-arranged sectional, one mesh per part): local back at z=0, left end at x=0
  const sofa = new THREE.Group(); const S = 0.92; sofa.scale.setScalar(S);
  sofa.position.set(R.xS - 3.7213 * S, 0, R.zB + R.caseD + 0.26); F.add(sofa);
  const ref = B.sofa_seat_mid.material; const nS = ref.normalScale.clone();
  MAT.sofaCushion = makeVelvet({ color: 0x40603f, sheen: 0xdfe6c4, sheenAmt: 1, map: ref.map, normalMap: ref.normalMap, normalScale: nS.clone().multiplyScalar(0.9), ao: true, pleat: 1, crease: 1, seam: 1, freq: 1, dent: true });   // (gives under the cat)
  MAT.sofaBack = makeVelvet({ color: 0x40603f, sheen: 0xdfe6c4, sheenAmt: 1, map: ref.map, normalMap: ref.normalMap, normalScale: nS.clone().multiplyScalar(0.9), ao: true, pleat: 0, crease: 0.8, allFaces: 1, seam: 1, freq: 1 });
  MAT.sofaFrame = makeVelvet({ color: 0x3b5a3c, sheen: 0xd6dfbd, sheenAmt: 1, map: ref.map, normalMap: ref.normalMap, normalScale: nS.clone().multiplyScalar(0.7), ao: true, pleat: 0, crease: 0.35, freq: 1 });
  const parts = [], aoT = [], aoO = []; let pid = 0;
  for (const m of Object.values(B)) {
    if (!m.name.startsWith('sofa_') || m.name === 'sofa_legs') continue;
    const mat = /seat/.test(m.name) ? MAT.sofaCushion : /back|arm|pillow/.test(m.name) ? MAT.sofaBack : MAT.sofaFrame;
    const mesh = new THREE.Mesh(m.geometry.clone(), mat); mesh.name = m.name; mesh.castShadow = mesh.receiveShadow = true;
    sofa.add(mesh); parts.push(mesh); const e = { mesh, id: ++pid }; aoT.push(e); aoO.push(e);
  }
  // recessed dark plinth instead of the little leg cubes
  { const plinthMat = new THREE.MeshStandardMaterial({ color: 0x1d2419, roughness: 1 });
    const fp = (names) => { const b = new THREE.Box3(); for (const n of names) { B[n].geometry.computeBoundingBox(); b.union(B[n].geometry.boundingBox); } return b; };
    for (const b of [fp(['sofa_frame_end', 'sofa_frame_mid', 'sofa_frame_corner']), fp(['sofa_base_chaise'])]) {
      const w = b.max.x - b.min.x - 0.09, d = b.max.z - b.min.z - 0.09; const pl = new THREE.Mesh(new THREE.BoxGeometry(w, 0.075, d), plinthMat);
      pl.position.set((b.min.x + b.max.x) / 2, 0.0375, (b.min.z + b.max.z) / 2); pl.receiveShadow = true; sofa.add(pl); } }
  // bolsters (as in the painting: a roll at the right end, one against the left arm)
  MAT.bolster = makeVelvet({ color: 0x37563a, sheen: 0xd3ddb9, sheenAmt: 1, ao: true, pleat: 0, crease: 0.5, freq: 1 });
  const bol = (x, y, z, ry, rx, L, Rr, seed) => { const m = new THREE.Mesh(bolsterGeometry(L, Rr, seed), MAT.bolster); m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); m.castShadow = m.receiveShadow = true; sofa.add(m); const e = { mesh: m, id: ++pid }; aoT.push(e); aoO.push(e); return m; };
  bol(3.13, 0.585, 0.78, Math.PI / 2, -0.08, 0.66, 0.14, 3);
  bol(0.53, 0.575, 0.84, Math.PI / 2, 0.05, 0.62, 0.13, 8);
  // pillows from the modern sofa (square ones = pillow_1..4), velvet with their own sewn-seam normal maps
  MAT.pillowMustard = makeVelvet({ color: 0x96703f, sheen: 0xd9c296, sheenAmt: 0.9, rough: 0.97, ao: true, pleat: 0, crease: 0.45, allFaces: 1, freq: 1.8 });
  MAT.pillowGreen = makeVelvet({ color: 0x37573a, sheen: 0xcfdab4, sheenAmt: 1, ao: true, pleat: 0, crease: 0.45, allFaces: 1, freq: 1.8 });
  const pilMats = new Map();
  const pil = (name, base, x, y, z, ry, rx, rz, s) => {
    const src = B[name]; let mat = base;
    if (src.material.normalMap) { const k = base.uuid + name; if (!pilMats.has(k)) { const c = base.clone(); c.onBeforeCompile = base.onBeforeCompile; c.userData = base.userData; c.normalMap = src.material.normalMap; c.normalScale = src.material.normalScale.clone().multiplyScalar(1.3); pilMats.set(k, c); } mat = pilMats.get(k); }
    const m = new THREE.Mesh(src.geometry.clone(), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz, 'YXZ'); m.scale.setScalar(s); m.castShadow = m.receiveShadow = true; F.add(m);
    const e = { mesh: m, id: ++pid }; aoT.push(e); aoO.push(e); return m; };
  const zb = sofa.position.z, x0 = sofa.position.x, seatY = 0.43 * S;
  // along the back (left → right)
  pil('pillow_1', MAT.pillowMustard, x0 + 0.62, seatY - 0.02, zb + 0.6, 0.1, -0.3, 0.12, 2.0);
  pil('pillow_2', MAT.pillowMustard, x0 + 1.22, seatY - 0.03, zb + 0.6, -0.05, -0.32, -0.05, 1.75);
  pil('pillow_3', MAT.pillowGreen, x0 + 1.72, seatY - 0.02, zb + 0.58, 0.08, -0.25, 0.06, 1.7);
  pil('pillow_4', MAT.pillowMustard, x0 + 2.52, seatY - 0.03, zb + 0.6, 0.15, -0.3, 0.1, 1.65);
  pil('pillow_2', MAT.pillowMustard, x0 + 3.0, seatY - 0.02, zb + 0.6, -0.2, -0.3, -0.08, 1.85);
  F.updateMatrixWorld(true);
  bakeContactAO(aoT, aoO);
  F.userData.sofa = sofa; LIGHTS.sofa = sofa;
  await tick();
  // ---- coffee table (GLB, scaled to an oval) + wooden legs
  const tbl = new THREE.Group(); const tS = new THREE.Vector3(0.95 / 2, 0.42 / 0.907, 0.6 / 2);
  const topMat = B.ctable_top.material.clone(); topMat.color.setRGB(1.55, 1.2, 0.85); topMat.roughness = .55; topMat.metalness = 0; topMat.metalnessMap = topMat.roughnessMap = null;
  for (const n of ['ctable_top', 'ctable_legs']) { const m = new THREE.Mesh(B[n].geometry, n === 'ctable_top' ? topMat : MAT.oak); m.scale.copy(tS); m.castShadow = m.receiveShadow = true; tbl.add(m); }
  tbl.position.set(-0.32, 0, -6.3); tbl.rotation.y = 0.05; F.add(tbl);
  const lamp = tableLamp(); lamp.position.set(-0.6, 0.42, -6.47); F.add(lamp); LIGHTS.table = lamp;
  paintLightly(lamp);   // (75 % less watercolour on it too: G, 17/10/2026)
  const cj = candleJar(); cj.position.set(-0.72, 0.42, -6.25); F.add(cj); LIGHTS.candle = cj;
  const tb1 = flatBook(B.book_book002, 0.35 + Math.PI / 2, 1.15); tb1.position.set(-0.13, 0.42, -6.22); F.add(tb1);
  const tb2 = flatBook(B.book_book01, 0.2 + Math.PI / 2, 1.1); tb2.position.set(-0.13, 0.42 + tb1.userData.h, -6.21); F.add(tb2);
  paintLightly(tb1, 0.1); paintLightly(tb2, 0.1);   // (every book 10 % less watercolour: G, 17/10/2026)
  // ---- floor lamp in the back-right corner, behind the sofa
  const fl = floorLamp(); fl.position.set(R.xS - 0.28, 0, R.zB + R.caseD + 0.16); fl.rotation.y = -0.15; F.add(fl); LIGHTS.floor = fl;
  paintLightly(fl);   // (75 % less watercolour on it: G, 16/10/2026)
  // ---- a bare bulb hanging over the front of the sofa's seat: from the room's first view it is seen above the RESEARCH
  // caption, between two posts of the back glass (G, 17/10/2026: his screenshot, ~2077 × 1500 CSS px), its middle 3.27 m up
  const pd = pendantLamp(R.H - 3.27); pd.position.set(0.43, R.H, -7.2); F.add(pd); LIGHTS.pendant = pd;
  paintLightly(pd, 0.875);   // (75 % less watercolour, then half of what was left: G, 17/10/2026)
  // ---- stump side table + plant
  const st = stumpTable(); st.position.set(R.xL + 0.32, 0, -5.85); F.add(st);
  const pot = new THREE.Mesh(new THREE.LatheGeometry([[.001, 0], [.1, 0], [.14, .05], [.15, .11], [.14, .12]].map(p => new THREE.Vector2(p[0], p[1])), 28), MAT.stone); pot.position.set(R.xL + 0.28, 0.53, -5.98); pot.castShadow = true; F.add(pot);
  const pl = plant({ leaves: 120, spread: 0.55, height: 0.7, seed: 11, scale: 0.13 }); pl.position.set(R.xL + 0.28, 0.6, -5.98); F.add(pl);
  for (const o of [st, pot, pl]) paintLightly(o, 0.5);   // (the plant, its pot and its stump: 50 % less watercolour, G, 17/10/2026)
  // ---- rug + pouf + books on it
  MAT.pouf = makeVelvet({ color: 0x30553c, sheen: 0xd6e6cf, sheenAmt: 1, sheenRough: 0.5, pleat: 0, crease: 1.1, allFaces: 1, freq: 1.6, ao: true });   // fine crumple shading between the modelled folds
  const pouf = new THREE.Mesh(poufGeometry(1.4, 1.22, 0.5), MAT.pouf);
  pouf.position.set(0.22, 0.008, -3.36); pouf.rotation.y = 0.1; pouf.castShadow = pouf.receiveShadow = true; F.add(pouf);
  await tick();
  LIGHTS.rug = buildRug(F, pouf);
  await tick();
  { const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pouf.geometry.userData.seam, true), 420, 0.006, 6, true); const c = new Float32Array(tg.attributes.position.count * 3).fill(0.62); tg.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const cord = new THREE.Mesh(tg, MAT.pouf); cord.castShadow = true; pouf.add(cord); }
  pouf.updateMatrixWorld(true);
  // books rest on the folds: sample the cushion under the book's corners and fit the tilt
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  const hitY = (x, z) => { ray.set(new THREE.Vector3(x, 2, z), down); const h = ray.intersectObject(pouf, false)[0]; return h ? h.point.y : 0.5; };
  const restOn = (obj, x, z, yaw, hw, hd) => {
    const c = Math.cos(yaw), s2 = Math.sin(yaw), pt = (u, v) => [x + u * c + v * s2, z - u * s2 + v * c];
    const ys = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => { const [px, pz] = pt(u, v); return hitY(px, pz); });
    const mean = ys.reduce((q, w) => q + w, 0) / 4, y = mean + 0.35 * (Math.max(...ys) - mean),   // the cushion is pressed flat under it below
      tiltX = Math.atan2(((ys[2] + ys[3]) - (ys[0] + ys[1])) / 2, 2 * hd), tiltZ = Math.atan2(((ys[1] + ys[2]) - (ys[0] + ys[3])) / 2, 2 * hw);
    obj.position.set(x, y, z); obj.rotation.set(-tiltX, yaw, tiltZ, 'YXZ'); F.add(obj); return y; };
  const toW = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), pouf.rotation.y).add(pouf.position);
  const b1 = flatBook(B.book_book002, Math.PI / 2, 1.5), b2 = flatBook(B.book_book005, Math.PI / 2 + 0.07, 1.42), b3 = flatBook(B.book_book006, Math.PI / 2, 1.55);
  for (const b of [b1, b2, b3]) paintLightly(b, 0.1);
  { const p = toW(-0.17, -0.22); restOn(b1, p.x, p.z, 0.22, 0.13, 0.17); }
  const y2 = b1.position.y + b1.userData.h; b2.position.set(b1.position.x + 0.006, y2, b1.position.z - 0.004); b2.rotation.copy(b1.rotation); b2.rotation.y += 0.06; F.add(b2);
  { const p = toW(-0.33, 0.05); restOn(b3, p.x, p.z, 0.36, 0.14, 0.19); }
  // the weight of a book flattens the velvet under it; the fabric rises softly around its edges
  const pressUnder = (book, hw, hd) => {
    book.updateMatrixWorld(true); const inv = book.matrixWorld.clone().invert(), back = pouf.matrixWorld.clone().invert().multiply(book.matrixWorld);
    const Pp = pouf.geometry.attributes.position, v = new THREE.Vector3(), m = 0.06;
    for (let i = 0; i < Pp.count; i++) { v.fromBufferAttribute(Pp, i).applyMatrix4(pouf.matrixWorld).applyMatrix4(inv);
      const out = Math.hypot(Math.max(0, Math.abs(v.x) - hw), Math.max(0, Math.abs(v.z) - hd)); if (out > m || v.y < -0.12) continue;
      const allowed = -0.002 + (out / m) * (out / m) * 0.045; if (v.y > allowed) { v.y = allowed; v.applyMatrix4(back); Pp.setXYZ(i, v.x, v.y, v.z); } }
    Pp.needsUpdate = true; };
  pressUnder(b1, 0.13, 0.17); pressUnder(b3, 0.14, 0.19); pouf.geometry.computeVertexNormals(); pouf.geometry.computeBoundingSphere();
  // some GLB hardcovers face-out on the shelf
  return F;
}

export { buildFurniture };
