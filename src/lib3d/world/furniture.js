import './rug.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { alphaTex, canvas, ctex, radialPaint, rng, stopsAt } from '../core/utils.js';
import { CANVAS, reduceMotion } from '../core/base.js';
import { camera, setShadowsDirty } from '../core/renderer.js';
import { MAT } from './materials.js';
import { makeWood } from './wood.js';
import { handMade, makeMatter, smoothProfile, turned } from './matter.js';

/* ---------------------------------------------------------------- small furniture */
// the lamps' finishes, none of them even (matter.js): the shade's linen, the copper dulled where no hand reaches. Given
// once, to the materials the lamps share.
function wornFinishes() {
  if (MAT.shade.userData.matter) return;
  makeMatter('woven', MAT.shade, { a: [-0.105, 0.105, 0.16, 0.115], c: [820, 2.4, -0.03, 0] });
  makeMatter('tarnish', MAT.copper, { a: [5200, 1, 0, 0], b: 0x3a271b });
}
// the plant's pot: thrown stoneware, a pale speckled glaze over brown clay, its foot bare, its rim not level; earth in it
function planter() {
  const g = new THREE.Group();
  const wall = smoothProfile([[.001, 0], [.096, 0], [.104, .006], [.128, .035], [.144, .07], [.150, .105], [.151, .117], [.146, .1235], [.139, .118], [.133, .10], [.129, .084]], 34);
  const pot = new THREE.Mesh(handMade(turned(wall, 64), { oval: 0.02, wave: 0.006, lean: 0.03, rim: 0.003, seed: 12 }),
    makeMatter('fired', new THREE.MeshStandardMaterial({ color: 0xb9b5aa, roughness: .5, metalness: 0, side: THREE.DoubleSide }), { a: [0.016, 0.1235, 1, 0], b: 0x7a5a42, c: [700, 0.35, 1, 0] }));
  pot.castShadow = pot.receiveShadow = true; g.add(pot);
  // the earth in it: a lumpy disc (its crumbs and grit are in its finish)
  const r = rng(31), rings = 7, segs = 28, pos = [], idx = [];
  for (let i = 0; i <= rings; i++) for (let j = 0; j < segs; j++) { const t = i / rings, a = j / segs * Math.PI * 2 + i * 0.4, rad = 0.131 * t; pos.push(Math.cos(a) * rad, 0.094 + (r() - 0.5) * 0.007 * Math.min(1, t * 3) + 0.006 * (1 - t * t), Math.sin(a) * rad); }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) { const p = i * segs + j, q = i * segs + (j + 1) % segs; idx.push(p, p + segs, q, q, p + segs, q + segs); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setIndex(idx); sg.computeVertexNormals();
  const soil = new THREE.Mesh(sg, makeMatter('fired', new THREE.MeshStandardMaterial({ color: 0x3a2616, roughness: 1, metalness: 0, side: THREE.DoubleSide }), { c: [0, 0, 0, 1] })); soil.receiveShadow = true; g.add(soil);
  return g;
}
function stumpTable() {
  const g = new THREE.Group();
  // a slab cut across a trunk, its bark left on its edge, on a length of the same trunk, peeled: one tree for the two
  // (the same pith, the same rings: wood.js)
  const wood = o => makeWood({ light: 0xbd8a4e, dark: 0x6e4521, grain: 'y', pith: [0.035, -0.02], ring: 0.0075, rough: 0.5, ...o });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.3, 0.05, 48), wood({ checks: 1, bark: 0.296 })); top.position.y = 0.505; g.add(top);
  const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.24 + 0.012 * Math.sin(t * 9) + (t < .1 ? .02 * (1 - t / .1) : 0), t * 0.48)); }
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), wood({ light: 0x8c5c33, dark: 0x4c2d15, rough: 0.62, bump: 1.6, checks: 1 })); g.add(body);
  // (the cap over the trunk, under the top where no view sees it, left out)
  g.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
  return g;
}
function leafGeometry() {
  // a leaf 1 long pointing +z from the end of its stalk: its two halves folded up a little about the midrib and each
  // cupped, its edge wavering, drooping toward its tip. Its outline is the one its finish knows (matter.js, 'leaf').
  const rows = 14, cols = 3, n = 2 * cols + 1, pos = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, w = Math.sin(Math.PI * Math.pow(t, 0.75)) * 0.32 * (1 - 0.25 * t), droop = -0.2 * t * t + 0.025 * Math.sin(t * 3.1);
    for (let j = -cols; j <= cols; j++) { const e = j / cols, ae = Math.abs(e); pos.push(e * w, droop + ae * w * 0.24 - ae * ae * w * 0.11 + 0.014 * Math.sin(t * 11 + (j < 0 ? 0 : 1.9)) * ae * ae * (0.3 + t), t); }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < n - 1; j++) { const a = i * n + j; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
// a stalk along a curve, into G { pos, nor, col, idx }: r0 thick at its foot, easing to r1; its colour c0 there, c1 at its end
function stalk(G, curve, r0, r1, segs, sides, c0, c1) {
  const fr = curve.computeFrenetFrames(segs, false), o = G.pos.length / 3, P = new THREE.Vector3(), N = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, rad = r1 + (r0 - r1) * Math.pow(1 - t, 1.6); curve.getPointAt(t, P); c.copy(c0).lerp(c1, Math.pow(t, 0.7));
    for (let j = 0; j < sides; j++) { const a = j / sides * Math.PI * 2; N.copy(fr.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(fr.binormals[i], Math.sin(a)); G.pos.push(P.x + N.x * rad, P.y + N.y * rad, P.z + N.z * rad); G.nor.push(N.x, N.y, N.z); G.col.push(c.r, c.g, c.b); }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < sides; j++) { const p = o + i * sides + j, q = o + i * sides + (j + 1) % sides; G.idx.push(p, q, p + sides, q, q + sides, p + sides); }
}
function plant({ leaves = 90, spread = 0.55, height = 0.75, seed = 5, scale = 0.12 } = {}) {
  const r = rng(seed); const g = new THREE.Group(); const lg = leafGeometry(), leavesOf = [];
  const mat = makeMatter('leaf', new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6, side: THREE.DoubleSide }));   // (veins, patches, and each leaf its own age: matter.js)
  const inst = new THREE.InstancedMesh(lg, mat, leaves);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < leaves; i++) {
    const a = r() * Math.PI * 2, rad = Math.pow(r(), 0.7) * spread, h = height * (0.25 + 0.75 * r()) * (1 - 0.45 * rad / spread);
    p.set(Math.cos(a) * rad, h, Math.sin(a) * rad);
    e.set(-0.3 - r() * 0.9 + rad * 0.6, a + Math.PI / 2 + (r() - .5) * 1.2, (r() - .5) * .8, 'YXZ'); q.setFromEuler(e);
    const sc = scale * (0.7 + r() * 0.6); s.set(sc, sc, sc * 1.2); m.compose(p, q, s); inst.setMatrixAt(i, m);
    leavesOf.push({ p: p.clone(), q: q.clone(), s: s.clone(), len: sc * 1.2 });
    inst.setColorAt(i, new THREE.Color().setHSL(0.24 + r() * 0.06, 0.45 + r() * .2, 0.3 + r() * 0.22));
  }
  inst.castShadow = true; g.add(inst); g.userData.inst = inst; g.userData.leaves = leavesOf;   // (each leaf as it was set: plantTouch moves them about that)
  // its stalks (their own random draws: the leaves stay where they were). Every third leaf stands on a cane that rises
  // from the earth, the canes from a clump of crowns and not from one point, thick at the foot and browner there; each
  // other leaf's stalk leaves the nearest cane below it and comes to the leaf along the leaf's own line.
  const r2 = rng(seed + 101), G = { pos: [], nor: [], col: [], idx: [] }, canes = [], V = THREE.Vector3;
  const foot = new THREE.Color(0x4d4a26), green = new THREE.Color(0x5f8236), young = new THREE.Color(0x7f9f48);
  leavesOf.forEach((l, i) => {
    if (i % 3) return; const a = r2() * Math.PI * 2, rho = 0.008 + 0.04 * Math.sqrt(r2()), b = new V(Math.cos(a) * rho, 0, Math.sin(a) * rho);
    const c = new THREE.QuadraticBezierCurve3(b, new V(b.x * 0.5 + l.p.x * .3, l.p.y * .8, b.z * 0.5 + l.p.z * .3), l.p.clone());
    stalk(G, c, 0.0042 + 0.0012 * r2(), 0.0017, 12, 6, foot, green); canes.push(c.getSpacedPoints(10).slice(3));
  });
  leavesOf.forEach((l, i) => {
    if (!(i % 3)) return; let best = null, bd = 1e9;
    for (const pts of canes) for (const c of pts) { const d = c.distanceToSquared(l.p) * (c.y > l.p.y ? 3 : 1); if (d < bd) { bd = d; best = c; } }   // (from below it, rather)
    const ax = new V(0, 0, 1).applyQuaternion(l.q), d = best.distanceTo(l.p), back = Math.max(0, l.p.clone().sub(best).dot(ax) / d);   // (back: how far the leaf points away from where its stalk starts: only then can the stalk come to it along its line, without a hook)
    const mid = best.clone().lerp(l.p, 0.5).lerp(l.p.clone().addScaledVector(ax, -0.4 * d), back); mid.y -= 0.05 * d;
    stalk(G, new THREE.QuadraticBezierCurve3(best.clone(), mid, l.p.clone()), 0.0021 + 0.0006 * r2(), 0.0011, 7, 5, green, young);
  });
  const sg = new THREE.BufferGeometry(); sg.setIndex(G.idx); sg.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3)); sg.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(G.col, 3));
  const stems = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .62 })); stems.castShadow = true; g.add(stems);
  return g;
}
const PLANT = { g: null, inst: null, L: null, in: false, poke: false, ndc: new THREE.Vector2(), last: new THREE.Vector2(), seen: false, live: false,
  ray: new THREE.Raycaster(), sway: new THREE.Vector2(), swayV: new THREE.Vector2(), c: new THREE.Vector3(), rad: 0.5 };
const _lfM = new THREE.Matrix4(), _lfQ = new THREE.Quaternion(), _lfQ2 = new THREE.Quaternion(), _lfE = new THREE.Euler(), _lfV = new THREE.Vector3(), _lfW = new THREE.Vector3(), _lfR = new THREE.Vector3(), _lfU = new THREE.Vector3();
function plantTouch(pl) {   // the plant whose leaves the pointer stirs
  const P = PLANT; P.g = pl; P.inst = pl.userData.inst; P.L = pl.userData.leaves; P.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // (the pointer over the room itself, not over a card or a label lying over the plant)
  addEventListener('pointermove', e => { if (e.target !== CANVAS) { P.in = false; return; } const r = CANVAS.getBoundingClientRect(); P.ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); P.in = true; }, { passive: true, capture: true });
  addEventListener('pointerdown', e => { if (e.target === CANVAS && P.in) P.poke = true; }, { passive: true, capture: true });
  CANVAS.addEventListener('pointerleave', () => { P.in = false; });
}
function plantBind() {   // where its leaves are in the room (worked out the first time the pointer comes by: the room is all in place by then)
  const P = PLANT, pl = P.g; P.bound = true; pl.updateWorldMatrix(true, true);
  const wq = pl.getWorldQuaternion(new THREE.Quaternion());
  for (const [i, l] of P.L.entries()) {   // each leaf's middle and its own axes in the room; how fast it swings; where it is now and how fast it turns
    const q = wq.clone().multiply(l.q); l.c = new THREE.Vector3(0, 0, l.len * 0.55).applyQuaternion(l.q).add(l.p).applyMatrix4(pl.matrixWorld);
    l.ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q); l.ay = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    l.k = (Math.PI * 2 * (2.6 + 2.2 * 0.11 / Math.max(l.len, 0.06) + ((i * 0.618) % 1))) ** 2; l.a = 0; l.b = 0; l.va = 0; l.vb = 0;   // (a leaf of 11 cm ~5 swings a second, one of 20 cm ~4)
  }
  P.c.set(0, 0.32, 0).applyMatrix4(pl.matrixWorld);
}
function stepPlant(dt) {   // true while a leaf moves (core/loop.js: every frame drawn meanwhile)
  const P = PLANT; if (!P.inst || reduceMotion) return false;
  let pushed = false;
  if (P.in && !P.bound) plantBind();
  if (P.in) {
    P.ray.setFromCamera(P.ndc, camera); const ray = P.ray.ray, near = ray.distanceSqToPoint(P.c) < P.rad * P.rad;
    if (near && P.seen && dt > 0) {
      // how fast the pointer goes over the plant, in the room: its move on the screen, as far off as the plant is
      const d = camera.position.distanceTo(P.c), th = Math.tan(camera.fov * Math.PI / 360) * d;
      _lfR.setFromMatrixColumn(camera.matrixWorld, 0); _lfU.setFromMatrixColumn(camera.matrixWorld, 1);
      const v = _lfV.copy(_lfR).multiplyScalar((P.ndc.x - P.last.x) * th * camera.aspect / dt).addScaledVector(_lfU, (P.ndc.y - P.last.y) * th / dt).clampLength(0, 2.5), sp = v.length();
      const jolt = P.poke ? 1 : 0;
      if (sp > 0.03 || jolt) for (const l of P.L) {
        const w = jolt ? 0.55 + 0.45 * Math.random() : Math.max(0, 1 - Math.sqrt(ray.distanceSqToPoint(l.c)) / 0.1); if (w <= 0) continue;
        const g = w * (jolt ? 8 : 9 * Math.min(sp, 1.5));   // (how fast the push turns it, rad/s: a brisk brush swings it ~20 degrees)
        if (jolt) { l.va += g * (Math.random() - 0.5) * 2; l.vb += g * (Math.random() - 0.5) * 2; }
        else { l.va += -g * v.dot(l.ay) / (sp || 1); l.vb += g * v.dot(l.ax) / (sp || 1); P.swayV.x += 0.012 * w * v.x; P.swayV.y += 0.012 * w * v.z; }
        pushed = true;
      }
      if (jolt) { P.swayV.x += 0.25 * (Math.random() - 0.5); P.swayV.y += 0.25 * (Math.random() - 0.5); }
    }
    P.last.copy(P.ndc); P.seen = near;
  } else P.seen = false;
  P.poke = false;
  if (!pushed && !P.live) return false;
  // the springs (in steps of 4 ms at most: the quick leaves), then each leaf's place
  let moving = false; const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n, ks = (Math.PI * 2 * 1.5) ** 2, cs = 2 * 0.22 * Math.PI * 2 * 1.5;
  for (let s = 0; s < n; s++) { P.swayV.x += (-ks * P.sway.x - cs * P.swayV.x) * h; P.swayV.y += (-ks * P.sway.y - cs * P.swayV.y) * h; P.sway.x += P.swayV.x * h; P.sway.y += P.swayV.y * h; }
  P.sway.clampLength(0, 0.12);
  const swayOn = P.sway.lengthSq() > 1e-7 || P.swayV.lengthSq() > 1e-5; if (swayOn) moving = true;
  // (the lean: a small turn about the level line across the push, more for a leaf high on the plant)
  const sl = P.sway.length(), sax = sl > 1e-6 ? _lfW.set(P.sway.y / sl, 0, -P.sway.x / sl) : null;
  for (let i = 0; i < P.L.length; i++) { const l = P.L[i], c = 2 * 0.085 * Math.sqrt(l.k);
    for (let s = 0; s < n; s++) { l.va += (-l.k * l.a - c * l.va) * h; l.vb += (-l.k * l.b - c * l.vb) * h; l.a += l.va * h; l.b += l.vb * h; }
    l.a = Math.max(-0.7, Math.min(0.7, l.a)); l.b = Math.max(-0.6, Math.min(0.6, l.b));
    const on = Math.abs(l.a) > 4e-4 || Math.abs(l.b) > 4e-4 || Math.abs(l.va) > 0.01 || Math.abs(l.vb) > 0.01;
    if (on) moving = true; else { l.a = l.b = l.va = l.vb = 0; }
    _lfQ.copy(l.q); if (sax) _lfQ.premultiply(_lfQ2.setFromAxisAngle(sax, sl * (0.5 + 1.2 * l.p.y)));
    if (on) _lfQ.multiply(_lfQ2.setFromEuler(_lfE.set(l.a, l.b, 0.6 * l.b, 'YXZ')));
    P.inst.setMatrixAt(i, _lfM.compose(l.p, _lfQ, l.s));
  }
  if (!moving) { P.sway.set(0, 0); P.swayV.set(0, 0); }
  P.inst.instanceMatrix.needsUpdate = true; setShadowsDirty(true); P.live = moving;
  return true;
}
function tableLamp() {
  const g = new THREE.Group();
  wornFinishes();
  // its base thrown and glazed by hand: one curve, not quite round, leaning a hair; a cream glaze that ran and has crazed,
  // the foot left bare (matter.js)
  const prof = smoothProfile([[.001, 0], [.057, 0], [.064, .005], [.077, .03], [.085, .08], [.078, .16], [.05, .22], [.028, .25], [.022, .28]], 40);
  const base = new THREE.Mesh(handMade(turned(prof, 56), { oval: 0.012, wave: 0.004, lean: 0.012, seed: 3 }),
    makeMatter('fired', new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: .3, metalness: 0 }), { a: [0.012, 0.277, 0.3, 1], b: 0xb49d7e, c: [600, 0.3, 0.3, 0] }));
  base.castShadow = true; g.add(base);
  // its shade: linen on two rings, a little out of round and sitting a little askew
  const shade = new THREE.Mesh(handMade(turned([0, 1, 2, 3, 4, 5, 6].map(i => [.16 - .045 * i / 6, -.105 + .21 * i / 6]), 64), { oval: 0.008, wave: 0.002, seed: 8 }), MAT.shade);
  shade.position.y = .4; shade.rotation.set(0.018, 0.6, -0.012); g.add(shade);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.16, .004, 6, 48), MAT.brass); rim.rotation.x = Math.PI / 2; rim.position.y = .295; g.add(rim);
  // (its stem and bulb, inside the shade where no view sees them, left out)
  const light = new THREE.PointLight(0xffc27e, 3.2, 5, 2); light.position.y = .37; g.add(light);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc27e, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(.9); glow.position.y = .4; g.add(glow);
  g.userData.light = light; g.userData.glow = glow; return g;
}
let _glow;
// the bulb over the sofa's glow: as glowTex, with its filament drawn in it (still 90 % visible). The
// modelled filament is under a pixel at the room's distance, and the glow's white middle washed out where it is: there the
// glow is a tenth of itself, and a bright coil lies across it (filamentTex, a sprite of its own: the filament's 4.6 cm,
// ~24 % of the sprite's half-width), so it reads as the lit wire in the glass
let _pgl;
function pendantGlowTex() {
  return _pgl ||= alphaTex(128, 128, (x, y) => {
    const u = (x - 64) / 64, v = (y - 64) / 64 + 0.03;
    const w = Math.max(0, Math.min(1, 1.6 * (1 - Math.abs(v) / 0.04))) * Math.max(0, Math.min(1, (0.14 - Math.abs(u)) / 0.03));   // (where the wire lies, just round it: the bulb larger, a wider cut showed dark)
    return glowAt(x, y) * (1 - 0.7 * w);
  }, g => {
    radialPaint(g, 64, 64, 0, 64, GLOW); const im = g.getImageData(0, 0, 128, 128), d = im.data;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const u = (x + 0.5 - 64) / 64, v = (y + 0.5 - 64) / 64 + 0.03, i = (y * 128 + x) * 4;
      d[i + 3] = Math.round(d[i + 3] * (1 - 0.7 * Math.max(0, Math.min(1, 1.6 * (1 - Math.abs(v) / 0.04))) * Math.max(0, Math.min(1, (0.14 - Math.abs(u)) / 0.03))));
    }
    g.putImageData(im, 0, 0);
  });
}
let _fil;
function filamentTex() {   // the lit coil: a beaded line across, soft at its edges (the same frame as the glow's)
  if (_fil) return _fil; const c = canvas(128, 128), g = c.getContext('2d'), im = g.createImageData(128, 128), d = im.data;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const u = (x + 0.5 - 64) / 64, v = (y + 0.5 - 64) / 64 + 0.03, i = (y * 128 + x) * 4;
    const w = Math.max(0, 1 - Math.abs(v) / 0.022) * Math.max(0, Math.min(1, (0.125 - Math.abs(u)) / 0.02)) * (0.75 + 0.25 * Math.cos(u * 150));
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(255 * w);
  }
  g.putImageData(im, 0, 0); _fil = ctex(c, { rep: false }); return _fil;
}
const GLOW = [[0, 1], [0.25, 0.45], [1, 0]], glowAt = (x, y) => stopsAt(GLOW, Math.hypot(x - 64, y - 64) / 64);   // (a lamp's glow: white, fading out to its edge; written as numbers, not a canvas gradient: core/utils.js alphaTex)
function glowTex() { return _glow ||= alphaTex(128, 128, glowAt, g => radialPaint(g, 64, 64, 0, 64, GLOW)); }
function floorLamp(back = 0.32) {   // back: the counterweight arm's length behind the pole (m)
  const g = new THREE.Group(); wornFinishes();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.15, .16, .025, 40), MAT.bronze); base.position.y = .0125; g.add(base);
  const poleH = 1.42; const pole = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, poleH, 10), MAT.brass); pole.position.y = poleH / 2; g.add(pole);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(.025, 14, 10), MAT.brass); joint.position.y = poleH; g.add(joint);
  // main arm towards the shade (local −x, up), counter arm behind
  const arm = new THREE.Group(); arm.position.y = poleH; arm.rotation.z = -0.62; g.add(arm);
  const aL = 1.0; const rod = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, aL + back, 8), MAT.brass); rod.rotation.z = Math.PI / 2; rod.position.x = -(aL - back) / 2; arm.add(rod);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.03, 14, 10), MAT.bronze); knob.position.x = back; arm.add(knob);
  const head = new THREE.Group(); head.position.x = -aL; arm.add(head);
  // (its shade spun copper, a little dented, tarnished: matter.js)
  const sh = new THREE.Mesh(handMade(turned(smoothProfile([[.014, 0], [.035, -.012], [.06, -.05], [.1, -.13], [.15, -.23], [.165, -.25]], 30), 56), { oval: 0.006, wave: 0.004, seed: 5 }), MAT.copper);
  sh.rotation.set(-0.25, 0, 0.62 - 0.4); head.add(sh);
  // inside it: an enamel lining, its light set by the hour (fx/hour.js), not by the lamp's lights: they are a few cm from it and
  // washed it white; the bulb is what glows
  const ig = sh.geometry.clone(), ip = ig.attributes.position, ic = new Float32Array(ip.count * 3);   // (brighter toward the bulb at its top, darker toward the rim)
  for (let i = 0; i < ip.count; i++) { const k = 1.25 - 0.75 * Math.min(1, Math.max(0, -ip.getY(i) / 0.25)); ic.set([k, k, k], i * 3); }
  ig.setAttribute('color', new THREE.BufferAttribute(ic, 3));
  const inner = new THREE.Mesh(ig, new THREE.MeshBasicMaterial({ color: 0xa0723f, vertexColors: true, side: THREE.DoubleSide }));
  inner.userData.c0 = inner.material.color.clone(); inner.scale.setScalar(0.985); sh.add(inner);
  // (its bulb: the pendant's, copied in at its own size, base up under the shade's top: furnish.js lampBulb)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(0xffc98f).multiplyScalar(0.3), transparent: true, opacity: .6, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(.26); glow.position.y = -.255; sh.add(glow);   // (half as bright: the bulb's glass is, its filament not)   // (a bloom round the bulb only: the light below it is the beam, fx/glow.js)
  const pt = new THREE.PointLight(0xffc98f, 2.5, 4, 2); pt.position.y = -.42; sh.add(pt);   // (under the bulb, which hangs out of the rim: nearer, it lit its glass white)
  const spot = new THREE.SpotLight(0xffc98f, 18, 7, 0.75, 0.65, 2); spot.position.set(0, -.33, 0); sh.add(spot);   // (just under the bulb's glass: above it, 5 cm off, it lit the glass itself white, as the pendant's would)
  const tgt = new THREE.Object3D(); tgt.position.set(0, -2, 0); sh.add(tgt); spot.target = tgt; spot.castShadow = true; spot.shadow.mapSize.set(512, 512); spot.shadow.bias = -0.0005; spot.shadow.camera.near = 0.1;   // (its shadow map 1024 -> 512, the page's memory)
  g.traverse(m => { if (m.isMesh) m.castShadow = true; }); inner.castShadow = false;   // (the light's own parts are not in its way: a disc at the mouth once shadowed all the spot threw)
  g.userData.light = spot; g.userData.pt = pt; g.userData.glow = glow; g.userData.inner = inner; return g;
}
function candleJar() {
  const g = new THREE.Group();
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .09, 24, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .1, transparent: true, opacity: .35, side: 2 })); jar.position.y = .045; g.add(jar);
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(.036, .036, .04, 24), new THREE.MeshStandardMaterial({ color: 0xf2e8d2, roughness: .6, emissive: 0xffb060, emissiveIntensity: .25 })); wax.position.y = .02; g.add(wax);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(.007, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a })); flame.scale.y = 2; flame.position.y = .052; g.add(flame); g.userData.flame = flame;
  return g;
}
/* A bare bulb on a cord from the ceiling (a downlight, with its socket and its cord down
   from the ceiling). The bulb is rebuilt from the measurements of "Incandescent Light Bulb" by AleixoAlonso
   (CC BY 4.0; 3D Assets/interior/light-bulb-incandescent.glb, an A-shape bulb 15.2 cm tall, its glass 9.2 cm across).
   Measured in its own frame, from the tip of its base up:
   - its glass, the model's profile turned;
   - its screw base, the thread's last ridges showing under the socket, and the black insulator at its tip;
   - the flattened glass stem; the two lead-in wires and the two supports; the coiled filament across their tops.
   It hangs base up in a brass socket (a shell over the thread, a collar, a domed cap, a cord grip), on a cloth cord
   from a brass cup on the ceiling. Its light is a spot straight down (a downlight); by night the filament glows, and
   the glass a little with it. drop: from the ceiling to the middle of the socket and bulb (m).                        */
function pendantLamp(drop) {
  const g = new THREE.Group(), lathe = (pts, mat, seg = 32) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);
  const tipY = -drop + 0.047, gripY = tipY + 0.058, cord = -gripY - 0.032;   // (the bulb's frame: the base's tip at tipY, its glass 0.152 below)
  // the ceiling cup and the cord
  g.add(lathe([[.004, -.032], [.010, -.031], [.030, -.027], [.045, -.018], [.052, -.008], [.055, 0]], MAT.brass, 40));
  const cloth = new THREE.Mesh(new THREE.CylinderGeometry(.0035, .0035, cord, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: .85 }));
  cloth.position.y = -.032 - cord / 2; g.add(cloth);
  // the bulb, in its own frame (y up from the tip of the base), turned base up
  // (the bulb and its socket 20 % larger than the model's, then 10 % more, twice; then 1.5 times; hung from the same cord grip)
  const BS = 2.178, tipB = gripY - 0.058 * BS, b = new THREE.Group(); b.rotation.x = Math.PI; b.scale.setScalar(BS); b.position.y = tipB; g.add(b);
  // (the insulator at the base's tip, inside the socket where no view sees it, left out)
  b.add(lathe([[.0086, .0037], [.0187, .0095], [.0200, .024], [.0207, .0255], [.0189, .0272], [.0207, .0289], [.0198, .0301], [.0191, .031], [.0184, .0326], [.0176, .0332]],
    new THREE.MeshStandardMaterial({ color: 0xc9c9c4, metalness: 1, roughness: .3 }), 32));   // the screw base
  // its glass: clear, lit by the room, more of it seen toward its edges (as glass is: Fresnel), a little warm from inside
  // when on; it keeps its depth, so the night sky (drawn after the paint, where the room left no depth) stays behind it
  const glass = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: .05, metalness: 0, transparent: true, opacity: .04, envMapIntensity: 1.6, emissive: 0xffd2a0, emissiveIntensity: 0 });
  glass.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
    gl_FragColor.a = clamp(gl_FragColor.a + 0.45 * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5), 0.0, 0.7);`); };
  const env = [[.0176, .0315], [.0205, .0365], [.0227, .040], [.0236, .0432], [.0240, .0466], [.0248, .0533], [.0279, .0633], [.0325, .070], [.0382, .080], [.0424, .090],
    [.0450, .0968], [.0459, .1069], [.0450, .1136], [.0424, .1236], [.0382, .1303], [.0325, .137], [.0255, .1437], [.0176, .1471], [.0090, .1504], [.0001, .1521]];
  // (its far side first, as the profile turned the other way, so its faces look inward and it shares the near side's
  // shader; the stem between them)
  const back = lathe([...env].reverse(), glass, 40), front = lathe(env, glass, 40); back.renderOrder = 1; front.renderOrder = 3; b.add(back, front);
  const stemShape = new THREE.Shape(), sp = [[.0084, .030], [.0085, .048], [.0062, .0525], [.0069, .057], [.0079, .0615], [.0068, .066], [.0026, .0705], [.0021, .075], [.0021, .0795], [.0048, .084]];
  stemShape.moveTo(-sp[0][0], sp[0][1]); for (const [x, y] of sp) stemShape.lineTo(x, y); for (let i = sp.length - 1; i >= 0; i--) stemShape.lineTo(-sp[i][0], sp[i][1]);
  const stemG = new THREE.ExtrudeGeometry(stemShape, { depth: .0038, bevelEnabled: false }); stemG.translate(0, 0, -.0019);
  const stem = new THREE.Mesh(stemG, new THREE.MeshStandardMaterial({ color: 0xf4f6f2, roughness: .1, transparent: true, opacity: .32, depthWrite: false })); stem.renderOrder = 2; b.add(stem);
  // the wires: lead-ins from the stem to the filament's ends, supports from its top up over it and hooked down onto it
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z), rod = (a, c, r) => { const d = c.clone().sub(a), m = new THREE.CylinderGeometry(r, r, d.length(), 5, 1, true);
    m.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); m.translate((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2); return m; };
  const wires = [];
  for (const s of [-1, 1]) {
    wires.push(rod(V(s * .005, .034), V(s * .005, .0373), .0004), rod(V(s * .005, .0373), V(s * .0148, .1007), .0004));
    wires.push(rod(V(s * .0011, .0687), V(s * .0087, .1063), .00032), rod(V(s * .0087, .1063), V(s * .0087, .1013), .00032));
  }
  b.add(new THREE.Mesh(mergeGeometries(wires), new THREE.MeshStandardMaterial({ color: 0x5a5a58, metalness: .7, roughness: .35 })));
  const turns = 18, hp = []; for (let i = 0; i <= turns * 10; i++) { const t = i / (turns * 10), a = t * turns * 2 * Math.PI; hp.push(V(-.016 + .032 * t, .1008 + .0011 * Math.cos(a), -.0002 + .0011 * Math.sin(a))); }
  const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp), turns * 16, .00028, 4), new THREE.MeshStandardMaterial({ color: 0x6a6a66, metalness: .6, roughness: .4, emissive: 0xffcf90, emissiveIntensity: 0 }));
  b.add(coil);
  // the socket over the base, base up: cord grip, domed cap, collar, shell, lip, and in under the lip
  b.add(lathe([[.0036, -.058], [.0062, -.0575], [.0062, -.044], [.012, -.043], [.0175, -.040], [.0215, -.0355], [.024, -.029], [.0248, -.024], [.0258, -.0235], [.0258, -.0195], [.0247, -.019],
    [.0247, -.002], [.0241, -.001], [.0247, 0], [.0247, .0225], [.0253, .0235], [.0253, .025], [.0213, .0252], [.0211, .02]], MAT.brass, 40));
  // its light: a spot straight down, from just under the glass (from the filament it would light the glass itself, 5 cm
  // away, white), and a glow round the bulb
  const spotY = tipB - .162 * BS, light = new THREE.SpotLight(0xffc98f, 0, 9, 0.85, 0.8, 2); light.position.y = spotY; light.target.position.y = spotY - 2.5; light.visible = false; g.add(light, light.target);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: pendantGlowTex(), color: 0xffc98f, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(.26 * BS); glow.position.y = tipB - .105 * BS; glow.renderOrder = 4; g.add(glow);
  const at = new THREE.Vector3(), toCam = new THREE.Vector3();   // (drawn 7 cm toward the eye, in front of the glass that hides what is behind it)
  glow.onBeforeRender = (r, s, cam) => { g.localToWorld(at.set(0, tipB - .105 * BS, 0)); toCam.setFromMatrixPosition(cam.matrixWorld).sub(at).normalize(); glow.matrixWorld.setPosition(at.addScaledVector(toCam, .07 * BS / 1.452)); };   // (in front of the glass whatever its size: inside it, the glass hid it)
  // the lit filament, over the glow and brighter than it (its colour past white: the brightest thing in the bulb), as the glow is placed
  const fil = new THREE.Sprite(new THREE.SpriteMaterial({ map: filamentTex(), color: new THREE.Color(0xffe2b8).multiplyScalar(5), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  fil.scale.setScalar(.26 * BS); fil.position.y = tipB - .105 * BS; fil.renderOrder = 5; g.add(fil);
  fil.onBeforeRender = (r, s, cam) => { g.localToWorld(at.set(0, tipB - .105 * BS, 0)); toCam.setFromMatrixPosition(cam.matrixWorld).sub(at).normalize(); fil.matrixWorld.setPosition(at.addScaledVector(toCam, .071 * BS / 1.452)); };
  g.userData.light = light; g.userData.glow = glow; g.userData.fil = fil; g.userData.bulb = b; g.userData.coil = coil; g.userData.glass = glass;
  return g;
}

export { PLANT, candleJar, floorLamp, pendantLamp, plant, plantTouch, planter, stepPlant, stumpTable, tableLamp };
