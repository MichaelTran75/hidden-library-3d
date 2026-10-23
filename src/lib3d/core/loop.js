import '../ui/picking.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { PARTS, body, reduceMotion, setLoad } from './base.js';
import { RT_SCALE, camera, renderer, scene, setRtScale, setShadowsDirty, shadowsDirty } from './renderer.js';
import { LIGHTS } from '../world/lights.js';
import { outside } from '../world/outside.js';
import { WIND } from '../world/wind.js';
import { POST, drawLight, endFades, fadePicture, stepFade } from '../fx/post.js';
import { applyRefCamera, resize, stepCam } from './views.js';
import { booksMesh, buildDisplays, buildGarden, main, motes } from './build.js';
import { NIGHT, buildNightLights } from '../fx/night.js';
import { HOUR, applyHour, hourTarget, stepHour } from '../fx/hour.js';
import { GLASS, stepGlass } from '../fx/glass.js';
import { OVER, drawWords, milkyWayParts, sharpFading } from '../ui/words.js';
import { METEOR, buildNightSky } from '../fx/sky.js';
import { FLY, buildFireflies } from '../fx/fireflies.js';
import { buildBulbGlow, stepBulb } from '../fx/glow.js';
import { stepBooks } from '../ui/flight.js';
import { DECK, stepDeck } from '../ui/deck.js';
import { layoutOverlay, stepGlow } from '../ui/overlay.js';
import { buildInterface } from '../ui/picking.js';
import { PETS, ROOMF, SHARP, loadPets } from '../world/pets.js';
import { PLANE, buildPlane, stepPlane } from '../world/b747.js';
import { CLOCK, buildClock, stepClock } from '../world/clock.js';
import { ISS, buildIss, stepIss } from '../world/iss.js';
import { VCAM, buildCamera, stepCamera } from '../world/camera.js';
import { stepShows } from '../world/showcase.js';
import { GBOOK, PBOOK, RUGS, TBOOK, buildGardenBook, stepGardenBook } from '../world/gardenbook.js';
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
/* three.js draws the shadow maps before it counts the lights of the render they belong to, so their depth shaders take
   the lights of the scene's last render: a sharp layer drawn last (the cat's, the clock's, with lights of their own) gave
   them new shaders, made as the light changed (G, 23/10/2026: the switch to day stalled ~5 s). A render that draws nothing
   (a camera on layer 30, which the room's lights share) counts the room's lights first, each time the maps are drawn */
const LITCAM = new THREE.Camera(), LIT_RT = new THREE.WebGLRenderTarget(1, 1);
LITCAM.layers.set(30);
function roomLightsFirst() {
  if (!LITCAM.userData.n) { let n = 0; scene.traverse(o => { if (o.isLight && o.layers.isEnabled(0)) { o.layers.enable(30); n++; } }); LITCAM.userData.n = n; }
  const rt = renderer.getRenderTarget(), ac = renderer.autoClear; renderer.autoClear = false;
  renderer.setRenderTarget(LIT_RT); renderer.render(scene, LITCAM); renderer.setRenderTarget(rt); renderer.autoClear = ac;
}
function draw() {
  const t = clock.getElapsedTime(); ROOMF.n++; ROOMF.t = performance.now();
  WIND.t.value = t;
  if (motes) motes.visible = false;
  if (LIGHTS.candle) { const f = LIGHTS.candle.userData.flame; f.scale.y = 2 + Math.sin(t * 13) * .25 + Math.sin(t * 7.3) * .2; }
  if (shadowsDirty) { roomLightsFirst(); renderer.shadowMap.needsUpdate = true; setShadowsDirty(false); }
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
  const smooth = stepCam(dt) | books | stepGlow(dt) | lit | stepDeck(dt) | stepPlane(dt) | stepClock(dt) | stepCamera(dt) | stepShows(dt) | stepFade(dt) | sharpFading() | stepIss(dt) | stepGardenBook(dt) | (GLASS.face >= 0) | stepBulb(dt);      // motion that needs every frame
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
const REVEAL = { stage: 3, lit: false, done: false };   // (done: everything shown, the words in: the pointer picks things from then)   // (lit: the shaders for every state of the lights made, precompileLightStates)
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
  buildInterface(); mark('interface');
  await compileFor(scene); mark('compiled');   // (compiled while hidden: the first picture comes whole)
  // the first picture: the room's frame alone. Its shelves, furniture and books were in the shaders made above; they are
  // put by now and shown in turn, each faded in (fx/post.js fadePicture), then the garden, the sky, the models on
  // display, the animals, the shelves' pieces, and last the words (G, 20/10/2026). The loader's bar counts it all.
  for (const o of [...PARTS.shelves, ...PARTS.furniture, booksMesh]) if (o) o.visible = false; DECK.hidden = true;
  reveal(0);
  ready = true; draw(); updateOn(); startedAt = performance.now(); mark('first-draw'); setLoad(60);
  renderer.setAnimationLoop(loop);
  const t0 = performance.now(), notBefore = ms => new Promise(r => setTimeout(r, reduceMotion ? 0 : Math.max(0, t0 + ms - performance.now())));
  const show = (name, pct, fn) => { fadePicture(reduceMotion ? 0.001 : 0.55); fn(); setShadowsDirty(true); needs = true; setLoad(pct); mark('show-' + name); };
  await notBefore(450); show('shelves', 65, () => { for (const o of PARTS.shelves) o.visible = true; });
  await notBefore(950); show('furniture', 70, () => { for (const o of PARTS.furniture) o.visible = true; DECK.hidden = false; });
  await notBefore(1450); show('books', 75, () => { if (booksMesh) booksMesh.visible = true; });
  // the garden, built once the room is all there (its trees take the page's thread a while), then the sky
  await notBefore(1900);
  await buildGarden(); setLoad(79);
  if (NIGHT.day && LIGHTS.ring) NIGHT.day.ring = LIGHTS.ring.material.color.clone();   // (the far woods' own colour, before the hour tints it)
  applyHour(HOUR.e, HOUR.az);
  await compileFor(scene);
  show('garden', 82, () => reveal(1));
  buildNightSky(); buildFireflies();
  if (LIGHTS.pendant) { const P = LIGHTS.pendant; P.updateMatrixWorld(true); buildBulbGlow(P.localToWorld(P.userData.glow.position.clone())); }   // (the bulb over the sofa, glowing: fx/glow.js)
  await compileFor(OVER.skyScene, null); await compileFor(OVER.scene, null);   // (the sharp layer: drawn on the page's own canvas)
  await notBefore(2500); show('sky', 85, () => reveal(2));
  // then the decorations, in turn: the models on display (the 747, the ISS, the clock, the camera; the garden's magazine),
  // the cat and the chicken, the shelves' pieces (each fades in: pets.js crispPass uBorn, or the picture's fade)
  const warn = what => e => console.warn(what + ' unavailable', e);
  await Promise.all([buildPlane().catch(warn('747')), buildClock().catch(warn('clock')), buildIss().catch(warn('ISS')), buildCamera().catch(warn('camera')), buildGardenBook().catch(warn('garden book'))]); mark('models'); setLoad(91);
  await loadPets().catch(warn('pets')); mark('pets'); setLoad(95);
  const shelfPieces = await buildDisplays().catch(warn('shelf pieces'));
  show('displays', 98, () => { if (shelfPieces) shelfPieces.visible = true; }); mark('displays');
  // last, the words: the labels over the room, the sidebar, the sky clock and the weather line (CSS: html.l3-wait)
  await notBefore(3300); reveal(3); REVEAL.done = true; setLoad(100); needs = true;
  const letGo = () => { if (!endFades()) setTimeout(letGo, 500); }; setTimeout(letGo, 1500);   // (the last fade over (it waits while the light states' shaders are made): its pictures let go)
  // the light states' shaders once the words have faded in (made earlier, they held the page's thread and the fade jumped)
  setTimeout(() => (window.requestIdleCallback || (fn => setTimeout(fn, 500)))(() => precompileLightStates(), { timeout: 3000 }), reduceMotion ? 0 : 2200);
}
// As night falls the lights change three ways (the ceiling spots come on, the sun goes down, then the window lights go out),
// and each change needs new shaders for every lit material: compiled up front in the background (KHR_parallel_shader_
// compile), so the switch does not stall the page later. Nothing is drawn meanwhile (hold).
// shaders are compiled for the target the scene really renders into (its colour space differs from the canvas'),
// in parallel threads where the browser supports it
async function compileFor(sc, target = POST.rt, cam = camera, lit = sc) {   // (lit: the scene whose lights it is lit by)
  if (!renderer.compileAsync) return;
  renderer.setRenderTarget(target);
  try { await renderer.compileAsync(sc, cam, lit); } catch (e) { /* compiled on first use instead */ }
  renderer.setRenderTarget(null);
}
async function precompileLightStates() {
  if (!renderer.compileAsync) { REVEAL.lit = true; return; }
  const L = LIGHTS, spl = [...NIGHT.spots.map(s => s.sp), ...(L.pendant ? [L.pendant.userData.light] : [])];   // (the bulb over the sofa comes on with the ceiling spots)
  const was = { sun: L.sun.visible, rects: L.rects.map(r => r.visible), spots: spl.map(s => s.visible) };
  hold = true;
  try {
    // the models drawn sharp on their own layers too (each made its shaders as it came, for the lights of that moment
    // only), and the shadows' depth shaders, which compileAsync does not make: the map drawn once in each state, into a
    // target of a few pixels. Without them the first switch to day stalled the page while ~45 shaders were made (G,
    // 23/10/2026: "fix the lag transition from night to daytime"; 5 s in a fresh browser)
    LITCAM.userData.n = 0;   // (the room's lights counted again: all are made by now)
    const sharp = [[PETS.holder, PETS.layer], [PETS.chicken, PETS.layer], [PLANE.holder, PLANE.layer], [CLOCK.holder, CLOCK.layer], [ISS.holder, ISS.layer], [VCAM.group, VCAM.layer], [GBOOK.book, GBOOK.layer], ...[PBOOK, TBOOK, RUGS].flatMap(S => S.twins.map(t => [t, S.layer]))].filter(([o]) => o);
    const warm = new THREE.WebGLRenderTarget(4, 4, { type: POST.rt.texture.type }), mask = SHARP.cam.layers.mask;
    const casters = []; scene.traverse(o => { if (o.isMesh && o.castShadow && o.frustumCulled) casters.push(o); });
    const skins = []; if (PETS.cat) PETS.cat.traverse(o => { if (o.isSkinnedMesh && !o.castShadow) { o.castShadow = true; skins.push(o); } });   // (the cat casts only while it keeps still: its shadow's shaders made now too)   // (every caster drawn into the map, wherever the sun stands now: by night it is under the ground)
    for (const [sun, rects, spots] of [[true, true, false], [true, true, true], [false, true, true], [false, false, true]]) {
      L.sun.visible = sun; L.rects.forEach(r => { r.visible = rects; }); spl.forEach(s => { s.visible = spots; });
      await compileFor(scene);
      for (const [o, layer] of sharp) { SHARP.cam.layers.set(layer); await compileFor(o, POST.rt, SHARP.cam, scene); }
      // and each drawn once, nothing culled (a browser may finish a shader only as it is first drawn with)
      for (const [o, layer] of sharp) { const off = []; o.traverse(m => { if (m.isMesh && m.frustumCulled) { m.frustumCulled = false; off.push(m); } });
        SHARP.cam.layers.set(layer); SHARP.cam.position.copy(camera.position); SHARP.cam.quaternion.copy(camera.quaternion); SHARP.cam.projectionMatrix.copy(camera.projectionMatrix); SHARP.cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse); SHARP.cam.updateMatrixWorld(true);
        renderer.setRenderTarget(warm); renderer.render(scene, SHARP.cam); renderer.setRenderTarget(null); for (const m of off) m.frustumCulled = true; }
      for (const o of casters) o.frustumCulled = false; roomLightsFirst(); renderer.shadowMap.needsUpdate = true; renderer.setRenderTarget(warm); renderer.render(scene, camera); renderer.setRenderTarget(null); for (const o of casters) o.frustumCulled = true;
    }
    for (const [o, t] of milkyWayParts()) await compileFor(o, t, camera, o);   // (the Milky Way's, first drawn as night falls)
    for (const o of skins) o.castShadow = false; if (skins.length) PETS.shadowStill = undefined;
    SHARP.cam.layers.mask = mask; warm.dispose();
  } catch (e) { /* compiled on first use instead */ }
  L.sun.visible = was.sun; L.rects.forEach((r, i) => { r.visible = was.rects[i]; }); spl.forEach((s, i) => { s.visible = was.spots[i]; });
  setShadowsDirty(true); hold = false; needs = true; REVEAL.lit = true; mark('precompiled');
  (window.requestIdleCallback || (fn => setTimeout(fn, 300)))(() => releaseSources(), { timeout: 2000 });
}
/* Pictures the GPU holds that nothing here draws again are let go on this side once they are up (G, 19/10/2026: "em đo
   xem có thể giảm ram xuống đc ko?"; ~65 MB of the page's memory): the models' images (bitmaps, closed), the wood and
   the books' atlas (pixel arrays), canvases drawn once (shrunk to a pixel). Each is uploaded first (initTexture), so a
   part not yet seen keeps its picture on the GPU. Pictures drawn again (a book out of its shelf, its pages, the titles
   on the spines) carry userData.keep and stay; so do render targets. Nothing is uploaded again after a lost WebGL
   context. */
function releaseSources() {
  const seen = new Set(), list = [];
  const take = t => { if (!t || !t.isTexture || seen.has(t)) return; seen.add(t);
    if (t.isRenderTargetTexture || t.isDepthTexture || t.isVideoTexture || t.isCubeTexture || t.isCompressedTexture || t.isData3DTexture || t.isDataArrayTexture || t.userData.keep || !t.image) return; list.push(t); };
  const visit = o => { for (const m of [].concat(o.material || [])) { for (const v of Object.values(m)) take(v); if (m.uniforms) for (const u of Object.values(m.uniforms)) { const v = u && u.value; if (Array.isArray(v)) v.forEach(take); else take(v); } } };
  for (const sc of [scene, OVER.scene, OVER.skyScene, POST.light.scene]) if (sc) sc.traverse(visit);
  for (const t of list) { try { renderer.initTexture(t); } catch (e) { t.userData.keep = true; } }
  let freed = 0;
  for (const t of list) {
    const im = t.image, w = im.width, h = im.height; if (t.userData.keep || !w || !h) continue;
    if (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap) im.close();
    else if (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement) { im.width = im.height = 1; }
    else if (!(im.data || (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement))) continue;
    t.source.data = { width: w, height: h, data: null }; freed += w * h * 4;
  }
  RELEASED.mb = +(freed / 1048576).toFixed(1); RELEASED.n = list.length;
  releaseGeometry();
}
const RELEASED = { mb: 0, n: 0 };   // (what releaseSources let go: tools/perf/mem.cjs)
/* and the room's still things' normals, texture coordinates and colours (G, 19/10/2026: the page's memory, ~10-15 MB):
   everything on the room's layer drawn once into a 1 px target of the picture's kind with nothing culled, so all of it
   is up on the GPU, then those arrays emptied (positions and indices stay: the pointer's rays and the boxes need them;
   a ray reading an emptied attribute gets NaN, not an error). Left as they are: instanced and skinned meshes, morphs,
   what is redrawn (dynamic attributes), what is hidden or not drawn now, and every layer but the room's. */
function releaseGeometry() {
  const list = [], keep = new Map();
  scene.traverse(o => { if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.layers.mask !== 1 || o.morphTargetInfluences) return;
    let v = o.visible; for (let p = o.parent; v && p; p = p.parent) v = p.visible; if (!v) return;
    if ([].concat(o.material).some(m => !m || m.visible === false)) return; list.push(o); });
  for (const o of list) { keep.set(o, o.frustumCulled); o.frustumCulled = false; }
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  try { renderer.setRenderTarget(rt); renderer.render(scene, camera); } catch (e) { list.length = 0; }
  renderer.setRenderTarget(null); rt.dispose(); for (const [o, c] of keep) o.frustumCulled = c;
  let freed = 0; const done = new Set();
  for (const o of list) for (const n of ['normal', 'uv', 'uv1', 'color', 'tangent']) {
    const a = o.geometry.attributes[n]; if (!a || done.has(a) || a.isInterleavedBufferAttribute || a.usage !== THREE.StaticDrawUsage || !a.array || !a.array.length) continue;
    done.add(a); freed += a.array.byteLength; a.array = new a.array.constructor(0);
  }
  RELEASED.geoMb = +(freed / 1048576).toFixed(1); setNeeds(true);
}

// other modules change these through a setter (an imported binding is read-only)
function setNeeds(v) { needs = v; }
function setReady(v) { ready = v; }

export { RELEASED, REVEAL, clock, draw, hold, loop, on, ready, setNeeds, setReady, start, updateOn };
