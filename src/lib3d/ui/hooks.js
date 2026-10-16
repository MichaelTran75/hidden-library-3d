import '../core/loop.js';   // build order: the module before this one runs first
import { CANVAS, body } from '../core/base.js';
import { RT_SCALE, camera, renderer, scene, setRtScale } from '../core/renderer.js';
import { MAT } from '../world/materials.js';
import { BOOK } from '../world/books.js';
import { SHELF } from '../world/shelves.js';
import { DECOR } from '../world/decor/kit.js';
import { LIGHTS } from '../world/lights.js';
import { POST } from '../fx/post.js';
import { CAM, applyRefCamera, applyView, goView, homeView, resize } from '../core/views.js';
import { NIGHT } from '../fx/night.js';
import { HOUR, applyHour, sunPlace } from '../fx/hour.js';
import { UIS, focusView, offMode, researchView } from './library.js';
import { relabelBooks } from './words.js';
import { HERO } from './hero-books.js';
import { drawAtlas } from './atlas.js';
import { canvas } from '../core/utils.js';
import { FLY } from '../fx/fireflies.js';
import { METEOR, SKYSET, STARU } from '../fx/sky.js';
import { DECK, togglePlayer } from './deck.js';
import { closeCard, openSection } from './overlay.js';
import { clock, draw, hold, loop, ready, setNeeds, setReady, start, updateOn } from '../core/loop.js';
import { PETS } from '../world/pets.js';
import { RAIN } from '../fx/rain.js';

/* ---------------------------------------------------------------- page hooks */
addEventListener('resize', () => {
  if (!ready) return; resize();
  if (CAM.k >= 1) { CAM.cur = UIS.open ? focusView(UIS.open) : UIS.mode === 'research' ? researchView() : homeView(); applyView(CAM.cur); }
  setNeeds(true); updateOn();
});
new MutationObserver(() => { setNeeds(true); updateOn(); if (offMode() && UIS.mode !== 'home') closeCard(); }).observe(body, { attributes: true, attributeFilter: ['class'] });
new MutationObserver(() => { relabelBooks(); setNeeds(true); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-lang'] });
document.addEventListener('visibilitychange', () => { setNeeds(true); });
CANVAS.addEventListener('webglcontextlost', e => { e.preventDefault(); setReady(false); renderer.setAnimationLoop(null); updateOn(); document.documentElement.classList.add('lib3d-failed'); });
window.__lib3d = { PETS, RAIN, METEOR, STARU, SKYSET, clock, FLY, DECOR, DECK, togglePlayer, state: () => ({ ready, hold, scale: RT_SCALE }), setRtScale, BOOK, SHELF, HERO, scene, camera, renderer, LIGHTS, MAT, POST, NIGHT, HOUR, UIS, CAM, applyHour, sunPlace, setClock: d => { HOUR.pin = d ? new Date(d) : null; setNeeds(true); }, draw, resize, applyRefCamera, openSection, closeCard, goView, homeView, focusView, loop,
  atlas: (which, lang, w = 1024, h = 1371) => { const c = canvas(w, h), t0 = performance.now(); drawAtlas(c, which, lang); return { url: c.toDataURL('image/png'), ms: performance.now() - t0 }; } };   // (tests: the Geography books' page on its own)
// The page's day/night switch, pressed by hand, always sets the room's light: a ?at= hour (a preview link) is let go, and
// the room follows the switch as it does without one (G, 16/10/2026: the switch did nothing on such a link). And a page
// opened with ?at= starts in the theme of that hour, as the room does (the page's own rule: dark from sunset to sunrise
// where the visitor is, src/sun), set through the switch itself so the page keeps it.
const THEME = { box: document.getElementById('checkbox'), sync: false };
if (THEME.box) THEME.box.addEventListener('change', () => { if (!THEME.sync && HOUR.pin) { HOUR.pin = null; setNeeds(true); } });
function themeFromPin() {
  if (!HOUR.pin || !THEME.box) return;
  const dark = !window.HL_SUN.isDay(HOUR.pin);
  if (THEME.box.checked === dark) return;
  THEME.sync = true; THEME.box.checked = dark; THEME.box.dispatchEvent(new Event('change', { bubbles: true })); THEME.sync = false;
}
(window.requestIdleCallback || (fn => setTimeout(fn, 300)))(() => start().then(themeFromPin).catch(e => {
  console.warn('3D library unavailable', e); setReady(false); updateOn(); document.documentElement.classList.add('lib3d-failed');
}), { timeout: 800 });
