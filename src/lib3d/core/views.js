import '../fx/post.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { REF, reduceMotion } from './base.js';
import { RT_SCALE, camera, renderer } from './renderer.js';
import { POST, bakePaper } from '../fx/post.js';
import { placeMoon } from '../fx/sky.js';
import { setNeeds } from './loop.js';

/* ---------------------------------------------------------------- views
   The camera moves between views: home (the painting's framing, cropped like a cover background; it holds still
   under the pointer), one view per shelf section (the section on the right of the screen, its card on the left) and
   an overview of the research bookcase. A view is { pos, tgt, fov, shift }; shift slides the image sideways (lens
   shift).                                                                                                       */
const STATE = { paint: true, frame: false };
const V3 = THREE.Vector3;
const CAM = { cur: null, from: null, to: null, k: 1, dur: 1.3 };
/* the view moved up or down (G, 19/10/2026: "add vertical scroll bar để xem được hết khung cảnh": the home view is cropped
   as a cover is, top and bottom on a wide window): the lens shifted as an architect's camera's is, the walls kept upright,
   from LIFT.min (higher: the beams) to LIFT.max (lower: the floor, the pouf), in heights of the window. The scroll bar on
   the right (ui/overlay.js buildLift), the wheel or a trackpad, the arrow keys (ui/picking.js). A new view starts level. */
const LIFT = { cur: 0, to: 0, min: -0.3, max: 0.45 };
function setLift(v) { const t = Math.min(LIFT.max, Math.max(LIFT.min, v)); if (t !== LIFT.to) { LIFT.to = t; setNeeds(true); } }
function homeView() {
  const s = Math.max(innerWidth / REF.w, innerHeight / REF.h), ch = innerHeight / s;
  const dir = new V3((REF.w / 2 - REF.px) / REF.f, -(REF.h / 2 - REF.py) / REF.f, -1);
  return { pos: REF.eye.clone(), tgt: REF.eye.clone().add(dir), fov: 2 * Math.atan(ch / 2 / REF.f) * 180 / Math.PI, shift: 0 };
}
function lerpView(a, b, k) {
  return { pos: a.pos.clone().lerp(b.pos, k), tgt: a.tgt.clone().lerp(b.tgt, k), fov: a.fov + (b.fov - a.fov) * k, shift: a.shift + (b.shift - a.shift) * k };
}
function applyView(v) {
  const W = innerWidth, H = innerHeight;
  camera.position.copy(v.pos);
  camera.fov = v.fov; camera.aspect = W / H; camera.up.set(0, 1, 0); camera.lookAt(v.tgt);
  // the lens shift in whole pixels of the room's picture: a shift is the image slid, and slid by part of a pixel each step
  // the books' thin edges fell on pixels and off them by turns, flickering as the view rolled up and down (G, 24/10/2026)
  const px = W * RT_SCALE / Math.max(1, Math.round(W * RT_SCALE)) / RT_SCALE, sx = Math.round(-v.shift * W / px) * px, sy = Math.round(LIFT.cur * H / px) * px;
  if (Math.abs(sx) > 1e-4 || Math.abs(sy) > 1e-4) camera.setViewOffset(W, H, sx, sy, W, H); else camera.clearViewOffset();
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
function goView(v, dur = 1.3) {
  CAM.from = CAM.cur; CAM.to = v; CAM.k = 0; CAM.dur = reduceMotion ? 0.001 : dur; LIFT.to = 0; setNeeds(true);
}
function stepCam(dt) {
  let moving = false;
  if (CAM.k < 1) { CAM.k = Math.min(1, CAM.k + dt / CAM.dur); const k = CAM.k, e = k * k * k * (k * (k * 6 - 15) + 10); CAM.cur = lerpView(CAM.from, CAM.to, e); moving = true; }
  if (LIFT.cur !== LIFT.to) { const d = LIFT.to - LIFT.cur; LIFT.cur = Math.abs(d) < 5e-4 ? LIFT.to : LIFT.cur + d * Math.min(1, dt / 0.12); moving = true; }   // (eased: ~0.12 s)
  if (moving) applyView(CAM.cur);
  return moving;
}
function applyRefCamera() { CAM.cur = homeView(); CAM.k = 1; applyView(CAM.cur); }
function resize() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.setSize(innerWidth, innerHeight, false);   // device pixels (the sharp layer; 1.5 at most: G, 22/10/2026, at 2 the canvas's buffers cost ~90 MB more, for words a little sharper)
  const rw = Math.max(1, Math.round(w * RT_SCALE)), rh = Math.max(1, Math.round(h * RT_SCALE));
  POST.rt.setSize(rw, rh); POST.tone.setSize(rw, rh); POST.toneQuad.material.uniforms.px.value.set(1 / rw, 1 / rh);                                                              // the scene, at 80 %
  const ow = Math.max(1, Math.round(w * 0.75)), oh = Math.max(1, Math.round(h * 0.75));   // the watercolour, at 0.75 of CSS px (G, 22/10/2026: its strokes soft already)
  POST.out.setSize(ow, oh); POST.mat.uniforms.res.value.set(ow, oh); bakePaper(w, h, ow, oh);
  placeMoon();
}

export { CAM, LIFT, V3, applyRefCamera, applyView, goView, homeView, resize, setLift, stepCam };
