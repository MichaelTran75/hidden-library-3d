import '../ui/picking.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { body, reduceMotion } from './base.js';
import { RT_SCALE, camera, renderer, scene, setRtScale, setShadowsDirty, shadowsDirty } from './renderer.js';
import { LIGHTS } from '../world/lights.js';
import { WIND } from '../world/wind.js';
import { POST, drawLight } from '../fx/post.js';
import { applyRefCamera, resize, stepCam } from './views.js';
import { main, motes } from './build.js';
import { NIGHT, buildNightLights } from '../fx/night.js';
import { HOUR, applyHour, hourTarget, stepHour } from '../fx/hour.js';
import { stepGlass } from '../fx/glass.js';
import { drawWords } from '../ui/words.js';
import { METEOR, buildNightSky } from '../fx/sky.js';
import { FLY, buildFireflies } from '../fx/fireflies.js';
import { stepBooks } from '../ui/flight.js';
import { DECK, stepDeck } from '../ui/deck.js';
import { layoutOverlay, stepGlow } from '../ui/overlay.js';
import { buildInterface } from '../ui/picking.js';
import { PETS, loadPets } from '../world/pets.js';
import { RAIN } from '../fx/rain.js';

/* ---------------------------------------------------------------- render loop */
const clock = new THREE.Clock();
// While something moves (camera, a book, a glow, the night falling) every frame is drawn. At rest only small things
// stir (the trees, a candle, clouds, the stars): they are drawn 15 times a second for a few seconds after the visitor
// last moved or typed, then the room holds still as a picture until the next touch; nothing is drawn meanwhile.
const FRAME_MS = 1000 / 15, STILL_AFTER = 6000;
let lastInput = performance.now(), hold = false, startedAt = Infinity;
for (const t of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart']) addEventListener(t, () => { lastInput = performance.now(); }, { capture: true, passive: true });
let ready = false, on = false, needs = true, lastDraw = 0, lastSharp = 0, lastTick = 0;
const SHARP_MS = 1000 / 30;
function wanted() { return ready && innerWidth > 768; }
function updateOn() {
  const w = wanted(); if (w === on) return;
  on = w; needs = true; body.classList.toggle('lib3d-on', on);
}
function draw() {
  const t = clock.getElapsedTime();
  WIND.t.value = t;
  if (motes) motes.visible = false;
  if (LIGHTS.candle) { const f = LIGHTS.candle.userData.flame; f.scale.y = 2 + Math.sin(t * 13) * .25 + Math.sin(t * 7.3) * .2; }
  if (shadowsDirty) { renderer.shadowMap.needsUpdate = true; setShadowsDirty(false); }
  stepGlass();   // (the room seen again in the glass if its light has changed)
  renderer.setRenderTarget(POST.rt); renderer.render(scene, camera); drawLight(camera);   // (and the parts painted lightly: post.js)
  POST.toneQuad.material.uniforms.tColor.value = POST.rt.texture; renderer.setRenderTarget(POST.tone); POST.toneQuad.render(renderer);
  const U = POST.mat.uniforms; U.tDepth.value = POST.rt.depthTexture; U.near.value = camera.near; U.far.value = camera.far;
  U.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);   // (the floor's lighter wash: post.js)
  renderer.setRenderTarget(POST.out); POST.quad.render(renderer); renderer.setRenderTarget(null); POST.blit.render(renderer);
  drawWords();
  layoutOverlay();
}
function drawSharp() { renderer.setRenderTarget(null); POST.blit.render(renderer); drawWords(); }   // the last picture, the sharp layer anew
function loop(now) {
  const dt = THREE.MathUtils.clamp((now - (lastTick || now)) / 1000, 0, 0.1); lastTick = now;
  if (!ready || hold || !innerWidth || !innerHeight || document.hidden) return;
  const lit = stepHour(dt);
  if (!on) return;
  const t = clock.getElapsedTime();
  const books = stepBooks(dt, t); if (books) setShadowsDirty(true);
  const smooth = stepCam(dt) | books | stepGlow(dt) | lit | stepDeck(dt);      // motion that needs every frame
  if (!smooth && !needs) {
    const still = reduceMotion || body.classList.contains('is-idle') || now - lastInput > STILL_AFTER;
    // the record turning or fireflies about: the sharp layer is redrawn over the last picture (fireflies at 30 a second,
    // between the room's own frames too), which costs a blit and a few points
    const live = !reduceMotion && !body.classList.contains('is-idle') && ((DECK.ok && DECK.speed > 0) || FLY.on || PETS.ok || METEOR.on || METEOR.comet.on || RAIN.on);
    if (still || now - lastDraw < FRAME_MS - 2) {
      if (live && now - lastSharp >= (PETS.fast || METEOR.on ? 1000 / 60 : FLY.on || PETS.ok ? SHARP_MS : FRAME_MS) - 2) { lastSharp = now; drawSharp(); }   // (animals on the move, a shooting star: 60 a second)
      return;
    }
  }
  lastDraw = lastSharp = now; needs = false; draw(); adaptQuality(now, smooth);
}
// While things move every frame is drawn; if those frames keep coming slower than ~40 a second (a weaker GPU), the scene
// picture steps down to 65 %, then 50 % of the CSS size (the watercolour pass hides most of the difference; titles,
// stars and the moon stay sharp), and the choice is remembered for the next visit.
const PERF = { last: 0, gaps: [], slow: 0 };
function adaptQuality(now, smooth) {
  if (!smooth) { PERF.last = 0; return; }
  if (PERF.last && now - startedAt > 4000) { const g = now - PERF.last; if (g < 250) PERF.gaps.push(g); }
  PERF.last = now;
  if (PERF.gaps.length < 45) return;
  const median = PERF.gaps.sort((a, b) => a - b)[22]; PERF.gaps.length = 0;
  PERF.slow = median > 28 ? PERF.slow + 1 : 0;   // two slow stretches in a row: not a passing hiccup
  if (PERF.slow >= 2 && RT_SCALE > 0.5) {
    PERF.slow = 0;
    setRtScale(RT_SCALE > 0.7 ? 0.65 : 0.5); resize(); needs = true;
    try { localStorage.setItem('hiddenLibrary.lib3dScale', JSON.stringify({ s: RT_SCALE, t: Date.now() })); } catch (e) { /* storage blocked */ }
  }
}
async function start() {
  await main();
  buildNightLights(); buildNightSky(); buildFireflies();
  const at = /[?&]at=(\d{1,2}):(\d{2})/.exec(location.search); if (at) { const d = new Date(); d.setHours(+at[1], +at[2], 0, 0); HOUR.pin = d; }
  { const t = hourTarget(); applyHour(t.e, t.az); }
  resize(); applyRefCamera();
  buildInterface();
  await compileFor(scene);
  ready = true; draw(); updateOn(); startedAt = performance.now();
  renderer.setAnimationLoop(loop);
  loadPets().catch(e => console.warn('pets unavailable', e));   // the cat and the chicken, once the room shows
  (window.requestIdleCallback || (fn => setTimeout(fn, 500)))(() => precompileLightStates(), { timeout: 3000 });
}
// As night falls the lights change three ways (the ceiling spots come on, the sun goes down, then the window lights go out),
// and each change needs new shaders for every lit material: compiled up front in the background (KHR_parallel_shader_
// compile), so the switch does not stall the page later. Nothing is drawn meanwhile (hold).
// shaders are compiled for the target the scene really renders into (its colour space differs from the canvas'),
// in parallel threads where the browser supports it
async function compileFor(sc) {
  if (!renderer.compileAsync) return;
  renderer.setRenderTarget(POST.rt);
  try { await renderer.compileAsync(sc, camera); } catch (e) { /* compiled on first use instead */ }
  renderer.setRenderTarget(null);
}
async function precompileLightStates() {
  if (!renderer.compileAsync) return;
  const L = LIGHTS, spl = [...NIGHT.spots.map(s => s.sp), ...(L.pendant ? [L.pendant.userData.light] : [])];   // (the bulb over the sofa comes on with the ceiling spots)
  const was = { sun: L.sun.visible, rects: L.rects.map(r => r.visible), spots: spl.map(s => s.visible) };
  hold = true;
  try {
    for (const [sun, rects, spots] of [[true, true, false], [true, true, true], [false, true, true], [false, false, true]]) {
      L.sun.visible = sun; L.rects.forEach(r => { r.visible = rects; }); spl.forEach(s => { s.visible = spots; });
      await compileFor(scene);
    }
  } catch (e) { /* compiled on first use instead */ }
  L.sun.visible = was.sun; L.rects.forEach((r, i) => { r.visible = was.rects[i]; }); spl.forEach((s, i) => { s.visible = was.spots[i]; });
  hold = false; needs = true;
}

// other modules change these through a setter (an imported binding is read-only)
function setNeeds(v) { needs = v; }
function setReady(v) { ready = v; }

export { clock, draw, hold, loop, on, ready, setNeeds, setReady, start, updateOn };
