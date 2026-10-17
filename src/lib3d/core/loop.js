import '../ui/picking.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { body, reduceMotion } from './base.js';
import { RT_SCALE, camera, renderer, scene, setRtScale, setShadowsDirty, shadowsDirty } from './renderer.js';
import { LIGHTS } from '../world/lights.js';
import { outside } from '../world/outside.js';
import { WIND } from '../world/wind.js';
import { POST, drawLight } from '../fx/post.js';
import { applyRefCamera, resize, stepCam } from './views.js';
import { buildGarden, main, motes } from './build.js';
import { NIGHT, buildNightLights } from '../fx/night.js';
import { HOUR, applyHour, hourTarget, stepHour } from '../fx/hour.js';
import { GLASS, stepGlass } from '../fx/glass.js';
import { OVER, drawWords } from '../ui/words.js';
import { METEOR, buildNightSky } from '../fx/sky.js';
import { FLY, buildFireflies } from '../fx/fireflies.js';
import { buildBulbGlow } from '../fx/glow.js';
import { stepBooks } from '../ui/flight.js';
import { DECK, stepDeck } from '../ui/deck.js';
import { layoutOverlay, stepGlow } from '../ui/overlay.js';
import { buildInterface } from '../ui/picking.js';
import { PETS, loadPets } from '../world/pets.js';
import { buildPlane, stepPlane } from '../world/b747.js';
import { CLOCK, buildClock, stepClock } from '../world/clock.js';
import { buildIss, stepIss } from '../world/iss.js';
import { RAIN, readWeather } from '../fx/rain.js';

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
  const smooth = stepCam(dt) | books | stepGlow(dt) | lit | stepDeck(dt) | stepPlane(dt) | stepClock(dt) | stepIss(dt);      // motion that needs every frame
  if (!smooth && !needs) {
    const still = reduceMotion || body.classList.contains('is-idle') || now - lastInput > STILL_AFTER;
    // the record turning or fireflies about: the sharp layer is redrawn over the last picture (fireflies at 30 a second,
    // between the room's own frames too), which costs a blit and a few points
    const live = !reduceMotion && !body.classList.contains('is-idle') && ((DECK.ok && DECK.speed > 0) || FLY.on || PETS.ok || CLOCK.ok || METEOR.on || METEOR.comet.on || RAIN.on);
    if (still || now - lastDraw < FRAME_MS - 2) {
      if (live && now - lastSharp >= (PETS.fast || METEOR.on ? 1000 / 60 : FLY.on || PETS.ok || CLOCK.ok ? SHARP_MS : FRAME_MS) - 2) { lastSharp = now; drawSharp(); }   // (animals on the move, a shooting star: 60 a second)
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
/* the room comes in by parts as the page opens (G, 17/10/2026: "phòng trước, sau đó mới đến cây, rồi mới đến trời, và
   cuối cùng là thời tiết và text"): 0 the room alone (the garden's haze behind the glass), 1 the garden (trees, shrubs,
   ground), 2 the sky (its dome; by night the stars and the moon; the room, the garden and the sky seen in the glass),
   3 the weather (rain, drops, lightning) and the words over the room (its labels; the page's weather line). The room
   is drawn as soon as it is built; the garden and the sky are built after that, each let in when it is ready and not
   before its time (start) */
const REVEAL = { stage: 3, lit: false };   // (lit: the shaders for every state of the lights made, precompileLightStates)
function reveal(stage) {
  REVEAL.stage = stage; mark('reveal' + stage);
  outside.visible = stage >= 1; if (LIGHTS.sky) LIGHTS.sky.visible = stage >= 2;
  if (stage < 2) { scene.background = (scene.background && scene.background.isColor ? scene.background : new THREE.Color()).copy(scene.fog.color); } else if (scene.background && scene.background.isColor) scene.background = null;
  if (stage >= 2) GLASS.live = true;   // (fx/glass.js: the next picture takes the room into the glass)
  document.documentElement.classList.toggle('l3-wait', stage < 3);
  setShadowsDirty(true); needs = true;
}
const mark = name => { try { performance.mark('l3-' + name); } catch (e) { /* no User Timing */ } };   // start-up marks (tools/perf/marks.cjs)
async function start() {
  await main(); mark('room');
  buildNightLights();
  const at = /[?&]at=(\d{1,2}):(\d{2})/.exec(location.search); if (at) { const d = new Date(); d.setHours(+at[1], +at[2], 0, 0); HOUR.pin = d; }
  { const t = hourTarget(); applyHour(t.e, t.az); readWeather(); applyHour(t.e, t.az); }   // (the weather if it is known: an overcast's grey light and its lamps in the first shaders made)
  resize(); applyRefCamera();
  buildInterface();
  await compileFor(scene);   // (compiled while hidden: the first picture comes whole)
  reveal(0);
  ready = true; draw(); updateOn(); startedAt = performance.now(); mark('first-draw');
  renderer.setAnimationLoop(loop);
  // then the rest, each part when it is built (its shaders made in the background) and no sooner than its time after
  // that first picture
  const t0 = performance.now(), notBefore = ms => new Promise(r => setTimeout(r, reduceMotion ? 0 : Math.max(0, t0 + ms - performance.now())));
  await buildGarden();
  if (NIGHT.day && LIGHTS.ring) NIGHT.day.ring = LIGHTS.ring.material.color.clone();   // (the far woods' own colour, before the hour tints it)
  applyHour(HOUR.e, HOUR.az);
  await compileFor(scene);
  // the cat and the chicken (it stays out of sight until the garden is in), once the garden's shaders are made: a first
  // use of one of theirs while those were still being made held a frame up to 0.4 s
  loadPets().catch(e => console.warn('pets unavailable', e));
  buildPlane().catch(e => console.warn('747 unavailable', e));
  buildClock().catch(e => console.warn('clock unavailable', e));
  buildIss().catch(e => console.warn('ISS unavailable', e));   // (the ISS over the Geography bay)   // (the medieval clock on the tall shelf)   // (the 747 on the Research shelf: built now, faded in when its shaders are made)
  await notBefore(600); reveal(1);
  buildNightSky(); buildFireflies();
  if (LIGHTS.pendant) { const P = LIGHTS.pendant; P.updateMatrixWorld(true); buildBulbGlow(P.localToWorld(P.userData.glow.position.clone())); }   // (the bulb over the sofa, glowing: fx/glow.js)
  await compileFor(OVER.skyScene, null); await compileFor(OVER.scene, null);   // (the sharp layer: drawn on the page's own canvas)
  await notBefore(1250); reveal(2);
  await notBefore(1900); reveal(3);
  (window.requestIdleCallback || (fn => setTimeout(fn, 500)))(() => precompileLightStates(), { timeout: 3000 });
}
// As night falls the lights change three ways (the ceiling spots come on, the sun goes down, then the window lights go out),
// and each change needs new shaders for every lit material: compiled up front in the background (KHR_parallel_shader_
// compile), so the switch does not stall the page later. Nothing is drawn meanwhile (hold).
// shaders are compiled for the target the scene really renders into (its colour space differs from the canvas'),
// in parallel threads where the browser supports it
async function compileFor(sc, target = POST.rt) {
  if (!renderer.compileAsync) return;
  renderer.setRenderTarget(target);
  try { await renderer.compileAsync(sc, camera); } catch (e) { /* compiled on first use instead */ }
  renderer.setRenderTarget(null);
}
async function precompileLightStates() {
  if (!renderer.compileAsync) { REVEAL.lit = true; return; }
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
  hold = false; needs = true; REVEAL.lit = true; mark('precompiled');
}

// other modules change these through a setter (an imported binding is read-only)
function setNeeds(v) { needs = v; }
function setReady(v) { ready = v; }

export { REVEAL, clock, draw, hold, loop, on, ready, setNeeds, setReady, start, updateOn };
