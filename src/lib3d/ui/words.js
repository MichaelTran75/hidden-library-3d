import './leaves.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { canvas, ctex } from '../core/utils.js';
import { camera, renderer } from '../core/renderer.js';
import { POST } from '../fx/post.js';
import { V3 } from '../core/views.js';
import { NIGHT } from '../fx/night.js';
import { UIS } from './library.js';
import { printTitle } from './book-data.js';
import { inkFor, relabelHero } from './hero-books.js';
import { loadMoon, moonAge, stepMeteors } from '../fx/sky.js';
import { FLY } from '../fx/fireflies.js';
import { BULB } from '../fx/glow.js';
import { LIGHTS } from '../world/lights.js';
import { drawDeck } from './deck.js';
import { REVEAL, clock } from '../core/loop.js';
import { drawPets, drawSharpBooks } from '../world/pets.js';
import { drawRain } from '../fx/rain.js';
import { drawPlane } from '../world/b747.js';
import { drawClock, drawInspect } from '../world/clock.js';
import { drawIss } from '../world/iss.js';
import { drawGardenBook } from '../world/gardenbook.js';

/* ---- the titles on the shelves' spines: drawn after the watercolour pass so they stay sharp, and hidden wherever the
   room stands in front of the book (each pixel is tested against the room's depth); shown only once its section is
   opened and the camera has come close. (A book out of the shelf has its words printed on itself: hero-books.js.) */
const OVER = { scene: new THREE.Scene(), u: { uDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uPR: { value: 1 } } };   // (shared by the sharp layer's parts, whenever each is built)
function crispMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uDepth: OVER.u.uDepth, uRes: OVER.u.uRes },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map, uDepth; uniform vec2 uRes; varying vec2 vUv;
      void main(){ vec4 c = texture2D(map, vUv); if (c.a < 0.004) discard;
        if (gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 4e-6) discard;
        gl_FragColor = c; }`,
    transparent: true, depthTest: false, depthWrite: false });
}
function wordsCanvas(W, H, bk) {   // ink that suits the cover, with a soft halo of the opposite tone so it reads on any paint
  const c = canvas(W, H), g = c.getContext('2d'), ink = inkFor(bk.color);
  g.fillStyle = ink; g.textAlign = 'center'; g.shadowColor = ink === '#2a2118' ? 'rgba(226,214,192,.55)' : 'rgba(20,14,8,.6)'; g.shadowBlur = Math.max(4, W * 0.012);
  return { c, g };
}
function spineWords(bk) {   // the title along the spine, as large as the spine allows (narrowed a little rather than cut)
  if (bk.spineTex) return bk.spineTex;
  const W = 64, H = Math.max(64, Math.round(W * bk.h / bk.t)), { c, g } = wordsCanvas(W, H, bk), font = n => `600 ${n}px Inter, 'Helvetica Neue', Arial, sans-serif`;
  g.shadowBlur = 4; g.translate(W / 2, H / 2); g.rotate(Math.PI / 2); g.textBaseline = 'middle';
  const room = H * 0.88 - 6, two = bk.t >= 0.028;   // a thick spine (from ~400 pages) takes two lines
  let size = Math.round(W * (two ? 0.4 : 0.62)), txt = printTitle(bk.it); g.font = font(size);
  while (g.measureText(txt).width > room * (two ? 2 : 1) && size > Math.round(W * (two ? 0.34 : 0.5))) { size -= 1; g.font = font(size); }
  const fit = (t, k) => { while (g.measureText(t).width * k > room && t.length > 4) t = t.slice(0, -2).trimEnd() + '…'; return t; };
  // a soft strip under the words, in the tone opposite the ink, so they read over any printed pattern on the spine
  const band = (w, h) => { g.save(); g.shadowBlur = 0; g.fillStyle = g.fillStyle === '#2a2118' ? 'rgba(226,214,192,.5)' : 'rgba(22,16,10,.42)';
    g.beginPath(); g.roundRect(-w / 2 - size * 0.35, -h / 2, w + size * 0.7, h, size * 0.3); g.fill(); g.restore(); };
  if (two && g.measureText(txt).width > room) {
    const words = txt.split(/\s+/); let a = '', i = 0; while (i < words.length && g.measureText((a ? a + ' ' : '') + words[i]).width <= room) a += (a ? ' ' : '') + words[i++];
    if (!a) { a = words[0]; i = 1; }
    const l1 = fit(a, 1), l2 = fit(words.slice(i).join(' '), 1);
    band(Math.max(g.measureText(l1).width, g.measureText(l2).width), size * 2.45);
    g.fillText(l1, 0, -size * 0.58); g.fillText(l2, 0, size * 0.58);
  } else {
    const sx = Math.max(0.8, Math.min(1, room / g.measureText(txt).width)); txt = fit(txt, sx); g.scale(sx, 1);
    band(g.measureText(txt).width, size * 1.3); g.fillText(txt, 0, 0);
  }
  const t = ctex(c, { srgb: false, rep: false }); t.anisotropy = 8; return (bk.spineTex = t);
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
function drawWords() {   // the sharp layer: titles on the spines, words of the books on the move, and the night sky
  let any = false;
  for (const sec of UIS.secs) for (const bk of sec.books) {
    // only in the close-up of its own section (G, 17/10/2026: "các text này ko nên hiện ra khi chưa close up"), and wide enough to read there
    const on = !bk.away && (UIS.open === sec || UIS.mode === sec.group) && spinePx(bk) >= 14; if (on) { shelfSpine(bk).visible = true; any = true; } else if (bk.shelfSpine) bk.shelfSpine.visible = false;
  }
  if (OVER.sky) { const night = NIGHT.u.value > 0.005 && REVEAL.stage >= 2; OVER.sky.visible = night; if (night) { OVER.u.uTime.value = clock.getElapsedTime(); OVER.moonAge.value = moonAge(); loadMoon(); stepMeteors(clock.getElapsedTime(), camera); } }
  if (FLY.pts) { FLY.on = FLY.u.value > 0.01; FLY.pts.visible = FLY.on; if (FLY.on) { any = true; FLY.t.value = clock.getElapsedTime(); } }
  if (BULB.mesh) {   // the bulb over the sofa glowing, while it is on (its glow's strength as the hour set it: fx/hour.js)
    const P = LIGHTS.pendant; BULB.on.value = P ? P.userData.glow.material.opacity / 0.45 : 0; BULB.mesh.visible = BULB.on.value > 0.01;
    if (BULB.mesh.visible) { any = true; BULB.t.value = clock.getElapsedTime(); }
  }
  OVER.u.uDepth.value = POST.rt.depthTexture; renderer.getDrawingBufferSize(OVER.u.uRes.value); if (OVER.u.uPR) OVER.u.uPR.value = renderer.getPixelRatio();
  // the night sky first: it darkens the dome behind it (fx/sky.js), so the rain, the deck, the animals and the rest stand in front of it
  if (OVER.sky && OVER.sky.visible) { renderer.autoClear = false; renderer.render(OVER.skyScene, camera); renderer.autoClear = true; }
  drawRain(); drawDeck(); drawPlane(); drawIss(); drawGardenBook(); drawClock(); drawPets();   // (the rain first: the deck, the 747 on its shelf and the animals stand in front of it)
  // the shelves' titles and the fireflies, then the book out of the shelf over them (sharp: it is not in the picture, so the
  // room's depth does not hide the titles behind it)
  if (any) { renderer.autoClear = false; renderer.render(OVER.scene, camera); renderer.autoClear = true; }
  drawSharpBooks();
  drawInspect();   // (the clock out of its shelf: over all of it, the room dimmed)
}

export { OVER, drawWords, relabelBooks };
