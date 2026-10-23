import './materials.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PARTS, R } from '../core/base.js';
import { boardGeo, canvas, ctex, place } from '../core/utils.js';
import { scene } from '../core/renderer.js';
import { MAT } from './materials.js';
import { paintLightly } from '../fx/post.js';

/* ---------------------------------------------------------------- room */
const room = new THREE.Group(); scene.add(room);
function buildRoom() {
  const L = R.zF - R.zB, Wd = R.xW - R.xL;
  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(Wd + 0.4, L + 0.4), MAT.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.set((R.xL + R.xW) / 2, 0, (R.zB + R.zF) / 2); floor.receiveShadow = true; paintLightly(floor, 1);   // (no watercolour on the floor: G, 24/10/2026)
  { const uv = floor.geometry.attributes.uv, p = floor.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getY(i)); }
  room.add(floor);
  // the corners' line: where the floor meets the glass wall's sill (its inner face 4 cm in), the tall shelf's and the low bookcases', a dark line in the
  // corner fading out over ~7 cm of the floor and ~5 cm up the face (G, 24/10/2026: "em cho các khe góc có line rõ nét hơn": the
  // watercolour's ink drew it, and went with the floor's watercolour)
  for (const [x0, z0, x1, z1, nx, nz] of [[R.xL + 0.04, R.zB, R.xL + 0.04, R.zF, 1, 0], [R.xS, R.zB, R.xS, R.zF, -1, 0], [R.xL, R.zB + R.caseD, R.xS, R.zB + R.caseD, 0, 1], [R.xL, R.zF - R.caseD, R.xS, R.zF - R.caseD, 0, -1]]) cornerShade(x0, z0, x1, z1, nx, nz);
  caseCorners();
  // ceiling planks + edge fascia
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(Wd + 0.4, L + 0.4), MAT.ceil);
  ceil.rotation.x = Math.PI / 2; ceil.position.set((R.xL + R.xW) / 2, R.H, (R.zB + R.zF) / 2); ceil.receiveShadow = true; ceil.castShadow = true;
  { const uv = ceil.geometry.attributes.uv, p = ceil.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getY(i)); }
  room.add(ceil);
  const beams = [];
  beams.push(place(boardGeo(0.16, 0.24, L + 0.3, 1), R.xL + 0.02, R.H - 0.12, (R.zB + R.zF) / 2));
  beams.push(place(boardGeo(Wd, 0.24, 0.16, 1), (R.xL + R.xW) / 2, R.H - 0.12, R.zB + 0.02));
  beams.push(place(boardGeo(Wd, 0.24, 0.16, 1), (R.xL + R.xW) / 2, R.H - 0.12, R.zF - 0.02));
  // ---- glass walls with wooden frames
  const fr = [], gl = [];
  const post = (x, z, h, w = 0.11, d = 0.15, y0 = 0) => fr.push(place(boardGeo(w, h, d, 1), x, y0 + h / 2, z));
  const rail = (x0, x1, z0, z1, y, t = 0.1, d = 0.15) => { const len = Math.hypot(x1 - x0, z1 - z0); const g = boardGeo(len, t, d, 1); g.rotateY(-Math.atan2(z1 - z0, x1 - x0)); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); fr.push(g); };
  // left wall (x = xL), posts along z
  const LZ = [R.zB, -6.6, -4.55, -2.95, -1.35, 0.4, R.zF];
  const gx = R.xL - 0.06;
  for (const z of LZ) post(gx, z, R.H, (z === R.zB || z === R.zF) ? 0.16 : 0.11, 0.16);
  rail(gx, gx, R.zB, R.zF, 0.04, 0.08, 0.2);           // sill
  rail(gx, gx, R.zB, R.zF, R.caseTop, 0.12, 0.17);    // transom
  rail(gx, gx, R.zB, R.zF, R.H - 0.06, 0.12, 0.17);   // head
  // sliding door between −4.55 and −2.95 : stiles + handle
  post(gx + 0.035, -4.48, R.caseTop - 0.1, 0.06, 0.09, 0.05); post(gx + 0.035, -3.02, R.caseTop - 0.1, 0.06, 0.09, 0.05);
  rail(gx + 0.035, gx + 0.035, -4.5, -3.0, 0.16, 0.12, 0.06); rail(gx + 0.035, gx + 0.035, -4.5, -3.0, R.caseTop - 0.1, 0.07, 0.06);
  for (let i = 0; i < LZ.length - 1; i++) { const z0 = LZ[i], z1 = LZ[i + 1]; for (const [y0, y1] of [[0.08, R.caseTop - 0.06], [R.caseTop + 0.06, R.H - 0.12]]) { const g = new THREE.PlaneGeometry(z1 - z0, y1 - y0); g.rotateY(Math.PI / 2); g.translate(gx, (y0 + y1) / 2, (z0 + z1) / 2); gl.push(g); } }
  // back + front walls: glass above the low bookcases
  for (const [zw, s] of [[R.zB - 0.02, 1], [R.zF + 0.02, -1]]) {
    const MX = [R.xL, 0.05, 1.15, R.xS];
    for (const x of MX) post(x, zw, R.H - R.caseTop, x === R.xL || x === R.xS ? 0.16 : 0.11, 0.16, R.caseTop);
    rail(R.xL, R.xW, zw, zw, R.caseTop + 0.04, 0.1, 0.18); rail(R.xL, R.xW, zw, zw, R.H - 0.06, 0.12, 0.18);
    for (let i = 0; i < MX.length - 1; i++) { const g = new THREE.PlaneGeometry(MX[i + 1] - MX[i], R.H - R.caseTop - 0.16); g.translate((MX[i] + MX[i + 1]) / 2, (R.caseTop + R.H) / 2, zw); gl.push(g); }
    // wall behind bookcase (solid, timber clad on the outside)
    const back = new THREE.Mesh(boardGeo(R.xW - R.xL, R.caseTop, 0.08, 1), MAT.shelfBack); back.position.set((R.xL + R.xW) / 2, R.caseTop / 2, zw - s * 0.06); back.receiveShadow = back.castShadow = true; room.add(back); PARTS.shelves.push(back); paintLightly(back, 0.1);   // (the low bookcases' backs: 10 % less watercolour, as their shelves)
  }
  const frames = new THREE.Mesh(mergeGeometries([...fr, ...beams]), MAT.frame); frames.castShadow = frames.receiveShadow = true; room.add(frames);
  const glass = new THREE.Mesh(mergeGeometries(gl), MAT.glass); glass.renderOrder = 2; room.add(glass); room.userData.glass = glass;   // (its glass: fx/glass.js)
  // handle
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 10), MAT.bronze); handle.position.set(gx + 0.09, 1.05, -4.42); room.add(handle);
  // right solid wall (behind bookshelf)
  // (the right wall behind the tall shelves is left out: no view sees it, and the sun never comes from that side: G, 23/10/2026)
}

const _cornerTex = {};
function cornerTex(L = 0.04) {   // across the strip (v from the corner, 0, outward): a crisp dark line (L of it), then a soft falloff
  if (_cornerTex[L]) return _cornerTex[L]; const c = canvas(4, 256), g = c.getContext('2d'), id = g.createImageData(4, 256), L2 = L * 1.5;
  for (let y = 0; y < 256; y++) { const t = (y + 0.5) / 256, a = t < L ? 0.92 : t < L2 ? 0.92 - (t - L) / (L2 - L) * 0.4 : 0.52 * Math.pow(1 - (t - L2) / (1 - L2), 2.6);
    for (let x = 0; x < 4; x++) { const o = (y * 4 + x) * 4; id.data[o] = 16; id.data[o + 1] = 10; id.data[o + 2] = 5; id.data[o + 3] = Math.round(255 * a); } }
  g.putImageData(id, 0, 0); const t = ctex(c, { rep: false }); t.flipY = false; t.anisotropy = 8; return _cornerTex[L] = t;
}
const _cmat = L => new THREE.MeshBasicMaterial({ map: cornerTex(L), transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
// a strip along the corner A → B lying on a face: d the way into the face (away from the corner), n the face's normal, w its width
function cornerStrip(A, B, d, n, w, L) {   // (L: the dark line's share of it)
  const V = THREE.Vector3, a = new V(...A).addScaledVector(n, 0.0012), b = new V(...B).addScaledVector(n, 0.0012), c = b.clone().addScaledVector(d, w), e = a.clone().addScaledVector(d, w);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...c.toArray(), ...e.toArray()], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
  const m = new THREE.Mesh(g, _cmat(L)); m.renderOrder = 1; room.add(m); paintLightly(m, 1); return m;
}
function cornerShade(x0, z0, x1, z1, nx, nz) {   // where the floor meets a face (its normal nx, nz): a strip on the floor and one up the face
  const V = THREE.Vector3, up = new V(0, 1, 0), inw = new V(nx, 0, nz);
  cornerStrip([x0, 0, z0], [x1, 0, z1], inw, up, 0.06, 0.09); cornerStrip([x0, 0, z0], [x1, 0, z1], up, inw, 0.045, 0.12);   // (lines ~5 mm)
}
// the low bookcases' ends, where their fronts meet the glass wall (left) and the tall shelf (right): a line up each corner
// (G, 24/10/2026: "em cho rõ nét hơn nữa và áp dụng thêm cho thư viện"), on the bookcase's front and on the tall shelf's face
function caseCorners() {
  const V = THREE.Vector3;
  for (const [zf, s] of [[R.zB + R.caseD, 1], [R.zF - R.caseD, -1]]) {
    const out = new V(0, 0, s);
    cornerStrip([R.xL - 0.025, 0, zf], [R.xL - 0.025, R.caseTop, zf], new V(1, 0, 0), out, 0.06, 0.15);   // (the end upright's outer edge, by the glass)
    cornerStrip([R.xS, 0, zf], [R.xS, R.caseTop, zf], new V(-1, 0, 0), out, 0.06, 0.15);   // (lines ~1 cm)
    cornerStrip([R.xS, 0, zf], [R.xS, R.caseTop, zf], out, new V(-1, 0, 0), 0.06, 0.15);
  }
}

export { buildRoom, cornerStrip, room };
