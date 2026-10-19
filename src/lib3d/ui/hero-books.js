import './sections.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { canvas, rng } from '../core/utils.js';
import { renderer, scene } from '../core/renderer.js';
import { bookInfo, byOf, coverOf, isReadItem, pageLang, printTitle, titleIn } from './book-data.js';
import { buildRead, readDispose, relabelRead } from './leaves.js';
import { drawAtlas, drawEndpaper } from './atlas.js';
import { UIS } from './library.js';
import { setNeeds } from '../core/loop.js';
import { NIGHT } from '../fx/night.js';
import { DECKR } from './deck.js';

/* ---- the book that leaves the shelf, made as a binder makes a hardcover (G, 15/10/2026: "render cho detail hơn"):
   two boards (2.4 mm) covered in book cloth, standing 2.5 mm proud of the pages at the head, the foot and the fore-edge
   (the "squares"), their edges rounded off so they catch the light; a rounded spine, with the groove of the joint along
   each board; between them the page block, its edges ruled with the leaves' edges (a darker line where a section was
   sewn), its fore-edge hollowed as a rounded back makes it; a striped headband at the head and the foot of the spine;
   endpapers inside the boards. The cloth is woven and a little velvety at a glance (sheen). The title, its frame and
   the spine's lettering are stamped into the cloth: pressed in, glossier than the cloth, a touch of foil. A book with its
   own cover wears it as a laminated jacket (a clear gloss). Lit as the room lights it, plus a soft studio reflection
   (three.js RoomEnvironment) for the sheen of the cloth, the stamping and the jacket, and a little light of its own so it
   is never too dark to read. It is drawn sharp over the picture, not watercoloured, so a cover reads as printed: on its
   own layer (HERO_LAYER), which the room's camera does not see, in a pass of its own (pets.js drawSharpBooks), its
   fragments dropped where the room is nearer. The shape is made in metres and brought to the book's unit box (the hero
   is scaled by its size, as the shelf books are: origin at the foot of the spine, spine toward +z, front cover +x). */
const HERO_LAYER = 3;
const HERO = { list: [], keep: 5, env: null };   // the books made so far (past `keep`, the one longest unseen is let go: ~11 MB of pictures each)
// the front board opening (the Geography books open on their map: G, 16/10/2026): each corner turned about the hinge
// by uOpen times its flap (heroGeometry), in metres (the mesh is the unit box, scaled by the book's size), its normal
// with it; nothing moves while uOpen is 0
const HERO_FLAP = `attribute float aFlap; uniform float uOpen; uniform vec2 uHinge; uniform vec3 uSize;
  vec2 heroTurn(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }\n`;
function heroSharp(mat, U) {   // (the room's depth, as the deck and the animals are tested against it; and the cover's turn)
  mat.onBeforeCompile = sh => {
    sh.uniforms.uDepth = DECKR.u.uDepth; sh.uniforms.uFull = DECKR.u.uFull; sh.uniforms.uOff = DECKR.u.uOff;
    sh.uniforms.uOpen = U.uOpen; sh.uniforms.uHinge = U.uHinge; sh.uniforms.uSize = U.uSize;
    sh.vertexShader = HERO_FLAP + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  if (aFlap * uOpen > 0.0) { vec3 fn = objectNormal / uSize; fn.xz = heroTurn(fn.xz, uOpen * aFlap); objectNormal = normalize(fn * uSize); }')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  if (aFlap * uOpen > 0.0) { vec3 fp = transformed * uSize; fp.xz = uHinge + heroTurn(fp.xz - uHinge, uOpen * aFlap); transformed = fp / uSize; }');
    sh.fragmentShader = 'uniform sampler2D uDepth; uniform vec2 uFull, uOff;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;');
  };
  return mat;
}
function wrapText(g, text, maxW) {
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const w of words) { const tryL = line ? line + ' ' + w : w; if (g.measureText(tryL).width > maxW && line) { lines.push(line); line = w; } else line = tryL; }
  if (line) lines.push(line); return lines;
}
function inkFor(col) { const hsl = {}; col.getHSL(hsl, THREE.SRGBColorSpace); return hsl.l < 0.55 ? INK_LIGHT : '#2a2118'; }
const INK_LIGHT = '#e2d6c0';   // (the page's whites: G, 18/10/2026)
// the book's own lights (on its layer only), as a product is lit: a key lamp a third of a metre off to the viewer's upper
// left, its light falling off across the cover, bringing out the rounded edges, the groove of the joint and the stamping;
// and a weak fill from the right, low, so the fore-edge (turned away from the key) shows its pages; softer and warmer at
// night
function heroKey(camera, at) {
  if (!HERO.key) { for (const k of ['key', 'fill']) { HERO[k] = new THREE.PointLight(0xfff3e2, 1, 0, 2); HERO[k].layers.set(HERO_LAYER); scene.add(HERO[k]); } }
  const n = NIGHT.u.value, i = (0.85 - 0.35 * n) * 0.3;
  for (const [k, f, x, y] of [[HERO.key, 1, -0.3, 0.32], [HERO.fill, 0.6, 0.34, -0.04]]) {
    k.intensity = i * f; k.color.setRGB(1, 0.95 - 0.07 * n, 0.88 - 0.16 * n);
    _hk.copy(camera.position).sub(at).normalize(); k.position.copy(at).addScaledVector(_hk, 0.3).add(_hk.set(x, y, 0).applyQuaternion(camera.quaternion)); k.updateMatrixWorld();
  }
}
const _hk = new THREE.Vector3();
function heroEnv() {
  if (!HERO.env) { const pm = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(); HERO.env = pm.fromScene(room, 0.04).texture; pm.dispose(); if (room.dispose) room.dispose(); }
  return HERO.env;
}

/* ---- the shape. Groups: 0 the front's cloth, 1 the spine's, 2 plain cloth (the back, the boards' edges), 3 endpapers
   (inside the boards, the flyleaves), 4 the page edges, 5 the headbands */
function heroGeometry(bk) {
  const t = bk.t, h = bk.h, d = bk.d, T2 = t / 2, PI = Math.PI;
  const b = Math.min(0.0024, t * 0.13), sq = Math.min(0.0026, h * 0.012), rb = b * 0.42, bz = Math.min(0.006, t * 0.2);
  const gw = Math.min(0.0045, d * 0.03), gd = Math.min(0.0007, b * 0.35), e = Math.min(0.0007, b * 0.3);
  const PT = T2 - b - 0.0002, cv = Math.min(0.004, t * 0.12), zc = -bz - 0.0004, rzp = Math.max(0.0005, bz - 0.0018);
  const G = [[], [], [], [], [], [], [], []];   // per group: x, y, z, nx, ny, nz, u, v, flap of each corner of each triangle
  const vtx = (g, p, n, uv, w = 0) => G[g].push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], w);
  const tri = (g, A, B, C) => {   // three [p, n, uv]: wound so the face looks the way its normals do
    const ux = B[0][0] - A[0][0], uy = B[0][1] - A[0][1], uz = B[0][2] - A[0][2], wx = C[0][0] - A[0][0], wy = C[0][1] - A[0][1], wz = C[0][2] - A[0][2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx, s = fx * (A[1][0] + B[1][0] + C[1][0]) + fy * (A[1][1] + B[1][1] + C[1][1]) + fz * (A[1][2] + B[1][2] + C[1][2]);
    for (const V of s >= 0 ? [A, B, C] : [A, C, B]) vtx(g, ...V);
  };
  // a closed cross-section (x, z), its points' outward normals and the length along it
  const section = (pts) => {
    let area = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p.x * q.z - q.x * p.z; }
    let s = 0;
    pts.forEach((p, i) => { const a = pts[(i + pts.length - 1) % pts.length], c = pts[(i + 1) % pts.length], tx = c.x - a.x, tz = c.z - a.z, l = Math.hypot(tx, tz) || 1;
      p.nx = (area > 0 ? tz : -tz) / l; p.nz = (area > 0 ? -tx : tx) / l; if (i) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); p.s = s; });
    return pts;
  };
  const pusher = arr => (x, z, part) => { const q = arr[arr.length - 1]; if (q && Math.hypot(q.x - x, q.z - z) < 1e-7) return; arr.push({ x, z, part }); };
  // the case: the front board from its joint out to the fore-edge, round its end and back inside, through the spine to
  // the back board, out round its end, back along it to its joint, and round the spine to the front
  const P = [], add = pusher(P);
  const arc = (cx, cz, rx, rz, a0, a1, n, part) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; add(cx + rx * Math.cos(a), cz + rz * Math.sin(a), part); } };
  add(T2, -bz - gw, 'front'); add(T2, -d + rb, 'front');
  arc(T2 - rb, -d + rb, rb, rb, 0, -PI / 2, 4, 'edge'); add(T2 - b + rb, -d, 'edge'); arc(T2 - b + rb, -d + rb, rb, rb, -PI / 2, -PI, 4, 'edge');
  add(T2 - b, -bz - gw, 'inner'); const iJin = P.length - 1;                                   // (the joint, inside)
  for (let i = 1; i <= 6; i++) add(T2 - b, -bz - gw + gw * i / 6, 'inner'); const iSin = P.length - 1;   // (to the spine, in steps)
  arc(0, -bz, T2 - b, Math.max(0.0004, bz - 0.0012), 0, PI, 16, 'inner'); add(-T2 + b, -d + rb, 'inner');
  arc(-T2 + b - rb, -d + rb, rb, rb, 0, -PI / 2, 4, 'edge'); add(-T2 + rb, -d, 'edge'); arc(-T2 + rb, -d + rb, rb, rb, -PI / 2, -PI, 4, 'edge');
  add(-T2, -bz - gw, 'back');
  for (let i = 1; i <= 6; i++) { const s = i / 6; add(-T2 + gd * Math.sin(PI * s), -bz - gw + gw * s, 'back'); }   // the back joint's groove
  arc(0, -bz, T2, bz, PI, 0, 20, 'spine'); const iSout = P.length - 1;
  for (let i = 1; i < 6; i++) { const s = i / 6; add(T2 - gd * Math.sin(PI * s), -bz - gw * s, 'front'); }       // the front joint's groove
  section(P);
  // how much of the front board's turn each point takes as the book opens: all of it beyond the joint, none from the
  // spine on, a smooth share across the joint's groove (where the cloth and the endpaper bend)
  const flap = (x, z) => x > T2 - b - 1e-6 ? THREE.MathUtils.smoothstep(-z, bz, bz + gw) : 0;
  const sp0 = P.find(p => p.part === 'spine'), spL = P.filter(p => p.part === 'spine').pop().s - sp0.s + Math.hypot(sp0.x + T2, sp0.z + bz);   // (from the back joint)
  const cm = (d - bz) / 3;   // the cloth's tile, as large as on the front (heroMaterials: 768 px across, 256 px a tile)
  const caseUV = (p, part, y) => part === 'front' ? [(-p.z - bz) / (d - bz), y / h] : part === 'spine' ? [Math.min(1, Math.max(0, (p.s - sp0.s + Math.hypot(sp0.x + T2, sp0.z + bz)) / spL)), y / h]
    : [p.s / cm, y / cm];
  const GROUP = { front: 0, spine: 1, back: 2, edge: 2, inner: 3 };
  // its walls: rings at the foot, just above it, just below the head and at the head; the end rings' normals tipped
  // out (the edges look rounded)
  const rings = [[0, -0.9], [e, 0], [h - e, 0], [h, 0.9]];
  // (the front board's inside, the endpaper pasted to it, a group of its own (7): what an open book shows on its left,
  // its uv from the fore-edge (0) to the joint (1), up from its foot)
  const zE0 = -d + rb, zE1 = -bz - gw;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], part = q.part, end = i === iJin - 1, g = end ? 7 : GROUP[part];
    for (let r = 0; r < rings.length - 1; r++) {
      const [y0, k0] = rings[r], [y1, k1] = rings[r + 1];
      const V = (pt, y, k) => [[pt.x, y, pt.z], [pt.nx, k, pt.nz], end ? [(pt.z - zE0) / (zE1 - zE0), y / h] : caseUV(pt, part, y), flap(pt.x, pt.z)];
      const a = V(p, y0, k0), bb = V(q, y0, k0), c = V(q, y1, k1), dd = V(p, y1, k1);
      tri(g, a, bb, c); tri(g, a, c, dd);
    }
  }
  // its head and foot: the cross-section, its normals tipped out at the rim
  const flat = (pts, y, up, g, uv) => {
    const idx = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p.x, p.z)), []);
    for (const [i, j, k] of idx) tri(g, ...[pts[i], pts[j], pts[k]].map(p => [[p.x, y, p.z], [p.nx * 0.45 * (g === 4 ? 0 : 1), up, p.nz * 0.45 * (g === 4 ? 0 : 1)], uv(p), g === 4 ? 0 : flap(p.x, p.z)]));
  };
  const capParts = [P.slice(0, iJin + 1), [...P.slice(iSout), P[0], ...P.slice(iJin, iSin + 1)], P.slice(iSin, iSout + 1)];
  for (const part of capParts) { flat(part, h, 1, 2, p => [p.x / cm, p.z / cm]); flat(part, 0, -1, 2, p => [p.x / cm, p.z / cm]); }
  // the page block: its fore-edge hollowed, its back rounded into the spine
  const Q = [], addq = pusher(Q), zf = x => -d + sq + cv * (1 - (x / PT) ** 2);
  addq(PT, zc, 'back'); addq(PT, zf(PT), 'side');
  for (let i = 1; i <= 18; i++) { const x = PT - 2 * PT * i / 18; addq(x, zf(x), 'fore'); }
  addq(-PT, zc, 'side');
  for (let i = 1; i < 16; i++) { const a = PI - PI * i / 16; addq(PT * Math.cos(a), zc + rzp * Math.sin(a), 'back'); }
  section(Q);
  const zfp = zf(PT);
  for (let i = 0; i < Q.length; i++) {
    const p = Q[i], q = Q[(i + 1) % Q.length], g = q.part === 'fore' ? 4 : q.part === 'side' && p.x > 0 && q.x > 0 ? 6 : 3;
    const V = (pt, y) => [[pt.x, y, pt.z], [pt.nx, 0, pt.nz], g === 4 ? [(pt.x + PT) / (2 * PT), (y - sq) / (h - 2 * sq)] : g === 6 ? [(zc - pt.z) / (zc - zfp), (y - sq) / (h - 2 * sq)] : [pt.s / 0.1, y / 0.1]];
    tri(g, V(p, sq), V(q, sq), V(q, h - sq)); tri(g, V(p, sq), V(q, h - sq), V(p, h - sq));
  }
  flat(Q, h - sq, 1, 4, p => [(p.x + PT) / (2 * PT), (p.z + d) / d]); flat(Q, sq, -1, 4, p => [(p.x + PT) / (2 * PT), (p.z + d) / d]);
  // the headbands, where the page block meets the spine at the head and the foot
  const rh = Math.min(0.0012, sq * 0.5);
  for (const y of [h - sq + rh * 0.7, sq - rh * 0.7]) {
    const pts = []; for (let i = 0; i <= 16; i++) { const a = PI * (0.1 + 0.8 * i / 16); pts.push(new THREE.Vector3((PT - 0.0005) * Math.cos(a), y, zc + rzp * Math.sin(a) - rh * 0.6)); }
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, rh, 6, false), tp = tg.attributes.position, tn = tg.attributes.normal, tu = tg.attributes.uv, ti = tg.index;
    const TV = j => [[tp.getX(j), tp.getY(j), tp.getZ(j)], [tn.getX(j), tn.getY(j), tn.getZ(j)], [tu.getX(j), tu.getY(j)]];
    for (let j = 0; j < ti.count; j += 3) tri(5, TV(ti.getX(j)), TV(ti.getX(j + 1)), TV(ti.getX(j + 2)));
    tg.dispose();
  }
  // into the unit box: positions over the size, normals times it
  const n = G.reduce((s, a) => s + a.length / 9, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), fl = new Float32Array(n), geo = new THREE.BufferGeometry();
  let o = 0;
  G.forEach((a, g) => {
    const start = o;
    for (let i = 0; i < a.length; i += 9, o++) {
      pos[o * 3] = a[i] / t; pos[o * 3 + 1] = a[i + 1] / h; pos[o * 3 + 2] = a[i + 2] / d;
      const nx = a[i + 3] * t, ny = a[i + 4] * h, nz = a[i + 5] * d, l = Math.hypot(nx, ny, nz) || 1; nor[o * 3] = nx / l; nor[o * 3 + 1] = ny / l; nor[o * 3 + 2] = nz / l;
      uv[o * 2] = a[i + 6]; uv[o * 2 + 1] = a[i + 7]; fl[o] = a[i + 8];
    }
    geo.addGroup(start, o - start, g);
  });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aFlap', new THREE.BufferAttribute(fl, 1));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  // (the hinge: the middle of the joint's groove, halfway through the board; the first page: its face and size)
  return { geo, frontU0: gw / (d - bz), frontW: d - bz, spineL: spL, hinge: new THREE.Vector2(T2 - b / 2, -bz - gw / 2), page: { x: PT, z0: zc, z1: zfp, y0: sq, y1: h - sq }, endW: zE1 - zE0 };
}

/* ---- the cloth, the stamping, the pages */
const _hc = new THREE.Color();
function heroCloth(bk, S = 256) {   // a tile of the book's cloth, ~5 cm square: a fine weave whose threads are not all
  // alike (each a little lighter or darker, here and there a slub, a thicker stretch of thread), and flecks
  const c = canvas(S, S), g = c.getContext('2d'), r = rng(bk.idx * 31 + 5);
  g.fillStyle = '#' + bk.color.getHexString(THREE.SRGBColorSpace); g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(255,255,255,${0.03 + 0.04 * r()})`; g.fillRect(0, y, S, 1); }
  for (let x = 0; x < S; x += 2) { g.fillStyle = `rgba(0,0,0,${0.035 + 0.04 * r()})`; g.fillRect(x, 0, 1, S); }
  for (let k = 0; k < 40; k++) {   // slubs, along the weft and the warp: they catch the light a little
    const along = r() < 0.6, l = 5 + r() * 14, x = r() * S, y = Math.floor(r() * S / 2) * 2; g.fillStyle = `rgba(255,252,244,${0.025 + 0.03 * r()})`;
    for (const ox of [-S, 0]) for (const oy of [-S, 0]) along ? g.fillRect(x + ox + S, y + oy + S, l, 1.6) : g.fillRect(y + ox + S, x + oy + S, 1.6, l);   // (wrapped: the tile repeats)
  }
  for (let k = 0; k < S * S / 90; k++) { g.fillStyle = `rgba(${r() < .5 ? '0,0,0' : '255,255,255'},${r() * .07})`; g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r()); }
  return c;
}
function heroCanvasTex(c, color, rep) {
  const t = new THREE.CanvasTexture(c); if (color) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.userData.keep = true; return t;   // (keep: drawn again, core/loop.js releaseSources)
}
// the front: the cover's own picture, or the cloth with a ruled frame, the title as large as fits above the author
// (italics) and the year, all centred on the board (the groove of the joint takes the strip on the left)
function heroCoverLayout(g, W, H, bk, x0, frameOnly) {
  const w = W - x0, k = w / 576, serif = `Georgia, 'Times New Roman', serif`;
  g.save(); g.translate(x0, 0); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.lineWidth = 3.4 * k; g.strokeRect(36 * k, 36 * k, w - 72 * k, H - 72 * k); g.lineWidth = 1.6 * k; g.strokeRect(50 * k, 50 * k, w - 100 * k, H - 100 * k);
  if (frameOnly) { g.restore(); return; }
  const by = byOf(bk.it), parts = by ? by.split(/\s+·\s+/) : [], year = parts.length && /^\d{3,4}$/.test(parts[parts.length - 1]) ? parts.pop() : '', who = parts.join(' · ');
  const bs = Math.round(w * 0.072), ys = Math.round(w * 0.056);
  g.font = `italic ${bs}px ${serif}`; const wl = who ? wrapText(g, who, w - 110 * k) : [];
  const yearY = H - w * 0.15, lastWho = year ? yearY - ys * 1.45 : yearY;
  const top = wl.length ? lastWho - (wl.length - 1) * bs * 1.2 - bs : year ? yearY - ys : H - w * 0.1;
  let size = Math.round(w * 0.118), lines = [];
  const bottom = () => H * 0.2 + size + (lines.length - 1) * size * 1.16 + size * 0.55;
  for (;; size -= 2) { g.font = `600 ${size}px ${serif}`; lines = wrapText(g, printTitle(bk.it), w - 104 * k); if (size <= 22 || (lines.length <= 5 && bottom() < top - w * 0.05)) break; }
  const y0 = H * 0.2 + size; lines.forEach((l, i) => g.fillText(l, w / 2, y0 + i * size * 1.16));
  g.fillRect(w / 2 - 44 * k, bottom(), 88 * k, 3.4 * k);
  if (year) { g.font = `500 ${ys}px ${serif}`; g.fillText(year, w / 2, yearY); }
  g.font = `italic ${bs}px ${serif}`; wl.forEach((l, i) => g.fillText(l, w / 2, lastWho - (wl.length - 1 - i) * bs * 1.2));
  g.restore();
}
// the spine: a pair of rules at the head and the foot, the title along it (two lines on a thick spine, narrowed a little
// rather than cut), as on the shelf
function heroSpineLayout(g, W, H, bk) {
  const k = W / 96; g.save();
  for (const y of [24 * k, H - 27 * k]) { g.fillRect(0, y, W, 2.6 * k); g.fillRect(0, y + 6 * k, W, 1.2 * k); }
  const font = n => `600 ${n}px Inter, 'Helvetica Neue', Arial, sans-serif`;
  g.translate(W / 2, H / 2); g.rotate(Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle';
  const room = H - 80 * k, two = bk.t >= 0.028, S = W * 0.9;   // (the middle of the round: its sides turn away)
  let size = Math.round(S * (two ? 0.38 : 0.6)), txt = printTitle(bk.it); g.font = font(size);
  while (g.measureText(txt).width > room * (two ? 2 : 1) && size > Math.round(S * (two ? 0.32 : 0.48))) { size -= 1; g.font = font(size); }
  const fit = (s, f) => { while (g.measureText(s).width * f > room && s.length > 4) s = s.slice(0, -2).trimEnd() + '…'; return s; };
  if (two && g.measureText(txt).width > room) {
    const words = txt.split(/\s+/); let a = '', i = 0; while (i < words.length && g.measureText((a ? a + ' ' : '') + words[i]).width <= room) a += (a ? ' ' : '') + words[i++];
    if (!a) { a = words[0]; i = 1; }
    g.fillText(fit(a, 1), 0, -size * 0.58); g.fillText(fit(words.slice(i).join(' '), 1), 0, size * 0.58);
  } else { const sx = Math.max(0.8, Math.min(1, room / g.measureText(txt).width)); txt = fit(txt, sx); g.scale(sx, 1); g.fillText(txt, 0, 0); }
  g.restore();
}
// one face (front or spine) as two pictures: its colours, and its surface: how high (red: the weave, the stamping
// pressed in; three.js bumps by red), how rough (green) and how metallic (blue) each part is: the cloth matte, the
// stamping smoother with a touch of foil
function heroFace(bk, W, H, cloth, layout, ink) {
  const col = canvas(W, H), surf = canvas(W, H), gc = col.getContext('2d');
  let bump, rm, gb, gr;
  const merge = () => {   // red from the height, green and blue from the roughness and metal
    const a = gb.getImageData(0, 0, W, H).data, b = gr.getImageData(0, 0, W, H), d = b.data;
    for (let i = 0; i < d.length; i += 4) d[i] = a[i];
    surf.getContext('2d').putImageData(b, 0, 0);
  };
  const paint = () => {
    bump = canvas(W, H); rm = canvas(W, H); gb = bump.getContext('2d', { willReadFrequently: true }); gr = rm.getContext('2d', { willReadFrequently: true });   // (read back to merge)
    gc.fillStyle = gc.createPattern(cloth, 'repeat'); gc.fillRect(0, 0, W, H);
    const r = rng(bk.idx + 7);
    for (let k = 0; k < 36; k++) {   // the dye a little uneven: soft, wide patches, lighter and darker (across the face, so the tile's repeat does not show)
      const x = r() * W, y = r() * H, rr = W * (0.08 + 0.2 * r()), lt = r() < 0.5, m = gc.createRadialGradient(x, y, 0, x, y, rr);
      m.addColorStop(0, lt ? 'rgba(255,250,240,0.045)' : 'rgba(0,0,0,0.05)'); m.addColorStop(1, 'rgba(0,0,0,0)'); gc.fillStyle = m; gc.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
    }
    const wear = gc.createLinearGradient(0, 0, 0, H);   // the cloth rubbed paler toward the head and the foot
    wear.addColorStop(0, 'rgba(255,250,240,0.10)'); wear.addColorStop(0.06, 'rgba(255,250,240,0)'); wear.addColorStop(0.94, 'rgba(255,250,240,0)'); wear.addColorStop(1, 'rgba(255,250,240,0.12)');
    gc.fillStyle = wear; gc.fillRect(0, 0, W, H);
    for (let k = 0; k < 900; k++) { gc.fillStyle = `rgba(255,250,240,${r() * 0.05})`; const ed = r() < 0.5, x = ed ? W - r() * W * 0.03 : r() * W, y = ed ? r() * H : (r() < 0.5 ? r() * H * 0.02 : H - r() * H * 0.02); gc.fillRect(x, y, 1 + r() * 3, 1 + r() * 3); }
    for (const y of [0, H]) {   // the fore-edge's corners rubbed pale, the cloth worn through to its threads there
      const cr = W * 0.05, rg = gc.createRadialGradient(W, y, 0, W, y, cr); rg.addColorStop(0, 'rgba(255,248,236,0.28)'); rg.addColorStop(1, 'rgba(255,248,236,0)');
      gc.fillStyle = rg; gc.fillRect(W - cr, y ? H - cr : 0, cr, cr);
      for (let k = 0; k < 60; k++) { const a = r() * Math.PI / 2, rr = cr * Math.pow(r(), 1.6); gc.fillStyle = `rgba(255,250,240,${0.1 + 0.15 * r()})`; gc.fillRect(W - Math.cos(a) * rr, y ? H - Math.sin(a) * rr : Math.sin(a) * rr, 1 + r() * 2, 1); }
    }
    gb.fillStyle = '#8c8c8c'; gb.fillRect(0, 0, W, H); gb.globalAlpha = 0.5; gb.fillStyle = gb.createPattern(cloth, 'repeat'); gb.fillRect(0, 0, W, H); gb.globalAlpha = 1;   // (the weave)
    gr.fillStyle = 'rgb(0,214,0)'; gr.fillRect(0, 0, W, H);
    if (layout) {   // (the cloth pressed round the stamping darkens a little: it also keeps the words clear of the cloth)
      gc.save(); gc.shadowColor = ink === '#2a2118' ? 'rgba(226,214,192,.55)' : 'rgba(20,14,8,.6)'; gc.shadowBlur = Math.max(3, W * 0.012);
      gc.fillStyle = gc.strokeStyle = ink; layout(gc); gc.restore();
      gb.filter = 'blur(1.2px)'; gb.fillStyle = gb.strokeStyle = '#1a1a1a'; layout(gb); gb.filter = 'none';
      gr.fillStyle = gr.strokeStyle = 'rgb(0,92,96)'; layout(gr);
    }
    merge();
  };
  paint();
  const face = { col, paint, tex: heroCanvasTex(col, true), surfTex: heroCanvasTex(surf),
    flat: (x, y, w, h) => { gb.fillStyle = '#8c8c8c'; gb.fillRect(x, y, w, h); gr.fillStyle = 'rgb(0,150,0)'; gr.fillRect(x, y, w, h); merge(); face.surfTex.needsUpdate = true; } };
  return face;
}
/* ---- the page edges, drawn in the shader so their lines hold at any size (a texture's lines either blurred into one
   cream tone or shimmered). Across the block (u), one seam between each leaf and the next, and every 10 leaves (20
   pages) the fold of a sewn section, darker; each section's edge a little rounded, so the block reads as bundles of
   leaves; a leaf or a section standing a little proud, lighter; the leaves' edges wandering a little along the block
   (u nudged by a slow wave, each section its own); in the boards' shadow where they overhang; dustier at the head and
   the foot. Every pattern is box-filtered over the pixel it falls in (its integral differenced over the pixel's width,
   as in Apodaca & Gritz, "Advanced RenderMan", ch. 11, and Inigo Quilez's "filtering procedurals"): a line finer than a
   pixel fades into its average instead of breaking into moiré, and the folds, a few pixels apart on the screen, stay
   crisp. */
const HERO_PAGE_GLSL = `
  float hpg(float n) { return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }
  float pulseI(float t, float a) { float s = t + 0.5 * a; return floor(s) * a + min(fract(s), a); }
  float pulseF(float x, float w, float a) { return (pulseI(x + 0.5 * w, a) - pulseI(x - 0.5 * w, a)) / w; }   // how much of [x - w/2, x + w/2] lies within a/2 of a whole number
  float cosF(float x, float w) { return w < 1e-3 ? cos(6.2831853 * x) : (sin(6.2831853 * (x + 0.5 * w)) - sin(6.2831853 * (x - 0.5 * w))) / (6.2831853 * w); }
`;
const HERO_PAGE_MAIN = `
  {
    vec2 pu = vUv;   // u across the block (back board to front), v along it
    float L = uLeaves, S = 10.0, sec = floor(pu.x * L / S);   // (S leaves to a section: 20 pages)
    float wob = 0.12 * (0.6 * sin(pu.y * 9.0 + hpg(sec) * 6.283) + 0.4 * sin(pu.y * 23.0 + hpg(sec + 31.0) * 6.283));   // (in leaves)
    float x = pu.x * L + wob, w = max(fwidth(x), 1e-4), xs = x / S, ws = w / S;
    float seam = pulseF(x, w, 0.22), fold = pulseF(xs, ws, 0.12), bulge = 0.5 - 0.5 * cosF(xs, ws);
    float lf = (hpg(floor(x) + 17.0) - 0.5) * (1.0 - smoothstep(0.35, 1.0, w)), sf = (hpg(floor(xs) + 59.0) - 0.5) * (1.0 - smoothstep(0.5, 1.2, ws));
    float ao = smoothstep(0.0, 0.07, pu.x) * smoothstep(0.0, 0.07, 1.0 - pu.x);
    float k = (1.0 - 0.3 * seam) * (1.0 - 0.75 * fold * (0.55 + 0.9 * hpg(floor(xs + 0.5) + 3.0))) * mix(0.76, 1.0, bulge) * (1.0 + 0.1 * lf + 0.2 * sf);
    diffuseColor.rgb = vec3(0.86, 0.77, 0.58) * k * mix(0.5, 1.0, ao) * (1.0 - 0.07 * smoothstep(0.86, 1.0, abs(pu.y * 2.0 - 1.0)));
  }
`;
function heroPagesMat(bk, base) {
  const info = bookInfo(bk.it), leaves = Math.max(40, Math.round((info && info.pages ? info.pages : (bk.t - 0.004) / 0.00006) / 2));
  const m = heroSharp(new THREE.MeshStandardMaterial({ ...base, emissiveIntensity: 0.16, roughness: 0.9, metalness: 0 }), bk.flapU), patch = m.onBeforeCompile;   // (paper lit through: a little more light of its own)
  m.defines = { USE_UV: '' }; m.customProgramCacheKey = () => 'hero-pages';
  m.onBeforeCompile = sh => {
    patch(sh); sh.uniforms.uLeaves = { value: leaves }; sh.uniforms.uSeed = { value: (bk.idx * 0.137) % 1 };
    sh.fragmentShader = 'uniform float uLeaves, uSeed;\n' + HERO_PAGE_GLSL + sh.fragmentShader.replace('#include <map_fragment>', HERO_PAGE_MAIN)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= diffuseColor.rgb;');
  };
  return m;
}
function heroBand(bk) {   // the headband: silk wound on its core, two colours
  const c = canvas(64, 16), g = c.getContext('2d'), a = inkFor(bk.color) === INK_LIGHT ? '#e9dcc0' : '#7c2b26';
  g.fillStyle = '#8f2f29'; g.fillRect(0, 0, 64, 16); g.fillStyle = a;
  for (let x = -16; x < 80; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 4, 0); g.lineTo(x + 8, 16); g.lineTo(x + 4, 16); g.fill(); }
  const t = heroCanvasTex(c, true, true); t.repeat.set(14, 1); return t;
}
// the first page of an atlas (the Geography books): its map, drawn when the browser is next idle after the book leaves the
// shelf (some 50 to 150 ms), or as it starts to open if it has not been yet, and again in the other language
function heroAtlasPage(bk, shape, base) {
  const pg = shape.page, W = 1024, H = Math.round(W * (pg.y1 - pg.y0) / (pg.z0 - pg.z1)), c = canvas(W, H), g = c.getContext('2d'), info = bookInfo(bk.it);
  g.fillStyle = '#f1e8d2'; g.fillRect(0, 0, W, H);
  // and its endpaper, inside the front board: a printed pattern of compass roses, a bookplate, and a word on what the
  // map does
  const EW = 768, EH = Math.round(EW * bk.h / shape.endW), ce = canvas(EW, EH), ge = ce.getContext('2d'); ge.fillStyle = '#ece4d0'; ge.fillRect(0, 0, EW, EH);
  const tex = heroCanvasTex(c, true), etex = heroCanvasTex(ce, true), page = { done: false, frame: null, tex, etex,
    paint: () => { page.frame = drawAtlas(c, info.map, pageLang()); drawEndpaper(ce, info.map, pageLang(), titleIn(bk.it)); page.done = true; tex.needsUpdate = etex.needsUpdate = true; setNeeds(true); } };
  (window.requestIdleCallback || (f => setTimeout(f, 200)))(() => { if (!page.done && bk.hero) page.paint(); }, { timeout: 700 });
  bk.atlas = page;
  page.endMat = heroSharp(new THREE.MeshStandardMaterial({ ...base, map: etex, emissiveMap: etex, emissiveIntensity: 0.1, roughness: 0.9, metalness: 0 }), bk.flapU);
  return heroSharp(new THREE.MeshStandardMaterial({ ...base, map: tex, emissiveMap: tex, emissiveIntensity: 0.12, roughness: 0.86, metalness: 0 }), bk.flapU);
}
function heroMaterials(bk, shape) {
  const ink = inkFor(bk.color), cloth = heroCloth(bk), img = coverOf(bk.it), H = bk.h;
  bk.flapU = { uOpen: { value: 0 }, uHinge: { value: shape.hinge.clone() }, uSize: { value: new THREE.Vector3(bk.t, bk.h, bk.d) } };   // (the cover's turn: shared by its materials)
  const FW = 768, FH = Math.round(FW * H / shape.frontW), SW = 160, SH = Math.max(160, Math.round(SW * H / shape.spineL));
  const front = heroFace(bk, FW, FH, cloth, g => heroCoverLayout(g, FW, FH, bk, FW * shape.frontU0, !!img), ink);
  const spine = heroFace(bk, SW, SH, cloth, g => heroSpineLayout(g, SW, SH, bk), ink);
  const env = heroEnv(), sheenColor = _hc.copy(bk.color).lerp(new THREE.Color(1, 1, 1), 0.2).clone();
  const base = { fog: false, envMap: env, envMapIntensity: 0.16, emissive: 0xffffff, emissiveIntensity: 0.09 }; bk.heroBase = base;
  const clothMat = (face, o) => heroSharp(new THREE.MeshPhysicalMaterial({ ...base, map: face.tex, emissiveMap: face.tex, bumpMap: face.surfTex, bumpScale: 4.2,
    roughness: 1, metalness: 1, roughnessMap: face.surfTex, metalnessMap: face.surfTex, sheen: 0.4, sheenRoughness: 0.72, sheenColor, ...o }), bk.flapU);
  const ct = heroCanvasTex(cloth, true, true);
  const mats = [
    clothMat(front, img ? { sheen: 0, clearcoat: 0.5, clearcoatRoughness: 0.26 } : {}),
    clothMat(spine),
    heroSharp(new THREE.MeshPhysicalMaterial({ ...base, map: ct, emissiveMap: ct, bumpMap: ct, bumpScale: 1.6, roughness: 0.84, metalness: 0, sheen: 0.4, sheenRoughness: 0.72, sheenColor }), bk.flapU),
    heroSharp(new THREE.MeshStandardMaterial({ ...base, color: _hc.set(0xebe1c8).lerp(bk.color, 0.18).clone(), emissive: _hc.clone(), roughness: 0.92, metalness: 0 }), bk.flapU),
    null, null, null, null];
  mats[4] = heroPagesMat(bk, base);
  const bt = heroBand(bk); mats[5] = heroSharp(new THREE.MeshStandardMaterial({ ...base, map: bt, emissiveMap: bt, roughness: 0.55, metalness: 0 }), bk.flapU);
  const info = bookInfo(bk.it); mats[6] = info && info.map ? heroAtlasPage(bk, shape, base) : mats[3];   // (the first page: an atlas's map, else a flyleaf)
  mats[7] = bk.atlas ? bk.atlas.endMat : mats[3];   // (the front board's endpaper: an atlas's printed one)
  if (img) { const im = new Image(); im.onload = () => {   // the jacket over the whole board (and its joint): the book was made the cover's shape
    // (sections.js), so it fits; where the shelf held it to another shape, the picture still covers the board, its overflow cut
    const W = FW, Hh = FH, a = im.width / im.height, b2 = W / Hh, g = front.col.getContext('2d'), w = a > b2 ? Hh * a : W, hh = a > b2 ? Hh : W / a;
    g.drawImage(im, (W - w) / 2, (Hh - hh) / 2, w, hh); front.flat(0, 0, W, Hh);   // (printed paper: smoother than the cloth, and flat)
    front.tex.needsUpdate = true; setNeeds(true);
  }; im.src = img; }
  bk.heroFaces = { front: img ? null : front, spine };   // (a jacket's picture is not redrawn for another language)
  bk.heroShape = { hinge: shape.hinge, page: shape.page, endW: shape.endW };
  return mats;
}
function heroMesh(bk) {
  if (bk.hero) return bk.hero;
  if (!heroMesh.lit) { heroMesh.lit = true; scene.traverse(o => { if (o.isLight) o.layers.enable(HERO_LAYER); }); }   // (the room's lights light it there too)
  const shape = heroGeometry(bk), m = new THREE.Mesh(shape.geo, heroMaterials(bk, shape));
  m.layers.set(HERO_LAYER); m.visible = false; m.userData.book = bk; scene.add(m); bk.hero = m;
  if (isReadItem(bk.it) && buildRead(bk, shape, m, bk.heroBase)) m.material[7] = heroSharp(bk.read.endMat, bk.flapU);   // (a book of notes: its leaves, and its title page inside the front board)
  HERO.list.push(bk); heroForget(); return m;
}
// a book out of the shelf made one to read, if it is not yet (being listened to, opened on its summary: ui/leaves.js):
// its leaves, and its title page inside the front board; false if it has nothing to show
function heroRead(bk) {
  if (bk.read) return true; if (!bk.hero || !bk.heroShape) return false;
  if (!buildRead(bk, bk.heroShape, bk.hero, bk.heroBase)) return false;
  bk.hero.material[7] = heroSharp(bk.read.endMat, bk.flapU); setNeeds(true); return true;
}
// past HERO.keep books made, the one longest out of sight (and not on its way anywhere) is let go: its pictures are large
function heroForget() {
  const idle = HERO.list.filter(bk => bk.hero && !bk.hero.visible && !UIS.touched.has(bk)).sort((a, b) => (a.heroSeen || 0) - (b.heroSeen || 0));
  while (HERO.list.length > HERO.keep && idle.length) {
    const bk = idle.shift(), m = bk.hero; scene.remove(m); m.geometry.dispose();
    for (const mt of m.material) { for (const k of ['map', 'bumpMap', 'roughnessMap']) if (mt[k]) mt[k].dispose(); mt.dispose(); }
    if (bk.read) readDispose(bk);
    bk.hero = null; bk.heroFaces = null; bk.atlas = null; HERO.list.splice(HERO.list.indexOf(bk), 1);
  }
}
// the page's language switched: the title on a book already out drawn again
function relabelHero(bk) {
  if (!bk.heroFaces) return;
  for (const f of [bk.heroFaces.front, bk.heroFaces.spine]) if (f) { f.paint(); f.tex.needsUpdate = f.surfTex.needsUpdate = true; }
  if (bk.atlas && bk.atlas.done) bk.atlas.paint();
  if (bk.read) relabelRead(bk);
}

export { HERO, HERO_LAYER, heroCanvasTex, heroKey, heroMesh, heroRead, inkFor, relabelHero, wrapText };
