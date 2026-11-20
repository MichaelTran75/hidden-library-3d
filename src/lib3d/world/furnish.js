import './velvet.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { PARTS, R, tick } from '../core/base.js';
import { MAT } from './materials.js';
import { canvas, ctex } from '../core/utils.js';
import { cornerStrip, room } from './room.js';
import { poufGeometry } from './pouf.js';
import { buildRug } from './rug.js';
import { candleJar, floorLamp, pendantLamp, plant, plantTouch, planter, stumpTable, tableLamp } from './furniture.js';
import { LIGHTS } from './lights.js';
import { inkBox, paintLightly } from '../fx/post.js';
import { POKE, bolsterGeometry, makeVelvet, setNap } from './velvet.js';
import { makeWood } from './wood.js';

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
/* a magazine lying on soft things (a pouf, a book on it): W across (x) by D deep (z), T thick, its middle at c, turned by
   yaw. Each point of a grid over it finds what is under it (rays down onto `under`); the sheet then settles as paper
   does: it rests on what is highest and spans across between, its weight bending it down over the edges (each point no
   lower than what is under it, eased toward its neighbours' height and let sink a little, over and over). Its cover (group 0) is userData.cover, its picture
   set later (world/gardenbook.js); the back (1) and the page edges (2) round it. */
function magazine(W, D, T, c, yaw, under) {
  const nx = 30, nz = 24, ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), cs = Math.cos(yaw), sn = Math.sin(yaw);
  const at = (i, j) => { const u = (i / nx - 0.5) * W, v = (j / nz - 0.5) * D; return [c.x + u * cs + v * sn, c.z - u * sn + v * cs, u, v]; };
  const floor = new Float32Array((nx + 1) * (nz + 1)).fill(-1e9); let h;
  // what is under it: the pouf by its own vertices laid on the grid (its mesh is dense: rays into it took ~6 s), the
  // books by rays (they have few triangles)
  const cell = (x, z) => { const dx = x - c.x, dz = z - c.z; return [Math.round(((dx * cs - dz * sn) / W + 0.5) * nx), Math.round(((dx * sn + dz * cs) / D + 0.5) * nz)]; };
  const [soft, ...hard] = under, sp = soft.geometry.attributes.position, sv = new THREE.Vector3(); soft.updateMatrixWorld(true);
  for (let k = 0; k < sp.count; k++) { sv.fromBufferAttribute(sp, k).applyMatrix4(soft.matrixWorld); const [i, j] = cell(sv.x, sv.z); if (i < 0 || j < 0 || i > nx || j > nz) continue; const q = j * (nx + 1) + i; if (sv.y > floor[q]) floor[q] = sv.y; }
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const [x, z] = at(i, j), q = j * (nx + 1) + i; ray.set(new THREE.Vector3(x, 2, z), down); const hit = ray.intersectObjects(hard, true)[0]; if (hit && hit.point.y > floor[q]) floor[q] = hit.point.y; }
  for (let pass = 0; pass < 6; pass++) for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const q = j * (nx + 1) + i; if (floor[q] > -1e8) continue;   // (cells no vertex fell in: their neighbours' height)
    let m = -1e9; for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) if (a >= 0 && a <= nx && b >= 0 && b <= nz) m = Math.max(m, floor[b * (nx + 1) + a]); floor[q] = m; }
  for (let q = 0; q < floor.length; q++) floor[q] = (floor[q] > -1e8 ? floor[q] : 0.5) + 0.0015;
  h = floor.slice();
  // too stiff to go down into the cushion's small folds: it rests on their tops (the highest point within ~6 cm)
  { const f = floor.slice(), R = 3; for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { let m = -1e9; for (let b = Math.max(0, j - R); b <= Math.min(nz, j + R); b++) for (let a = Math.max(0, i - R); a <= Math.min(nx, i + R); a++) m = Math.max(m, f[b * (nx + 1) + a]); floor[j * (nx + 1) + i] = m; h[j * (nx + 1) + i] = m; } }
  for (let it = 0; it < 160; it++) {   // (and its weight: it sinks a little each round where nothing holds it up)
    const n = new Float32Array(h.length);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { let s = 0, k = 0; for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) if (a >= 0 && a <= nx && b >= 0 && b <= nz) { s += h[b * (nx + 1) + a]; k++; }
      const q = j * (nx + 1) + i; n[q] = Math.max(floor[q], 0.5 * h[q] + 0.5 * s / k - 0.0003); }
    h = n;
  }
  const pos = [], uv = [], idx = [], groups = [], g = new THREE.BufferGeometry();
  const quadGrid = (yOff, flip) => { const o = pos.length / 3; for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const [x, z] = at(i, j); pos.push(x - c.x, h[j * (nx + 1) + i] + yOff, z - c.z); uv.push(i / nx, 1 - j / nz); }
    const s0 = idx.length; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = o + j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1; if (flip) idx.push(a, b, d, b, e, d); else idx.push(a, d, b, b, d, e); } return [s0, idx.length - s0]; };
  groups.push(quadGrid(T, false), quadGrid(0, true));
  // the edges: round the rim, from the back's height to the cover's
  const rim = []; for (let i = 0; i <= nx; i++) rim.push([i, 0]); for (let j = 1; j <= nz; j++) rim.push([nx, j]); for (let i = nx - 1; i >= 0; i--) rim.push([i, nz]); for (let j = nz - 1; j >= 0; j--) rim.push([0, j]);
  const o = pos.length / 3; rim.forEach(([i, j], k) => { const [x, z] = at(i, j), y = h[j * (nx + 1) + i]; pos.push(x - c.x, y, z - c.z, x - c.x, y + T, z - c.z); uv.push(k / rim.length, 0, k / rim.length, 1); });
  const s0 = idx.length; for (let k = 0; k < rim.length - 1; k++) { const a = o + 2 * k; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } groups.push([s0, idx.length - s0]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  groups.forEach(([s, n], m) => g.addGroup(s, n, m)); g.computeVertexNormals();
  const mats = [new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0 }), new THREE.MeshStandardMaterial({ color: 0xd9ccb2, roughness: 0.4, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0xe2d6c0, roughness: 0.85, metalness: 0 })];   // (a glossy cover; its back; the pages' edges, the page's paper colour)
  const mesh = new THREE.Mesh(g, mats); mesh.castShadow = mesh.receiveShadow = true;
  const grp = new THREE.Group(); grp.position.set(c.x, 0, c.z); grp.add(mesh); grp.userData.cover = mesh; grp.userData.ar = W / D; grp.userData.h = T;
  return grp;
}
async function buildFurniture(A) {   // async: it yields between its heavy parts so the page stays responsive while it loads
  const F = new THREE.Group(); room.add(F); const B = A.byName;
  // ---- sofa (re-arranged sectional, one mesh per part): local back at z=0, left end at x=0
  const sofa = new THREE.Group(); const S = 0.92; sofa.scale.setScalar(S);
  sofa.position.set(R.xS - 3.7213 * S, 0, R.zB + R.caseD + 0.26); F.add(sofa);
  const ref = B.sofa_seat_mid.material; const nS = ref.normalScale.clone();
  // (the seat cushions: no gathered pleats round them, which read as stripes, but the wear of use: velvet.js wearH; each
  // module's pile its own way: setNap)
  // (the sofa's velvet 20 % darker, twice: 0x40603f and 0x3b5a3c times 0.8, then 0.8 again, in sRGB)
  // (velvet, not satin: a broad dull glow (sheenRough 0.72) and next to no gloss; its pile's grain, mottle and strokes are the material's own, velvet.js)
  MAT.sofaCushion = makeVelvet({ sheenRough: 0.72, spec: 0.03, color: 0x293e28, sheen: 0xdfe6c4, sheenAmt: 0.8, map: ref.map, normalMap: ref.normalMap, normalScale: nS.clone().multiplyScalar(0.9), ao: true, pleat: 0, crease: 1, seam: 1.4, freq: 1, dent: true, wear: true });   // (gives under the cat)
  MAT.sofaBack = makeVelvet({ sheenRough: 0.72, spec: 0.03, color: 0x293e28, sheen: 0xdfe6c4, sheenAmt: 0.8, map: ref.map, normalMap: ref.normalMap, normalScale: nS.clone().multiplyScalar(0.9), ao: true, pleat: 0, crease: 0.8, allFaces: 1, seam: 1.4, freq: 1, nap: true });
  // (the right arm: as the back, with its edges lined)
  MAT.sofaArm = makeVelvet({ sheenRough: 0.72, spec: 0.03, color: 0x293e28, sheen: 0xdfe6c4, sheenAmt: 0.8, map: ref.map, normalMap: ref.normalMap, normalScale: nS.clone().multiplyScalar(0.9), ao: true, pleat: 0, crease: 0.8, allFaces: 1, seam: 1.4, freq: 1, nap: true });
  MAT.sofaFrame = makeVelvet({ sheenRough: 0.72, spec: 0.03, color: 0x263a26, sheen: 0xd6dfbd, sheenAmt: 0.8, map: ref.map, normalMap: ref.normalMap, normalScale: nS.clone().multiplyScalar(0.7), ao: true, pleat: 0, crease: 0.35, freq: 1, nap: true });
  const parts = [], aoT = [], aoO = []; let pid = 0;
  const NAP = { sofa_seat_end: 1.07, sofa_seat_mid: 0.93, sofa_seat_corner: 1.03, sofa_seat_chaise: 0.9, sofa_back_end: 0.95, sofa_back_mid: 1.05, sofa_back_corner: 0.97, sofa_back_side: 1.04, sofa_arm: 1.02, sofa_pillow: 0.96 };   // (each module's pile its own way)
  for (const m of Object.values(B)) {
    if (!m.name.startsWith('sofa_') || m.name === 'sofa_legs' || m.name === 'sofa_pillow') continue;   // (its green pillow by the right arm left out)
    const mat = m.name === 'sofa_back_side' ? MAT.sofaArm : /seat/.test(m.name) ? MAT.sofaCushion : /back|arm|pillow/.test(m.name) ? MAT.sofaBack : MAT.sofaFrame;
    const mesh = new THREE.Mesh(m.geometry.clone(), mat); mesh.name = m.name; mesh.castShadow = mesh.receiveShadow = true;
    setNap(mesh.geometry, NAP[m.name] ?? 1);
    sofa.add(mesh); parts.push(mesh); const e = { mesh, id: ++pid }; aoT.push(e); aoO.push(e);
  }
  // recessed dark plinth instead of the little leg cubes
  { const plinthMat = new THREE.MeshStandardMaterial({ color: 0x0b0d09, roughness: 1 });   // (0x1d2419, then darker, for crisp black lines there)
    const outlines = [];
    const fp = (names) => { const b = new THREE.Box3(); for (const n of names) { B[n].geometry.computeBoundingBox(); b.union(B[n].geometry.boundingBox); } return b; };
    for (const b of [fp(['sofa_frame_end', 'sofa_frame_mid', 'sofa_frame_corner']), fp(['sofa_base_chaise'])]) {
      const w = b.max.x - b.min.x - 0.09, d = b.max.z - b.min.z - 0.09; const pl = new THREE.Mesh(new THREE.BoxGeometry(w, 0.075, d), plinthMat);
      pl.position.set((b.min.x + b.max.x) / 2, 0.0375, (b.min.z + b.max.z) / 2); pl.receiveShadow = true; sofa.add(pl); outlines.push(b); }
    sofa.updateWorldMatrix(true, true); const V = THREE.Vector3;   // (no drawn line on the floor round its foot: the plinth's own contact shade is enough)
    // and black lines just where they belong: up the right arm's front inner edge, and up the seam where that arm meets the tall shelf
    const box = n => { const m = sofa.getObjectByName(n); return m ? new THREE.Box3().setFromObject(m) : null; }, ch = box('sofa_seat_chaise'), arm = box('sofa_back_side');
    if (arm) {
      const zf = arm.max.z, y0 = ch ? ch.max.y : 0.43;
      // (its edges inked in the paint pass, in their box only; and the gap behind it, by the shelf, darkened)
      inkBox(0, arm.min.clone().addScalar(-0.012), arm.max.clone().addScalar(0.012));
      cornerStrip([R.xS, y0, arm.min.z], [R.xS, arm.max.y, arm.min.z], new V(0, 0, 1), new V(-1, 0, 0), arm.max.z - arm.min.z, 0.02);
    } }
  // bolsters (as in the painting: a roll at the right end, one against the left arm)
  // (every pillow 50 % darker, the bolsters from the sofa's first step (0x37563a times 0.8, then 0.5), the square ones from
  // 0x96703f and 0x37573a)
  MAT.bolster = makeVelvet({ color: 0x162217, sheen: 0xd3ddb9, sheenAmt: 1, ao: true, pleat: 0, crease: 0.5, freq: 1 });
  const bol = (x, y, z, ry, rx, L, Rr, seed) => { const m = new THREE.Mesh(bolsterGeometry(L, Rr, seed), MAT.bolster); m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); m.castShadow = m.receiveShadow = true; sofa.add(m); const e = { mesh: m, id: ++pid }; aoT.push(e); aoO.push(e); return m; };
  // (the roll at the right end left out: only the yellow pillows kept)
  bol(0.53, 0.575, 0.84, Math.PI / 2, 0.05, 0.62, 0.13, 8);
  // pillows from the modern sofa (square ones = pillow_1..4), velvet with their own sewn-seam normal maps
  MAT.pillowMustard = makeVelvet({ color: 0x4b3820, sheen: 0xd9c296, sheenAmt: 0.9, rough: 0.97, ao: true, pleat: 0, crease: 0.45, allFaces: 1, freq: 1.8 });
  MAT.pillowGreen = makeVelvet({ color: 0x1c2c1d, sheen: 0xcfdab4, sheenAmt: 1, ao: true, pleat: 0, crease: 0.45, allFaces: 1, freq: 1.8 });
  const pilMats = new Map();
  const pil = (name, base, x, y, z, ry, rx, rz, s) => {
    const src = B[name]; let mat = base;
    if (src.material.normalMap) { const k = base.uuid + name; if (!pilMats.has(k)) { const c = base.clone(); c.onBeforeCompile = base.onBeforeCompile; c.userData = base.userData; c.normalMap = src.material.normalMap; c.normalScale = src.material.normalScale.clone().multiplyScalar(1.3); pilMats.set(k, c); } mat = pilMats.get(k); }
    const m = new THREE.Mesh(src.geometry.clone(), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz, 'YXZ'); m.scale.setScalar(s); m.castShadow = m.receiveShadow = true; F.add(m); POKE.on.push(m);
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
  paintLightly(sofa, 1); for (const e of aoT) if (e.mesh.parent === F) paintLightly(e.mesh, 1);   // (the sofa, its bolsters and its pillows 30 % less watercolour; then 90 % less of what was left, then none)
  await tick();
  // ---- coffee table (GLB, scaled to an oval) + wooden legs
  const tbl = new THREE.Group(); const tS = new THREE.Vector3(0.95 / 2, 0.42 / 0.907, 0.6 / 2);
  // its top: boards of a red-brown hardwood glued side by side along its length, oiled; its legs a paler wood, their grain
  // up them (solid wood, no picture: wood.js)
  B.ctable_top.geometry.computeBoundingBox(); const yTop = B.ctable_top.geometry.boundingBox.max.y * tS.y;
  const topMat = makeWood({ light: 0x7c4627, dark: 0x3d1f0f, scale: tS.toArray(), grain: 'x', pith: [0, yTop], plank: 0.105, ring: 0.007, rough: 0.4 });
  const legMat = makeWood({ light: 0xb98b55, dark: 0x7e5628, scale: tS.toArray(), grain: 'y', pith: [0.9, 0.4], ring: 0.004, rough: 0.5 });
  for (const n of ['ctable_top', 'ctable_legs']) { const m = new THREE.Mesh(B[n].geometry, n === 'ctable_top' ? topMat : legMat); m.scale.copy(tS); m.castShadow = m.receiveShadow = true; tbl.add(m); }
  tbl.position.set(-0.32, 0, -6.3); tbl.rotation.y = 0.05; F.add(tbl);
  const lamp = tableLamp(); lamp.position.set(-0.52, 0.42, -6.4); F.add(lamp); LIGHTS.table = lamp; paintLightly(lamp, 0.6);   // (moved in from the table's edge, 82 % of the way out to 54 %)
  paintLightly(lamp, 0.975);   // (75 % less watercolour on it too; then 90 % less of what was left)
  // (the candle jar by the lamp, hidden behind it from every view, left out)
  const tb1 = flatBook(B.book_book002, 0.35 + Math.PI / 2, 1.15); tb1.position.set(-0.13, 0.42, -6.22); F.add(tb1);
  const tb2 = flatBook(B.book_book01, 0.2 + Math.PI / 2, 1.1); tb2.position.set(-0.13, 0.42 + tb1.userData.h, -6.21); F.add(tb2);
  paintLightly(tb1, 0.99986); paintLightly(tb2, 0.99986);   // (every book 10 % less watercolour; 10 % less again; these on the table 60 % less of what was left; with every book, half of what was left, three times, then these two 80 % less again; with every book 30 % less, then half, and these half again, then 90 % less)
  // ---- floor lamp in the back-right corner, behind the sofa, turned so its shade hangs over the seat (it
  // reached along the bookcase, its shade among the books); its
  // counterweight arm shorter, so it stays clear of the bookcase behind it
  const fl = floorLamp(0.16); fl.position.set(R.xS - 0.28, 0, R.zB + R.caseD + 0.16); fl.rotation.y = 1.0; F.add(fl); LIGHTS.floor = fl;
  {   // its shade looking down on the seat, a little toward the room, as a reading lamp's (its light with it)
    const sh = fl.userData.glow.parent; fl.updateMatrixWorld(true);
    const pq = sh.parent.getWorldQuaternion(new THREE.Quaternion()).invert(), down = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-0.09, -1, 0.43).normalize());   // (onto the seat in front of the back cushions)
    sh.quaternion.copy(pq.multiply(down));
  }
  paintLightly(fl);   // (75 % less watercolour on it)
  // ---- a bare bulb hanging over the front of the sofa's seat: from the room's first view it is seen above the RESEARCH
  // caption, between two posts of the back glass (a reference screenshot, ~2077 × 1500 CSS px), its middle 3.27 m up, then 3.33 (a little higher);
  // the page's sky clock is centred over it (build.py: 39.92 painting px right of the middle; moved with it)
  const pd = pendantLamp((R.H - 3.33) * 0.8); pd.position.set(0.43, R.H, -7.2); F.add(pd); LIGHTS.pendant = pd;   // (hung 20 % higher, its cord a fifth shorter)
  paintLightly(pd, 0.5);
  {   // the floor lamp's bulb: the pendant's (its base, glass, stem, wires, coil and socket) at the model's own size (15.2 cm), base up
      // in the shade, its glass's lower half out under the rim (the glass's middle 25.5 cm down, the rim at 25), so it is seen; its glass and coil its own
      // (lit by the hour, not by the pointer over the pendant: fx/hour.js), and its filament's sprite as the pendant's
    const sh = fl.userData.glow.parent, src = pd.userData.bulb, nb = src.clone(true), was = [], now = [];
    src.traverse(o => { if (o.isMesh) was.push(o.material); }); nb.traverse(o => { if (o.isMesh) now.push(o); });
    now.forEach((o, i) => { const m = was[i]; o.castShadow = false; if (m.emissive) { o.material = m.clone(); o.material.onBeforeCompile = m.onBeforeCompile; o.material.customProgramCacheKey = m.customProgramCacheKey; } });
    nb.scale.setScalar(1); nb.rotation.set(Math.PI, 0, 0); nb.position.set(0, -.15, 0); sh.add(nb); paintLightly(nb);   // (as the lamp: 75 % less watercolour)
    const fil = new THREE.Sprite(pd.userData.fil.material.clone()); fil.scale.setScalar(.26); fil.position.y = -.251; fil.renderOrder = 5; sh.add(fil);
    fl.userData.bulb = { glass: now.find(o => o.material.emissive && o.material.transparent).material, coil: now.find(o => o.material.emissive && !o.material.transparent).material, fil };
  }   // (75 % less watercolour, then half of what was left; back to half)
  // ---- stump side table + plant
  const st = stumpTable(); st.position.set(R.xL + 0.32, 0, -5.85); F.add(st);
  const pot = planter(); pot.position.set(R.xL + 0.32, 0.53, -5.85); pot.rotation.y = 0.7; F.add(pot);
  const pl = plant({ leaves: 120, spread: 0.55, height: 0.7, seed: 11, scale: 0.13 }); pl.position.set(R.xL + 0.32, 0.6, -5.85); F.add(pl);   // (the pot and plant in the middle of the stump)
  paintLightly(st, 0.5); paintLightly(pl, 0.75); paintLightly(pot, 0.95);   // (the plant: half as much watercolour again as the stump keeps)
  plantTouch(pl);   // (its leaves stir under the pointer: furniture.js)   // (the plant, its pot and its stump: 50 % less watercolour; the pot 90 % less of what was left)
  // ---- rug + pouf + books on it
  // (the sofa's colour, sheen and fluffy pile, and its watercolour; was 0x30553c; then 30 % lighter than the sofa's 0x293e28; 0x355134, then 30 % lighter again; 0x456944, then 30 % darker once its pile was gone)
  MAT.pouf = makeVelvet({ aoSharp: true, broad: true, color: 0x304a30, sheen: 0xdfe6c4, sheenAmt: 1, sheenRough: 0.5, pleat: 0, crease: 1.1, allFaces: 1, freq: 1.6, ao: true });   // fine crumple shading between the modelled folds
  const pouf = new THREE.Mesh(poufGeometry(1.4, 1.22, 0.5), MAT.pouf);
  pouf.position.set(0.22, 0.008, -3.36); pouf.rotation.y = 0.1; pouf.castShadow = pouf.receiveShadow = true; F.add(pouf);
  paintLightly(pouf, 1);   // (its fluffy pile taken off again, as the sofa's)   // (as the sofa: 90 % less watercolour of what was left, then none)
  await tick();
  LIGHTS.rug = buildRug(F, pouf); paintLightly(LIGHTS.rug, 1);   // (90 % less watercolour, then none)
  await tick();
  { const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pouf.geometry.userData.seam, true), 420, 0.006, 6, true); const c = new Float32Array(tg.attributes.position.count * 3).fill(0.62); tg.setAttribute('color', new THREE.BufferAttribute(c, 3)); tg.setAttribute('aBroadN', tg.attributes.normal);   // (the pouf's velvet reads a broad normal: the cord's own)
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
  const b1 = flatBook(B.book_book002, Math.PI / 2, 1.5), b3 = flatBook(B.book_book006, Math.PI / 2, 1.55);
  for (const b of [b1, b3]) paintLightly(b, 1); LIGHTS.poufBooks = [b1, b3];   // (drawn sharp too: world/gardenbook.js)   // (as the books on the table: 60 % less of what was left; then half of what was left, three times, then 80 % less again; 30 % less, then half, and half again, then none at all)
  { const p = toW(-0.17, -0.22); restOn(b1, p.x, p.z, 0.22, 0.13, 0.17); }
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
  // the 3D garden's magazine (a thin magazine, twice the size): the book that lay on b1, made a
  // magazine twice its size and 6 mm thick, lying over b1 and the pouf and bent to them (its cover: world/gardenbook.js)
  { const gb = B.book_book005.geometry; gb.computeBoundingBox(); const bs = gb.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(1.42 * 2);
    const c = toW(-0.05, -0.12), mag = magazine(Math.max(bs.y, bs.z), Math.min(bs.y, bs.z), 0.006, c, 0.3, [pouf, b1, b3]); F.add(mag); LIGHTS.gardenBook = mag; }
  // some GLB hardcovers face-out on the shelf
  // each piece's shade on the floor where it stands (without it the furniture seemed to float
  // above the wooden floor): the watercolour's ink line along their feet went with their watercolour, and the low
  // evening light and the lamps cast none just there
  for (const [o, y, k, sp] of [[tbl, 0.002, 1, 1], [st, 0.002, 1, 1], [sofa, 0.002, 1, 1], [fl, 0.002, 0.9, 1]]) groundAO(F, o, y, k, sp);
  LIGHTS.poufAO = groundAO(F, pouf, 0.019, 1.3, 2); LIGHTS.tableBooks = [tb1, tb2]; LIGHTS.pouf = pouf;
  // and the shade the daylight from the glass leaves behind them (windowShadow, below); the pouf's on the rug, drawn sharp with it
  LIGHTS.winShadows = [windowShadow(F, sofa, 0.0025, 0.32), windowShadow(F, pouf, 0.0195, 0.4)]; LIGHTS.winShadowOf = windowShadow; LIGHTS.poufAO.push(LIGHTS.winShadows[1]);   // (the pouf's lies on the rug: drawn sharp with it, world/gardenbook.js)   // (the pouf's, wider: it bulges out over its bottom)
  PARTS.furniture.push(F);   // (shown in turn: core/loop.js start)
  return F;
}
/* ---- the daylight's shade (the pouf's, along the light from the window, and clearer): the sun reaches only
   the floor by the glass, the rest of the room is lit by the sky through the glass walls (area lights, which cast no shadow
   in three.js), mostly the left wall, then the back one: so behind each piece, away from them (WIN_DIR), a soft shade
   the width of its footprint, darkest at its foot, fading and spreading out over about half its height and 15 cm more.
   Faded out as the daylight goes (fx/hour.js). */
const WIN_DIR = new THREE.Vector3(1, 0, 0.35).normalize();
function windowShadow(F, obj, y, a0, len) {
  obj.updateWorldMatrix(true, true);
  const d = WIN_DIR, s = new THREE.Vector3(-d.z, 0, d.x), v = new THREE.Vector3(); let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  obj.traverse(m => { if (!m.isMesh || m.isInstancedMesh || m.userData.twin) return; const p = m.geometry.attributes.position; if (!p) return;
    for (let i = 0; i < p.count; i += 3) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); const u = v.x * d.x + v.z * d.z, w = v.x * s.x + v.z * s.z;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); } });
  const L = len || 0.5 * (y1 - y0) + 0.15, m = 0.05, U0 = u0 + (u1 - u0) * 0.35, U = u1 + L - U0 + m, W = w1 - w0 + 2 * m + L * 0.5;
  const cw = 128, ch = Math.max(16, Math.round(128 * W / U)), c = canvas(cw, ch), g = c.getContext('2d'), id = g.createImageData(cw, ch);
  for (let yy = 0; yy < ch; yy++) for (let x = 0; x < cw; x++) {
    const uu = U0 - m + (x + 0.5) / cw * U, ww = (w0 + w1) / 2 + ((yy + 0.5) / ch - 0.5) * W, o = (yy * cw + x) * 4;
    const t = Math.max(0, (uu - u1) / L), fu = uu < U0 ? Math.max(0, 1 - (U0 - uu) / m) : t > 0 ? Math.pow(Math.max(0, 1 - t), 1.6) : 1;
    const half = (w1 - w0) / 2 + t * L * 0.18, dv = Math.max(0, Math.abs(ww - (w0 + w1) / 2) - half), fv = Math.pow(Math.max(0, 1 - dv / (m + t * L * 0.2)), 2);
    id.data[o] = 20; id.data[o + 1] = 12; id.data[o + 2] = 6; id.data[o + 3] = Math.round(255 * a0 * fu * fv); }
  g.putImageData(id, 0, 0);
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(U, W), new THREE.MeshBasicMaterial({ map: ctex(c, { rep: false }), transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const cu = U0 - m + U / 2, cwm = (w0 + w1) / 2;
  pl.rotation.set(-Math.PI / 2, 0, -Math.atan2(d.z, d.x)); pl.position.copy(F.worldToLocal(new THREE.Vector3(d.x * cu + s.x * cwm, y, d.z * cu + s.z * cwm))); pl.renderOrder = 1; F.add(pl);
  return pl;
}
/* ---- contact shade: where a piece meets the floor (its vertices within 2.5 cm of its lowest, gathered in 4 cm cells into its
   feet: legs, a plinth, a base, a pouf's bottom), a dark soft-edged patch the shape of each foot spreading a few cm round it,
   and under the whole piece a faint one (the light it keeps off the floor). Laid just over the floor (or the rug: y), drawn
   with the room so it is painted with it. */
function groundAO(F, obj, y, k = 1, sp = 1) {   // (returns its patches)
  const out = [];
  obj.updateWorldMatrix(true, true);
  const xs = [], zs = [], v = new THREE.Vector3(); let minY = Infinity, all = [Infinity, -Infinity, Infinity, -Infinity];
  obj.traverse(m => { if (!m.isMesh || m.isInstancedMesh || m.userData.twin || !m.visible) return; const p = m.geometry.attributes.position; if (!p) return;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); xs.push(v.x, v.y, v.z); if (v.y < minY) minY = v.y; } });
  if (!xs.length) return;
  const cells = new Map(), C = 0.04;
  for (let i = 0; i < xs.length; i += 3) { const x = xs[i], yy = xs[i + 1], z = xs[i + 2];
    all[0] = Math.min(all[0], x); all[1] = Math.max(all[1], x); all[2] = Math.min(all[2], z); all[3] = Math.max(all[3], z);
    if (yy > minY + 0.025) continue; const key = Math.floor(x / C) + ',' + Math.floor(z / C); let c = cells.get(key); if (!c) cells.set(key, c = [Infinity, -Infinity, Infinity, -Infinity]);
    c[0] = Math.min(c[0], x); c[1] = Math.max(c[1], x); c[2] = Math.min(c[2], z); c[3] = Math.max(c[3], z); }
  // the cells joined where they touch: each group a foot
  const seen = new Set(), feet = [];
  for (const key of cells.keys()) { if (seen.has(key)) continue; const b = [Infinity, -Infinity, Infinity, -Infinity], q = [key]; seen.add(key);
    while (q.length) { const kk = q.pop(), c = cells.get(kk); b[0] = Math.min(b[0], c[0]); b[1] = Math.max(b[1], c[1]); b[2] = Math.min(b[2], c[2]); b[3] = Math.max(b[3], c[3]);
      const [i, j] = kk.split(',').map(Number); for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const n = (i + di) + ',' + (j + dj); if (cells.has(n) && !seen.has(n)) { seen.add(n); q.push(n); } } }
    feet.push(b); }
  const patch = (b, m, a0, inner) => {   // a rounded box's shade: a0 inside, fading out over m round it
    const w = b[1] - b[0], d = b[3] - b[2], W = w + 2 * m, D = d + 2 * m, cw = 64, ch = Math.max(8, Math.round(64 * D / W)), c = canvas(cw, ch), g = c.getContext('2d'), id = g.createImageData(cw, ch), rc = Math.min(w, d) * 0.3;
    for (let yy = 0; yy < ch; yy++) for (let x = 0; x < cw; x++) {
      const px = (x + 0.5) / cw * W - W / 2, pz = (yy + 0.5) / ch * D - D / 2, qx = Math.abs(px) - (w / 2 - rc), qz = Math.abs(pz) - (d / 2 - rc);
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rc, t = sd < 0 ? inner : Math.pow(1 - Math.min(1, sd / m), 2.0), o = (yy * cw + x) * 4;
      id.data[o] = 20; id.data[o + 1] = 12; id.data[o + 2] = 6; id.data[o + 3] = Math.round(255 * Math.min(1, a0 * k) * t); }
    g.putImageData(id, 0, 0);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ map: ctex(c, { rep: false }), transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    pl.rotation.x = -Math.PI / 2; pl.position.copy(F.worldToLocal(new THREE.Vector3((b[0] + b[1]) / 2, y, (b[2] + b[3]) / 2))); pl.renderOrder = 1; F.add(pl); out.push(pl);
  };
  patch(all, 0.12, 0.22, 1);   // under it all, faint
  for (const b of feet) { const s = Math.min(b[1] - b[0], b[3] - b[2]); patch(b, Math.min(0.09 * sp, (0.035 + 0.25 * s) * sp), 0.6, 0.85); }
  return out;
}

export { buildFurniture };
