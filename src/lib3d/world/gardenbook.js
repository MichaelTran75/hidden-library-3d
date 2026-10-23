import './iss.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { renderer, scene } from '../core/renderer.js';
import { LIGHTS } from './lights.js';
import { POST } from '../fx/post.js';
import { ROOMF, SHARP, crispPass, crispPatch, sharpQuad } from './pets.js';
import { setNeeds } from '../core/loop.js';

/* ---------------------------------------------------------------- the 3D garden's book on the pouf
   The book on top of the pair on the pouf wears a picture of the 3D garden (its camper van under its awning) as its
   cover; the pointer on it outlines it, a click opens the garden in a new tab (G, 18/10/2026: "em thay bìa sách thành
   ảnh screenshot, then add white border khi hover over, when click then open new tab https://michaeltran75.github.io/
   3d-garden/"). Drawn sharp over the painted room, as the 747 is, on a layer of its own (its outline needs one). */
/* the two books on the pouf, under the magazine, drawn sharp over the painted room as the magazine is (G, 24/10/2026: "em cho
   cuốn sách remove water color": with no watercolour left on them they were still soft, the room's picture is drawn smaller
   than the screen): a twin of each of their meshes on a layer of their own (9), its material patched as the sharp layers'
   are, drawn before the magazine so it lies over them. The books themselves stay in the room (their shadow, their depth). */
const PBOOK = { ok: false, layer: 9, twins: [], box: null, P: { rt: null, quad: null, paint: 0, wash: 0, layer: 9, toneK: 1, pad: 10, still: true } };
// and so the two on the table, and the rug with the pouf's shade on it (G, 24/10/2026: "em cho thảm dưới sàn 100% visible, sách
// cũng visible"); the rug drawn first of the sharp layers, under the deck and the cat (ui/words.js)
const TBOOK = { ok: false, layer: 10, twins: [], box: null, P: { rt: null, quad: null, paint: 0, wash: 0, layer: 10, toneK: 1, pad: 10, still: true } };
const RUGS = { ok: false, layer: 11, twins: [], box: null, P: { rt: null, quad: null, paint: 0, wash: 0, layer: 11, toneK: 1, pad: 8, still: true, dpr: 1 } };
// a material for a sharp twin: the room's own (its own shader changes kept), the crisp layers' depth test added
const sharpTwinMat = (m, fix, own) => { const o = m.onBeforeCompile, key = m.customProgramCacheKey, c = m.clone(); c.fog = false;
  c.onBeforeCompile = (sh, r) => { if (o) o.call(c, sh, r); if (fix) fix(sh); if (!own) crispPatch(sh, r); };   // (own: its pass's own depth only)
  const ck = 'crisp|' + (own ? 'own|' : '') + (fix ? fix.toString() : '') + '|' + (o ? o.toString() : '');   // (each twin's own: the wrapper's source is the same for all)
  c.customProgramCacheKey = () => (key ? key.call(m) : '') + ck; c.needsUpdate = true; return c; };
function sharpTwins(S, objs, fix, own) {   // a twin of each mesh of objs on S's layer; S's box round them all (fix: a change to their shaders)
  const bx = new THREE.Box3();
  for (const b of objs) { if (!b) continue; b.updateWorldMatrix(true, true); bx.expandByObject(b, true); b.traverse(o => { if (!o.isMesh || o.userData.twin) return;
    const mat = Array.isArray(o.material) ? o.material.map(x => sharpTwinMat(x, fix, own)) : sharpTwinMat(o.material, fix, own);
    const t = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, mat, o.count) : new THREE.Mesh(o.geometry, mat); if (o.isInstancedMesh) t.instanceMatrix = o.instanceMatrix;
    t.userData.twin = true; t.layers.set(S.layer); t.frustumCulled = false; t.receiveShadow = o.receiveShadow; t.renderOrder = o.renderOrder; o.add(t); S.twins.push(t); }); }
  if (!S.twins.length) return;
  const pc = bx.getCenter(new THREE.Vector3());
  S.box = [pc.x, bx.min.y - 0.005, pc.z, (bx.max.x - bx.min.x) / 2 + 0.01, bx.max.y - bx.min.y + 0.01, (bx.max.z - bx.min.z) / 2 + 0.01];
  scene.traverse(o => { if (o.isLight) o.layers.enable(S.layer); });
  sharpQuad(S.P); S.ok = true;
}
function drawStill(S) { if (!S.ok) return; const V = S.P.quad.material.uniforms; if (V.uOut) V.uOut.value = 0; if (V.uFade) V.uFade.value = 1; crispPass(S.P, S.box); }
function drawFloorSharp() {   // the rug, sharp (before the deck and the animals: ui/words.js)
  // (only once the room has stood still a moment: its fourteen layers of pile drawn again every frame of a move cost ~10 ms a
  // frame; while the room moves the painted rug shows, and as it stops the sharp one comes back)
  if (!RUGS.ok || performance.now() - ROOMF.t < 200) return; const PU = POST.mat.uniforms; SHARP.u.uExp.value = PU.exposure.value; SHARP.u.uLift.value = PU.lift.value; SHARP.u.uVeil.value = PU.veil.value; drawStill(RUGS);
}
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
  if (bk.userData.cover) {   // the magazine (world/furnish.js): its cover face takes the picture, cut to its shape
    const ar = bk.userData.ar, c = document.createElement('canvas'); c.width = ar >= 1 ? 1024 : Math.round(1024 * ar); c.height = ar >= 1 ? Math.round(1024 / ar) : 1024;
    const g = c.getContext('2d'), s = Math.max(c.width / im.width, c.height / im.height); g.drawImage(im, (c.width - im.width * s) / 2, (c.height - im.height * s) / 2, im.width * s, im.height * s);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; const m = bk.userData.cover.material[0]; m.map = tex; m.needsUpdate = true;
  } else {
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
  }
  const sharpen = m => { m = m.clone(); m.fog = false; m.onBeforeCompile = crispPatch; m.needsUpdate = true; return m; };   // (a magazine's faces are several)
  bk.traverse(o => { if (!o.isMesh) return; o.layers.set(GBOOK.layer); o.material = Array.isArray(o.material) ? o.material.map(sharpen) : sharpen(o.material); });
  bk.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(bk, true), bc = bb.getCenter(new THREE.Vector3());
  GBOOK.box = [bc.x, bb.min.y - 0.005, bc.z, (bb.max.x - bb.min.x) / 2 + 0.01, bb.max.y - bb.min.y + 0.01, (bb.max.z - bb.min.z) / 2 + 0.01];
  GBOOK.hit = bb.clone().expandByScalar(0.004);
  scene.traverse(o => { if (o.isLight) o.layers.enable(GBOOK.layer); });
  GBOOK.book = bk; sharpQuad(GBOOK.P);
  if (renderer.compileAsync) { SHARP.cam.layers.set(GBOOK.layer); renderer.setRenderTarget(POST.rt); try { await renderer.compileAsync(bk, SHARP.cam, scene); } catch (e) { /* compiled on first use */ } renderer.setRenderTarget(null); }
  GBOOK.ok = true; setNeeds(true);
  if (LIGHTS.poufBooks) sharpTwins(PBOOK, LIGHTS.poufBooks);
  if (LIGHTS.tableBooks) sharpTwins(TBOOK, LIGHTS.tableBooks);
  // (the rug's tufts, seen sharp, lined up in rows as stripes: its pile taken as if seen from 2.5 times as far, so the tufts merge
  // into the wool's surface sooner, as in the painted room)
  // (and the pouf with them: drawn sharp, the rug was cut round it by the room's coarser depth, a stair-stepped edge: G, 24/10/2026,
  // "remove răng cưa trên pouf")
  if (LIGHTS.rug) sharpTwins(RUGS, [LIGHTS.rug, LIGHTS.pouf, ...(LIGHTS.poufAO || [])], sh => { sh.fragmentShader = sh.fragmentShader.replace('float tp = max(tpx.x, tpx.y);', 'float tp = max(tpx.x, tpx.y) * 2.5;'); }, true);   // (own depth: nothing of the room stands before them, and the room's coarser depth left a stepped seam round the pouf)
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
  drawStill(TBOOK); drawStill(PBOOK);   // (the books under it first)
  crispPass(GBOOK.P, GBOOK.box);
}

export { GBOOK, PBOOK, RUGS, TBOOK, buildGardenBook, drawFloorSharp, drawGardenBook, gardenHit, stepGardenBook };
