import * as THREE from 'three';

/* Hidden Library · 3D library (ver 01)
   On wide screens the reading room is the interface: the categories are shelf sections (labels with leader lines),
   a click opens the section's card, a book being played comes off the shelf. The page's own data, audio engine,
   sidebar (with its record player) and now-playing bar are reused as they are.
   Follows the page's day/night switch (body.dark-mode, 4 s fade); renders smoothly while something moves and at
   ≤ 20 fps otherwise, and rests while the page is idle.                                                          */
const $ = id => document.getElementById(id);
const body = document.body;
const setLoad = () => {};
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

export { CANVAS, R, REF, body, reduceMotion, setLoad, tick };
