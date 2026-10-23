import './camera.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { camera, renderer } from '../core/renderer.js';
import { POST, QUAD_VS } from '../fx/post.js';
import { SHARP, crispPass, sharpQuad } from './pets.js';
import { DECKR } from '../ui/deck.js';
import { PLANE } from './b747.js';
import { ISS } from './iss.js';
import { setNeeds } from '../core/loop.js';

/* ---------------------------------------------------------------- the 747 and the ISS out of their shelves
   (G, 22/10/2026: "khi click vào các model airplane, iss, showing rotate 3d model first, if click then open new tab")
   A click on either model no longer opens its page at once. It comes out of its shelf to the middle of the view, as the
   clock and the camera do (their panel and its look), three times larger, with the room dimmed behind it, and turns
   slowly on its own like a model on a turntable (a whole turn in 16 s). Dragged, it turns with the pointer and tips a
   little; let go, it goes on turning from there. A click on it opens its page in a new tab; Esc, the × or a click beside
   it puts it back on its shelf. Out in front of the room it is drawn whole: the room's depth hides nothing of it. */
const SHOWS = {
  plane: { obj: PLANE, big: 3, face: 0.55, name: ['Boeing 747-8 <small>(1:128)</small>', 'Boeing 747-8 <small>(1:128)</small>'] },
  iss: { obj: ISS, big: 2.4, face: 0.35, name: ['International Space Station', 'Trạm Vũ trụ Quốc tế'] },
};
const SHV = { dim: null, far: null, v: new THREE.Vector3(), w: new THREE.Vector3(), f: new THREE.Vector3(), r: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), box: new THREE.Box3() };
const shEase = k => k * k * (3 - 2 * k);
function showInit(S) {   // once, on its first time out: its box in its own frame, its pass, its panel (no lights of its own: a new light in the
  // scene would have every shader in the room compiled again, a second's stall; the room's lights and a brighter tone light it)
  const H = S.obj.holder, pos = H.position.clone(), q = H.quaternion.clone(), s = H.scale.clone();
  H.position.set(0, 0, 0); H.quaternion.identity(); H.scale.setScalar(1); H.updateMatrixWorld(true);
  S.local = new THREE.Box3().setFromObject(H, true);
  H.position.copy(pos); H.quaternion.copy(q); H.scale.copy(s); H.updateMatrixWorld(true);
  S.home = { pos, q, s }; S.view = { on: false, k: 0, yaw: 0, pitch: 0, spin: 0, drag: null, rect: null };
  S.PI = { rt: null, quad: null, paint: 0, wash: 0, layer: S.obj.layer, toneK: 1, pad: 6, dpr: 1 }; sharpQuad(S.PI);   // (large on the screen: 1 px a CSS px, G 22/10/2026)
  const ui = document.getElementById('l3-ui') || document.body, el = document.createElement('div'); el.className = 'ck-out-ui';
  el.innerHTML = `<div class="ck-head"><b><span class="en">${S.name[0]}</span><span class="vi">${S.name[1]}</span></b>`
    + '<small><span class="en">drag to turn · click it: open its page · Esc to close</span><span class="vi">kéo để xoay · bấm vào: mở trang · Esc để đóng</span></small>'
    + '<button type="button" class="ck-x" aria-label="Close">&times;</button></div>'
    + '<span class="ck-name sc-tip"><span class="en">Click to see details</span><span class="vi">Bấm để xem chi tiết</span></span>';   // (beside it: G, 22/10/2026)
  ui.appendChild(el); S.el = el; S.tip = el.querySelector('.sc-tip');
  el.querySelector('.ck-x').addEventListener('click', e => { e.stopPropagation(); closeShow(); });
  if (!SHV.far) {   // (a depth of 1 everywhere: nothing of it is hidden by the room while it is out)
    SHV.far = new THREE.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType); SHV.far.needsUpdate = true;
    addEventListener('keydown', e => { if (e.key === 'Escape' && showOn()) { e.stopImmediatePropagation(); closeShow(); } }, true);
  }
}
const showOn = () => Object.values(SHOWS).some(S => S.view && S.view.on);
function openShow(key) {
  const S = SHOWS[key]; if (!S || !S.obj.ok || showOn()) return;
  if (!S.view) showInit(S);
  const V = S.view; V.on = true; V.yaw = V.pitch = V.spin = 0; S.obj.hover = false; document.body.classList.add('ck-out'); setNeeds(true);
}
function closeShow() {
  for (const S of Object.values(SHOWS)) if (S.view && S.view.on) { S.view.on = false; S.view.drag = null; }
  document.body.classList.remove('ck-out'); setNeeds(true);
}
function placeShow(S) {   // on its shelf, out in front of the view (turning), or on its way between
  const V = S.view, H = S.obj.holder, k = shEase(V.k);
  if (k <= 0) { H.position.copy(S.home.pos); H.quaternion.copy(S.home.q); H.scale.copy(S.home.s); H.updateMatrixWorld(true); return; }
  const cam = camera, f = cam.getWorldDirection(SHV.f), size = S.local.getSize(SHV.v), s = S.big;
  const hgt = size.y * s, wid = Math.max(size.x, size.z) * s, th = Math.tan(cam.fov * Math.PI / 360);
  const side = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 0, free = Math.max(0.4, 1 - side / innerWidth);
  const d = Math.max(hgt / (2 * th * 0.62), wid / (2 * th * cam.aspect * free * 0.72)) + wid * 0.5;   // (room for it to turn: its widest way across)
  const right = SHV.r.set(-f.z, 0, f.x).normalize(), shift = side / 2 / (innerWidth / 2) * d * th * cam.aspect;
  const centre = SHV.c.copy(cam.position).addScaledVector(f, d).addScaledVector(right, shift).add(SHV.w.set(0, -0.04 * d * th, 0));
  // turned to show its side to the viewer, then the turntable's turn and the pointer's; tipped a little toward the viewer
  const yaw = Math.atan2(-f.x, -f.z) + S.face + V.yaw + V.spin;
  SHV.q.setFromEuler(SHV.e.set(0.22 + V.pitch, yaw, 0, 'YXZ'));
  H.quaternion.copy(S.home.q).slerp(SHV.q, k); H.scale.copy(S.home.s).lerp(SHV.w.setScalar(s), k);
  const mid = S.local.getCenter(SHV.v).multiply(H.scale).applyQuaternion(H.quaternion);
  H.position.copy(S.home.pos).lerp(centre.sub(mid), k); H.updateMatrixWorld(true);
}
function stepShows(dt = 0.016) {   // the flight out and back (0.85 s), the turntable: true while either moves
  let moving = false;
  for (const S of Object.values(SHOWS)) {
    if (!S.view) continue; const V = S.view, was = V.k;
    V.k = Math.max(0, Math.min(1, V.k + (V.on ? 1 : -1) * dt / 0.85));
    if (V.on && !V.drag) V.spin += dt * Math.PI * 2 / 16 * Math.min(1, V.k * 1.5);   // (it starts turning as it comes out)
    S.obj.away = V.k; if (S.obj.shadows) for (const m of S.obj.shadows) m.visible = V.k <= 0.001;   // (its shadow on the shelf goes with it)
    if (V.k !== was || V.on) moving = true;
    if (V.k <= 0 && was > 0) placeShow(S);   // (back on its shelf)
  }
  return moving;
}
function drawShows() {   // out: the room dimmed, the model over it, whole and sharp
  for (const S of Object.values(SHOWS)) {
    if (!S.view) continue; const V = S.view;
    if (S.el) S.el.classList.toggle('is-on', V.on && V.k >= 0.98);
    if (V.k <= 0.001) continue;
    placeShow(S);
    if (!SHV.dim) SHV.dim = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { a: { value: 0 } }, vertexShader: QUAD_VS, fragmentShader: 'uniform float a; void main(){ gl_FragColor = vec4(0.03, 0.025, 0.02, a); }', transparent: true, depthTest: false, depthWrite: false }));
    SHV.dim.material.uniforms.a.value = 0.78 * shEase(V.k); renderer.autoClear = false; SHV.dim.render(renderer); renderer.autoClear = true;
    const PU = POST.mat.uniforms; SHARP.u.uExp.value = Math.max(PU.exposure.value * 1.2, 0.95); SHARP.u.uLift.value = PU.lift.value; SHARP.u.uVeil.value = PU.veil.value;
    // its box in the world now: what the pass covers; and on the screen: what a click on it is
    const H = S.obj.holder, L = S.local, W = SHV.box.makeEmpty(), r = [1e9, 1e9, -1e9, -1e9];
    for (let i = 0; i < 8; i++) {
      const p = SHV.v.set(i & 1 ? L.max.x : L.min.x, i & 2 ? L.max.y : L.min.y, i & 4 ? L.max.z : L.min.z).applyMatrix4(H.matrixWorld); W.expandByPoint(p);
      p.project(camera); const x = (p.x + 1) / 2 * innerWidth, y = (1 - p.y) / 2 * innerHeight; r[0] = Math.min(r[0], x); r[1] = Math.min(r[1], y); r[2] = Math.max(r[2], x); r[3] = Math.max(r[3], y);
    }
    V.rect = r;
    if (S.tip) {   // the hint beside it: right of its middle by most of its size on the screen (its box's corners spread wider than it as it turns), at its middle's height
      const on = V.on && V.k >= 0.98, w = S.tip.offsetWidth, h = S.tip.offsetHeight, cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, rw = (r[2] - r[0]) / 2 * 0.62;
      const x = cx + rw + 14 + w < innerWidth - 12 ? cx + rw + 14 : Math.max(12, cx - rw - 14 - w), y = Math.min(Math.max(cy - h / 2, 70), innerHeight - h - 12);
      S.tip.classList.toggle('is-on', on); if (on) S.tip.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    const wc = W.getCenter(SHV.w), pad = 0.02 * H.scale.x, depth = DECKR.u.uDepth.value; DECKR.u.uDepth.value = SHV.far;
    crispPass(S.PI, [wc.x, W.min.y - pad, wc.z, (W.max.x - W.min.x) / 2 + pad, W.max.y - W.min.y + 2 * pad, (W.max.z - W.min.z) / 2 + pad]);
    DECKR.u.uDepth.value = depth; SHARP.u.uExp.value = PU.exposure.value;
  }
}
// the pointer while one is out: a drag turns it (and tips it), a click on it opens its page, beside it puts it back
function showPointer(type, e) {
  const S = Object.values(SHOWS).find(s => s.view && s.view.on); if (!S) return false;
  const V = S.view;
  if (type === 'down') V.drag = { x: e.clientX, y: e.clientY, yaw: V.yaw + V.spin, pitch: V.pitch, moved: false };
  else if (type === 'move' && V.drag) {
    const dx = e.clientX - V.drag.x, dy = e.clientY - V.drag.y; if (Math.hypot(dx, dy) > 4) V.drag.moved = true;
    V.spin = 0; V.yaw = V.drag.yaw + dx * 0.009; V.pitch = Math.max(-0.45, Math.min(0.55, V.drag.pitch + dy * 0.005)); setNeeds(true);
  } else if (type === 'up') {
    const d = V.drag; V.drag = null;
    if (d && !d.moved && V.k >= 1) {
      const r = V.rect, on = r && e.clientX > r[0] - 10 && e.clientX < r[2] + 10 && e.clientY > r[1] - 10 && e.clientY < r[3] + 10;
      if (on) window.open(S.obj.url, '_blank', 'noopener'); else closeShow();
    }
  }
  return true;
}
const showDragging = () => Object.values(SHOWS).some(S => S.view && S.view.on && S.view.drag && S.view.drag.moved);
PLANE.open = () => openShow('plane'); ISS.open = () => openShow('iss');   // (tests)

export { SHOWS, closeShow, drawShows, openShow, showDragging, showOn, showPointer, stepShows };
