import './b747.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { R, tick } from '../core/base.js';
import { canvas, ctex, shrinkTexture } from '../core/utils.js';
import { camera, renderer, scene } from '../core/renderer.js';
import { room } from './room.js';
import { CLOCK_CELL, SHELF } from './shelves.js';
import { POST, QUAD_VS, setPaint } from '../fx/post.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SHARP, crispPass, crispSeen, sharpQuad } from './pets.js';
import { DECKR } from '../ui/deck.js';
import { OVER } from '../ui/words.js';
import { setNeeds } from '../core/loop.js';

/* ---------------------------------------------------------------- the medieval clock on the tall shelf
   "Ardavin's Medieval Clock. Model Completorium" by Miguel Garcia (CC BY 4.0), 68 cm tall, in two cells of the tall
   shelf made one (their board taken out: shelves.js CLOCK_CELL), drawn sharp over the painted room, not watercoloured
   (G, 17/10/2026: "phá vách giữa 2 ô, và đặt glb clock vào, và cho realtime clock + accurate gear animation and add
   Chime for every hour. (no water color for this clock)"). Its parts were measured on the model and cut from it
   (tools/clock: segment.py, make.mjs), each turning about its own axis:
   - The going train, as the model has it (its teeth counted on the model): the hour wheel (56) carries the hand and the
     12-tooth star that trips the hammer each hour; a pinion of 7 on the great wheel's arbor drives it, so that arbor
     turns 8 times in 12 hours; the great wheel (56) drives the second arbor's pinion (7), the second wheel (56) the
     crown wheel's pinion (7): the crown wheel turns 512 times in 12 hours, 42⅔ an hour. Its 25 teeth ckEscape one a
     swing pair of the foliot: a beat (a swing one way) every 1.6875 s, the half tooth it lets go each time.
   - All of it from the visitor's clock: the hand shows the local time (one turn in 12 hours, as its dial), and every
     wheel's turn is the hand's times its ratio, so the train stays in mesh. The crown wheel goes as a verge escapement
     goes: pushed on while a pallet is driven (the foliot leaving the end of its swing), a drop as the tooth escapes,
     then a little back (the recoil) as the foliot runs on against the other pallet; the train behind it moves with it,
     by the same ratios. The foliot swings ±32° about its middle.
   - Under the pointer it is outlined, as the 747 is; a click brings it out of the shelf (G, 17/10/2026: "allow to hover
     over to select the clock, and when click to the clock it will show 3D clock which 3x bigger and expose its parts"):
     it flies to the middle of the free part of the screen, three times its size, the room dimmed behind it, and comes
     apart: its hand and hour wheel out in front and to its left, the three arbors of the train to its right (the great
     wheel's, the second's, the crown wheel's), the verge and foliot up to its left, the hammer up, each named (beside
     its part, clear of the others); all of it still going, the time still right. Left alone it sways a little either
     way; dragged, it turns; a click on it puts it together or apart again; Esc, the ×, or a click beside it puts it
     back on its shelf.
   - At each hour the hammer strikes the bell as many times as the hour (one to twelve), lifted and let fall, with a
     little rebound; the sound is a small bell's (its partials: hum, prime, tierce, quint, nominal and above, each dying
     at its own rate), made in the page (Web Audio) once the visitor has touched the page (browsers allow sound only
     after that), not while the tab is hidden. */
const CLOCK = { ok: false, layer: 5, nodes: {}, pivots: {}, holder: null, root: null, box: null, ctx: null, strikes: null, lastHour: -1, hover: false, out: 0,
  local: null, home: null, key: null, fill: null, view: { on: false, k: 0, e: 0, eT: 0, yaw: 0, sway: 0, ph: 0, held: 0, drag: null, el: null, labels: null },
  P: { rt: null, quad: null, paint: 0, wash: 0, layer: 5, toneK: 1, pad: 12, outline: true },    // on its shelf (the outline under the pointer)
  PI: { rt: null, quad: null, paint: 0, wash: 0, layer: 5, toneK: 1, pad: 6 } };                // out, in front of the room
const CKU = { uRoomDepth: { value: 1 } };   // 1: hidden where the room is nearer (on its shelf); 0: out in front of it
const CK = {
  height: 0.748,                    // the clock's height in the room (m; 10 % larger than its first 0.68: G, 17/10/2026): the model is 33.35 of its units
  big: 3,                           // out of its shelf: three times that
  apart: { dial: [-6, 0, -12], great: [-5, -2, 11], second: [-5, 1, 19], crown: [-5, 4, 27], verge: [-3, 4, -14], hammer: [-1, 5, -6] },   // its parts apart (its own units: x along the arbors, the dial at −x; y up; z to its right)
  hand0: 44.27 * Math.PI / 180,     // where the model's hand points (clockwise from XII)
  verge0: -7.5 * Math.PI / 180,     // the foliot's middle (its pose in the model is 7.5° from it)
  swing: 32 * Math.PI / 180,        // the foliot's swing either side
  half: Math.PI * 2 / 25 / 2,       // the crown wheel's turn a beat: half a tooth of 25
  ratio: { dial: 1, great: -8, second: 64, crown: -512 },   // turns for one of the hand's (the sign: the sense about +x)
  hammerLift: 0.2,                  // how far the hammer is drawn back (rad), and the strike's timing (s)
  strikeGap: 1.9, lift: 0.62, fall: 0.09,
};
CLOCK.CK = CK;   // (tuning from the console: __lib3d.CLOCK.CK.apart, then CLOCK.reSpan())

async function clockBytes() {   // inline (base64) in the one-file build, a file next to the page on GitHub Pages
  const el = document.getElementById('clock-glb'); if (!el) return null;
  if (el.dataset.src) { const r = await fetch(el.dataset.src); if (!r.ok) throw new Error('clock ' + r.status); return r.arrayBuffer(); }
  if (el.textContent.trim().length > 100) return (await fetch('data:application/octet-stream;base64,' + el.textContent.trim())).arrayBuffer();
  return null;
}
async function buildClock() {
  const buf = await clockBytes(); if (!buf) return;
  const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '');
  const root = g.scene.getObjectByName('clock') || g.scene;
  const src = root.getObjectByName('static').material;
  // its own finish: the model's picture, wrought iron and old brass with a little sheen, lit by the room
  const mat = new THREE.MeshStandardMaterial({ map: src.map, roughness: 0.58, metalness: 0.35, envMapIntensity: 0.8, side: THREE.DoubleSide, fog: false });
  if (mat.map) { shrinkTexture(mat.map, 512); mat.map.anisotropy = 8; mat.map.colorSpace = THREE.SRGBColorSpace; }   // (its picture 1024 -> 512: G, 21/10/2026, the page's memory)
  mat.onBeforeCompile = sh => {   // (hidden where the room is nearer, as the animals: on its shelf only)
    sh.uniforms.uDepth = DECKR.u.uDepth; sh.uniforms.uFull = DECKR.u.uFull; sh.uniforms.uOff = DECKR.u.uOff; sh.uniforms.uRoomDepth = CKU.uRoomDepth;
    sh.fragmentShader = 'uniform sampler2D uDepth; uniform vec2 uFull, uOff; uniform float uRoomDepth;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (uRoomDepth > 0.5 && gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;');
  };
  mat.customProgramCacheKey = () => 'clock-crisp';
  root.traverse(o => { if (o.isMesh) { o.material = mat; o.layers.set(CLOCK.layer); o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } if (o.name) { CLOCK.nodes[o.name] = o; CLOCK.pivots[o.name] = o.position.clone(); } });
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
  CLOCK.pbox = {}; for (const k of ['static', ...Object.keys(CK.apart)]) if (CLOCK.nodes[k]) CLOCK.pbox[k] = ckPartBox(CLOCK.nodes[k], CK_AXIS[k]);
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
  sharpQuad(CLOCK.P); sharpQuad(CLOCK.PI); await tick();
  if (renderer.compileAsync) { SHARP.cam.layers.set(CLOCK.layer); renderer.setRenderTarget(POST.rt); try { await renderer.compileAsync(holder, SHARP.cam, scene); } catch (e) { /* compiled on first use */ } renderer.setRenderTarget(null); }
  CLOCK.lastHour = new Date().getHours(); CLOCK.ok = true; poseClock(); setNeeds(true);
  // sound only after the visitor has touched the page; the hour watched once a second
  for (const t of ['pointerdown', 'keydown', 'touchstart']) addEventListener(t, unlockSound, { capture: true, passive: true });
  setInterval(watchHour, 1000);
  buildInspectUI();
}

const CK_AXIS = { dial: 'x', great: 'x', second: 'x', crown: 'x' };   // (the wheels, about their arbors: the foliot only swings, its box as it stands)
function ckPartBox(n, ax) {
  const p = n.geometry.attributes.position, v = new THREE.Vector3(), b = new THREE.Box3(); let r = 0;
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).multiply(n.scale); b.expandByPoint(v); if (ax) r = Math.max(r, ax === 'x' ? Math.hypot(v.y, v.z) : Math.hypot(v.x, v.z)); }
  if (ax === 'x') { b.min.y = b.min.z = -r; b.max.y = b.max.z = r; } else if (ax === 'y') { b.min.x = b.min.z = -r; b.max.x = b.max.z = r; }
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

// ---- the train, from the time: the hand's angle, the crown wheel's as its escapement steps it, the rest by ratio
const ckEase = k => k * k * (3 - 2 * k);
function ckEscape(p) {   // the crown wheel's share of a beat's half tooth through the beat: on while driven, the drop, back a little
  return p < 0.6 ? 1.1 * ckEase(p / 0.6) : 1.1 - 0.1 * ckEase((p - 0.6) / 0.4);
}
function poseClock(now = new Date()) {
  const N = CLOCK.nodes;
  const hours = (now.getHours() % 12) + now.getMinutes() / 60 + (now.getSeconds() + now.getMilliseconds() / 1000) / 3600;
  const turn = hours / 12 * Math.PI * 2 - CK.hand0;                        // the hand's turn from where the model has it (clockwise from XII: +x)
  const beats = Math.abs(CK.ratio.crown) * turn / CK.half, k = Math.floor(beats), p = beats - k;
  const crown = (k + ckEscape(p)) * CK.half;                                 // the crown wheel's turn from the model's pose, stepped (in its own sense)
  if (N.dial) N.dial.rotation.x = turn;   // (every wheel turned from the model's pose by the same ratios: its teeth stay in mesh)
  if (N.crown) N.crown.rotation.x = -crown;
  if (N.second) N.second.rotation.x = crown / 8;
  if (N.great) N.great.rotation.x = -crown / 64;
  if (N.verge) N.verge.rotation.y = CK.verge0 + CK.swing * Math.cos(Math.PI * beats);   // (at an end of its swing as each beat begins)
  if (N.hammer) N.hammer.rotation.x = hammerAngle(performance.now() / 1000);
}
// ---- the hour struck
function watchHour() {
  if (!CLOCK.ok) return;
  const now = new Date(), h = now.getHours();
  if (h === CLOCK.lastHour) return;
  CLOCK.lastHour = h;
  if (document.hidden || now.getMinutes() !== 0 || now.getSeconds() > 20) return;   // (missed while hidden: not struck late)
  ckStrike(h % 12 || 12);
}
function ckStrike(n) {   // n blows: each drawn back, let fall onto the bell, a little rebound
  const t0 = performance.now() / 1000 + 0.3;
  CLOCK.strikes = { t0, n, end: t0 + (n - 1) * CK.strikeGap + CK.lift + CK.fall + 0.6 };
  const ctx = CLOCK.ctx;
  if (ctx && ctx.state === 'running') {   // (the blows' sound, set on the audio clock now)
    const at = ctx.currentTime + 0.3;
    for (let i = 0; i < n; i++) ckBell(ctx, at + i * CK.strikeGap + CK.lift + CK.fall);
  }
  setNeeds(true);
}
function hammerAngle(t) {
  const S = CLOCK.strikes; if (!S) return 0;
  if (t > S.end) { CLOCK.strikes = null; return 0; }
  const u = t - S.t0; if (u < 0) return 0;
  const i = Math.min(S.n - 1, Math.floor(u / CK.strikeGap)), v = u - i * CK.strikeGap;
  if (v < CK.lift) return CK.hammerLift * ckEase(v / CK.lift);                               // drawn back
  if (v < CK.lift + CK.fall) return CK.hammerLift * (1 - (v - CK.lift) / CK.fall) ** 2;     // falling
  const w = v - CK.lift - CK.fall;                                                          // a rebound, dying
  return w < 0.6 ? 0.035 * Math.sin(Math.PI * Math.min(1, w / 0.22)) * Math.exp(-w * 5) : 0;
}
function unlockSound() {
  if (CLOCK.ctx) { if (CLOCK.ctx.state === 'suspended') CLOCK.ctx.resume().catch(() => {}); return; }
  try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { CLOCK.ctx = new AC(); CLOCK.ctx.resume().catch(() => {}); } } catch (e) { /* no audio */ }
}
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
function stepClock(dt = 0.016) {   // the outline in and out, the flight out and back, coming apart: true while any of it moves (every frame drawn)
  if (!CLOCK.ok) return false;
  const V = CLOCK.view, was = CLOCK.out + V.k * 3 + V.e * 7, to = CLOCK.hover && !V.on ? 1 : 0;
  CLOCK.out += Math.sign(to - CLOCK.out) * Math.min(Math.abs(to - CLOCK.out), dt / 0.14);
  V.k = Math.max(0, Math.min(1, V.k + (V.on ? 1 : -1) * dt / 0.85));
  const eT = V.on && V.k >= 1 ? V.eT : 0; V.e += Math.sign(eT - V.e) * Math.min(Math.abs(eT - V.e), dt / (eT > V.e ? 1.1 : 0.6));
  if (!V.on && V.e > 0) V.k = Math.max(V.k, 0.999);   // (put together before it flies back)
  if (V.on && V.k >= 1) V.held += dt;
  const amp = V.on && V.k >= 1 && !V.drag ? 0.32 * ckEase(Math.min(1, Math.max(0, (V.held - 4) / 3))) : 0;   // (left alone a while, it sways a little either way)
  if (amp > 0) V.ph += dt * Math.PI * 2 / 18; V.sway = amp * Math.sin(V.ph);
  return !!CLOCK.strikes || CLOCK.out + V.k * 3 + V.e * 7 !== was || (V.on && V.k >= 1);
}
CLOCK.strike = n => ckStrike(n);   // (tests: the hour struck now)

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
  const th = Math.tan(cam.fov * Math.PI / 360), side = CKV.side = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 0;
  const free = Math.max(0.4, 1 - side / innerWidth), d = Math.max(hgt / (2 * th * 0.84), wid / (2 * th * cam.aspect * free * 0.94)) + wid * 0.12;   // (a little more for its nearer side as it turns)
  const right = CKV.r.set(-f.z, 0, f.x).normalize(), shift = side / 2 / (innerWidth / 2) * d * th * cam.aspect;
  const centre = CKV.c.copy(cam.position).addScaledVector(f, d).addScaledVector(right, shift);
  // turned so its dial looks at the camera, a quarter turn of a quarter toward its right side, and its own turn
  const yaw = yawFace + 0.3 + V.yaw + V.sway;
  H.rotation.set(0, ckLerp(0, yaw, k), 0); H.scale.setScalar(ckLerp(1, s, k));
  // its middle (as it stands apart) at that centre
  const mid = B.getCenter(CKV.w).multiplyScalar(H.scale.x).applyQuaternion(CKV.q.setFromEuler(H.rotation));
  H.position.copy(CLOCK.home.pos).lerp(centre.sub(mid), k); H.updateMatrixWorld(true);
  // its light: from above the viewer's left
  const kl = CLOCK.key, fl = CLOCK.fill; kl.intensity = 2.6 * k; fl.intensity = 1.1 * k;
  kl.position.copy(H.position).addScaledVector(right, -3).add(CKV.w.set(0, 4, 0)).addScaledVector(f, -4); kl.target.position.copy(H.position); kl.target.updateMatrixWorld();
  fl.position.copy(H.position).addScaledVector(right, 4).add(CKV.w.set(0, 1, 0)).addScaledVector(f, -2); fl.target.position.copy(H.position); fl.target.updateMatrixWorld();
}
function openClock() { const V = CLOCK.view; if (V.on) return; V.on = true; V.eT = 1; V.yaw = V.sway = V.ph = V.held = 0; CLOCK.hover = false; document.body.classList.add('ck-out'); setNeeds(true); }
function closeClock() { const V = CLOCK.view; if (!V.on) return; V.on = false; document.body.classList.remove('ck-out'); setNeeds(true); }
function toggleApart() { const V = CLOCK.view; V.eT = V.eT > 0.5 ? 0 : 1; setNeeds(true); }
function drawInspect() {   // the room dimmed, the clock over it (sharp, not hidden by the room), its labels
  if (!CLOCK.ok) return;
  const V = CLOCK.view;
  if (V.k <= 0.001) { if (V.el) V.el.classList.remove('is-on'); return; }
  poseClock(); ckPlace(); CKU.uRoomDepth.value = 0;
  if (!CKV.dim) CKV.dim = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { a: { value: 0 } }, vertexShader: QUAD_VS, fragmentShader: 'uniform float a; void main(){ gl_FragColor = vec4(0.03, 0.025, 0.02, a); }', transparent: true, depthTest: false, depthWrite: false }));
  CKV.dim.material.uniforms.a.value = 0.78 * ckEase(V.k); renderer.autoClear = false; CKV.dim.render(renderer); renderer.autoClear = true;
  const PU = POST.mat.uniforms; SHARP.u.uExp.value = Math.max(PU.exposure.value * 1.2, 0.95); SHARP.u.uLift.value = PU.lift.value; SHARP.u.uVeil.value = PU.veil.value;
  bigPass();
  SHARP.u.uExp.value = PU.exposure.value;
  ckLabels();
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
  const rs = Math.min(1, 1.25 / pr), tw = Math.max(2, Math.round(w * rs)), thh = Math.max(2, Math.round(h * rs));
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
const CK_NAMES = { dial: ['Hand, trip star and hour wheel (56)', 'Kim, bánh sao và bánh giờ (56 răng)'], great: ['Great wheel (56) and pinion (7)', 'Bánh lớn (56) và bánh nhỏ (7)'],
  second: ['Second wheel (56) and pinion (7)', 'Bánh giữa (56) và bánh nhỏ (7)'], crown: ['Crown wheel (25), the escape wheel', 'Bánh hồi vương miện (25 răng)'],
  verge: ['Verge and foliot', 'Trục verge và foliot'], hammer: ['Hammer', 'Búa gõ chuông'] };
function buildInspectUI() {
  const ui = document.getElementById('l3-ui') || document.body, el = document.createElement('div'); el.className = 'ck-out-ui';
  el.innerHTML = '<div class="ck-head"><b><span class="en">Medieval clock</span><span class="vi">Đồng hồ trung cổ</span></b>'
    + '<small><span class="en">drag to turn · click it: apart / together · Esc to close</span><span class="vi">kéo để xoay · bấm vào: tách / ráp · Esc để đóng</span></small>'
    + '<button type="button" class="ck-x" aria-label="Close">&times;</button></div>'
    + '<svg class="ck-lines" aria-hidden="true">' + Object.keys(CK_NAMES).map(k => `<g data-k="${k}"><line></line><circle r="3"></circle></g>`).join('') + '</svg>'
    + Object.keys(CK_NAMES).map(k => `<span class="ck-name" data-k="${k}"><span class="en">${CK_NAMES[k][0]}</span><span class="vi">${CK_NAMES[k][1]}</span></span>`).join('');
  ui.appendChild(el); CLOCK.view.el = el; CLOCK.view.head = el.querySelector('.ck-head'); CLOCK.view.labels = [...el.querySelectorAll('.ck-name')];
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
const ckOver = (x, y, w, h, r) => Math.max(0, Math.min(x + w, r[2]) - Math.max(x, r[0])) * Math.max(0, Math.min(y + h, r[3]) - Math.max(y, r[1]));
function ckLabels() {   // each name beside its part (above it, right, below or left: whichever is clear of the others' names, the parts, the screen's
                        // edges), a fine line from it to the part's pivot
  const V = CLOCK.view; if (!V.el) return;
  V.el.classList.toggle('is-on', V.on && V.k >= 0.98);
  V.rects = {}; for (const k in CLOCK.pbox) V.rects[k] = ckRect(k);
  const show = V.e > 0.9 && V.on, free = [(CKV.side || 0) + 8, V.head ? V.head.offsetTop + V.head.offsetHeight + 8 : 70, innerWidth - 8, innerHeight - 8], placed = [];
  for (const lab of V.labels) {
    const k = lab.dataset.k, r = V.rects[k]; lab.classList.toggle('is-on', show); lab._g.classList.toggle('is-on', show); if (!show || !r) { lab._on = false; continue; }
    const w = lab.offsetWidth, h = lab.offsetHeight, cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, g = 8, A = w * h;
    const at = [[cx - w / 2, r[1] - g - h], [r[2] + g, cy - h / 2], [cx - w / 2, r[3] + g], [r[0] - g - w, cy - h / 2]];
    let best = 0, bs = Infinity;
    at.forEach(([x, y], i) => {
      let sc = i * 0.05 * A - (i === lab._c ? 0.25 * A : 0) + 6 * (A - ckOver(x, y, w, h, free));
      for (const q of placed) sc += 4 * ckOver(x, y, w, h, q);
      for (const o in V.rects) if (o !== k) sc += (o === 'static' ? 0.4 : 1) * ckOver(x, y, w, h, V.rects[o]);
      if (sc < bs) { bs = sc; best = i; }
    });
    lab._c = best;
    const x = Math.min(Math.max(at[best][0], free[0]), free[2] - w), y = Math.min(Math.max(at[best][1], free[1]), free[3] - h); placed.push([x, y, x + w, y + h]);
    if (!lab._on) { lab._x = x; lab._y = y; lab._on = true; } else { lab._x += (x - lab._x) * 0.3; lab._y += (y - lab._y) * 0.3; }   // (eased to a new place)
    lab.style.transform = `translate(${lab._x.toFixed(1)}px, ${lab._y.toFixed(1)}px)`;
    const n = CLOCK.nodes[k], p = CKV.v.copy(n.position).applyMatrix4(n.parent.matrixWorld).project(camera), px = (p.x + 1) / 2 * innerWidth, py = (1 - p.y) / 2 * innerHeight;
    const qx = Math.min(Math.max(px, lab._x + h / 2), lab._x + w - h / 2), qy = Math.min(Math.max(py, lab._y), lab._y + h);   // (from the name's nearest edge)
    lab._l.setAttribute('x1', qx.toFixed(1)); lab._l.setAttribute('y1', qy.toFixed(1)); lab._l.setAttribute('x2', px.toFixed(1)); lab._l.setAttribute('y2', py.toFixed(1));
    lab._d.setAttribute('cx', px.toFixed(1)); lab._d.setAttribute('cy', py.toFixed(1));
  }
}
// the pointer while it is out: a drag turns it, a click on it puts it together or apart, beside it puts it back
function inspectPointer(type, e) {
  const V = CLOCK.view; if (!V.on) return false;
  if (type === 'down') { V.yaw += V.sway; V.sway = V.ph = V.held = 0; V.drag = { x: e.clientX, y: e.clientY, yaw: V.yaw, moved: false }; }   // (its sway kept where it is)
  else if (type === 'move' && V.drag) { const dx = e.clientX - V.drag.x; if (Math.abs(dx) > 4) V.drag.moved = true; V.yaw = V.drag.yaw + dx * 0.008; V.held = 0; setNeeds(true); }
  else if (type === 'up') {
    const d = V.drag; V.drag = null;
    if (d && !d.moved && V.k >= 1) { const on = Object.values(V.rects || {}).some(r => r && e.clientX > r[0] - 12 && e.clientX < r[2] + 12 && e.clientY > r[1] - 12 && e.clientY < r[3] + 12); if (on) toggleApart(); else closeClock(); }
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

export { CLOCK, buildClock, clockHit, closeClock, drawClock, drawInspect, inspectPointer, openClock, stepClock };
