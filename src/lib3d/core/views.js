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
  if (Math.abs(v.shift) > 1e-4) camera.setViewOffset(W, H, -v.shift * W, 0, W, H); else camera.clearViewOffset();
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
function goView(v, dur = 1.3) {
  CAM.from = CAM.cur; CAM.to = v; CAM.k = 0; CAM.dur = reduceMotion ? 0.001 : dur; setNeeds(true);
}
function stepCam(dt) {
  let moving = false;
  if (CAM.k < 1) { CAM.k = Math.min(1, CAM.k + dt / CAM.dur); const k = CAM.k, e = k * k * k * (k * (k * 6 - 15) + 10); CAM.cur = lerpView(CAM.from, CAM.to, e); moving = true; }
  if (moving) applyView(CAM.cur);
  return moving;
}
function applyRefCamera() { CAM.cur = homeView(); CAM.k = 1; applyView(CAM.cur); }
function resize() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(innerWidth, innerHeight, false);   // device pixels (the sharp layer)
  const rw = Math.max(1, Math.round(w * RT_SCALE)), rh = Math.max(1, Math.round(h * RT_SCALE));
  POST.rt.setSize(rw, rh); POST.tone.setSize(rw, rh);                                                              // the scene, at 80 %
  POST.out.setSize(w, h); POST.mat.uniforms.res.value.set(w, h); bakePaper(w, h);                                  // the watercolour, at CSS px
  placeMoon();
}

export { CAM, V3, applyRefCamera, applyView, goView, homeView, resize, stepCam };
