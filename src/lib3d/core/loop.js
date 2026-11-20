import '../ui/picking.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { LOAD, PARTS, body, fetchAhead, reduceMotion, setLoad } from './base.js';
import { KNOWN, RT_SCALE, RT_STEPS, WARM, camera, gpuIdle, knowPrograms, prime, renderer, scene, setRtScale, setShadowsDirty, shadowsDirty } from './renderer.js';
import { LIGHTS } from '../world/lights.js';
import { outside } from '../world/outside.js';
import { WIND } from '../world/wind.js';
import { stepSoftPress } from '../world/velvet.js';
import { DOF, POST, drawAO, drawDof, drawLight, endFades, fadePicture, paintOutdoorsOnly, postSteps, setFocus, stepFade } from '../fx/post.js';
import { applyRefCamera, resize, stepCam } from './views.js';
import { booksMesh, buildDisplays, buildGarden, main, motes } from './build.js';
import { HERO } from '../ui/hero-books.js';
import { NIGHT, buildNightLights } from '../fx/night.js';
import { HOUR, applyHour, hourState, hourTarget, stepHour, sunPlace } from '../fx/hour.js';
import { GLASS, stepGlass, warmGlass } from '../fx/glass.js';
import { OVER, drawWords, milkyWayParts, sharpFading, spineShaderPart, warmSpines } from '../ui/words.js';
import { METEOR, buildNightSky } from '../fx/sky.js';
import { FLY, buildFireflies } from '../fx/fireflies.js';
import { buildBulbGlow, buildLampBeam, stepBulb } from '../fx/glow.js';
import { stepPlant } from '../world/furniture.js';
import { stepBooks } from '../ui/flight.js';
import { DECK, DECKR, stepDeck } from '../ui/deck.js';
import { layoutOverlay, stepGlow } from '../ui/overlay.js';
import { buildInterface } from '../ui/picking.js';
import { PETS, ROOMF, SHARP, loadPets } from '../world/pets.js';
import { PLANE, buildPlane, stepPlane } from '../world/b747.js';
import { CLOCK, buildClock, stepClock } from '../world/clock.js';
import { ISS, buildIss, stepIss } from '../world/iss.js';
import { VCAM, buildCamera, stepCamera } from '../world/camera.js';
import { SHOWS, stepShows } from '../world/showcase.js';
import { GBOOK, PBOOK, RUGS, TBOOK, buildGardenBook, stepGardenBook } from '../world/gardenbook.js';
import { RAIN, WX, readWeather } from '../fx/rain.js';

/* ---------------------------------------------------------------- render loop */
const clock = new THREE.Clock();
// While something moves (camera, a book, a glow, the night falling) every frame is drawn. At rest only small things
// stir (the trees, a candle, clouds, the stars): they are drawn 15 times a second for a few seconds after the visitor
// last moved or typed, then the room holds still as a picture until the next touch; nothing is drawn meanwhile.
const FRAME_MS = 1000 / 15, STILL_AFTER = 6000;
let lastInput = performance.now(), lastFlight = 0, hold = false, startedAt = Infinity;   // (lastFlight: when something last moved of itself: a flight of the camera, a fade, a book)
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
   them new shaders, made as the light changed (the switch to day stalled ~5 s). A render that draws nothing
   (a camera on layer 30, which the room's lights share) counts the room's lights first, each time the maps are drawn */
const LITCAM = new THREE.Camera(), LIT_RT = new THREE.WebGLRenderTarget(1, 1);
LITCAM.layers.set(30);
function roomLightsFirst() {
  if (!LITCAM.userData.n) { let n = 0; scene.traverse(o => { if (o.isLight && o.layers.isEnabled(0)) { o.layers.enable(30); n++; } }); LITCAM.userData.n = n; }
  const rt = renderer.getRenderTarget(), ac = renderer.autoClear; renderer.autoClear = false;
  renderer.setRenderTarget(LIT_RT); renderer.render(scene, LITCAM); renderer.setRenderTarget(rt); renderer.autoClear = ac;
}
/* What is about to be let in, drawn once unseen into a few pixels of the picture's kind of target: the GPU finishes a
   shader for the screen only as it is first drawn with (on a first visit 2-4 s for a part of the room), and done under
   the part's fade that held every picture of the fade back: the part popped in. peek shows the part and hands back how
   to hide it again, all inside this one step. */
let WARM_RT = null;
function warmPicture(peek, more) {
  if (!WARM_RT) WARM_RT = new THREE.WebGLRenderTarget(4, 4, { type: POST.rt.texture.type, samples: POST.rt.samples, depthTexture: new THREE.DepthTexture(4, 4) });
  const undo = peek(), made = renderer.info.programs.length;
  try { roomLightsFirst(); renderer.shadowMap.needsUpdate = true; renderer.setRenderTarget(WARM_RT); renderer.render(scene, camera); if (more) more(); }
  catch (e) { WARM.err = (e && e.stack) || String(e); }
  finally { renderer.setRenderTarget(null); undo(); setShadowsDirty(true); for (let P = renderer.info.programs, i = made; i < P.length; i++) KNOWN.add(P[i]); }
}
function draw() {
  const t = clock.getElapsedTime(), made = renderer.info.programs.length, t0 = performance.now(); ROOMF.n++; ROOMF.t = t0;
  WIND.t.value = t;
  if (motes) motes.visible = false;
  if (LIGHTS.candle) { const f = LIGHTS.candle.userData.flame; f.scale.y = 2 + Math.sin(t * 13) * .25 + Math.sin(t * 7.3) * .2; }
  if (shadowsDirty) { roomLightsFirst(); renderer.shadowMap.needsUpdate = true; setShadowsDirty(false); }
  stepGlass();   // (the room seen again in the glass if its light has changed)
  renderer.setRenderTarget(POST.rt); renderer.render(scene, camera); const t1 = performance.now(); drawLight(camera);   // (and the parts painted lightly: post.js)
  drawAO(camera, POST.rt.depthTexture);   // (the nooks' shade, from the room's depth: post.js)
  drawDof(camera, POST.rt.depthTexture);   // (the room behind what the lens is on, blurred: post.js, stepFocus below)
  POST.toneQuad.material.uniforms.tColor.value = POST.rt.texture; renderer.setRenderTarget(POST.tone); POST.toneQuad.render(renderer);
  const U = POST.mat.uniforms; U.tDepth.value = POST.rt.depthTexture; U.near.value = camera.near; U.far.value = camera.far;
  U.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);   // (the floor's lighter wash: post.js)
  renderer.setRenderTarget(POST.out); POST.quad.render(renderer); renderer.setRenderTarget(null); POST.blit.render(renderer);
  const t2 = performance.now(); drawWords();
  layoutOverlay();
  { const t3 = performance.now(); if (t3 - t0 > 80 && WARM.slow.length < 200) WARM.slow.push([t0, t3 - t0, t1 - t0, t2 - t1, t3 - t2].map(Math.round)); }
  if (renderer.info.programs.length > made) { const P = renderer.info.programs; for (let i = made; i < P.length; i++) { KNOWN.add(P[i]); if (WARM.late.length < 400) WARM.late.push((P[i].name || P[i].type || '?') + '@' + Math.round(performance.now())); } }
}
/* the lens's focus (fx/post.js DOF): on a book opened in front of the camera, to be read or an atlas (the room behind
   softens as it opens; the nearer the book, the more), on the clock, the camera, the 747 or the ISS out of its shelf.
   None in the room's own views, nor for a book only shown (its shelf stays sharp: its titles are read to pick another) */
const FOCUS = { v: new THREE.Vector3(), inspect: 0.4 };   // (inspect: the depth taken for a thing out of its shelf, drawn over the room)
function stepFocus(dt) {
  let zf = 0, far = 0;
  for (const bk of HERO.list) {
    const h = bk.hero; if (!h || !h.visible || !bk.out || bk.goal !== 'present') continue;
    const k = Math.min(1, bk.openK || 0), f = DOF.far * k * k * (3 - 2 * k);
    if (f > far) { far = f; zf = -FOCUS.v.setFromMatrixPosition(h.matrixWorld).applyMatrix4(camera.matrixWorldInverse).z; }
  }
  let ins = Math.max(CLOCK.view ? CLOCK.view.k : 0, VCAM.view ? VCAM.view.k : 0); for (const k in SHOWS) if (SHOWS[k].view) ins = Math.max(ins, SHOWS[k].view.k);
  const fi = DOF.far * ins * ins * (3 - 2 * ins); if (fi > far) { far = fi; zf = FOCUS.inspect; }
  return setFocus(zf, far, dt, camera);
}
function drawSharp() { renderer.setRenderTarget(null); POST.blit.render(renderer); drawWords(); }   // the last picture, the sharp layer anew
function loop(now) {
  const dt = THREE.MathUtils.clamp((now - (lastTick || now)) / 1000, 0, 0.1); lastTick = now;
  if (!ready || hold || !innerWidth || !innerHeight || document.hidden) return;
  const lit = stepHour(dt);
  if (!on) return;
  const t = clock.getElapsedTime();
  const books = stepBooks(dt, t); if (books) setShadowsDirty(true);
  const smooth = stepCam(dt) | books | stepGlow(dt) | lit | stepDeck(dt) | stepPlane(dt) | stepClock(dt) | stepCamera(dt) | stepShows(dt) | stepFade(dt) | sharpFading() | stepIss(dt) | stepGardenBook(dt) | (GLASS.face >= 0) | stepBulb(dt) | stepFocus(dt) | stepPlant(dt) | stepSoftPress(dt);      // motion that needs every frame
  if (smooth) lastFlight = now;
  if (!smooth && !needs) {
    const still = reduceMotion || body.classList.contains('is-idle') || now - lastInput > STILL_AFTER;
    // fireflies about: the sharp layer is redrawn over the last picture (fireflies at 30 a second, between the room's own
    // frames too), which costs a blit and a few points. The record turning: it stands in the room, so the room is drawn
    // anew, 15 a second
    const live = !reduceMotion && !body.classList.contains('is-idle') && (FLY.on || PETS.ok || CLOCK.ok || METEOR.on || METEOR.comet.on || RAIN.on);
    const spin = !reduceMotion && !body.classList.contains('is-idle') && DECK.ok && DECK.speed > 0;
    if ((still && !spin) || now - lastDraw < FRAME_MS - 2) {
      if (live && now - lastSharp >= (PETS.fast || METEOR.on ? 1000 / 60 : FLY.on || PETS.ok || CLOCK.ok ? SHARP_MS : FRAME_MS) - 2) { lastSharp = now; drawSharp(); }   // (animals on the move, a shooting star: 60 a second)
      return;
    }
  }
  lastDraw = lastSharp = now; needs = false; draw(); adaptQuality(now, smooth);
}
// While things move every frame is drawn; if those frames keep coming slower than ~17 a second (a weaker GPU), the room's
// picture steps down a size (core/renderer.js RT_STEPS: indoors it shows as softness; titles, stars and the moon stay
// sharp), and the choice is remembered for the next visit.
const PERF = { last: 0, gaps: [], slow: 0 };
function adaptQuality(now, smooth) {
  if (!smooth) { PERF.last = 0; return; }
  if (PERF.last && now - startedAt > 4000) { const g = now - PERF.last; if (g < 250) PERF.gaps.push(g); }
  PERF.last = now;
  if (PERF.gaps.length < 45) return;
  const median = PERF.gaps.sort((a, b) => a - b)[22]; PERF.gaps.length = 0;
  PERF.slow = median > 58 ? PERF.slow + 1 : 0;   // two slow stretches in a row: not a passing hiccup
  if (PERF.slow >= 2 && RT_SCALE > 0.5) {
    PERF.slow = 0;
    setRtScale(RT_STEPS.find(s => s < RT_SCALE - 0.01) || 0.5); resize(); needs = true;
    try { localStorage.setItem('hiddenLibrary.lib3dScale3', JSON.stringify({ s: RT_SCALE, t: Date.now() })); } catch (e) { /* storage blocked */ }
  }
}
/* the room comes in by parts as the page opens (the room, then the trees, then the sky,
   last the weather and the words): 0 the room alone (the garden's haze behind the glass), 1 the garden (trees, shrubs,
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
  { const t = hourTarget(); applyHour(t.e, t.az); readWeather(); applyHour(t.e, t.az); WX.early = false; }   // (the weather if it is known: an overcast's grey light and its lamps in the first shaders made)
  resize(); applyRefCamera();
  buildInterface(); mark('interface');
  // compiled while hidden, the first picture comes whole: the room, what is painted lightly over it, the deck, and each
  // full-screen step of the picture
  paintOutdoorsOnly(); POST.light.primed = true; const tC = performance.now();
  await Promise.all([compileFor(scene), compileFor(POST.light.scene), ...postSteps().map(([q, t]) => prime(q._mesh, t))]); mark('compiled');
  // a first visit (the room's shaders took over a second to make: nothing of them was kept from a visit before): the GPU
  // will take seconds over each part as it comes in, so each waits for the last one's fade (settle, below)
  const firstVisit = performance.now() - tC > 1000;
  // the first picture: the room's frame alone. Its shelves, furniture and books were in the shaders made above; they are
  // put by now and shown in turn, each faded in (fx/post.js fadePicture), then the garden, the sky, the models on
  // display, the animals, the shelves' pieces, and last the words. The loader's bar counts it all.
  // (what is drawn of each part is taken off the room's layer, the part not hidden: a lamp in it, a child of its shade,
  // stays among the room's lights. Hidden with the furniture, they left the first pictures a room of fewer lights, which
  // took shaders of its own, made as it was drawn)
  const hidePart = list => { const was = []; for (const o of list) if (o) o.traverse(c => { if ((c.isMesh || c.isPoints || c.isLine || c.isSprite) && c.layers.isEnabled(0)) { c.layers.disable(0); was.push(c); } });
    const show = () => { for (const c of was) c.layers.enable(0); }; show.peek = () => { show(); return () => { for (const c of was) c.layers.disable(0); }; }; return show; };
  const showShelves = hidePart(PARTS.shelves), showFurniture = hidePart(PARTS.furniture), showBooks = hidePart([booksMesh]); DECK.hidden = true;
  reveal(0);
  // (held: the room stays hidden behind the loader until all of it is in, the animals too, then shown whole: html.l3-hold)
  const held = document.documentElement.classList.contains('l3-hold');
  ready = true; draw(); updateOn(); startedAt = performance.now(); mark('first-draw'); setLoad(45);
  fetchAhead(['clock-glb', 'camera-glb', 'iss-glb', 'cat-bin', 'hen-glb']);   // (what comes in last asked for now, the network idle: built in its turn below)
  renderer.setAnimationLoop(loop);
  const t0 = performance.now(), notBefore = ms => new Promise(r => setTimeout(r, reduceMotion || held ? 0 : Math.max(0, t0 + ms - performance.now())));
  let shownAt = 0;
  const show = (name, pct, fn) => { if (!held) fadePicture(reduceMotion ? 0.001 : 0.55); fn(); setShadowsDirty(true); needs = true; setLoad(pct); mark('show-' + name); shownAt = performance.now(); };
  // (each part let in once the GPU has made it ready for the screen, drawn once unseen (ahead: warmPicture), and on a
  // first visit once the last one's fade is over (settle): its fade then runs whole)
  const settle = () => new Promise(r => setTimeout(r, reduceMotion || held ? 0 : Math.max(0, shownAt + (firstVisit ? 570 : 0) - performance.now())));
  const ahead = async (peek, more) => { await settle(); warmPicture(peek, more); await gpuIdle(); };
  await notBefore(450); await ahead(showShelves.peek); show('shelves', 47, showShelves);
  await notBefore(950); await ahead(showFurniture.peek); show('furniture', 49, () => { showFurniture(); DECK.hidden = false; });
  await notBefore(1450); await ahead(showBooks.peek); show('books', 51, showBooks);
  // the garden, built once the room is all there (its trees take the page's thread a while), then the sky
  await notBefore(1900); await settle();
  await buildGarden(); setLoad(64);
  if (NIGHT.day && LIGHTS.ring) NIGHT.day.ring = LIGHTS.ring.material.color.clone();   // (the far woods' own colour, before the hour tints it)
  applyHour(HOUR.e, HOUR.az);
  await compileFor(scene); await ahead(() => { outside.visible = true; return () => { outside.visible = false; }; });
  show('garden', 69, () => reveal(1));
  OVER.hold = true;   // (the sharp layer's stars, fireflies and glow: not drawn until their shaders are made, below)
  buildNightSky(); buildFireflies();
  if (LIGHTS.pendant) { const P = LIGHTS.pendant; P.updateMatrixWorld(true); buildBulbGlow(P.localToWorld(P.userData.glow.position.clone())); }   // (the bulb over the sofa, glowing: fx/glow.js)
  if (LIGHTS.floor) buildLampBeam(LIGHTS.floor.userData.glow.parent);   // (the floor lamp's beam and the dust in it: fx/glow.js)
  spineShaderPart();   // (the shelves' titles' shader with the rest of the sharp layer's: first shown in a section's close-up)
  await compileFor(OVER.skyScene, null); await compileFor(OVER.scene, null);   // (the sharp layer: drawn on the page's own canvas)
  for (const [o, t] of milkyWayParts()) await compileFor(o, t, camera, o);   // (the Milky Way's: by night it comes in with the sky)
  OVER.hold = false;
  await notBefore(2500); await ahead(() => { const s = LIGHTS.sky, was = s && s.visible; if (s) s.visible = true; return () => { if (s) s.visible = was; }; }, warmGlass); show('sky', 75, () => reveal(2));
  await settle();   // (the sky's fade over before the models are made)
  // then the decorations, in turn: the models on display (the 747, the ISS, the clock, the camera; the garden's magazine),
  // the cat and the chicken, the shelves' pieces (each fades in: pets.js crispPass uBorn, or the picture's fade)
  const warn = what => e => console.warn(what + ' unavailable', e);
  // (the loader's count creeps on toward the end of a long step, never past it: a step of seconds does not look stuck)
  const creep = to => { const id = setInterval(() => setLoad(Math.min(to - 0.5, LOAD.to + Math.max(0.12, (to - LOAD.to) * 0.05))), 150); return () => clearInterval(id); };
  const bump = n => p => { setLoad(Math.min(85.5, LOAD.to + n)); return p; };
  let stop = creep(86);
  await Promise.all([buildPlane().catch(warn('747')), buildClock().catch(warn('clock')), buildIss().catch(warn('ISS')), buildCamera().catch(warn('camera')), buildGardenBook().catch(warn('garden book'))].map(p => p.then(bump(1.5)))); stop(); mark('models'); setLoad(86);
  stop = creep(94); await loadPets().catch(warn('pets')); stop(); mark('pets'); setLoad(94);
  stop = creep(98); const shelfPieces = await buildDisplays().catch(warn('shelf pieces')); stop();
  await gpuIdle(); show('displays', 98, () => { if (shelfPieces) shelfPieces.visible = true; }); mark('displays');
  // last, the words: the labels over the room, the sidebar, the sky clock and the weather line (CSS: html.l3-wait)
  if (held) { stop = creep(100); await gpuIdle(); draw(); stop(); document.documentElement.classList.remove('l3-hold'); }   // (all in: the room fades in whole, CSS #lib3d)
  await notBefore(3300); reveal(3); REVEAL.done = true; setLoad(100); needs = true; setTimeout(warmSpines, 2500);   // (the shelves' titles made ahead, in idle time: ui/words.js)
  const letGo = () => { if (!endFades()) setTimeout(letGo, 500); }; setTimeout(letGo, 1500);   // (the last fade over (it waits while the light states' shaders are made): its pictures let go)
  // once the words have faded in: the lens's blur made, the pictures' copies on this side let go; the light states'
  // shaders only when they will be wanted (lightsSoon)
  setTimeout(() => (window.requestIdleCallback || (fn => setTimeout(fn, 500)))(() => { warmDof(); lightsSoon(); }, { timeout: 3000 }), reduceMotion ? 0 : 2200);
  quiet(20000).then(() => (window.requestIdleCallback || (fn => setTimeout(fn, 300)))(() => releaseSources(), { timeout: 2000 }));   // (it holds the GPU ~0.5 s once: not under a moving pointer)
}
function warmDof() { const on = DOF.on.value; DOF.on.value = 1; drawDof(camera, POST.rt.depthTexture); DOF.on.value = on; renderer.setRenderTarget(null); }   // (the lens's blur drawn once into its own picture, unseen: its first use is a section's close-up)
/* The other states of the lights cost ~200 shader programs (~90 MB of the GPU's memory) and some 40 s of the GPU's
   time in the background: made only when one is coming. Looked at each minute: the switch pressed (prepareLights), an
   overcast to come in (its lamps), or the light of the clock 45 minutes on in another state than now (dusk, dawn). */
const lightsKey = e => { const S = hourState(e, {}); return (S.sun > 0.003 ? 's' : '') + (S.n < 0.999 ? 'w' : '') + (S.lamps > 0.001 ? 'l' : ''); };
function lightsSoon() {
  if (REVEAL.lit || LIT.run) return;
  // (all made at once with ?lights=all, and under automation, where the tools wait for 'l3-precompiled'; ?lights=lazy there for a visitor's way)
  if (/[?&]lights=all/.test(location.search) || (navigator.webdriver && !/[?&]lights=lazy/.test(location.search))) { precompileLightStates(); return; }
  const ahead = () => { if (HOUR.pin) return null; const d = new Date(), dark = body.classList.contains('dark-mode'); if (dark !== !window.HL_SUN.isDay(d)) return null; return sunPlace(new Date(d.getTime() + 45 * 60000)); };   // (the clock's light: not a pinned hour, nor the switch's when it differs)
  const soon = ahead(), now = hourTarget();
  if (WX.ovT > 0.01 || WX.ov > 0.01 || (soon && now && lightsKey(soon.e) !== lightsKey(now.e))) { precompileLightStates(); return; }
  setTimeout(lightsSoon, 60000);
}
// As night falls the lights change three ways (the ceiling spots come on, the sun goes down, then the window lights go out),
// and each change needs new shaders for every lit material: made up front, in the background, so the switch does not
// stall the page later.
const compileFor = (sc, target = POST.rt, cam = camera, lit = sc) => prime(sc, target, cam, lit);   // (lit: the scene whose lights it is lit by; core/renderer.js prime)
/* Each state of the lights in turn, the room drawn meanwhile as it is: the lights are set for a state only inside one
   step (inState) and put back before the page's thread is let go. A state's shaders are compiled in the background
   (prime), then each kind of thing (a material on a shape of its own layout) is drawn once into a few pixels of the
   picture's kind of target, a few kinds at a time, the next ones once the GPU has made those ready (gpuIdle): a
   shader is finished for the screen only as it is first drawn with. Done in one go, with the room not drawn meanwhile,
   this held the page's thread ~2 s at a time, four times over, on a first visit. */
const WCAM = new THREE.PerspectiveCamera();
// The room left to whoever is using it: the next lot of shaders waits until the pointer has kept still ~0.9 s and
// nothing moves of itself (a lot holds the GPU 0.1-0.4 s on a first visit, and the pictures drawn meanwhile wait behind
// it: under a moving pointer that was a stutter, 53 gaps and 11.7 s of them in the 25 s after the words came in). At
// most 4 s waited for a lot, so the states are all made in the end under a restless hand too.
const quiet = (max = 4000) => new Promise(done => { const t0 = performance.now(), look = () => { const now = performance.now(); if (LIT.hurry || document.hidden || now - t0 > max || (now - lastInput > 900 && now - lastFlight > 400)) done(); else setTimeout(look, 120); }; look(); });
/* The page's day/night switch waits for these shaders (prepareLights): pressed before they are all made, the change of
   light would make the rest as it is drawn, and the page stood still for seconds. Pressed, the lots no longer wait for a
   still pointer (LIT.hurry); the switch shows how far they are (LIT.pct, 0-1) and slides once they are made. */
const LIT = { pct: 0, hurry: false, run: null };
function precompileLightStates() { return LIT.run || (LIT.run = lightStates()); }
function prepareLights(onPct) {
  if (REVEAL.lit) { onPct(1); return Promise.resolve(); }
  LIT.hurry = true;
  return new Promise(done => { const look = () => {
    // (the room still coming in: its own loader's count, the first fifth of the switch's)
    onPct(REVEAL.done ? 0.2 + 0.8 * LIT.pct : 0.2 * Math.min(LOAD.to, 99) / 100);
    if (REVEAL.lit || document.documentElement.classList.contains('lib3d-failed')) { LIT.hurry = false; gpuIdle().then(() => { onPct(1); done(); }); return; }
    if (REVEAL.done) precompileLightStates();
    setTimeout(look, 100); }; look(); });
}
async function lightStates() {
  if (!renderer.compileAsync) { REVEAL.lit = true; return; }
  const L = LIGHTS, spl = [...NIGHT.spots.map(s => s.sp), ...(L.pendant ? [L.pendant.userData.light] : [])];   // (the bulb over the sofa comes on with the ceiling spots)
  const inState = ([sun, rects, spots], fn) => {
    const was = { sun: L.sun.visible, rects: L.rects.map(r => r.visible), spots: spl.map(s => s.visible) };
    L.sun.visible = sun; L.rects.forEach(r => { r.visible = rects; }); spl.forEach(s => { s.visible = spots; });
    try { return fn(); } finally { L.sun.visible = was.sun; L.rects.forEach((r, i) => { r.visible = was.rects[i]; }); spl.forEach((s, i) => { s.visible = was.spots[i]; }); }
  };
  try {
    // the models drawn sharp on their own layers too (each made its shaders as it came, for the lights of that moment
    // only), and the shadows' depth shaders, which compileAsync does not make: the map drawn in each state
    LITCAM.userData.n = 0;   // (the room's lights counted again: all are made by now)
    const sharp = [[PETS.holder, PETS.layer], [PETS.chicken, PETS.layer], [PLANE.holder, PLANE.layer], [CLOCK.holder, CLOCK.layer], [ISS.holder, ISS.layer], [VCAM.group, VCAM.layer], [GBOOK.book, GBOOK.layer], ...[PBOOK, TBOOK, RUGS].flatMap(S => S.twins.map(t => [t, S.layer]))].filter(([o]) => o);
    // targets of the picture's kind (2 samples, a depth texture) and of a sharp pass's: what is made ready for one is not for another
    const warm = new THREE.WebGLRenderTarget(4, 4, { type: POST.rt.texture.type, samples: POST.rt.samples, depthTexture: new THREE.DepthTexture(4, 4) }), warmS = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 2 }), mask = SHARP.cam.layers.mask;
    // one of each kind of thing in the room: its material(s), its shape's layout, how it is drawn and shaded
    const kinds = new Map(), sig = g => Object.keys(g.attributes).sort().map(k => { const a = g.attributes[k]; return k + a.itemSize + a.array.constructor.name[0] + (a.normalized ? 'n' : ''); }).join(',') + (g.index ? g.index.array.constructor.name[1] : '-');
    scene.traverse(o => { if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.layers.isEnabled(0) || !o.geometry || !o.geometry.attributes.position) return;
      let v = o.visible; for (let q = o.parent; v && q; q = q.parent) v = q.visible; if (!v) return;
      const k = [].concat(o.material).map(m => m.uuid).join('+') + '|' + sig(o.geometry) + '|' + (o.isInstancedMesh ? 'i' : '') + (o.isSkinnedMesh ? 's' : '') + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '') + (o.customDepthMaterial ? 'd' : '');
      if (!kinds.has(k)) kinds.set(k, o); });
    // what the lights light, as compile wants it (a thing to traverse): a material they do not light keeps its one shader
    // through every state, and compiled for each it took a new one, which the next picture then drew with unasked
    const needsLights = m => m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial || m.isShadowMaterial || (m.isShaderMaterial && m.lights === true);
    const group = list => ({ list, traverse: fn => { for (const o of list) fn(o); }, traverseVisible() {} });
    // (the lit things in lots of n materials: a whole state compiled at once held the GPU ~1 s)
    const lots = (g, n) => { const by = new Map(); for (const o of g.list) { const k = [].concat(o.material).map(m => m.uuid).join('+'); if (!by.has(k)) by.set(k, []); by.get(k).push(o); } const all = [...by.values()], out = []; for (let i = 0; i < all.length; i += n) out.push(group(all.slice(i, i + n).flat())); return out; };
    const litOf = (root, layer) => { const lit = []; root.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && (layer === null || o.layers.isEnabled(layer)) && [].concat(o.material).some(needsLights)) lit.push(o); }); return group(lit); };
    const litRoom = litOf(scene, 0), litSharp = sharp.map(([o, layer]) => [litOf(o, null), layer]);   // (a sharp thing whole: a part of it may be drawn on a layer of its own, as the cat's skin for its fur)
    const list = [...kinds.values()], skins = []; if (PETS.cat) PETS.cat.traverse(o => { if (o.isSkinnedMesh && !o.castShadow) skins.push(o); });   // (the cat casts only while it keeps still: its shadow's shaders made now too)
    scene.traverse(o => { if (o.isLight && o.layers.isEnabled(0)) o.layers.enable(29); }); WCAM.layers.set(29);
    const view = c => { c.position.copy(camera.position); c.quaternion.copy(camera.quaternion); c.projectionMatrix.copy(camera.projectionMatrix); c.projectionMatrixInverse.copy(camera.projectionMatrixInverse); c.updateMatrixWorld(true); };
    const drawn = (objs, cam, target, shadows) => { const off = []; for (const o of objs) o.traverse(m => { if (m.frustumCulled) { m.frustumCulled = false; off.push(m); } });
      if (shadows) { roomLightsFirst(); renderer.shadowMap.needsUpdate = true; }
      renderer.setRenderTarget(target); renderer.render(scene, cam); renderer.setRenderTarget(null); for (const m of off) m.frustumCulled = true; };
    const roomLots = lots(litRoom, 10); let lsN = 0, step = 0;
    // (the state the lights are in now was made as the room came in: the other three)
    const cur = [L.sun.visible, L.rects.some(r => r.visible), spl.some(s => s.visible)].join(), states = [[true, true, false], [true, true, true], [false, true, true], [false, false, true]].filter(st => st.join() !== cur);
    const steps = states.length * (roomLots.length + litSharp.length + Math.ceil(list.length / 3) + sharp.length), done1 = () => { LIT.pct = Math.min(0.99, ++step / steps); };
    for (const st of states) {
      mark('lit' + ++lsN);
      for (const part of roomLots) { await quiet(); await inState(st, () => compileFor(part, POST.rt, camera, scene)); done1(); }
      for (const [o, layer] of litSharp) { await quiet(); await inState(st, () => { SHARP.cam.layers.set(layer); return compileFor(o, POST.rt, SHARP.cam, scene); }); done1(); }
      for (let i = 0; i < list.length; i += 3) {   // (the room's kinds, three at a time, their shadows too)
        await quiet(); await gpuIdle(); const part = list.slice(i, i + 3);
        inState(st, () => { for (const o of part) o.layers.enable(29); for (const o of skins) o.castShadow = true; view(WCAM);
          try { drawn(part, WCAM, warm, true); } finally { for (const o of part) o.layers.disable(29); for (const o of skins) o.castShadow = false; } });
        setShadowsDirty(true); needs = true; done1();   // (the maps drawn again for the room as it is)
      }
      for (const [o, layer] of sharp) { await quiet(); await gpuIdle(); inState(st, () => { SHARP.cam.layers.set(layer); view(SHARP.cam); drawn([o], SHARP.cam, warmS, false); }); done1(); }
    }
    if (skins.length) PETS.shadowStill = undefined;
    SHARP.cam.layers.mask = mask; await gpuIdle(); warm.depthTexture.dispose(); warm.dispose(); warmS.dispose();
  } catch (e) { WARM.err = (e && e.stack) || String(e); /* compiled on first use instead */ }
  setShadowsDirty(true); needs = true; LIT.pct = 1; REVEAL.lit = true; mark('precompiled');
}
/* Pictures the GPU holds that nothing here draws again are let go on this side once they are up (~65 MB
   of the page's memory): the models' images (bitmaps, closed), the wood and
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
/* and the room's still things' normals, texture coordinates and colours (the page's memory, ~10-15 MB):
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

export { LIT, RELEASED, REVEAL, clock, draw, hold, loop, on, prepareLights, ready, setNeeds, setReady, start, updateOn };
