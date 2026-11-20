import './camparts.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { fileBytes } from '../core/base.js';
import { canvas, ctex } from '../core/utils.js';
import { camera, prime, renderer, scene } from '../core/renderer.js';
import { room } from './room.js';
import { DECOR } from './decor/kit.js';
import { cellLight } from './shelves.js';
import { POST, QUAD_VS } from '../fx/post.js';
import { SHARP, crispPass, sharpQuad } from './pets.js';
import { DECKR } from '../ui/deck.js';
import { setNeeds } from '../core/loop.js';
import { buildCamParts } from './camparts.js';
import { ckColumns } from './clock.js';

/* ---------------------------------------------------------------- the vintage camera on the tall shelf
   "Vintage Camera ~ Asahi Pentax H2" by Robin Vandenberghe (Sketchfab, CC BY 4.0; tools/camera/make.mjs), in its
   leather case, where the mantel clock stood (decor/build.js gives that cell up: DECOR.camera). Its body 0.24 m wide,
   1.7 times the H2's 143 mm, so it reads from across the room as the clock there did. Upright as the file has it (y
   up); its lens, found from its parts (Lence_LP from Body_LP), toward the room, turned a little to show its side. Its
   strap is left out: the model has it hanging straight down, as from a hook, and on a shelf it went through the board;
   the rings it hung from stay, the pins and buckles at its ends go with it.
   Drawn sharp over the room on a layer of its own, as the clock is drawn: under the pointer it is outlined; a click brings it out of the shelf, three times its size,
   the room dimmed, tipped a little to show its top, and it comes apart, each part named in two columns beside it.
   Dragged, it turns; a click on it puts it together or apart; Esc, the × or a click beside it puts it back.
   The model is a shell (a closed body, a closed lens, the knobs). Apart, the body's shell is drawn as the camera's own
   covers (vcShell: top cover, bottom cover, back, the mirror box's front, the body), and what such a camera holds
   inside comes from camparts.js: the lens's glass and diaphragm, the mirror box, the focusing screen and pentaprism,
   the cloth shutter, the film's way, the wind train and the slow-speed escapement (the Asahi Pentax H2 of 1959: one
   speed dial on top, 1 s to 1/500 s and B; a rapid wind lever with a frame counter set by hand; no self-timer; the
   M42 screw mount; an instant-return mirror; a Fresnel screen with a microprism spot). */
const VCAM = { ok: false, layer: 8, bodyW: 0.24, turn: 0.42, big: 3, tilt: 0.32, group: null, hover: false, out: 0, home: null, local: null, box: null, xray: null,
  parts: {}, span: null, key: null, fill: null, view: { on: false, k: 0, e: 0, eT: 0, yaw: 0, sway: 0, ph: 0, held: 0, drag: null, el: null, labels: null, rects: null },
  P: { rt: null, quad: null, paint: 0, wash: 0, layer: 8, toneK: 1, pad: 12, outline: true },   // on its shelf (no watercolour: none indoors; its outline)
  PI: { rt: null, quad: null, paint: 0, wash: 0, layer: 8, toneK: 1, pad: 6, focus: true } };     // out, in front of the room (large on the screen: 1.25 px a CSS px)
const VCU = { uRoomDepth: { value: 1 } };   // 1: hidden where the room is nearer (on its shelf); 0: out in front of it
// its parts apart. nodes: the model's pieces; shell: which part of the body's one shell (cut in the shader: vcShell);
// what is inside comes from camparts.js under the same names. to: the way each goes apart, in millimetres of the real
// camera, in its own frame (x toward the rewind side, y up, z out along the lens); the names
const VC_PARTS = {
  lens: { nodes: ['Lence_LP', 'LensInside_LP', 'Iris_LP'], to: [0, 0, 78], name: ['Lens barrel: Auto-Takumar 55 mm f/2, M42 thread', 'Vỏ ống kính Auto-Takumar 55 mm f/2, ren M42'] },
  front: { name: ['Front group: three air-spaced elements', 'Nhóm trước: ba thấu kính cách nhau bằng khí'] },
  iris: { name: ['Diaphragm, semi-automatic', 'Màng khẩu độ, bán tự động'] },
  rear: { name: ['Rear group: cemented pair, rear element', 'Nhóm sau: cặp thấu kính dán, thấu kính cuối'] },
  mbox: { shell: 3, to: [0, 0, 30], name: ['Mirror box: instant-return mirror, M42 × 1 mount', 'Hộp gương: gương lật trả nhanh, ngàm M42 × 1'] },
  screen: { name: ['Focusing screen: Fresnel lens, microprism spot', 'Kính lấy nét: thấu kính Fresnel, chấm vi lăng kính'] },
  prism: { name: ['Pentaprism', 'Lăng kính năm mặt'] },
  eye: { nodes: ['ViewPort_LP'], to: [0, 52, -16], name: ['Eyepiece', 'Thị kính'] },
  top: { shell: 1, to: [0, 52, 0], name: ['Top cover', 'Nắp trên'] },
  rewind: { nodes: ['Knop4_LP', 'Knop4_Onder_LP'], to: [0, 63, 0], name: ['Rewind knob, film reminder dial', 'Núm tua phim, vòng nhắc loại phim'] },
  lever: { nodes: ['Knop1_LP', 'Knop1_Onder_LP'], to: [0, 62, 0], name: ['Rapid wind lever, frame counter', 'Cần lên phim, bộ đếm khung'] },
  dial: { nodes: ['Knop3_LP', 'Knop3_Onder_LP'], to: [0, 68, 0], name: ['Shutter speed dial, 1 s – 1/500 s, B', 'Núm tốc độ màn trập, 1 s – 1/500 s, B'] },
  release: { nodes: ['Knop2_LP'], to: [0, 74, 0], name: ['Shutter release', 'Nút chụp'] },
  body: { nodes: ['Knop5_LP'], shell: 0, to: [0, 0, 0], name: ['Die-cast body: film gate, sprocket, take-up spool', 'Thân đúc: khung phim, trục răng kéo phim, lõi cuốn phim'] },
  shutter: { name: ['Cloth focal-plane shutter: two curtains, four rollers', 'Màn trập vải: hai màn, bốn trục cuốn'] },
  gov: { name: ['Slow-speed escapement, 1 s – 1/30 s', 'Bộ hãm tốc độ chậm, 1 s – 1/30 s'] },
  gears: { name: ['Wind train: film, shutter and mirror in one stroke', 'Bộ truyền lên phim: phim, màn trập, gương trong một lần gạt'] },
  film: { name: ['35 mm film in its cassette, frame 24 × 36 mm', 'Phim 35 mm trong hộp, khung hình 24 × 36 mm'] },
  plate: { name: ['Pressure plate', 'Tấm ép phim'] },
  back: { shell: 4, to: [0, 0, -52], name: ['Hinged back', 'Lưng máy bản lề'] },
  bottom: { shell: 2, to: [0, -22, 0], name: ['Bottom cover: tripod socket, rewind button', 'Nắp đáy: lỗ chân máy, nút nhả tua phim'] },
  case: { nodes: ['Bag_LP', 'Haakjes_LP', 'Rings_LP'], to: [0, -64, -70], name: ['Leather ever-ready case', 'Bao da'] },
};
const cameraBytes = () => fileBytes('camera-glb');   // (inline in the one-file build, a file next to the page on GitHub Pages: core/base.js)
function vcPatch(sh) {   // (hidden where the room is nearer, as the clock: on its shelf only)
  sh.uniforms.uDepth = DECKR.u.uDepth; sh.uniforms.uFull = DECKR.u.uFull; sh.uniforms.uOff = DECKR.u.uOff; sh.uniforms.uRoomDepth = VCU.uRoomDepth;
  sh.fragmentShader = 'uniform sampler2D uDepth; uniform vec2 uFull, uOff; uniform float uRoomDepth;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (uRoomDepth > 0.5 && gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;');
}
// the body is one closed shell in the model; the camera's own covers are cut from it where it is drawn, each a copy of the
// shell that keeps one part (millimetres, the camera's frame: uShellM takes the shell's points there): 1 the top cover
// (above its seam), 2 the bottom cover, 3 the mirror box's front with the lens mount, 4 the back, 0 the rest. Inside,
// each is dark, bare metal. Holes where the real camera has them: the mount's throat, the tripod socket, the rewind button
const VSH = { uShellM: { value: new THREE.Matrix4() } };
function vcShell(mat, part) {
  const m = mat.clone(), up = { value: part }; m.side = THREE.DoubleSide; m.fog = false; m.customProgramCacheKey = () => 'vcam-shell';
  m.onBeforeCompile = sh => { vcPatch(sh); sh.uniforms.uShellM = VSH.uShellM; sh.uniforms.uPart = up;
    sh.vertexShader = 'uniform mat4 uShellM; varying vec3 vShP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvShP = (uShellM * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uPart; varying vec3 vShP;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      { vec3 p = vShP; float part = p.y > 26.9 ? 1.0 : (p.y < -29.4 ? 2.0 : (p.z > 26.95 && abs(p.x) < 26.3 ? 3.0 : (p.z < -4.2 ? 4.0 : 0.0)));
        if (abs(part - uPart) > 0.5) discard;
        if (part == 3.0 && p.z > 39.5 && length(p.xy) < 20.3) discard;
        if (part == 2.0 && p.y < -33.6 && (length(p.xz - vec2(0.0, 12.0)) < 3.25 || length(p.xz - vec2(-36.5, 3.25)) < 2.3)) discard; }`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (!gl_FrontFacing) { diffuseColor.rgb = vec3(0.016, 0.015, 0.014); metalnessFactor = 0.3; roughnessFactor = 0.7; }'); };
  return m;
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
  const bodyBox = new THREE.Box3().setFromObject(model.getObjectByName('Body_LP'), true), s = VCAM.bodyW / (bodyBox.max.x - bodyBox.min.x), mm = 143 / (bodyBox.max.x - bodyBox.min.x);   // (mm: millimetres of the real camera a unit of the model)
  // what is inside it (camparts.js: made in millimetres about the lens's axis), in a frame of the model's that reads so
  const core = VCAM.core = new THREE.Group(); core.position.set(lens.x, lens.y, 0); core.scale.setScalar(1 / mm); model.add(core);
  const made = buildCamParts(), inside = {};
  for (const [k, list] of Object.entries(made.P)) for (const p of list) { const grp = new THREE.Group();
    for (const [mk, geo] of Object.entries(p.geo)) { const mats = mk.split('+').map(n => made.M[n]), mesh = new THREE.Mesh(geo, mats.length > 1 ? mats : mats[0]); mesh.name = k + ':' + mk; if (mats[0].transparent) mesh.renderOrder = 2; grp.add(mesh); }
    core.add(grp); (inside[k] = inside[k] || []).push({ o: grp, to: p.to, lag: p.lag, keep: !!p.keep }); }
  // turned about the vertical so its lens looks along +z (the cell's way into the room): by quarter turns, so its own axes
  // stay the camera's (its lens stands a little off the body's middle: the way from the one to the other is askew); what
  // is left of that turn goes to the whole group, and it stands on its shelf as it did
  const f = lens.clone().sub(body); f.y = 0; f.normalize();
  const turn = -Math.atan2(-f.x, f.z), square = Math.round(turn / (Math.PI / 2)) * Math.PI / 2; VCAM.skew = turn - square;
  const inner = new THREE.Group(); inner.add(model); inner.rotation.y = square; inner.updateMatrixWorld(true);
  inner.scale.setScalar(s); inner.updateMatrixWorld(true);
  const all = new THREE.Box3().setFromObject(inner, true), c = all.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -all.min.y, -c.z);   // (its foot on the board, its middle over the cell's)
  const g = new THREE.Group(); g.add(inner); g.position.copy(spot.at); g.rotation.y = spot.yaw + VCAM.turn + VCAM.skew;
  g.traverse(o => { if (!o.isMesh) return; o.layers.set(VCAM.layer); o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false;
    o.material = [].concat(o.material).map(m => { m = m.clone(); m.fog = false; if (m.transparent) m.depthWrite = false; m.onBeforeCompile = vcPatch; m.customProgramCacheKey = () => 'vcam-crisp'; return m; });
    if (o.material.length === 1) o.material = o.material[0]; });
  scene.add(g); g.updateMatrixWorld(true);
  VCAM.group = g; VCAM.home = { pos: g.position.clone(), yaw: g.rotation.y };
  const inv = g.matrixWorld.clone().invert(); VCAM.local = boxIn([g], inv); VCAM.size = VCAM.local.getSize(new THREE.Vector3()).toArray();
  // the body's shell as its five parts (vcShell): copies of it, each drawing its own part
  let bm = null; model.getObjectByName('Body_LP').traverse(o => { if (o.isMesh && !bm) bm = o; });
  VSH.uShellM.value.copy(core.matrixWorld).invert().multiply(bm.matrixWorld);
  const shell = [0, 1, 2, 3, 4].map(i => { const m = new THREE.Mesh(bm.geometry, vcShell(bm.material, i)); m.position.copy(bm.position); m.quaternion.copy(bm.quaternion); m.scale.copy(bm.scale);
    m.name = 'shell:' + i; m.layers.set(VCAM.layer); m.frustumCulled = false; m.receiveShadow = true; bm.parent.add(m); return m; });
  bm.parent.remove(bm); g.updateMatrixWorld(true);
  // its parts: the pieces of each (the model's, the shell's, what is inside), how far each moves apart in its own parent's
  // frame, how late it starts; the part's box (its frame) together and apart
  const perMm = VCAM.bodyW / 143, pieces = [];
  const piece = (o, to, lag = 0, keep = true) => { const m3 = new THREE.Matrix3().setFromMatrix4(o.parent.matrixWorld.clone().invert().multiply(g.matrixWorld));
    const p = { o, base: o.position.clone(), d: new THREE.Vector3().fromArray(to).multiplyScalar(perMm).applyMatrix3(m3), lag, keep }; pieces.push(p); return p; };
  for (const [k, P] of Object.entries(VC_PARTS)) {
    const list = (P.nodes || []).map(n => model.getObjectByName(n)).filter(Boolean).map(o => piece(o, P.to));
    if (P.shell !== undefined) list.push(piece(shell[P.shell], P.to));
    for (const q of inside[k] || []) list.push(piece(q.o, q.to, q.lag, q.keep));
    if (list.length) VCAM.parts[k] = { pieces: list, box: [null, null] };
  }
  VCAM.pieces = pieces;
  for (const e of [1, 0]) { vcSpread(e, true); g.updateMatrixWorld(true); for (const k in VCAM.parts) VCAM.parts[k].box[e] = boxIn(VCAM.parts[k].pieces.map(p => p.o), inv); }
  VCAM.span = [0, 1].map(e => { const b = new THREE.Box3(); for (const k in VCAM.parts) b.union(VCAM.parts[k].box[e]); return b; });
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
  VCAM.down = cellLight(VCAM.layer, { z: spot.o.z + spot.len / 2, yBot: spot.o.y, yTop: spot.o.y + spot.hgt, wide: spot.len, base: 1.95 });   // (its downlight)
  sharpQuad(VCAM.P); sharpQuad(VCAM.PI);
  SHARP.cam.layers.set(VCAM.layer); await prime(g, POST.rt, SHARP.cam, scene, VCAM.layer); vcSpread(0);   // (its shaders made with all of it shown; then what is inside hidden)
  buildCamUI(); VCAM.ok = true; setNeeds(true);
}

// ---- on its shelf, and out of it
const vcEase = k => k * k * (3 - 2 * k), vcLerp = (a, b, k) => a + (b - a) * k;
const VCV = { q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), f: new THREE.Vector3(), r: new THREE.Vector3(), c: new THREE.Vector3(), w: new THREE.Vector3(), box: new THREE.Box3(), dim: null, side: 0 };
function vcSpread(e, all = false) {   // each piece as far apart as it is (the later ones start late); what is inside shown only once it comes apart
  for (const p of VCAM.pieces) { p.o.position.copy(p.base).addScaledVector(p.d, vcEase(Math.min(1, Math.max(0, (e - p.lag) / (1 - p.lag))))); p.o.visible = !p.off && (all || p.keep || e > 0.001); }
}
function vcPlace() {   // its parts apart (as far as they are), and where it is: on its shelf, out in front of the camera, or between
  const V = VCAM.view, H = VCAM.group, k = vcEase(V.k), e = vcEase(V.e);
  vcSpread(V.e);
  if (k <= 0) { H.position.copy(VCAM.home.pos); H.rotation.set(0, VCAM.home.yaw, 0); H.scale.setScalar(1); H.updateMatrixWorld(true); return; }
  const cam = camera, f = cam.getWorldDirection(VCV.f), s = VCAM.big;
  const B = VCV.box.copy(VCAM.span[0]); B.min.lerp(VCAM.span[1].min, e); B.max.lerp(VCAM.span[1].max, e);   // (its extent as it stands, together or apart)
  const hgt = (B.max.y - B.min.y) * s, wid = Math.max(B.max.x - B.min.x, B.max.z - B.min.z) * s;
  const th = Math.tan(cam.fov * Math.PI / 360), side = VCV.side = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 0) * (1 - k);   // (the sidebar goes while it is out: body.ck-out)
  const rp = VCV.rp = VCAM.xray ? VCAM.xray.room() : 0;   // (the X-ray plate's room at the right: camxray.js)
  const lw = VCV.lab ? [(VCV.lab[0] + 30) * e, (VCV.lab[1] + 30) * e] : [0, 0];   // (apart: room either side for its parts' names, as wide as they are: ckColumns)
  const across = vcLerp(wid, Math.hypot(B.max.x - B.min.x, B.max.z - B.min.z) * s * 0.9, e);   // (apart it is long: turned askew it is wider than either of its sides)
  const free = Math.max(0.3, 1 - (side + rp + lw[0] + lw[1]) / innerWidth), d = Math.max(hgt / (2 * th * 0.8), across / (2 * th * cam.aspect * free * 0.94)) + wid * 0.15;
  const right = VCV.r.set(-f.z, 0, f.x).normalize(), shift = (side + lw[0] - rp - lw[1]) / 2 / (innerWidth / 2) * d * th * cam.aspect;
  const centre = VCV.c.copy(cam.position).addScaledVector(f, d).addScaledVector(right, shift);
  // its lens toward the camera, turned a little to show its side (apart: further, so the row of parts along the lens's axis
  // is seen from the side), tipped to show its top; its own turn
  let yaw = Math.atan2(-f.x, -f.z) + vcLerp(0.5, 0.95, e) + VCAM.skew + V.yaw + V.sway, y0 = VCAM.home.yaw; while (yaw - y0 > Math.PI) yaw -= Math.PI * 2; while (yaw - y0 < -Math.PI) yaw += Math.PI * 2;
  H.rotation.set(vcLerp(0, VCAM.tilt, k), vcLerp(y0, yaw, k), 0, 'YXZ'); H.scale.setScalar(vcLerp(1, s, k));
  const mid = B.getCenter(VCV.w).multiplyScalar(H.scale.x).applyQuaternion(VCV.q.setFromEuler(VCV.e.copy(H.rotation)));
  H.position.copy(VCAM.home.pos).lerp(centre.sub(mid), k); H.updateMatrixWorld(true);
  const kl = VCAM.key, fl = VCAM.fill; kl.intensity = 2.6 * k; fl.intensity = 1.1 * k; if (VCAM.down) VCAM.down.light.intensity = VCAM.down.base * (1 - k);   // (its light: from above the viewer's left)
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
  if (V.k <= 0.001) { if (V.el) V.el.classList.remove('is-on'); if (VCAM.xray) VCAM.xray.step(false); return; }
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
  vcLabels(); if (VCAM.xray) VCAM.xray.step(V.on && V.k >= 0.98);
}

// ---- its parts' names: the clock's (clock.js) panel and labels
function buildCamUI() {
  const ui = document.getElementById('l3-ui') || document.body, el = document.createElement('div'); el.className = 'ck-out-ui ck-cols vc-ui';
  const named = Object.keys(VC_PARTS);
  el.innerHTML = '<div class="ck-head"><b>Asahi Pentax H2 <small>(1959)</small></b>'
    + '<small><span class="en">drag to turn · click it: apart / together · Esc to close</span><span class="vi">kéo để xoay · bấm vào: tách / ráp · Esc để đóng</span></small>'
    + '<button type="button" class="ck-x" aria-label="Close">&times;</button></div>'
    + '<svg class="ck-lines" aria-hidden="true">' + named.map(k => `<g data-k="${k}"><line></line><circle r="3"></circle></g>`).join('') + '</svg>'
    + named.map(k => `<span class="ck-name" data-k="${k}"><span class="en">${VC_PARTS[k].name[0]}</span><span class="vi">${VC_PARTS[k].name[1]}</span></span>`).join('');
  ui.appendChild(el); if (VCAM.xray) VCAM.xray.build(el);   // (its X-ray plate, at the screen's right: camxray.js)
  const V = VCAM.view; V.el = el; V.head = el.querySelector('.ck-head'); V.labels = [...el.querySelectorAll('.ck-name')];
  for (const lab of V.labels) { const g = el.querySelector(`.ck-lines g[data-k="${lab.dataset.k}"]`); lab._g = g; lab._l = g.firstChild; lab._d = g.lastChild; }
  el.querySelector('.ck-x').addEventListener('click', e => { e.stopPropagation(); closeCamera(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && VCAM.view.on) { e.stopImmediatePropagation(); closeCamera(); } }, true);
}
function vcRect(k) {   // a part's box on the screen (CSS pixels), where it is now
  const p = VCAM.parts[k], e = vcEase(VCAM.view.e), a = p.box[0], b = p.box[1], r = [1e9, 1e9, -1e9, -1e9], M = VCAM.group.matrixWorld, L = vcLerp;
  for (let i = 0; i < 8; i++) {
    const v = _vcv.set(i & 1 ? L(a.max.x, b.max.x, e) : L(a.min.x, b.min.x, e), i & 2 ? L(a.max.y, b.max.y, e) : L(a.min.y, b.min.y, e), i & 4 ? L(a.max.z, b.max.z, e) : L(a.min.z, b.min.z, e)).applyMatrix4(M).project(camera);
    const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight; r[0] = Math.min(r[0], x); r[1] = Math.min(r[1], y); r[2] = Math.max(r[2], x); r[3] = Math.max(r[3], y);
  }
  return r;
}
function vcLabels() {   // the names in two columns, left and right of the camera (clock.js ckColumns), a fine line from each to its part
  const V = VCAM.view; if (!V.el) return;
  V.el.classList.toggle('is-on', V.on && V.k >= 0.98);
  V.rects = {}; for (const k in VCAM.parts) V.rects[k] = vcRect(k);
  const show = V.e > 0.9 && V.on, L = []; let fx0 = 1e9, fx1 = -1e9;
  for (const lab of V.labels) {
    const r = V.rects[lab.dataset.k]; lab.classList.toggle('is-on', show); lab._g.classList.toggle('is-on', show); if (!show || !r) { lab._on = false; continue; }
    lab._w = lab.offsetWidth; lab._h = lab.offsetHeight; lab._cx = (r[0] + r[2]) / 2; lab._cy = (r[1] + r[3]) / 2; fx0 = Math.min(fx0, r[0]); fx1 = Math.max(fx1, r[2]); L.push(lab);
  }
  if (!VCV.lab) { let w = 0; for (const lab of V.labels) w = Math.max(w, lab.offsetWidth); VCV.lab = [w, w]; }   // (before they are placed: the widest of them either side)
  if (L.length) VCV.lab = ckColumns(L, (VCV.side || 0) + 10, (V.head ? V.head.offsetTop + V.head.offsetHeight : 60) + 12, innerWidth - 10 - (VCV.rp || 0), innerHeight - 12, fx0, fx1);
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
