import './b747.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { R, fileBytes, tick } from '../core/base.js';
import { canvas, ctex, shrinkTexture } from '../core/utils.js';
import { camera, prime, renderer, scene } from '../core/renderer.js';
import { room } from './room.js';
import { CLOCK_CELL, SHELF, cellLight } from './shelves.js';
import { POST, QUAD_VS, setPaint } from '../fx/post.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SHARP, crispPass, crispSeen, sharpQuad } from './pets.js';
import { DECKR } from '../ui/deck.js';
import { OVER } from '../ui/words.js';
import { setNeeds } from '../core/loop.js';

/* ---------------------------------------------------------------- the medieval clock on the tall shelf
   "Ardavin's Medieval Clock. Model Completorium" by Miguel Garcia (CC BY 4.0), 75 cm tall, in two cells of the tall
   shelf made one (shelves.js CLOCK_CELL), drawn sharp over the painted room, not watercoloured. Its parts were measured
   on the model and cut from it (tools/clock); each is a node at its pivot holding its mesh, and turns about its own
   axis as measured (the wheels' planes lean up to 1.4° from the frame's, the verge's rod 1.1°).
   - The going train (teeth counted on the model): the hour wheel (56) carries the hand and the 12-tooth trip star; a
     pinion of 7 on the great wheel's arbor drives it, so that arbor turns 8 times in 12 hours; the great wheel (56)
     drives the second arbor's pinion (7), the second wheel (56) the crown wheel's pinion (7): the crown wheel turns 512
     times in 12 hours. Its 25 teeth pass one a swing pair of the foliot: a beat every 1.6875 s.
   - All of it from the visitor's clock: the hand shows the local time (one turn in 12 hours), the train behind it
     turns by its ratios, so the teeth stay in mesh.
   - The escapement is worked out from its geometry (ckEscSetup): a pallet is a flat face beside the verge's axis, a
     tooth's tip rides on it, and where the tip stands follows from the verge's angle (ckFace). So the crown wheel's
     turn follows the foliot's swing: a small drop as a tooth leaves one pallet and the next lands on the other, then
     back (the recoil) while the foliot runs on to the end of its swing, then on (the impulse) until the tooth leaves.
     A foliot has no period of its own: it is stopped and driven back by one steady push, so its swing is made of
     parabolas, and it keeps only part of its speed where a tooth lands on its pallet. The pallets stand as the model
     has them (22° apart).
   - The strike is the model's own: a passing strike, one blow an hour. A tooth of the star bears down on the trip
     lever's tab through the hour (CK.strike.cam: the lever's turn by the star's, found by turning the two meshes
     against each other, tools/clock/mech.py); the lever's far end pulls the wire, the wire the hammer's tail, and the
     head rises about 7°. On the hour the tooth lets the tab go and the hammer falls about its pin (stepHammer). The tab
     lands on the next tooth with the head still 1.8° short of the bell: the shaft's spring carries the head on to
     strike and brings it back clear, so the bell rings on. The sound is a small bell's (its partials each dying at its
     own rate), made in the page (Web Audio) once the visitor has touched the page, not while the tab is hidden; a blow
     that fell while the page slept is not struck late.
   - Under the pointer it is outlined; a click brings it out of the shelf: three times its size in the middle of the
     free part of the screen, the room dimmed behind it, its picture at full size (1024, decoded again from the file;
     512 on the shelf; the ring's numerals 1024, 256 on the shelf), and it comes apart: the hand, the star and the hour wheel drawn out along their arbor in front
     and to its left, the three arbors of the train to its right, the verge and foliot up to its left; the strike work
     (lever, wire, hammer, bell) stays on the frame, in plain sight there. Each part is named. All of it still going,
     the time still right. Left alone it sways a little either way; dragged, it turns; a click on the bell trips
     the hammer by hand; a click elsewhere on it puts it together or apart; Esc, the ×, or a click beside it puts
     it back on its shelf. Beside it, at the screen's right, its front view as an X-ray plate, going with it (clockxray.js). */
const D2R = Math.PI / 180;
const CLOCK = { ok: false, layer: 5, nodes: {}, pivots: {}, holder: null, root: null, box: null, ctx: null, hover: false, out: 0, wake: 0, t0: null, blows: 0,
  ham: { a: 0, v: 0, at: 0, lift: 0 }, pose: { turn: 0, crown: 0, th: 0, lam: 0, eta: 0 }, xray: null, mat: null, pics: null, large: null,
  local: null, home: null, key: null, fill: null, view: { on: false, k: 0, e: 0, eT: 0, yaw: 0, sway: 0, ph: 0, held: 0, drag: null, el: null, labels: null },
  P: { rt: null, quad: null, paint: 0, wash: 0, layer: 5, toneK: 1, pad: 12, outline: true },    // on its shelf (the outline under the pointer)
  PI: { rt: null, quad: null, paint: 0, wash: 0, layer: 5, toneK: 1, pad: 6, focus: true } };                // out, in front of the room
const CKU = { uRoomDepth: { value: 1 } };   // 1: hidden where the room is nearer (on its shelf); 0: out in front of it
const CK = {
  height: 0.748,                    // the clock's height in the room (m): the model is 33.35 of its units
  big: 3,                           // out of its shelf: three times that
  parts: ['hand', 'star', 'dial', 'great', 'second', 'crown', 'verge', 'lever', 'wire', 'hammer', 'bell'],   // (named when it is out)
  // its parts apart (its own units: x along the arbors, the dial at −x; y up; z to its right); the strike work stays.
  // The hand, the star and the hour wheel drawn out along their arbor, and stepped aside so each shows from the front
  apart: { hand: [-10, -2.4, -16.4], star: [-7.5, 0, -13], dial: [-5, 2.4, -9.6], great: [-5, -2, 11], second: [-5, 1, 19], crown: [-5, 4, 27], verge: [-3, 4, -14] },
  // the axis each part turns about, as the model has it (the wheels' planes, the verge's rod)
  axis: { dial: [0.9999, -0.0083, -0.0109], great: [0.9997, -0.0200, -0.0121], second: [0.9999, -0.0088, -0.0071], crown: [0.9999, -0.0143, -0.0055], verge: [0.0142, 1, 0.0134], lever: [1, 0, 0], hammer: [1, 0, 0] },
  hand0: 44.27 * D2R,               // where the model's hand points (clockwise from XII)
  handFinish: { color: 0x5c554c, roughness: 0.42, metalness: 0.5 },   // the hand: blackened iron
  ratio: { dial: 1, great: -8, second: 64, crown: -512 },   // turns for one of the hand's (the sign: the sense about +x)
  teeth: 25,                        // the crown wheel's
  // the verge escapement, measured on the model (its units, radians): the teeth's tips pass `d` in front of the verge's
  // axis, on a circle of radius R, one of them `tip0` past the top in the model's pose; a pallet's face passes `off`
  // beside the axis and reaches `reach` from it; the two faces stand `beta` either side of straight at the wheel when
  // the verge is at its middle, which is `mid` back from the model's pose. `y0`: the wheel's arbor to the side of the
  // verge's axis. The foliot swings `swing` either way; the wheel's drop takes `dropT` of a beat. (The model gives d 0.34
  // to 0.43, off 0.01 to 0.09, reach 0.53 to 0.56: within that, these let a tooth land just as the other leaves.)
  esc: { d: 0.40, off: 0.08, reach: 0.54, R: 3.2, tip0: 8.9 * D2R, y0: 0.04, beta: 11.2 * D2R, mid: 3.9 * D2R, swing: 32 * D2R, dropT: 0.03 },
  // the strike: the star turned `star0` on from the model's pose (in the model a tooth lets go 13 min past the hour:
  // set so that it is on the hour); `cam`: the lever's turn (degrees, pressed down) for each degree the star has turned
  // since a tooth let go, 0 to 30; `T`: the wire's upper hook, on the hammer's tail (its lower one is the wire's pivot);
  // `bell`: the hammer's turn with its head on the bell (from the model's pose: up is +); `g`: the hammer's fall about
  // its pin (rad/s²: its head 13 cm out at the clock's size); the shaft's spring `k` (s⁻²) and `damp` (of critical);
  // `rest`: the speed kept off the bell; `lift`: how far a click lifts it.
  strike: { star0: 6.52 * D2R, T: [1.084, 33.138, 6.943], bell: -1.81 * D2R, g: 55, k: 3500, damp: 0.1, rest: 0.4, lift: 7.5 * D2R,
    cam: [0.23, -0.25, -0.16, 0.03, 0.21, 0.38, 0.55, 0.77, 1.03, 1.32, 1.70, 1.97, 2.28, 2.60, 2.91, 3.21, 3.54, 3.88, 4.21, 4.50, 4.78, 5.05, 5.32, 5.59, 5.78, 5.92, 6.12, 6.26, 6.03, 5.51, 5.13] },
};
CLOCK.CK = CK;   // (tuning from the console: __lib3d.CLOCK.CK.apart, then CLOCK.reSpan())

const clockBytes = () => fileBytes('clock-glb');   // (inline in the one-file build, a file next to the page on GitHub Pages: core/base.js)
function ckBehindRoom(sh) {   // (hidden where the room is nearer, as the animals: on its shelf only)
  sh.uniforms.uDepth = DECKR.u.uDepth; sh.uniforms.uFull = DECKR.u.uFull; sh.uniforms.uOff = DECKR.u.uOff; sh.uniforms.uRoomDepth = CKU.uRoomDepth;
  sh.fragmentShader = 'uniform sampler2D uDepth; uniform vec2 uFull, uOff; uniform float uRoomDepth;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (uRoomDepth > 0.5 && gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;');
}
async function buildClock() {
  const buf = await clockBytes(); if (!buf) return;
  const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '');
  const root = g.scene.getObjectByName('clock') || g.scene;
  // its finishes, lit by the room: the model's picture as wrought iron and old brass with a little sheen; the dial ring's
  // face with a picture of its own (its numerals drawn large: tools/clock/ring.py); the hand as blackened iron, so that it
  // reads against the brass behind it. One shader for the three.
  const maps = {}; root.traverse(o => { if (o.isMesh && o.material.map) maps[o.material.name === 'ring' ? 'ring' : 'clock'] = o.material.map; });
  for (const k in maps) { shrinkTexture(maps[k], k === 'ring' ? 256 : 512); maps[k].anisotropy = 8; maps[k].colorSpace = THREE.SRGBColorSpace; }   // (small on the shelf, for the page's memory; at full size when it is out: ckPicture)
  const finish = (map, set) => {
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.58, metalness: 0.35, envMapIntensity: 0.8, side: THREE.DoubleSide, fog: false, ...set });
    m.onBeforeCompile = ckBehindRoom; m.customProgramCacheKey = () => 'clock-crisp'; return m;
  };
  const mat = finish(maps.clock), ringMat = maps.ring ? finish(maps.ring, { roughness: 0.52, metalness: 0.22 }) : mat, handMat = finish(maps.clock, CK.handFinish);
  CLOCK.mat = mat; CLOCK.pics = { clock: { mats: [mat, handMat], small: maps.clock, large: null } }; if (maps.ring) CLOCK.pics.ring = { mats: [ringMat], small: maps.ring, large: null };
  root.traverse(o => {
    if (o.isMesh) { o.material = o.material.name === 'ring' ? ringMat : o.parent.name === 'hand' ? handMat : mat; o.layers.set(CLOCK.layer); o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; }
    if (o.name) { CLOCK.nodes[o.name] = o; CLOCK.pivots[o.name] = o.position.clone(); }
  });
  CLOCK.root = root;
  // in the cell: its dial to the room (−x), its base on the lower board, its frame in the middle of the cell's width
  const S = SHELF.R, s = CK.height / 33.35, zc = S.z0 + (CLOCK_CELL.i + 0.5) * S.cw, y0 = 0.1 + CLOCK_CELL.j * S.rh + S.th / 2;
  const holder = new THREE.Group(); holder.add(root); root.scale.setScalar(s);
  root.position.set(0, -0.1 * s, 0);   // (its base's underside at the holder's origin)
  holder.position.set(R.xS + 0.02 + 6.45 * s, y0, zc + 0.3 * s);   // (the hand's nut 2 cm inside the shelf's face; the frame's middle, at −0.3 of its z, at the cell's)
  CLOCK.holder = holder; scene.add(holder); holder.updateMatrixWorld(true);
  CLOCK.home = { pos: holder.position.clone(), s: 1 };
  // its own box (in the holder's frame: what the pointer finds, and what it is centred by when out)
  const inv = holder.matrixWorld.clone().invert(); CLOCK.local = new THREE.Box3().setFromObject(holder, true).applyMatrix4(inv);
  // each part's box about its pivot (the frame's too), as large as it is however far it has turned about its arbor: where
  // its name goes, what a click on it finds, and the whole clock's extent together and apart (in the holder's frame)
  CLOCK.pbox = {}; for (const k of ['static', ...CK.parts]) if (CLOCK.nodes[k]) CLOCK.pbox[k] = ckPartBox(CLOCK.nodes[k], CK_SPIN[k]);
  CLOCK.inner = inv.clone().multiply(CLOCK.nodes.static.parent.matrixWorld); ckSpan(); CLOCK.reSpan = ckSpan;
  const bb = new THREE.Box3().setFromObject(holder, true), bc = bb.getCenter(new THREE.Vector3());
  CLOCK.box = [bc.x, bb.min.y - 0.01, bc.z, (bb.max.x - bb.min.x) / 2 + 0.03, bb.max.y - bb.min.y + 0.04, (bb.max.z - bb.min.z) / 2 + 0.05];   // (room for the foliot's swing and the hammer's)
  // its shadow on the board: a soft patch under the base
  {
    const c2 = canvas(128, 128), gc = c2.getContext('2d'), gr = gc.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(18,11,5,.55)'); gr.addColorStop(0.65, 'rgba(18,11,5,.22)'); gr.addColorStop(1, 'rgba(18,11,5,0)'); gc.fillStyle = gr; gc.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.3), new THREE.MeshBasicMaterial({ map: ctex(c2, { rep: false }), transparent: true, depthWrite: false, fog: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(holder.position.x - 0.7 * s, y0 + 0.001, holder.position.z - 0.3 * s); m.renderOrder = 1; room.add(m);
  }
  scene.traverse(o => { if (o.isLight) o.layers.enable(CLOCK.layer); });   // (the room's lights light it on its layer)
  // and a light of its own when it is out: from above the viewer's left (dark, so nothing changes, until then)
  CLOCK.key = new THREE.DirectionalLight(0xfff4e6, 0); CLOCK.key.layers.set(CLOCK.layer); scene.add(CLOCK.key, CLOCK.key.target);
  CLOCK.fill = new THREE.DirectionalLight(0xdfe8ff, 0); CLOCK.fill.layers.set(CLOCK.layer); scene.add(CLOCK.fill, CLOCK.fill.target);
  CLOCK.down = cellLight(CLOCK.layer, { z: zc, yBot: y0, yTop: y0 + 2 * S.rh - S.th, wide: S.cw - S.th, base: 2.25 });   // (its downlight: the cell is two rows tall)
  sharpQuad(CLOCK.P); sharpQuad(CLOCK.PI); await tick();
  SHARP.cam.layers.set(CLOCK.layer); await prime(holder, POST.rt, SHARP.cam, scene, CLOCK.layer);
  ckEscSetup(); ckStrikeSetup(); CLOCK.ok = true; stepHammer(); poseClock(); setNeeds(true);
  // sound only after the visitor has touched the page; the hour watched for once a second
  for (const t of ['pointerdown', 'keydown', 'touchstart']) addEventListener(t, unlockSound, { capture: true, passive: true });
  setTimeout(() => (window.requestIdleCallback || setTimeout)(makeSound), 12000);   // (made ahead, asleep, while the page is idle: made at the first click it held that click ~130 ms)
  setInterval(watchHour, 1000);
  buildInspectUI();
}

const CK_SPIN = { hand: 1, star: 1, dial: 1, great: 1, second: 1, crown: 1 };   // (what turns right round about its arbor: the others only swing, their boxes as they stand)
function ckPartBox(n, spin) {   // a part's box about its pivot; one that spins: as large as it is however far it has turned
  const v = new THREE.Vector3(), b = new THREE.Box3(); let r = 0;
  n.traverse(m => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).multiply(m.scale).add(m.position); b.expandByPoint(v); if (spin) r = Math.max(r, Math.hypot(v.y, v.z)); }
  });
  if (spin) { b.min.y = b.min.z = -r; b.max.y = b.max.z = r; }
  return b;
}
function ckSpan() {
  const pb = new THREE.Box3(), off = new THREE.Vector3();
  CLOCK.span = [0, 1].map(e => {
    const b = new THREE.Box3();
    for (const k in CLOCK.pbox) { pb.copy(CLOCK.pbox[k]).translate(CLOCK.pivots[k]); if (e && CK.apart[k]) pb.translate(off.fromArray(CK.apart[k])); b.union(pb.applyMatrix4(CLOCK.inner)); }
    return b;
  });
}

// ---- the verge escapement, from its geometry (CK.esc)
// With a pallet's face turned `a` from straight at the wheel, a tooth's tip resting on it stands ckFace(a) to the side
// of the verge's axis; it leaves the face's end at ESC.ax.
const ESC = {}, CKA = {}, CK2 = [0, 0];
const ckEase = k => k * k * (3 - 2 * k);
const ckFace = a => CK.esc.d * Math.tan(a) + CK.esc.off / Math.cos(a);
const ckTip = th => Math.asin((ckFace(CK.esc.beta + th) - CK.esc.y0) / CK.esc.R);   // a tip's angle past the top while it rides the upper pallet, the verge at th from its middle
function ckEscSetup() {
  const K = CK.esc, H = Math.PI / CK.teeth, tmax = Math.sqrt(K.reach * K.reach - K.off * K.off);
  let lo = 0, hi = 1.4; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if ((K.d + K.off * Math.sin(m)) / Math.cos(m) < tmax) lo = m; else hi = m; }
  // through a beat (a beat the unit of time) the foliot coasts while the wheel drops (dropT), is slowed to a stop at the
  // end of its swing (the recoil, b), then driven back to where the tooth leaves (the impulse, c), by the same push both
  // ways; where a tooth lands on its pallet it keeps `rho` of its speed: rho is what gives the swing asked for
  const ax = lo, te = ax - K.beta, A = te + K.swing, q = 2 * A * K.dropT / (1 - K.dropT);
  const rho = (-q + Math.sqrt(Math.max(0, q * q - 4 * A * (q - (K.swing - te))))) / (2 * A), c = (1 - K.dropT) / (1 + rho), we = 2 * A / c;
  Object.assign(ESC, { H, ax, te, rho, b: rho * c, c, we, acc: we / c, th1: -te - we * K.dropT });
  ESC.e1 = ckTip(te); ESC.e0 = ESC.e1 - H; ESC.ea = Math.max(ESC.e0, ckTip(ESC.th1));   // the wheel's turn as a tooth leaves, where the one before left, where the next lands (the drop between)
  let sum = 0; for (let i = 0; i < 400; i++) { const t = (i + 0.5) / 400; sum += ckBeat(t)[1] - H * t; } ESC.mean = sum / 400;
  for (const k in CK.axis) CKA[k] = new THREE.Vector3().fromArray(CK.axis[k]).normalize();
}
function ckBeat(t) {   // through a beat (0 to 1): the verge's angle from its middle (toward the side it is being driven to), the wheel's turn
  const E = ESC, a = CK.esc.dropT; let u = t - a, th;
  if (u < 0) { CK2[0] = -E.te - E.we * t; CK2[1] = E.e0 + (E.ea - E.e0) * (t / a) * (t / a); return CK2; }
  if (u < E.b) th = E.th1 - E.rho * E.we * u + 0.5 * E.acc * u * u; else { u -= E.b; th = -CK.esc.swing + 0.5 * E.acc * u * u; }
  CK2[0] = th; CK2[1] = ckTip(th); return CK2;
}
// ---- the strike work: lever, wire, hammer
function ckStrikeSetup() {
  const S = CK.strike, P = CLOCK.pivots;
  S.PL = P.lever.toArray(); S.PH = P.hammer.toArray(); S.B = P.wire.toArray();   // the lever's pin, the hammer's, the wire's lower hook (the parts' pivots: tools/clock/make.mjs)
  S.len = Math.hypot(S.T[0] - S.B[0], S.T[1] - S.B[1], S.T[2] - S.B[2]); S.dir0 = new THREE.Vector3(S.T[0] - S.B[0], S.T[1] - S.B[1], S.T[2] - S.B[2]).normalize();
  S.gear = 1.33; S.c = 2 * S.damp * Math.sqrt(S.k);
}
function ckHook(p, c, a, out) {   // a point of a part turned a about +x through its pin c
  const y = p[1] - c[1], z = p[2] - c[2], cs = Math.cos(a), sn = Math.sin(a); return out.set(p[0], c[1] + y * cs - z * sn, c[2] + y * sn + z * cs);
}
const ckSlack = (lam, eta) => ckHook(CK.strike.T, CK.strike.PH, eta, CKV.v).distanceTo(ckHook(CK.strike.B, CK.strike.PL, lam, CKV.w)) - CK.strike.len;
function ckHammerFor(lam) {   // the hammer's turn for the lever's: the wire's length kept
  let e = CK.strike.gear * lam; for (let i = 0; i < 3; i++) { const f = ckSlack(lam, e); e -= f * 1e-4 / (ckSlack(lam, e + 1e-4) - f); } return e;
}
function ckLeverFor(eta) {
  let l = eta / CK.strike.gear; for (let i = 0; i < 3; i++) { const f = ckSlack(l, eta); l -= f * 1e-4 / (ckSlack(l + 1e-4, eta) - f); } return l;
}
function ckHeld(hours) {   // where the wire holds the hammer now: the lever on the star (the hour's share gone by), or tripped by a click
  const S = CK.strike, x = (hours % 1) * 30, i = Math.min(29, Math.floor(x)); let e = ckHammerFor((S.cam[i] + (S.cam[i + 1] - S.cam[i]) * (x - i)) * D2R);
  if (CLOCK.ham.lift) {   // (by hand: lifted if it hangs low, let go as a tooth would let it go, then back to where the star has it)
    const u = (performance.now() - CLOCK.ham.lift) / 1000, rest = ckHammerFor(S.cam[0] * D2R);
    if (u < 0.45) e = Math.max(e, S.lift * ckEase(u / 0.45)); else if (u < 1.05) e = rest; else if (u < 1.85) e = rest + (e - rest) * ckEase((u - 1.05) / 0.8); else CLOCK.ham.lift = 0;
  }
  return e;
}
const ckHours = now => now.getHours() + now.getMinutes() / 60 + (now.getSeconds() + now.getMilliseconds() / 1000) / 3600;
const ckTime = () => { const T = CLOCK.t0; return T ? new Date(T.at + (performance.now() - T.from) * (T.rate || 1)) : new Date(); };   // (tests: CLOCK.t0 = { at, from, rate }, another hour at another pace)
function stepHammer() {   // the hammer about its pin: gravity, the wire holding it up (through the shaft's spring), the bell under it; true while it moves
  const H = CLOCK.ham, S = CK.strike, t = performance.now() / 1000, held = ckHeld(ckHours(ckTime())), gap = (t - H.at) * (CLOCK.t0 ? CLOCK.t0.rate || 1 : 1); H.at = t;
  if (!(gap < 0.25) || document.hidden) { H.a = held; H.v = 0; return false; }   // (the page slept: it hangs where the wire holds it, nothing struck late)
  const n = Math.max(1, Math.ceil(gap / 0.001)), h = gap / n, sag = S.g / S.k;
  for (let i = 0; i < n; i++) {
    const x = held + sag - H.a; let acc = -S.g;
    if (x > 0) acc += S.k * x - S.c * H.v;   // the wire taut
    H.v += acc * h; H.a += H.v * h;
    if (H.a < S.bell) { H.a = S.bell; if (H.v < 0) { ckBlow(-H.v); H.v *= -S.rest; } }
  }
  return Math.abs(H.a - held) > 2e-4 || Math.abs(H.v) > 2e-3;
}
function ckBlow(v) {   // the head on the bell, at v rad/s
  const ctx = CLOCK.ctx; if (v < 0.3) return; CLOCK.blows++;
  if (ctx && ctx.state === 'running') ckBell(ctx, ctx.currentTime + 0.004, 659.25, 0.16 * Math.min(1.25, 0.45 + v / 3.5));
}
function ckStrike() { if (!CLOCK.ham.lift) CLOCK.ham.lift = performance.now(); setNeeds(true); }   // the hammer tripped by hand (a click on the bell; tests)
function watchHour() {   // once a second: awake across the hour, so the hammer's fall is drawn though the page stands still
  if (!CLOCK.ok || document.hidden) return;
  const now = ckTime(), s = now.getMinutes() * 60 + now.getSeconds();
  if (s >= 3598 || s < 2) { CLOCK.wake = performance.now() + 1500; setNeeds(true); }
}
// ---- every part posed for this very moment
const ckTurn = (n, k, a) => { if (n) n.quaternion.setFromAxisAngle(CKA[k], a); };
function poseClock(now = ckTime()) {
  const N = CLOCK.nodes, S = CK.strike, E = ESC, hours = ckHours(now);
  const turn = (hours % 12) / 12 * Math.PI * 2 - CK.hand0;   // the hand's turn from where the model has it (clockwise from XII: +x)
  // the crown wheel: 512 turns to the hand's one, stepped by the escapement; the beats counted from where its teeth stand
  const b = (Math.abs(CK.ratio.crown) * turn + CK.esc.tip0 - E.mean) / E.H, B = Math.floor(b), bt = ckBeat(b - B), th = bt[0], crown = bt[1] - CK.esc.tip0 + E.H * B;
  ckTurn(N.hand, 'dial', turn); ckTurn(N.dial, 'dial', turn); ckTurn(N.star, 'dial', turn + S.star0);
  ckTurn(N.crown, 'crown', -crown); ckTurn(N.second, 'second', crown / 8); ckTurn(N.great, 'great', -crown / 64);   // (the train behind it by the same ratios: in mesh)
  ckTurn(N.verge, 'verge', (B & 1 ? -th : th) - CK.esc.mid);   // (a beat on the upper pallet, the next on the lower: the same swing the other way)
  // the hammer where its fall has it; the lever where the wire lets it be: on the star, or drawn up after the hammer
  const eta = CLOCK.ham.a, lam = ckLeverFor(Math.max(eta, ckHeld(hours)));
  ckTurn(N.lever, 'lever', lam); ckTurn(N.hammer, 'hammer', eta);
  if (N.wire) { const lo = ckHook(S.B, S.PL, lam, CKV.w), hi = ckHook(S.T, S.PH, eta, CKV.v); N.wire.position.copy(lo); N.wire.quaternion.setFromUnitVectors(S.dir0, hi.sub(lo).normalize()); }
  const P = CLOCK.pose; P.turn = turn; P.crown = crown; P.th = B & 1 ? -th : th; P.lam = lam; P.eta = eta;   // (what it shows now: for the X-ray plate beside it, clockxray.js)
}
function makeSound() { if (CLOCK.ctx) return; try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) CLOCK.ctx = new AC(); } catch (e) { /* no audio */ } }
function unlockSound() { makeSound(); if (CLOCK.ctx && CLOCK.ctx.state === 'suspended') CLOCK.ctx.resume().catch(() => {}); }
// a small bell: its partials (as a ratio of the strike note, a level, how long it rings), a short clank of the hammer
const CK_BELL = [[0.5, 0.55, 5.5], [1.0, 1.0, 4.0], [1.183, 0.45, 3.0], [1.506, 0.32, 2.4], [2.0, 0.6, 2.6], [2.514, 0.22, 1.6], [2.662, 0.18, 1.3], [3.011, 0.16, 1.1], [4.166, 0.07, 0.7]];
function ckBell(ctx, t, f0 = 659.25, vol = 0.16) {
  const out = ctx.createGain(); out.gain.value = vol; out.connect(ctx.destination);
  for (const [r, a, d] of CK_BELL) for (const det of [-0.6, 0.6]) {   // (each partial a pair a little apart: the bell's slow beating)
    const o = ctx.createOscillator(), gn = ctx.createGain(); o.frequency.value = f0 * r + det;
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(a / 2, t + 0.003); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(gn); gn.connect(out); o.start(t); o.stop(t + d + 0.05);
  }
  const len = Math.floor(ctx.sampleRate * 0.04), nb = ctx.createBuffer(1, len, ctx.sampleRate), ch = nb.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.18));
  const ns = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain(); ns.buffer = nb; bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 1.2; ng.gain.value = 0.35;
  ns.connect(bp); bp.connect(ng); ng.connect(out); ns.start(t);
}
function drawClock() {   // over the picture, sharp; posed for this very moment first (on its shelf: when it is out, drawInspect)
  if (!CLOCK.ok || CLOCK.view.k > 0.001) return;
  poseClock(); ckPlace(); CKU.uRoomDepth.value = 1;
  const PU = POST.mat.uniforms, U = CLOCK.P.quad.material.uniforms, pr = renderer.getPixelRatio();
  SHARP.u.uExp.value = PU.exposure.value; SHARP.u.uLift.value = PU.lift.value; SHARP.u.uVeil.value = PU.veil.value;
  U.uOut.value = CLOCK.out; U.uOutW.value = 2 * pr; U.uHalo.value = 1.6 * pr; U.uFade.value = 1;
  crispPass(CLOCK.P, CLOCK.box);
}
function stepClock(dt = 0.016) {   // the hammer, the outline in and out, the flight out and back, coming apart: true while any of it moves (every frame drawn)
  if (!CLOCK.ok) return false;
  const falling = stepHammer();
  const V = CLOCK.view, was = CLOCK.out + V.k * 3 + V.e * 7, to = CLOCK.hover && !V.on ? 1 : 0;
  CLOCK.out += Math.sign(to - CLOCK.out) * Math.min(Math.abs(to - CLOCK.out), dt / 0.14);
  V.k = Math.max(0, Math.min(1, V.k + (V.on ? 1 : -1) * dt / 0.85));
  const eT = V.on && V.k >= 1 ? V.eT : 0; V.e += Math.sign(eT - V.e) * Math.min(Math.abs(eT - V.e), dt / (eT > V.e ? 1.1 : 0.6));
  if (!V.on && V.e > 0) V.k = Math.max(V.k, 0.999);   // (put together before it flies back)
  if (V.on && V.k >= 1) V.held += dt;
  const amp = V.on && V.k >= 1 && !V.drag ? 0.32 * ckEase(Math.min(1, Math.max(0, (V.held - 4) / 3))) : 0;   // (left alone a while, it sways a little either way)
  if (amp > 0) V.ph += dt * Math.PI * 2 / 18; V.sway = amp * Math.sin(V.ph);
  if (!V.on && V.k <= 0 && (CLOCK.large || CLOCK.PI.rt)) { ckPicture(false); if (CLOCK.PI.rt) { CLOCK.PI.rt.dispose(); CLOCK.PI.rt = null; } }   // (back on its shelf: its large picture and target given back)
  return falling || performance.now() < CLOCK.wake || CLOCK.out + V.k * 3 + V.e * 7 !== was || (V.on && V.k >= 1);
}
// its pictures at full size while it is out (decoded again from the file), the small ones back on the shelf
async function ckPicture(big) {
  const P = CLOCK.pics; if (!P) return;
  if (!big) {
    for (const k in P) { const p = P[k], t = p.large; if (!t) continue; for (const m of p.mats) m.map = p.small; t.dispose(); if (t.image && t.image.close) t.image.close(); p.large = null; }
    CLOCK.large = null; setNeeds(true); return;
  }
  if (CLOCK.loading || Object.values(P).every(p => p.large)) return; CLOCK.loading = true;
  try {
    const buf = await clockBytes(), n = new DataView(buf).getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, n)));   // (a GLB: its JSON, then its binary part 8 bytes on)
    for (const k in P) {
      const p = P[k]; if (p.large) continue;
      const jm = json.materials.find(m => m.name === k) || json.materials[0], jt = json.textures[jm.pbrMetallicRoughness.baseColorTexture.index];
      const im = json.images[jt.extensions && jt.extensions.EXT_texture_webp ? jt.extensions.EXT_texture_webp.source : jt.source], bv = json.bufferViews[im.bufferView];
      const bmp = await createImageBitmap(new Blob([new Uint8Array(buf, 28 + n + (bv.byteOffset || 0), bv.byteLength)], { type: im.mimeType }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const t = new THREE.Texture(bmp), o = p.small; t.flipY = false; t.colorSpace = o.colorSpace; t.anisotropy = 16; t.wrapS = o.wrapS; t.wrapT = o.wrapT; t.channel = o.channel; t.needsUpdate = true;
      if (CLOCK.view.on && !p.large) { p.large = t; for (const m of p.mats) m.map = t; } else { t.dispose(); bmp.close(); }
    }
    CLOCK.large = P.clock.large; setNeeds(true);
  } catch (e) { /* the small pictures stay */ }
  CLOCK.loading = false;
}
CLOCK.strike = ckStrike; CLOCK.ESC = ESC; CLOCK.open = () => openClock(); CLOCK.close = () => closeClock();   // (tests)

// ---- out of its shelf
const CKV = { q: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3(), f: new THREE.Vector3(), r: new THREE.Vector3(), c: new THREE.Vector3(), box: new THREE.Box3(), cam: new THREE.Camera(), dim: null };
const ckLerp = (a, b, k) => a + (b - a) * k;
function ckPlace() {   // the holder's place now: on its shelf, out in front of the camera, or between (the flight)
  const V = CLOCK.view, H = CLOCK.holder, k = ckEase(V.k), N = CLOCK.nodes;
  for (const name in CK.apart) if (N[name]) N[name].position.copy(CLOCK.pivots[name]).addScaledVector(CKV.v.fromArray(CK.apart[name]), ckEase(V.e));
  if (k <= 0) { H.position.copy(CLOCK.home.pos); H.rotation.set(0, 0, 0); H.scale.setScalar(1); H.updateMatrixWorld(true); return; }
  // out: the camera's view; the whole of it (as it stands apart) in the middle of the screen right of the sidebar
  const cam = camera, f = cam.getWorldDirection(CKV.f), yawFace = Math.atan2(-f.z, f.x), s = CK.big, e = ckEase(V.e);
  const B = CKV.box.copy(CLOCK.span[0]); B.min.lerp(CLOCK.span[1].min, e); B.max.lerp(CLOCK.span[1].max, e);   // (its extent as it stands, together or apart)
  const hgt = (B.max.y - B.min.y) * s, wid = Math.max(B.max.z - B.min.z, B.max.x - B.min.x) * s;   // (turning, its width is the larger of its two)
  const th = Math.tan(cam.fov * Math.PI / 360), side = CKV.side = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 0) * (1 - k);   // (the sidebar goes while it is out: body.ck-out)
  const rp = CKV.rp = CLOCK.xray ? CLOCK.xray.room() : 0;   // (the X-ray plate's room at the right)
  const lw = CKV.lab ? [(CKV.lab[0] + 30) * e, (CKV.lab[1] + 30) * e] : [0, 0];   // (apart: room either side for its parts' names, as wide as they are: ckColumns)
  const free = Math.max(0.3, 1 - (side + rp + lw[0] + lw[1]) / innerWidth), d = Math.max(hgt / (2 * th * 0.84), wid / (2 * th * cam.aspect * free * 0.94)) + wid * 0.12;   // (a little more for its nearer side as it turns)
  const right = CKV.r.set(-f.z, 0, f.x).normalize(), shift = (side + lw[0] - rp - lw[1]) / 2 / (innerWidth / 2) * d * th * cam.aspect;
  const centre = CKV.c.copy(cam.position).addScaledVector(f, d).addScaledVector(right, shift);
  // turned so its dial looks at the camera, a quarter turn of a quarter toward its right side, and its own turn
  const yaw = yawFace + 0.3 + V.yaw + V.sway;
  H.rotation.set(0, ckLerp(0, yaw, k), 0); H.scale.setScalar(ckLerp(1, s, k));
  // its middle (as it stands apart) at that centre
  const mid = B.getCenter(CKV.w).multiplyScalar(H.scale.x).applyQuaternion(CKV.q.setFromEuler(H.rotation));
  H.position.copy(CLOCK.home.pos).lerp(centre.sub(mid), k); H.updateMatrixWorld(true);
  // its light: from above the viewer's left
  const kl = CLOCK.key, fl = CLOCK.fill; kl.intensity = 2.6 * k; fl.intensity = 1.1 * k; if (CLOCK.down) CLOCK.down.light.intensity = CLOCK.down.base * (1 - k);
  kl.position.copy(H.position).addScaledVector(right, -3).add(CKV.w.set(0, 4, 0)).addScaledVector(f, -4); kl.target.position.copy(H.position); kl.target.updateMatrixWorld();
  fl.position.copy(H.position).addScaledVector(right, 4).add(CKV.w.set(0, 1, 0)).addScaledVector(f, -2); fl.target.position.copy(H.position); fl.target.updateMatrixWorld();
}
function openClock() { const V = CLOCK.view; if (V.on) return; V.on = true; V.eT = 1; V.yaw = V.sway = V.ph = V.held = 0; CLOCK.hover = false; document.body.classList.add('ck-out'); ckPicture(true); setNeeds(true); }
function closeClock() { const V = CLOCK.view; if (!V.on) return; V.on = false; document.body.classList.remove('ck-out'); setNeeds(true); }
function toggleApart() { const V = CLOCK.view; V.eT = V.eT > 0.5 ? 0 : 1; setNeeds(true); }
function drawInspect() {   // the room dimmed, the clock over it (sharp, not hidden by the room), its labels
  if (!CLOCK.ok) return;
  const V = CLOCK.view;
  if (V.k <= 0.001) { if (V.el) V.el.classList.remove('is-on'); if (CLOCK.xray) CLOCK.xray.step(false); return; }
  poseClock(); ckPlace(); CKU.uRoomDepth.value = 0;
  if (!CKV.dim) CKV.dim = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { a: { value: 0 } }, vertexShader: QUAD_VS, fragmentShader: 'uniform float a; void main(){ gl_FragColor = vec4(0.03, 0.025, 0.02, a); }', transparent: true, depthTest: false, depthWrite: false }));
  CKV.dim.material.uniforms.a.value = 0.78 * ckEase(V.k); renderer.autoClear = false; CKV.dim.render(renderer); renderer.autoClear = true;
  const PU = POST.mat.uniforms; SHARP.u.uExp.value = Math.max(PU.exposure.value * 1.2, 0.95); SHARP.u.uLift.value = PU.lift.value; SHARP.u.uVeil.value = PU.veil.value;
  bigPass();
  SHARP.u.uExp.value = PU.exposure.value;
  ckLabels(); if (CLOCK.xray) CLOCK.xray.step(V.on && V.k >= 0.98);
}
// the clock out of its shelf into a target the size of where it is on screen, at CSS pixels at most (a large one)
function bigPass() {
  const P = CLOCK.PI, H = CLOCK.holder, W_ = OVER.u.uRes.value.x, Hh = OVER.u.uRes.value.y, pr = renderer.getPixelRatio(), B = CKV.box, m = 0.02 / H.scale.x;
  let x0 = W_, y0 = Hh, x1 = 0, y1 = 0;
  for (let i = 0; i < 8; i++) {   // (its extent now, a little round it: the foliot's swing, the hammer's lift)
    const v = CKV.v.set(i & 1 ? B.max.x + m : B.min.x - m, i & 2 ? B.max.y + m : B.min.y - m, i & 4 ? B.max.z + m * 3 : B.min.z - m * 3).applyMatrix4(H.matrixWorld).project(camera);
    if (v.z > 1 || v.z < -1) continue;
    const px = (v.x + 1) / 2 * W_, py = (v.y + 1) / 2 * Hh; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W_, Math.ceil(x1)); y1 = Math.min(Hh, Math.ceil(y1));
  const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
  const rs = Math.min(1, 1.6 / pr), tw = Math.max(2, Math.round(w * rs)), thh = Math.max(2, Math.round(h * rs));
  if (!P.rt || P.rt.width < tw || P.rt.height < thh) {
    if (P.rt) P.rt.dispose();
    P.rt = new THREE.WebGLRenderTarget(Math.ceil(tw * 1.15), Math.ceil(thh * 1.15), { samples: 2, type: THREE.HalfFloatType });
    P.quad.material.uniforms.t.value = P.rt.texture;
  }
  const cx = (x0 + x1) / W_ - 1, cy = (y0 + y1) / Hh - 1, sx = W_ / w, sy = Hh / h, C = CKV.cam; C.layers.set(CLOCK.layer);
  C.projectionMatrix.set(sx, 0, 0, -sx * cx, 0, sy, 0, -sy * cy, 0, 0, 1, 0, 0, 0, 0, 1).multiply(camera.projectionMatrix);
  C.projectionMatrixInverse.copy(C.projectionMatrix).invert(); camera.matrixWorld.decompose(C.position, C.quaternion, C.scale); C.updateMatrixWorld(true);
  const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha(), bg = scene.background; scene.background = null;
  P.rt.viewport.set(0, 0, tw, thh); P.rt.scissor.set(0, 0, tw, thh); P.rt.scissorTest = true;
  renderer.setRenderTarget(P.rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, C);
  renderer.setRenderTarget(null); renderer.setClearColor(cc, ca); scene.background = bg;
  const Q = P.quad.material.uniforms; Q.uScale.value.set(tw / P.rt.width, thh / P.rt.height); setPaint(Q, P.rt, W_, Hh);
  renderer.autoClear = false; renderer.setViewport(x0 / pr, y0 / pr, w / pr, h / pr); P.quad.render(renderer);
  renderer.setViewport(0, 0, W_ / pr, Hh / pr); renderer.autoClear = true; crispSeen(P);
  CLOCK.view.rect = [x0 / pr, (Hh - y1) / pr, x1 / pr, (Hh - y0) / pr];   // (CSS pixels: where it is, for a click on it)
}
// ---- its names, and the panel over it (the page's language)
const CK_NAMES = { hand: ['Hour hand', 'Kim giờ'], star: ['Trip star (12)', 'Bánh sao nhả búa (12 răng)'], dial: ['Hour wheel (56)', 'Bánh giờ (56 răng)'],
  great: ['Great wheel (56) and pinion (7)', 'Bánh lớn (56) và bánh nhỏ (7)'], second: ['Second wheel (56) and pinion (7)', 'Bánh giữa (56) và bánh nhỏ (7)'],
  crown: ['Crown wheel (25), the escape wheel', 'Bánh hồi vương miện (25 răng)'], verge: ['Verge with its two pallets, and the foliot', 'Trục verge hai lá gạt và thanh foliot'],
  lever: ['Trip lever', 'Cần nhả búa'], wire: ['Lifting wire', 'Dây kéo búa'], hammer: ['Hammer', 'Búa'], bell: ['Bell', 'Chuông'] };
function buildInspectUI() {
  const ui = document.getElementById('l3-ui') || document.body, el = document.createElement('div'); el.className = 'ck-out-ui ck-cols';
  el.innerHTML = '<div class="ck-head"><b><span class="en">Medieval clock</span><span class="vi">Đồng hồ trung cổ</span></b>'
    + '<small><span class="en">drag to turn · click it: apart / together · click the bell: strike · Esc to close</span><span class="vi">kéo để xoay · bấm vào: tách / ráp · bấm chuông: gõ · Esc để đóng</span></small>'
    + '<button type="button" class="ck-x" aria-label="Close">&times;</button></div>'
    + '<svg class="ck-lines" aria-hidden="true">' + Object.keys(CK_NAMES).map(k => `<g data-k="${k}"><line></line><circle r="3"></circle></g>`).join('') + '</svg>'
    + Object.keys(CK_NAMES).map(k => `<span class="ck-name" data-k="${k}"><span class="en">${CK_NAMES[k][0]}</span><span class="vi">${CK_NAMES[k][1]}</span></span>`).join('');
  ui.appendChild(el); CLOCK.view.el = el; if (CLOCK.xray) CLOCK.xray.build(el);   // (its X-ray plate, at the screen's right: clockxray.js)
  CLOCK.view.head = el.querySelector('.ck-head'); CLOCK.view.labels = [...el.querySelectorAll('.ck-name')];
  for (const lab of CLOCK.view.labels) { const g = el.querySelector(`.ck-lines g[data-k="${lab.dataset.k}"]`); lab._g = g; lab._l = g.firstChild; lab._d = g.lastChild; }
  el.querySelector('.ck-x').addEventListener('click', e => { e.stopPropagation(); closeClock(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && CLOCK.view.on) { e.stopImmediatePropagation(); closeClock(); } }, true);
}
function ckRect(k) {   // a part's box on the screen (CSS pixels), where it is now
  const n = CLOCK.nodes[k], b = CLOCK.pbox[k], r = [1e9, 1e9, -1e9, -1e9];
  for (let i = 0; i < 8; i++) {
    const v = CKV.v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).add(n.position).applyMatrix4(n.parent.matrixWorld).project(camera);
    const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight; r[0] = Math.min(r[0], x); r[1] = Math.min(r[1], y); r[2] = Math.max(r[2], x); r[3] = Math.max(r[3], y);
  }
  return r;
}
/* The names of a thing's parts in two columns, left and right of it (the clock's, the camera's): each name on the side its
   part lies and in their parts' order down the screen, a fine line from it to its part. L: the names shown, each with its
   size (_w, _h) and its part's place on the screen (_cx, _cy); the free screen x0..x1, y0..y1; the thing itself fx0..fx1
   across. Half the names go each side (one changes side only once its part is well over); a column stands just outside
   the thing where there is room, else at the screen's edge. Returns the two columns' widths (the room they want). */
function ckColumns(L, x0, y0, x1, y1, fx0, fx1) {
  const out = [0, 0]; if (!L.length) return out;
  const byX = L.slice().sort((a, b) => a._cx - b._cx), h2 = L.length >> 1, mid = (byX[Math.max(0, h2 - 1)]._cx + byX[h2]._cx) / 2;
  for (const lab of L) if (lab._s === undefined || (lab._cx - mid) * lab._s < -40) lab._s = lab._cx < mid ? -1 : 1;
  for (const s of [-1, 1]) {
    const col = L.filter(l => l._s === s).sort((a, b) => a._cy - b._cy), gap = 5, n = col.length; let y = y0;
    for (const l of col) { l._ty = Math.max(y, l._cy - l._h / 2); y = l._ty + l._h + gap; out[s < 0 ? 0 : 1] = Math.max(out[s < 0 ? 0 : 1], l._w); }   // (down the column: each as near its part's height as those above leave it)
    y = y1; for (let i = n - 1; i >= 0; i--) { const l = col[i]; l._ty = Math.min(l._ty, y - l._h); y = l._ty - gap; }   // (and none past the foot of the screen)
    for (const l of col) {
      const x = s < 0 ? Math.max(x0, fx0 - 18 - l._w) : Math.min(x1 - l._w, fx1 + 18), ty = l._ty;
      if (!l._on) { l._x = x; l._y = ty; l._on = true; } else { l._x += (x - l._x) * 0.3; l._y += (ty - l._y) * 0.3; }   // (eased to a new place)
      l.style.transform = `translate(${l._x.toFixed(1)}px, ${l._y.toFixed(1)}px)`;
      const qx = s < 0 ? l._x + l._w : l._x, qy = l._y + l._h / 2;
      l._l.setAttribute('x1', qx.toFixed(1)); l._l.setAttribute('y1', qy.toFixed(1)); l._l.setAttribute('x2', l._cx.toFixed(1)); l._l.setAttribute('y2', l._cy.toFixed(1));
      l._d.setAttribute('cx', l._cx.toFixed(1)); l._d.setAttribute('cy', l._cy.toFixed(1));
    }
  }
  return out;
}
function ckLabels() {   // each name in one of two columns beside the clock (ckColumns), a fine line from it to the part's middle
  const V = CLOCK.view; if (!V.el) return;
  V.el.classList.toggle('is-on', V.on && V.k >= 0.98);
  V.rects = {}; for (const k in CLOCK.pbox) V.rects[k] = ckRect(k);
  const show = V.e > 0.9 && V.on, L = []; let fx0 = 1e9, fx1 = -1e9;
  for (const lab of V.labels) {
    const k = lab.dataset.k, r = V.rects[k]; lab.classList.toggle('is-on', show); lab._g.classList.toggle('is-on', show); if (!show || !r) { lab._on = false; continue; }
    const n = CLOCK.nodes[k], p = CLOCK.pbox[k].getCenter(CKV.v).add(n.position).applyMatrix4(n.parent.matrixWorld).project(camera);
    lab._w = lab.offsetWidth; lab._h = lab.offsetHeight; lab._cx = (p.x + 1) / 2 * innerWidth; lab._cy = (1 - p.y) / 2 * innerHeight; fx0 = Math.min(fx0, r[0]); fx1 = Math.max(fx1, r[2]); L.push(lab);
  }
  if (!CKV.lab) { let w = 0; for (const lab of V.labels) w = Math.max(w, lab.offsetWidth); CKV.lab = [w, w]; }   // (before they are placed: the widest of them either side)
  if (L.length) CKV.lab = ckColumns(L, (CKV.side || 0) + 10, (V.head ? V.head.offsetTop + V.head.offsetHeight : 60) + 12, innerWidth - 10 - (CKV.rp || 0), innerHeight - 12, fx0, fx1);
}
// the pointer while it is out: a drag turns it, a click on its bell strikes it, elsewhere on it puts it together or apart, beside it puts it back
function inspectPointer(type, e) {
  const V = CLOCK.view; if (!V.on) return false;
  if (type === 'down') { V.yaw += V.sway; V.sway = V.ph = V.held = 0; V.drag = { x: e.clientX, y: e.clientY, yaw: V.yaw, moved: false }; }   // (its sway kept where it is)
  else if (type === 'move' && V.drag) { const dx = e.clientX - V.drag.x; if (Math.abs(dx) > 4) V.drag.moved = true; V.yaw = V.drag.yaw + dx * 0.008; V.held = 0; setNeeds(true); }
  else if (type === 'up') {
    const d = V.drag; V.drag = null;
    if (d && !d.moved && V.k >= 1) {
      const R = V.rects || {}, on = (r, m) => r && e.clientX > r[0] - m && e.clientX < r[2] + m && e.clientY > r[1] - m && e.clientY < r[3] + m;
      if (on(R.bell, 0)) ckStrike(); else if (Object.values(R).some(r => on(r, 12))) toggleApart(); else closeClock();
    }
  }
  return true;
}
// the pointer's ray against the clock on its shelf (its box, in its own frame)
const CKR = { inv: new THREE.Matrix4(), ray: new THREE.Ray(), hitP: new THREE.Vector3() };
function clockHit(ray) {
  if (!CLOCK.ok || CLOCK.view.k > 0) return false;
  CKR.inv.copy(CLOCK.holder.matrixWorld).invert(); CKR.ray.copy(ray).applyMatrix4(CKR.inv);
  const L = CLOCK.local, b = new THREE.Box3(new THREE.Vector3(L.min.x + 0.02, L.min.y, L.min.z + 0.05), new THREE.Vector3(L.max.x - 0.02, L.max.y - 0.03, L.max.z - 0.05));
  return !!CKR.ray.intersectBox(b, CKR.hitP);
}

export { CK, CLOCK, ESC, buildClock, ckBeat, ckColumns, ckTime, clockHit, closeClock, drawClock, drawInspect, inspectPointer, openClock, stepClock };
