import './iss.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { renderer, scene } from '../core/renderer.js';
import { LIGHTS } from './lights.js';
import { POST } from '../fx/post.js';
import { SHARP, crispPass, crispPatch, sharpQuad } from './pets.js';
import { setNeeds } from '../core/loop.js';

/* ---------------------------------------------------------------- the 3D garden's book on the pouf
   The book on top of the pair on the pouf wears a picture of the 3D garden (its camper van under its awning) as its
   cover; the pointer on it outlines it, a click opens the garden in a new tab (G, 18/10/2026: "em thay bìa sách thành
   ảnh screenshot, then add white border khi hover over, when click then open new tab https://michaeltran75.github.io/
   3d-garden/"). Drawn sharp over the painted room, as the 747 is, on a layer of its own (its outline needs one). */
const GBOOK = { ok: false, layer: 7, url: 'https://michaeltran75.github.io/3d-garden/', hover: false, out: 0, book: null, box: null, hit: null,
  P: { rt: null, quad: null, paint: 0, wash: 0.25, layer: 7, toneK: 1, outline: true, pad: 12 } };
async function gardenCover() {   // the picture: inline in the one-file page, a file next to it on Pages
  const el = document.getElementById('garden-cover'); if (!el) return null;
  const src = el.dataset.src || ('data:image/webp;base64,' + el.textContent.trim());
  const im = new Image(); im.src = src; await im.decode(); return im;
}
async function buildGardenBook() {
  const bk = LIGHTS.gardenBook; if (!bk) return;
  const im = await gardenCover(); if (!im) return;
  bk.updateMatrixWorld(true);
  // the cover: the book's top face (in the book's own frame: it lies on its back cover), the picture cut to its shape
  const inv = bk.matrixWorld.clone().invert(), lb = new THREE.Box3();
  bk.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); lb.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld.clone().premultiply(inv))); } });
  const w = (lb.max.x - lb.min.x) * 0.94, d = (lb.max.z - lb.min.z) * 0.94, ar = w / d;   // (inside the boards' edge)
  const W = 1024, H = Math.round(W / Math.max(ar, 1 / ar)), c = document.createElement('canvas'); c.width = ar >= 1 ? W : H; c.height = ar >= 1 ? H : W;
  const g = c.getContext('2d'), s = Math.max(c.width / im.width, c.height / im.height); g.drawImage(im, (c.width - im.width * s) / 2, (c.height - im.height * s) / 2, im.width * s, im.height * s);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0, fog: false }));
  cover.rotation.x = -Math.PI / 2; cover.position.set((lb.min.x + lb.max.x) / 2, lb.max.y + 0.0012, (lb.min.z + lb.max.z) / 2);
  // which way is "up" on the picture: its top toward the book's far edge from the room's eye (the camera looks from +z)
  bk.add(cover);
  bk.traverse(o => { if (!o.isMesh) return; o.layers.set(GBOOK.layer); o.material = o.material.clone(); o.material.fog = false; o.material.onBeforeCompile = crispPatch; o.material.needsUpdate = true; });
  bk.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(bk, true), bc = bb.getCenter(new THREE.Vector3());
  GBOOK.box = [bc.x, bb.min.y - 0.005, bc.z, (bb.max.x - bb.min.x) / 2 + 0.01, bb.max.y - bb.min.y + 0.01, (bb.max.z - bb.min.z) / 2 + 0.01];
  GBOOK.hit = bb.clone().expandByScalar(0.004);
  scene.traverse(o => { if (o.isLight) o.layers.enable(GBOOK.layer); });
  GBOOK.book = bk; sharpQuad(GBOOK.P);
  if (renderer.compileAsync) { SHARP.cam.layers.set(GBOOK.layer); renderer.setRenderTarget(POST.rt); try { await renderer.compileAsync(bk, SHARP.cam, scene); } catch (e) { /* compiled on first use */ } renderer.setRenderTarget(null); }
  GBOOK.ok = true; setNeeds(true);
}
const _gp = new THREE.Vector3();
function gardenHit(ray) { return GBOOK.ok && !!ray.intersectBox(GBOOK.hit, _gp); }
function stepGardenBook(dt) {   // the outline in and out (0.14 s): true while it moves
  if (!GBOOK.ok) return false;
  const was = GBOOK.out, to = GBOOK.hover ? 1 : 0; GBOOK.out += Math.sign(to - GBOOK.out) * Math.min(Math.abs(to - GBOOK.out), dt / 0.14);
  return GBOOK.out !== was;
}
function drawGardenBook() {
  if (!GBOOK.ok) return;
  const U = GBOOK.P.quad.material.uniforms, pr = renderer.getPixelRatio(), PU = POST.mat.uniforms;
  U.uOut.value = GBOOK.out; U.uOutW.value = 2 * pr; U.uHalo.value = 1.6 * pr; U.uFade.value = 1;
  SHARP.u.uExp.value = PU.exposure.value; SHARP.u.uLift.value = PU.lift.value; SHARP.u.uVeil.value = PU.veil.value;
  crispPass(GBOOK.P, GBOOK.box);
}

export { GBOOK, buildGardenBook, drawGardenBook, gardenHit, stepGardenBook };
