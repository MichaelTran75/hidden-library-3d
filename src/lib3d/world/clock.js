import './b747.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { R, tick } from '../core/base.js';
import { canvas, ctex } from '../core/utils.js';
import { renderer, scene } from '../core/renderer.js';
import { room } from './room.js';
import { CLOCK_CELL, SHELF } from './shelves.js';
import { POST } from '../fx/post.js';
import { SHARP, crispPass, crispPatch, sharpQuad } from './pets.js';
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
   - At each hour the hammer strikes the bell as many times as the hour (one to twelve), lifted and let fall, with a
     little rebound; the sound is a small bell's (its partials: hum, prime, tierce, quint, nominal and above, each dying
     at its own rate), made in the page (Web Audio) once the visitor has touched the page (browsers allow sound only
     after that), not while the tab is hidden. */
const CLOCK = { ok: false, layer: 5, nodes: {}, holder: null, box: null, ctx: null, strikes: null, lastHour: -1, armed: false,
  P: { rt: null, quad: null, paint: 0, wash: 0, layer: 5, toneK: 1, pad: 8 } };
const CK = {
  height: 0.68,                     // the clock's height in the room (m): the model is 33.35 of its units
  hand0: 44.27 * Math.PI / 180,     // where the model's hand points (clockwise from XII)
  verge0: -7.5 * Math.PI / 180,     // the foliot's middle (its pose in the model is 7.5° from it)
  swing: 32 * Math.PI / 180,        // the foliot's swing either side
  half: Math.PI * 2 / 25 / 2,       // the crown wheel's turn a beat: half a tooth of 25
  ratio: { dial: 1, great: -8, second: 64, crown: -512 },   // turns for one of the hand's (the sign: the sense about +x)
  hammerLift: 0.2,                  // how far the hammer is drawn back (rad), and the strike's timing (s)
  strikeGap: 1.9, lift: 0.62, fall: 0.09,
};

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
  if (mat.map) { mat.map.anisotropy = 8; mat.map.colorSpace = THREE.SRGBColorSpace; }
  mat.onBeforeCompile = crispPatch;   // (hidden where the room is nearer, as the animals)
  root.traverse(o => { if (o.isMesh) { o.material = mat; o.layers.set(CLOCK.layer); o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } if (o.name) CLOCK.nodes[o.name] = o; });
  // in the cell: its dial to the room (−x), its base on the lower board, its frame in the middle of the cell's width
  const S = SHELF.R, s = CK.height / 33.35, zc = S.z0 + (CLOCK_CELL.i + 0.5) * S.cw, y0 = 0.1 + CLOCK_CELL.j * S.rh + S.th / 2;
  const holder = new THREE.Group(); holder.add(root); root.scale.setScalar(s);
  root.position.set(0, -0.1 * s, 0);   // (its base's underside at the holder's origin)
  holder.position.set(R.xS + 0.02 + 6.45 * s, y0, zc + 0.3 * s);   // (the hand's nut 2 cm inside the shelf's face; the frame's middle, at −0.3 of its z, at the cell's)
  CLOCK.holder = holder; scene.add(holder); holder.updateMatrixWorld(true);
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
  sharpQuad(CLOCK.P); await tick();
  if (renderer.compileAsync) { SHARP.cam.layers.set(CLOCK.layer); renderer.setRenderTarget(POST.rt); try { await renderer.compileAsync(holder, SHARP.cam, scene); } catch (e) { /* compiled on first use */ } renderer.setRenderTarget(null); }
  CLOCK.lastHour = new Date().getHours(); CLOCK.ok = true; poseClock(); setNeeds(true);
  // sound only after the visitor has touched the page; the hour watched once a second
  for (const t of ['pointerdown', 'keydown', 'touchstart']) addEventListener(t, unlockSound, { capture: true, passive: true });
  setInterval(watchHour, 1000);
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
function drawClock() {   // over the picture, sharp; posed for this very moment first
  if (!CLOCK.ok) return;
  poseClock(); CLOCK.holder.updateMatrixWorld(true);
  const PU = POST.mat.uniforms; SHARP.u.uExp.value = PU.exposure.value; SHARP.u.uLift.value = PU.lift.value; SHARP.u.uVeil.value = PU.veil.value;
  crispPass(CLOCK.P, CLOCK.box);
}
function stepClock() { return !!(CLOCK.ok && CLOCK.strikes); }   // (the hammer at work: every frame drawn)
CLOCK.strike = n => ckStrike(n);   // (tests: the hour struck now)

export { CLOCK, buildClock, drawClock, stepClock };
