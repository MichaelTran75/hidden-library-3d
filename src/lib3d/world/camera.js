import './gardenbook.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { canvas, ctex } from '../core/utils.js';
import { camera, renderer, scene } from '../core/renderer.js';
import { room } from './room.js';
import { DECOR } from './decor/kit.js';
import { POST, QUAD_VS } from '../fx/post.js';
import { SHARP, crispPass, sharpQuad } from './pets.js';
import { DECKR } from '../ui/deck.js';
import { setNeeds } from '../core/loop.js';

/* ---------------------------------------------------------------- the vintage camera on the tall shelf
   "Vintage Camera ~ Asahi Pentax H2" by Robin Vandenberghe (Sketchfab, CC BY 4.0; tools/camera/make.mjs), in its
   leather case, where the mantel clock stood (decor/build.js gives that cell up: DECOR.camera; G, 19/10/2026: "em cho
   vintage camera vào với 10% water color"). Its body 0.24 m wide, 1.7 times the H2's 143 mm, so it reads from across
   the room as the clock there did (G: "to ra 20%"). Upright as the file has it (y up); its lens, found from its parts
   (Lence_LP from Body_LP), toward the room, turned a little to show its side. Its strap is left out: the model has it
   hanging straight down, as from a hook, and on a shelf it went through the board; the rings it hung from stay, the
   pins and buckles at its ends go with it.
   Drawn sharp over the painted room on a layer of its own, with a tenth of the room's watercolour (its pass's paint),
   as the clock is drawn (G, 19/10/2026: "cho chuột hover vào máy ảnh to show white border line; click vào thì show 3D
   structures"): under the pointer it is outlined; a click brings it out of the shelf, three times its size, the room
   dimmed, tipped a little to show its top, and it comes apart, each part named (the Asahi Pentax H2 of 1959, from its
   makers' specifications: one shutter speed dial on top, 1 s to 1/500 s; a rapid wind lever with the frame counter; the
   release on top; no self-timer; the M42 screw mount; a cloth focal-plane shutter, an instant-return mirror and a
   pentaprism finder). Dragged, it turns; a click on it puts it together or apart; Esc, the × or a click beside it puts
   it back. The part placed from its measured pieces: the lens in front, the eyepiece at the back, the rewind knob on the
   viewer's right (the user's left), the wind lever, the speed dial and the release on the other side. */
const VCAM = { ok: false, layer: 8, bodyW: 0.24, turn: 0.42, big: 3, tilt: 0.32, group: null, hover: false, out: 0, home: null, local: null, box: null,
  parts: {}, span: null, key: null, fill: null, view: { on: false, k: 0, e: 0, eT: 0, yaw: 0, sway: 0, ph: 0, held: 0, drag: null, el: null, labels: null, rects: null },
  P: { rt: null, quad: null, paint: 0.1, wash: 0, layer: 8, toneK: 1, pad: 12, outline: true },   // on its shelf (a tenth of the watercolour; its outline)
  PI: { rt: null, quad: null, paint: 0, wash: 0, layer: 8, toneK: 1, pad: 6, dpr: 1.25 } };     // out, in front of the room (large on the screen: 1.25 px a CSS px)
const VCU = { uRoomDepth: { value: 1 } };   // 1: hidden where the room is nearer (on its shelf); 0: out in front of it
// its parts apart: the model's pieces, the way they go (its own frame: x to the right of one facing it, y up, z toward
// one facing it; metres at its size on the shelf) and their names
const VC_PARTS = {
  lens: { nodes: ['Lence_LP', 'LensInside_LP', 'Iris_LP'], to: [0, 0, 0.13], name: ['Lens, on the M42 screw mount', 'Ống kính, ngàm ren M42'] },
  eye: { nodes: ['ViewPort_LP'], to: [0, 0.03, -0.11], name: ['Eyepiece of the pentaprism finder', 'Thị kính của lăng kính ngắm'] },
  rewind: { nodes: ['Knop4_LP', 'Knop4_Onder_LP'], to: [0.03, 0.09, 0], name: ['Rewind knob', 'Núm tua phim'] },
  lever: { nodes: ['Knop1_LP', 'Knop1_Onder_LP'], to: [-0.05, 0.07, -0.01], name: ['Rapid wind lever, frame counter', 'Cần lên phim, bộ đếm khung'] },
  dial: { nodes: ['Knop3_LP', 'Knop3_Onder_LP'], to: [-0.01, 0.12, -0.02], name: ['Shutter speed dial, 1 s – 1/500 s', 'Núm tốc độ màn trập, 1 s – 1/500 s'] },
  release: { nodes: ['Knop2_LP'], to: [0.01, 0.16, 0.03], name: ['Shutter release', 'Nút chụp'] },
  case: { nodes: ['Bag_LP', 'Haakjes_LP', 'Rings_LP'], to: [0, -0.12, 0], name: ['Leather ever-ready case', 'Bao da'] },
  body: { nodes: ['Body_LP', 'Knop5_LP'], to: [0, 0, 0], name: ['Body: cloth focal-plane shutter, mirror, pentaprism', 'Thân máy: màn trập vải, gương lật, lăng kính'] },
};
async function cameraBytes() {   // inline (base64) in the one-file build, a file next to the page on GitHub Pages
  const el = document.getElementById('camera-glb'); if (!el) return null;
  if (el.dataset.src) { const r = await fetch(el.dataset.src); if (!r.ok) throw new Error('camera ' + r.status); return r.arrayBuffer(); }
  if (el.textContent.trim().length > 100) return (await fetch('data:application/octet-stream;base64,' + el.textContent.trim())).arrayBuffer();
  return null;
}
function vcPatch(sh) {   // (hidden where the room is nearer, as the clock: on its shelf only)
  sh.uniforms.uDepth = DECKR.u.uDepth; sh.uniforms.uFull = DECKR.u.uFull; sh.uniforms.uOff = DECKR.u.uOff; sh.uniforms.uRoomDepth = VCU.uRoomDepth;
  sh.fragmentShader = 'uniform sampler2D uDepth; uniform vec2 uFull, uOff; uniform float uRoomDepth;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (uRoomDepth > 0.5 && gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;');
}
const _vcv = new THREE.Vector3();
function boxIn(objs, inv) {   // pieces' box in a frame (inv: that frame's inverse world matrix)
  const B = new THREE.Box3(), M = new THREE.Matrix4();
  for (const o of objs) o.traverse(m => { if (!m.isMesh) return; m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; M.multiplyMatrices(inv, m.matrixWorld);
    for (let i = 0; i < 8; i++) B.expandByPoint(_vcv.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(M)); });
  return B;
}
async function buildCamera() {
  const spot = DECOR.camera; if (!spot) return;
  const buf = await cameraBytes(); if (!buf) return;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '');
  const model = gltf.scene; model.updateMatrixWorld(true);
  for (const n of ['Ribbon_LP', 'Pins_LP', 'IronPieces_LP']) { const o = model.getObjectByName(n); if (o) o.parent.remove(o); }   // (the strap and the metal at its ends)
  const centre = name => { const o = model.getObjectByName(name); return o ? new THREE.Box3().setFromObject(o, true).getCenter(new THREE.Vector3()) : null; };
  const body = centre('Body_LP'), lens = centre('Lence_LP');
  // turned about the vertical so its lens looks along +z (the cell's way into the room)
  const f = lens.clone().sub(body); f.y = 0; f.normalize();
  const inner = new THREE.Group(); inner.add(model); inner.rotation.y = -Math.atan2(-f.x, f.z); inner.updateMatrixWorld(true);
  const bodyBox = new THREE.Box3().setFromObject(model.getObjectByName('Body_LP'), true), s = VCAM.bodyW / (bodyBox.max.x - bodyBox.min.x);
  inner.scale.setScalar(s); inner.updateMatrixWorld(true);
  const all = new THREE.Box3().setFromObject(inner, true), c = all.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -all.min.y, -c.z);   // (its foot on the board, its middle over the cell's)
  const g = new THREE.Group(); g.add(inner); g.position.copy(spot.at); g.rotation.y = spot.yaw + VCAM.turn;
  g.traverse(o => { if (!o.isMesh) return; o.layers.set(VCAM.layer); o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false;
    o.material = [].concat(o.material).map(m => { m = m.clone(); m.fog = false; if (m.transparent) m.depthWrite = false; m.onBeforeCompile = vcPatch; m.customProgramCacheKey = () => 'vcam-crisp'; return m; });
    if (o.material.length === 1) o.material = o.material[0]; });
  scene.add(g); g.updateMatrixWorld(true);
  VCAM.group = g; VCAM.home = { pos: g.position.clone(), yaw: g.rotation.y };
  const inv = g.matrixWorld.clone().invert(); VCAM.local = boxIn([g], inv); VCAM.size = VCAM.local.getSize(new THREE.Vector3()).toArray();
  // its parts: their boxes (its frame), and how far each piece moves apart in its own parent's frame
  for (const [k, P] of Object.entries(VC_PARTS)) {
    const objs = P.nodes.map(n => model.getObjectByName(n)).filter(Boolean); if (!objs.length) continue;
    const to = new THREE.Vector3().fromArray(P.to), pieces = objs.map(o => { const m3 = new THREE.Matrix3().setFromMatrix4(o.parent.matrixWorld.clone().invert().multiply(g.matrixWorld)); return { o, base: o.position.clone(), d: to.clone().applyMatrix3(m3) }; });
    VCAM.parts[k] = { box: boxIn(objs, inv), to, pieces };
  }
  VCAM.span = [0, 1].map(e => { const b = new THREE.Box3(), pb = new THREE.Box3(); for (const k in VCAM.parts) { const p = VCAM.parts[k]; b.union(pb.copy(p.box).translate(_vcv.copy(p.to).multiplyScalar(e))); } return b; });
  const wb = new THREE.Box3().setFromObject(g, true), wc = wb.getCenter(new THREE.Vector3());
  VCAM.box = [wc.x, wb.min.y - 0.01, wc.z, (wb.max.x - wb.min.x) / 2 + 0.03, wb.max.y - wb.min.y + 0.04, (wb.max.z - wb.min.z) / 2 + 0.03];
  {   // its shadow on the board: a soft patch under it (its layer is not in the room's shadows)
    const c2 = canvas(128, 128), gc = c2.getContext('2d'), gr = gc.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(18,11,5,.5)'); gr.addColorStop(0.65, 'rgba(18,11,5,.2)'); gr.addColorStop(1, 'rgba(18,11,5,0)'); gc.fillStyle = gr; gc.fillRect(0, 0, 128, 128);
    const L = VCAM.local, m = new THREE.Mesh(new THREE.PlaneGeometry((L.max.x - L.min.x) * 1.15, (L.max.z - L.min.z) * 1.3), new THREE.MeshBasicMaterial({ map: ctex(c2, { rep: false }), transparent: true, depthWrite: false, fog: false }));
    m.rotation.set(-Math.PI / 2, 0, g.rotation.y, 'YXZ'); m.position.copy(spot.at); m.position.y += 0.001; m.renderOrder = 1; room.add(m);
  }
  scene.traverse(o => { if (o.isLight) o.layers.enable(VCAM.layer); });   // (the room's lights light it on its layer)
  VCAM.key = new THREE.DirectionalLight(0xfff4e6, 0); VCAM.key.layers.set(VCAM.layer); scene.add(VCAM.key, VCAM.key.target);   // (its own lights when out: dark until then)
  VCAM.fill = new THREE.DirectionalLight(0xdfe8ff, 0); VCAM.fill.layers.set(VCAM.layer); scene.add(VCAM.fill, VCAM.fill.target);
  sharpQuad(VCAM.P); sharpQuad(VCAM.PI);
  if (renderer.compileAsync) { SHARP.cam.layers.set(VCAM.layer); renderer.setRenderTarget(POST.rt); try { await renderer.compileAsync(g, SHARP.cam, scene); } catch (e) { /* compiled on first use */ } renderer.setRenderTarget(null); }
  buildCamUI(); VCAM.ok = true; setNeeds(true);
}

// ---- on its shelf, and out of it
const vcEase = k => k * k * (3 - 2 * k), vcLerp = (a, b, k) => a + (b - a) * k;
const VCV = { q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), f: new THREE.Vector3(), r: new THREE.Vector3(), c: new THREE.Vector3(), w: new THREE.Vector3(), box: new THREE.Box3(), dim: null, side: 0 };
function vcPlace() {   // its parts apart (as far as they are), and where it is: on its shelf, out in front of the camera, or between
  const V = VCAM.view, H = VCAM.group, k = vcEase(V.k), e = vcEase(V.e);
  for (const k2 in VCAM.parts) for (const p of VCAM.parts[k2].pieces) p.o.position.copy(p.base).addScaledVector(p.d, e);
  if (k <= 0) { H.position.copy(VCAM.home.pos); H.rotation.set(0, VCAM.home.yaw, 0); H.scale.setScalar(1); H.updateMatrixWorld(true); return; }
  const cam = camera, f = cam.getWorldDirection(VCV.f), s = VCAM.big;
  const B = VCV.box.copy(VCAM.span[0]); B.min.lerp(VCAM.span[1].min, e); B.max.lerp(VCAM.span[1].max, e);   // (its extent as it stands, together or apart)
  const hgt = (B.max.y - B.min.y) * s, wid = Math.max(B.max.x - B.min.x, B.max.z - B.min.z) * s;
  const th = Math.tan(cam.fov * Math.PI / 360), side = VCV.side = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 0;
  const free = Math.max(0.4, 1 - side / innerWidth), d = Math.max(hgt / (2 * th * 0.8), wid / (2 * th * cam.aspect * free * 0.9)) + wid * 0.15;
  const right = VCV.r.set(-f.z, 0, f.x).normalize(), shift = side / 2 / (innerWidth / 2) * d * th * cam.aspect;
  const centre = VCV.c.copy(cam.position).addScaledVector(f, d).addScaledVector(right, shift);
  // its lens toward the camera, turned a little to show its side, tipped to show its top; its own turn
  let yaw = Math.atan2(-f.x, -f.z) + 0.5 + V.yaw + V.sway, y0 = VCAM.home.yaw; while (yaw - y0 > Math.PI) yaw -= Math.PI * 2; while (yaw - y0 < -Math.PI) yaw += Math.PI * 2;
  H.rotation.set(vcLerp(0, VCAM.tilt, k), vcLerp(y0, yaw, k), 0, 'YXZ'); H.scale.setScalar(vcLerp(1, s, k));
  const mid = B.getCenter(VCV.w).multiplyScalar(H.scale.x).applyQuaternion(VCV.q.setFromEuler(VCV.e.copy(H.rotation)));
  H.position.copy(VCAM.home.pos).lerp(centre.sub(mid), k); H.updateMatrixWorld(true);
  const kl = VCAM.key, fl = VCAM.fill; kl.intensity = 2.6 * k; fl.intensity = 1.1 * k;   // (its light: from above the viewer's left)
  kl.position.copy(H.position).addScaledVector(right, -3).add(VCV.w.set(0, 4, 0)).addScaledVector(f, -4); kl.target.position.copy(H.position); kl.target.updateMatrixWorld();
  fl.position.copy(H.position).addScaledVector(right, 4).add(VCV.w.set(0, 1, 0)).addScaledVector(f, -2); fl.target.position.copy(H.position); fl.target.updateMatrixWorld();
}
function drawCamera() {   // on its shelf: over the picture, sharp (out of it: drawCamInspect)
  if (!VCAM.ok || VCAM.view.k > 0.001) return;
  vcPlace(); VCU.uRoomDepth.value = 1;
  const PU = POST.mat.uniforms, U = VCAM.P.quad.material.uniforms, pr = renderer.getPixelRatio();
  SHARP.u.uExp.value = PU.exposure.value; SHARP.u.uLift.value = PU.lift.value; SHARP.u.uVeil.value = PU.veil.value;
  U.uOut.value = VCAM.out; U.uOutW.value = 2 * pr; U.uHalo.value = 1.6 * pr; U.uFade.value = 1;
  crispPass(VCAM.P, VCAM.box);
}
function stepCamera(dt = 0.016) {   // the outline in and out, the flight out and back, coming apart: true while any of it moves
  if (!VCAM.ok) return false;
  const V = VCAM.view, was = VCAM.out + V.k * 3 + V.e * 7, to = VCAM.hover && !V.on ? 1 : 0;
  VCAM.out += Math.sign(to - VCAM.out) * Math.min(Math.abs(to - VCAM.out), dt / 0.14);
  V.k = Math.max(0, Math.min(1, V.k + (V.on ? 1 : -1) * dt / 0.85));
  const eT = V.on && V.k >= 1 ? V.eT : 0; V.e += Math.sign(eT - V.e) * Math.min(Math.abs(eT - V.e), dt / (eT > V.e ? 1.1 : 0.6));
  if (!V.on && V.e > 0) V.k = Math.max(V.k, 0.999);   // (put together before it flies back)
  if (V.on && V.k >= 1) V.held += dt;
  const amp = V.on && V.k >= 1 && !V.drag ? 0.32 * vcEase(Math.min(1, Math.max(0, (V.held - 4) / 3))) : 0;   // (left alone a while, it sways a little either way)
  if (amp > 0) V.ph += dt * Math.PI * 2 / 18; V.sway = amp * Math.sin(V.ph);
  return VCAM.out + V.k * 3 + V.e * 7 !== was || (V.on && V.k >= 1);
}
function openCamera() { const V = VCAM.view; if (V.on || !VCAM.ok) return; V.on = true; V.eT = 1; V.yaw = V.sway = V.ph = V.held = 0; VCAM.hover = false; document.body.classList.add('ck-out'); setNeeds(true); }
function closeCamera() { const V = VCAM.view; if (!V.on) return; V.on = false; document.body.classList.remove('ck-out'); setNeeds(true); }
VCAM.open = openCamera; VCAM.close = closeCamera;   // (tests)
function drawCamInspect() {   // out: the room dimmed, the camera over it (sharp, not hidden by the room), its parts' names
  if (!VCAM.ok) return;
  const V = VCAM.view;
  if (V.k <= 0.001) { if (V.el) V.el.classList.remove('is-on'); return; }
  vcPlace(); VCU.uRoomDepth.value = 0;
  if (!VCV.dim) VCV.dim = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { a: { value: 0 } }, vertexShader: QUAD_VS, fragmentShader: 'uniform float a; void main(){ gl_FragColor = vec4(0.03, 0.025, 0.02, a); }', transparent: true, depthTest: false, depthWrite: false }));
  VCV.dim.material.uniforms.a.value = 0.78 * vcEase(V.k); renderer.autoClear = false; VCV.dim.render(renderer); renderer.autoClear = true;
  const PU = POST.mat.uniforms; SHARP.u.uExp.value = Math.max(PU.exposure.value * 1.2, 0.95); SHARP.u.uLift.value = PU.lift.value; SHARP.u.uVeil.value = PU.veil.value;
  // its box in the world now (as it stands apart): what the pass covers
  const H = VCAM.group, e = vcEase(V.e), B = VCV.box.copy(VCAM.span[0]); B.min.lerp(VCAM.span[1].min, e); B.max.lerp(VCAM.span[1].max, e);
  const W = new THREE.Box3(); for (let i = 0; i < 8; i++) W.expandByPoint(_vcv.set(i & 1 ? B.max.x : B.min.x, i & 2 ? B.max.y : B.min.y, i & 4 ? B.max.z : B.min.z).applyMatrix4(H.matrixWorld));
  const wc = W.getCenter(new THREE.Vector3()), pad = 0.02 * H.scale.x;
  crispPass(VCAM.PI, [wc.x, W.min.y - pad, wc.z, (W.max.x - W.min.x) / 2 + pad, W.max.y - W.min.y + 2 * pad, (W.max.z - W.min.z) / 2 + pad]);
  SHARP.u.uExp.value = PU.exposure.value;
  vcLabels();
}

// ---- its parts' names: the clock's (clock.js) panel and labels
function buildCamUI() {
  const ui = document.getElementById('l3-ui') || document.body, el = document.createElement('div'); el.className = 'ck-out-ui';
  const named = Object.keys(VC_PARTS);
  el.innerHTML = '<div class="ck-head"><b>Asahi Pentax H2 <small>(1959)</small></b>'
    + '<small><span class="en">drag to turn · click it: apart / together · Esc to close</span><span class="vi">kéo để xoay · bấm vào: tách / ráp · Esc để đóng</span></small>'
    + '<button type="button" class="ck-x" aria-label="Close">&times;</button></div>'
    + '<svg class="ck-lines" aria-hidden="true">' + named.map(k => `<g data-k="${k}"><line></line><circle r="3"></circle></g>`).join('') + '</svg>'
    + named.map(k => `<span class="ck-name" data-k="${k}"><span class="en">${VC_PARTS[k].name[0]}</span><span class="vi">${VC_PARTS[k].name[1]}</span></span>`).join('');
  ui.appendChild(el); const V = VCAM.view; V.el = el; V.head = el.querySelector('.ck-head'); V.labels = [...el.querySelectorAll('.ck-name')];
  for (const lab of V.labels) { const g = el.querySelector(`.ck-lines g[data-k="${lab.dataset.k}"]`); lab._g = g; lab._l = g.firstChild; lab._d = g.lastChild; }
  el.querySelector('.ck-x').addEventListener('click', e => { e.stopPropagation(); closeCamera(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && VCAM.view.on) { e.stopImmediatePropagation(); closeCamera(); } }, true);
}
function vcRect(k) {   // a part's box on the screen (CSS pixels), where it is now
  const p = VCAM.parts[k], b = p.box, e = vcEase(VCAM.view.e), r = [1e9, 1e9, -1e9, -1e9], M = VCAM.group.matrixWorld;
  for (let i = 0; i < 8; i++) {
    const v = _vcv.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).addScaledVector(p.to, e).applyMatrix4(M).project(camera);
    const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight; r[0] = Math.min(r[0], x); r[1] = Math.min(r[1], y); r[2] = Math.max(r[2], x); r[3] = Math.max(r[3], y);
  }
  return r;
}
const vcOver = (x, y, w, h, r) => Math.max(0, Math.min(x + w, r[2]) - Math.max(x, r[0])) * Math.max(0, Math.min(y + h, r[3]) - Math.max(y, r[1]));
function vcLabels() {   // each name beside its part (above, right, below or left: whichever is clear of the others' names, the parts, the screen's edges), a fine line to it
  const V = VCAM.view; if (!V.el) return;
  V.el.classList.toggle('is-on', V.on && V.k >= 0.98);
  V.rects = {}; for (const k in VCAM.parts) V.rects[k] = vcRect(k);
  const show = V.e > 0.9 && V.on, free = [(VCV.side || 0) + 8, V.head ? V.head.offsetTop + V.head.offsetHeight + 8 : 70, innerWidth - 8, innerHeight - 8], placed = [];
  for (const lab of V.labels) {
    const k = lab.dataset.k, r = V.rects[k]; lab.classList.toggle('is-on', show); lab._g.classList.toggle('is-on', show); if (!show || !r) { lab._on = false; continue; }
    const w = lab.offsetWidth, h = lab.offsetHeight, cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, g = 8, A = w * h;
    const at = [[cx - w / 2, r[1] - g - h], [r[2] + g, cy - h / 2], [cx - w / 2, r[3] + g], [r[0] - g - w, cy - h / 2]];
    let best = 0, bs = Infinity;
    at.forEach(([x, y], i) => {
      let sc = i * 0.05 * A - (i === lab._c ? 0.25 * A : 0) + 6 * (A - vcOver(x, y, w, h, free));
      for (const q of placed) sc += 4 * vcOver(x, y, w, h, q);
      for (const o in V.rects) if (o !== k) sc += (o === 'body' ? 0.4 : 1) * vcOver(x, y, w, h, V.rects[o]);
      if (sc < bs) { bs = sc; best = i; }
    });
    lab._c = best;
    const x = Math.min(Math.max(at[best][0], free[0]), free[2] - w), y = Math.min(Math.max(at[best][1], free[1]), free[3] - h); placed.push([x, y, x + w, y + h]);
    if (!lab._on) { lab._x = x; lab._y = y; lab._on = true; } else { lab._x += (x - lab._x) * 0.3; lab._y += (y - lab._y) * 0.3; }   // (eased to a new place)
    lab.style.transform = `translate(${lab._x.toFixed(1)}px, ${lab._y.toFixed(1)}px)`;
    const px = cx, py = cy, qx = Math.min(Math.max(px, lab._x + h / 2), lab._x + w - h / 2), qy = Math.min(Math.max(py, lab._y), lab._y + h);   // (from the name's nearest edge to the part's middle)
    lab._l.setAttribute('x1', qx.toFixed(1)); lab._l.setAttribute('y1', qy.toFixed(1)); lab._l.setAttribute('x2', px.toFixed(1)); lab._l.setAttribute('y2', py.toFixed(1));
    lab._d.setAttribute('cx', px.toFixed(1)); lab._d.setAttribute('cy', py.toFixed(1));
  }
}
// the pointer while it is out: a drag turns it, a click on it puts it together or apart, beside it puts it back
function camPointer(type, e) {
  const V = VCAM.view; if (!V.on) return false;
  if (type === 'down') { V.yaw += V.sway; V.sway = V.ph = V.held = 0; V.drag = { x: e.clientX, y: e.clientY, yaw: V.yaw, moved: false }; }
  else if (type === 'move' && V.drag) { const dx = e.clientX - V.drag.x; if (Math.abs(dx) > 4) V.drag.moved = true; V.yaw = V.drag.yaw + dx * 0.008; V.held = 0; setNeeds(true); }
  else if (type === 'up') {
    const d = V.drag; V.drag = null;
    if (d && !d.moved && V.k >= 1) { const on = Object.values(V.rects || {}).some(r => r && e.clientX > r[0] - 12 && e.clientX < r[2] + 12 && e.clientY > r[1] - 12 && e.clientY < r[3] + 12); if (on) { V.eT = V.eT > 0.5 ? 0 : 1; setNeeds(true); } else closeCamera(); }
  }
  return true;
}
// the pointer's ray against it on its shelf (its box, in its own frame)
const VCR = { inv: new THREE.Matrix4(), ray: new THREE.Ray(), hitP: new THREE.Vector3() };
function camHit(ray) {
  if (!VCAM.ok || VCAM.view.k > 0) return false;
  VCR.inv.copy(VCAM.group.matrixWorld).invert(); VCR.ray.copy(ray).applyMatrix4(VCR.inv);
  return !!VCR.ray.intersectBox(VCAM.local, VCR.hitP);
}

export { VCAM, buildCamera, camHit, camPointer, closeCamera, drawCamInspect, drawCamera, openCamera, stepCamera };
