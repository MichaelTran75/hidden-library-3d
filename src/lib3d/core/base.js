import * as THREE from 'three';

/* Hidden Library · 3D library (ver 01)
   On wide screens the reading room is the interface: the categories are shelf sections (labels with leader lines),
   a click opens the section's card, a book being played comes off the shelf. The page's own data, audio engine,
   sidebar (with its record player) and now-playing bar are reused as they are.
   Follows the page's day/night switch (body.dark-mode, 4 s fade); renders smoothly while something moves and at
   ≤ 20 fps otherwise, and rests while the page is idle.                                                          */
const $ = id => document.getElementById(id);
const body = document.body;
const CANVAS = document.createElement('canvas'); CANVAS.id = 'lib3d'; CANVAS.setAttribute('aria-hidden', 'true'); body.prepend(CANVAS);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// a pause in the long build, so the page stays responsive: a message to itself (unlike a timer or scheduler.yield it is
// not held back to once a second while the tab is in the background, which made the build take seconds there)
const tick = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

/* ---------------------------------------------------------------- constants
   World: metres, x → right (bookshelf wall), y ↑, z → viewer. Camera of the
   reference painting stands at (0, 1.75, 0) looking −z.                    */
const R = {
  xL: -1.25,      // inner face of the left glass wall
  xS: 2.28,       // face of the tall bookshelf
  xW: 2.70,       // solid wall behind the bookshelf
  zB: -8.6,       // back glass wall
  zF: 2.4,        // front glass wall
  H: 6.2,         // ceiling
  caseTop: 2.68,  // top of the low bookcases under the back/front glass
  caseD: 0.36,
};
const REF = { w: 1562, h: 2000, f: 1520, px: 730, py: 960, eye: new THREE.Vector3(0, 1.75, 0) };

/* the page's opening (the room loads in turn, frame, bookcase, sofa,
   then the books fading in, the decorations after them, the words hidden till then): the loader's
   bar at the foot of the page counts up to 100 % (setLoad: each step of the building, then each part as it is shown,
   core/build.js and core/loop.js); the room's parts kept apart so they can be shown in turn (PARTS: the shelves, the
   furniture), each faded in (fx/post.js fadePicture). At 100 % the bar fades away and the words come in. */
const PARTS = { shelves: [], furniture: [] };
const LOAD = { to: 0, shown: 0, raf: 0, el: null, bar: null, pct: null, done: false };
function setLoad(p) {
  LOAD.to = Math.max(LOAD.to, Math.min(100, p));
  if (!LOAD.el) { LOAD.el = document.getElementById('lib3d-loader'); if (LOAD.el) { LOAD.bar = LOAD.el.querySelector('.l3-bar i'); LOAD.pct = LOAD.el.querySelector('.l3-pct'); LOAD.el.classList.add('is-live'); } }
  if (!LOAD.raf) LOAD.raf = requestAnimationFrame(loadTick);
}
function loadTick() {
  LOAD.raf = 0; const d = LOAD.to - LOAD.shown; LOAD.shown = d < 0.4 ? LOAD.to : LOAD.shown + d * 0.16;
  if (LOAD.bar) LOAD.bar.style.width = LOAD.shown.toFixed(1) + '%'; if (LOAD.pct) LOAD.pct.textContent = Math.round(LOAD.shown) + '%';
  if (LOAD.shown < LOAD.to) { LOAD.raf = requestAnimationFrame(loadTick); return; }
  if (LOAD.shown >= 100 && !LOAD.done) { LOAD.done = true; const h = document.documentElement; h.classList.add('l3-loaded'); setTimeout(() => h.classList.remove('l3-loading'), 900); }
}

/* A file the page keeps apart: next to it on GitHub Pages (its element's data-src), inline as base64 in the one-file
   page. fetchAhead asks for the ones next to the page before their turn (core/loop.js: the models on display and the
   animals, once the first picture is up and the network has nothing else to bring); fileBytes hands that answer over,
   once, or asks then. */
const AHEAD = new Map();
function fileBytes(id) {
  const el = document.getElementById(id); if (!el) return Promise.resolve(null);
  if (AHEAD.has(id)) { const p = AHEAD.get(id); AHEAD.delete(id); return p; }
  if (el.dataset.src) return fetch(el.dataset.src).then(r => { if (!r.ok) throw new Error(id + ' ' + r.status); return r.arrayBuffer(); });
  const t = el.textContent.trim(); return t.length > 100 ? fetch('data:application/octet-stream;base64,' + t).then(r => r.arrayBuffer()) : Promise.resolve(null);
}
function fetchAhead(ids) { for (const id of ids) { const el = document.getElementById(id); if (!el || !el.dataset.src || AHEAD.has(id)) continue; const p = fileBytes(id); p.catch(() => {}); AHEAD.set(id, p); } }
export { CANVAS, LOAD, PARTS, R, REF, body, fetchAhead, fileBytes, reduceMotion, setLoad, tick };
