import './leaves.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { canvas, ctex, rng } from '../core/utils.js';
import { camera, renderer } from '../core/renderer.js';
import { DOF, DOF_GLSL, POST, QUAD_VS } from '../fx/post.js';
import { V3 } from '../core/views.js';
import { NIGHT } from '../fx/night.js';
import { UIS } from './library.js';
import { inkFor, relabelHero, spineLettering } from './hero-books.js';
import { SKYN, loadMoon, moonAge, stepMeteors } from '../fx/sky.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FLY } from '../fx/fireflies.js';
import { BULB, stepLampBeam } from '../fx/glow.js';
import { LIGHTS } from '../world/lights.js';
import { drawDeck } from './deck.js';
import { REVEAL, clock } from '../core/loop.js';
import { drawPets, drawSharpBooks, sweepCrisp } from '../world/pets.js';
import { drawRain } from '../fx/rain.js';
import { drawPlane } from '../world/b747.js';
import { drawClock, drawInspect } from '../world/clock.js';
import { drawCamInspect, drawCamera } from '../world/camera.js';
import { drawShows } from '../world/showcase.js';
import { drawIss } from '../world/iss.js';
import { drawFloorSharp, drawGardenBook } from '../world/gardenbook.js';

/* ---- the titles on the shelves' spines: drawn after the watercolour pass so they stay sharp, and hidden wherever the
   room stands in front of the book (each pixel is tested against the room's depth); shown only once its section is
   opened and the camera has come close. (A book out of the shelf has its words printed on itself: hero-books.js.) */
const OVER = { scene: new THREE.Scene(), u: { uDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uPR: { value: 1 } } };   // (shared by the sharp layer's parts, whenever each is built)
function crispMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uPR: OVER.u.uPR, uFocus: DOF.focus, uNF: DOF.nf },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map, uDepth; uniform vec2 uRes, uNF; uniform float uPR; varying vec2 vUv; ${DOF_GLSL}
      void main(){
        // out of focus (fx/post.js DOF): read from a smaller picture of the words, one as wide as the lens's circle (its
        // mipmaps: each level up is twice as soft), and a little lighter the softer
        float r = dofCoc(uNF.x * uNF.y / (uNF.y - gl_FragCoord.z * (uNF.y - uNF.x))) * uPR;
        vec4 c = texture2D(map, vUv, log2(max(1.0, 2.0 * r))); c.a *= 1.0 - 0.6 * smoothstep(2.0, 10.0, r);
        if (c.a < 0.004) discard;
        if (gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 4e-6) discard;
        gl_FragColor = c; }`,
    transparent: true, depthTest: false, depthWrite: false });
}
/* the lettering of a book of the page, standing in its shelf: stamped on its cloth as a binder's is, nothing under it.
   The cloth's own pressed rules at the head and the foot (world/books.js, the titled spine's tile) take the foil; between
   them the short title, the author and a mark at the foot (hero-books.js spineLettering), in the ink that suits the
   cloth: pale foil on a dark one, each stroke's far edge in shade where the die pressed it in, dark ink on a pale one,
   its edge catching a little light; here and there a speck worn off. Its picture as fine as the type needs: 2400 px a
   metre, a thick spine's wider than a slim one's. */
function spineWords(bk) {
  if (bk.spineTex) return bk.spineTex;
  const W = Math.max(64, Math.min(160, Math.round(bk.t * 2400))), H = Math.max(64, Math.round(W * bk.h / bk.t)), c = canvas(W, H), g = c.getContext('2d'), ink = inkFor(bk.color), pale = ink !== '#2a2118';
  g.fillStyle = ink; g.globalAlpha = pale ? 0.95 : 0.84;
  g.shadowColor = pale ? 'rgba(0,0,0,.55)' : 'rgba(255,250,235,.4)'; g.shadowOffsetX = W / 110; g.shadowOffsetY = W / 80; g.shadowBlur = W / 90;
  for (const y of [22, 30, 990, 998]) g.fillRect(W * 4 / 64, H * y / 1024, W * 56 / 64, Math.max(1.2, H * 3 / 1024));
  spineLettering(g, W, H, bk, H * 44 / 1024);
  g.shadowColor = 'transparent'; g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
  let seed = 7; for (const ch of bk.it.title) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0; const r = rng(seed);
  for (let i = 0, n = W * H / 380; i < n; i++) { g.globalAlpha = 0.2 + 0.55 * r(); g.beginPath(); g.arc(r() * W, r() * H, (0.3 + r() * 0.75) * W / 64, 0, 7); g.fill(); }
  const t = ctex(c, { srgb: false, rep: false }); t.anisotropy = 8; t.userData.keep = true; return (bk.spineTex = t);
}
function shelfSpine(bk) {   // the same title on the book standing in its place (shown once the spine is wide enough to read)
  if (bk.shelfSpine) return bk.shelfSpine;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), crispMaterial(spineWords(bk))); m.matrixAutoUpdate = false; m.visible = false;
  m.matrix.copy(bk.m0).multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0.002 / bk.d)); OVER.scene.add(m); return (bk.shelfSpine = m);
}
const _sa = new V3(), _sb = new V3();
// the page's language switched: the words on the books drawn so far are drawn again in the other language
function relabelBooks() {
  for (const sec of UIS.secs) for (const bk of sec.books) {
    if (bk.spineTex) { bk.spineTex.dispose(); bk.spineTex = null; }
    if (bk.shelfSpine) bk.shelfSpine.material.uniforms.map.value = spineWords(bk);
    relabelHero(bk);
  }
}
function spinePx(bk) {   // how wide the spine shows on screen, in pixels
  _sa.set(-0.5, 0.5, 0).applyMatrix4(bk.m0).project(camera); _sb.set(0.5, 0.5, 0).applyMatrix4(bk.m0).project(camera);
  if (Math.abs(_sa.z) > 1 || Math.abs(_sb.z) > 1) return 0;
  return Math.hypot((_sa.x - _sb.x) * innerWidth, (_sa.y - _sb.y) * innerHeight) / 2;
}
/* things of the sharp layer faded in the first time they show (everything fades in once loading completes):
   the night sky, the bulb's glow, the fireflies; a factor 0..1 from when each first showed (seen: it shows now) */
const BORN = {};
function bornFade(k, seen, dur = 1.1) { if (!seen) return BORN[k] ? 1 : 0; if (!BORN[k]) BORN[k] = performance.now(); const f = Math.min(1, (performance.now() - BORN[k]) / (dur * 1000)); if (f < 1) BORN.moving = true; return f * f * (3 - 2 * f); }
/* the Milky Way at 0.75 px a CSS px (a lower resolution for it): its shell drawn into a target of its own,
   cleared clear, then laid on the canvas as it would have been drawn there (premultiplied: ONE, ONE − alpha); its depth
   test reads the room's depth through that target's size (uRes). The stars and the moon stay sharp, drawn after it. */
const MWR = { rt: null, quad: null, cc: new THREE.Color() };
function mwTarget(w, h) {   // its target and the quad that lays it over (made the first time either is wanted)
  if (!MWR.rt) { MWR.rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
    MWR.quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { t: { value: MWR.rt.texture } }, vertexShader: QUAD_VS, fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }',
      transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false })); }
}
// what the Milky Way draws with, for its shaders to be made before the first night (core/loop.js precompileLightStates): [object, target]
function milkyWayParts() { if (!OVER.mw) return []; mwTarget(4, 4); return [[OVER.mw, MWR.rt], [MWR.quad._mesh, null]]; }
function drawMilkyWay() {
  const mw = OVER.mw; if (!mw) return;
  const R = OVER.u.uRes.value, W = R.x, H = R.y, k = Math.min(1, 0.75 / renderer.getPixelRatio()), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  mwTarget(w, h);
  if (MWR.rt.width !== w || MWR.rt.height !== h) MWR.rt.setSize(w, h);
  const cc = renderer.getClearColor(MWR.cc), ca = renderer.getClearAlpha(); R.set(w, h);
  renderer.setRenderTarget(MWR.rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(mw, camera);
  renderer.setRenderTarget(null); renderer.setClearColor(cc, ca); R.set(W, H); MWR.quad.render(renderer);
}
function drawWords() {   // the sharp layer: titles on the spines, words of the books on the move, and the night sky
  BORN.moving = false;
  sweepCrisp();   // (targets of things off the screen a while let go: pets.js)
  let any = false, make = 1;   // (make: how many titles may be made this frame)
  for (const sec of UIS.secs) for (const bk of sec.books) {
    // a section just opened: its books' titles made on the way in, one a frame (each a canvas painted and sent to the GPU),
    // before the camera is close enough to show them; made all at once in the first close frame they held it ~100 ms
    if (make > 0 && !bk.shelfSpine && !bk.away && (UIS.open === sec || UIS.mode === sec.group)) { make--; renderer.initTexture(shelfSpine(bk).material.uniforms.map.value); }
    // only in the close-up of its own section (these words hidden until the close-up), and wide enough to read there
    const on = !bk.away && (UIS.open === sec || UIS.mode === sec.group) && spinePx(bk) >= 14 && !!bk.shelfSpine; if (on) { bk.shelfSpine.visible = true; any = true; } else if (bk.shelfSpine) bk.shelfSpine.visible = false;
  }
  if (OVER.sky) { const night = NIGHT.u.value > 0.005 && REVEAL.stage >= 2; OVER.sky.visible = night; if (night) { OVER.u.uTime.value = clock.getElapsedTime(); OVER.moonAge.value = moonAge(); loadMoon(); stepMeteors(clock.getElapsedTime(), camera); } }
  if (FLY.pts) { FLY.on = FLY.u.value > 0.01; if (FLY.on) { FLY.u0 = FLY.u.value; FLY.u.value *= bornFade('fly', true); } FLY.pts.visible = FLY.on; if (FLY.glow) FLY.glow.visible = FLY.on; if (FLY.on) { any = true; FLY.t.value = clock.getElapsedTime(); } }
  if (BULB.mesh) {   // the bulb over the sofa glowing, while it is on (its glow's strength as the hour set it: fx/hour.js)
    const P = LIGHTS.pendant; BULB.on.value = (P ? P.userData.glow.material.opacity / 0.45 : 0) * bornFade('bulb', BULB.on.value > 0); BULB.mesh.visible = BULB.on.value > 0.01;
    if (BULB.mesh.visible) { any = true; BULB.t.value = clock.getElapsedTime(); }
  }
  if (stepLampBeam(clock.getElapsedTime())) any = true;   // (the floor lamp's beam and its dust)
  OVER.u.uDepth.value = POST.rt.depthTexture; renderer.getDrawingBufferSize(OVER.u.uRes.value); if (OVER.u.uPR) OVER.u.uPR.value = renderer.getPixelRatio();
  // the night sky first: it darkens the dome behind it (fx/sky.js), so the rain, the deck, the animals and the rest stand in front of it
  if (OVER.sky && OVER.sky.visible && !OVER.hold) {   // (faded in the first time it shows; its Milky Way at a lower resolution)   // (hold: its shaders on their way, core/loop.js start)
    const n = SKYN.value; SKYN.value = n * bornFade('sky', n > 0.01, 1.4);
    renderer.autoClear = false; drawMilkyWay(); if (OVER.mw) OVER.mw.visible = false; renderer.render(OVER.skyScene, camera); if (OVER.mw) OVER.mw.visible = true; renderer.autoClear = true;
    SKYN.value = n;
  }
  drawRain(); drawFloorSharp(); drawDeck(); drawPlane(); drawIss(); drawGardenBook(); drawClock(); drawCamera(); drawPets();   // (the rain first: the deck, the 747 on its shelf and the animals stand in front of it)
  // the shelves' titles and the fireflies, then the book out of the shelf over them (sharp: it is not in the picture, so the
  // room's depth does not hide the titles behind it)
  if ((any || OVER.warm) && !OVER.hold) { renderer.autoClear = false; renderer.render(OVER.scene, camera); renderer.autoClear = true; if (OVER.warm) { OVER.warm.visible = false; OVER.warm = null; } }
  if (FLY.u0 !== undefined) { FLY.u.value = FLY.u0; FLY.u0 = undefined; }   // (its own level back: fx/hour.js sets it)
  drawSharpBooks();
  drawInspect();   // (the clock out of its shelf: over all of it, the room dimmed)
  drawCamInspect();   // (the camera out of its shelf: the same)
  drawShows();   // (the 747 or the ISS out, turning: the same)
}

const sharpFading = () => !!BORN.moving;   // (a first fade-in under way: core/loop.js draws every frame)
// the titles' shader, made before the first close-up (core/loop.js start, with the sharp layer's scene: a shader is made
// for the scene it is drawn in): one plane wearing it, in that scene, never shown
function spineShaderPart() { const c = canvas(2, 2), m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), crispMaterial(ctex(c, { srgb: false, rep: false }))); m.scale.setScalar(0); m.frustumCulled = false; OVER.scene.add(m); return (OVER.warm = m); }   // (no bigger than a point: drawn once all the same, drawWords, since a shader is only wholly ready once it has drawn)
/* every book's title made ahead, while the page has nothing to do (core/loop.js, once all is shown): one book at a time,
   its canvas painted (letters with a soft shadow, the foil's wear: tens of milliseconds a book in a browser that paints
   canvases on the CPU) and sent to the GPU. Made at the click instead, a section's titles held its close-up: all in one
   frame at first, then a frame each. What is not made yet when a section opens is still made on the way in (drawWords). */
function warmSpines() {
  const list = []; for (const sec of UIS.secs) for (const bk of sec.books) list.push(bk);
  const next = () => { let bk; while ((bk = list.shift()) && (bk.shelfSpine || bk.away)); if (!bk) return;
    if (!document.hidden) renderer.initTexture(shelfSpine(bk).material.uniforms.map.value); else list.unshift(bk);
    setTimeout(() => (window.requestIdleCallback || (f => setTimeout(f, 60)))(next), 90); };
  next();
}
export { OVER, drawWords, relabelBooks, sharpFading, milkyWayParts, spineShaderPart, warmSpines };
