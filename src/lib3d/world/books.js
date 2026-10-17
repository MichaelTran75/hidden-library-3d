import './room.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { canvas, pick, rand, rng, rr } from '../core/utils.js';
import { room } from './room.js';

/* ---------------------------------------------------------------- books (instanced) */
const BOOK = { list: [], atlas: null };
const SPINES = 12;
function buildSpineAtlas() {
  const W = 1024, H = 1024, col = canvas(W, H), msk = canvas(W, H); const g = col.getContext('2d'), m = msk.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); m.fillStyle = '#fff'; m.fillRect(0, 0, W, H);
  const r = rng(77); const cw = 64;
  for (let i = 0; i < SPINES; i++) {
    const x0 = i * cw; const style = i % 6;
    // subtle cloth texture
    for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(0,0,0,${r() * .05})`; g.fillRect(x0 + r() * cw, r() * H, 1 + r() * 2, 1 + r() * 6); }
    const band = (y, h, c, tint = true) => { g.fillStyle = c; g.fillRect(x0 + 3, y, cw - 6, h); if (!tint) { m.fillStyle = '#000'; m.fillRect(x0 + 3, y, cw - 6, h); } };
    const label = (y, h, c) => { g.fillStyle = c; g.fillRect(x0 + 8, y, cw - 16, h); m.fillStyle = '#000'; m.fillRect(x0 + 8, y, cw - 16, h); };
    const lines = (y, n, c, tint) => { for (let k = 0; k < n; k++) { const w = (cw - 24) * (0.5 + r() * .5); g.fillStyle = c; g.fillRect(x0 + (cw - w) / 2, y + k * 26, w, 9); if (!tint) { m.fillStyle = '#000'; m.fillRect(x0 + (cw - w) / 2, y + k * 26, w, 9); } } };
    const gold = '#d8b673', dark = 'rgba(0,0,0,.35)', light = 'rgba(255,255,255,.55)';
    if (style === 0) { band(60, 14, gold, false); band(90, 6, gold, false); lines(260, 4, gold, false); band(880, 6, gold, false); band(900, 14, gold, false); }
    if (style === 1) { label(180, 230, '#efe6d2'); lines(210, 5, '#5a4632', false); band(940, 30, dark); }
    if (style === 2) { band(0, 120, dark); lines(300, 6, light, true); band(904, 120, dark); }
    if (style === 3) { lines(120, 7, '#1d1d1d', false); band(860, 70, light); }
    if (style === 4) { band(50, 40, dark); band(110, 8, gold, false); lines(380, 3, gold, false); band(930, 40, dark); }
    if (style === 5) { lines(140, 9, light, true); label(820, 90, '#f3efe4'); }
  }
  // tile 13: plain cover (tinted) ; tile 14-15 region: page block (untinted, with tinted rims)
  const px = 13 * cw; g.fillStyle = '#fff'; g.fillRect(px, 0, cw, H);
  const pg = 14 * cw; g.fillStyle = '#efe7d3'; g.fillRect(pg, 0, 2 * cw, H); m.fillStyle = '#000'; m.fillRect(pg, 0, 2 * cw, H);
  for (let k = 0; k < 220; k++) { g.fillStyle = `rgba(110,90,60,${.05 + r() * .12})`; g.fillRect(pg + 6 + r() * (2 * cw - 12), 0, 1, H); }
  g.fillStyle = '#fff'; g.fillRect(pg, 0, 6, H); g.fillRect(pg + 2 * cw - 6, 0, 6, H); m.fillStyle = '#fff'; m.fillRect(pg, 0, 6, H); m.fillRect(pg + 2 * cw - 6, 0, 6, H);
  const a = g.getImageData(0, 0, W, H).data, b = m.getImageData(0, 0, W, H).data; const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, o = ((H - 1 - y) * W + x) * 4; data[o] = a[i * 4]; data[o + 1] = a[i * 4 + 1]; data[o + 2] = a[i * 4 + 2]; data[o + 3] = b[i * 4]; }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
function bookGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, -0.5); // origin: bottom centre of the spine face; spine faces +z
  const uv = g.attributes.uv, cw = 64 / 1024;
  // BoxGeometry faces: +x,-x,+y,-y,+z,-z ; 4 verts each
  const set = (face, u0, u1, v0, v1, rot = false) => { for (let k = 0; k < 4; k++) { const i = face * 4 + k; const u = uv.getX(i), v = uv.getY(i); const a = rot ? v : u, b = rot ? u : v; uv.setXY(i, u0 + (u1 - u0) * a, v0 + (v1 - v0) * b); } };
  set(0, 13 * cw + .004, 14 * cw - .004, 0, 1); set(1, 13 * cw + .004, 14 * cw - .004, 0, 1); // covers
  set(2, 14 * cw, 16 * cw, 0, 1); set(3, 14 * cw, 16 * cw, 0, 1);              // top / bottom page edges
  set(4, 0.002, cw - .002, 0, 1);                                                         // spine (variant shift in shader)
  set(5, 14 * cw + 8 / 1024, 16 * cw - 8 / 1024, 0, 1);                                    // fore-edge
  return g;
}
function bookMaterial(atlas) {
  const m = new THREE.MeshStandardMaterial({ map: atlas, roughness: .78, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aVar;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n if (vMapUv.x < 0.0625) vMapUv.x += aVar * 0.0625;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      vec4 bk = texture2D( map, vMapUv );
      vec3 tint = vec3(1.0);
      #if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
        tint = vColor.rgb;
      #endif
      diffuseColor.rgb *= mix( bk.rgb, bk.rgb * tint, bk.a );`).replace('#include <color_fragment>', '');
  };
  return m;
}
const PAL = {
  modern: ['#ebe6da', '#f1eee6', '#e2dccd', '#d6d0c2', '#ece7dc', '#4f8a8b', '#3c7377', '#2c3e5a', '#3b5578', '#7c90a4', '#b8bcbf', '#9aa4a8', '#2b2b2b', '#c49b4c', '#a6593d', '#8ba08a', '#e7e1d2', '#5f7c91', '#d9d4c6', '#6d8f8f'],
  old: ['#6b4a32', '#7c5a3c', '#4e3526', '#2e3b55', '#6e2f2f', '#3f5340', '#b8a487', '#6f6f6a', '#a8322d', '#8b6b48', '#3a2e28', '#556a7a', '#9b8a6a', '#c9b48e', '#5b4636', '#2f4a4a', '#7a3b2b', '#cfc2a2'],
};
/* fill one shelf cell; o = left-bottom-front corner, along = unit axis to the right, out = spine normal (into the room) */
function fillCell(o, along, out, len, hgt, dep, pal, opt = {}) {
  const up = new THREE.Vector3(0, 1, 0); const B = new THREE.Matrix4().makeBasis(along, up, out).setPosition(o);
  if (opt.cell) { opt.cell.B = B; opt.cell.len = len; }   // for refitCell
  const maxH = Math.min(hgt - 0.02, 0.34); const gapChance = opt.gaps ?? 0.05, stackChance = opt.stack ?? 0.05;
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  const push = (M, col, v, up = false) => BOOK.list.push({ m: B.clone().multiply(M), c: new THREE.Color(col).offsetHSL(0, rr(-.04, .04), rr(-.05, .04)), v, up, cell: opt.cell || null });
  let x = rr(0, 0.02), lastUp = null;
  while (x < len - 0.02) {
    const roll = rand();
    if (roll < stackChance && len - x > 0.3) {                       // horizontal stack, spines to the room
      const n = 2 + Math.floor(rand() * 4), w = rr(0.19, 0.26), d0 = Math.min(dep - 0.02, rr(0.15, 0.21)); let y = 0;
      for (let k = 0; k < n && y < hgt - 0.07; k++) {
        const t = rr(0.022, 0.05), h = w + rr(-.02, .02), d = d0 + rr(-.015, .01), yaw = rr(-.07, .07);
        const cx = x + w / 2, cy = y + t / 2, cz = -d / 2 - 0.004;
        const M = T(cx, cy, cz).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(T(h / 2, 0, d / 2)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(t, h, d));
        push(M, pick(pal), Math.floor(rand() * SPINES)); y += t;
      }
      x += w + rr(0.01, 0.03); lastUp = null; continue;
    }
    if (roll < stackChance + gapChance) { x += rr(0.04, 0.12); lastUp = null; continue; }
    const t = rr(0.017, 0.05) * (rand() < .12 ? 1.5 : 1), h = Math.min(maxH, rr(0.2, 0.34)), d = Math.min(dep - 0.015, rr(0.13, 0.17) + h * 0.25);
    const b = { x: x + t / 2, t, h, d, inset: rr(0, 0.025), col: pick(pal), v: Math.floor(rand() * SPINES), lean: 0 };
    lastUp = b; b.idx = BOOK.list.length; push(T(b.x, 0, -b.inset).multiply(new THREE.Matrix4().makeScale(t, h, d)), b.col, b.v, true);
    x += t + (rand() < .25 ? rr(0.001, 0.006) : 0.0008);
  }
  // the last upright book leans on its left neighbour when there is space after it
  if (lastUp) {
    const xn = lastUp.x - lastUp.t / 2, avail = len - xn - 0.004;
    if (avail - lastUp.t > 0.03) {
      const phi = Math.min(0.38, Math.asin(Math.min(1, (avail - lastUp.t) / lastUp.h))) * rr(0.55, 1);
      const px = xn + lastUp.t * Math.cos(phi) + lastUp.h * Math.sin(phi);
      const M = T(px, 0, -lastUp.inset).multiply(new THREE.Matrix4().makeRotationZ(phi)).multiply(T(-lastUp.t / 2, 0, 0)).multiply(new THREE.Matrix4().makeScale(lastUp.t, lastUp.h, lastUp.d));
      BOOK.list[lastUp.idx].m = B.clone().multiply(M); BOOK.list[lastUp.idx].lean = true;
    }
  }
}
/* a cell packed again after some of its books changed size (a book of the page takes the thickness of its pages): the
   books keep their order and the gaps between them; what no longer fits at the right end is put away (only books that
   play nothing). sizes: Map of BOOK.list index -> { t, h }; keep: indices never put away. Returns the indices it moved. */
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
function refitCell(cell, sizes, keep = new Set()) {
  const inv = cell.B.clone().invert(), L = new THREE.Matrix4(), v = new THREE.Vector3(), ents = [];
  BOOK.list.forEach((b, idx) => {
    if (b.cell !== cell || b.hidden) return;
    L.multiplyMatrices(inv, b.m); let x0 = Infinity, x1 = -Infinity;
    for (let k = 0; k < 8; k++) { const x = v.set(k & 1 ? 0.5 : -0.5, k & 2 ? 1 : 0, k & 4 ? -1 : 0).applyMatrix4(L).x; x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    ents.push({ idx, b, x0, x1 });
  });
  ents.sort((a, b) => a.x0 - b.x0);
  const slots = [];   // runs of books side by side; a stack lying flat is one run
  for (const e of ents) { const s = slots[slots.length - 1]; if (s && e.x0 < s.x1 - 1e-4) { s.ents.push(e); s.x1 = Math.max(s.x1, e.x1); } else slots.push({ ents: [e], x0: e.x0, x1: e.x1 }); }
  slots.forEach((s, k) => { s.gap = k ? Math.max(0, s.x0 - slots[k - 1].x1) : 0; const e = s.ents.find(e => sizes.has(e.idx)); s.item = e || null; s.keep = s.ents.some(e => keep.has(e.idx) || sizes.has(e.idx));
    s.grow = e ? sizes.get(e.idx).t - (e.x1 - e.x0) : 0; s.w = s.x1 - s.x0 + s.grow; });
  const lay = () => { let x = slots.length ? slots[0].x0 : 0; for (const s of slots) { if (s.out) continue; s.nx0 = x + (s === slots[0] ? 0 : s.gap); x = s.nx0 + s.w; } return x; };
  while (lay() > cell.len - 0.002) { const s = [...slots].reverse().find(s => !s.out && !s.keep); if (!s) break; s.out = true; }
  const along = new THREE.Vector3().setFromMatrixColumn(cell.B, 0), moved = [];
  for (const s of slots) for (const e of s.ents) {
    if (s.out) { e.b.m.copy(ZERO_M); e.b.hidden = true; moved.push(e.idx); continue; }
    if (s.item === e) {   // an upright book: its frame in the cell is a translation and a scale
      const sz = sizes.get(e.idx); L.multiplyMatrices(inv, e.b.m); const z = L.elements[14], d = v.setFromMatrixColumn(L, 2).length();
      e.b.m.multiplyMatrices(cell.B, new THREE.Matrix4().makeTranslation(s.nx0 + (e.x0 - s.x0) + sz.t / 2, 0, z).multiply(new THREE.Matrix4().makeScale(sz.t, sz.h, sz.d || d)));   // (sz.d: a depth of its own, its spine where it was)
    } else {   // a book leaning on the resized one moves with its right side
      const dx = s.nx0 - s.x0 + (s.item && e.x0 > s.item.x0 ? s.grow : 0);
      e.b.m.premultiply(new THREE.Matrix4().makeTranslation(along.x * dx, along.y * dx, along.z * dx));
    }
    moved.push(e.idx);
  }
  return moved;
}
/* a row of upright books from a cell's left end, len metres of it, the last leaning left on the one before it (as a row's
   last book does in fillCell): the 747's cell (G, 17/10/2026: "add vài cuốn sách bên trái để fill khoảng trống"). Its own
   random draws, so the room's shared sequence, and every other cell, stay as they were. */
function rowOfBooks(cell, len, seed) {
  const r = rng(seed), between = (a, b) => a + (b - a) * r(), T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z), S = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
  let x = between(0.002, 0.01), last = null;
  for (;;) {
    const t = between(0.019, 0.046) * (r() < 0.12 ? 1.4 : 1), h = between(0.21, 0.3), d = Math.min(0.3, between(0.13, 0.17) + h * 0.25), inset = between(0, 0.02);
    if (x + t > len) break;
    const c = new THREE.Color(PAL.old[Math.floor(r() * PAL.old.length)]).offsetHSL(0, (r() - 0.5) * 0.08, (r() - 0.5) * 0.09);
    last = { idx: BOOK.list.length, x, t, h, d, inset };
    BOOK.list.push({ m: cell.B.clone().multiply(T(x + t / 2, 0, -inset)).multiply(S(t, h, d)), c, v: Math.floor(r() * SPINES), up: true, cell });
    x += t + (r() < 0.25 ? between(0.001, 0.005) : 0.0008);
  }
  if (last) {
    const { idx, t, h, d, inset } = last, phi = 0.22;
    BOOK.list[idx].m = cell.B.clone().multiply(T(last.x + t * Math.cos(phi) + h * Math.sin(phi), 0, -inset)).multiply(new THREE.Matrix4().makeRotationZ(phi)).multiply(T(-t / 2, 0, 0)).multiply(S(t, h, d));
    BOOK.list[idx].lean = true;
  }
}
function buildBookInstances() {
  const geo = bookGeometry(); const n = BOOK.list.length;
  const mesh = new THREE.InstancedMesh(geo, bookMaterial(BOOK.atlas), n);
  const va = new Float32Array(n);
  BOOK.list.forEach((b, i) => { mesh.setMatrixAt(i, b.m); mesh.setColorAt(i, b.c); va[i] = b.v; });
  geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(va, 1));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; room.add(mesh); return mesh;
}

export { BOOK, PAL, buildBookInstances, buildSpineAtlas, fillCell, refitCell, rowOfBooks };
