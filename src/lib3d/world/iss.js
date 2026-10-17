import './clock.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { R, tick } from '../core/base.js';
import { canvas, ctex } from '../core/utils.js';
import { renderer, scene } from '../core/renderer.js';
import { room } from './room.js';
import { POST } from '../fx/post.js';
import { SHARP, crispPass, crispPatch, sharpQuad } from './pets.js';
import { standParts } from './b747.js';
import { setNeeds } from '../core/loop.js';

/* ---------------------------------------------------------------- the ISS over the Geography bay
   A display model of the International Space Station on a stand like the 747's (a walnut base, a chrome rod), standing
   on top of the back bookcase over its Geography bay, in front of the glass (G, 17/10/2026: "add ISS lego to here có trụ
   đỡ giống boeing 747; hover over to select the iss, click to open new tab, add link https://michaeltran75.github.io/
   iss-station/"). Where G drew it: the right-hand pane, between the sky clock and the Research row's names.
   - "ISS" by uperesito (Sketchfab, CC BY 4.0), made one mesh with one material (tools/iss/make.mjs): its 36 small
     textures in one atlas; each vertex carries its texture's place there and the range of its own texture coordinates,
     and the shader repeats each texture inside its cell as the model did (issPatch). No normals: shaded flat, as its
     panels and trusses are.
   - 71 cm across its arrays (88 at first, 10 % smaller twice: G, 18/10/2026), its face to the room (the truss over the modules, the Russian segment above), leaning back
     12° to look down at the room's eye, turned 18° toward it. The rod meets the back of the US laboratory, under the
     truss's middle.
   - Drawn sharp over the painted room as the 747 is (pets.js crispPass, on a layer of its own), outlined under the
     pointer; a click opens ISS.url in a new tab. The pointer finds it in a grid of the cells it fills (issVoxels). */
const ISS = { ok: false, layer: 6, url: 'https://michaeltran75.github.io/iss-station/', hover: false, out: 0, fade: 0, holder: null, mesh: null, box: null, vox: null, hitBoxes: null,
  P: { rt: null, quad: null, paint: 0, wash: 0.25, layer: 6, toneK: 1, outline: true, pad: 12 } };
const IS = {
  span: 0.88 * 0.9 * 0.9,                    // across its arrays (m): 71 cm
  lean: 12 * Math.PI / 180,                  // its face tipped down toward the room's eye
  yaw: -18 * Math.PI / 180,                  // and turned toward it (the room's eye is to its left)
  mid: [1.68, 3.51],                         // the middle of it (x, y): the middle of G's box, over the Geography bay
  attach: [7.0, -2.3, -4.0],                 // where the rod meets it, in the model's units: the back of the US lab, under the truss's middle
  stand: 1.5 * 0.9 * 0.9,                    // the stand: the 747's (as it was at first) 1.2 times
  light: 1.6,                                // its display light
};

async function issBytes() {   // inline (base64) in the one-file build, a file next to the page on GitHub Pages
  const el = document.getElementById('iss-glb'); if (!el) return null;
  if (el.dataset.src) { const r = await fetch(el.dataset.src); if (!r.ok) throw new Error('iss ' + r.status); return r.arrayBuffer(); }
  if (el.textContent.trim().length > 100) return (await fetch('data:application/octet-stream;base64,' + el.textContent.trim())).arrayBuffer();
  return null;
}
// each texture repeated inside its cell of the atlas: the coordinate's fraction placed in the cell, its gradient kept
// (no seam where it wraps), the mip level no coarser than the cells' 8-texel borders (no colour from a neighbour)
function issPatch(sh) {
  crispPatch(sh);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 _cell; attribute vec4 _uvt; varying vec4 vCell; varying vec2 vUvR;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vCell = _cell; vUvR = _uvt.xy + uv * _uvt.zw;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vCell; varying vec2 vUvR;')
    .replace('#include <map_fragment>', `vec2 ckTs = vec2(textureSize(map, 0)), ckGx = dFdx(vUvR) * vCell.zw * ckTs, ckGy = dFdy(vUvR) * vCell.zw * ckTs;
  float ckG = max(length(ckGx), length(ckGy)); if (ckG > 8.0) { ckGx *= 8.0 / ckG; ckGy *= 8.0 / ckG; }
  diffuseColor *= textureGrad(map, vCell.xy + fract(vUvR) * vCell.zw, ckGx / ckTs, ckGy / ckTs);`);
}
// the cells of a grid over its own box that its triangles' boxes touch (about 100 along its length): what the pointer finds
function issVoxels(geo) {
  geo.computeBoundingBox(); const b = geo.boundingBox.clone(), size = b.getSize(new THREE.Vector3()), c = Math.max(size.x, size.y, size.z) / 100;
  b.expandByScalar(c * 0.5); b.getSize(size);
  const nx = Math.ceil(size.x / c), ny = Math.ceil(size.y / c), nz = Math.ceil(size.z / c), m = new Uint8Array(nx * ny * nz), p = geo.attributes.position, ix = geo.index.array, v = new THREE.Vector3();
  for (let t = 0; t < ix.length; t += 3) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) { v.fromBufferAttribute(p, ix[t + k]); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z); }
    const i0 = Math.floor((x0 - b.min.x) / c), i1 = Math.floor((x1 - b.min.x) / c), j0 = Math.floor((y0 - b.min.y) / c), j1 = Math.floor((y1 - b.min.y) / c), k0 = Math.floor((z0 - b.min.z) / c), k1 = Math.floor((z1 - b.min.z) / c);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) m[(k * ny + j) * nx + i] = 1;
  }
  return { b, c, nx, ny, nz, m };
}
const IR = { inv: new THREE.Matrix4(), ray: new THREE.Ray(), p: new THREE.Vector3() };
function issHit(ray) {   // the pointer's ray against the stand's boxes, then through the grid of the station's cells
  if (!ISS.ok) return false;
  IR.inv.copy(ISS.holder.matrixWorld).invert(); IR.ray.copy(ray).applyMatrix4(IR.inv);
  for (const bx of ISS.hitBoxes) if (IR.ray.intersectsBox(bx)) return true;
  const V = ISS.vox; IR.inv.copy(ISS.mesh.matrixWorld).invert(); IR.ray.copy(ray).applyMatrix4(IR.inv);
  if (!IR.ray.intersectBox(V.b, IR.p)) return false;
  const d = IR.ray.direction, o = IR.p, c = V.c, n = [V.nx, V.ny, V.nz], at = [o.x - V.b.min.x, o.y - V.b.min.y, o.z - V.b.min.z], dir = [d.x, d.y, d.z];
  const cell = [0, 0, 0], step = [0, 0, 0], tMax = [0, 0, 0], tDelta = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    cell[a] = Math.min(n[a] - 1, Math.max(0, Math.floor(at[a] / c)));
    step[a] = dir[a] > 0 ? 1 : -1;
    tDelta[a] = dir[a] !== 0 ? Math.abs(c / dir[a]) : Infinity;
    tMax[a] = dir[a] !== 0 ? ((cell[a] + (dir[a] > 0 ? 1 : 0)) * c - at[a]) / dir[a] : Infinity;
  }
  for (let i = 0; i < 400; i++) {
    if (V.m[(cell[2] * V.ny + cell[1]) * V.nx + cell[0]]) return true;
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    cell[a] += step[a]; if (cell[a] < 0 || cell[a] >= n[a]) return false; tMax[a] += tDelta[a];
  }
  return false;
}

async function buildIss() {
  const buf = await issBytes(); if (!buf) return;
  const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '');
  let mesh = null; g.scene.traverse(o => { if (o.isMesh) mesh = o; }); if (!mesh) return;
  const mat = mesh.material; mat.side = THREE.DoubleSide; mat.fog = false; mat.flatShading = true;
  if (mat.map) mat.map.anisotropy = 8;
  mat.onBeforeCompile = issPatch; mat.customProgramCacheKey = () => 'iss-crisp';
  mesh.layers.set(ISS.layer); mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
  // the model in its file's frame, the rod's meeting point at the origin; tipped up to face the room (its +y), the
  // Russian segment (its −z) above, leaning back a little; scaled to its span
  const model = g.scene; model.updateMatrixWorld(true);
  const fb = new THREE.Box3().setFromObject(model, true), s = IS.span / (fb.max.x - fb.min.x);
  model.position.fromArray(IS.attach).negate();
  const lean = new THREE.Group(); lean.add(model); lean.rotation.x = Math.PI / 2 + IS.lean; lean.scale.setScalar(s);
  // the stand: the base on the bookcase's top, the rod up to the meeting point, the base along the truss
  const holder = new THREE.Group(), rodTop = new THREE.Vector3(0, 1, 0);
  holder.add(lean); holder.rotation.y = IS.yaw; holder.updateMatrixWorld(true);
  // how high the rod: the station's middle where G drew it (its box's middle, above the meeting point)
  const sb = new THREE.Box3().setFromObject(lean, true), mid = sb.getCenter(new THREE.Vector3());
  rodTop.y = IS.mid[1] - R.caseTop - mid.y; lean.position.copy(rodTop);
  const st = standParts(rodTop, IS.stand);
  const walnut = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#6a4128').convertSRGBToLinear(), roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.5 });   // (as the 747's)
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, metalness: 1, roughness: 0.16 });
  const stand = new THREE.Group(), base = new THREE.Mesh(st.base, walnut), rod = new THREE.Mesh(st.rod, chrome); base.rotation.y = Math.PI / 2; stand.add(base, rod); holder.add(stand);
  // on the bookcase's top over the Geography bay: the middle of it where G drew it; the base on the top board's middle,
  // or forward of it as far as the station's back must be from the glass (4 cm) and the base's from the transom rail
  // along the glass's foot (its face 7 cm in front of the glass)
  holder.position.set(0, R.caseTop, R.zB + R.caseD / 2 + 0.015); holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(lean, true), bbox = new THREE.Box3().setFromObject(base, true);
  holder.position.x += IS.mid[0] - (box.min.x + box.max.x) / 2;
  holder.position.z += Math.max(0, R.zB + 0.04 - box.min.z, R.zB + 0.075 - bbox.min.z);
  holder.updateMatrixWorld(true);
  holder.traverse(o => {
    if (!o.isMesh) return; o.layers.set(ISS.layer); o.castShadow = false; o.receiveShadow = true;
    if (o !== mesh) { o.material.fog = false; o.material.onBeforeCompile = crispPatch; }   // (hidden where the room is nearer, as the 747)
  });
  await tick();
  // its shadow on the top: a soft patch under the base
  {
    const c2 = canvas(128, 128), gc = c2.getContext('2d'), gr = gc.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(18,11,5,.6)'); gr.addColorStop(0.6, 'rgba(18,11,5,.25)'); gr.addColorStop(1, 'rgba(18,11,5,0)'); gc.fillStyle = gr; gc.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.23 * IS.stand, 0.135 * IS.stand), new THREE.MeshBasicMaterial({ map: ctex(c2, { rep: false }), transparent: true, depthWrite: false, fog: false }));
    m.rotation.set(-Math.PI / 2, 0, IS.yaw); m.position.set(holder.position.x, R.caseTop + 0.001, holder.position.z); m.renderOrder = 1; room.add(m);
  }
  // what the pointer finds: the stand's boxes (in the holder's frame), the station's cells
  base.updateMatrixWorld(true); rod.updateMatrixWorld(true);
  const inv = holder.matrixWorld.clone().invert();
  ISS.hitBoxes = [base, rod].map(o => new THREE.Box3().setFromObject(o, true).applyMatrix4(inv));
  ISS.vox = issVoxels(mesh.geometry);
  // the box the crisp pass draws (its corners on screen), and the room's lights lighting it on its layer
  const bb = new THREE.Box3().setFromObject(holder, true), bc = bb.getCenter(new THREE.Vector3());
  ISS.box = [bc.x, bb.min.y - 0.005, bc.z, (bb.max.x - bb.min.x) / 2 + 0.01, bb.max.y - bb.min.y + 0.01, (bb.max.z - bb.min.z) / 2 + 0.01];
  scene.traverse(o => { if (o.isLight) o.layers.enable(ISS.layer); });
  // and a display light of its own (on its layer only): high up in front of it, toward the room, as a small spot on a
  // model would be; the room's lamps are far from where it stands, against the glass
  const key = new THREE.DirectionalLight(0xfff3e4, IS.light); key.layers.set(ISS.layer); key.position.set(holder.position.x - 0.8, R.H - 0.4, holder.position.z + 2.6);
  key.target.position.set(holder.position.x, IS.mid[1], holder.position.z); scene.add(key, key.target); key.target.updateMatrixWorld();
  scene.add(holder); ISS.holder = holder; ISS.mesh = mesh; ISS.key = key; sharpQuad(ISS.P);
  if (renderer.compileAsync) { SHARP.cam.layers.set(ISS.layer); renderer.setRenderTarget(POST.rt); try { await renderer.compileAsync(holder, SHARP.cam, scene); } catch (e) { /* compiled on first use */ } renderer.setRenderTarget(null); }
  ISS.ok = true; setNeeds(true);
}
function stepIss(dt) {   // the outline in and out (0.14 s), the model faded in once (0.6 s): true while either moves
  if (!ISS.ok) return false;
  const was = ISS.out + ISS.fade, to = ISS.hover ? 1 : 0;
  ISS.out += Math.sign(to - ISS.out) * Math.min(Math.abs(to - ISS.out), dt / 0.14); ISS.fade = Math.min(1, ISS.fade + dt / 0.6);
  return ISS.out + ISS.fade !== was;
}
function drawIss() {   // over the picture, with the 747 (in front of the sky beyond the glass)
  if (!ISS.ok) return;
  const U = ISS.P.quad.material.uniforms, pr = renderer.getPixelRatio(), PU = POST.mat.uniforms;
  U.uOut.value = ISS.out; U.uOutW.value = 2 * pr; U.uHalo.value = 1.6 * pr; U.uFade.value = ISS.fade;
  SHARP.u.uExp.value = PU.exposure.value; SHARP.u.uLift.value = PU.lift.value; SHARP.u.uVeil.value = PU.veil.value;
  crispPass(ISS.P, ISS.box);
}

export { ISS, buildIss, drawIss, issHit, stepIss };
