// three.js is fetched only where the room is shown (wide screens with WebGL 2): phones never download it. If it cannot
// be fetched (offline, a blocked CDN) the page gets lib3d-failed and keeps its own card layout.
const LIB = innerWidth > 768 && window.WebGL2RenderingContext ? await Promise.all([
  import('three'), import('three/addons/environments/RoomEnvironment.js'), import('three/addons/libs/meshopt_decoder.module.js'), import('three/addons/lights/RectAreaLightUniformsLib.js'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/postprocessing/Pass.js'), import('three/addons/utils/BufferGeometryUtils.js')
]).catch(e => { console.warn('3D library unavailable', e); document.documentElement.classList.add('lib3d-failed'); return null; }) : null;
if (LIB) {
const [THREE, { RoomEnvironment }, { MeshoptDecoder }, { RectAreaLightUniformsLib }, { GLTFLoader }, { FullScreenQuad }, { mergeGeometries }] = LIB;
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
/* ---------------------------------------------------------------- utils */
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(20261012);
const rr = (a, b) => a + (b - a) * rand();
const pick = arr => arr[Math.floor(rand() * arr.length)];
// value noise (tileable over period p); the wood's painters run these in workers too, as their source (world/textures.js)
const PERM = new Uint8Array(512); { const r = rng(7); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
const fade = t => t * t * (3 - 2 * t);
function vnoise(x, y, px = 256, py = 256) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (i, j) => PERM[(PERM[((i % px) + px) % px & 255] + (((j % py) + py) % py & 255)) & 511] / 255;
  const u = fade(xf), v = fade(yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
function fbm(x, y, oct = 4, px = 256, py = 256) { let s = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, y * f, px * f, py * f); n += a; a *= 0.5; f *= 2; } return s / n; }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctex(c, { srgb = true, rep = true } = {}) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
const hsl = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l);

/* Box with world-scaled UVs: v runs along the longest in-plane side, 1 UV = `tile` metres */
function boardGeo(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d); const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)) > 0.5 ? 0 : Math.abs(n.getY(i)) > 0.5 ? 1 : 2;
    const c = [p.getX(i), p.getY(i), p.getZ(i)], sz = [w, h, d];
    const axes = [0, 1, 2].filter(k => k !== ax).sort((a, b) => sz[a] - sz[b]);
    uv.setXY(i, (c[axes[0]] + 7.31 * ax) / tile, (c[axes[1]] + 3.7 * ax) / tile);
  }
  return g;
}
function place(geo, x, y, z, ry = 0) { const g = geo.clone(); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; }
/* ---------------------------------------------------------------- textures
   The room's wood (floor, ceiling, oak, frames) is painted pixel by pixel, 1.6 million of them: in workers while the
   room is built (G, 17/10/2026: the room shows sooner; on the page's own thread they held it up about 0.35 s). Where a
   worker cannot be started, or fails, what is left is painted here as before. Both run the same painters (the workers
   are given this file's functions as their source), so the pictures come out the same to the byte. */
function hue2rgb(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t); return p; }
function hslRgb(h, s, l, o) {   // HSL (hue in degrees) to RGB 0..1, into o: three's Color.setHSL in the working space (no transfer), without three
  h = (h / 360 % 1 + 1) % 1; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  if (s === 0) { o[0] = o[1] = o[2] = l; return o; }
  const p = l <= 0.5 ? l * (1 + s) : l + s - l * s, q = 2 * l - p;
  o[0] = hue2rgb(q, p, h + 1 / 3); o[1] = hue2rgb(q, p, h); o[2] = hue2rgb(q, p, h - 1 / 3); return o;
}
// the painters: RGBA into d, the rows y0 to y1 of a w × h picture (a band of it: the floor is shared out among the workers)
function paintPlanks(d, { w = 512, h = 2048, planks = 6, hue = 33, sat = .52, light = .60, vary = .07, seed = 3, gap = 0.42, grain = 1, y0 = 0, y1 = h } = {}) {
  const r = rng(seed), pw = w / planks, segs = [], col = [0, 0, 0];
  for (let i = 0; i < planks; i++) { const list = []; let v = r() * h; const start = v; while (v < start + h) { const len = (0.22 + r() * 0.35) * h; list.push({ a: v, b: v + len, l: light + (r() - .5) * 2 * vary, hu: hue + (r() - .5) * 6, s: sat + (r() - .5) * .12, k: r() * 100 }); v += len; } segs.push(list); }
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    const i = Math.floor(x / pw), lx = x - i * pw; let seg = null, yy = y;
    for (const s of segs[i]) { let t = yy; if (t < s.a) t += h; if (t >= s.a && t < s.b) { seg = s; yy = t; break; } }
    if (!seg) seg = segs[i][0];
    const ux = lx / pw;
    const wob = fbm(ux * 2 + seg.k, yy / h * 3, 3) * 3.0;
    const streak = fbm((ux * 26 + wob) * grain + seg.k, yy / h * 2.5, 4, 1024, 1024);
    const ring = 0.5 + 0.5 * Math.sin((ux * 9 + wob * 2.2 + fbm(yy / h * 4, seg.k) * 4) * 3.1);
    let l = seg.l * (0.86 + 0.22 * streak) * (0.93 + 0.08 * ring);
    const edge = Math.min(lx, pw - lx), endD = Math.min(Math.abs(yy - seg.a), Math.abs(seg.b - yy));
    if (edge < 1.2 || endD < 1.2) l *= gap; else if (edge < 4) l *= 0.94 + 0.015 * edge;
    hslRgb(seg.hu + (streak - .5) * 4, seg.s, Math.min(.92, l), col);
    const o = ((y - y0) * w + x) * 4; d[o] = col[0] * 255; d[o + 1] = col[1] * 255; d[o + 2] = col[2] * 255; d[o + 3] = 255;
  }
  return d;
}
function paintGrain(d, { w = 256, h = 1024, hue = 32, sat = .55, light = .58, seed = 9, y0 = 0, y1 = h } = {}) {
  const col = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h; const wob = fbm(u * 3 + seed, v * 2, 3, 3, 2) * 2.2;
    const s = fbm(u * 18 + wob, v * 3, 4, 18, 3); const ring = 0.5 + 0.5 * Math.sin((u * 7 + wob * 1.6) * 6.283);
    hslRgb(hue + (s - .5) * 5, sat, light * (0.84 + 0.24 * s) * (0.94 + 0.07 * ring), col);
    const o = ((y - y0) * w + x) * 4; d[o] = col[0] * 255; d[o + 1] = col[1] * 255; d[o + 2] = col[2] * 255; d[o + 3] = 255;
  }
  return d;
}
const PAINTERS = { planks: paintPlanks, grain: paintGrain };
function painterSource() {   // a worker's script: the painters and the noise they draw on, as written here
  return [`const PERM = new Uint8Array([${PERM}]), fade = ${fade};`, rng, vnoise, fbm, hue2rgb, hslRgb, paintPlanks, paintGrain,
    'const PAINTERS = { planks: paintPlanks, grain: paintGrain };',
    'onmessage = e => { const { kind, o } = e.data, d = PAINTERS[kind](new Uint8ClampedArray(o.w * (o.y1 - o.y0) * 4), o); postMessage(d, [d.buffer]); };'].join('\n');
}
// pictures [{ kind, o: { w, h, …painter's options }, bands }] → a promise of their pixels (RGBA, top row first), each
// painted in `bands` bands of rows, shared out among up to three workers as they come free
function paintPictures(list) {
  const jobs = [], out = list.map(p => p.bands > 1 ? new Uint8ClampedArray(p.o.w * p.o.h * 4) : null);
  list.forEach((p, k) => { const n = p.bands || 1; for (let b = 0; b < n; b++) jobs.push({ k, kind: p.kind, o: { ...p.o, y0: Math.round(p.o.h * b / n), y1: Math.round(p.o.h * (b + 1) / n) } }); });
  return new Promise(done => {
    let next = 0, left = jobs.length, url = null, alive = 0, here = false;
    const finish = (j, d) => { if (out[j.k]) out[j.k].set(d, j.o.y0 * j.o.w * 4); else out[j.k] = d; if (--left === 0) { if (url) URL.revokeObjectURL(url); done(out); } };
    const paintHere = async () => {   // (no worker: the rest on this thread, a pause between pictures)
      if (here) return; here = true;
      while (next < jobs.length) { const j = jobs[next++]; finish(j, PAINTERS[j.kind](new Uint8ClampedArray(j.o.w * (j.o.y1 - j.o.y0) * 4), j.o)); await tick(); }
    };
    const n = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)), workers = [];
    try { url = URL.createObjectURL(new Blob([painterSource()], { type: 'text/javascript' })); for (let i = 0; i < n; i++) workers.push(new Worker(url)); }
    catch (e) { for (const w of workers) w.terminate(); workers.length = 0; }
    alive = workers.length; if (!alive) { paintHere(); return; }
    for (const w of workers) {
      let cur = null;
      const give = () => { cur = next < jobs.length ? jobs[next++] : null; if (cur) w.postMessage({ kind: cur.kind, o: cur.o }); else { w.terminate(); alive--; } };
      w.onmessage = e => { const j = cur; give(); finish(j, e.data); };
      w.onerror = e => { e.preventDefault(); w.terminate(); if (cur) jobs.push(cur); cur = null; if (--alive === 0 && left) paintHere(); };   // (its picture to another, or here)
      give();
    }
  });
}
/* ---------------------------------------------------------------- renderer */
// the canvas itself needs no depth or stencil buffer: the scene renders into its own target, everything after is flat
const renderer = new THREE.WebGLRenderer({ canvas: CANVAS, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
// the watercolour picture is made at 1 px per CSS px (it softens everything anyway) and scaled up to the canvas, which
// holds device pixels: the sharp layer drawn over it (titles on the books, stars, the moon) stays crisp on high-DPI screens
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
// the scene itself renders at 80 % and is upsampled by the paint pass; a GPU that falls behind gets less (adaptQuality)
let RT_SCALE = 0.8;
try {   // a step down is remembered for a week (a laptop may only have been slowed for a while, e.g. on battery saving)
  const q = JSON.parse(localStorage.getItem('hiddenLibrary.lib3dScale'));
  if (q && q.s >= 0.5 && q.s < 0.8 && Date.now() - q.t < 7 * 864e5) RT_SCALE = q.s;
} catch (e) { /* storage blocked or old value */ }
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;        // the room stands still: shadows are redrawn only when a book moves (shadowsDirty)
let shadowsDirty = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // done in the final pass
RectAreaLightUniformsLib.init();
// The windows' area lights shine on everything as a diffuse glow; their glossy reflections (a second, as costly LTC
// integral per light and pixel) are kept for the glass only (RECT_SPEC): on the rough wood, books and velvet they were
// ~2 % of the picture and ~2 ms of a frame. The exposure is raised a touch to make up the light they gave.
{ const spec = 'reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );';
  if (THREE.ShaderChunk.lights_physical_pars_fragment.includes(spec))
    THREE.ShaderChunk.lights_physical_pars_fragment = THREE.ShaderChunk.lights_physical_pars_fragment.replace(spec, '#ifdef RECT_SPEC\n' + spec + '\n#endif'); }
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);

// other modules change these through a setter (an imported binding is read-only)
function setShadowsDirty(v) { shadowsDirty = v; }
function setRtScale(v) { RT_SCALE = v; }
/* ---------------------------------------------------------------- materials */
// the wood is painted in workers (textures.js) while the room is built: the textures are made at once, for the
// materials, and their pixels come in later (the promise returned, awaited before the room is first drawn)
const TEX = {};
function buildTextures() {
  const PICS = [
    ['floor', 'planks', { w: 512, h: 2048, hue: 28, sat: .55, light: .5, vary: .06, seed: 3 }, 4],   // (in four bands: the largest)
    ['ceil', 'planks', { w: 256, h: 1024, planks: 8, hue: 27, sat: .5, light: .42, vary: .035, seed: 11, gap: .6, grain: 1.4 }],   // mostly out of view: half size
    ['oak', 'grain', { w: 256, h: 1024, hue: 29, sat: .5, light: .5 }],
    ['frame', 'grain', { w: 256, h: 1024, hue: 25, sat: .52, light: .42, seed: 4 }],
  ];
  for (const [k] of PICS) TEX[k] = ctex();
  TEX.floor.repeat.set(1 / 1.08, 1 / 4.32); TEX.ceil.repeat.set(1 / 1.08, 1 / 4.32);
  return paintPictures(PICS.map(([, kind, o, bands]) => ({ kind, o, bands })))
    .then(px => PICS.forEach(([k, , o], i) => { TEX[k].image = new ImageData(px[i], o.w, o.h); TEX[k].needsUpdate = true; }));
}
const MAT = {};
function buildMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: .8, metalness: 0, ...o });
  MAT.floor = std({ map: TEX.floor, bumpMap: TEX.floor, bumpScale: 0.6, roughness: .55 });
  MAT.ceil = std({ map: TEX.ceil, roughness: .8 });
  MAT.oak = std({ map: TEX.oak, roughness: .62 });
  MAT.oakDark = std({ map: TEX.oak, color: 0xb98d62, roughness: .7 });
  MAT.shelfBack = std({ map: TEX.oak, color: 0x5e4430, roughness: .85 });
  MAT.frame = std({ map: TEX.frame, roughness: .55 });
  MAT.glass = new THREE.MeshPhysicalMaterial({ color: 0xf2f7ee, roughness: .04, metalness: 0, transparent: true, opacity: .1, envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide });
  MAT.glass.defines = { RECT_SPEC: '' };   // the panes keep the windows' reflections
  MAT.velvet = new THREE.MeshPhysicalMaterial({ color: 0x3d5638, roughness: .8, sheen: 1, sheenRoughness: .42, sheenColor: new THREE.Color(0x98ad85), side: THREE.DoubleSide });
  MAT.velvetDark = new THREE.MeshPhysicalMaterial({ color: 0x2b432b, roughness: .8, sheen: 1, sheenRoughness: .5, sheenColor: new THREE.Color(0x87a877), side: THREE.DoubleSide });
  MAT.mustard = new THREE.MeshPhysicalMaterial({ color: 0xb07a38, roughness: .75, sheen: .8, sheenRoughness: .5, sheenColor: new THREE.Color(0xf3d9a0), side: THREE.DoubleSide });
  MAT.copper = new THREE.MeshPhysicalMaterial({ color: 0xa8603a, metalness: .75, roughness: .38, envMapIntensity: .8, side: THREE.DoubleSide });
  MAT.brass = std({ color: 0xb48a4a, metalness: 1, roughness: .35 });
  MAT.bronze = std({ color: 0x6d5236, metalness: .8, roughness: .45 });
  MAT.shade = new THREE.MeshStandardMaterial({ color: 0xf0d9a8, roughness: .9, emissive: 0xffaa55, emissiveIntensity: 1.25, side: THREE.DoubleSide });
  MAT.bulb = new THREE.MeshBasicMaterial({ color: 0xfff1d0 });
  MAT.white = std({ color: 0xeee9df, roughness: .7 });
  MAT.plaster = std({ color: 0xe9e3d6, roughness: .85 });
  MAT.ceramic = std({ color: 0xe8e2d4, roughness: .35 });
  MAT.stone = std({ color: 0x8c8a84, roughness: .9 });
  MAT.terracotta = std({ color: 0xa9643f, roughness: .85 });
}
/* ---------------------------------------------------------------- room */
const room = new THREE.Group(); scene.add(room);
function buildRoom() {
  const L = R.zF - R.zB, Wd = R.xW - R.xL;
  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(Wd + 0.4, L + 0.4), MAT.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.set((R.xL + R.xW) / 2, 0, (R.zB + R.zF) / 2); floor.receiveShadow = true;
  { const uv = floor.geometry.attributes.uv, p = floor.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getY(i)); }
  room.add(floor);
  // ceiling planks + edge fascia
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(Wd + 0.4, L + 0.4), MAT.ceil);
  ceil.rotation.x = Math.PI / 2; ceil.position.set((R.xL + R.xW) / 2, R.H, (R.zB + R.zF) / 2); ceil.receiveShadow = true; ceil.castShadow = true;
  { const uv = ceil.geometry.attributes.uv, p = ceil.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getY(i)); }
  room.add(ceil);
  const beams = [];
  beams.push(place(boardGeo(0.16, 0.24, L + 0.3, 1), R.xL + 0.02, R.H - 0.12, (R.zB + R.zF) / 2));
  beams.push(place(boardGeo(Wd, 0.24, 0.16, 1), (R.xL + R.xW) / 2, R.H - 0.12, R.zB + 0.02));
  beams.push(place(boardGeo(Wd, 0.24, 0.16, 1), (R.xL + R.xW) / 2, R.H - 0.12, R.zF - 0.02));
  // ---- glass walls with wooden frames
  const fr = [], gl = [];
  const post = (x, z, h, w = 0.11, d = 0.15, y0 = 0) => fr.push(place(boardGeo(w, h, d, 1), x, y0 + h / 2, z));
  const rail = (x0, x1, z0, z1, y, t = 0.1, d = 0.15) => { const len = Math.hypot(x1 - x0, z1 - z0); const g = boardGeo(len, t, d, 1); g.rotateY(-Math.atan2(z1 - z0, x1 - x0)); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); fr.push(g); };
  // left wall (x = xL), posts along z
  const LZ = [R.zB, -6.6, -4.55, -2.95, -1.35, 0.4, R.zF];
  const gx = R.xL - 0.06;
  for (const z of LZ) post(gx, z, R.H, (z === R.zB || z === R.zF) ? 0.16 : 0.11, 0.16);
  rail(gx, gx, R.zB, R.zF, 0.04, 0.08, 0.2);           // sill
  rail(gx, gx, R.zB, R.zF, R.caseTop, 0.12, 0.17);    // transom
  rail(gx, gx, R.zB, R.zF, R.H - 0.06, 0.12, 0.17);   // head
  // sliding door between −4.55 and −2.95 : stiles + handle
  post(gx + 0.035, -4.48, R.caseTop - 0.1, 0.06, 0.09, 0.05); post(gx + 0.035, -3.02, R.caseTop - 0.1, 0.06, 0.09, 0.05);
  rail(gx + 0.035, gx + 0.035, -4.5, -3.0, 0.16, 0.12, 0.06); rail(gx + 0.035, gx + 0.035, -4.5, -3.0, R.caseTop - 0.1, 0.07, 0.06);
  for (let i = 0; i < LZ.length - 1; i++) { const z0 = LZ[i], z1 = LZ[i + 1]; for (const [y0, y1] of [[0.08, R.caseTop - 0.06], [R.caseTop + 0.06, R.H - 0.12]]) { const g = new THREE.PlaneGeometry(z1 - z0, y1 - y0); g.rotateY(Math.PI / 2); g.translate(gx, (y0 + y1) / 2, (z0 + z1) / 2); gl.push(g); } }
  // back + front walls: glass above the low bookcases
  for (const [zw, s] of [[R.zB - 0.02, 1], [R.zF + 0.02, -1]]) {
    const MX = [R.xL, 0.05, 1.15, R.xS];
    for (const x of MX) post(x, zw, R.H - R.caseTop, x === R.xL || x === R.xS ? 0.16 : 0.11, 0.16, R.caseTop);
    rail(R.xL, R.xW, zw, zw, R.caseTop + 0.04, 0.1, 0.18); rail(R.xL, R.xW, zw, zw, R.H - 0.06, 0.12, 0.18);
    for (let i = 0; i < MX.length - 1; i++) { const g = new THREE.PlaneGeometry(MX[i + 1] - MX[i], R.H - R.caseTop - 0.16); g.translate((MX[i] + MX[i + 1]) / 2, (R.caseTop + R.H) / 2, zw); gl.push(g); }
    // wall behind bookcase (solid, timber clad on the outside)
    const back = new THREE.Mesh(boardGeo(R.xW - R.xL, R.caseTop, 0.08, 1), MAT.shelfBack); back.position.set((R.xL + R.xW) / 2, R.caseTop / 2, zw - s * 0.06); back.receiveShadow = back.castShadow = true; room.add(back);
  }
  const frames = new THREE.Mesh(mergeGeometries([...fr, ...beams]), MAT.frame); frames.castShadow = frames.receiveShadow = true; room.add(frames);
  const glass = new THREE.Mesh(mergeGeometries(gl), MAT.glass); glass.renderOrder = 2; room.add(glass); room.userData.glass = glass;   // (its glass: fx/glass.js)
  // handle
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 10), MAT.bronze); handle.position.set(gx + 0.09, 1.05, -4.42); room.add(handle);
  // right solid wall (behind bookshelf)
  const rw = new THREE.Mesh(boardGeo(0.1, R.H, L, 1), MAT.oakDark); rw.position.set(R.xW + 0.05, R.H / 2, (R.zB + R.zF) / 2); rw.receiveShadow = rw.castShadow = true; room.add(rw);   // it keeps out the morning sun
}
/* ---------------------------------------------------------------- books (instanced) */
const BOOK = { list: [], atlas: null };
const SPINES = 12;
function buildSpineAtlas() {
  const W = 1024, H = 1024, col = canvas(W, H), msk = canvas(W, H); const g = col.getContext('2d'), m = msk.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); m.fillStyle = '#fff'; m.fillRect(0, 0, W, H);
  const r = rng(77); const cw = 64;
  for (let i = 0; i < SPINES; i++) {
    const x0 = i * cw; const style = i % 6;
    // subtle cloth texture
    for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(0,0,0,${r() * .05})`; g.fillRect(x0 + r() * cw, r() * H, 1 + r() * 2, 1 + r() * 6); }
    const band = (y, h, c, tint = true) => { g.fillStyle = c; g.fillRect(x0 + 3, y, cw - 6, h); if (!tint) { m.fillStyle = '#000'; m.fillRect(x0 + 3, y, cw - 6, h); } };
    const label = (y, h, c) => { g.fillStyle = c; g.fillRect(x0 + 8, y, cw - 16, h); m.fillStyle = '#000'; m.fillRect(x0 + 8, y, cw - 16, h); };
    const lines = (y, n, c, tint) => { for (let k = 0; k < n; k++) { const w = (cw - 24) * (0.5 + r() * .5); g.fillStyle = c; g.fillRect(x0 + (cw - w) / 2, y + k * 26, w, 9); if (!tint) { m.fillStyle = '#000'; m.fillRect(x0 + (cw - w) / 2, y + k * 26, w, 9); } } };
    const gold = '#d8b673', dark = 'rgba(0,0,0,.35)', light = 'rgba(255,255,255,.55)';
    if (style === 0) { band(60, 14, gold, false); band(90, 6, gold, false); lines(260, 4, gold, false); band(880, 6, gold, false); band(900, 14, gold, false); }
    if (style === 1) { label(180, 230, '#efe6d2'); lines(210, 5, '#5a4632', false); band(940, 30, dark); }
    if (style === 2) { band(0, 120, dark); lines(300, 6, light, true); band(904, 120, dark); }
    if (style === 3) { lines(120, 7, '#1d1d1d', false); band(860, 70, light); }
    if (style === 4) { band(50, 40, dark); band(110, 8, gold, false); lines(380, 3, gold, false); band(930, 40, dark); }
    if (style === 5) { lines(140, 9, light, true); label(820, 90, '#f3efe4'); }
  }
  // tile 13: plain cover (tinted) ; tile 14-15 region: page block (untinted, with tinted rims)
  const px = 13 * cw; g.fillStyle = '#fff'; g.fillRect(px, 0, cw, H);
  const pg = 14 * cw; g.fillStyle = '#efe7d3'; g.fillRect(pg, 0, 2 * cw, H); m.fillStyle = '#000'; m.fillRect(pg, 0, 2 * cw, H);
  for (let k = 0; k < 220; k++) { g.fillStyle = `rgba(110,90,60,${.05 + r() * .12})`; g.fillRect(pg + 6 + r() * (2 * cw - 12), 0, 1, H); }
  g.fillStyle = '#fff'; g.fillRect(pg, 0, 6, H); g.fillRect(pg + 2 * cw - 6, 0, 6, H); m.fillStyle = '#fff'; m.fillRect(pg, 0, 6, H); m.fillRect(pg + 2 * cw - 6, 0, 6, H);
  const a = g.getImageData(0, 0, W, H).data, b = m.getImageData(0, 0, W, H).data; const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, o = ((H - 1 - y) * W + x) * 4; data[o] = a[i * 4]; data[o + 1] = a[i * 4 + 1]; data[o + 2] = a[i * 4 + 2]; data[o + 3] = b[i * 4]; }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
function bookGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, -0.5); // origin: bottom centre of the spine face; spine faces +z
  const uv = g.attributes.uv, cw = 64 / 1024;
  // BoxGeometry faces: +x,-x,+y,-y,+z,-z ; 4 verts each
  const set = (face, u0, u1, v0, v1, rot = false) => { for (let k = 0; k < 4; k++) { const i = face * 4 + k; const u = uv.getX(i), v = uv.getY(i); const a = rot ? v : u, b = rot ? u : v; uv.setXY(i, u0 + (u1 - u0) * a, v0 + (v1 - v0) * b); } };
  set(0, 13 * cw + .004, 14 * cw - .004, 0, 1); set(1, 13 * cw + .004, 14 * cw - .004, 0, 1); // covers
  set(2, 14 * cw, 16 * cw, 0, 1); set(3, 14 * cw, 16 * cw, 0, 1);              // top / bottom page edges
  set(4, 0.002, cw - .002, 0, 1);                                                         // spine (variant shift in shader)
  set(5, 14 * cw + 8 / 1024, 16 * cw - 8 / 1024, 0, 1);                                    // fore-edge
  return g;
}
function bookMaterial(atlas) {
  const m = new THREE.MeshStandardMaterial({ map: atlas, roughness: .78, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aVar;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n if (vMapUv.x < 0.0625) vMapUv.x += aVar * 0.0625;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      vec4 bk = texture2D( map, vMapUv );
      vec3 tint = vec3(1.0);
      #if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
        tint = vColor.rgb;
      #endif
      diffuseColor.rgb *= mix( bk.rgb, bk.rgb * tint, bk.a );`).replace('#include <color_fragment>', '');
  };
  return m;
}
const PAL = {
  modern: ['#ebe6da', '#f1eee6', '#e2dccd', '#d6d0c2', '#ece7dc', '#4f8a8b', '#3c7377', '#2c3e5a', '#3b5578', '#7c90a4', '#b8bcbf', '#9aa4a8', '#2b2b2b', '#c49b4c', '#a6593d', '#8ba08a', '#e7e1d2', '#5f7c91', '#d9d4c6', '#6d8f8f'],
  old: ['#6b4a32', '#7c5a3c', '#4e3526', '#2e3b55', '#6e2f2f', '#3f5340', '#b8a487', '#6f6f6a', '#a8322d', '#8b6b48', '#3a2e28', '#556a7a', '#9b8a6a', '#c9b48e', '#5b4636', '#2f4a4a', '#7a3b2b', '#cfc2a2'],
};
/* fill one shelf cell; o = left-bottom-front corner, along = unit axis to the right, out = spine normal (into the room) */
function fillCell(o, along, out, len, hgt, dep, pal, opt = {}) {
  const up = new THREE.Vector3(0, 1, 0); const B = new THREE.Matrix4().makeBasis(along, up, out).setPosition(o);
  if (opt.cell) { opt.cell.B = B; opt.cell.len = len; }   // for refitCell
  const maxH = Math.min(hgt - 0.02, 0.34); const gapChance = opt.gaps ?? 0.05, stackChance = opt.stack ?? 0.05;
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  const push = (M, col, v, up = false) => BOOK.list.push({ m: B.clone().multiply(M), c: new THREE.Color(col).offsetHSL(0, rr(-.04, .04), rr(-.05, .04)), v, up, cell: opt.cell || null });
  let x = rr(0, 0.02), lastUp = null;
  while (x < len - 0.02) {
    const roll = rand();
    if (roll < stackChance && len - x > 0.3) {                       // horizontal stack, spines to the room
      const n = 2 + Math.floor(rand() * 4), w = rr(0.19, 0.26), d0 = Math.min(dep - 0.02, rr(0.15, 0.21)); let y = 0;
      for (let k = 0; k < n && y < hgt - 0.07; k++) {
        const t = rr(0.022, 0.05), h = w + rr(-.02, .02), d = d0 + rr(-.015, .01), yaw = rr(-.07, .07);
        const cx = x + w / 2, cy = y + t / 2, cz = -d / 2 - 0.004;
        const M = T(cx, cy, cz).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(T(h / 2, 0, d / 2)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(t, h, d));
        push(M, pick(pal), Math.floor(rand() * SPINES)); y += t;
      }
      x += w + rr(0.01, 0.03); lastUp = null; continue;
    }
    if (roll < stackChance + gapChance) { x += rr(0.04, 0.12); lastUp = null; continue; }
    const t = rr(0.017, 0.05) * (rand() < .12 ? 1.5 : 1), h = Math.min(maxH, rr(0.2, 0.34)), d = Math.min(dep - 0.015, rr(0.13, 0.17) + h * 0.25);
    const b = { x: x + t / 2, t, h, d, inset: rr(0, 0.025), col: pick(pal), v: Math.floor(rand() * SPINES), lean: 0 };
    lastUp = b; b.idx = BOOK.list.length; push(T(b.x, 0, -b.inset).multiply(new THREE.Matrix4().makeScale(t, h, d)), b.col, b.v, true);
    x += t + (rand() < .25 ? rr(0.001, 0.006) : 0.0008);
  }
  // the last upright book leans on its left neighbour when there is space after it
  if (lastUp) {
    const xn = lastUp.x - lastUp.t / 2, avail = len - xn - 0.004;
    if (avail - lastUp.t > 0.03) {
      const phi = Math.min(0.38, Math.asin(Math.min(1, (avail - lastUp.t) / lastUp.h))) * rr(0.55, 1);
      const px = xn + lastUp.t * Math.cos(phi) + lastUp.h * Math.sin(phi);
      const M = T(px, 0, -lastUp.inset).multiply(new THREE.Matrix4().makeRotationZ(phi)).multiply(T(-lastUp.t / 2, 0, 0)).multiply(new THREE.Matrix4().makeScale(lastUp.t, lastUp.h, lastUp.d));
      BOOK.list[lastUp.idx].m = B.clone().multiply(M); BOOK.list[lastUp.idx].lean = true;
    }
  }
}
/* a cell packed again after some of its books changed size (a book of the page takes the thickness of its pages): the
   books keep their order and the gaps between them; what no longer fits at the right end is put away (only books that
   play nothing). sizes: Map of BOOK.list index -> { t, h }; keep: indices never put away. Returns the indices it moved. */
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
function refitCell(cell, sizes, keep = new Set()) {
  const inv = cell.B.clone().invert(), L = new THREE.Matrix4(), v = new THREE.Vector3(), ents = [];
  BOOK.list.forEach((b, idx) => {
    if (b.cell !== cell || b.hidden) return;
    L.multiplyMatrices(inv, b.m); let x0 = Infinity, x1 = -Infinity;
    for (let k = 0; k < 8; k++) { const x = v.set(k & 1 ? 0.5 : -0.5, k & 2 ? 1 : 0, k & 4 ? -1 : 0).applyMatrix4(L).x; x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    ents.push({ idx, b, x0, x1 });
  });
  ents.sort((a, b) => a.x0 - b.x0);
  const slots = [];   // runs of books side by side; a stack lying flat is one run
  for (const e of ents) { const s = slots[slots.length - 1]; if (s && e.x0 < s.x1 - 1e-4) { s.ents.push(e); s.x1 = Math.max(s.x1, e.x1); } else slots.push({ ents: [e], x0: e.x0, x1: e.x1 }); }
  slots.forEach((s, k) => { s.gap = k ? Math.max(0, s.x0 - slots[k - 1].x1) : 0; const e = s.ents.find(e => sizes.has(e.idx)); s.item = e || null; s.keep = s.ents.some(e => keep.has(e.idx) || sizes.has(e.idx));
    s.grow = e ? sizes.get(e.idx).t - (e.x1 - e.x0) : 0; s.w = s.x1 - s.x0 + s.grow; });
  const lay = () => { let x = slots.length ? slots[0].x0 : 0; for (const s of slots) { if (s.out) continue; s.nx0 = x + (s === slots[0] ? 0 : s.gap); x = s.nx0 + s.w; } return x; };
  while (lay() > cell.len - 0.002) { const s = [...slots].reverse().find(s => !s.out && !s.keep); if (!s) break; s.out = true; }
  const along = new THREE.Vector3().setFromMatrixColumn(cell.B, 0), moved = [];
  for (const s of slots) for (const e of s.ents) {
    if (s.out) { e.b.m.copy(ZERO_M); e.b.hidden = true; moved.push(e.idx); continue; }
    if (s.item === e) {   // an upright book: its frame in the cell is a translation and a scale
      const sz = sizes.get(e.idx); L.multiplyMatrices(inv, e.b.m); const z = L.elements[14], d = v.setFromMatrixColumn(L, 2).length();
      e.b.m.multiplyMatrices(cell.B, new THREE.Matrix4().makeTranslation(s.nx0 + (e.x0 - s.x0) + sz.t / 2, 0, z).multiply(new THREE.Matrix4().makeScale(sz.t, sz.h, sz.d || d)));   // (sz.d: a depth of its own, its spine where it was)
    } else {   // a book leaning on the resized one moves with its right side
      const dx = s.nx0 - s.x0 + (s.item && e.x0 > s.item.x0 ? s.grow : 0);
      e.b.m.premultiply(new THREE.Matrix4().makeTranslation(along.x * dx, along.y * dx, along.z * dx));
    }
    moved.push(e.idx);
  }
  return moved;
}
function buildBookInstances() {
  const geo = bookGeometry(); const n = BOOK.list.length;
  const mesh = new THREE.InstancedMesh(geo, bookMaterial(BOOK.atlas), n);
  const va = new Float32Array(n);
  BOOK.list.forEach((b, i) => { mesh.setMatrixAt(i, b.m); mesh.setColorAt(i, b.c); va[i] = b.v; });
  geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(va, 1));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; room.add(mesh); return mesh;
}
/* ---------------------------------------------------------------- shelves */
const SHELF = {};
function buildShelves() {
  const parts = [];
  // ---- tall bookshelf on the right wall: columns along z, rows along y
  const z0 = R.zB + 0.02, z1 = R.zF - 0.02, colW = 0.64, rowH = 0.37, dep = R.xW - R.xS, th = 0.028;
  const ncol = Math.round((z1 - z0) / colW), cw = (z1 - z0) / ncol; const nrow = Math.floor((R.H - 0.12) / rowH), rh = (R.H - 0.12) / nrow;
  const backPanel = new THREE.Mesh(boardGeo(0.02, R.H, z1 - z0, 1), MAT.shelfBack); backPanel.position.set(R.xW - 0.01, R.H / 2, (z0 + z1) / 2); backPanel.receiveShadow = true; room.add(backPanel);
  for (let i = 0; i <= ncol; i++) parts.push(place(boardGeo(dep, R.H, th, 1), R.xS + dep / 2, R.H / 2, z0 + i * cw));
  parts.push(place(boardGeo(dep + 0.01, 0.1, z1 - z0, 1), R.xS + dep / 2, 0.05, (z0 + z1) / 2)); // plinth
  for (let j = 1; j <= nrow; j++) parts.push(place(boardGeo(dep, th, z1 - z0, 1), R.xS + dep / 2, 0.1 + j * rh - (j === nrow ? 0.02 : 0), (z0 + z1) / 2));
  const along = new THREE.Vector3(0, 0, 1), out = new THREE.Vector3(-1, 0, 0);
  SHELF.R = { z0, cw, rh, th, dep, ncol, nrow };
  const decorRows = [6, 7, 8, 9];
  for (let i = 0; i < ncol; i++) for (let j = 0; j < nrow; j++) {
    const yb = 0.1 + j * rh + th / 2, len = cw - th, o = new THREE.Vector3(R.xS + 0.01, yb, z0 + i * cw + th / 2);
    const hgt = rh - th;
    if (decorRows.includes(j) && rand() < 0.42) { DECOR.push({ o, along, out, len, hgt, dep, kind: Math.floor(rand() * 6) }); continue; }
    if (j === nrow - 1 && rand() < .3) continue;
    fillCell(o, along, out, len, hgt, dep - 0.03, PAL.modern, { stack: j > 9 ? .08 : .05, cell: { shelf: 'R', i, j } });
  }
  // ---- low bookcases under back and front glass
  for (const [zf, s] of [[R.zB + R.caseD, 1], [R.zF - R.caseD, -1]]) {
    const zc = zf - s * R.caseD / 2; const X = [R.xL, 0.05, 1.15, R.xS];
    parts.push(place(boardGeo(R.xS - R.xL, 0.1, R.caseD, 1), (R.xL + R.xS) / 2, 0.05, zc));
    parts.push(place(boardGeo(R.xS - R.xL + 0.04, 0.045, R.caseD + 0.03, 1), (R.xL + R.xS) / 2, R.caseTop - 0.0225, zc + s * 0.015));
    for (const x of X) { const big = [R.xL, 0.05, 1.15, R.xS].includes(x); parts.push(place(boardGeo(big ? 0.05 : 0.028, R.caseTop, R.caseD, 1), x, R.caseTop / 2, zc)); }
    const rows = 7, rh2 = (R.caseTop - 0.145) / rows;
    if (s > 0) SHELF.B = { X, rh2, zf, th };
    for (let j = 1; j < rows; j++) parts.push(place(boardGeo(R.xS - R.xL, th, R.caseD, 1), (R.xL + R.xS) / 2, 0.1 + j * rh2, zc));
    const along2 = new THREE.Vector3(s, 0, 0), out2 = new THREE.Vector3(0, 0, s);
    for (let i = 0; i < X.length - 1; i++) for (let j = 0; j < rows; j++) {
      const xa = X[i] + 0.025, xb = X[i + 1] - 0.025; const len = xb - xa; const yb = 0.1 + j * rh2 + th / 2;
      const o = new THREE.Vector3(s > 0 ? xa : xb, yb, zf - s * 0.005);
      fillCell(o, along2, out2, len, rh2 - th, R.caseD - 0.03, PAL.old, { stack: .07, gaps: .04, cell: { shelf: s > 0 ? 'B' : 'F', i, j } });
    }
  }
  const shelves = new THREE.Mesh(mergeGeometries(parts), MAT.oak); shelves.castShadow = shelves.receiveShadow = true; room.add(shelves);
}
/* ---------------------------------------------------------------- decor on shelves
   Every decorated cell of the tall shelf holds a piece of its own, no two alike: a catalogue of vessels, pictures,
   figures, instruments, plants and small things is shuffled and dealt one per cell. Each piece is built in its own
   frame (x along the shelf, y up, +z toward the room; a cell leaves it about ±0.28 wide, 0.32 high, −0.2..+0.14 deep)
   from turned, box and sphere parts coloured per vertex. All the pieces are then merged by finish into five meshes
   (matte, glazed, metal, glass, pictures): the whole shelf of them costs five draw calls, and a new piece costs none.
   The pictures, the globe's map, the clock's dial, the plate's pattern and the radio's cloth share one canvas.  */
const DECOR = [];
const DK_Y = new THREE.Vector3(0, 1, 0), PAGES = 0xeee4cc;
function decorItem() {   // gathers a piece's parts: geometry (moved into the piece's frame), colour(s) and finish
  const parts = [], M = new THREE.Matrix4(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const add = (geo, col, fin = 'matte', o = {}) => {
    M.compose(P.set(...(o.p || [0, 0, 0])), o.q || new THREE.Quaternion().setFromEuler(E.set(...(o.r || [0, 0, 0]))), S.set(...(o.s || [1, 1, 1])));
    if (o.m) M.premultiply(o.m);
    geo.applyMatrix4(M); parts.push({ geo, col, fin, slot: o.slot || null }); return geo;
  };
  // a rod from a to b, radius r0 at a and r1 at b
  const rod = (a, b, r0, col, fin = 'matte', r1 = r0, seg = 8, m = null) => {
    const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A), L = d.length();
    return add(new THREE.CylinderGeometry(r1, r0, L, seg), col, fin, { p: A.addScaledVector(d, 0.5).toArray(), q: new THREE.Quaternion().setFromUnitVectors(DK_Y, d.normalize()), m });
  };
  // a book: standing with its spine to the room, or lying flat (spine to the room as well)
  const book = (w, h, d, cover, o = {}) => add(new THREE.BoxGeometry(w, h, d), o.lying ? [PAGES, PAGES, cover, cover, cover, PAGES] : [cover, cover, PAGES, PAGES, cover, PAGES], 'matte', o);
  // a picture in a frame, standing on its lower edge and leaning back against the shelf
  const frame = (w, h, col, slot, { fin = 'matte', b = 0.02, depth = 0.018, lean = 0.12, x = 0, z = 0, ry = 0, mount = 0 } = {}) => {
    const m = new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(ry)).multiply(new THREE.Matrix4().makeRotationX(-lean)).multiply(new THREE.Matrix4().makeTranslation(0, h / 2, 0));
    for (const s of [1, -1]) {
      add(new THREE.BoxGeometry(w, b, depth), col, fin, { p: [0, s * (h - b) / 2, 0], m });
      add(new THREE.BoxGeometry(b, h - 2 * b, depth), col, fin, { p: [s * (w - b) / 2, 0, 0], m });
    }
    add(new THREE.BoxGeometry(w - 2 * b + 0.002, h - 2 * b + 0.002, 0.004), 0x2a2420, 'matte', { p: [0, 0, -depth / 2 + 0.002], m });
    if (mount) add(new THREE.PlaneGeometry(w - 2 * b, h - 2 * b), 0xf3efe4, 'matte', { p: [0, 0, depth / 2 - 0.007], m });
    add(new THREE.PlaneGeometry(w - 2 * b - 2 * mount, h - 2 * b - 2 * mount), 0xffffff, 'art', { p: [0, 0, depth / 2 - 0.006], m, slot });
  };
  return { parts, add, rod, book, frame };
}
function dkLathe(pts, seg = 28) {   // a turned piece: profile [r, y] from the foot up, smoothed, closed at the foot
  const p = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(pts.length * 4).map(v => new THREE.Vector2(Math.max(0.0008, v.x), v.y));
  p.unshift(new THREE.Vector2(0.0008, pts[0][1]));
  return new THREE.LatheGeometry(p, seg);
}
const dkBall = (r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
const dkRing = (r, t, arc = Math.PI * 2, seg = 32) => new THREE.TorusGeometry(r, t, 6, seg, arc);
// the canvas for everything painted: 256 px slots on a 1024 px sheet
function decorAtlas() {
  const S = 256, N = 1024, c = canvas(N, N), g = c.getContext('2d'), r = rng(808), slots = {};
  const at = (name, i, j, w, h, paint) => {
    const x = i * S, y = j * S, W = w * S, H = h * S;
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, W, H); g.clip(); paint(W, H); g.restore();
    const e = 3 / N; slots[name] = [x / N + e, 1 - (y + H) / N + e, (x + W) / N - e, 1 - y / N - e];   // u0 v0 u1 v1 (the canvas is flipped)
  };
  const grad = (H, stops) => { const l = g.createLinearGradient(0, 0, 0, H); stops.forEach(([k, col]) => l.addColorStop(k, col)); return l; };
  const fill = (col, f) => { g.fillStyle = col; g.beginPath(); f(); g.fill(); };
  const ridge = (W, H, y0, amp, f, col) => fill(col, () => { g.moveTo(0, H); for (let x = 0; x <= W; x += 4) g.lineTo(x, y0 + Math.sin(x / W * f + y0) * amp + Math.sin(x / W * f * 2.7) * amp * 0.35); g.lineTo(W, H); });
  at('landscape', 0, 0, 1, 1, (W, H) => {   // summer hills under a low sun
    g.fillStyle = grad(H, [[0, '#9cc0d6'], [0.55, '#f1dcb0'], [1, '#f1dcb0']]); g.fillRect(0, 0, W, H);
    fill('#f5c060', () => g.arc(W * 0.7, H * 0.4, W * 0.07, 0, 7));
    ridge(W, H, H * 0.55, H * 0.05, 5, '#94ab7c'); ridge(W, H, H * 0.67, H * 0.05, 8, '#6d8d5a'); ridge(W, H, H * 0.82, H * 0.035, 3, '#c7a25a');
    g.fillStyle = '#4b3a28'; g.fillRect(W * 0.25, H * 0.6, W * 0.018, H * 0.12); fill('#3d6a3a', () => g.arc(W * 0.26, H * 0.57, W * 0.07, 0, 7));
  });
  at('sea', 1, 0, 1, 1, (W, H) => {   // a sail on a grey-blue sea
    g.fillStyle = grad(H, [[0, '#c9d5dc'], [0.5, '#eef0ea'], [0.52, '#5d86a0'], [1, '#2f5672']]); g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; for (let k = 0; k < 14; k++) { const y = H * (0.56 + k * 0.03), x = r() * W; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20 + r() * 40, y); g.stroke(); }
    fill('#3a2c22', () => { g.moveTo(W * 0.38, H * 0.6); g.lineTo(W * 0.62, H * 0.6); g.lineTo(W * 0.58, H * 0.64); g.lineTo(W * 0.42, H * 0.64); });
    fill('#f7f3ea', () => { g.moveTo(W * 0.5, H * 0.24); g.lineTo(W * 0.5, H * 0.58); g.lineTo(W * 0.66, H * 0.58); });
    fill('#e6ddca', () => { g.moveTo(W * 0.48, H * 0.3); g.lineTo(W * 0.48, H * 0.58); g.lineTo(W * 0.38, H * 0.58); });
  });
  at('abstract', 2, 0, 1, 1, (W, H) => {   // circles and a bar, after the Bauhaus prints
    g.fillStyle = '#efe5d0'; g.fillRect(0, 0, W, H);
    fill('#c4493a', () => g.arc(W * 0.42, H * 0.42, W * 0.26, 0, 7)); g.fillStyle = '#2d5a88'; g.fillRect(W * 0.52, H * 0.5, W * 0.3, H * 0.34);
    fill('#e5b43e', () => g.arc(W * 0.72, H * 0.28, W * 0.1, 0, 7)); g.fillStyle = '#1f1d1b'; g.fillRect(W * 0.12, H * 0.78, W * 0.62, H * 0.03);
  });
  at('fern', 3, 0, 1, 1, (W, H) => {   // a pressed fern on cream paper
    g.fillStyle = '#f3ecd9'; g.fillRect(0, 0, W, H); g.strokeStyle = '#4c6a3a'; g.fillStyle = '#5f8247'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(W * 0.5, H * 0.9); g.quadraticCurveTo(W * 0.42, H * 0.5, W * 0.56, H * 0.1); g.stroke();
    for (let k = 1; k < 15; k++) { const t = k / 15, x = W * (0.5 - 0.06 * Math.sin(t * 3)), y = H * (0.9 - 0.8 * t), l = W * 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      for (const s of [-1, 1]) { g.save(); g.translate(x, y); g.rotate(s * 1.0 - 0.15); g.beginPath(); g.ellipse(s * l / 2, 0, l / 2, l / 7, 0, 0, 7); g.fill(); g.restore(); } }
    g.fillStyle = '#6b5a44'; g.font = 'italic 16px Georgia'; g.fillText('Polypodium', W * 0.33, H * 0.97);
  });
  at('portrait', 0, 1, 1, 1, (W, H) => {   // a sepia portrait
    g.fillStyle = grad(H, [[0, '#cfae80'], [1, '#86653f']]); g.fillRect(0, 0, W, H);
    fill('#3a2a1c', () => { g.ellipse(W * 0.5, H * 0.4, W * 0.15, H * 0.19, 0, 0, 7); });
    fill('#3a2a1c', () => { g.moveTo(W * 0.12, H); g.quadraticCurveTo(W * 0.15, H * 0.62, W * 0.5, H * 0.6); g.quadraticCurveTo(W * 0.85, H * 0.62, W * 0.88, H); });
    fill('#e9dcc2', () => { g.moveTo(W * 0.45, H * 0.62); g.lineTo(W * 0.55, H * 0.62); g.lineTo(W * 0.5, H * 0.8); });
  });
  at('peaks', 1, 1, 1, 1, (W, H) => {   // a photograph of snowy peaks over a lake
    g.fillStyle = grad(H, [[0, '#b7c3cb'], [0.6, '#e2e6e6'], [0.61, '#8aa0ad'], [1, '#55707f']]); g.fillRect(0, 0, W, H);
    const peak = (x, y, w, col) => { fill(col, () => { g.moveTo(x - w, H * 0.6); g.lineTo(x, y); g.lineTo(x + w, H * 0.6); }); fill('#f4f4f1', () => { g.moveTo(x - w * 0.25, y + (H * 0.6 - y) * 0.25); g.lineTo(x, y); g.lineTo(x + w * 0.25, y + (H * 0.6 - y) * 0.25); }); };
    peak(W * 0.3, H * 0.22, W * 0.32, '#5b6875'); peak(W * 0.68, H * 0.3, W * 0.36, '#46525e');
    g.globalAlpha = 0.35; g.scale(1, -1); g.translate(0, -1.2 * H); peak(W * 0.3, H * 0.22, W * 0.32, '#5b6875'); peak(W * 0.68, H * 0.3, W * 0.36, '#46525e');
  });
  at('map', 2, 1, 1, 1, (W, H) => {   // an old chart: a coast, a grid and a compass rose
    g.fillStyle = '#e6d6ab'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(150,110,60,.12)'; g.beginPath(); g.arc(r() * W, r() * H, 20 + r() * 50, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(110,80,45,.35)'; g.lineWidth = 1; for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(k * W / 6, 0); g.lineTo(k * W / 6, H); g.moveTo(0, k * H / 6); g.lineTo(W, k * H / 6); g.stroke(); }
    g.fillStyle = '#cdb27a'; g.strokeStyle = '#6b4f2e'; g.lineWidth = 2; g.beginPath();
    for (let k = 0; k <= 40; k++) { const a = k / 40 * Math.PI * 2, d = 0.28 + 0.08 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 7); g.lineTo(W * (0.42 + d * Math.cos(a)), H * (0.48 + d * 0.8 * Math.sin(a))); }
    g.closePath(); g.fill(); g.stroke();
    g.translate(W * 0.82, H * 0.8); fill('#7a2e22', () => { g.moveTo(0, -24); g.lineTo(5, 0); g.lineTo(0, 24); g.lineTo(-5, 0); }); fill('#3a2a1c', () => { g.moveTo(-24, 0); g.lineTo(0, 5); g.lineTo(24, 0); g.lineTo(0, -5); });
  });
  at('earth', 0, 2, 2, 1, (W, H) => {   // the globe's map: an old-style world, sea and lands
    g.fillStyle = '#d9c9a0'; g.fillRect(0, 0, W, H); g.fillStyle = '#4e7a96'; g.fillRect(0, H * 0.04, W, H * 0.92);
    const land = (x, y, s, col) => { g.fillStyle = col; g.beginPath(); for (let k = 0; k <= 24; k++) { const a = k / 24 * Math.PI * 2, d = s * (0.7 + 0.3 * Math.sin(a * 3 + x) + 0.15 * Math.sin(a * 5 + y)); g.lineTo(W * x + Math.cos(a) * d * 1.2, H * y + Math.sin(a) * d); } g.fill(); };
    [[0.2, 0.32, 38], [0.27, 0.62, 30], [0.5, 0.3, 34], [0.53, 0.58, 40], [0.72, 0.36, 48], [0.84, 0.7, 22]].forEach(([x, y, s], k) => land(x, y, s, k % 2 ? '#a9b47a' : '#c6b27a'));
    g.strokeStyle = 'rgba(40,30,20,.3)'; g.lineWidth = 1; for (let k = 1; k < 8; k++) { g.beginPath(); g.moveTo(k * W / 8, 0); g.lineTo(k * W / 8, H); g.stroke(); }
  });
  at('dial', 2, 2, 1, 1, (W, H) => {   // a clock face at ten past ten
    g.fillStyle = '#7a5a34'; g.fillRect(0, 0, W, H); fill('#f5efe0', () => g.arc(W / 2, H / 2, W * 0.48, 0, 7));
    g.fillStyle = '#2a2018'; g.font = 'bold 26px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 1; k <= 12; k++) { const a = k / 12 * Math.PI * 2; g.fillText(['I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][k - 1], W / 2 + Math.sin(a) * W * 0.36, H / 2 - Math.cos(a) * H * 0.36); }
    g.strokeStyle = '#2a2018'; g.lineCap = 'round';
    for (const [a, l, w] of [[10 / 12 + 10 / 720, 0.22, 7], [10 / 60, 0.33, 4]]) { g.lineWidth = w; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.sin(a * Math.PI * 2) * W * l, H / 2 - Math.cos(a * Math.PI * 2) * H * l); g.stroke(); }
  });
  at('plate', 3, 2, 1, 1, (W, H) => {   // blue and white: rings and a flower
    g.fillStyle = '#f3f1ec'; g.fillRect(0, 0, W, H); g.strokeStyle = '#2d4f90'; g.fillStyle = '#2d4f90';
    for (const [k, w] of [[0.47, 6], [0.42, 2], [0.28, 3]]) { g.lineWidth = w; g.beginPath(); g.arc(W / 2, H / 2, W * k, 0, 7); g.stroke(); }
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; g.beginPath(); g.arc(W / 2 + Math.cos(a) * W * 0.35, H / 2 + Math.sin(a) * H * 0.35, 6, 0, 7); g.fill(); }
    for (let k = 0; k < 8; k++) { g.save(); g.translate(W / 2, H / 2); g.rotate(k / 8 * Math.PI * 2); g.beginPath(); g.ellipse(0, -W * 0.13, W * 0.05, W * 0.11, 0, 0, 7); g.fill(); g.restore(); }
    g.fillStyle = '#f3f1ec'; g.beginPath(); g.arc(W / 2, H / 2, W * 0.04, 0, 7); g.fill();
  });
  at('cloth', 3, 1, 1, 1, (W, H) => {   // a radio's speaker cloth behind a sunburst fret
    g.fillStyle = '#c9b48a'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(90,70,40,.25)'; g.lineWidth = 1;
    for (let k = 0; k < W; k += 4) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, H); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(W, k); g.stroke(); }
    g.strokeStyle = '#4a321f'; g.lineWidth = 9; for (let k = 0; k <= 8; k++) { const a = Math.PI * (1 + k / 8); g.beginPath(); g.moveTo(W / 2, H * 0.95); g.lineTo(W / 2 + Math.cos(a) * W, H * 0.95 + Math.sin(a) * H); g.stroke(); }
  });
  at('still', 0, 3, 1, 1, (W, H) => {   // a still life: a jug and oranges on a dark table
    g.fillStyle = grad(H, [[0, '#3b3229'], [0.68, '#2c251f'], [0.69, '#6a4a2e'], [1, '#4d3420']]); g.fillRect(0, 0, W, H);
    fill('#e9dfc8', () => g.ellipse(W * 0.4, H * 0.55, W * 0.14, H * 0.2, 0, 0, 7)); g.fillStyle = '#e9dfc8'; g.fillRect(W * 0.34, H * 0.3, W * 0.1, H * 0.12);
    for (const [x, y, s] of [[0.62, 0.66, 0.07], [0.75, 0.68, 0.06], [0.68, 0.6, 0.055]]) fill('#e08a2e', () => g.arc(W * x, H * y, W * s, 0, 7));
    fill('rgba(255,255,255,.35)', () => g.ellipse(W * 0.35, H * 0.5, W * 0.03, H * 0.08, 0, 0, 7));
  });
  return { tex: ctex(c, { rep: false }), slots };
}
const DECOR_ITEMS = [
  function celadonBottle(it) {   // a tall celadon bottle (meiping) and a small cup
    it.add(dkLathe([[0.045, 0], [0.05, 0.012], [0.066, 0.07], [0.088, 0.16], [0.07, 0.225], [0.032, 0.255], [0.024, 0.27], [0.031, 0.285], [0.026, 0.287]]), 0x9dbba0, 'gloss', { p: [-0.04, 0, 0] });
    it.add(dkLathe([[0.018, 0], [0.024, 0.01], [0.032, 0.04], [0.034, 0.045]]), 0xe9e4d6, 'gloss', { p: [0.12, 0, 0.04] });
  },
  function gingerJar(it) {   // a cobalt ginger jar with its lid, a white band at the shoulder
    it.add(dkLathe([[0.05, 0], [0.056, 0.01], [0.085, 0.07], [0.09, 0.11], [0.075, 0.15], [0.052, 0.165], [0.05, 0.175]]), 0x2c4a8a, 'gloss');
    it.add(dkLathe([[0.056, 0], [0.056, 0.012], [0.045, 0.03], [0.02, 0.042], [0.012, 0.05], [0.017, 0.06], [0.001, 0.066]]), 0x2c4a8a, 'gloss', { p: [0, 0.172, 0] });
    it.add(dkRing(0.087, 0.004), 0xf1ede2, 'gloss', { p: [0, 0.095, 0], r: [Math.PI / 2, 0, 0] });
  },
  function amphora(it) {   // a terracotta amphora with two handles and black bands
    it.add(dkLathe([[0.035, 0], [0.04, 0.015], [0.06, 0.05], [0.075, 0.11], [0.07, 0.16], [0.04, 0.2], [0.028, 0.225], [0.034, 0.25], [0.03, 0.252]]), 0xb5643d, 'matte');
    for (const s of [1, -1]) it.add(dkRing(0.034, 0.006, Math.PI, 12), 0xb5643d, 'matte', { p: [s * 0.05, 0.195, 0], r: [0, 0, -s * Math.PI / 2] });
    for (const [y, rr0] of [[0.12, 0.074], [0.135, 0.073]]) it.add(dkRing(rr0, 0.003), 0x2a1d16, 'matte', { p: [0, y, 0], r: [Math.PI / 2, 0, 0] });
  },
  function driedFlowers(it, r) {   // a white bud vase with dried stems and seed heads
    it.add(dkLathe([[0.03, 0], [0.04, 0.04], [0.042, 0.08], [0.02, 0.12], [0.016, 0.14], [0.02, 0.15]]), 0xf2efe8, 'matte');
    for (let k = 0; k < 5; k++) {
      const a = -0.5 + k * 0.25 + r(-0.08, 0.08), L = r(0.12, 0.17), top = [Math.sin(a) * L, 0.13 + Math.cos(a) * L, r(-0.03, 0.03)];
      it.rod([0, 0.13, 0], top, 0.0018, 0x8a6e4b, 'matte', 0.0012, 5);
      it.add(k % 2 ? dkBall(0.013, 8, 6) : new THREE.ConeGeometry(0.01, 0.04, 6), k % 2 ? 0x6b5136 : 0xd9c08a, 'matte', { p: top, r: [0, 0, -a] });
    }
  },
  function blackGourd(it) {   // a black double gourd tied with a red cord
    it.add(dkLathe([[0.04, 0], [0.05, 0.01], [0.07, 0.05], [0.068, 0.09], [0.035, 0.125], [0.045, 0.16], [0.044, 0.19], [0.022, 0.215], [0.016, 0.235], [0.02, 0.245]]), 0x1d1c1a, 'gloss');
    it.add(dkRing(0.036, 0.004), 0x9a2b25, 'matte', { p: [0, 0.125, 0], r: [Math.PI / 2, 0, 0] });
    it.rod([0.03, 0.125, 0.02], [0.05, 0.06, 0.04], 0.0025, 0x9a2b25);
  },
  function stoneBowl(it) {   // a wide sand-glazed bowl with river stones
    it.add(dkLathe([[0.04, 0], [0.06, 0.008], [0.1, 0.04], [0.115, 0.068], [0.11, 0.07]]), 0xd8c6a2, 'matte');
    [[-0.03, 0.05, 0, 0x8d8a84], [0.03, 0.052, 0.02, 0xb7b2a8], [0.01, 0.06, -0.03, 0x5e5b57]].forEach(([x, y, z, c]) => it.add(dkBall(0.026, 10, 8), c, 'gloss', { p: [x, y, z], s: [1, 0.55, 0.8] }));
  },
  function bottleTrio(it) {   // three slim bottles in greens
    [[-0.09, 0, 1, 0x4f7a5a], [0, -0.03, 0.78, 0x7d9a6c], [0.085, 0.02, 0.58, 0x3a5a6a]].forEach(([x, z, s, c]) =>
      it.add(dkLathe([[0.03, 0], [0.032, 0.11], [0.028, 0.14], [0.012, 0.18], [0.01, 0.23], [0.013, 0.236]]), c, 'gloss', { p: [x, 0, z], s: [1, s * 1.25, 1] }));
  },
  function vasePair(it) {   // a white cylinder and an ochre round vase
    it.add(dkLathe([[0.04, 0], [0.042, 0.18], [0.038, 0.2], [0.041, 0.206]]), 0xefe9dc, 'matte', { p: [-0.07, 0, -0.02] });
    it.add(dkLathe([[0.03, 0], [0.06, 0.05], [0.058, 0.09], [0.03, 0.12], [0.028, 0.13], [0.032, 0.135]]), 0xc9963e, 'gloss', { p: [0.08, 0, 0.02] });
  },
  function jug(it) {   // a cream jug with blue bands
    it.add(dkLathe([[0.04, 0], [0.05, 0.03], [0.06, 0.1], [0.05, 0.15], [0.045, 0.19], [0.05, 0.21]]), 0xece3cf, 'gloss');
    it.add(dkRing(0.042, 0.007, Math.PI, 12), 0xece3cf, 'gloss', { p: [0.055, 0.13, 0], r: [0, 0, -Math.PI / 2] });
    for (const [y, rr0] of [[0.1, 0.061], [0.165, 0.049]]) it.add(dkRing(rr0, 0.004), 0x35589a, 'gloss', { p: [0, y, 0], r: [Math.PI / 2, 0, 0] });
  },
  function landscape(it) { it.frame(0.27, 0.3, 0xb8924a, 'landscape', { fin: 'metal', b: 0.024 }); },   // in a gilt frame
  function seascape(it) {   // a wide sea picture in black, a shell before it
    it.frame(0.32, 0.23, 0x1e1c1a, 'sea', { b: 0.016 });
    it.add(new THREE.ConeGeometry(0.03, 0.035, 12), 0xf0dcc8, 'gloss', { p: [0.1, 0.015, 0.08], r: [Math.PI / 2 - 0.3, 0, 0], s: [1, 1, 0.6] });
  },
  function abstractPrint(it) {   // a Bauhaus-style print in oak, a brass ball beside it
    it.frame(0.22, 0.28, 0x9a6b3e, 'abstract', { x: -0.04, ry: 0.15 });
    it.add(dkBall(0.035, 16, 12), 0xb48a4a, 'metal', { p: [0.15, 0.035, 0.05] });
  },
  function fernPrint(it) {   // a pressed fern, white frame and mount, a small succulent in front
    it.frame(0.22, 0.29, 0xf2eee6, 'fern', { mount: 0.025, x: 0.03 });
    it.add(dkLathe([[0.025, 0], [0.03, 0.04], [0.032, 0.045]]), 0xa9643f, 'matte', { p: [-0.13, 0, 0.07] });
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; it.add(dkBall(0.012, 6, 5), 0x7f9f86, 'matte', { p: [-0.13 + Math.cos(a) * 0.015, 0.05, 0.07 + Math.sin(a) * 0.015], r: [0, -a, 0.6], s: [1.8, 0.7, 1] }); }
  },
  function photoPair(it) {   // two small framed photographs on their stands
    it.frame(0.12, 0.155, 0x23201d, 'portrait', { b: 0.012, lean: 0.2, x: -0.08, ry: 0.25 });
    it.frame(0.16, 0.115, 0xb9b7b2, 'peaks', { fin: 'metal', b: 0.01, lean: 0.2, x: 0.09, z: 0.04, ry: -0.2 });
  },
  function oldMap(it) { it.frame(0.31, 0.24, 0x4a3222, 'map', { b: 0.02, fin: 'gloss' }); },   // an old chart in dark wood
  function stillLife(it) {   // a small still life in green, a candle beside it
    it.frame(0.2, 0.24, 0x2f4a3a, 'still', { b: 0.022, x: -0.05 });
    it.add(dkLathe([[0.03, 0], [0.03, 0.006], [0.012, 0.015], [0.01, 0.04], [0.02, 0.05]]), 0xb48a4a, 'metal', { p: [0.14, 0, 0.05] });
    it.add(new THREE.CylinderGeometry(0.011, 0.011, 0.08, 12), 0xf4ecd8, 'matte', { p: [0.14, 0.09, 0.05] });
  },
  function plasterBust(it) {   // a plaster bust on a turned base
    const P = 0xe9e3d6;
    it.add(dkLathe([[0.07, 0], [0.072, 0.02], [0.055, 0.035], [0.05, 0.05]]), P);
    it.add(new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), P, 'matte', { p: [0, 0.05, 0], s: [1.25, 0.9, 0.65] });
    it.add(new THREE.CylinderGeometry(0.03, 0.036, 0.07, 14), P, 'matte', { p: [0, 0.16, 0] });
    it.add(dkBall(0.058, 20, 14), P, 'matte', { p: [0, 0.23, 0.008], s: [0.9, 1.15, 1] });
    it.add(dkBall(0.06, 16, 10), 0xd8d0c0, 'matte', { p: [0, 0.255, -0.006], s: [0.95, 0.8, 1] });   // hair
    it.add(new THREE.ConeGeometry(0.012, 0.03, 8), P, 'matte', { p: [0, 0.23, 0.066], r: [Math.PI / 2, 0, 0] });
  },
  function bronzeHead(it) {   // a modernist bronze head on a black block
    it.add(new THREE.BoxGeometry(0.09, 0.07, 0.09), 0x1c1b1a, 'gloss', { p: [0, 0.035, 0] });
    it.add(new THREE.CylinderGeometry(0.018, 0.024, 0.05, 12), 0x7a5a36, 'metal', { p: [0, 0.095, 0] });
    it.add(dkBall(0.05, 20, 14), 0x7a5a36, 'metal', { p: [0, 0.18, 0], s: [0.85, 1.45, 1], r: [0.2, 0.3, 0] });
  },
  function globe(it) {   // a globe on a turned stand with a brass meridian
    it.add(dkLathe([[0.06, 0], [0.06, 0.012], [0.03, 0.02], [0.012, 0.04], [0.01, 0.06]]), 0x4a3222, 'gloss');
    it.add(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8), 0xb48a4a, 'metal', { p: [0, 0.065, 0] });
    it.add(new THREE.SphereGeometry(0.085, 32, 20), 0xffffff, 'art', { p: [0, 0.175, 0], r: [0, 0, 0.41], slot: 'earth' });
    it.add(dkRing(0.093, 0.004, Math.PI * 1.3, 40), 0xb48a4a, 'metal', { p: [0, 0.175, 0], r: [0, 0, 0.41 - 0.15 * Math.PI] });
  },
  function hourglass(it) {   // an hourglass in walnut, the sand half run
    const W = 0x5a3a22;
    for (const y of [0.006, 0.204]) it.add(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 20), W, 'gloss', { p: [0, y, 0] });
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; it.add(new THREE.CylinderGeometry(0.005, 0.005, 0.19, 8), W, 'gloss', { p: [Math.cos(a) * 0.042, 0.105, Math.sin(a) * 0.042] }); }
    it.add(dkLathe([[0.03, 0.012], [0.034, 0.04], [0.03, 0.07], [0.005, 0.105], [0.03, 0.14], [0.034, 0.17], [0.03, 0.198]], 20), 0xeef3f0, 'glass');
    it.add(new THREE.ConeGeometry(0.03, 0.04, 16), 0xd9b77a, 'matte', { p: [0, 0.032, 0] });
    it.add(new THREE.ConeGeometry(0.022, 0.026, 16), 0xd9b77a, 'matte', { p: [0, 0.135, 0], r: [Math.PI, 0, 0] });
  },
  function mantelClock(it) {   // an arched mantel clock with a brass bezel
    const W = 0x5a3a22;
    it.add(new THREE.BoxGeometry(0.2, 0.13, 0.08), W, 'gloss', { p: [0, 0.075, 0] });
    it.add(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 24, 1, false, Math.PI / 2, Math.PI), W, 'gloss', { p: [0, 0.14, 0], r: [Math.PI / 2, 0, 0] });
    it.add(new THREE.CircleGeometry(0.058, 32), 0xffffff, 'art', { p: [0, 0.14, 0.041], slot: 'dial' });
    it.add(dkRing(0.06, 0.005), 0xb48a4a, 'metal', { p: [0, 0.14, 0.042] });
    for (const x of [-0.085, 0.085]) it.add(dkBall(0.012, 8, 6), 0xb48a4a, 'metal', { p: [x, 0.008, 0.025] });
  },
  function candlesticks(it) {   // a pair of brass candlesticks
    [[-0.06, 1], [0.06, 0.78]].forEach(([x, s]) => {
      it.add(dkLathe([[0.038, 0], [0.036, 0.008], [0.012, 0.022], [0.01, 0.09], [0.016, 0.1], [0.008, 0.12], [0.018, 0.13], [0.021, 0.136]]), 0xb48a4a, 'metal', { p: [x, 0, 0], s: [1, s, 1] });
      it.add(new THREE.CylinderGeometry(0.011, 0.011, 0.1, 12), 0xf4ecd8, 'matte', { p: [x, 0.136 * s + 0.05, 0] });
    });
  },
  function lantern(it) {   // a black iron lantern with a candle
    const I = 0x222120;
    it.add(new THREE.BoxGeometry(0.11, 0.015, 0.11), I, 'matte', { p: [0, 0.008, 0] });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) it.add(new THREE.BoxGeometry(0.008, 0.15, 0.008), I, 'matte', { p: [x * 0.05, 0.09, z * 0.05] });
    it.add(new THREE.ConeGeometry(0.08, 0.05, 4), I, 'matte', { p: [0, 0.19, 0], r: [0, Math.PI / 4, 0] });
    it.add(dkRing(0.02, 0.003), I, 'matte', { p: [0, 0.23, 0] });
    it.add(new THREE.BoxGeometry(0.094, 0.15, 0.094), 0xf3f0e6, 'glass', { p: [0, 0.09, 0] });
    it.add(new THREE.CylinderGeometry(0.015, 0.015, 0.07, 12), 0xf4ecd8, 'matte', { p: [0, 0.05, 0] });
  },
  function succulent(it, r) {   // a rosette succulent in a terracotta pot
    it.add(dkLathe([[0.045, 0], [0.055, 0.075], [0.06, 0.08], [0.06, 0.09], [0.054, 0.09]]), 0xa9643f, 'matte');
    it.add(new THREE.CircleGeometry(0.052, 20), 0x3b2a1e, 'matte', { p: [0, 0.084, 0], r: [-Math.PI / 2, 0, 0] });
    for (let k = 0; k < 22; k++) { const a = k * 2.4, ring = k / 22, t = 0.25 + ring * 0.9;
      it.add(dkBall(0.02, 8, 6), ring < 0.4 ? 0x9cb59c : 0x7a9a86, 'matte', { p: [Math.cos(a) * 0.03 * ring, 0.1 + 0.02 * (1 - ring), Math.sin(a) * 0.03 * ring], r: [0, -a, t], s: [1.6, 0.45, 0.8] }); }
  },
  function ivy(it, r) {   // ivy in a white pot, trailing over the shelf's edge
    it.add(dkLathe([[0.04, 0], [0.05, 0.08], [0.052, 0.09], [0.048, 0.09]]), 0xf0ece4, 'gloss', { p: [0, 0, 0.06] });
    for (let s = 0; s < 4; s++) {
      const x0 = -0.03 + s * 0.02, side = s % 2 ? 1 : -1;
      for (let k = 0; k < 13; k++) {
        const t = k / 12, p = [x0 + side * t * 0.12 + r(-0.01, 0.01), 0.09 + 0.04 * Math.sin(Math.PI * Math.min(t * 2, 1)) - Math.max(0, t - 0.4) * 0.3, 0.06 + Math.min(t, 0.5) * 0.26 + r(-0.01, 0.01)];
        it.add(dkBall(0.014, 6, 5), k % 3 ? 0x4f7a3f : 0x6a9450, 'matte', { p, r: [r(-1, 1), r(0, 3), r(-1, 1)], s: [1, 0.35, 0.8] });
      }
    }
  },
  function cactus(it) {   // a column cactus in a teal pot, a pink flower on top
    it.add(dkLathe([[0.04, 0], [0.045, 0.07], [0.05, 0.075], [0.046, 0.075]]), 0x3f7f7a, 'gloss');
    it.add(new THREE.CapsuleGeometry(0.026, 0.13, 4, 12), 0x5f8a4f, 'matte', { p: [0, 0.15, 0] });
    it.add(new THREE.CapsuleGeometry(0.014, 0.04, 4, 10), 0x5f8a4f, 'matte', { p: [0.035, 0.15, 0], r: [0, 0, -0.9] });
    it.add(new THREE.CapsuleGeometry(0.013, 0.04, 4, 10), 0x5f8a4f, 'matte', { p: [0.055, 0.18, 0] });
    it.add(dkBall(0.012, 8, 6), 0xd77a9a, 'gloss', { p: [0, 0.24, 0], s: [1, 0.6, 1] });
  },
  function bookPile(it, r, ctx) {   // the Isometric Library's pile with a brass ball (a model, added as is)
    const o = ctx.assets.isoPile.clone(); o.rotation.y = r(-0.3, 0.3);
    const s = new THREE.Mesh(dkBall(0.05, 16, 12), MAT.brass); s.position.y = ctx.assets.isoPileH + 0.05; o.add(s);
    return o;
  },
  function keepsakeBox(it, r) {   // a walnut box with a brass hasp, four books standing beside it
    it.add(new THREE.BoxGeometry(0.16, 0.08, 0.11), 0x6b4a2e, 'gloss', { p: [0.12, 0.04, 0] });
    it.add(new THREE.BoxGeometry(0.166, 0.016, 0.116), 0x5a3c24, 'gloss', { p: [0.12, 0.088, 0] });
    it.add(new THREE.BoxGeometry(0.02, 0.03, 0.004), 0xb48a4a, 'metal', { p: [0.12, 0.075, 0.058] });
    let x = -0.22; for (const c of [0x6e2f2f, 0x2e3b55, 0x3f5340, 0xb8a487]) { const w = r(0.026, 0.04), h = r(0.2, 0.26); it.book(w, h, 0.16, c, { p: [x + w / 2, h / 2, -0.01] }); x += w + 0.002; }
  },
  function marbleBookends(it, r) {   // marble bookends holding six books, the last one leaning
    for (const s of [-1, 1]) {
      it.add(new THREE.BoxGeometry(0.03, 0.15, 0.1), 0xdcd8d0, 'gloss', { p: [s * 0.2, 0.075, 0] });
      it.add(new THREE.BoxGeometry(0.07, 0.02, 0.1), 0xdcd8d0, 'gloss', { p: [s * 0.17, 0.01, 0] });
    }
    let x = -0.185; [0x7c5a3c, 0x4e3526, 0x2e3b55, 0xa8322d, 0x556a7a].forEach(c => { const w = r(0.03, 0.045), h = r(0.19, 0.25); it.book(w, h, 0.15, c, { p: [x + w / 2, h / 2, 0] }); x += w + 0.002; });
    it.book(0.035, 0.22, 0.15, 0x3a2e28, { p: [x + 0.055, 0.106, 0], r: [0, 0, 0.42] });
  },
  function plate(it) {   // a blue and white plate on a stand
    it.add(new THREE.CircleGeometry(0.12, 40), 0xffffff, 'art', { p: [0, 0.135, 0.004], r: [-0.22, 0, 0], slot: 'plate' });
    it.add(new THREE.CylinderGeometry(0.122, 0.11, 0.012, 40), 0xf3f1ec, 'gloss', { p: [0, 0.135, -0.004], r: [Math.PI / 2 - 0.22, 0, 0] });
    it.add(new THREE.BoxGeometry(0.1, 0.012, 0.05), 0x4a3222, 'gloss', { p: [0, 0.006, 0.02] });
    it.add(new THREE.BoxGeometry(0.012, 0.11, 0.012), 0x4a3222, 'gloss', { p: [0, 0.06, -0.04], r: [-0.22, 0, 0] });
  },
  function geode(it) {   // an amethyst geode on a brass ring
    it.add(dkRing(0.045, 0.006), 0xb48a4a, 'metal', { p: [0, 0.006, 0], r: [Math.PI / 2, 0, 0] });
    it.add(new THREE.SphereGeometry(0.075, 14, 10, Math.PI, Math.PI), 0x4b4743, 'matte', { p: [0, 0.075, -0.01], s: [1, 0.9, 0.7] });
    it.add(new THREE.CircleGeometry(0.068, 16), 0xe6e1d8, 'gloss', { p: [0, 0.075, -0.008], s: [1, 0.9, 1] });
    it.add(new THREE.CircleGeometry(0.055, 16), 0x6e4592, 'gloss', { p: [0, 0.075, -0.006], s: [1, 0.9, 1] });
    for (let k = 0; k < 9; k++) { const a = k * 2.4, d = 0.012 + (k % 3) * 0.015; it.add(new THREE.ConeGeometry(0.008, 0.02, 5), 0x9a72b8, 'gloss', { p: [Math.cos(a) * d, 0.075 + Math.sin(a) * d * 0.9, 0.002], r: [Math.PI / 2, 0, a] }); }
  },
  function crystalBall(it) {   // a crystal ball on a brass stand
    it.add(dkLathe([[0.045, 0], [0.045, 0.01], [0.03, 0.02], [0.02, 0.04], [0.035, 0.05], [0.038, 0.052]]), 0xb48a4a, 'metal');
    it.add(dkBall(0.065, 24, 18), 0xe9f1f4, 'glass', { p: [0, 0.11, 0] });
    it.add(dkBall(0.02, 10, 8), 0xbcd6e8, 'gloss', { p: [0.01, 0.11, 0.01] });
  },
  function cairn(it) {   // river stones stacked into a cairn
    let y = 0; [[0.07, 0x8d8a84], [0.058, 0x6e6b66], [0.047, 0xb2ada4], [0.036, 0x56534f], [0.026, 0x9c978e]].forEach(([s, c], k) => {
      const h = s * 0.38; it.add(dkBall(s, 14, 10), c, 'matte', { p: [k % 2 ? 0.006 : -0.006, y + h, 0], s: [1, 0.38, 0.85], r: [0, k, 0.05 * (k % 2 ? 1 : -1)] }); y += h * 2 - 0.004;
    });
  },
  function ringSculpture(it) {   // a black ring on a white plinth
    it.add(new THREE.BoxGeometry(0.08, 0.08, 0.08), 0xf0ece4, 'matte', { p: [0, 0.04, 0] });
    it.add(dkRing(0.075, 0.012, Math.PI * 2, 40), 0x1d1c1a, 'gloss', { p: [0, 0.165, 0], r: [0, 0.4, 0] });
  },
  function camera(it) {   // a folding camera on two books
    it.book(0.2, 0.03, 0.15, 0x2f4a4a, { lying: true, p: [0, 0.015, 0] });
    it.book(0.18, 0.025, 0.13, 0x9b8a6a, { lying: true, p: [0.01, 0.0425, 0], r: [0, 0.1, 0] });
    const y = 0.055;
    it.add(new THREE.BoxGeometry(0.13, 0.075, 0.055), 0x1c1c1c, 'matte', { p: [0, y + 0.0375, 0] });
    it.add(new THREE.BoxGeometry(0.135, 0.012, 0.058), 0xb9b7b2, 'metal', { p: [0, y + 0.081, 0] });
    it.add(new THREE.CylinderGeometry(0.028, 0.03, 0.045, 20), 0x151515, 'gloss', { p: [0.015, y + 0.036, 0.05], r: [Math.PI / 2, 0, 0] });
    it.add(dkRing(0.028, 0.003), 0xb9b7b2, 'metal', { p: [0.015, y + 0.036, 0.073] });
    it.add(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 8), 0xb9b7b2, 'metal', { p: [-0.045, y + 0.092, 0] });
  },
  function telescope(it) {   // a brass telescope on a small wooden tripod
    const apex = [0, 0.13, 0];
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + 0.3; it.rod([Math.cos(a) * 0.08, 0, Math.sin(a) * 0.07], apex, 0.005, 0x6b4a2e, 'gloss', 0.004); }
    const tilt = new THREE.Matrix4().makeTranslation(...apex).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 + 0.42));
    it.add(new THREE.CylinderGeometry(0.022, 0.016, 0.3, 20), 0xb48a4a, 'metal', { p: [0, 0.02, 0], m: tilt });
    it.add(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 20), 0x3a2a1c, 'gloss', { p: [0, 0.17, 0], m: tilt });
    it.add(new THREE.CylinderGeometry(0.008, 0.01, 0.05, 12), 0xb48a4a, 'metal', { p: [0, -0.14, 0], m: tilt });
  },
  function trophy(it) {   // a brass cup with two handles on a black base
    it.add(new THREE.BoxGeometry(0.08, 0.045, 0.08), 0x1c1b1a, 'gloss', { p: [0, 0.0225, 0] });
    it.add(new THREE.BoxGeometry(0.05, 0.02, 0.002), 0xb48a4a, 'metal', { p: [0, 0.0225, 0.041] });
    it.add(dkLathe([[0.03, 0], [0.012, 0.012], [0.01, 0.04], [0.025, 0.055], [0.045, 0.09], [0.05, 0.13], [0.048, 0.133]]), 0xb48a4a, 'metal', { p: [0, 0.045, 0] });
    for (const s of [1, -1]) it.add(dkRing(0.026, 0.004, Math.PI, 12), 0xb48a4a, 'metal', { p: [s * 0.05, 0.15, 0], r: [0, 0, -s * Math.PI / 2] });
  },
  function radio(it) {   // a cathedral radio in walnut, its cloth behind a sunburst fret
    const W = 0x6b4a2e;
    it.add(new THREE.BoxGeometry(0.2, 0.16, 0.1), W, 'gloss', { p: [0, 0.08, 0] });
    it.add(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 24, 1, false, Math.PI / 2, Math.PI), W, 'gloss', { p: [0, 0.16, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.8] });
    it.add(new THREE.PlaneGeometry(0.13, 0.12), 0xffffff, 'art', { p: [0, 0.15, 0.051], slot: 'cloth' });
    it.add(new THREE.PlaneGeometry(0.07, 0.022), 0xf1e6c8, 'gloss', { p: [0, 0.055, 0.051] });
    for (const x of [-0.06, 0.06]) it.add(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 14), 0xb48a4a, 'metal', { p: [x, 0.03, 0.056], r: [Math.PI / 2, 0, 0] });
  },
  function appleBooks(it, r) {   // three books lying flat, an apple on top
    let y = 0; [[0.24, 0.035, 0x7a3b2b], [0.21, 0.03, 0x2f4a4a], [0.19, 0.028, 0xcfc2a2]].forEach(([w, h, c], k) => { it.book(w, h, 0.16, c, { lying: true, p: [r(-0.01, 0.01), y + h / 2, 0], r: [0, r(-0.12, 0.12), 0] }); y += h; });
    it.add(dkBall(0.035, 16, 12), 0xa62c22, 'gloss', { p: [0.02, y + 0.032, 0], s: [1.05, 0.9, 1] });
    it.rod([0.02, y + 0.06, 0], [0.024, y + 0.078, 0], 0.002, 0x4a3420);
    it.add(dkBall(0.012, 6, 5), 0x5f8a3f, 'matte', { p: [0.034, y + 0.074, 0], s: [1.4, 0.3, 0.7], r: [0, 0, -0.4] });
  },
  function fruitBowl(it) {   // a turned wooden bowl of oranges and lemons
    it.add(dkLathe([[0.035, 0], [0.05, 0.005], [0.1, 0.045], [0.106, 0.06]]), 0x7a5232, 'gloss');
    [[-0.04, 0.05, 0, 0xe0872a, 1], [0.035, 0.052, 0.01, 0xe0872a, 1], [0, 0.058, -0.04, 0xe0872a, 1], [-0.005, 0.085, 0.01, 0xe8c84a, 0.85], [0.05, 0.075, -0.03, 0xe8c84a, 0.85]]
      .forEach(([x, y, z, c, s]) => it.add(dkBall(0.032 * s, 14, 10), c, 'gloss', { p: [x, y, z], s: c === 0xe8c84a ? [1.3, 1, 1] : [1, 1, 1] }));
  },
  function penCup(it, r) {   // a green pen cup with pencils, two notebooks beside it
    it.add(dkLathe([[0.034, 0], [0.036, 0.09], [0.033, 0.09]]), 0x2e5a4a, 'gloss', { p: [-0.08, 0, 0] });
    [0xc0483a, 0xe5b43e, 0x2d5a88, 0x3f7f4a, 0x1f1d1b, 0x8a5a9a].forEach((c, k) => {
      const a = k / 6 * Math.PI * 2, top = [-0.08 + Math.cos(a) * 0.03, 0.17 + r(0, 0.02), Math.sin(a) * 0.03];
      it.rod([-0.08 + Math.cos(a) * 0.012, 0.01, Math.sin(a) * 0.012], top, 0.0035, c, 'gloss', 0.0035, 6);
    });
    it.book(0.12, 0.016, 0.16, 0x8e2f2a, { lying: true, p: [0.09, 0.008, 0], r: [0, 0.15, 0] });
    it.book(0.1, 0.012, 0.14, 0x2c3e5a, { lying: true, p: [0.095, 0.022, 0.005], r: [0, -0.1, 0] });
  },
  function inkAndQuill(it) {   // an ink bottle with a quill, letters tied under a wax seal
    it.add(dkLathe([[0.03, 0], [0.032, 0.04], [0.02, 0.05], [0.012, 0.06], [0.014, 0.065]]), 0x1b2330, 'gloss', { p: [-0.07, 0, 0] });
    it.add(dkLathe([[0.006, 0], [0.008, 0.01], [0.01, 0.06], [0.004, 0.2]], 8), 0xf2efe6, 'matte', { p: [-0.07, 0.05, 0], r: [0.1, 0, -0.35], s: [1, 1, 0.3] });
    for (let k = 0; k < 3; k++) it.add(new THREE.BoxGeometry(0.15, 0.006, 0.1), 0xece2c8, 'matte', { p: [0.08, 0.003 + k * 0.006, 0], r: [0, (k - 1) * 0.12, 0] });
    it.add(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 14), 0x9a2b25, 'gloss', { p: [0.08, 0.02, 0.01] });
  },
  function bird(it) {   // a white ceramic bird on two books
    it.book(0.22, 0.032, 0.16, 0x5b4636, { lying: true, p: [0, 0.016, 0] });
    it.book(0.19, 0.028, 0.14, 0x9b8a6a, { lying: true, p: [0, 0.046, 0], r: [0, 0.12, 0] });
    const m = new THREE.Matrix4().makeTranslation(0, 0.06, 0).multiply(new THREE.Matrix4().makeRotationY(0.6));
    it.add(dkBall(0.04, 16, 12), 0xf3f0ea, 'gloss', { p: [0, 0.035, 0], s: [1.3, 0.9, 0.85], m });
    it.add(dkBall(0.022, 12, 10), 0xf3f0ea, 'gloss', { p: [0.045, 0.07, 0], m });
    it.add(new THREE.ConeGeometry(0.007, 0.02, 8), 0xc98a3a, 'gloss', { p: [0.072, 0.07, 0], r: [0, 0, -Math.PI / 2], m });
    it.add(new THREE.BoxGeometry(0.05, 0.006, 0.03), 0xf3f0ea, 'gloss', { p: [-0.065, 0.05, 0], r: [0, 0, 0.45], m });
    for (const z of [-0.012, 0.012]) it.add(dkBall(0.004, 6, 4), 0x1d1c1a, 'gloss', { p: [0.058, 0.076, z], m });
  },
  function coral(it, r) {   // a white coral branch on a black stand
    it.add(new THREE.CylinderGeometry(0.04, 0.045, 0.025, 20), 0x1d1c1a, 'gloss', { p: [0, 0.0125, 0] });
    const grow = (a, d, L, rad, n) => {
      const b = [a[0] + d[0] * L, a[1] + d[1] * L, a[2] + d[2] * L]; it.rod(a, b, rad, 0xeee6da, 'matte', rad * 0.7, 6);
      if (n) for (const s of [-1, 1]) { const t = s * r(0.35, 0.6), d2 = new THREE.Vector3(...d).applyAxisAngle(new THREE.Vector3(r(-0.3, 0.3), 0, 1).normalize(), t).normalize(); grow(b, d2.toArray(), L * 0.72, rad * 0.7, n - 1); }
    };
    grow([0, 0.025, 0], [0, 1, 0], 0.08, 0.009, 3);
  },
];
function buildDecor(assets) {
  const g = new THREE.Group(); room.add(g);
  const r = rng(4242), rnd = (a, b) => a + (b - a) * r(), atlas = decorAtlas(), C = new THREE.Color();
  const deck = DECOR_ITEMS.map(f => [r(), f]).sort((a, b) => a[0] - b[0]).map(x => x[1]);   // shuffled: one piece per cell
  const bins = { matte: [], gloss: [], metal: [], glass: [], art: [] }, W = new THREE.Matrix4(), Q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  DECOR.forEach((d, k) => {
    if (k >= deck.length) return;
    const c = d.o.clone().addScaledVector(d.along, d.len / 2).addScaledVector(d.out, -d.dep / 2 + 0.05);
    const yaw = Math.atan2(d.out.x, d.out.z), it = decorItem();
    const model = deck[k](it, rnd, { assets, len: d.len, hgt: d.hgt });
    W.compose(c, Q.setFromAxisAngle(DK_Y, yaw + rnd(-0.12, 0.12)), one);
    for (const p of it.parts) {
      const geo = p.geo; geo.applyMatrix4(W);
      const n = geo.attributes.position.count, col = new Float32Array(n * 3);
      if (Array.isArray(p.col)) for (let i = 0; i < n; i++) C.setHex(p.col[Math.min(5, i >> 2)]).toArray(col, i * 3);   // a box: four vertices a face
      else { C.setHex(p.col); for (let i = 0; i < n; i++) C.toArray(col, i * 3); }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (p.slot) { const [u0, v0, u1, v1] = atlas.slots[p.slot], uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); }
      bins[p.fin].push(geo);
    }
    if (model) { model.position.copy(c); model.rotation.y += yaw; model.traverse(m => { if (m.isMesh) m.castShadow = m.receiveShadow = true; }); g.add(model); }
  });
  const std = o => new THREE.MeshStandardMaterial(o);
  const mats = { matte: std({ vertexColors: true, roughness: 0.85 }), gloss: std({ vertexColors: true, roughness: 0.3 }), metal: std({ vertexColors: true, metalness: 0.9, roughness: 0.38 }),
    glass: std({ vertexColors: true, roughness: 0.08, transparent: true, opacity: 0.3, depthWrite: false }), art: std({ map: atlas.tex, roughness: 0.75 }) };
  for (const [fin, list] of Object.entries(bins)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list), mats[fin]); m.castShadow = fin !== 'glass'; m.receiveShadow = true; if (fin === 'glass') m.renderOrder = 1; g.add(m);
  }
  // The old shelf pieces drew from the room's random sequence: take the same number of draws, so everything built after
  // them (the garden) stays where it was.
  let pics = 0, n = 0;
  for (const d of DECOR) n += d.kind === 0 ? 2 + (pics++ < 5 ? 64 : 1) : [0, 0, 4, 1, 0, 2][d.kind];
  for (let i = 0; i < n; i++) rand();
  DECOR.used = Math.min(DECOR.length, deck.length);
}
/* ---------------------------------------------------------------- pouf */
/* Floor cushion (bean bag) with folds. Physics notes behind the design: wrinkles appear where the cover is
   compressed in-plane and buckles (bending stiffness sets the fold width); a seat dent compresses the fabric
   circumferentially, so most folds fan out radially from it; folds are lens-shaped (pointed ends) with a ridge
   and a shadowed crease on one side; the bead weight bulges the lower sides and gathers the cover at the base. */
function poufGeometry(W = 1.4, D = 1.22, H = 0.52, seed = 31) {
  const seg = 380, rings = 190, n = 4.4, ye = 0.36 * H, m1 = 3.8, m2 = 3.4;
  const sup = a => Math.pow(Math.pow(Math.abs(Math.cos(a)), n) + Math.pow(Math.abs(Math.sin(a)), n), -1 / n);
  const tSeam = 0.6;
  const prof = t => {   // t: 0 top pole → 1 bottom pole ; returns [radial factor, height]
    if (t <= tSeam) { const phi = (1 - t / tSeam) * Math.PI / 2; return [Math.pow(Math.cos(phi), 2 / m1), ye + (H - ye) * Math.pow(Math.sin(phi), 2 / m1)]; }
    const psi = (t - tSeam) / (1 - tSeam) * Math.PI / 2; return [Math.pow(Math.cos(psi), 2 / m2) * (1 - 0.05 * Math.sin(psi)), ye * (1 - Math.sin(psi)) + 0.004];
  };
  const r = rng(seed), dent = { x: 0.05, z: 0.02, depth: 0.03, w: 0.36 };
  // ---- fold field (plan coordinates, metres): radial folds from the dent, edge folds, random crumples
  const folds = [];
  const addFold = (p0, p2, bend, w, A) => { const mx = (p0[0] + p2[0]) / 2, mz = (p0[1] + p2[1]) / 2, dx = p2[0] - p0[0], dz = p2[1] - p0[1], L = Math.hypot(dx, dz);
    const c = [mx - dz / L * bend, mz + dx / L * bend]; const pts = []; for (let k = 0; k <= 12; k++) { const u = k / 12; pts.push([(1 - u) * (1 - u) * p0[0] + 2 * u * (1 - u) * c[0] + u * u * p2[0], (1 - u) * (1 - u) * p0[1] + 2 * u * (1 - u) * c[1] + u * u * p2[1]]); }
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9; for (const q of pts) { minx = Math.min(minx, q[0]); maxx = Math.max(maxx, q[0]); minz = Math.min(minz, q[1]); maxz = Math.max(maxz, q[1]); }
    folds.push({ pts, w, A, side: r() < 0.5 ? 1 : -1, box: [minx - 4 * w, maxx + 4 * w, minz - 4 * w, maxz + 4 * w] }); };
  // a few long folds fanning out from the seat dent (they start well away from it: no "button" starburst)
  for (let i = 0; i < 7; i++) { const a = (i + r() * 0.8) / 7 * Math.PI * 2, r0 = 0.16 + r() * 0.16, r1 = 0.4 + r() * 0.3, da = (r() - .5) * 0.9;
    addFold([dent.x + Math.cos(a) * r0 * W / 1.4, dent.z + Math.sin(a) * r0 * D / 1.4], [dent.x + Math.cos(a + da) * r1 * W / 1.4, dent.z + Math.sin(a + da) * r1 * D / 1.4], (r() - .5) * 0.22, 0.024 + r() * 0.022, 0.012 + r() * 0.018); }
  // folds where the cover rolls over the rim, roughly perpendicular to the edge
  for (let i = 0; i < 18; i++) { const a = r() * Math.PI * 2, s = sup(a), ex = Math.cos(a) * s * W / 2 * 0.98, ez = Math.sin(a) * s * D / 2 * 0.98, l = 0.12 + r() * 0.2, ang = a + Math.PI + (r() - .5) * 1.1;
    addFold([ex + Math.cos(a) * 0.05, ez + Math.sin(a) * 0.05], [ex + Math.cos(ang) * l, ez + Math.sin(ang) * l], (r() - .5) * 0.1, 0.02 + r() * 0.018, 0.009 + r() * 0.015); }
  // crumples of every size and direction (crushed velvet that has been sat on)
  for (let i = 0; i < 30; i++) { const rr2 = Math.sqrt(r()) * 0.9, aa = r() * Math.PI * 2, cx = Math.cos(aa) * rr2 * W / 2, cz = Math.sin(aa) * rr2 * D / 2, a = r() * Math.PI, l = 0.08 + r() * 0.24;
    addFold([cx - Math.cos(a) * l / 2, cz - Math.sin(a) * l / 2], [cx + Math.cos(a) * l / 2, cz + Math.sin(a) * l / 2], (r() - .5) * 0.14, 0.018 + r() * 0.016, 0.007 + r() * 0.013); }
  // side band: curved lens folds in (perimeter arc, profile) metres, any direction within ±70° of vertical
  const Rp = 0.62, Lt = 1.15, sideFolds = [];
  for (let i = 0; i < 34; i++) { const ac = r() * Math.PI * 2, tc = 0.44 + r() * 0.36, th = Math.PI / 2 + (r() - .5) * 2.4, l = 0.1 + r() * 0.24, bend = (r() - .5) * 0.1;
    const hx = Math.cos(th) * l / 2, hy = Math.sin(th) * l / 2, cx = -hy / (l / 2) * bend, cy = hx / (l / 2) * bend, pts = [];
    for (let k = 0; k <= 10; k++) { const u = k / 10; pts.push([(1 - u) * (1 - u) * -hx + 2 * u * (1 - u) * cx + u * u * hx, (1 - u) * (1 - u) * -hy + 2 * u * (1 - u) * cy + u * u * hy]); }
    sideFolds.push({ ac, tc, pts, w: 0.02 + r() * 0.016, A: 0.007 + r() * 0.012, side: r() < 0.5 ? 1 : -1, ext: l / 2 + 0.12 }); }
  const lensAt = (f, x, z) => {   // distance to the fold's polyline → ridge with a shadowed crease on one side, tapered ends
    let best = 1e9, bu = 0, bs = 0; const P = f.pts;
    for (let k = 0; k < P.length - 1; k++) { const ax = P[k][0], az = P[k][1], bx = P[k + 1][0] - ax, bz = P[k + 1][1] - az; const L2 = bx * bx + bz * bz || 1e-12;
      let u = ((x - ax) * bx + (z - az) * bz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u; const dx = x - ax - bx * u, dz = z - az - bz * u, d = dx * dx + dz * dz;
      if (d < best) { best = d; bu = (k + u) / (P.length - 1); bs = Math.sign(bx * (z - az) - bz * (x - ax)); } }
    const d = Math.sqrt(best), env = Math.pow(Math.sin(Math.PI * bu), 0.8); if (env <= 0) return 0;
    const cw = Math.max(0.6 * f.w, 0.013); return f.A * env * (Math.exp(-((d / f.w) ** 2)) - (bs === f.side ? 0.75 * Math.exp(-(((d - 1.1 * f.w - 0.5 * cw) / cw) ** 2)) : 0)); };
  const sideH = (ang, t) => { let hs = 0;
    for (const f of sideFolds) { let da = ang - f.ac; da = Math.atan2(Math.sin(da), Math.cos(da)); const px = da * Rp, py = (t - f.tc) * Lt; if (Math.abs(px) > f.ext || Math.abs(py) > f.ext) continue; hs += lensAt(f, px, py); }
    return 0.026 * Math.tanh(hs / 0.026); };
  const foldH = (x, z) => {
    let hsum = 0;
    for (const f of folds) { if (x < f.box[0] || x > f.box[1] || z < f.box[2] || z > f.box[3]) continue; hsum += lensAt(f, x, z); }
    return 0.034 * Math.tanh(hsum / 0.034);
  };
  // ---- vertices: top pole, rings (no duplicated seam column), bottom pole
  const pos = [], base = []; const ringStart = [];
  const push = (x, y, z) => { pos.push(x, y, z); };
  push(0, H, 0); base.push([0, H, 0, 0]);
  for (let j = 1; j < rings; j++) { const t = j / rings, [rf, y] = prof(t); ringStart.push(pos.length / 3);
    for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2, s = sup(a); push(Math.cos(a) * s * rf * W / 2, y, Math.sin(a) * s * rf * D / 2); base.push([0, 0, 0, t]); } }
  push(0, 0.004, 0); base.push([0, 0, 0, 1]);
  const nv = pos.length / 3, idx = [];
  const ring = (j, i) => j === 0 ? 0 : j === rings ? nv - 1 : ringStart[j - 1] + ((i % seg) + seg) % seg;
  for (let i = 0; i < seg; i++) idx.push(0, ring(1, i + 1), ring(1, i));
  for (let j = 1; j < rings - 1; j++) for (let i = 0; i < seg; i++) { const a = ring(j, i), b = ring(j + 1, i), c = ring(j, i + 1), d = ring(j + 1, i + 1); idx.push(a, c, b, b, c, d); }
  for (let i = 0; i < seg; i++) idx.push(ring(rings - 1, i), ring(rings - 1, i + 1), nv - 1);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  // ---- displace: seat dent, folds (fading over the rim), base gathers, lumpy fill
  const P = g.attributes.position, N = g.attributes.normal;
  for (let v = 0; v < nv; v++) {
    const t = base[v][3]; let x = P.getX(v), y = P.getY(v), z = P.getZ(v);
    const nx = N.getX(v), ny = N.getY(v), nz = N.getZ(v);
    const topW = t < tSeam ? 1 : Math.max(0, 1 - (t - tSeam) / 0.12);
    const dd = Math.exp(-((x - dent.x) ** 2 + (z - dent.z) ** 2) / (dent.w * dent.w)) * Math.max(0, (y - ye) / (H - ye));
    const lump = (fbm(x * 2.2 + 4, z * 2.2 + 9, 3) - 0.5) * 0.03 * topW;
    let disp = foldH(x, z) * Math.pow(topW, 1.5) + lump;
    { const sw = Math.min(1, Math.max(0, (t - 0.4) / 0.12)) * (1 - Math.min(1, Math.max(0, (t - 0.84) / 0.08))); if (sw > 0) disp += sw * sideH(Math.atan2(z / D, x / W), t); }
    // gathers along the base: short vertical pleats just above the bottom seam
    const ang = Math.atan2(z / D, x / W); const gw = Math.exp(-(((t - 0.8) / 0.09) ** 2));
    disp += gw * (-Math.pow(0.5 + 0.5 * Math.cos(ang * 22 + fbm(ang * 2, 3.3, 2) * 9), 3) * 0.006 * (0.4 + fbm(ang * 3 + 1.7, 0.5, 2)) + 0.002);
    x += nx * disp; y += ny * disp - dd * dent.depth; z += nz * disp;
    P.setXYZ(v, x, Math.max(0.003, y), z);
  }
  g.computeVertexNormals();
  { // concavity occlusion from the ring neighbours: how far a vertex sits below its neighbours along the normal
    const col = new Float32Array(nv * 3).fill(1), Nn = g.attributes.normal;
    for (let j = 2; j < rings - 1; j++) for (let i = 0; i < seg; i++) {
      const v = ring(j, i), nb = [ring(j - 1, i), ring(j + 1, i), ring(j, i - 1), ring(j, i + 1), ring(j - 2, i), ring(j + 2 < rings ? j + 2 : j + 1, i), ring(j, i - 2), ring(j, i + 2)];
      let ax = 0, ay = 0, az = 0; for (const k of nb) { ax += P.getX(k); ay += P.getY(k); az += P.getZ(k); } ax = ax / nb.length - P.getX(v); ay = ay / nb.length - P.getY(v); az = az / nb.length - P.getZ(v);
      const conc = ax * Nn.getX(v) + ay * Nn.getY(v) + az * Nn.getZ(v);      // > 0: neighbours stand above → valley
      const o = Math.min(1, Math.max(0.24, 1 - conc * 185)) * (conc < 0 ? Math.min(1.25, 1 - conc * 50) : 1);
      col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = o;
    }
    // soft contact shadow towards the floor
    for (let v = 0; v < nv; v++) { const y = P.getY(v), k = 0.55 + 0.45 * Math.min(1, y / 0.12); col[v * 3] *= k; col[v * 3 + 1] *= k; col[v * 3 + 2] *= k; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  // bottom seam loop (welt cord) on the ring nearest 7 cm height
  let js = 1, best = 1e9; for (let j = 1; j < rings; j++) { const yy = prof(j / rings)[1]; if (j / rings > tSeam && Math.abs(yy - 0.07) < best) { best = Math.abs(yy - 0.07); js = j; } }
  const seam = []; for (let i = 0; i < seg; i += 2) { const k = ring(js, i); seam.push(new THREE.Vector3(P.getX(k) + N.getX(k) * 0.004, P.getY(k) + N.getY(k) * 0.004, P.getZ(k) + N.getZ(k) * 0.004)); }
  g.userData.seam = seam; g.computeBoundingSphere();
  return g;
}
/* ---------------------------------------------------------------- rug
   Ivory hand-tufted wool rug: ~12 mm cut pile on a 4 mm cotton/latex backing, serged edge (yarn overcast round
   the border). Pile = shells (Lengyel, Praun, Finkelstein & Hoppe 2001; NVIDIA "Fur: Shells and Fins"): offset
   copies of the top surface, each one cut against a procedural tuft volume. Tufts sit on a jittered grid
   (≈3.6 mm), bloom open toward the tips, fibres thin out at the very top, so from above you see bright tips over
   dark gaps and at grazing angles more fibre side. One instanced draw, top layer first so early depth rejects
   hidden lower layers; alpha-to-coverage on the MSAA target softens tuft edges. Fibres lower in the pile get less
   light (self-shadow ramp), the pile lay drifts across the rug (shading patches), and the pile is crushed and
   shadowed under the pouf.                                                                                     */
const RUG = { W: 2.35, D: 2.2, pile: 0.012, back: 0.004, layers: 14, tile: 0.12, corner: 0.03, wool: new THREE.Color(0xf3e9d6) };
function tuftTexture(size = 512, seed = 41) {
  const r = rng(seed), n = Math.round(RUG.tile / 0.0042), cell = size / n, tufts = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
    tufts.push({ x: (i + 0.5 + (r() - .5) * 0.8) * cell, y: (j + 0.5 + (r() - .5) * 0.8) * cell, h: 0.8 + r() * 0.2, rad: cell * (0.62 + r() * 0.3), tint: r(), ph: r() * 6.283, ca: Math.cos(r() * 3.1416), sa: 0, asp: 1 + r() * 0.6 });
  for (const t of tufts) t.sa = Math.sqrt(1 - t.ca * t.ca);   // tufts splay unevenly: elliptical, random orientation
  // fibre bundles: tileable value noise at ~1 mm (16 cells across the tile → period-exact)
  const fb = (x, y) => fbm(x / size * 112, y / size * 112, 2, 112, 112);
  const data = new Uint8Array(size * size * 4), dirs = new Uint8Array(size * size * 4), half = size / 2;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const ci = Math.floor(px / cell), cj = Math.floor(py / cell); let hi = 0, lo = 1, tint = 0.5, best = 9, ang = 0, ox = 0, oy = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const t = tufts[((cj + dj + n) % n) * n + ((ci + di + n) % n)];
      let dx = px - t.x, dy = py - t.y; if (dx > half) dx -= size; else if (dx < -half) dx += size; if (dy > half) dy -= size; else if (dy < -half) dy += size;
      const ex = dx * t.ca + dy * t.sa, ey = (-dx * t.sa + dy * t.ca) * t.asp, d = Math.hypot(ex, ey) / t.rad; if (d >= 1.25) continue;
      // the tuft blooms: fibres reach radius d only above height (d − 0.5)/0.75 of the tuft; the crown is domed
      const a = Math.max(0, (d - 0.5) / 0.75) * t.h, b = t.h * (1 - 0.28 * d * d);
      if (b > a) { hi = Math.max(hi, b); lo = Math.min(lo, a); }
      if (b > a && b >= hi - 1e-6) { ox = dx / t.rad; oy = dy / t.rad; }      // crown that is on top here
      if (d < best) { best = d; tint = t.tint; ang = Math.atan2(dy, dx) + t.ph; }
    }
    // fibres radiate from the tuft centre: streaks along the radius, broken up by the bundle noise
    const streak = 0.5 + 0.5 * Math.sin(ang * 9 + fb(px, py) * 7);
    const o = (py * size + px) * 4; data[o] = hi * 255; data[o + 1] = (hi > 0 ? lo : 1) * 255; data[o + 2] = (0.35 * streak + 0.65 * fb(px * 2.3 + 17, py * 2.3 + 5)) * 255; data[o + 3] = tint * 255;
    dirs[o] = (0.5 + 0.4 * Math.max(-1.25, Math.min(1.25, ox))) * 255; dirs[o + 1] = (0.5 + 0.4 * Math.max(-1.25, Math.min(1.25, oy))) * 255; dirs[o + 2] = 0; dirs[o + 3] = 255;
  }
  const mk = (d) => { const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true; return t; };
  return { vol: mk(data), dir: mk(dirs) };
}
function rugUndulation(x, z) {   // a rug never lies quite flat: soft waves (±2 mm) and slightly lifted corners
  const w = (fbm(x * 1.4 + 3.1, z * 1.4 + 7.7, 3) - 0.5) * 0.004;
  const ex = Math.max(0, Math.abs(x) / (RUG.W / 2) - 0.86) / 0.14, ez = Math.max(0, Math.abs(z) / (RUG.D / 2) - 0.86) / 0.14;
  return w + 0.004 * Math.pow(Math.min(1, ex) * Math.min(1, ez), 1.5);
}
function buildRug(parent, pouf) {
  const g = new THREE.Group(); g.position.set(0.3, 0, -3.75); g.rotation.y = -0.07; parent.add(g); g.updateMatrixWorld(true); pouf.updateMatrixWorld(true);
  const W = RUG.W, D = RUG.D, rc = RUG.corner, nx = 120, nz = 112;
  // ---- top grid (rug-local metres), rounded corners, undulation, pile crush + contact shadow from the pouf
  const top = new THREE.PlaneGeometry(W, D, nx, nz); top.rotateX(-Math.PI / 2);
  const P = top.attributes.position, nv = P.count, crush = new Float32Array(nv), occl = new Float32Array(nv), shade = new Float32Array(nv);
  // pouf in its own frame: plan superellipse (half sizes 0.7 × 0.61, n 4.4), flat top 0.5 m, steep sides
  const poufR = (x, z) => Math.pow(Math.pow(Math.abs(x) / 0.7, 4.4) + Math.pow(Math.abs(z) / 0.61, 4.4), 1 / 4.4);
  const poufH = (x, z) => { const q = poufR(x, z); return q >= 1 ? 0 : 0.5 * Math.pow(1 - Math.pow(q, 6), 0.3); };
  // directions toward the glass, in the pouf's frame (rotate by −pouf yaw): left wall −x, back wall −z; tan(elevation), weight
  const pr = pouf.rotation.y, rot = (x, z) => [x * Math.cos(pr) - z * Math.sin(pr), x * Math.sin(pr) + z * Math.cos(pr)];   // inverse of three's Y rotation
  const WIN_DIRS = [[...rot(-0.97, -0.24), Math.tan(0.42), 0.55], [...rot(-0.3, -0.95), Math.tan(0.55), 0.35]];
  const toPouf = new THREE.Matrix4().copy(pouf.matrixWorld).invert().multiply(g.matrixWorld), v = new THREE.Vector3();
  for (let i = 0; i < nv; i++) {
    let x = P.getX(i), z = P.getZ(i);
    const cx = Math.sign(x) * (W / 2 - rc), cz = Math.sign(z) * (D / 2 - rc);
    if (Math.abs(x) > W / 2 - rc && Math.abs(z) > D / 2 - rc) { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz); if (l > rc) { x = cx + dx / l * rc; z = cz + dz / l * rc; } }
    P.setXYZ(i, x, rugUndulation(x, z), z);
    v.set(x, 0, z).applyMatrix4(toPouf);
    const rr = poufR(v.x, v.z);
    crush[i] = THREE.MathUtils.lerp(0.32, 1, THREE.MathUtils.smoothstep(rr, 0.5, 0.86));     // pile height scale
    occl[i] = THREE.MathUtils.lerp(0.32, 1, THREE.MathUtils.smoothstep(rr, 0.8, 1.2));      // under the bulge → dark
    // window light is a big area light (RectAreaLight casts no shadow): march toward the left and back glass and
    // test the pouf's silhouette; the penumbra widens with distance like a real area-light shadow
    let sh = 0;
    for (const [dx, dz, el, k] of WIN_DIRS) { let o = 0;
      for (let t = 0.02; t < 1.6; t += 0.025) { const qx = v.x + dx * t, qz = v.z + dz * t, h = poufH(qx, qz); if (h <= 0) continue;
        const w = 0.03 + 0.4 * t; o = Math.max(o, THREE.MathUtils.smoothstep(h - t * el, -w, w)); }
      sh = Math.max(sh, o * k); }
    shade[i] = sh;
  }
  top.setAttribute('aPile', new THREE.BufferAttribute(crush, 1)); top.setAttribute('aAO', new THREE.BufferAttribute(occl, 1)); top.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
  top.computeVertexNormals();
  // ---- backing / pile root: what you see down between the tufts
  const baseMat = new THREE.MeshStandardMaterial({ color: RUG.wool.clone().multiplyScalar(0.42), roughness: 1 });
  baseMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAO; attribute float aShade; varying float vAO;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO * (1.0 - 0.4 * aShade); transformed.y += ' + RUG.back.toFixed(4) + ';');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAO;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vAO;');
  };
  const base = new THREE.Mesh(top, baseMat); base.receiveShadow = true; g.add(base);
  // ---- shells
  const L = RUG.layers, shellGeo = top.clone(), layer = new Float32Array(L);
  for (let k = 0; k < L; k++) layer[k] = (L - k) / L;                  // instance 0 = top layer (drawn first)
  shellGeo.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layer, 1));
  const tuft = tuftTexture();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  shellMat.alphaToCoverage = true;
  shellMat.onBeforeCompile = sh => {
    sh.uniforms.uTuft = { value: tuft.vol }; sh.uniforms.uTuftN = { value: tuft.dir }; sh.uniforms.uWool = { value: RUG.wool };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float aLayer; attribute float aPile; attribute float aAO; attribute float aShade;
      varying float vL; varying float vAO; varying vec2 vRug; varying float vShade; varying vec2 vView;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vL = aLayer; vAO = aAO; vRug = position.xz; vShade = aShade;
      vView = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xz - position.xz;   // toward the eye, rug frame
      transformed.y += ${RUG.back.toFixed(4)} + aLayer * ${RUG.pile.toFixed(4)} * aPile;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uTuft, uTuftN; uniform vec3 uWool;
      varying float vL; varying float vAO; varying vec2 vRug; varying float vShade; varying vec2 vView; vec2 vLeanV, vCrown;
      float rh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float rn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(rh(i), rh(i + vec2(1, 0)), f.x), mix(rh(i + vec2(0, 1)), rh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `
        // pile lay drifts across the rug (broad patches) and tufts clump together (≈5 cm), leaning up to ~1 mm at the tips
        vec2 lean = (vec2(rn(vRug * 1.3 + 4.1), rn(vRug * 1.3 + 9.7)) - 0.5) + 0.7 * (vec2(rn(vRug * 19.0 + 2.3), rn(vRug * 19.0 + 6.1)) - 0.5);
        vec2 tuv = vRug / ${RUG.tile.toFixed(4)} - lean * vL * vL * 0.012;
        vec4 tf = texture2D(uTuft, tuv);
        float inside = min(vL - tf.g, tf.r - vL);
        float aa = 0.05 + 1.5 * fwidth(tf.r);
        float cov = smoothstep(-aa, aa, inside);
        // level of detail, judged by the size of a tuft (≈18 texels) on screen: fibre streaks fade first (< ~4 px per
        // tuft), then the cut-outs themselves (< ~2 px per tuft) so distant pile reads as a solid, slightly darker top
        vec2 tpx = fwidth(tuv) * 512.0; float tp = max(tpx.x, tpx.y);
        float tipLod = smoothstep(2.5, 5.0, tp), lod = smoothstep(6.0, 12.0, tp);
        float tip = smoothstep(tf.r - 0.3, tf.r, vL) * 0.75 * (1.0 - tipLod);  // fibres taper and thin out at the tips
        cov *= smoothstep(tip - 0.15, tip + 0.15, tf.b);
        cov = mix(cov, smoothstep(0.05, -0.05, vL - 0.84), lod);
        diffuseColor.a = cov;
        float shade = mix(0.38, 1.0, pow(vL, 1.1)) * mix(1.0, 0.9, lod);    // fibre self-shadow toward the backing
        vCrown = (texture2D(uTuftN, tuv).rg - 0.5) * 2.5 * (1.0 - lod);   // offset from the crown centre (crown normal)
        float heather = 0.975 + 0.05 * rn(vRug * 2.1 + 1.7) + 0.02 * (rn(vRug * 9.0) - 0.5);
        // pile reversal ('shading'): looking into the leaning tips shows cut ends and shadowed gaps (darker), looking
        // along the lay shows fibre sides (lighter) - patches that shift as you walk around the rug
        heather *= 1.0 - 0.2 * dot(lean, normalize(vView));
        vLeanV = lean;
        diffuseColor.rgb = uWool * (0.9 + 0.18 * tf.a) * shade * heather * vAO * mix(vec3(1.0), vec3(0.55, 0.62, 0.71), vShade) * mix(vec3(0.9, 0.95, 1.04), vec3(1.0), vAO);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(vLeanV.x * 0.45 + vCrown.x * 0.9, 0.0, vLeanV.y * 0.45 + vCrown.y * 0.9, 0.0)).xyz * vL);`);
  };
  const shells = new THREE.InstancedMesh(shellGeo, shellMat, L); shells.frustumCulled = false; shells.receiveShadow = true;
  for (let k = 0; k < L; k++) shells.setMatrixAt(k, new THREE.Matrix4()); g.add(shells);
  // ---- serged edge: yarn overcast round the border (diagonal wraps ≈ every 4.5 mm)
  const path = []; const seg = 10;
  for (const [sx, sz, a0] of [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI * 1.5]]) {
    const cx = sx * (W / 2 - rc), cz = sz * (D / 2 - rc);
    for (let k = 0; k <= seg; k++) { const a = a0 + k / seg * Math.PI / 2, x = cx + Math.cos(a) * rc, z = cz + Math.sin(a) * rc; path.push(new THREE.Vector3(x, 0, z)); }
  }
  // densify the straight runs so the tube follows the undulation
  const pts = []; for (let i = 0; i < path.length; i++) { const a = path[i], b = path[(i + 1) % path.length], n2 = Math.max(1, Math.ceil(a.distanceTo(b) / 0.04));
    for (let k = 0; k < n2; k++) { const q = a.clone().lerp(b, k / n2); q.y = 0.0082 + rugUndulation(q.x, q.z); pts.push(q); } }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal'), per = curve.getLength();
  const wc = canvas(64, 32), wg = wc.getContext('2d'), wd = wg.createImageData(64, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) { const s = (x / 64 + y / 32 * 0.35) % 1, ridge = Math.pow(Math.sin(Math.PI * s), 0.6), o = (y * 64 + x) * 4; const c = 150 + ridge * 105; wd.data[o] = wd.data[o + 1] = wd.data[o + 2] = c; wd.data[o + 3] = 255; }
  wg.putImageData(wd, 0, 0); const wrap = ctex(wc, { srgb: false }); wrap.repeat.set(per / 0.0045, 1);
  const bindMat = new THREE.MeshStandardMaterial({ color: RUG.wool.clone().multiplyScalar(0.93), roughness: 1, bumpMap: wrap, bumpScale: 1.2 });
  const bind = new THREE.Mesh(new THREE.TubeGeometry(curve, 900, 0.0084, 10, true), bindMat); bind.castShadow = bind.receiveShadow = true; g.add(bind);
  // ---- soft contact shadow on the floor along the border
  { const m = 0.07, cw = 256, ch = Math.round(256 * (D + 2 * m) / (W + 2 * m)), c2 = canvas(cw, ch), x2 = c2.getContext('2d'), id = x2.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const px = (x + 0.5) / cw * (W + 2 * m) - (W / 2 + m), pz = (y + 0.5) / ch * (D + 2 * m) - (D / 2 + m);
      const qx = Math.abs(px) - (W / 2 - rc), qz = Math.abs(pz) - (D / 2 - rc), sd = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rc;
      const a = sd < 0 ? 0.5 : 0.5 * Math.pow(1 - Math.min(1, sd / m), 2.2), o = (y * cw + x) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = 0; id.data[o + 3] = a * 255; }
    x2.putImageData(id, 0, 0); const st = ctex(c2, { rep: false });
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(W + 2 * m, D + 2 * m), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    dec.rotation.x = -Math.PI / 2; dec.position.y = 0.0006; dec.renderOrder = -1; g.add(dec); }
  g.userData = { shells, base, bind, tuft: tuft.vol };
  return g;
}
/* ---------------------------------------------------------------- small furniture */
function stumpTable() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.3, 0.05, 48), MAT.oak); top.position.y = 0.505; g.add(top);
  const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.24 + 0.012 * Math.sin(t * 9) + (t < .1 ? .02 * (1 - t / .1) : 0), t * 0.48)); }
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), MAT.oakDark); g.add(body);
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.24, 40), MAT.oakDark); cap.rotation.x = -Math.PI / 2; cap.position.y = 0.48; g.add(cap);
  g.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
  return g;
}
function leafGeometry() {
  // 0.1 m long leaf, slightly folded along the midrib, pointing +z
  const pts = []; const L = 1, segs = 8; const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) { const t = i / segs; const w = Math.sin(Math.PI * Math.pow(t, 0.75)) * 0.32 * (1 - 0.25 * t); const y = -0.18 * t * t; pos.push(-w, y - w * 0.18, t * L, 0, y, t * L, w, y - w * 0.18, t * L); }
  for (let i = 0; i < segs; i++) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function plant({ leaves = 90, spread = 0.55, height = 0.75, seed = 5, scale = 0.12 } = {}) {
  const r = rng(seed); const g = new THREE.Group(); const lg = leafGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(lg, mat, leaves); const stems = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < leaves; i++) {
    const a = r() * Math.PI * 2, rad = Math.pow(r(), 0.7) * spread, h = height * (0.25 + 0.75 * r()) * (1 - 0.45 * rad / spread);
    p.set(Math.cos(a) * rad, h, Math.sin(a) * rad);
    e.set(-0.3 - r() * 0.9 + rad * 0.6, a + Math.PI / 2 + (r() - .5) * 1.2, (r() - .5) * .8, 'YXZ'); q.setFromEuler(e);
    const sc = scale * (0.7 + r() * 0.6); s.set(sc, sc, sc * 1.2); m.compose(p, q, s); inst.setMatrixAt(i, m);
    inst.setColorAt(i, new THREE.Color().setHSL(0.24 + r() * 0.06, 0.45 + r() * .2, 0.3 + r() * 0.22));
    if (i % 3 === 0) stems.push(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(p.x * .3, p.y * .8, p.z * .3), p.clone()));
  }
  inst.castShadow = true; g.add(inst);
  const sg = stems.map(c => new THREE.TubeGeometry(c, 8, 0.004, 4)); g.add(new THREE.Mesh(mergeGeometries(sg), new THREE.MeshStandardMaterial({ color: 0x5a7a3a, roughness: .7 })));
  return g;
}
function tableLamp() {
  const g = new THREE.Group();
  const prof = [[.001, 0], [.06, 0], [.075, .02], [.085, .08], [.078, .16], [.05, .22], [.026, .25], [.022, .28]];
  const base = new THREE.Mesh(new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p[0], p[1])), 32), MAT.ceramic); base.castShadow = true; g.add(base);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.007, .007, .1, 8), MAT.brass); stem.position.y = .32; g.add(stem);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(.115, .16, .21, 48, 1, true), MAT.shade); shade.position.y = .4; g.add(shade);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.16, .004, 6, 48), MAT.brass); rim.rotation.x = Math.PI / 2; rim.position.y = .295; g.add(rim);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.03, 12, 8), MAT.bulb); bulb.position.y = .37; g.add(bulb);
  const light = new THREE.PointLight(0xffc27e, 3.2, 5, 2); light.position.y = .37; g.add(light);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc27e, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(.9); glow.position.y = .4; g.add(glow);
  g.userData.light = light; g.userData.glow = glow; return g;
}
let _glow;
function glowTex() { if (_glow) return _glow; const c = canvas(128, 128), g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); _glow = ctex(c, { rep: false }); return _glow; }
function floorLamp() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.15, .16, .025, 40), MAT.bronze); base.position.y = .0125; g.add(base);
  const poleH = 1.42; const pole = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, poleH, 10), MAT.brass); pole.position.y = poleH / 2; g.add(pole);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(.025, 14, 10), MAT.brass); joint.position.y = poleH; g.add(joint);
  // main arm towards the shade (local −x, up), counter arm behind
  const arm = new THREE.Group(); arm.position.y = poleH; arm.rotation.z = -0.62; g.add(arm);
  const aL = 1.0; const rod = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, aL + .32, 8), MAT.brass); rod.rotation.z = Math.PI / 2; rod.position.x = -(aL - .32) / 2; arm.add(rod);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.03, 14, 10), MAT.bronze); knob.position.x = .32; arm.add(knob);
  const head = new THREE.Group(); head.position.x = -aL; arm.add(head);
  const sh = new THREE.Mesh(new THREE.LatheGeometry([[.014, 0], [.035, .012], [.06, .05], [.1, .13], [.15, .23], [.165, .25]].map(p => new THREE.Vector2(p[0], -p[1])), 48), MAT.copper);
  sh.rotation.set(-0.25, 0, 0.62 - 0.4); head.add(sh);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(.155, 40), new THREE.MeshBasicMaterial({ color: 0xffe6b0, side: THREE.DoubleSide })); inner.rotation.x = Math.PI / 2; inner.position.y = -.235; sh.add(inner);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc98f, transparent: true, opacity: .6, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(.6); glow.position.y = -.25; sh.add(glow);
  const pt = new THREE.PointLight(0xffc98f, 2.5, 4, 2); pt.position.y = -.3; sh.add(pt);
  const spot = new THREE.SpotLight(0xffc98f, 18, 7, 0.75, 0.65, 2); spot.position.set(0, -.1, 0); sh.add(spot);
  const tgt = new THREE.Object3D(); tgt.position.set(0, -2, 0); sh.add(tgt); spot.target = tgt; spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0005; spot.shadow.camera.near = 0.1;
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  g.userData.light = spot; g.userData.pt = pt; g.userData.glow = glow; g.userData.inner = inner; return g;
}
function candleJar() {
  const g = new THREE.Group();
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .09, 24, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .1, transparent: true, opacity: .35, side: 2 })); jar.position.y = .045; g.add(jar);
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(.036, .036, .04, 24), new THREE.MeshStandardMaterial({ color: 0xf2e8d2, roughness: .6, emissive: 0xffb060, emissiveIntensity: .25 })); wax.position.y = .02; g.add(wax);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(.007, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a })); flame.scale.y = 2; flame.position.y = .052; g.add(flame); g.userData.flame = flame;
  return g;
}
/* A bare bulb on a cord from the ceiling (G, 17/10/2026: "em cho bóng đèn này thành downlight ... nhớ làm thêm chuôi
   đèn và dây từ ceiling xuống"). The bulb is rebuilt from the measurements of "Incandescent Light Bulb" by AleixoAlonso
   (CC BY 4.0; 3D Assets/interior/light-bulb-incandescent.glb, an A-shape bulb 15.2 cm tall, its glass 9.2 cm across).
   Measured in its own frame, from the tip of its base up:
   - its glass, the model's profile turned;
   - its screw base, the thread's last ridges showing under the socket, and the black insulator at its tip;
   - the flattened glass stem; the two lead-in wires and the two supports; the coiled filament across their tops.
   It hangs base up in a brass socket (a shell over the thread, a collar, a domed cap, a cord grip), on a cloth cord
   from a brass cup on the ceiling. Its light is a spot straight down (a downlight); by night the filament glows, and
   the glass a little with it. drop: from the ceiling to the middle of the socket and bulb (m).                        */
function pendantLamp(drop) {
  const g = new THREE.Group(), lathe = (pts, mat, seg = 32) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);
  const tipY = -drop + 0.047, gripY = tipY + 0.058, cord = -gripY - 0.032;   // (the bulb's frame: the base's tip at tipY, its glass 0.152 below)
  // the ceiling cup and the cord
  g.add(lathe([[.004, -.032], [.010, -.031], [.030, -.027], [.045, -.018], [.052, -.008], [.055, 0]], MAT.brass, 40));
  const cloth = new THREE.Mesh(new THREE.CylinderGeometry(.0035, .0035, cord, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: .85 }));
  cloth.position.y = -.032 - cord / 2; g.add(cloth);
  // the bulb, in its own frame (y up from the tip of the base), turned base up
  // (the bulb and its socket 20 % larger than the model's: G, 17/10/2026; hung from the same cord grip)
  const BS = 1.2, tipB = gripY - 0.058 * BS, b = new THREE.Group(); b.rotation.x = Math.PI; b.scale.setScalar(BS); b.position.y = tipB; g.add(b);
  b.add(lathe([[.0001, 0], [.0022, .0003], [.0086, .0028], [.0086, .0037]], new THREE.MeshStandardMaterial({ color: 0x141414, roughness: .3 }), 24));   // the insulator
  b.add(lathe([[.0086, .0037], [.0187, .0095], [.0200, .024], [.0207, .0255], [.0189, .0272], [.0207, .0289], [.0198, .0301], [.0191, .031], [.0184, .0326], [.0176, .0332]],
    new THREE.MeshStandardMaterial({ color: 0xc9c9c4, metalness: 1, roughness: .3 }), 32));   // the screw base
  // its glass: clear, lit by the room, more of it seen toward its edges (as glass is: Fresnel), a little warm from inside
  // when on; it keeps its depth, so the night sky (drawn after the paint, where the room left no depth) stays behind it
  const glass = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: .05, metalness: 0, transparent: true, opacity: .04, envMapIntensity: 1.6, emissive: 0xffd2a0, emissiveIntensity: 0 });
  glass.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
    gl_FragColor.a = clamp(gl_FragColor.a + 0.45 * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5), 0.0, 0.7);`); };
  const env = [[.0176, .0315], [.0205, .0365], [.0227, .040], [.0236, .0432], [.0240, .0466], [.0248, .0533], [.0279, .0633], [.0325, .070], [.0382, .080], [.0424, .090],
    [.0450, .0968], [.0459, .1069], [.0450, .1136], [.0424, .1236], [.0382, .1303], [.0325, .137], [.0255, .1437], [.0176, .1471], [.0090, .1504], [.0001, .1521]];
  // (its far side first, as the profile turned the other way, so its faces look inward and it shares the near side's
  // shader; the stem between them)
  const back = lathe([...env].reverse(), glass, 40), front = lathe(env, glass, 40); back.renderOrder = 1; front.renderOrder = 3; b.add(back, front);
  const stemShape = new THREE.Shape(), sp = [[.0084, .030], [.0085, .048], [.0062, .0525], [.0069, .057], [.0079, .0615], [.0068, .066], [.0026, .0705], [.0021, .075], [.0021, .0795], [.0048, .084]];
  stemShape.moveTo(-sp[0][0], sp[0][1]); for (const [x, y] of sp) stemShape.lineTo(x, y); for (let i = sp.length - 1; i >= 0; i--) stemShape.lineTo(-sp[i][0], sp[i][1]);
  const stemG = new THREE.ExtrudeGeometry(stemShape, { depth: .0038, bevelEnabled: false }); stemG.translate(0, 0, -.0019);
  const stem = new THREE.Mesh(stemG, new THREE.MeshStandardMaterial({ color: 0xf4f6f2, roughness: .1, transparent: true, opacity: .32, depthWrite: false })); stem.renderOrder = 2; b.add(stem);
  // the wires: lead-ins from the stem to the filament's ends, supports from its top up over it and hooked down onto it
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z), rod = (a, c, r) => { const d = c.clone().sub(a), m = new THREE.CylinderGeometry(r, r, d.length(), 5, 1, true);
    m.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); m.translate((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2); return m; };
  const wires = [];
  for (const s of [-1, 1]) {
    wires.push(rod(V(s * .005, .034), V(s * .005, .0373), .0004), rod(V(s * .005, .0373), V(s * .0148, .1007), .0004));
    wires.push(rod(V(s * .0011, .0687), V(s * .0087, .1063), .00032), rod(V(s * .0087, .1063), V(s * .0087, .1013), .00032));
  }
  b.add(new THREE.Mesh(mergeGeometries(wires), new THREE.MeshStandardMaterial({ color: 0x5a5a58, metalness: .7, roughness: .35 })));
  const turns = 18, hp = []; for (let i = 0; i <= turns * 10; i++) { const t = i / (turns * 10), a = t * turns * 2 * Math.PI; hp.push(V(-.016 + .032 * t, .1008 + .0011 * Math.cos(a), -.0002 + .0011 * Math.sin(a))); }
  const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp), turns * 16, .00028, 4), new THREE.MeshStandardMaterial({ color: 0x6a6a66, metalness: .6, roughness: .4, emissive: 0xffcf90, emissiveIntensity: 0 }));
  b.add(coil);
  // the socket over the base, base up: cord grip, domed cap, collar, shell, lip, and in under the lip
  b.add(lathe([[.0036, -.058], [.0062, -.0575], [.0062, -.044], [.012, -.043], [.0175, -.040], [.0215, -.0355], [.024, -.029], [.0248, -.024], [.0258, -.0235], [.0258, -.0195], [.0247, -.019],
    [.0247, -.002], [.0241, -.001], [.0247, 0], [.0247, .0225], [.0253, .0235], [.0253, .025], [.0213, .0252], [.0211, .02]], MAT.brass, 40));
  // its light: a spot straight down, from just under the glass (from the filament it would light the glass itself, 5 cm
  // away, white), and a glow round the bulb
  const spotY = tipB - .162 * BS, light = new THREE.SpotLight(0xffc98f, 0, 9, 0.85, 0.8, 2); light.position.y = spotY; light.target.position.y = spotY - 2.5; light.visible = false; g.add(light, light.target);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc98f, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(.26 * BS); glow.position.y = tipB - .105 * BS; glow.renderOrder = 4; g.add(glow);
  const at = new THREE.Vector3(), toCam = new THREE.Vector3();   // (drawn 7 cm toward the eye, in front of the glass that hides what is behind it)
  glow.onBeforeRender = (r, s, cam) => { g.localToWorld(at.set(0, tipB - .105 * BS, 0)); toCam.setFromMatrixPosition(cam.matrixWorld).sub(at).normalize(); glow.matrixWorld.setPosition(at.addScaledVector(toCam, .07)); };
  g.userData.light = light; g.userData.glow = glow; g.userData.coil = coil; g.userData.glass = glass;
  return g;
}
/* ---------------------------------------------------------------- bushes
   The shrubs past the glass, drawn the way stylized games draw a bush ("fluffy" foliage, as in Breath of the Wild or
   Genshin Impact; Minions Art's write-ups of the technique): a cloud of cards around an ellipsoid, each a cluster of
   a few big leaves on a twig, turned to face the viewer (so none is seen edge on) with its twig pointing out from the
   bush's middle. The cards are not lit by their own facing but by the bush's roundness (each card's normal is the
   way out from the bush's centre), so a bush shades as one soft volume, lit on top and on the sun's side, in shade
   below, its inner cards darker: the way a watercolourist paints a bush as one wash with a few leaves at its edge.
   The leaves are big enough (~10–20 px on the screen) for the watercolour pass to paint them as leaves; the old cards
   (sprigs of tiny ash leaflets) came out of it as noise, outlined blocks and holes. Their edges: alpha to coverage
   (the scene is drawn with 4× MSAA), the alpha sharpened by its own screen derivative (three.js) and kept from thinning
   out in the smaller mip levels (Ben Golus, "Anti-aliased Alpha Test: The Esoteric Alpha To Coverage", 2017), and the
   empty texels given a green, not black, so the far leaves are not fringed dark. One draw for all the bushes, and
   one more for the soft shade each casts round its foot (a blob shadow, as games ground their foliage).          */
const BUSH = { N: 1024, mat: null };
// the leaf clusters: four kinds on one atlas (2 × 2 cells of 512 px), each a twig up from the bottom of its cell with
// eight to eleven leaves along it, the low ones out sideways, the top ones up; in the garden's greens (the trees'
// tones), each leaf darker at its foot, the pigment gathered at its rim, a pale midrib
function bushAtlas() {
  const S = BUSH.N / 2, c = canvas(BUSH.N, BUSH.N), g = c.getContext('2d'), r = rng(20261015);
  const TONES = [[58, 84, 40], [80, 112, 50], [104, 140, 62], [138, 166, 82], [166, 182, 96]];
  const rgb = (a, b, d) => `rgb(${Math.min(255, a) | 0},${Math.min(255, b) | 0},${Math.min(255, d) | 0})`;
  const leaf = (x, y, a, L, W, [R, G, B]) => {   // from (x, y) toward angle a (0 = up), L long, W half-wide
    g.save(); g.translate(x, y); g.rotate(a);
    const p = new Path2D(); p.moveTo(0, 0); p.bezierCurveTo(W * 1.15, -L * 0.18, W * 0.95, -L * 0.72, 0, -L); p.bezierCurveTo(-W * 0.95, -L * 0.72, -W * 1.15, -L * 0.18, 0, 0);
    const k = 0.9 + r() * 0.2, gr = g.createLinearGradient(0, 0, 0, -L);
    gr.addColorStop(0, rgb(R * k * 0.8, G * k * 0.8, B * k * 0.8)); gr.addColorStop(1, rgb(R * k * 1.12, G * k * 1.1, B * k * 1.04));
    g.fillStyle = gr; g.fill(p);
    g.lineWidth = 3.5; g.strokeStyle = `rgba(${R * 0.5 | 0},${G * 0.58 | 0},${B * 0.45 | 0},0.5)`; g.stroke(p);
    g.lineWidth = 2; g.strokeStyle = `rgba(${Math.min(255, R * 1.6) | 0},${Math.min(255, G * 1.45) | 0},${Math.min(255, B * 1.3) | 0},0.3)`;
    g.beginPath(); g.moveTo(0, -L * 0.04); g.quadraticCurveTo(W * 0.15, -L * 0.5, 0, -L * 0.86); g.stroke();
    g.restore();
  };
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * S, oy = Math.floor(v / 2) * S, bx = ox + S / 2, by = oy + S * 0.97, tx = bx + (r() - 0.5) * S * 0.12, ty = oy + S * 0.4;
    g.strokeStyle = 'rgb(98,106,64)'; g.lineWidth = 5; g.lineCap = 'round';   // (olive: a dark twig seen between the leaves came out of the paint as specks)
    g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + (r() - 0.5) * S * 0.08, (by + ty) / 2, tx, ty); g.stroke();
    const n = 8 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), px = bx + (tx - bx) * (0.2 + 0.8 * t), py = by + (ty - by) * (0.2 + 0.8 * t);
      const a = (i % 2 ? 1 : -1) * (1.3 - 1.0 * t) + (r() - 0.5) * 0.4, L = S * (0.25 + 0.1 * r()) * (1 - 0.3 * t);
      leaf(px, py, a, L, L * (0.27 + 0.07 * r()), TONES[Math.floor(r() * TONES.length)]);
    }
  }
  // as data (a canvas keeps no colour where it is clear): the empty texels made a mid green
  const d = g.getImageData(0, 0, BUSH.N, BUSH.N).data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 0) { d[i] = 80; d[i + 1] = 112; d[i + 2] = 50; }
  const t = new THREE.DataTexture(d, BUSH.N, BUSH.N);   // (rows top first: the canvas's top is v = 0)
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
function bushMaterial() {
  const mat = new THREE.MeshStandardMaterial({ map: bushAtlas(), roughness: 0.85, metalness: 0, alphaTest: 0.5, alphaToCoverage: true });
  mat.customProgramCacheKey = () => 'bush';
  mat.onBeforeCompile = sh => {
    sh.uniforms.uWind = WIND.t;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBush; uniform float uWind;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        { float k = floor(aBush.w * 4.0); vec2 q = vec2(fract(aBush.w * 7.31) < 0.5 ? uv.x : 1.0 - uv.x, 1.0 - uv.y);   // its kind of cluster, now and then mirrored
          vMapUv = (q + vec2(mod(k, 2.0), floor(k * 0.5))) * 0.5; }`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        transformedNormal = normalize(normalMatrix * normalize(((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz - aBush.xyz) / vec3(1.0, 0.8, 1.0)));   // the bush's roundness`)
      .replace('#include <project_vertex>', `
        // the card faces the viewer, its twig pointing out from the bush's middle (and a little up), each its own way;
        // the wind rocks it a little about its foot
        vec3 ctr = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float sz = length(instanceMatrix[0].xyz), ph = aBush.w * 6.2832;
        vec4 mvPosition = modelViewMatrix * vec4(ctr, 1.0);
        vec2 o2 = mvPosition.xy - (modelViewMatrix * vec4(aBush.xyz, 1.0)).xy;
        vec2 up = normalize(vec2(0.0, 0.6) + o2 / (length(o2) + 1e-4) + 0.45 * vec2(sin(ph * 3.1), cos(ph * 2.3)));
        float sw = ${(0.4 * WIND.amp).toFixed(4)} * sin(uWind * 1.3 + ph * 5.0) + 0.5 * (fract(aBush.w * 13.7) - 0.5);
        up = vec2(up.x * cos(sw) - up.y * sin(sw), up.x * sin(sw) + up.y * cos(sw));
        mvPosition.xy += (vec2(up.y, -up.x) * position.x + up * (position.y + 0.25)) * sz;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
      { vec2 tc = vMapUv * ${BUSH.N.toFixed(1)}, dx = dFdx(tc), dy = dFdy(tc);   // (Golus: the leaves keep their cover in the smaller mip levels)
        diffuseColor.a *= 1.0 + max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy)))) * 0.25; }
      #include <alphatest_fragment>`);
  };
  return mat;
}
// the bushes ([x, z, size] each, standing on the lawn at y −0.12): their cards, inner and lower ones darker, each
// a touch warmer or cooler; each bush from its own seed, so a bush stays the same whatever else changes
function buildBushes(list) {
  const plan = [];
  for (const [x, z, s] of list) {
    const r = rng(Math.floor(x * 100 + z * 7 + 999)), cy = -0.12 + 0.62 * s, n = Math.round(Math.min(95, Math.max(40, 52 * s * s)));
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, h = Math.sqrt(1 - u * u), f = 0.55 + 0.45 * Math.sqrt(r());   // a direction, and how far out (mostly near the surface)
      const dx = h * Math.cos(a), dy = u, dz = h * Math.sin(a);
      const y = Math.max(-0.05 + r() * 0.1, cy + dy * 0.72 * s * f), shade = (0.62 + 0.38 * THREE.MathUtils.smoothstep(f, 0.55, 1.0)) * (0.78 + 0.22 * THREE.MathUtils.smoothstep(dy, -0.6, 0.6));
      const warm = r() - 0.5, lum = shade * (0.92 + 0.16 * r());
      plan.push([x + dx * 0.95 * s * f, y, z + dz * 0.95 * s * f, (0.39 + 0.18 * r()) * s, x, cy, z, r(), lum * (1 + 0.06 * warm), lum * (1 + 0.03 * warm), lum * (1 - 0.08 * warm)]);
    }
  }
  BUSH.mat ||= bushMaterial();
  const geo = new THREE.PlaneGeometry(1, 1), mesh = new THREE.InstancedMesh(geo, BUSH.mat, plan.length), aB = new Float32Array(plan.length * 4);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  plan.forEach(([px, py, pz, size, bx, by, bz, w, cr, cg, cb], i) => {
    mesh.setMatrixAt(i, m.compose(p.set(px, py, pz), q, sc.setScalar(size))); mesh.setColorAt(i, col.setRGB(cr, cg, cb));
    aB.set([bx, by, bz, w], i * 4);
  });
  geo.setAttribute('aBush', new THREE.InstancedBufferAttribute(aB, 4));
  mesh.frustumCulled = false;   // (the cards are placed in the shader)
  // the shade on the ground round each bush's foot, just above the patio and the lawn
  const sc2 = canvas(128, 128), sg = sc2.getContext('2d'), gr = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#b3b3b3'); gr.addColorStop(1, '#000');   // (an alpha map is read from its green)
  sg.fillStyle = '#000'; sg.fillRect(0, 0, 128, 128); sg.fillStyle = gr; sg.fillRect(0, 0, 128, 128);
  const blob = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x1c2410, alphaMap: new THREE.CanvasTexture(sc2), transparent: true, opacity: 0.42, depthWrite: false }), list.length);
  list.forEach(([x, z, s], i) => blob.setMatrixAt(i, m.compose(p.set(x, -0.092, z), q, sc.set(2.5 * s, 1, 2.5 * s))));
  blob.frustumCulled = false; blob.renderOrder = -1;
  mesh.add(blob);
  return mesh;
}
/* ---------------------------------------------------------------- outside */
const outside = new THREE.Group(); scene.add(outside);
const LEFT_KEEP = 0.65 * 0.7;   // the share of their leaves the trees past the left glass keep (G, 14/10/2026: 35 % fewer, then 30 % fewer again)
function buildOutside(assets) {
  // ground: lawn + patio
  const gc = canvas(512, 512), gg = gc.getContext('2d'); const id = gg.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const n = fbm(x / 512 * 16, y / 512 * 16, 5, 16, 16); const c = hsl(88 + n * 20, .35, .28 + n * .2); const o = (y * 512 + x) * 4; id.data[o] = c.r * 255; id.data[o + 1] = c.g * 255; id.data[o + 2] = c.b * 255; id.data[o + 3] = 255; }
  gg.putImageData(id, 0, 0); const grassT = ctex(gc); grassT.repeat.set(40, 40);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ map: grassT, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; ground.receiveShadow = true; outside.add(ground);
  const pc = canvas(512, 512), pg = pc.getContext('2d'); pg.fillStyle = '#9a968c'; pg.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) { const ox = (y % 2) * 40; pg.fillStyle = hsl(40, .06, .62 + rand() * .12).getStyle(); pg.fillRect(x * 86 + ox + 2 - 43, y * 64 + 2, 82, 60); pg.fillRect(x * 86 + ox + 2 + 473, y * 64 + 2, 82, 60); }
  const patT = ctex(pc); patT.repeat.set(2, 3.5);
  const patio = new THREE.Mesh(new THREE.PlaneGeometry(4, 11), new THREE.MeshStandardMaterial({ map: patT, roughness: .95 })); patio.rotation.x = -Math.PI / 2; patio.position.set(R.xL - 2.2, -0.1, -3.1); patio.receiveShadow = true; outside.add(patio);
  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uNight: NIGHT.u, uTime: WIND.t, ...SKYU },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uNight, uTime, uDay, uGlow, uWarm, uOv; uniform vec3 uSunDir, uSunCol; varying vec3 vP;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      float fb(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
      void main(){ float h = clamp(vP.y, 0.0, 1.0);   // the stars and the moon are drawn sharp after the watercolour pass (buildNightSky)
        // a clear blue day: deep at the zenith, paler toward the horizon (linear values, before the tone curve)
        vec3 day = mix(vec3(0.3, 0.55, 0.95), vec3(0.04, 0.2, 0.82), pow(h, 0.5));
        // fair-weather clouds on a high layer, drifting slowly; soft lit tops, faintly grey bellies, thinning near the horizon
        vec2 q = vP.xz / max(vP.y + 0.08, 0.08) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
        float n = fb(q), cl = smoothstep(0.47, 0.66, n) * smoothstep(0.02, 0.16, h);
        float lit = smoothstep(0.45, 0.8, fb(q + vec2(0.05, 0.08)));
        // a low sun: the horizon pales to gold and the clouds take the sun's colour
        vec3 dirH = normalize(vec3(vP.x, 0.0, vP.z) + 1e-5), sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
        float toward = 0.5 + 0.5 * dot(dirH, sunH);
        day = mix(day, vec3(0.95, 0.74, 0.48), uWarm * exp(-h * 4.0) * (0.45 + 0.4 * toward));
        vec3 cloud = mix(vec3(0.75, 0.8, 0.92) * (1.0 - 0.25 * uWarm), vec3(1.4, 1.4, 1.36) * uSunCol, lit);
        day = mix(day, cloud, cl);
        // an overcast (fx/rain.js): one grey layer, darker where it is thicker, paler toward the horizon, drifting
        float ovn = fb(vP.xz / max(vP.y + 0.08, 0.08) * 0.5 + vec2(uTime * 0.012, uTime * 0.004));
        vec3 ovc = mix(vec3(0.34, 0.37, 0.41), vec3(0.6, 0.63, 0.67), smoothstep(0.3, 0.72, ovn)) * mix(1.1, 0.9, h);
        day = mix(day, ovc, uOv);
        // twilight: violet low down to deep blue overhead, an orange band on the sun's side, the clouds lit from below
        vec3 twi = mix(vec3(0.34, 0.24, 0.4), vec3(0.05, 0.09, 0.28), pow(h, 0.45));
        twi = mix(twi, mix(vec3(0.1, 0.1, 0.17), vec3(0.95, 0.45, 0.32), pow(toward, 2.0) * 0.8), cl * 0.8);
        vec3 band = mix(vec3(1.0, 0.36, 0.12), vec3(1.0, 0.7, 0.35), smoothstep(0.0, 0.25, h)) * exp(-h * 5.0) * pow(toward, 2.5);
        twi = mix(twi, mix(vec3(0.12, 0.115, 0.15), vec3(0.2, 0.19, 0.23), smoothstep(0.3, 0.72, ovn)), uOv * 0.85);
        vec3 col = mix(twi, day, uDay) + band * uGlow * 1.15 * (1.0 - 0.9 * uOv);
        vec3 night = mix(vec3(0.04, 0.06, 0.11), vec3(0.005, 0.011, 0.032), pow(h, 0.45));   // (a dark country sky overhead, the glow of the air low down)
        night = mix(night, vec3(0.03, 0.033, 0.04) * (0.75 + 0.5 * smoothstep(0.3, 0.72, ovn)), uOv * 0.75);   // (under cloud: a dull dark grey)
        gl_FragColor = vec4(mix(col, night, uNight), 1.0); }` }));
  outside.add(sky); LIGHTS.sky = sky;
  if (!assets) return;
  // trees: instanced (built in code, see makeTrees) — dense ring around the glass pavilion
  const T = assets.trees; const spots = { A: [], B: [], C: [] };
  const inHouse = (x, z) => x > R.xL - 2.2 && x < R.xW + 1.5 && z > R.zB - 1.6 && z < R.zF + 1.6;
  const onPatio = (x, z) => x > R.xL - 4.4 && x < R.xL && z > -7.6 && z < 1.6;
  const r = rng(99); const all = [];
  // the sky stays open through the left glass, from the top of the frame down to the horizon (stars and the moon by night):
  // no tree, near or far, may rise into that part of the home view. A tree is a cylinder the size of its model, projected
  // with the painting's camera; the trees behind the back glass frame the painting and stay.
  const dims = {}; for (const k of ['A', 'B', 'C']) { const b = new THREE.Box3(); for (const pt of T[k].parts) b.union(pt.geometry.boundingBox); dims[k] = { top: b.max.y, rad: Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z) }; }
  const SKYWIN = [-80, 545, 360, 985];   // painting pixels: x from beyond the left edge to the back-left corner, y from above the frame to the horizon
  const inSkyWindow = (x, z, rad, top) => {   // does a cylinder (centre x, z) rise into that part of the view?
    if (x > R.xL - 0.6) return false;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let i = 0; i < 16; i++) { const a = i / 8 * Math.PI, px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad; if (pz > -0.3) continue;
      for (const py of [-0.12, top]) { const u = REF.px + REF.f * px / -pz, v = REF.py - REF.f * (py - REF.eye.y) / -pz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } }
    return u1 > SKYWIN[0] && u0 < SKYWIN[1] && v1 > SKYWIN[2] && v0 < SKYWIN[3];
  };
  const blocksSky = (k, x, z, s) => { const S = T[k].scale * s; return inSkyWindow(x, z, dims[k].rad * S, -0.12 + dims[k].top * S); };
  const ok = (x, z, d) => !inHouse(x, z) && !onPatio(x, z) && all.every(p => Math.hypot(p.x - x, p.z - z) > d);
  const add = (k, x, z, s, minD = 2.2) => { if (!ok(x, z, minD)) return false; const p = { x, z, s, ry: r() * 6.28 }; spots[k].push(p); all.push(p); return true; };
  // hand-placed trees that frame the back window and the left glass
  for (const [k, x, z, sc] of [['A', -0.4, -11.2, 1.0], ['C', 1.9, -12.6, 1.0], ['A', -2.9, -10.4, .95], ['B', 3.9, -10.6, .9], ['A', 0.9, -14.6, 1.1], ['C', -4.6, -13.4, 1.05],
    ['A', -5.6, -2.2, 1.0], ['C', -7.2, -6.2, 1.1], ['A', -6.0, -9.0, .95], ['B', -8.6, 0.6, 1.0], ['A', -5.4, 2.6, .9], ['C', -9.8, -3.0, 1.0], ['A', -10.5, -9.8, 1.05], ['B', -7.4, -12.4, 1.0],
    ['A', 0.2, 5.2, 1.0], ['C', -2.8, 6.2, 1.0], ['B', 3.4, 6.0, .95]]) add(k, x, z, sc, 1.8);
  let tries = 0;
  while (tries++ < 2000 && all.length < 52) {
    const a = r() * Math.PI * 2, d = 7 + Math.pow(r(), 0.8) * 45; const x = Math.cos(a) * d - 1.5, z = Math.sin(a) * d - 3.5; if (x > R.xW + 5) continue;
    const near = d < 16; add(pick(near ? ['A', 'A', 'C', 'B'] : ['A', 'A', 'A', 'C']), x, z, 0.85 + r() * 0.45, near ? 2.8 : 4.5);
  }
  for (const k of ['A', 'B', 'C']) spots[k] = spots[k].filter(p => !blocksSky(k, p.x, p.z, p.s));   // placed as before, then cleared (the rest keep their places)
  // trees no view can see are not drawn at all: the whole crown stands behind the solid shelf wall and the roof (the room's
  // x and z ranges: only the front glass, behind every view, looks at it), or behind the viewer's plane
  const unseen = (x, z, rad) => (x - rad > R.xL && z - rad > R.zB + 0.2) || z - rad > -0.3;
  for (const k of ['A', 'B', 'C']) spots[k] = spots[k].filter(p => !unseen(p.x, p.z, dims[k].rad * T[k].scale * p.s * 1.05));
  // a few young trees in that garden, far enough and small enough that their crowns stop below the moon (~9° up)
  for (const [k, az, d, top, ry] of [['A', 9, 30, 8.5, 1.1], ['C', 19, 24, 8.8, 4.0], ['B', 24.5, 17, 9.0, 2.3]]) {
    const a = az * Math.PI / 180, h = REF.eye.y + 0.12 + d * Math.tan(top * Math.PI / 180);
    spots[k].push({ x: -Math.sin(a) * d, z: -Math.cos(a) * d, s: h / (dims[k].top * T[k].scale), ry, near: true });
  }
  // far trees get a thinned leaf LOD (fewer, larger leaf cards); past the left glass every tree keeps LEFT_KEEP of its
  // leaves (the same cards, fewer: the garden there had crowded the view out)
  const cx = (R.xL + R.xW) / 2, cz = (R.zB + R.zF) / 2;
  for (const k of ['A', 'B', 'C']) for (const p of spots[k]) { p.far = !p.near && Math.hypot(p.x - cx, (p.z - cz) * 0.8) > 17; p.thin = p.x < R.xL; }
  for (const k of ['A', 'B', 'C']) {
    for (const far of [false, true]) for (const thin of [false, true]) {
      const list = spots[k].filter(p => p.far === far && p.thin === thin); if (!list.length) continue;
      for (const part of T[k].parts) {
        const lods = part.lods ||= {}, key = (far ? 'far' : 'near') + (thin ? '-thin' : '');
        const geo = part.leaf && (far || thin) ? (lods[key] ||= lodLeaves(part.geometry, (far ? (k === 'A' ? 0.55 : 0.4) : 1) * (thin ? LEFT_KEEP : 1), far ? (k === 'A' ? 1.2 : 1.32) : 1)) : part.geometry;
        const im = new THREE.InstancedMesh(geo, part.material, list.length);
        list.forEach((p, i) => { const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, -0.12, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.ry, 0)), new THREE.Vector3().setScalar(T[k].scale * p.s)); im.setMatrixAt(i, m); });
        im.frustumCulled = false; outside.add(im);
      }
    }
  }
  // far forest wall (painted canopy band) to close the gaps
  { const c = canvas(2048, 256), g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 2048, 256);
    for (let i = 0; i < 900; i++) { const x = r() * 2048, y = 40 + Math.pow(r(), 0.7) * 216, rad = 8 + r() * 26; g.fillStyle = hsl(85 + r() * 25, .28 + r() * .15, .32 + r() * .25).getStyle(); g.globalAlpha = .9; for (const ox of [-2048, 0, 2048]) { g.beginPath(); g.arc(x + ox, y, rad, 0, 7); g.fill(); } }
    g.globalAlpha = 1; g.fillStyle = hsl(90, .3, .3).getStyle(); g.fillRect(0, 200, 2048, 56);
    // where it meets the open sky seen through the left glass it drops to a low line of trees on the horizon
    const theta = az => { const dx = -Math.sin(az), dz = -Math.cos(az), ox = 2, oz = 3, b = ox * dx + oz * dz, t = -b + Math.sqrt(b * b - (ox * ox + oz * oz - 4900));
      return (Math.atan2(ox + t * dx, oz + t * dz) + Math.PI * 2) % (Math.PI * 2); };   // cylinder angle (x = r sin θ, z = r cos θ) seen at azimuth az
    const g0 = theta(5 * Math.PI / 180), g1 = theta(31 * Math.PI / 180), gap = g1 - g0, rest = Math.PI * 2 - gap;
    const t = ctex(c); t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(3 * rest / (Math.PI * 2), 1);
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.BackSide, fog: true, color: 0xb8c4a8 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 26, 64, 1, true, g1, rest), mat);
    ring.position.set(-2, 11, -3); outside.add(ring); LIGHTS.ring = ring;
    const lc = canvas(512, 96), lg = lc.getContext('2d');
    for (let i = 0; i < 420; i++) { const x = r() * 512, y = 34 + Math.pow(r(), 0.6) * 62, rad = 6 + r() * 16; lg.fillStyle = hsl(85 + r() * 25, .28 + r() * .15, .3 + r() * .22).getStyle(); lg.beginPath(); lg.arc(x, y, rad, 0, 7); lg.fill(); }
    lg.fillStyle = hsl(90, .3, .3).getStyle(); lg.fillRect(0, 74, 512, 22);
    const lt = ctex(lc, { rep: false });
    const low = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 9, 16, 1, true, g0 - 0.01, gap + 0.02), new THREE.MeshBasicMaterial({ map: lt, transparent: true, alphaTest: 0.3, side: THREE.BackSide, fog: true }));
    low.material.color = mat.color;   // shares the night tint
    low.position.set(-2, 2.5, -3); outside.add(low); }
  // shrubs right outside the glass (bush.js); past the left glass half of them taken out (G, 15/10/2026: the big one in
  // front of it at x −2.2, z −6 among them), the rest spread along it
  const bushes = [[-2.5, -8.3, 1.4], [-1.9, 1.3, 1.0], [-5.0, -7.4, 1.3], [-4.6, -0.6, 1.0], [-0.4, -9.9, 1.3], [1.3, -9.8, 1.1], [2.8, -10.1, 1.2], [-1.9, -10.2, 1.3],
    [-0.8, 3.6, 1.1], [1.8, 3.9, 1.0], [-6.6, -3.2, 1.3], [4.2, -12.4, 1.4]].filter(([x, z, sc]) => !unseen(x, z, 1.6 * sc));
  outside.add(buildBushes(bushes));
}
function lodLeaves(geo, keep, grow, seed = 5) {
  // drop whole leaf cards (connected by index) and enlarge the survivors around their own centre. A card is kept or
  // dropped by a hash of where it stands (to a thousandth of the model's size), not by its order in the file, so the
  // same leaves survive however the model is re-encoded.
  const idx = geo.index.array, pos = geo.attributes.position, n = pos.count; const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < idx.length; t += 3) { const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]); if (a !== b) par[b] = a; if (find(c) !== a) par[find(c)] = a; }
  const used = new Uint8Array(n); for (let t = 0; t < idx.length; t++) used[idx[t]] = 1;
  const sum = new Map(); for (let i = 0; i < n; i++) { if (!used[i]) continue; const root = find(i), s = sum.get(root) || [0, 0, 0, 0]; s[0] += pos.getX(i); s[1] += pos.getY(i); s[2] += pos.getZ(i); s[3]++; sum.set(root, s); }
  if (!geo.boundingBox) geo.computeBoundingBox(); const sz = geo.boundingBox.getSize(new THREE.Vector3()), q = 1000 / Math.max(sz.x, sz.y, sz.z, 1e-6);
  const hash = (a, b, c) => { let h = Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791) ^ Math.imul(seed, 2654435761); h = Math.imul(h ^ (h >>> 15), 2246822519); h = Math.imul(h ^ (h >>> 13), 3266489917); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const kept = new Map(); for (const [root, s] of sum) kept.set(root, hash(Math.round(s[0] / s[3] * q), Math.round(s[1] / s[3] * q), Math.round(s[2] / s[3] * q)) < keep);
  const out = []; for (let t = 0; t < idx.length; t += 3) if (kept.get(find(idx[t]))) out.push(idx[t], idx[t + 1], idx[t + 2]);
  const g = geo.clone(); const p2 = g.attributes.position;
  for (let i = 0; i < n; i++) { const root = find(i); if (!kept.get(root)) continue; const s = sum.get(root), cx = s[0] / s[3], cy = s[1] / s[3], cz = s[2] / s[3]; p2.setXYZ(i, cx + (p2.getX(i) - cx) * grow, cy + (p2.getY(i) - cy) * grow, cz + (p2.getZ(i) - cz) * grow); }
  g.setIndex(out); return g;
}
/* ---------------------------------------------------------------- lights */
const LIGHTS = {};
function buildLights() {
  const hemi = new THREE.HemisphereLight(0xeef3e4, 0x8a6a48, 0.5); scene.add(hemi); LIGHTS.hemi = hemi;
  const sun = new THREE.DirectionalLight(0xfff0d6, 3.6); sun.position.set(-8, 6.2, 3.2); sun.target.position.set(0.5, 0, -3.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 40; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  scene.add(sun, sun.target); LIGHTS.sun = sun;
  const left = new THREE.RectAreaLight(0xf3f6ea, 1.15, R.zF - R.zB, R.H); left.position.set(R.xL - 0.05, R.H / 2, (R.zB + R.zF) / 2); left.lookAt(R.xL + 5, R.H / 2, (R.zB + R.zF) / 2); scene.add(left);
  const back = new THREE.RectAreaLight(0xf3f6ea, 1.2, R.xS - R.xL, R.H - R.caseTop); back.position.set((R.xL + R.xS) / 2, (R.caseTop + R.H) / 2, R.zB - 0.05); back.lookAt((R.xL + R.xS) / 2, (R.caseTop + R.H) / 2, 0); scene.add(back);
  const front = new THREE.RectAreaLight(0xf3f6ea, 1.2, R.xS - R.xL, R.H - R.caseTop); front.position.set((R.xL + R.xS) / 2, (R.caseTop + R.H) / 2, R.zF + 0.05); front.lookAt((R.xL + R.xS) / 2, (R.caseTop + R.H) / 2, -5); scene.add(front);
  LIGHTS.rects = [left, back, front];
  // environment for reflections / sheen
  const env = new THREE.Scene(); const s = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec3 p; void main(){ vec3 c = p.y>0.0 ? mix(vec3(0.55,0.62,0.48), vec3(0.9,0.93,0.9), smoothstep(0.0,0.6,p.y)) : mix(vec3(0.55,0.42,0.28), vec3(0.35,0.26,0.18), -p.y); if (p.x < -0.2) c *= 1.25; gl_FragColor = vec4(c,1.0);}' }));
  env.add(s); const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(env, 0.02).texture; scene.environmentIntensity = 0.55;
}
/* ---------------------------------------------------------------- trees, built in code
   The garden's three trees, rebuilt from measurements of the GLB models they replace (credits in the page): A and C
   on skeletons traced from those models, B on its twelve limbs; leaves placed by the old models' leaf densities (cells
   of 0.4-0.6 m), card sizes, facing and textures as measured there. Metres, scale 1.                             */
async function makeTrees() {
  const V3 = THREE.Vector3, tv = (x, y, z) => new V3(x, y, z), UP = tv(0, 1, 0), TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t, clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const tex = (c, srgb = true, rep = false) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };

  /* ---------- geometry */
  const anyPerp = d => new V3().crossVectors(d, Math.abs(d.y) < 0.9 ? UP : tv(1, 0, 0)).normalize();

  /* ---------- meshes */
  function tubes(branches, { vTile = 1.2 } = {}) {   // all branches of a tree in one indexed mesh: rings with parallel-transported frames
    const pos = [], nrm = [], uv = [], idx = [], T = new V3(), N = new V3(), B = new V3(), q = new V3();
    for (const b of branches) {
      const { pts, rad } = b, n = pts.length, segs = b.segs || 6, base = pos.length / 3;
      const uRep = Math.max(1, Math.round(TAU * rad[0] / vTile)); let len = 0;
      for (let i = 0; i < n; i++) {
        if (i === 0) T.subVectors(pts[1], pts[0]); else if (i === n - 1) T.subVectors(pts[n - 1], pts[n - 2]); else T.subVectors(pts[i + 1], pts[i - 1]);
        T.normalize();
        if (i === 0) N.copy(anyPerp(T)); else N.addScaledVector(T, -N.dot(T)).normalize();
        B.crossVectors(T, N); if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
        for (let j = 0; j <= segs; j++) {
          const a = j / segs * TAU, c = Math.cos(a), s = Math.sin(a);
          q.set(N.x * c + B.x * s, N.y * c + B.y * s, N.z * c + B.z * s);
          pos.push(pts[i].x + q.x * rad[i], pts[i].y + q.y * rad[i], pts[i].z + q.z * rad[i]); nrm.push(q.x, q.y, q.z); uv.push(j / segs * uRep, len / vTile);
        }
      }
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < segs; j++) { const a = base + i * (segs + 1) + j, c = a + segs + 1; idx.push(a, a + 1, c, a + 1, c + 1, c); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  // leaf cards: anchored at the top of the texture (the stem) or at their centre; a card in two halves can fold (bend)
  function cards(list) {
    const pos = [], uv = [], idx = [], col = [], v = new V3(), d = new V3(), shaded = list.some(c => c.shade != null);
    for (const c of list) {
      const rows = c.bend ? 2 : 1, base = pos.length / 3, [u0, v0, u1, v1] = c.cell;
      const o = c.o.clone(); d.copy(c.down); if (c.center) o.addScaledVector(d, -c.h / 2);
      for (let k = 0; k <= rows; k++) {
        if (k === 2) d.applyAxisAngle(c.side, c.bend);
        if (k > 0) o.addScaledVector(d, c.h / rows);
        for (const sgn of [-1, 1]) { v.copy(o).addScaledVector(c.side, sgn * c.w / 2); pos.push(v.x, v.y, v.z); uv.push(sgn < 0 ? u0 : u1, lerp(v1, v0, k / rows)); if (shaded) { const sh = c.shade ?? 1; col.push(sh, sh, sh); } }
      }
      for (let k = 0; k < rows; k++) { const a = base + 2 * k; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (shaded) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  const randDir = r => { const z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - z * z); return tv(s * Math.cos(a), z, s * Math.sin(a)); };
  // a card's facing, drawn from the |n.y| histogram measured on the old leaves (5 bins from vertical cards to flat ones)
  const facing = (r, hist) => { let w = r() * hist.reduce((a, b) => a + b, 0), b = 0; while (w > hist[b]) w -= hist[b++]; const ny = (b + r()) / hist.length * (r() < 0.5 ? 1 : -1), a = r() * TAU, sx = Math.sqrt(1 - ny * ny); return tv(sx * Math.cos(a), ny, sx * Math.sin(a)); };
  const inPlane = (n, pref) => { const d = pref.clone().addScaledVector(n, -pref.dot(n)); return d.lengthSq() < 1e-4 ? anyPerp(n) : d.normalize(); };
  const card = (o, n, pref, w, h, extra) => { const down = inPlane(n, pref); return { o, down, side: new V3().crossVectors(n, down).normalize(), w, h, ...extra }; };
  const perpTo = (d, r) => anyPerp(d).applyAxisAngle(d, r() * TAU);

  /* ---------- crowns grown into a measured volume */
  // leaf density measured on an old model, in cells of `res` m; 2 bits a cell (0 = no leaves), `wts` the mean count per level
  function crown(V) {
    const [nx, ny, nz] = V.dims, n = nx * ny * nz, bin = atob(V.data), w = new Float32Array(n), cdf = new Float32Array(n);
    let sum = 0; for (let i = 0; i < n; i++) { w[i] = V.wts[(bin.charCodeAt(i >> 2) >> ((i & 3) * 2)) & 3]; cdf[i] = sum += w[i]; }
    const cell = p => { const x = Math.floor((p.x - V.lo[0]) / V.res), y = Math.floor((p.y - V.lo[1]) / V.res), z = Math.floor((p.z - V.lo[2]) / V.res); return x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? -1 : (x * ny + y) * nz + z; };
    const wMax = Math.max(...V.wts);
    return {
      sample(r) { const u = r() * sum; let a = 0, b = n - 1; while (a < b) { const m = (a + b) >> 1; if (cdf[m] < u) a = m + 1; else b = m; }
        return tv(V.lo[0] + (Math.floor(a / (ny * nz)) + r()) * V.res, V.lo[1] + (Math.floor(a / nz) % ny + r()) * V.res, V.lo[2] + (a % nz + r()) * V.res); },
      at(p) { const i = cell(p); return i < 0 ? 0 : w[i] / wMax; },   // density there, 0..1
    };
  }
  // straight sticks, as on the old B model, in passes: each target (a point of the leaf volume) gets a stick from the
  // skeleton so far, nearest targets first. Pass 1 grows only from the limbs (long sticks, added once the pass is done);
  // later passes from anything, each stick at once. A stick leaves its parent at the angle measured there (10/50/90th
  // percentile 24/63/140 degrees), so it starts behind (or ahead of) the parent's nearest point. Returns the sticks and
  // a nearest() query
  function sticks(r, segs0, passes, { step = 0.15, cellS = 0.6, rTip = 0.003 } = {}) {
    const grid = new Map(), key = (x, y, z) => ((x + 64) * 128 + (y + 64)) * 128 + (z + 64);
    const addSeg = (a, b) => { const L = a.distanceTo(b), n = Math.max(1, Math.ceil(L / step)), dir = b.clone().sub(a).divideScalar(L || 1);
      for (let k = 0; k <= n; k++) { const p = a.clone().lerp(b, k / n), kk = key(Math.floor(p.x / cellS), Math.floor(p.y / cellS), Math.floor(p.z / cellS)); let l = grid.get(kk); if (!l) grid.set(kk, l = []); l.push({ p, a, dir, s: L * k / n, L }); } };
    const nearest = t => { const cx = Math.floor(t.x / cellS), cy = Math.floor(t.y / cellS), cz = Math.floor(t.z / cellS); let best = null, bd = Infinity;
      for (let sh = 0; sh < 40; sh++) {
        for (let dx = -sh; dx <= sh; dx++) for (let dy = -sh; dy <= sh; dy++) for (let dz = -sh; dz <= sh; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== sh) continue;
          const l = grid.get(key(cx + dx, cy + dy, cz + dz)); if (l) for (const q of l) { const d = q.p.distanceToSquared(t); if (d < bd) { bd = d; best = q; } }
        }
        if (best && bd <= sh * sh * cellS * cellS) break;
      }
      return best; };
    for (const [a, b] of segs0) addSeg(a, b);
    const out = [];
    for (const { targets, Lmax, rK, r0max, late } of passes) {
      const order = targets.map(t => ({ t, d: nearest(t).p.distanceTo(t) })).sort((x, y) => x.d - y.d), made = [];
      for (const { t } of order) {
        const q = nearest(t), d = q.p.distanceTo(t); if (d < 0.08) continue;
        const ang = 0.42 + 2.02 * Math.pow(r(), 1.57), a = q.a.clone().addScaledVector(q.dir, clamp(q.s - d / Math.tan(ang), 0, q.L));
        let L = a.distanceTo(t); const end = L > Lmax ? a.clone().lerp(t, Lmax / L) : t.clone(); L = a.distanceTo(end);
        out.push({ pts: [a, end], rad: [Math.min(0.005 + rK * L, r0max), rTip], segs: 3 });
        if (late) made.push([a, end]); else addSeg(a, end);
      }
      for (const [a, b] of made) addSeg(a, b);
    }
    return { sticks: out, nearest };
  }
  // light reaching a point through the foliage: density summed along a few rays out of the crown -> 0 (open) .. 1
  function occlusion(C, p, dirs = [[0, 1, 0], [1, 0.4, 0], [-1, 0.4, 0], [0, 0.4, 1], [0, 0.4, -1], [0.7, 0.3, 0.7], [-0.7, 0.3, -0.7]], len = 2.4, k = 1.6) {
    let s = 0; const q = new V3();
    for (const [x, y, z] of dirs) { let a = 0; const d = tv(x, y, z).normalize(); for (let t = 0.3; t < len; t += 0.3) a += C.at(q.copy(p).addScaledVector(d, t)); s += 1 - Math.exp(-k * a * 0.3); }
    return s / dirs.length;
  }

  /* ---------- skeletons traced from the old models */
  // traced along level sets of the distance over the bark from the root, then thinned: per node, how many nodes back
  // its parent is (varint, 0 = the root), its offset from the parent (int8 x3, in q m) and its radius (uint8, in rq m)
  function skeleton(S) {
    const b = atob(S.data), nodes = []; let i = 0;
    const u8 = () => b.charCodeAt(i++), i8 = () => { const v = u8(); return v > 127 ? v - 256 : v; };
    while (i < b.length) {
      let back = 0, sh = 0, c; do { c = u8(); back |= (c & 127) << sh; sh += 7; } while (c & 128);
      const dx = i8(), dy = i8(), dz = i8(), rr = u8() * S.rq, k = nodes.length, p = back ? k - back : -1;
      nodes.push({ p: p < 0 ? tv(S.o[0], S.o[1], S.o[2]) : nodes[p].p.clone().add(tv(dx * S.q, dy * S.q, dz * S.q)), r: rr, parent: p });
    }
    return nodes;
  }
  // nodes -> branches for tubes(): each follows its thickest child; the others start at their parent's node
  function skelBranches(nodes, segs = r => r > 0.1 ? 8 : r > 0.04 ? 6 : r > 0.015 ? 4 : 3) {
    const kids = nodes.map(() => []), out = [];
    nodes.forEach((n, i) => { if (n.parent >= 0) kids[n.parent].push(i); });
    const walk = (i0, from) => {
      const ch = from >= 0 ? [from, i0] : [i0]; let i = i0;
      for (;;) { const k = kids[i]; if (!k.length) break; let m = k[0]; for (const c of k) if (nodes[c].r > nodes[m].r) m = c; for (const c of k) if (c !== m) walk(c, i); ch.push(m); i = m; }
      if (ch.length > 1) out.push({ pts: ch.map(j => nodes[j].p), rad: ch.map((j, q) => q === 0 && from >= 0 ? Math.min(nodes[j].r, nodes[ch[1]].r) : nodes[j].r), segs: segs(nodes[ch[from >= 0 ? 1 : 0]].r) });
    };
    nodes.forEach((n, i) => { if (n.parent < 0) walk(i, -1); });
    return out;
  }
  const nodeSegs = nodes => nodes.filter(n => n.parent >= 0).map(n => [nodes[n.parent].p, n.p]);

  /* ---------- textures (canvas). The page recolours leaves by their luminance, so each is drawn at the tone measured
     on the old texture: A dark (ash sprigs), B white (brush strokes, shaded by the light), C mid (maple). */
  const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
  function leafShape(g, x, y, ang, w, h) { g.save(); g.translate(x, y); g.rotate(ang); g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(w, h * 0.25, w * 0.8, h * 0.8, 0, h); g.bezierCurveTo(-w * 0.8, h * 0.8, -w, h * 0.25, 0, 0); g.fill(); g.restore(); }
  function sprigTexture(r) {   // A: two ash sprigs as on the old texture (cells 320 x 512): a pale stem down from the top
    // centre; side shoots angled down and out, each with pairs of small dark leaflets and one at its end, some forking
    const W = 320, H = 512, c = canvas(W * 2, H), g = c.getContext('2d');
    const leaflet = (x, y, a, s) => { const sh = 0.8 + r() * 0.4; g.fillStyle = rgb(35 * sh, 64 * sh, 19 * sh); leafShape(g, x, y, a, W * 0.036 * s, W * 0.08 * s); };
    const shoot = (x0, y0, a, len, pairs, depth) => {   // a: angle from straight down
      const dx = Math.sin(a), dy = Math.cos(a), x1 = x0 + dx * len, y1 = y0 + dy * len;
      g.strokeStyle = rgb(170, 152, 124); g.lineWidth = W * (depth ? 0.005 : 0.007); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      for (let q = 0; q < pairs; q++) { const f = 0.3 + 0.7 * q / pairs, px = x0 + dx * len * f, py = y0 + dy * len * f; for (const sg of [-1, 1]) leaflet(px, py, -a + sg * (0.75 + r() * 0.35), 0.85 + r() * 0.3); }
      leaflet(x1, y1, -a + (r() - 0.5) * 0.4, 1);
      if (!depth && r() < 0.45) shoot(x0 + dx * len * 0.45, y0 + dy * len * 0.45, a + (r() < 0.5 ? -1 : 1) * 0.6, len * 0.55, 3, 1);
    };
    for (let v = 0; v < 2; v++) {
      const ox = v * W, stem = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24; stem.push([ox + W * 0.5 + Math.sin(t * 3.4 + v * 2) * W * 0.05, H * t * 0.92]); }
      g.strokeStyle = rgb(176, 158, 130); g.lineCap = 'round'; g.lineWidth = W * 0.012; g.beginPath(); stem.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
      const n = 8;
      for (let k = 0; k < n; k++) {
        const t = 0.14 + k * 0.78 / (n - 1), [bx, by] = stem[Math.round(t * 24)], side = k % 2 ? 1 : -1, last = k === n - 1;
        shoot(bx, by, last ? (r() - 0.5) * 0.3 : side * (0.65 + r() * 0.4), W * (last ? 0.2 : 0.28 + 0.1 * Math.sin(t * Math.PI)) * (0.85 + r() * 0.3), last ? 3 : 6, 0);
      }
    }
    return tex(c);
  }
  function brushTexture(r) {   // B: one round brush blob, white, ragged dry-brush edges (as on the old texture)
    const S = 256, c = canvas(S, S), g = c.getContext('2d'), cx = S * 0.5, cy = S * 0.49, R0 = S * 0.48;
    const ph = r() * TAU, rad = a => R0 * (1 + 0.05 * Math.sin(2 * a + ph) + 0.035 * Math.sin(5 * a + ph * 3));
    g.fillStyle = '#fff'; g.beginPath();
    for (let i = 0; i <= 96; i++) { const a = i / 96 * TAU, rr = rad(a) * (0.94 + 0.04 * r()); g.lineTo(cx + Math.cos(a) * rr * 0.93, cy + Math.sin(a) * rr); }
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineCap = 'round';   // dry-brush streaks along the rim, heavier at lower left
    for (let i = 0; i < 220; i++) {
      const a = r() * TAU, w = 0.5 + 0.5 * Math.max(0, Math.cos(a - 2.4)), rr = rad(a) * (0.86 + r() * (0.12 + 0.12 * w)), l = S * (0.03 + r() * 0.05);
      const x = cx + Math.cos(a) * rr * 0.93, y = cy + Math.sin(a) * rr, t = a + Math.PI / 2 + (r() - 0.5) * 0.6;
      g.lineWidth = 0.8 + r() * 1.6; g.beginPath(); g.moveTo(x - Math.cos(t) * l, y - Math.sin(t) * l); g.lineTo(x + Math.cos(t) * l, y + Math.sin(t) * l); g.stroke();
    }
    return tex(c);
  }
  function mapleOutline(g, cx, cy, R, rot) {   // five-lobed, serrated; the stem joins at the top
    g.beginPath();
    for (let i = 0; i <= 160; i++) {
      const a = i / 160 * TAU; let lobe = 0;
      for (const [la, lr] of [[0, 1], [1.05, 0.92], [-1.05, 0.92], [2.1, 0.62], [-2.1, 0.62]]) { const da = Math.atan2(Math.sin(a - la), Math.cos(a - la)); lobe = Math.max(lobe, lr * Math.pow(Math.max(0, Math.cos(da * 1.9)), 1.6)); }
      const rr = R * (0.42 + 0.58 * lobe) * (1 + 0.05 * Math.abs(Math.sin(a * 22)));
      const x = Math.sin(a) * rr, y = Math.cos(a) * rr;   // a = 0 points down (the main lobe)
      g.lineTo(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot));
    }
    g.fill();
  }
  function mapleTexture(r) {   // C: a maple leaf on a long stem (left third), and a spray of ~20 small leaves on twigs
    // radiating from the centre (right two thirds), as on the old textures
    const W = 512, H = 1024, c = canvas(W * 3, H), g = c.getContext('2d');
    g.strokeStyle = rgb(150, 120, 60); g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(W * 0.5, 0); g.quadraticCurveTo(W * 0.56, H * 0.12, W * 0.5, H * 0.24); g.stroke();
    g.fillStyle = rgb(186, 140, 50); mapleOutline(g, W * 0.5, H * 0.6, W * 0.56, 0);
    g.strokeStyle = rgb(160, 118, 44); g.lineWidth = 4;
    for (const a of [0, 1.05, -1.05, 2.1, -2.1]) { g.beginPath(); g.moveTo(W * 0.5, H * 0.26); g.lineTo(W * 0.5 + Math.sin(a) * W * 0.42, H * 0.26 + Math.cos(a) * W * 0.42); g.stroke(); }
    const cx = W * 2, cy = H * 0.5, S = H;
    const twig = (x0, y0, a, len, depth) => {
      const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
      g.strokeStyle = rgb(150, 132, 104); g.lineWidth = Math.max(2, 7 - depth * 2); g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + (r() - 0.5) * len * 0.2, (y0 + y1) / 2 + (r() - 0.5) * len * 0.2, x1, y1); g.stroke();
      if (depth < 2) { const k = depth === 0 ? 2 : 1 + (r() < 0.6 ? 1 : 0); for (let q = 0; q < k; q++) twig(x1, y1, a + (q - (k - 1) / 2) * 0.75 + (r() - 0.5) * 0.3, len * 0.62, depth + 1); if (depth === 1) twig(x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.5, a + (r() < 0.5 ? 1 : -1) * 0.9, len * 0.45, 2); }
      else { const sh = 0.85 + r() * 0.3; g.fillStyle = rgb(160 * sh, 134 * sh, 52 * sh); mapleOutline(g, x1 + Math.cos(a) * S * 0.035, y1 + Math.sin(a) * S * 0.035, S * 0.048 * (0.85 + r() * 0.35), Math.PI / 2 - a); }
    };
    const a0 = r() * TAU; for (let k = 0; k < 5; k++) twig(cx, cy, a0 + k * TAU / 5 + (r() - 0.5) * 0.4, S * 0.17, 0);
    return tex(c);
  }
  function barkTexture(r, kind) {   // A: brown with vertical fissures; C: plane-tree bark, grey-green patches
    const S = 256, c = canvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    const PERM = new Uint8Array(512); { const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
    const vn = (x, y, px, py) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const h = (i, j) => PERM[(PERM[((i % px) + px) % px] + ((j % py) + py) % py) & 511] / 255; return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v; };
    const fb = (x, y, px, py, o = 4) => { let s = 0, a = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { s += a * vn(x * f, y * f, px * f, py * f); n += a; a *= 0.5; f *= 2; } return s / n; };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = (y * S + x) * 4; let R, G, B;
      if (kind === 'A') { const f = fb(u * 14, v * 3, 14, 3), w = fb(u * 4, v * 8, 4, 8); const crack = Math.max(0, 1 - Math.abs(f - 0.5) * 9); const l = (0.8 + 0.3 * w) * (1 - 0.55 * crack); R = 122 * l; G = 98 * l; B = 76 * l; }
      else { const a = fb(u * 5, v * 5, 5, 5), b = fb(u * 9 + 3, v * 9, 9, 9); const patch = a > 0.55 ? 2 : a > 0.45 ? 1 : 0, s = 0.9 + 0.2 * b;
        [R, G, B] = patch === 2 ? [150 * s, 152 * s, 134 * s] : patch === 1 ? [104 * s, 106 * s, 82 * s] : [96 * s, 80 * s, 64 * s]; }
      d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0); return tex(c, true, true);
  }
  const leafMat = map => new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true });
  const barkMat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide, ...o });

  /* ---------- A: tall and slender, the skeleton traced from the old model (it kinks and forks at ~4.4 m into two
     leaders); 500 ash sprigs placed by its sprig density, each on a short twig, rising up and out from its stem */
  const A_SKEL = { o: [-0.2, -0.16, 0.16], q: 0.02, rq: 0.002, data: 'AAAAAF0BAgf6UwH/Ev9PAQU8/UIB/j4KQgH8DgFCAQccAUIBAh78QgEGDw5CAQMPBUIBBQ4CQgEHKgNCAfYOETAB/AwIKwH6LQsrAf4bDCsBAxH8KwH8EP4mAQcOACYBAhEAJgECDv4mAQAOBR0BBA//FwEILgIXAQMN+xcBAg4AFwEILAoXAQIO/xcBBB/5FgEHN/0FB/8LCRUB/iIeFQECOyoHDf8L9hcB9DDdEAH1KvMNAfwL+QoRBA4CGBb9CgMLAQMS/wsYAxD/HRn/FvwBG/4IDysB/gsJKwH4QCgjAf4kKA0jCw/zJAEUKPskAQYN+iMBDyr0IAH+DwMaAQEfAhYBACz7FgEBEv8WAQANAxYBAg38FgEGD/0WAREZ/xMBCQwBDwEiIvYIAzI69AUBBgv+BQj+Cg0RAfoSFw8B+yIUBxAEDfkUAQAO+xIB+w37EQHcQOoMAfgV+QwXBAsACED3C+wyAfoK9TAB+w36LwH5C/gtAf0SAS0B+hn2LQH4EQolAfwPAiIB+C38IgH8DPwiAQUSAh8BAQ7+HwEAHwUfAfsLAx8BDBP5HAEMKfYaARJZ/BUBAxn9CwXwCQoWAfUJBRYB+QsGEAHcQiMHDfYL9xkB7yXvFgH4H/wPAfcj9AsSBRH/ARYGBu0iAQ8X2xYBEBbjBhz+DvwiHfgQ/w0e9w37DmQIDgIvZQMRCQFoBRUHAQ==' };
  const A_STEMS = { lo: [-3.0, 5.4, -3.0], res: 0.6, dims: [10, 16, 11], wts: [0.0, 1.395, 4.595, 11.227], data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAQAgAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAEAAAFAAAJQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAMAAADAAAAgBAAAAgAAAMAAACAIAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAdAKAABAAAAgBAAwDgAwDEAEDAACgAJAIASABAAwAAAAAAAAAAAAAAAAAkAAAFEAAKAAADAMACACAAAAwAgAKA0AAAcAAAeAAANABAFAAAAAAAAAAAAAAAAAIAgAAAFAAAAAAAAAAEAAADAEAAAAAAAAACAAACAIAAACAAAAwAAAEAAAAAAABAAAAoAAAFAMACAGAAAAwAAAsAgAoAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAEAAAAAAAAAAAA=' };
  function treeA(r) {
    const nodes = skeleton(A_SKEL), br = skelBranches(nodes);
    // twigs out to points of the old model's sprig density; the sprigs sit along their ends (measured: the nearest other
    // stem ~8.5 cm away, a few to twenty on a twig)
    const C = crown(A_STEMS), tips = Array.from({ length: 110 }, () => C.sample(r));
    const st = sticks(r, nodeSegs(nodes), [{ targets: tips, Lmax: 1.6, rK: 0.01, r0max: 0.02 }], { rTip: 0.006 });
    br.push(...st.sticks);
    const stems = [], on = new Array(st.sticks.length).fill(0);
    while (stems.length < 500) {
      const k = Math.floor(Math.pow(r(), 1.6) * st.sticks.length), tw = st.sticks[k], L = tw.pts[0].distanceTo(tw.pts[1]);
      stems.push(tw.pts[0].clone().lerp(tw.pts[1], clamp(1 - (on[k]++ * 0.085 + r() * 0.03) / Math.max(L, 0.01), 0.1, 1)));
    }
    // measured: a sprig is 0.94 x 1.53 m, its stem at the twig, its axis up (y 0.6) and outward (0.3), bent ~0.4 rad
    const leaves = [];
    for (const s of stems) {
      const out = tv(s.x, 0, s.z); if (out.lengthSq() < 0.01) out.copy(randDir(r)).setY(0); out.normalize();
      const pref = out.multiplyScalar(0.45).add(tv(0, 0.85, 0)).addScaledVector(randDir(r), 0.55).normalize();
      leaves.push(card(s, facing(r, [0.21, 0.222, 0.202, 0.214, 0.152]), pref, 0.94, 1.53, { bend: (r() < 0.5 ? -1 : 1) * (0.2 + r() * 0.36), cell: r() < 0.5 ? [0, 0, 0.5, 1] : [0.5, 0, 1, 1] }));
    }
    return { scale: 1, parts: [{ geometry: tubes(br, { vTile: 1.6 }), material: barkMat({ map: barkTexture(r, 'A') }), leaf: false }, { geometry: cards(leaves), material: leafMat(sprigTexture(r)), leaf: true }] };
  }

  /* ---------- B: stylized; a thick tapering trunk, twelve limbs fanning out from 3-6 m (measured on the old model), and
     a crown grown into the old model's leaf volume: thousands of straight sticks toward it, small brush-stroke leaves */
  const B_VOX = { lo: [-4.4, 3.2, -4.8], res: 0.4, dims: [21, 24, 23], wts: [0, 1.812, 5.244, 11.321], data: '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' };
  const B_LIMBS = [[0.13, 5.81, -0.24, 0.39, 11.93, -1.34], [0.34, 6.26, -0.26, 1.47, 12.3, -0.4], [0.08, 5.94, 0.22, 0.72, 11.78, 1.73],
    [-0.49, 5.74, 0.16, -2.36, 11.46, 0.06], [0.26, 4.53, 0.35, 2.22, 9.8, 1.68], [-0.03, 4.08, 0.45, -0.48, 9.04, 2.57],
    [0.15, 4.1, -0.6, 0.49, 8.79, -2.99], [-0.49, 3.68, 0.25, -2.59, 8.28, 1.05], [0.48, 3.55, -0.2, 2.52, 7.65, -1.12],
    [-0.28, 3.46, 0.02, -2.66, 7.37, 0.56], [0.13, 3.11, 0.36, 0.95, 6.67, 2.86], [-0.16, 3.2, -0.15, -1.49, 6.69, -1.95]];
  function treeB(r) {
    const br = [], segs0 = [];
    const trunk = [tv(0.1, -0.15, 0), tv(0.08, 0.4, 0), tv(0.05, 3.6, 0.05), tv(0, 5.8, 0), tv(-0.02, 6.4, 0.02)];
    br.push({ pts: trunk, rad: [0.62, 0.44, 0.31, 0.2, 0.08], segs: 7 });
    for (let i = 2; i < trunk.length - 1; i++) segs0.push([trunk[i], trunk[i + 1]]);
    for (const [x0, y0, z0, x1, y1, z1] of B_LIMBS) {
      const a = tv(x0, y0, z0), b = tv(x1, y1, z1), L = a.distanceTo(b);
      const mid = a.clone().lerp(b, 0.45).addScaledVector(perpTo(b.clone().sub(a).normalize(), r), L * 0.035);
      br.push({ pts: [a, mid, b], rad: [0.04 + 0.02 * L, 0.03 + 0.01 * L, 0.015], segs: 5 });
      segs0.push([a.clone().lerp(mid, 0.3), mid], [mid, b]);
    }
    // the leaves' places first (by the measured density); the sticks grow to them: long ones straight off the limbs (about
    // a quarter, as measured), then shorter ones off everything, out to every other leaf, so each leaf sits on a stick
    const C = crown(B_VOX), N = 16440, spots = Array.from({ length: N }, () => C.sample(r)), pts = n => Array.from({ length: n }, () => C.sample(r));
    const every = (k, o) => spots.filter((_, i) => i % k === o);
    const st = sticks(r, segs0, [{ targets: pts(1800), Lmax: 2.2, rK: 0.012, r0max: 0.03, late: true },
      { targets: every(4, 0), Lmax: 1.0, rK: 0.008, r0max: 0.015 },
      { targets: every(8, 2), Lmax: 0.45, rK: 0.008, r0max: 0.009 }]);
    br.push(...st.sticks);
    // leaves sit on the sticks (measured: half within 9 cm) and those of one stick face alike, their long side up and
    // along the stick, so the crown shades in patches as on the old model
    const W = 0.125, H = 0.208, reach = 0.15, hist = [0.23, 0.26, 0.27, 0.19, 0.05], leaves = [], stickN = new Map();
    for (let i = 0; i < N; i++) {
      const o = spots[i], q = st.nearest(o), pref = UP.clone();
      let nrm;
      if (q) {
        const d = o.distanceTo(q.p); if (d > reach) o.sub(q.p).multiplyScalar(reach / d).add(q.p);
        let bn = stickN.get(q.a); if (!bn) stickN.set(q.a, bn = facing(r, hist));
        nrm = bn.clone().addScaledVector(randDir(r), 0.7).normalize(); pref.addScaledVector(q.dir, 0.6);
      } else nrm = facing(r, hist);
      pref.addScaledVector(randDir(r), 0.5);
      const shade = 1 - 0.15 * Math.pow(occlusion(C, o), 1.2);
      const s = 0.8 + r() * 0.4;
      leaves.push(card(o, nrm, pref.normalize(), W * s, H * s, { center: true, shade, cell: [0, 1, 1, 0] }));
    }
    const lm = leafMat(brushTexture(r)); lm.vertexColors = true;
    return { scale: 1, parts: [{ geometry: tubes(br), material: barkMat({ color: 0x5b4433, flatShading: true }), leaf: false }, { geometry: cards(leaves), material: lm, leaf: true }] };
  }

  /* ---------- C: plane tree, the skeleton traced from the old model (a slender trunk, an open ovoid crown of spreading
     branches); 2059 maple leaves and 71 flat leafy sprays placed by the old model's densities */
  const C_SKEL = { o: [0.0, -0.1, 0.0], q: 0.02, rq: 0.002, data: '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' };
  const C_LEAVES = { lo: [-4.0, 5.0, -4.0], res: 0.5, dims: [16, 21, 17], wts: [0.0, 1.0, 2.43, 5.146], data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAKgAAADAAwAAALQAAACgAAAAAAAAAADgAAAAsAcAAAACAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAQAEaAAAUCgIAALACAAAAAAAAAAAEAAAFLgAA6L0AAACoAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICKAAAABRsABPAWBDAAgBkQAAAAQAAAAFQGAAA0AACw6gMAAG/nAAAA5gAAAIAAAABABgAAAB4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAADsEAAQwHghgAEALiAAABQACgBoglMAABAQAICsCgEAfj0IAAAUCwCQAggAgMMZAAAKmAAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAEABAAABCwAAAAAAggAAABAiAAAAITQwAwAAQCgAAAEfAPkGuAAAAFAAABIQACBAnyQAAKAoABQIagBQXZ4AAHSSAgC4CQAAgAcAAAC4AAAAgAAAAAAAAAAAAAIAACgYAAAkAABQAQAAACoAwAZUAEAfAAAALgAAAKAAKAKgAxQFAAoAAIQNYAcgIAAIgLUAqQJVAIDq9QMA5AYIAOAbLgAADxYAAFAVAACQPwAAACgAAAAAAAAAAAAAAAAAAAABAAAAAACAXgAAAKgAAABAAAAAAAFwHoAwuBoALyAAAJaAAgC+APwCZQBoAAAAgO9BAQBUP1EAgLq4AQAs+AMAgEsCAICuAAAAKAAAAAAAAAAAAAAAAAAAAAABAAAAAAB8AAAAwAAAAAEAAAALQAi9YEChFwCkAEAlhQIBADQBlAwACECWAAAApREAAAB8AQIABqkDAADwDwAAaA4AALADAACAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAQAAAQQAgEf/AOABoEK4BxAAoQCAEvAAAChBAACwpgEAAPADBgAQdQ0AAK4fAADACQAAAAEAAAAAAAAAAQAAAAAAAAAAAQAAACAAAACAAAAAAAAAAAAAABA5AADALwAAAJsBAALABoALAABAAwA5gAMAAAYGAADgCwAAAA8AAACAFwAA/DoAAJAmAAAAMAAAAAAAAAAGAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAEYAAAC0AQAAdAwAAAACAA4AAIAvAAAAOgAAIBIAAMC/AAAA5gAAAFQSAACAfwAAAC0AAAAAAAAAAAAAAAAAAADQAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAApAUAAMAOAADQPwAAAAAAFQAAABsAAABgAADgaQAAAPkCAACkAgAAABEAAEAfAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAAQAAAAUAAAAAAAAAAAAEAAAABgAAAA6AAAA+gIAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEQAAAPQAAACQAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
  const C_SPRAYS = { lo: [-3.2, 5.6, -3.2], res: 0.8, dims: [9, 12, 9], wts: [0.0, 0.0, 1.0, 2.0], data: 'AAAAAgAIAAAAAAgACAAAAAAAAAAAAAAAAAAAAAAAIIAAAAAAAAAAAgAgAgAAAAgAAAAAAAAAACAIAAAACAAwAIAAAAAAAgAAICAAAgAAAAAAAAAgAAgAIAAAIIAAACAAAAIAiACAIAAoADAAAAAAAAAAgAACCAAAgAAACAIAgAAAgACAAAAAAAAAAAAAAwAIAAAgIACAACAAAAAAKAAoAAAAAAAIAAIAAAAACAAAAACAAAAAAAMAAAAAAAAAAAAACjCAAIIAAAAAAAAAACAAgAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
  function treeC(r) {
    const nodes = skeleton(C_SKEL), br = skelBranches(nodes), leaves = [];
    const CL = crown(C_LEAVES), CS = crown(C_SPRAYS);
    // leaves by the old model's density (measured: a leaf 0.37 x 0.42 m with its stem, 0.156 m2 of surface, facing
    // mostly up, stem-to-tip rising a little, cupped; drawn 5 % larger as flat cards cover less than cupped ones)
    for (let i = 0; i < 2059; i++) {
      const o = CL.sample(r), pref = randDir(r).add(tv(0, 0.45, 0)).normalize();
      leaves.push(card(o, facing(r, [0.124, 0.188, 0.2, 0.271, 0.218]), pref, 0.39, 0.44, { center: true, bend: (r() - 0.5) * 1.2, cell: [0, 0, 1 / 3, 1] }));
    }
    // the sprays: 2.29 m square of texture (2.9 m2 of surface each), lying flat, cupped
    for (let i = 0; i < 71; i++) {
      const o = CS.sample(r), n = tv((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3).normalize();
      leaves.push(card(o, n, randDir(r), 2.29, 2.29, { center: true, bend: (r() < 0.5 ? -1 : 1) * 0.5, cell: [1 / 3, 0, 1, 1] }));
    }
    return { scale: 1, parts: [{ geometry: tubes(br, { vTile: 1.4 }), material: barkMat({ map: barkTexture(r, 'C') }), leaf: false }, { geometry: cards(leaves), material: leafMat(mapleTexture(r)), leaf: true }] };
  }
  const trees = { A: treeA(rng(301)) }; await tick();
  trees.B = treeB(rng(302)); await tick();
  trees.C = treeC(rng(303));
  return trees;
}
/* ---------------------------------------------------------------- assets (GLB) */
async function loadAssets(buf) {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buf, '');
  // quantized meshes carry a node transform: bake it into plain Float32 geometry
  const bake = (m) => { m.updateWorldMatrix(true, false); const src = m.geometry, g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(src.attributes)) { const n = a.count, s = a.itemSize, f = new Float32Array(n * s); const get = ['getX', 'getY', 'getZ', 'getW'];
      for (let i = 0; i < n; i++) for (let c = 0; c < s; c++) f[i * s + c] = a[get[c]](i); g.setAttribute(k, new THREE.BufferAttribute(f, s)); }
    if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1)); g.applyMatrix4(m.matrixWorld); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
  const byName = {}; gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(o => { if (o.isMesh) { const m = new THREE.Mesh(bake(o), o.material); m.name = o.name; byName[o.name] = m; } });
  const A = { byName };
  const fix = (m) => { m.material.side = THREE.DoubleSide; return m; };
  A.isoPile = new THREE.Group(); { const m = byName.iso_bookPile1.clone(); m.material = m.material.clone(); m.castShadow = true; A.isoPile.add(m); m.geometry.computeBoundingBox(); A.isoPileH = m.geometry.boundingBox.max.y; }
  return A;
}
const WIND = { t: { value: 0 }, amp: reduceMotion ? 0 : 0.1 };   // tree sway at 10 % of the original amplitude
function windify(mat, leaf, opt = {}) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uWind = WIND.t;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;\nvarying float vTint;').replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
      #else
        vec3 ip = vec3(0.0);
      #endif
      vTint = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
      float hh = max(0.0, transformed.y);
      float k = ${leaf ? '1.0' : '0.25'} * ${(opt.windScale ?? 1).toFixed(3)} * ${WIND.amp.toFixed(3)};
      float ph = ip.x * 0.37 + ip.z * 0.21;
      transformed.x += k * hh * hh * 0.00045 * (sin(uWind * 0.9 + ph) + 0.4 * sin(uWind * 2.3 + ph * 3.0 + transformed.y * 0.02));
      transformed.z += k * hh * hh * 0.00035 * sin(uWind * 1.1 + ph + 1.7);
      ${leaf ? 'transformed += ' + (0.002 * WIND.amp).toFixed(5) + ' * hh * vec3(sin(uWind*3.0 + position.x*0.9 + position.z*1.3), 0.0, cos(uWind*2.6 + position.y*0.7));' : ''}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTint;');
    if (leaf) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float lum = pow(clamp(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) * ${(opt.lumGain ?? 1.6).toFixed(3)}, 0.0, 1.0), 0.6);
      vec3 g1 = vec3(0.035, 0.07, 0.02), g2 = vec3(0.16, 0.30, 0.07), g3 = vec3(0.50, 0.62, 0.25);
      vec3 gc = lum < 0.5 ? mix(g1, g2, lum * 2.0) : mix(g2, g3, (lum - 0.5) * 2.0);
      gc *= mix(vec3(0.85, 0.95, 0.8), vec3(1.15, 1.08, 0.95), vTint);
      diffuseColor.rgb = gc;`);
  };
}
/* ---------------------------------------------------------------- velvet
   Sheen = Charlie microfibre lobe (Estevez & Kulla 2017, KHR_materials_sheen): fibres stand along the normal,
   so velvet is dark head-on and glows at grazing angles. Low sheen roughness keeps that glow at the rim;
   the base gets high roughness and a weak specular. On top of that, procedural object-space detail:
   gathered pleats on vertical faces, soft creases + lumps on top faces, "crushed" pile patches that tilt
   the fibres (changing sheen locally), micro pile noise for close-ups, and baked contact AO (vertex colour)
   that also damps the sheen inside crevices.                                                              */
/* A cushion that gives (dent: true; G, 15/10/2026, and deeper and softer, G, 17/10/2026): where the cat lies, stands or
   treads on it, the top of the cushion is pressed into smooth hollows, each falling off as (1 − q²)² to its edge:
   - the body's, an ellipse along the cat (round when it curls up);
   - one under each paw that bears on it;
   - and the imprint where it lay, going slowly.
   They add up, the sum easing off as the cushion bottoms out (no deeper than ~4.5 cm). Only the cushion's upper part
   moves, so faces meeting at its edges move together and never part; the normals tip into the hollows, so they shade.
   The cover drawn into the body's hollow folds round it (radial folds on the rim, ~2 mm deep at a 3 cm hollow, in the
   fabric's own bump), and the hollow's floor is a little in shadow. pets.js sets where and how deep (stepDent). */
const SOFT = { u: { uDentB: { value: new THREE.Vector4() }, uDentA: { value: new THREE.Vector4(1, 0, 0.16, 0.12) }, uDentI: { value: new THREE.Vector4() },
  uDentIA: { value: new THREE.Vector4(1, 0, 0.16, 0.12) }, uPaw: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0.05, 0)) }, uDentY: { value: 0.4 } } };
const DENT_U = `uniform vec4 uDentB, uDentA, uDentI, uDentIA; uniform vec4 uPaw[4]; uniform float uDentY;
  // an ellipse (B: x, z, depth; A: its long axis as cos, sin, then its two radii): its depth there, and −∇depth added to grad
  float dentEll(vec2 p, vec4 B, vec4 A, inout vec2 grad) {
    if (B.z <= 0.0) return 0.0;
    vec2 d = p - B.xy, uv = vec2(dot(d, A.xy), dot(d, vec2(-A.y, A.x))) / A.zw; float q2 = dot(uv, uv);
    if (q2 >= 1.0) return 0.0;
    float k = 1.0 - q2; vec2 gl = 4.0 * B.z * k * uv / A.zw; grad += vec2(gl.x * A.x - gl.y * A.y, gl.x * A.y + gl.y * A.x); return B.z * k * k;
  }
  float dentCirc(vec2 p, vec4 C, inout vec2 grad) {   // a paw's: x, z, radius, depth
    if (C.w <= 0.0) return 0.0; vec2 q = (p - C.xy) / C.z; float r2 = dot(q, q); if (r2 >= 1.0) return 0.0;
    float k = 1.0 - r2; grad += 4.0 * C.w * k * q / C.z; return C.w * k * k;
  }
`;
const DENT_GLSL = DENT_U + `
  float dentAt(vec3 w, out vec2 grad) {   // how far a point (world) is pressed down, and the slope of that
    grad = vec2(0.0); float h = smoothstep(uDentY - 0.12, uDentY - 0.015, w.y); if (h <= 0.0) return 0.0;
    float d = dentEll(w.xz, uDentB, uDentA, grad) + dentEll(w.xz, uDentI, uDentIA, grad);
    for (int i = 0; i < 4; i++) d += dentCirc(w.xz, uPaw[i], grad);
    float s = 1.0 / (1.0 + d / 0.045); grad *= h * s * s; return h * d * s;   // (bottoming out: d / (1 + d/4.5 cm))
  }`;
// the cover's folds round the body's hollow, as a height (metres) for the fabric's bump: radial, drawn in toward it
const DENT_FOLDS = DENT_U + `
  float dentFolds(vec3 w) {
    if (uDentB.z <= 0.0) return 0.0; float h = smoothstep(uDentY - 0.12, uDentY - 0.015, w.y); if (h <= 0.0) return 0.0;
    vec2 d = w.xz - uDentB.xy, uv = vec2(dot(d, uDentA.xy), dot(d, vec2(-uDentA.y, uDentA.x))) / uDentA.zw; float q = length(uv);
    float ring = smoothstep(0.42, 0.78, q) * (1.0 - smoothstep(0.92, 1.38, q)); if (ring <= 0.0) return 0.0;
    float a = atan(uv.y, uv.x), ph = a * 11.0 + 1.3 * sin(a * 3.0 + 1.7) + 2.0 * q, aa = 1.0 - smoothstep(0.6, 1.5, fwidth(ph));
    return -h * ring * aa * min(1.2, uDentB.z / 0.03) * 0.0022 * pow(0.5 + 0.5 * cos(ph), 2.0);
  }`;
function makeVelvet({ color, sheen, sheenRough = 0.6, rough = 0.95, map = null, normalMap = null, normalScale = null, ao = false, pleat = 0, crease = 0.4, allFaces = 0, crush = 1, seam = 0, freq = 1, spec = 0.1, sheenAmt = 0.8, dent = false }) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0, sheen: sheenAmt, sheenColor: new THREE.Color(sheen), sheenRoughness: sheenRough, specularIntensity: spec, side: THREE.DoubleSide, vertexColors: ao });
  if (map) m.map = map; if (normalMap) { m.normalMap = normalMap; if (normalScale) m.normalScale.copy(normalScale); }
  const U = { uPleat: { value: pleat }, uCrease: { value: crease }, uAll: { value: allFaces }, uCrush: { value: crush }, uSeam: { value: seam }, uFreq: { value: freq } };
  m.userData.velvet = U;
  if (dent) m.customProgramCacheKey = () => 'velvet-dent';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjP;\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position;\nvObjN = objectNormal;');
    if (dent) {
      Object.assign(sh.uniforms, SOFT.u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + DENT_GLSL)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          { vec2 gr; dentAt((modelMatrix * vec4(position, 1.0)).xyz, gr); mat3 mm = mat3(modelMatrix); vec3 wn = normalize(mm * objectNormal);
            objectNormal = normalize(inverse(mm) * normalize(wn - vec3(gr.x, 0.0, gr.y) * max(wn.y, 0.0))); }`)
        .replace('vObjN = objectNormal;', `vObjN = objectNormal;
          { vec2 gr; vec3 w0 = (modelMatrix * vec4(transformed, 1.0)).xyz; float dd = dentAt(w0, gr); transformed += inverse(mat3(modelMatrix)) * vec3(0.0, -dd, 0.0); vDentW = w0; vDentD = dd; }`)
        .replace('#include <common>', '#include <common>\nvarying vec3 vDentW; varying float vDentD;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vDentW; varying float vDentD;' + DENT_FOLDS);
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vObjP; varying vec3 vObjN;
      uniform float uPleat, uCrease, uAll, uCrush, uSeam, uFreq;
      uniform mat4 modelMatrix;
      float vh31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
      float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(vh31(i), vh31(i + vec3(1,0,0)), f.x), mix(vh31(i + vec3(0,1,0)), vh31(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(vh31(i + vec3(0,0,1)), vh31(i + vec3(1,0,1)), f.x), mix(vh31(i + vec3(0,1,1)), vh31(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float vfbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vn3(p); p = p * 2.07 + vec3(17.1, 3.7, 9.3); a *= 0.5; } return s / 0.875; }
      // fabric height (metres, object space): pleats on vertical faces, creases + lumps on top faces
      float fabricH(vec3 p, vec3 n) {
        vec3 q = p * uFreq;
        float side = smoothstep(0.06, 0.42, 1.0 - abs(n.y)), top = mix(smoothstep(0.45, 0.9, n.y), 1.0, uAll);
        // gathered pleats on the vertical faces: they run vertically, spaced along the dominant horizontal axis
        float u = mix(q.x, q.z, smoothstep(0.35, 0.65, abs(n.x)));
        float w = vfbm(q * vec3(3.0, 1.2, 3.0)) * 2.6;
        float ph = u * 34.0 + w * 2.0 + q.y * 2.0;
        // frequency clamp: once a pleat period shrinks towards a pixel (grazing view, distance) fade it out
        float aaP = 1.0 - smoothstep(0.5, 1.4, fwidth(ph));
        float pleat = -pow(0.5 + 0.5 * cos(ph), 3.0) * smoothstep(0.12, 0.6, vfbm(q * vec3(5.0, 1.6, 5.0) + 7.0)) * aaP;
        // soft creases where a warped noise field crosses zero, plus broad lumps of the filling
        float f = vfbm(q * 2.6 + vec3(vfbm(q * 1.3) * 1.4)) * 2.0 - 1.0;
        float aaC = 1.0 - smoothstep(0.03, 0.09, fwidth(f));
        float crease = -exp(-f * f * 30.0) * aaC, lump = vfbm(q * 1.8 + 3.0) - 0.5;
        // welt cord (piping) where the rounded edge turns from the top/bottom panel into the boxing strip
        float sn = (abs(n.y) - 0.74) / 0.05, cord = exp(-sn * sn) - 0.55 * exp(-pow((abs(n.y) - 0.62) / 0.05, 2.0));
        return uPleat * side * pleat * 0.012 + uCrease * top * (crease * 0.003 + lump * 0.005) + uSeam * cord * 0.0025;
      }
      float vCav, vHt;
      float vCrush;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vCrush = smoothstep(0.28, 0.72, vfbm(vObjP * uFreq * 5.0 + 11.0));
        {
          float hF = fabricH(vObjP, normalize(vObjN) * (gl_FrontFacing ? 1.0 : -1.0));
          // crushed pile: a gentle undulation whose slope tilts the fibres in patches
          float hC = (vfbm(vObjP * uFreq * 3.0 + 1.3) - 0.5) * 0.012 * uCrush * (0.4 + vCrush);
          vHt = (hF + hC) * length(modelMatrix[0].xyz);           // metres in world space
          vCav = clamp(1.0 + hF * 30.0, 0.55, 1.0);                // fold valleys hold shadow
          ${dent ? 'vHt += dentFolds(vDentW); vCav *= 1.0 - 0.16 * smoothstep(0.0, 0.035, vDentD);   // (the cover drawn in round the cat; the hollow\'s floor a little in shadow)' : ''}
        }
        diffuseColor.rgb *= mix(0.9, 1.07, vCrush * uCrush + (1.0 - uCrush) * 0.5) * vCav;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // surface-gradient bump from screen-space derivatives (Mikkelsen 2010) with unnormalised sigmas,
          // so the slope keeps true units: one fabric evaluation per pixel instead of four
          vec3 sp = -vViewPosition, sx = dFdx(sp), sy = dFdy(sp);
          vec3 R1 = cross(sy, normal), R2 = cross(normal, sx);
          float det = dot(sx, R1) * faceDirection;
          vec3 grad = sign(det) * (dFdx(vHt) * R1 + dFdy(vHt) * R2);
          float slope = length(grad) / max(abs(det), 1e-14);        // derivatives jump across silhouettes: cap the tilt
          grad *= min(1.0, 0.7 / max(slope, 1e-6));
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_SHEEN
          material.sheenColor *= mix(0.55, 1.3, vCrush * uCrush + (1.0 - uCrush) * 0.5) * vCav * vCav;
          #ifdef USE_COLOR
            material.sheenColor *= vColor.r;
          #endif
        #endif`);
  };
  return m;
}
/* stuffed bolster: rounded ends gathered into a button, soft body wrinkles; axis along x */
function bolsterGeometry(L = 0.62, R = 0.13, seed = 3) {
  const seg = 72, rings = 110, cap = 0.85 * R, r = rng(seed), ph = r() * 10; const pos = [], uv = [], idx = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings, x = (t - 0.5) * L, e = Math.max(0, Math.abs(x) - (L / 2 - cap)) / cap;
    const prof = Math.sqrt(Math.max(0, 1 - Math.pow(e, 2.4)));
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      const gather = Math.pow(e, 0.65) * 0.1 * Math.sin(a * 16 + ph + e * 2.5);
      const wr = (0.014 * Math.sin(a * 3 + x * 11 + ph) + 0.01 * Math.sin(a * 7 - x * 17 + ph * 2)) * (1 - e);
      const rad = R * prof * (1 + gather + wr);
      pos.push(x, Math.cos(a) * rad * 0.9, Math.sin(a) * rad); uv.push(t * 3, i / seg);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + seg + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/* contact AO baked into vertex colour: nearest occluding point of another part in front of the surface,
   plus a darkening towards the floor. Parts are compared in world space.                                 */
function bakeContactAO(targets, occluders, { R = 0.11, strength = 0.78, floorFade = 0.16 } = {}) {
  const cell = R, key = (x, y, z) => ((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096); const grid = new Map(); const v = new THREE.Vector3(), nv = new THREE.Vector3();
  for (const { mesh, id } of occluders) {
    mesh.updateWorldMatrix(true, false); const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); const k = key(Math.floor(v.x / cell), Math.floor(v.y / cell), Math.floor(v.z / cell)); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(v.x, v.y, v.z, id); }
  }
  for (const { mesh, id } of targets) {
    mesh.updateWorldMatrix(true, false); const g = mesh.geometry, p = g.attributes.position, n = g.attributes.normal; const col = new Float32Array(p.count * 3);
    const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); nv.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      const cx = Math.floor(v.x / cell), cy = Math.floor(v.y / cell), cz = Math.floor(v.z / cell); let occ = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const a = grid.get(key(cx + dx, cy + dy, cz + dz)); if (!a) continue;
        for (let j = 0; j < a.length; j += 4) {
          if (a[j + 3] === id) continue; const qx = a[j] - v.x, qy = a[j + 1] - v.y, qz = a[j + 2] - v.z; const d = Math.sqrt(qx * qx + qy * qy + qz * qz);
          if (d > R || d < 1e-5) continue; const c = (qx * nv.x + qy * nv.y + qz * nv.z) / d; if (c < 0.1) continue;
          const w = 1 - d / R; occ = Math.max(occ, w * w * (0.35 + 0.65 * c));
        }
      }
      const ao = (1 - strength * occ) * THREE.MathUtils.lerp(0.5, 1, THREE.MathUtils.smoothstep(v.y, 0, floorFade));
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
}
function flatBook(src, yaw = 0, s = 1) {
  // GLB books stand upright (thickness x, height y, depth z): lay them on the cover, bottom-centre at the origin
  const m = new THREE.Mesh(src.geometry, src.material); m.rotation.set(0, 0, Math.PI / 2); m.scale.setScalar(s); m.castShadow = m.receiveShadow = true;
  const inner = new THREE.Group(); inner.add(m); inner.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(m); const c = b.getCenter(new THREE.Vector3());
  m.position.set(-c.x, -b.min.y, -c.z); const g = new THREE.Group(); g.add(inner); inner.rotation.y = yaw; g.userData.h = b.max.y - b.min.y; return g;
}
async function buildFurniture(A) {   // async: it yields between its heavy parts so the page stays responsive while it loads
  const F = new THREE.Group(); room.add(F); const B = A.byName;
  // ---- sofa (re-arranged sectional, one mesh per part): local back at z=0, left end at x=0
  const sofa = new THREE.Group(); const S = 0.92; sofa.scale.setScalar(S);
  sofa.position.set(R.xS - 3.7213 * S, 0, R.zB + R.caseD + 0.26); F.add(sofa);
  const ref = B.sofa_seat_mid.material; const nS = ref.normalScale.clone();
  MAT.sofaCushion = makeVelvet({ color: 0x40603f, sheen: 0xdfe6c4, sheenAmt: 1, map: ref.map, normalMap: ref.normalMap, normalScale: nS.clone().multiplyScalar(0.9), ao: true, pleat: 1, crease: 1, seam: 1, freq: 1, dent: true });   // (gives under the cat)
  MAT.sofaBack = makeVelvet({ color: 0x40603f, sheen: 0xdfe6c4, sheenAmt: 1, map: ref.map, normalMap: ref.normalMap, normalScale: nS.clone().multiplyScalar(0.9), ao: true, pleat: 0, crease: 0.8, allFaces: 1, seam: 1, freq: 1 });
  MAT.sofaFrame = makeVelvet({ color: 0x3b5a3c, sheen: 0xd6dfbd, sheenAmt: 1, map: ref.map, normalMap: ref.normalMap, normalScale: nS.clone().multiplyScalar(0.7), ao: true, pleat: 0, crease: 0.35, freq: 1 });
  const parts = [], aoT = [], aoO = []; let pid = 0;
  for (const m of Object.values(B)) {
    if (!m.name.startsWith('sofa_') || m.name === 'sofa_legs') continue;
    const mat = /seat/.test(m.name) ? MAT.sofaCushion : /back|arm|pillow/.test(m.name) ? MAT.sofaBack : MAT.sofaFrame;
    const mesh = new THREE.Mesh(m.geometry.clone(), mat); mesh.name = m.name; mesh.castShadow = mesh.receiveShadow = true;
    sofa.add(mesh); parts.push(mesh); const e = { mesh, id: ++pid }; aoT.push(e); aoO.push(e);
  }
  // recessed dark plinth instead of the little leg cubes
  { const plinthMat = new THREE.MeshStandardMaterial({ color: 0x1d2419, roughness: 1 });
    const fp = (names) => { const b = new THREE.Box3(); for (const n of names) { B[n].geometry.computeBoundingBox(); b.union(B[n].geometry.boundingBox); } return b; };
    for (const b of [fp(['sofa_frame_end', 'sofa_frame_mid', 'sofa_frame_corner']), fp(['sofa_base_chaise'])]) {
      const w = b.max.x - b.min.x - 0.09, d = b.max.z - b.min.z - 0.09; const pl = new THREE.Mesh(new THREE.BoxGeometry(w, 0.075, d), plinthMat);
      pl.position.set((b.min.x + b.max.x) / 2, 0.0375, (b.min.z + b.max.z) / 2); pl.receiveShadow = true; sofa.add(pl); } }
  // bolsters (as in the painting: a roll at the right end, one against the left arm)
  MAT.bolster = makeVelvet({ color: 0x37563a, sheen: 0xd3ddb9, sheenAmt: 1, ao: true, pleat: 0, crease: 0.5, freq: 1 });
  const bol = (x, y, z, ry, rx, L, Rr, seed) => { const m = new THREE.Mesh(bolsterGeometry(L, Rr, seed), MAT.bolster); m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); m.castShadow = m.receiveShadow = true; sofa.add(m); const e = { mesh: m, id: ++pid }; aoT.push(e); aoO.push(e); return m; };
  bol(3.13, 0.585, 0.78, Math.PI / 2, -0.08, 0.66, 0.14, 3);
  bol(0.53, 0.575, 0.84, Math.PI / 2, 0.05, 0.62, 0.13, 8);
  // pillows from the modern sofa (square ones = pillow_1..4), velvet with their own sewn-seam normal maps
  MAT.pillowMustard = makeVelvet({ color: 0x96703f, sheen: 0xd9c296, sheenAmt: 0.9, rough: 0.97, ao: true, pleat: 0, crease: 0.45, allFaces: 1, freq: 1.8 });
  MAT.pillowGreen = makeVelvet({ color: 0x37573a, sheen: 0xcfdab4, sheenAmt: 1, ao: true, pleat: 0, crease: 0.45, allFaces: 1, freq: 1.8 });
  const pilMats = new Map();
  const pil = (name, base, x, y, z, ry, rx, rz, s) => {
    const src = B[name]; let mat = base;
    if (src.material.normalMap) { const k = base.uuid + name; if (!pilMats.has(k)) { const c = base.clone(); c.onBeforeCompile = base.onBeforeCompile; c.userData = base.userData; c.normalMap = src.material.normalMap; c.normalScale = src.material.normalScale.clone().multiplyScalar(1.3); pilMats.set(k, c); } mat = pilMats.get(k); }
    const m = new THREE.Mesh(src.geometry.clone(), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz, 'YXZ'); m.scale.setScalar(s); m.castShadow = m.receiveShadow = true; F.add(m);
    const e = { mesh: m, id: ++pid }; aoT.push(e); aoO.push(e); return m; };
  const zb = sofa.position.z, x0 = sofa.position.x, seatY = 0.43 * S;
  // along the back (left → right)
  pil('pillow_1', MAT.pillowMustard, x0 + 0.62, seatY - 0.02, zb + 0.6, 0.1, -0.3, 0.12, 2.0);
  pil('pillow_2', MAT.pillowMustard, x0 + 1.22, seatY - 0.03, zb + 0.6, -0.05, -0.32, -0.05, 1.75);
  pil('pillow_3', MAT.pillowGreen, x0 + 1.72, seatY - 0.02, zb + 0.58, 0.08, -0.25, 0.06, 1.7);
  pil('pillow_4', MAT.pillowMustard, x0 + 2.52, seatY - 0.03, zb + 0.6, 0.15, -0.3, 0.1, 1.65);
  pil('pillow_2', MAT.pillowMustard, x0 + 3.0, seatY - 0.02, zb + 0.6, -0.2, -0.3, -0.08, 1.85);
  F.updateMatrixWorld(true);
  bakeContactAO(aoT, aoO);
  F.userData.sofa = sofa; LIGHTS.sofa = sofa;
  await tick();
  // ---- coffee table (GLB, scaled to an oval) + wooden legs
  const tbl = new THREE.Group(); const tS = new THREE.Vector3(0.95 / 2, 0.42 / 0.907, 0.6 / 2);
  const topMat = B.ctable_top.material.clone(); topMat.color.setRGB(1.55, 1.2, 0.85); topMat.roughness = .55; topMat.metalness = 0; topMat.metalnessMap = topMat.roughnessMap = null;
  for (const n of ['ctable_top', 'ctable_legs']) { const m = new THREE.Mesh(B[n].geometry, n === 'ctable_top' ? topMat : MAT.oak); m.scale.copy(tS); m.castShadow = m.receiveShadow = true; tbl.add(m); }
  tbl.position.set(-0.32, 0, -6.3); tbl.rotation.y = 0.05; F.add(tbl);
  const lamp = tableLamp(); lamp.position.set(-0.6, 0.42, -6.47); F.add(lamp); LIGHTS.table = lamp;
  paintLightly(lamp);   // (75 % less watercolour on it too: G, 17/10/2026)
  const cj = candleJar(); cj.position.set(-0.72, 0.42, -6.25); F.add(cj); LIGHTS.candle = cj;
  const tb1 = flatBook(B.book_book002, 0.35 + Math.PI / 2, 1.15); tb1.position.set(-0.13, 0.42, -6.22); F.add(tb1);
  const tb2 = flatBook(B.book_book01, 0.2 + Math.PI / 2, 1.1); tb2.position.set(-0.13, 0.42 + tb1.userData.h, -6.21); F.add(tb2);
  paintLightly(tb1, 0.1); paintLightly(tb2, 0.1);   // (every book 10 % less watercolour: G, 17/10/2026)
  // ---- floor lamp in the back-right corner, behind the sofa
  const fl = floorLamp(); fl.position.set(R.xS - 0.28, 0, R.zB + R.caseD + 0.16); fl.rotation.y = -0.15; F.add(fl); LIGHTS.floor = fl;
  paintLightly(fl);   // (75 % less watercolour on it: G, 16/10/2026)
  // ---- a bare bulb hanging over the front of the sofa's seat: from the room's first view it is seen above the RESEARCH
  // caption, between two posts of the back glass (G, 17/10/2026: his screenshot, ~2077 × 1500 CSS px), its middle 3.27 m up;
  // the page's sky clock is centred over it (build.py: 39.92 painting px right of the middle; moved with it)
  const pd = pendantLamp(R.H - 3.27); pd.position.set(0.43, R.H, -7.2); F.add(pd); LIGHTS.pendant = pd;
  paintLightly(pd, 0.875);   // (75 % less watercolour, then half of what was left: G, 17/10/2026)
  // ---- stump side table + plant
  const st = stumpTable(); st.position.set(R.xL + 0.32, 0, -5.85); F.add(st);
  const pot = new THREE.Mesh(new THREE.LatheGeometry([[.001, 0], [.1, 0], [.14, .05], [.15, .11], [.14, .12]].map(p => new THREE.Vector2(p[0], p[1])), 28), MAT.stone); pot.position.set(R.xL + 0.28, 0.53, -5.98); pot.castShadow = true; F.add(pot);
  const pl = plant({ leaves: 120, spread: 0.55, height: 0.7, seed: 11, scale: 0.13 }); pl.position.set(R.xL + 0.28, 0.6, -5.98); F.add(pl);
  for (const o of [st, pot, pl]) paintLightly(o, 0.5);   // (the plant, its pot and its stump: 50 % less watercolour, G, 17/10/2026)
  // ---- rug + pouf + books on it
  MAT.pouf = makeVelvet({ color: 0x30553c, sheen: 0xd6e6cf, sheenAmt: 1, sheenRough: 0.5, pleat: 0, crease: 1.1, allFaces: 1, freq: 1.6, ao: true });   // fine crumple shading between the modelled folds
  const pouf = new THREE.Mesh(poufGeometry(1.4, 1.22, 0.5), MAT.pouf);
  pouf.position.set(0.22, 0.008, -3.36); pouf.rotation.y = 0.1; pouf.castShadow = pouf.receiveShadow = true; F.add(pouf);
  await tick();
  LIGHTS.rug = buildRug(F, pouf);
  await tick();
  { const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pouf.geometry.userData.seam, true), 420, 0.006, 6, true); const c = new Float32Array(tg.attributes.position.count * 3).fill(0.62); tg.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const cord = new THREE.Mesh(tg, MAT.pouf); cord.castShadow = true; pouf.add(cord); }
  pouf.updateMatrixWorld(true);
  // books rest on the folds: sample the cushion under the book's corners and fit the tilt
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  const hitY = (x, z) => { ray.set(new THREE.Vector3(x, 2, z), down); const h = ray.intersectObject(pouf, false)[0]; return h ? h.point.y : 0.5; };
  const restOn = (obj, x, z, yaw, hw, hd) => {
    const c = Math.cos(yaw), s2 = Math.sin(yaw), pt = (u, v) => [x + u * c + v * s2, z - u * s2 + v * c];
    const ys = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => { const [px, pz] = pt(u, v); return hitY(px, pz); });
    const mean = ys.reduce((q, w) => q + w, 0) / 4, y = mean + 0.35 * (Math.max(...ys) - mean),   // the cushion is pressed flat under it below
      tiltX = Math.atan2(((ys[2] + ys[3]) - (ys[0] + ys[1])) / 2, 2 * hd), tiltZ = Math.atan2(((ys[1] + ys[2]) - (ys[0] + ys[3])) / 2, 2 * hw);
    obj.position.set(x, y, z); obj.rotation.set(-tiltX, yaw, tiltZ, 'YXZ'); F.add(obj); return y; };
  const toW = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), pouf.rotation.y).add(pouf.position);
  const b1 = flatBook(B.book_book002, Math.PI / 2, 1.5), b2 = flatBook(B.book_book005, Math.PI / 2 + 0.07, 1.42), b3 = flatBook(B.book_book006, Math.PI / 2, 1.55);
  for (const b of [b1, b2, b3]) paintLightly(b, 0.1);
  { const p = toW(-0.17, -0.22); restOn(b1, p.x, p.z, 0.22, 0.13, 0.17); }
  const y2 = b1.position.y + b1.userData.h; b2.position.set(b1.position.x + 0.006, y2, b1.position.z - 0.004); b2.rotation.copy(b1.rotation); b2.rotation.y += 0.06; F.add(b2);
  { const p = toW(-0.33, 0.05); restOn(b3, p.x, p.z, 0.36, 0.14, 0.19); }
  // the weight of a book flattens the velvet under it; the fabric rises softly around its edges
  const pressUnder = (book, hw, hd) => {
    book.updateMatrixWorld(true); const inv = book.matrixWorld.clone().invert(), back = pouf.matrixWorld.clone().invert().multiply(book.matrixWorld);
    const Pp = pouf.geometry.attributes.position, v = new THREE.Vector3(), m = 0.06;
    for (let i = 0; i < Pp.count; i++) { v.fromBufferAttribute(Pp, i).applyMatrix4(pouf.matrixWorld).applyMatrix4(inv);
      const out = Math.hypot(Math.max(0, Math.abs(v.x) - hw), Math.max(0, Math.abs(v.z) - hd)); if (out > m || v.y < -0.12) continue;
      const allowed = -0.002 + (out / m) * (out / m) * 0.045; if (v.y > allowed) { v.y = allowed; v.applyMatrix4(back); Pp.setXYZ(i, v.x, v.y, v.z); } }
    Pp.needsUpdate = true; };
  pressUnder(b1, 0.13, 0.17); pressUnder(b3, 0.14, 0.19); pouf.geometry.computeVertexNormals(); pouf.geometry.computeBoundingSphere();
  // some GLB hardcovers face-out on the shelf
  return F;
}
/* ---------------------------------------------------------------- dust motes */
function dust() {
  const n = 600; const g = new THREE.BufferGeometry(); const p = new Float32Array(n * 3); const r = rng(3);
  for (let i = 0; i < n; i++) { p[i * 3] = R.xL + r() * (R.xS - R.xL); p[i * 3 + 1] = r() * R.H; p[i * 3 + 2] = R.zB + r() * (R.zF - R.zB); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color: 0xfff3d6, size: 0.012, transparent: true, opacity: .55, depthWrite: false, fog: false });
  const pts = new THREE.Points(g, m); scene.add(pts); return pts;
}
/* ---------------------------------------------------------------- post: watercolour */
// (light: the parts of the room painted lightly, drawLight below)
const POST = { light: { scene: new THREE.Scene(), parts: [], mats: new Map(), k: { value: 1 } } };   // (k: all of each part's own share)
/* The watercolour picture is made in three passes:
   1. tone: the scene's colours through the tone curve, once per pixel (the paint pass reads each one ~50 times);
   2. paper: the noise fields that only depend on the screen position (wobble, pigment, fibres, blotches, paper grain),
      baked when the window size changes instead of being recomputed every frame;
   3. paint: Kuwahara smoothing, ink edges and the paper, reading the two above.
   The Kuwahara is the generalized one (Papari, Petkov & Campisi 2007): the four sectors' means blended by how even each
   is (weights 1/(1 + (k·variance)^4)) instead of the evenest taken outright, which left stair-steps on busy, high-contrast
   detail (leaves against the night). And where the depth is busy all round (foliage), the ink keeps off the single
   leaves and the strokes run into each other (wet-in-wet): a painter washes a mass of leaves as one soft shape ("lost"
   edges) and keeps the line for the big forms.  */
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }';
function buildPost() {
  POST.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(4, 4) });
  const exposure = { value: 0.87 }, quad = (uniforms, fragmentShader) => new FullScreenQuad(new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VS, fragmentShader, depthTest: false, depthWrite: false }));
  POST.tone = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
  POST.toneQuad = quad({ tColor: { value: null }, exposure }, /* glsl */`
    precision highp float; uniform sampler2D tColor; uniform float exposure; varying vec2 vUv;
    vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
    vec3 toS(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(0.0031308,c)); }
    void main(){ vec4 c = texture2D(tColor, vUv); gl_FragColor = vec4(toS(aces(c.rgb*exposure*0.85)), 1.0 - clamp(c.a, 0.0, 1.0)); }`);   // (alpha: the parts painted lightly, see drawLight)
  const nearest = { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
  POST.n1 = new THREE.WebGLRenderTarget(4, 4, nearest); POST.n2 = new THREE.WebGLRenderTarget(4, 4, nearest);
  POST.bakeQuad = quad({ res: { value: new THREE.Vector2() }, which: { value: 0 } }, /* glsl */`
    precision highp float; uniform vec2 res; uniform float which; varying vec2 vUv;
    float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
    float fb(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }
    void main(){ vec2 px = vUv*res;
      if (which < 0.5) gl_FragColor = vec4(fb(px*0.012+3.1), fb(px*0.012+7.7), fb(px*0.05), fb(px*0.35));                  // wobble x, y · ink · pigment
      else gl_FragColor = vec4(fb(vec2(px.x*0.9, px.y*0.08)), fb(px*0.004+11.0), fb(px*0.6)*0.6 + fb(px*0.08)*0.4, 1.0);   // fibres · blotches · paper
    }`);
  POST.quad = quad({ tTone: { value: POST.tone.texture }, tDepth: { value: null }, tN1: { value: POST.n1.texture }, tN2: { value: POST.n2.texture },
    res: { value: new THREE.Vector2(1, 1) }, near: { value: 0.05 }, far: { value: 400 }, exposure, lift: { value: 0.88 }, veil: { value: 0.06 },
    uInvVP: { value: new THREE.Matrix4() }, uRoom: { value: new THREE.Vector4(R.xL, R.xW, R.zB, R.zF) }, uFloorK: { value: 0.62 }, uLightK: POST.light.k }, /* glsl */`
    precision highp float;
    uniform sampler2D tTone, tDepth, tN1, tN2; uniform vec2 res; uniform float near, far, lift, veil, uFloorK, uLightK; uniform mat4 uInvVP; uniform vec4 uRoom;
    varying vec2 vUv;
    float ld(float d){ float z=d*2.0-1.0; return 2.0*near*far/(far+near-z*(far-near)); }
    vec3 samp(vec2 uv){ return texture2D(tTone, uv).rgb; }
    void main(){
      vec2 tx = 1.0/res; float sc = res.y/1000.0;
      vec4 n1 = texture2D(tN1, vUv), n2 = texture2D(tN2, vUv);
      // the room's wooden floor is painted more lightly (G, 15/10/2026: "wooden floor less water color"): where this pixel
      // lies on it (its depth back to the room: y = 0 inside the walls), the painted strokes give way to the wood as drawn
      vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, texture2D(tDepth, vUv).r * 2.0 - 1.0, 1.0); wp.xyz /= wp.w;
      float fl = uFloorK * (1.0 - smoothstep(0.003, 0.008, abs(wp.y))) * step(uRoom.x, wp.x) * step(wp.x, uRoom.y) * step(uRoom.z, wp.z) * step(wp.z, uRoom.w);
      // --- wobble (pigment pushed by paper)
      vec2 uvw = vUv + (n1.xy - 0.5)*tx*3.5*sc*(1.0 - 0.8*fl);
      // --- 4-sector Kuwahara (radius 3)
      vec3 m[4]; vec3 s2[4]; for(int k=0;k<4;k++){ m[k]=vec3(0.0); s2[k]=vec3(0.0); }
      for(int j=-3;j<=3;j++) for(int i=-3;i<=3;i++){
        vec3 c = samp(uvw + vec2(float(i),float(j))*tx*1.25*sc);
        if(i<=0&&j<=0){ m[0]+=c; s2[0]+=c*c; } if(i>=0&&j<=0){ m[1]+=c; s2[1]+=c*c; }
        if(i<=0&&j>=0){ m[2]+=c; s2[2]+=c*c; } if(i>=0&&j>=0){ m[3]+=c; s2[3]+=c*c; } }
      vec3 col = vec3(0.0); float wsum = 0.0;
      for(int k=0;k<4;k++){ vec3 mu = m[k]/16.0; vec3 v = abs(s2[k]/16.0 - mu*mu); float sv = v.r+v.g+v.b, w = 1.0/(1.0 + pow(sv*300.0, 4.0)); col += mu*w; wsum += w; }
      col /= max(wsum, 1e-6);
      // --- edges: depth + colour sobel
      float d00=ld(texture2D(tDepth,uvw+vec2(-1,-1)*tx*sc).r), d10=ld(texture2D(tDepth,uvw+vec2(0,-1)*tx*sc).r), d20=ld(texture2D(tDepth,uvw+vec2(1,-1)*tx*sc).r);
      float d01=ld(texture2D(tDepth,uvw+vec2(-1,0)*tx*sc).r), d11=ld(texture2D(tDepth,uvw).r), d21=ld(texture2D(tDepth,uvw+vec2(1,0)*tx*sc).r);
      float d02=ld(texture2D(tDepth,uvw+vec2(-1,1)*tx*sc).r), d12=ld(texture2D(tDepth,uvw+vec2(0,1)*tx*sc).r), d22=ld(texture2D(tDepth,uvw+vec2(1,1)*tx*sc).r);
      float gx = (d20+2.0*d21+d22)-(d00+2.0*d01+d02), gy = (d02+2.0*d12+d22)-(d00+2.0*d10+d20);
      float de = clamp(length(vec2(gx,gy))/max(d11,0.3)*6.0 - 0.25, 0.0, 1.0);
      vec3 a1 = samp(uvw+vec2(1.5,0)*tx*sc), a2 = samp(uvw-vec2(1.5,0)*tx*sc), a3 = samp(uvw+vec2(0,1.5)*tx*sc), a4 = samp(uvw-vec2(0,1.5)*tx*sc);
      float ce = length(a1-a2)+length(a3-a4);
      // how busy the depth is a little further round (foliage: many small steps in depth on every side)
      float busy = 0.0; for(int k=0;k<6;k++){ float a = float(k)*1.0472 + n1.x*2.0; float dk = ld(texture2D(tDepth, uvw + vec2(cos(a), sin(a))*tx*sc*4.0).r); busy += step(0.06*d11, abs(dk - d11)); }
      float leafy = smoothstep(3.5, 5.5, busy);   // (most of the way round: a mass of leaves, not the one edge of a form)
      busy = smoothstep(2.0, 5.0, busy);
      // wet-in-wet: in a mass of leaves the strokes run into each other, no cut-out edges (the four quarters' plain mean:
      // a soft 7×7 wash)
      col = mix(col, (m[0] + m[1] + m[2] + m[3]) / 64.0, leafy * 0.6);
      float ink = max(de*0.85*(1.0 - 0.7*busy), smoothstep(0.25,0.65,ce)*0.38*(1.0 - 0.5*busy)) * (0.55 + 0.6*n1.z) * smoothstep(16.0, 8.5, d11) * (1.0 - 0.8*fl);
      col = mix(col, samp(vUv), fl);   // (on the floor: the wood's grain and seams as drawn, under a lighter wash)
      // --- watercolour transparency: lift + slight desaturation, pigment granulation, edge darkening
      float lum = dot(col, vec3(0.299,0.587,0.114));
      col = mix(col, col * 1.25 + vec3(0.03, 0.04, 0.025), busy * (1.0 - smoothstep(0.05, 0.3, lum)) * 0.6);   // a mass of leaves in shade: a dark wash, not a hard black
      lum = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(lum), col, 1.08);
      col *= 1.0 + (n1.w - 0.5)*0.10*(1.0-lum) + (n2.x - 0.5)*0.03;
      col *= 1.0 - smoothstep(0.08,0.5,ce)*0.10;
      col = mix(col, col*col*1.06 + 0.02, 0.10 + 0.1*n2.y);           // wet-in-wet blotches
      col = mix(vec3(dot(col, vec3(0.299,0.587,0.114))), col, 0.9);
      col = 1.0 - (1.0 - col)*lift;                                    // paper shows through (less at night)
      col = mix(col, col*vec3(1.02,1.0,0.95), 0.6);                   // warm paper tint
      col = mix(col, vec3(0.24,0.17,0.11), ink*0.55);                  // brown ink line
      col *= 0.96 + n2.z*0.07;                                         // paper texture
      // a part painted lightly (drawLight's mask): most of it as drawn, under the paper's lift and warmth only
      float lite = texture2D(tTone, vUv).a * uLightK;
      if (lite > 0.001) { vec3 cl = 1.0 - (1.0 - samp(vUv))*lift; cl = mix(cl, cl*vec3(1.02,1.0,0.95), 0.6); col = mix(col, cl, lite); }
      gl_FragColor = vec4(col*(1.0-veil),1.0);
    }`);
  POST.mat = POST.quad.material;
  POST.out = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });   // the finished picture, at CSS resolution
  // laid on the canvas through FXAA (T. Lottes): the picture is painted at CSS pixels and shown on a screen twice as
  // fine, and its hard steps (dark leaves against the night) were showing as stairs
  POST.blit = quad({ t: { value: POST.out.texture }, px: { value: new THREE.Vector2(1, 1) } }, `uniform sampler2D t; uniform vec2 px; varying vec2 vUv;
    float L(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main(){
      vec3 nw = texture2D(t, vUv + vec2(-1.0, -1.0) * px).rgb, ne = texture2D(t, vUv + vec2(1.0, -1.0) * px).rgb, sw = texture2D(t, vUv + vec2(-1.0, 1.0) * px).rgb, se = texture2D(t, vUv + vec2(1.0, 1.0) * px).rgb, m = texture2D(t, vUv).rgb;
      float lnw = L(nw), lne = L(ne), lsw = L(sw), lse = L(se), lm = L(m), lo = min(lm, min(min(lnw, lne), min(lsw, lse))), hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
      if (hi - lo < max(0.03, hi * 0.12)) { gl_FragColor = vec4(m, 1.0); return; }
      vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
      float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0), rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * px;
      vec3 a = 0.5 * (texture2D(t, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(t, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(t, vUv - dir * 0.5).rgb + texture2D(t, vUv + dir * 0.5).rgb);
      float lb = L(b); gl_FragColor = vec4((lb < lo || lb > hi) ? a : b, 1.0); }`);
}
/* ---- parts of the room painted lightly: stand-ins for their meshes, in a scene of their own.
   - Asked for: the floor lamp behind the sofa "75% less" watercolour (G, 16/10/2026); 17/10: the table lamp by the
     sofa too, then the potted plant by the glass 50 % less and every book 10 % less.
   - They are drawn into the picture's target after the room, through the room's own depth, so what stands in front of
     them still hides them.
   - They write nothing but the target's alpha: 1 − k where they show (k: how much less paint), 1 everywhere else (set
     first: the leaves' alpha-to-coverage leaves less than 1 in it).
   - The tone pass hands 1 − alpha on, and the paint pass lets that share of the paint go, the part as drawn under the
     paper's lift and warmth.
   - The parts stay in the room: lit, shadowed, in its depth. An instanced mesh's stand-in shares its instances. */
function paintLightly(obj, k = 0.75) {
  const L = POST.light; let mat = L.mats.get(k);
  if (!mat) L.mats.set(k, mat = new THREE.ShaderMaterial({ vertexShader: 'void main(){ vec4 p = vec4(position, 1.0);\n#ifdef USE_INSTANCING\n  p = instanceMatrix * p;\n#endif\n  gl_Position = projectionMatrix * modelViewMatrix * p; }',
    fragmentShader: `void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, ${(1 - k).toFixed(3)}); }`, side: THREE.DoubleSide, depthTest: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,   // (its own surface, drawn twice, always passes the depth test)
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor }));
  if (!L.reset) L.reset = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: 'void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }',
    depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor }));
  obj.traverse(o => {
    if (!o.isMesh) return; const c = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, mat, o.count) : new THREE.Mesh(o.geometry, mat);
    if (o.isInstancedMesh) c.instanceMatrix = o.instanceMatrix;   // (the same instances, as they move)
    c.matrixAutoUpdate = false; c.frustumCulled = false; L.scene.add(c); L.parts.push([c, o]);
  });
}
function drawLight(camera) {   // (into the picture's target, right after the room)
  const L = POST.light; if (!L.parts.length) return;
  for (const [c, o] of L.parts) { c.matrix.copy(o.matrixWorld); c.matrixWorldNeedsUpdate = true; if (o.isInstancedMesh) c.count = o.count; let v = o.visible; for (let p = o.parent; v && p; p = p.parent) v = p.visible; c.visible = v; }
  const ac = renderer.autoClear; renderer.autoClear = false; L.reset.render(renderer); renderer.render(L.scene, camera); renderer.autoClear = ac;
}
function bakePaper(w, h) {   // the screen-fixed noise of the paint pass, for this window size
  POST.n1.setSize(w, h); POST.n2.setSize(w, h); const U = POST.bakeQuad.material.uniforms; U.res.value.set(w, h); POST.blit.material.uniforms.px.value.set(1 / w, 1 / h);
  for (const [rt, which] of [[POST.n1, 0], [POST.n2, 1]]) { U.which.value = which; renderer.setRenderTarget(rt); POST.bakeQuad.render(renderer); }
  renderer.setRenderTarget(null);
}

/* ---- the paint pass's own steps for a layer drawn sharp over the picture (the deck, the chicken), so some of it can
   be watercolour: its colours wobbled by the paper, Kuwahara-smoothed (radius 2, the strokes as wide as the picture's),
   brown ink on its colour and cover edges, pigment granulation, wet-in-wet blotches and the paper's grain, all from the
   same baked paper noise at the same screen place as the picture's. The user defines vec4 shadeAt(vec2 uv) after it: the
   layer as shown (display colour, cover) at a point of its target. uStep: the stroke step, in the target's pixels.
   From watercolour rendering research (Montesdeoca et al., "Art-directed watercolor rendered animation", 2016, and
   "Edge- and substrate-based effects for watercolor stylization", NPAR 2017): pigment gathers at the edges of a wash
   (edge darkening, from a difference of the wash and its blur), settles in the paper's valleys the more the darker it
   is (granulation), and a dry brush leaves the paper's tops bare along a wash's edge. And from painters: "lost and found"
   edges, the busiest detail kept crisper and the plain washes let go (paintAt's detail: how busy the place is). */
const PAINT_GLSL = `uniform sampler2D tN1, tN2; uniform vec2 uCanvas, uTexel; uniform float uStep; vec4 shadeAt(vec2 uv);
  vec4 paintAt(vec2 uv, out float detail) {
    vec2 sp = gl_FragCoord.xy / uCanvas; vec4 n1 = texture2D(tN1, sp), n2 = texture2D(tN2, sp);
    vec2 d = uTexel * uStep, uvw = uv + (n1.xy - 0.5) * d * 2.8;
    vec4 m0 = vec4(0.0), m1 = vec4(0.0), m2 = vec4(0.0), m3 = vec4(0.0), blr = vec4(0.0), mid = vec4(0.0); vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
      vec4 c = shadeAt(uvw + vec2(float(i), float(j)) * d); vec3 pc = c.rgb * c.a; vec4 q = vec4(pc, c.a); vec3 qq = pc * pc;
      blr += q; if (i == 0 && j == 0) mid = q;
      if (i <= 0 && j <= 0) { m0 += q; s0 += qq; } if (i >= 0 && j <= 0) { m1 += q; s1 += qq; }
      if (i <= 0 && j >= 0) { m2 += q; s2 += qq; } if (i >= 0 && j >= 0) { m3 += q; s3 += qq; } }
    vec4 best = m0 / 9.0; vec3 v = abs(s0 / 9.0 - best.rgb * best.rgb); float bv = v.r + v.g + v.b, sv;
    vec4 mu = m1 / 9.0; v = abs(s1 / 9.0 - mu.rgb * mu.rgb); sv = v.r + v.g + v.b; if (sv < bv) { bv = sv; best = mu; }
    mu = m2 / 9.0; v = abs(s2 / 9.0 - mu.rgb * mu.rgb); sv = v.r + v.g + v.b; if (sv < bv) { bv = sv; best = mu; }
    mu = m3 / 9.0; v = abs(s3 / 9.0 - mu.rgb * mu.rgb); sv = v.r + v.g + v.b; if (sv < bv) { bv = sv; best = mu; }
    float a = best.a; vec3 col = a > 0.002 ? best.rgb / a : vec3(0.0);
    detail = bv;   // the calmest quarter's spread: high only where the place is busy all round (a label, small parts)
    blr /= 25.0; float dog = length(mid.rgb - blr.rgb) + abs(mid.a - blr.a) * 0.5;   // the wash against its blur
    vec4 a1 = shadeAt(uvw + vec2(1.5, 0.0) * d), a2 = shadeAt(uvw - vec2(1.5, 0.0) * d), a3 = shadeAt(uvw + vec2(0.0, 1.5) * d), a4 = shadeAt(uvw - vec2(0.0, 1.5) * d);
    float ce = length(a1.rgb * a1.a - a2.rgb * a2.a) + length(a3.rgb * a3.a - a4.rgb * a4.a), ae = abs(a1.a - a2.a) + abs(a3.a - a4.a);
    float ink = max(smoothstep(0.25, 0.65, ce) * 0.38, smoothstep(0.35, 1.0, ae) * 0.6) * (0.55 + 0.6 * n1.z);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, 1.08);
    col *= 1.0 + (n1.w - 0.5) * 0.10 * (1.0 - lum) + (n2.x - 0.5) * 0.03;
    col *= 1.0 - smoothstep(0.08, 0.5, ce) * 0.10;
    col *= 1.0 - 0.26 * smoothstep(0.03, 0.22, dog);                                  // pigment gathered at the wash's edge
    col *= 1.0 - 0.14 * (1.0 - n2.z) * (1.0 - lum);                                   // granulation: in the paper's valleys, the darker the more
    col = mix(col, col * col * 1.06 + 0.02, 0.10 + 0.1 * n2.y);   // wet-in-wet blotches
    col = mix(col, vec3(0.24, 0.17, 0.11), ink * 0.55);            // brown ink line
    col *= 0.96 + n2.z * 0.07;                                     // paper texture
    a *= mix(1.0, smoothstep(0.32, 0.62, n2.z + a * 0.45), smoothstep(0.15, 0.6, ae) * (1.0 - smoothstep(0.85, 1.0, a)));   // a dry brush's broken edge
    return vec4(col, max(a, ink * 0.5 * step(0.05, max(max(a1.a, a2.a), max(a3.a, a4.a)))));   // (the ink may run just past the edge)
  }`;
// the uniforms PAINT_GLSL reads, and their values for a target of w x h device pixels on a canvas of W x H
function paintUniforms() { return { tN1: { value: POST.n1.texture }, tN2: { value: POST.n2.texture }, uCanvas: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2(1, 1) }, uStep: { value: 1 } }; }
function setPaint(u, rt, W, H) {
  u.uCanvas.value.set(W, H); u.uTexel.value.set(1 / rt.width, 1 / rt.height);
  u.uStep.value = 1.875 * H / 1000;   // the picture's strokes (radius 3 at 1.25 px a step, per 1000 px of height), as radius 2 here, in device pixels
}
/* ---------------------------------------------------------------- views
   The camera moves between views: home (the painting's framing, cropped like a cover background; it holds still
   under the pointer), one view per shelf section (the section on the right of the screen, its card on the left) and
   an overview of the research bookcase. A view is { pos, tgt, fov, shift }; shift slides the image sideways (lens
   shift).                                                                                                       */
const STATE = { paint: true, frame: false };
const V3 = THREE.Vector3;
const CAM = { cur: null, from: null, to: null, k: 1, dur: 1.3 };
function homeView() {
  const s = Math.max(innerWidth / REF.w, innerHeight / REF.h), ch = innerHeight / s;
  const dir = new V3((REF.w / 2 - REF.px) / REF.f, -(REF.h / 2 - REF.py) / REF.f, -1);
  return { pos: REF.eye.clone(), tgt: REF.eye.clone().add(dir), fov: 2 * Math.atan(ch / 2 / REF.f) * 180 / Math.PI, shift: 0 };
}
function lerpView(a, b, k) {
  return { pos: a.pos.clone().lerp(b.pos, k), tgt: a.tgt.clone().lerp(b.tgt, k), fov: a.fov + (b.fov - a.fov) * k, shift: a.shift + (b.shift - a.shift) * k };
}
function applyView(v) {
  const W = innerWidth, H = innerHeight;
  camera.position.copy(v.pos);
  camera.fov = v.fov; camera.aspect = W / H; camera.up.set(0, 1, 0); camera.lookAt(v.tgt);
  if (Math.abs(v.shift) > 1e-4) camera.setViewOffset(W, H, -v.shift * W, 0, W, H); else camera.clearViewOffset();
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
function goView(v, dur = 1.3) {
  CAM.from = CAM.cur; CAM.to = v; CAM.k = 0; CAM.dur = reduceMotion ? 0.001 : dur; setNeeds(true);
}
function stepCam(dt) {
  let moving = false;
  if (CAM.k < 1) { CAM.k = Math.min(1, CAM.k + dt / CAM.dur); const k = CAM.k, e = k * k * k * (k * (k * 6 - 15) + 10); CAM.cur = lerpView(CAM.from, CAM.to, e); moving = true; }
  if (moving) applyView(CAM.cur);
  return moving;
}
function applyRefCamera() { CAM.cur = homeView(); CAM.k = 1; applyView(CAM.cur); }
function resize() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(innerWidth, innerHeight, false);   // device pixels (the sharp layer)
  const rw = Math.max(1, Math.round(w * RT_SCALE)), rh = Math.max(1, Math.round(h * RT_SCALE));
  POST.rt.setSize(rw, rh); POST.tone.setSize(rw, rh);                                                              // the scene, at 80 %
  POST.out.setSize(w, h); POST.mat.uniforms.res.value.set(w, h); bakePaper(w, h);                                  // the watercolour, at CSS px
  placeMoon();
}
/* ---------------------------------------------------------------- main
   The room first: all its first picture shows (G, 17/10/2026: "phòng trước, sau đó mới đến cây, rồi mới đến trời"). The
   wood is painted in workers meanwhile and the models download; the garden and the sky's dome are built after that
   picture (buildGarden, called from loop.js), each part let in when it is ready.                                    */
let A = null, booksMesh, motes;
async function main() {
  const bufP = getLibBuffer(); bufP.catch(() => {});   // the models download while the room is built
  const texP = buildTextures();   // (the wood, painted in workers: materials.js)
  buildMaterials();
  buildRoom();
  BOOK.atlas = buildSpineAtlas(); buildShelves(); booksMesh = buildBookInstances(); paintLightly(booksMesh, 0.1); await tick();   // (the shelves' books: 10 % less watercolour, G, 17/10/2026)
  buildLights(); buildPost();
  A = await loadAssets(await bufP); await tick();
  await buildFurniture(A); await tick(); buildDecor(A); motes = dust(); await tick();
  // interior materials ignore fog
  scene.fog = new THREE.FogExp2(0xd6e2e6, 0.03);   // a light blue haze over the far trees, matching the sky
  room.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.fog = false); });
  buildGlass();   // (the panes' glass: the room is first seen in it once the garden and the sky are in, loop.js)
  await texP;
}
// after the room's first picture: the garden (its trees built in code, the lawn, the shrubs, the far woods) and the
// sky's dome, hidden until they are let in (loop.js: reveal). Of all that is built only the shelves, their books and
// the decor draw from the room's random sequence before the garden does (utils.js rand), and they are built in main:
// so the garden still stands where it always has.
async function buildGarden() {
  const trees = await makeTrees(); await tick();
  // they sway as the GLB trees did: the sway grows with the square of the height in model units, and those models were
  // drawn at scales 0.82, 23 and 0.024, so the same motion in metres takes the inverse
  for (const [k, t] of Object.entries(trees)) for (const p of t.parts) { windify(p.material, p.leaf, { windScale: 1 / { A: 0.82, B: 23, C: 0.024 }[k] }); p.material.fog = true; }
  A.trees = trees; buildOutside(A);
}
async function getLibBuffer() {   // the models: inline (base64) in the one-file build, a file next to the page on GitHub Pages
  const el = document.getElementById('lib-glb');
  if (el && el.dataset.src) { const r = await fetch(el.dataset.src); if (!r.ok) throw new Error('lib.glb ' + r.status); return r.arrayBuffer(); }
  if (el && el.textContent.trim().length > 100) return (await fetch('data:application/octet-stream;base64,' + el.textContent.trim())).arrayBuffer();
  throw new Error('missing #lib-glb data');
}
/* ---------------------------------------------------------------- night
   By night the sun is gone, the sky and the forest turn deep blue (stars), window light turns to moonlight, and the
   reading lamps plus the ceiling downlights (as in the night painting) carry the room. When it falls and how is the
   hour's business (below).                                                                                      */
const NIGHT = { u: { value: 0 }, day: null, spots: [] };
const NC = { hemi: new THREE.Color(0x2b3a5e), hemiG: new THREE.Color(0x2a1e14), win: new THREE.Color(0x56699a), fog: new THREE.Color(0x0e1522), ring: new THREE.Color(0x172129), disc: new THREE.Color(0xfff0d2) };
const lerp = (a, b, k) => a + (b - a) * k;
function buildNightLights() {
  // recessed ceiling downlights, on by night. Kept away from the glass and fairly narrow: without shadows their light would
  // otherwise spill onto the shrubs outside. Over the sofa and the floor they shine straight down; along the tall shelf
  // they lean onto the books (wall-washers), so its rows still read in the dark.
  const DL = [[0.25, -7.0, 0, 0.58, 1.25], [1.65, -7.0, 0, 0.58, 1.25], [0.7, -3.9, 0, 0.58, 1.25], [0.45, -1.5, 0, 0.55, 1.1],
    ...[-7.5, -5.4, -3.3, -1.2].map(z => [R.xS - 0.62, z, 1, 0.5, 0.95])];
  for (const [x, z, wash, angle, k] of DL) {
    const sp = new THREE.SpotLight(0xffd6a0, 0, 9, angle, 0.85, 2); sp.position.set(x, R.H - 0.03, z);
    if (wash) sp.target.position.set(R.xS, 2.4, z + 0.2); else sp.target.position.set(x + 0.05, 0, z + 0.25);
    scene.add(sp, sp.target);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24), new THREE.MeshBasicMaterial({ color: 0x1a1612, fog: false })); disc.rotation.x = Math.PI / 2; disc.position.set(x, R.H - 0.004, z); room.add(disc);
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.092, 24), new THREE.MeshStandardMaterial({ color: 0x8a7a66, metalness: .6, roughness: .4, fog: false })); rim.rotation.x = Math.PI / 2; rim.position.set(x, R.H - 0.005, z); room.add(rim);
    NIGHT.spots.push({ sp, disc, k });
  }
  const L = LIGHTS;
  NIGHT.day = { sun: L.sun.intensity, sunC: L.sun.color.clone(), sunT: L.sun.target.position.clone(), hemi: L.hemi.intensity, hemiC: L.hemi.color.clone(), hemiG: L.hemi.groundColor.clone(), rects: L.rects.map(r => [r.intensity, r.color.clone()]),
    env: scene.environmentIntensity, fog: scene.fog.color.clone(), ring: L.ring ? L.ring.material.color.clone() : null,
    table: L.table.userData.light.intensity, tableGlow: L.table.userData.glow.material.opacity, floor: L.floor.userData.light.intensity, floorPt: L.floor.userData.pt.intensity,
    floorGlow: L.floor.userData.glow.material.opacity, shade: MAT.shade.emissiveIntensity, exposure: POST.mat.uniforms.exposure.value, lift: POST.mat.uniforms.lift.value, veil: POST.mat.uniforms.veil.value };
}
/* ---------------------------------------------------------------- the hour
   The room's light follows the visitor's clock through the day instead of switching at dusk. What it rests on:
   - Where the sun is: where the visitor's clock says they are, as the page works it out (src/sun: window.HL_SUN; G,
     17/10/2026: "cho mặt trời mọc và mặt trời lặn depend on local time"): NOAA's solar equations at their time zone's
     principal city, at Pleiku (13.98° N, 108.0° E) for a clock on Vietnam's time, the sun as it is seen (lifted by the
     air's refraction). So it rises and sets in the room when it does there, and the room's dark comes in the same
     minute as the page's. The room is turned so that its left glass looks west-south-west: an October afternoon sun (~15:15, 30° up) comes in as in the painting;
     in the morning the sun stands behind the shelf wall, at noon high over the front glass.
   - Sunlight crosses more air as the sun sinks (air mass, Kasten & Young 1989) and loses blue first: per air mass the
     optical depth is ~0.17 red, ~0.25 green, ~0.41 blue (Rayleigh scattering plus haze). So the light is white-gold
     high up, gold under ~10°, orange at 5°, red at the horizon, and weaker; it goes out as the sun reaches the trees.
   - Skylight falls with the sun (here as sin(elevation)^0.35); the window facing the sun is the brightest one.
   - Twilight: civil (0 to −6°) brings an orange band on the sun's side under a sky turning violet, then deep blue
     (the blue hour, around −4°); in nautical twilight (−6 to −12°) the stars come out and the night look takes over.
   - The lamps come on as the daylight goes (sun from 6° to −4°), as someone reading there would switch them on.
   - The weather (fx/rain.js WX.ov, from the live weather where the visitor is): under an overcast or in rain the sun goes behind
     the cloud (no direct light, no shadows, no golden hour), the skylight dims a little and turns grey, the sky dome is
     one grey layer and the rain's haze takes the far trees.
   The page's day/night switch still wins when it is used by hand: the room then goes to the painting's afternoon or
   to night (a 4 s time-lapse). `?at=17:40` in the address pins the room's clock (to preview an hour).            */
const DEG = Math.PI / 180, smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const SUN_REF = { e: 29.7, az: 245 };   // the painting's afternoon: the sun the room was lit by
const SKYU = { uSunDir: { value: new THREE.Vector3(-0.68, 0.5, 0.54) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uDay: { value: 1 }, uGlow: { value: 0 }, uWarm: { value: 0 }, uOv: { value: 0 } };
const OVC = { hemi: new THREE.Color(0xb7bdc4), win: new THREE.Color(0xc4cad0), fog: new THREE.Color(0x9da5ad) };   // an overcast's greys
const TINT = { warm: { hemi: new THREE.Color(0xffcb92), win: new THREE.Color(0xffc489), fog: new THREE.Color(0xe8c6a2), ring: new THREE.Color(0xd0ae7e) },
  blue: { hemi: new THREE.Color(0x6c74b4), win: new THREE.Color(0x7880c4), fog: new THREE.Color(0x3c4664), ring: new THREE.Color(0x2c3548) } };
const HOUR = { e: null, az: null, pin: null, moving: false, S: {}, dir: new THREE.Vector3(), refDots: null };
const sunPlace = d => window.HL_SUN.at(d);   // the sun's elevation (as seen) and azimuth (degrees; azimuth from north, clockwise) at the date d
// the direction toward the sun in the room (y up); its light leaves the scene under 2°, so it never comes from below
const sunDirAt = (e, az, v) => { const p = (az - 103.7) * DEG, el = Math.max(e, 2) * DEG; return v.set(Math.cos(el) * Math.cos(p), Math.sin(el), Math.cos(el) * Math.sin(p)); };
const airMass = e => { const z = 90 - Math.max(e, 0); return 1 / (Math.cos(z * DEG) + 0.50572 * Math.pow(96.07995 - z, -1.6364)); };
const M_REF = airMass(SUN_REF.e);
function hourState(e, S) {   // how the light stands for a sun e degrees up (0..1 weights, relative to the painting's afternoon)
  const dm = airMass(e) - M_REF;
  S.sun = Math.exp(-0.12 * dm) * smooth(-0.5, 3, e);                     // direct sunlight
  S.tg = Math.exp(-0.08 * dm); S.tb = Math.exp(-0.24 * dm);                // its green and blue, against its red
  S.amb = Math.min(1.12, Math.pow(Math.sin(Math.max(e, 2) * DEG) / Math.sin(SUN_REF.e * DEG), 0.35));   // skylight
  S.n = smooth(1, -11, e);                                                 // the night look
  S.lamps = smooth(6, -4, e);
  S.stars = smooth(-5, -12, e);
  S.warm = smooth(18, 4, e) * smooth(-3, 2, e);                            // golden hour
  S.blue = smooth(1, -4, e) * smooth(-12, -6, e);                          // blue hour
  S.skyDay = smooth(-6, 4, e); S.glow = smooth(14, 0, e) * smooth(-9, -2, e);
  return S;
}
const tint3 = (out, day, warm, blue, night, S) => out.copy(day).lerp(warm, S.warm).lerp(blue, S.blue).lerp(night, S.n);
function applyHour(e, az) {
  const L = LIGHTS, D = NIGHT.day, U = POST.mat.uniforms, S = hourState(e, HOUR.S), n = S.n, ov = WX.ov;
  if (ov > 0.001) { S.sun *= 1 - 0.95 * ov; S.amb *= 1 - 0.36 * ov; S.warm *= 1 - 0.9 * ov; S.glow *= 1 - 0.85 * ov; S.tg = S.tg + (1 - S.tg) * ov; S.tb = S.tb + (1 - S.tb) * ov;
    S.lamps = Math.max(S.lamps, 0.6 * ov); }   // (behind the cloud; on a dark rainy day the lamps are on)
  HOUR.e = e; HOUR.az = az; NIGHT.u.value = S.stars;
  FLY.u.value = smooth(3, -5, e);
  // the sun: where, what colour, how strong
  const dir = sunDirAt(e, az, TMPV.set(0, 0, 0)), moved = dir.distanceToSquared(HOUR.dir) > 1e-8; HOUR.dir.copy(dir);
  L.sun.position.copy(D.sunT).addScaledVector(dir, 12.5);
  L.sun.color.setRGB(D.sunC.r, Math.min(1, D.sunC.g * S.tg), Math.min(1, D.sunC.b * S.tb));
  const sunWas = L.sun.visible; L.sun.intensity = D.sun * S.sun; L.sun.visible = L.sun.intensity > 0.003;
  if (L.sun.visible && (!sunWas || moved)) setShadowsDirty(true);
  // skylight: the sky dome, the hemisphere and the windows (the one facing the sun brighter)
  SKYU.uSunDir.value.copy(dir); SKYU.uSunCol.value.setRGB(L.sun.color.r / D.sunC.r, L.sun.color.g / D.sunC.g, L.sun.color.b / D.sunC.b);
  SKYU.uDay.value = S.skyDay; SKYU.uGlow.value = S.glow; SKYU.uWarm.value = S.warm; SKYU.uOv.value = ov;
  const amb = S.amb, full = n >= 0.999;
  L.hemi.intensity = lerp(D.hemi * amb, 0.15, n); tint3(L.hemi.color, D.hemiC, TINT.warm.hemi, TINT.blue.hemi, NC.hemi, S); L.hemi.groundColor.lerpColors(D.hemiG, NC.hemiG, n);
  if (ov > 0.001) L.hemi.color.lerp(OVC.hemi, 0.6 * ov * (1 - n));
  const NRM = [[-1, 0], [0, -1], [0, 1]], side = (k, x, z) => Math.max(0, NRM[k][0] * x + NRM[k][1] * z);   // left, back, front glass
  if (!HOUR.refDots) { const r = sunDirAt(SUN_REF.e, SUN_REF.az, new THREE.Vector3()); HOUR.refDots = NRM.map((_, k) => 1 + 0.35 * side(k, r.x, r.z)); }
  L.rects.forEach((r, k) => {
    const face = (1 + 0.35 * side(k, dir.x, dir.z) * S.sun) / HOUR.refDots[k];
    r.intensity = D.rects[k][0] * lerp(amb * face, 0.22, n); tint3(r.color, D.rects[k][1], TINT.warm.win, TINT.blue.win, NC.win, S); r.visible = !full;
    if (ov > 0.001) r.color.lerp(OVC.win, 0.55 * ov * (1 - n));
  });
  scene.environmentIntensity = lerp(D.env * amb, 0.09, n) + (full ? 0.02 : 0);
  tint3(scene.fog.color, D.fog, TINT.warm.fog, TINT.blue.fog, NC.fog, S);
  if (ov > 0.001) scene.fog.color.lerp(_ovf.copy(OVC.fog).multiplyScalar(lerp(1, 0.18, n)), 0.5 * ov);
  scene.fog.density = 0.03 * (1 + 0.45 * WX.k);   // (the rain's haze)
  if (L.ring && D.ring) { tint3(L.ring.material.color, D.ring, TINT.warm.ring, TINT.blue.ring, NC.ring, S); L.ring.material.color.multiplyScalar(lerp(0.55 + 0.45 * Math.min(amb, 1), 1, n)); }
  // the lamps
  const k = S.lamps;
  L.table.userData.light.intensity = lerp(D.table, 7, k); L.table.userData.glow.material.opacity = lerp(D.tableGlow, 0.9, k);
  L.floor.userData.light.intensity = lerp(D.floor, 32, k); L.floor.userData.pt.intensity = lerp(D.floorPt, 5, k); L.floor.userData.glow.material.opacity = lerp(D.floorGlow, 0.95, k);
  MAT.shade.emissiveIntensity = lerp(D.shade, 2.4, k);
  if (L.pendant) {   // the bulb over the sofa: off by day, on with the lamps (its spot shown and hidden with the downlights, so the shaders change once)
    const P = L.pendant.userData; P.light.intensity = 40 * k; P.light.visible = k > 0.001; P.glow.material.opacity = 0.45 * k;
    P.coil.material.emissiveIntensity = 9 * k; P.glass.emissiveIntensity = 0.35 * k;
  }
  for (const sp of NIGHT.spots) { sp.sp.intensity = 55 * sp.k * k; sp.sp.visible = k > 0.001; sp.disc.material.color.setRGB(0.1, 0.086, 0.07).lerp(NC.disc, k); }
  // the eye opens a little as the light goes
  petsForHour(S);
  U.exposure.value = lerp(D.exposure * (1 + 0.25 * (1 - Math.min(amb, 1))), 1.0, n); U.lift.value = lerp(D.lift, 0.96, n); U.veil.value = lerp(D.veil, 0.07, n);
}
const TMPV = new THREE.Vector3(), _ovf = new THREE.Color();
function hourTarget() {   // where the light should be: the sun of the clock, or the page's switch when it was used by hand
  if (HOUR.pin) return sunPlace(HOUR.pin);
  const d = new Date(), clockDark = !window.HL_SUN.isDay(d);   // the page's own rule (sunset to sunrise where the visitor is)
  const dark = body.classList.contains('dark-mode');
  if (dark === clockDark) return sunPlace(d);
  return dark ? { e: -20, az: 290 } : SUN_REF;
}
function stepHour(dt) {   // the light toward the hour: at once when it creeps, as a 4 s time-lapse when it jumps; true while moving
  const t = hourTarget();
  const de = t.e - HOUR.e, da = ((t.az - HOUR.az + 540) % 360) - 180;
  // the sun creeps ~0.25° a minute: the room is redrawn for it about once a minute (steps that small do not show),
  // so a still room stays a still picture
  if (Math.abs(de) < (HOUR.moving ? 0.01 : 0.2) && Math.abs(da) < (HOUR.moving ? 0.02 : 0.4)) return HOUR.moving = false;
  const big = Math.abs(de) > 1.5 || Math.abs(da) > 4, fast = big && on && !reduceMotion;
  const e = fast ? HOUR.e + THREE.MathUtils.clamp(de, -13 * dt, 13 * dt) : t.e;
  const az = fast ? HOUR.az + THREE.MathUtils.clamp(da, -35 * dt, 35 * dt) : t.az;
  applyHour(e, (az + 360) % 360); setNeeds(true);
  return HOUR.moving = fast;
}
/* ---------------------------------------------------------------- glass
   The panes of the glass walls (G, 15/10/2026: "tạo kính, improve glass effect"), as thin glass behaves:
   - it reflects the room: a cube map of the room taken from its middle, looked up where the reflected ray leaves the
     room's box (a parallax-corrected cubemap: Lagarde & Zanuttini, "Local Image-based Lighting with Parallax-corrected
     Cubemaps", SIGGRAPH 2012), so a lamp or the shelves show in the glass about where they would, slightly softened;
   - how much by Fresnel (Schlick): 4 % looking straight through, nearly all at a glancing angle. By day the bright
     garden outshines the 4 %; by night, the garden dark, the glass turns into a dim mirror of the lit room, as windows
     do (kept at 40 % of that, so the night sky shows through: G, 15/10/2026);
   - it takes from the view behind it what it reflects (blended premultiplied: the view keeps 1 − a), and a faint green
     of the glass's own;
   - its surface is not perfectly clean: dust and smudges, more toward the bottom, haze it a little and catch light;
   - and two soft diagonal sheens cross each pane, the way glass is drawn, sliding a little as the view moves;
   - by night all of it is let go nearly (the reflection kept at an eighth, the haze and sheens at a tenth), so the night
     sky through it is clear (G, 16/10/2026).
   The cube map is taken again whenever the light changes (the hour, day to night), at most once a second; the panes
   are hidden while it is taken. They write no depth: where the sky shows through them, the stars still show. */
const GLASS = { mat: null, cube: null, cam: null, live: false, at: new THREE.Vector3((R.xL + R.xS) / 2, 1.6, (R.zB + R.zF) / 2), last: { n: -1, s: -1, x: 0, t: -1e9 } };
function glassMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uEnv: { value: GLASS.cube.texture }, uBoxMin: { value: new THREE.Vector3(R.xL, 0, R.zB) }, uBoxMax: { value: new THREE.Vector3(R.xW, R.H, R.zF) }, uCap: { value: GLASS.at }, uDay: { value: 1 } },
    vertexShader: `varying vec3 vW, vN;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform samplerCube uEnv; uniform vec3 uBoxMin, uBoxMax, uCap; uniform float uDay; varying vec3 vW, vN;
      float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec3 V = normalize(vW - cameraPosition), N = normalize(vN); if (dot(N, V) > 0.0) N = -N;
        float c = clamp(-dot(V, N), 0.0, 1.0), F = 0.04 + 0.96 * pow(1.0 - c, 5.0);
        // the room reflected: where the reflected ray leaves the room's box, seen from where the cube map was taken
        vec3 Rf = reflect(V, N), Rs = Rf + vec3(1e-5);
        vec3 tA = (uBoxMax - vW) / Rs, tB = (uBoxMin - vW) / Rs, tf = max(tA, tB); float t = max(0.0, min(min(tf.x, tf.y), tf.z));
        vec3 refl = textureCube(uEnv, vW + Rf * t - uCap, 0.8).rgb;
        // the pane's own coordinates (metres): dust and smudges, more low down
        vec2 q = abs(N.x) > 0.5 ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y);
        float sm = smoothstep(0.5, 0.95, 0.6 * gn(q * 3.1 + 7.0) + 0.4 * gn(q * 13.0)) * (0.45 + 0.55 * smoothstep(1.8, 0.25, vW.y));
        // two soft diagonal sheens across it, sliding a little with the view
        float s = fract((q.x * 0.75 + q.y) * 0.42 + dot(V, vec3(0.45, 0.2, -0.35)) * 0.45);
        float band = smoothstep(0.0, 0.04, s) * smoothstep(0.16, 0.08, s) + 0.6 * smoothstep(0.2, 0.22, s) * smoothstep(0.27, 0.25, s);
        band *= 0.6 + 0.4 * gn(q * 0.9 + 3.0);   // (not even along their length)
        // by night the glass is kept clear, so the stars and the Milky Way are seen through it as if it were not there (G,
        // 16/10/2026): its haze, smudges and sheens almost gone, the room's mirror image faint
        float clearK = mix(0.1, 1.0, uDay);
        float lit = 0.3 + 0.7 * uDay, haze = (0.012 + 0.05 * sm) * clearK, sheen = band * (0.05 + 0.07 * uDay) * clearK;
        vec3 col = refl * F * (1.0 + 0.3 * sm) * mix(0.12, 1.0, uDay) + vec3(0.93, 0.96, 0.94) * (haze + sheen) * lit + vec3(0.003, 0.007, 0.005) * clearK;   // (a smudge scatters a little more of what it reflects)
        gl_FragColor = vec4(col, clamp(F * mix(0.12, 1.0, uDay) + (haze + sheen) * 0.8 + 0.015 * clearK, 0.0, 0.7));   // (premultiplied: the view behind keeps 1 − alpha of itself)
      }`,
    transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide });
}
// once the room is built: the cube map and the panes given their glass. The room is first looked at once the garden and
// the sky are in (GLASS.live, set as the sky is let in: core/loop.js reveal), so that they are seen in it too; until then
// the panes reflect nothing (an unfilled map reads black), and the first picture waits for no extra six views
function buildGlass() {
  GLASS.cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  GLASS.cam = new THREE.CubeCamera(0.05, 120, GLASS.cube); GLASS.cam.position.copy(GLASS.at); GLASS.cam.updateMatrixWorld(true);
  GLASS.mat = glassMaterial();
  const pane = room.userData.glass; if (pane) pane.material = GLASS.mat;
}
// before the room is drawn: the room looked at again if its light has changed since (the hour, day to night)
function stepGlass(force) {
  if (!GLASS.cam) return;
  const n = NIGHT.u.value, sun = LIGHTS.sun, si = sun ? sun.intensity : 0, sx = sun ? sun.position.x + sun.position.y * 0.37 + sun.position.z * 0.11 : 0, L = GLASS.last, now = performance.now();
  GLASS.mat.uniforms.uDay.value = 1 - n;
  if (!GLASS.live) return;
  if (!force && (now - L.t < 1000 || (Math.abs(n - L.n) < 0.03 && Math.abs(si - L.s) < 0.06 * Math.max(0.3, L.s) && Math.abs(sx - L.x) < 0.3))) return;
  L.n = n; L.s = si; L.x = sx; L.t = now;
  const pane = room.userData.glass, vis = pane ? pane.visible : false; if (pane) pane.visible = false;
  GLASS.cam.update(renderer, scene);
  if (pane) pane.visible = vis;
}
/* ---------------------------------------------------------------- library interface
   Hidden Library keeps its data and its audio engine: its old cards stay in the DOM, hidden, and are driven by
   clicks. This layer reads the categories from them and makes the room the interface. Every book category and every
   research topic is a shelf section with a brass plate, a label and a leader line; a click flies the camera there and
   opens its card; the book that is playing comes off the shelf (in front of the camera while its card is open, on the
   sofa otherwise). The record player stays the page's own, in the sidebar.                                     */
const UIS = { secs: [], byId: new Map(), byCat: new Map(), hover: null, hovers: new Set(), hoverKey: '', open: null, mode: 'home', peek: null, active: null, mapBook: null, touched: new Set(), bySrc: new Map() };   // (mapBook: the atlas taken out and opened, flight.js)
/* The room is organised in two parts. Books: every category is one whole row of the tall shelf on the right wall,
   top to bottom from the row under the 2.8 m board (rows 6, 5, 4, 3 for four categories: around eye level, where the
   rows run nearly level across the screen and each label sits in its own row: G, 15/10/2026; more categories go
   above them, then below). Research: every topic
   (a sub-page of the Research group) is one bay of the low bookcase under the back glass, left to right; with more
   than three topics the bays are split into an upper and a lower half.                                          */
function bookSlot(k) { const row = [6, 5, 4, 3, 7, 8, 2][k]; return row === undefined ? null : { shelf: 'R', cols: [0, 6], rows: [row, row], pick: [3, 3], mid: 3, anchor: 2 }; }
// the books of a bay: the right two thirds of its two upper rows (the left end can sit behind the card), clear of the
// sofa and the plant; its view frames just them
function researchSlot(k, n) {
  if (n <= 3) return { shelf: 'B', cols: [k, k], rows: [2, 6], bookRows: [5, 6], bookCut: 1 / 3 };
  const bay = Math.floor(k / 2); return bay > 2 ? null : { shelf: 'B', cols: [bay, bay], rows: k % 2 ? [2, 3] : [4, 6], bookRows: k % 2 ? [2, 3] : [5, 6], bookCut: 1 / 3 };
}
const PULL = 0.27, PEEK = 0.045;               // how far a book slides out before it leaves the shelf / when its row is hovered
const offMode = () => body.classList.contains('off-mode');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function slotBox(slot) {
  if (slot.shelf === 'R') {   // a shelf row: the plate sits on the board under it, at the anchor column
    const S = SHELF.R, col = i => S.z0 + i * S.cw, za = col(slot.cols[0]), zb = col(slot.cols[1] + 1), ya = 0.1 + slot.rows[0] * S.rh, yb = 0.1 + (slot.rows[1] + 1) * S.rh;
    const zp = col(slot.anchor + 0.5), z0 = col(slot.pick[0]), z1 = col(slot.pick[1] + 1);
    return { ya, yb, w: zb - za, h: yb - ya, normal: new V3(-1, 0, 0), face: new V3(R.xS - 0.004, (ya + yb) / 2, (za + zb) / 2),
      lo: new V3(R.xS - 0.004, ya, za + 0.05), hi: new V3(R.xS - 0.004, ya, zb - 0.05),
      corners: [[ya, za], [ya, zb], [yb, zb], [yb, za]].map(([y, z]) => new V3(R.xS - 0.004, y, z)),
      back: new V3(R.xW - 0.026, (ya + yb) / 2, (za + zb) / 2), plate: new V3(R.xS - 0.004, ya, zp), tag: new V3(R.xS - 0.004, (ya + yb) / 2, zp), focus: new V3(R.xS, (ya + yb) / 2, (z0 + z1) / 2), focusW: z1 - z0, rotY: -Math.PI / 2 };
  }
  // a bay of the back bookcase: the plate sits on the top rail, above the middle of the bay
  const S = SHELF.B, xa = S.X[slot.cols[0]] + 0.03, xb = S.X[slot.cols[1] + 1] - 0.03, ya = 0.1 + slot.rows[0] * S.rh2, yb = 0.1 + (slot.rows[1] + 1) * S.rh2;
  const top = slot.rows[1] >= 6, plate = new V3((xa + xb) / 2, top ? R.caseTop - 0.0225 : yb, top ? S.zf + 0.03 : S.zf + 0.004);
  const br = slot.bookRows || slot.rows, bookY = 0.1 + (br[0] + br[1] + 1) / 2 * S.rh2;   // the middle of the rows its books stand in
  const bookX0 = xa + (xb - xa) * (slot.bookCut || 0) - 0.04, bookX1 = xb + 0.03;                    // and the stretch they take
  return { ya, yb, bookY, bookX0, bookX1, w: xb - xa, h: yb - ya, normal: new V3(0, 0, 1), face: new V3((xa + xb) / 2, (ya + yb) / 2, S.zf + 0.004),
    lo: new V3(Math.max(xa + 0.06, bookX0 + 0.06), ya + 0.06, S.zf + 0.004), hi: new V3(xb - 0.06, yb - 0.06, S.zf + 0.004),
    corners: [[0, ya - 0.012], [1, ya - 0.012], [1, yb + 0.012], [0, yb + 0.012]].map(([k, y]) => new V3(S.X[slot.cols[0] + k * (slot.cols[1] - slot.cols[0] + 1)], y, S.zf + 0.004)), back: new V3((xa + xb) / 2, (ya + yb) / 2, R.zB + 0.012), plate, tag: plate, rotY: 0 };
}
const ZOOM_OUT = 1.5;   // a shelf row is seen from 1.5x the distance that fills the free side (its spine titles still read)
function focusView(sec) {
  const b = sec.box, aspect = innerWidth / innerHeight, fov0 = 40;
  const hfov = 2 * Math.atan(Math.tan(fov0 / 2 * Math.PI / 180) * aspect), span = 2 * Math.tan(hfov / 2);
  // the free side of the screen: right of the card (sidebar + gap + card + gap) to a small margin
  const side = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 290;
  const l = Math.min(0.78, (side + 22 + Math.min(400, innerWidth - side - 44) + 34) / innerWidth), r = 1 - 30 / innerWidth, shift = (l + r) / 2 - 0.5;
  // from the distance at which the section would fill the free side; where the room is too narrow, the lens widens instead
  const back = (d0, dmax) => { const d = d0 * ZOOM_OUT; return d <= dmax ? { dist: d, fov: fov0 } : { dist: dmax, fov: 2 * Math.atan(Math.tan(fov0 / 2 * Math.PI / 180) * d / dmax) * 180 / Math.PI }; };
  if (b.focus) {   // a shelf row: stand back from the wall at the row's height, facing the cells that lend its books
    const { dist, fov } = back((b.focusW + 0.3) / ((r - l) * span), R.xS - R.xL - 0.35);
    return { pos: new V3(R.xS - dist, b.focus.y + 0.05, b.focus.z + 0.3), tgt: new V3(R.xS, b.focus.y, b.focus.z), fov, shift };
  }
  // a bay: close, the stretch of its books filling the free side, level with the rows they stand in
  const dist = THREE.MathUtils.clamp((b.bookX1 - b.bookX0 + 0.12) / ((r - l) * span), 1.3, 4.4), tgt = new V3((b.bookX0 + b.bookX1) / 2, b.bookY, b.face.z);
  const pos = tgt.clone().addScaledVector(b.normal, dist).add(new V3(0, 0.05, 0));
  pos.x = THREE.MathUtils.clamp(pos.x, R.xL + 0.3, R.xS - 0.3);
  return { pos, tgt, fov: fov0, shift };
}
function researchView() { return { pos: new V3(0.55, 1.95, -4.4), tgt: new V3(0.55, 1.8, -8.3), fov: 46, shift: 0 }; }
// the Books part of the room seen whole and near (G, 17/10/2026: "cho Research and Books có thể ấn vào và có thể close up"):
// the stretch of the tall shelf its rows take, framed with a little room round it, from as far back as the room allows
// (the lens widening where it does not)
function booksView() {
  const bs = UIS.secs.filter(s => s.group === 'books' && s.box.focus); if (!bs.length) return null;
  let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of bs) { const b = s.box; z0 = Math.min(z0, b.focus.z - b.focusW / 2); z1 = Math.max(z1, b.focus.z + b.focusW / 2); y0 = Math.min(y0, b.ya); y1 = Math.max(y1, b.yb); }
  const aspect = innerWidth / innerHeight, fov0 = 40, t = Math.tan(fov0 / 2 * Math.PI / 180), w = (z1 - z0) * 1.18 * 2.25, h = (y1 - y0) * 1.3 * 2.25;   // (50 % further out, twice: G, 17/10/2026)
  const need = Math.max(w / (2 * t * aspect), h / (2 * t)), dmax = R.xS - R.xL - 0.35, dist = Math.min(need, dmax);
  const fov = need <= dmax ? fov0 : 2 * Math.atan(t * need / dmax) * 180 / Math.PI, yc = (y0 + y1) / 2, zc = (z0 + z1) / 2;
  return { pos: new V3(R.xS - dist, yc + 0.05, zc), tgt: new V3(R.xS, yc, zc), fov, shift: 0 };
}
/* ---- the page's books in both languages, with their page counts
   The page lists its books under their Vietnamese titles (a few under their English ones). Here each also has its
   original English title (a Vietnamese book: a translation), its author and year where the page gives none, and its
   page count: the median over the work's editions on Open Library (looked up 13/10/2026), else the publisher's or a
   bookseller's listing. The spines, covers and the card follow the page's language switch; a book's thickness
   follows its pages (see spineOf), so a long book stands out on the shelf as it would. A book the page adds later
   and this table lacks keeps the page's title and the shelf book it was given. */
const BOOK_INFO = [
  // the title as the page has it, the English title (and the full one), author · year when the page lacks them, pages
  // (t: a thickness in metres where there are no pages to go by; h: a height, for a book of a larger format; cover:
  // its cover image, see BOOK_COVERS)
  { page: 'Nguyên lý Pareto: 80/20', en: 'The 80/20 Principle', full: 'The 80/20 Principle: The Secret to Achieving More with Less', by: 'Richard Koch · 1997', pages: 283, cover: '80-20-principle' },
  { page: 'Lịch Sử Mô Hình DISC. Từ Lý Thuyết Đến Ứng Dụng', en: 'The DISC Model: From Theory to Practice', pages: null, t: 0.012 },   // a talk: no printed edition found; a slim booklet
  { page: '"Damn Right!" Bí Ẩn Charlie Munger', en: 'Damn Right!', full: 'Damn Right! Behind the Scenes with Berkshire Hathaway Billionaire Charlie Munger', pages: 304, cover: 'damn-right' },
  { page: 'Paths to Wealth Through Common Stocks', en: 'Paths to Wealth Through Common Stocks', pages: 214, cover: 'paths-to-wealth' },
  { page: 'Money Masters of Our Time', en: 'Money Masters of Our Time', pages: 400, cover: 'money-masters' },
  { page: "The Innovator's Dilemma", en: "The Innovator's Dilemma", full: "The Innovator's Dilemma: When New Technologies Cause Great Firms to Fail", pages: 286, cover: 'innovators-dilemma' },
  { page: 'Phong cách NVIDIA: Chiến lược và Văn hóa dẫn đầu AI', en: 'The Nvidia Way', full: 'The Nvidia Way: Jensen Huang and the Making of a Tech Giant', by: 'Tae Kim · 2024', pages: 272, cover: 'nvidia-way' },   // W. W. Norton
  { page: 'A. Charlie Munger: Poor Charlie’s Almanack Tư Duy Đa Chiều', en: "Poor Charlie's Almanack", full: "Poor Charlie's Almanack: The Wit and Wisdom of Charles T. Munger", by: 'Charles T. Munger, ed. Peter D. Kaufman · 2005', pages: 512, h: 0.31, cover: 'poor-charlies-almanack' },   // a large-format book
  { page: 'Khuyến Học', en: 'An Encouragement of Learning', pages: 192, cover: 'encouragement-of-learning' },   // Fukuzawa's Gakumon no susume, tr. David A. Dilworth
  { page: 'Động lực và Nhân cách', en: 'Motivation and Personality', pages: 400, cover: 'motivation-and-personality' },
  { page: 'Phi Lý Trí', en: 'Predictably Irrational', full: 'Predictably Irrational: The Hidden Forces That Shape Our Decisions', pages: 368, cover: 'predictably-irrational' },
  { page: 'Tâm lý học Hài hước', en: 'Quirkology', full: 'Quirkology: How We Discover the Big Truths in Small Things', pages: 322, cover: 'quirkology' },
  { page: 'Tư duy như một kẻ lập dị', en: 'Think Like a Freak', pages: 274, cover: 'think-like-a-freak' },
  { page: 'Khi nào cướp nhà băng', en: 'When to Rob a Bank', full: 'When to Rob a Bank: …And 131 More Warped Suggestions and Well-Intended Rants', pages: 400, cover: 'when-to-rob-a-bank' },
  { page: 'Quy Luật Bản Chất Con Người', en: 'The Laws of Human Nature', pages: 617, cover: 'laws-of-human-nature' },
  { page: 'Tâm lý học về tiền', en: 'The Psychology of Money', full: 'The Psychology of Money: Timeless Lessons on Wealth, Greed, and Happiness', pages: 288, cover: 'psychology-of-money' },
  { page: 'Think Again', en: 'Think Again', full: "Think Again: The Power of Knowing What You Don't Know", pages: 320, cover: 'think-again' },
  // a heading on the page with the page's notes on five economies under it: a book of them, read in the room (ui/leaves.js:
  // G, 17/10/2026), of a reference book's format
  { page: '[Mô hình kinh tế]', en: '[Economic models]', pages: null, read: true, t: 0.028, h: 0.275, d: 0.18 },
  { page: 'Súng, Vi Trùng và Thép', en: 'Guns, Germs, and Steel', full: 'Guns, Germs, and Steel: The Fates of Human Societies', pages: 528, cover: 'guns-germs-and-steel' },
  { page: 'Sự giàu có và nghèo đói của các Quốc gia', en: 'The Wealth and Poverty of Nations', full: 'The Wealth and Poverty of Nations: Why Some Are So Rich and Some So Poor', pages: 650, cover: 'wealth-and-poverty-of-nations' },
  { page: 'Những Tù Nhân Của Địa Lý', en: 'Prisoners of Geography', full: 'Prisoners of Geography: Ten Maps That Explain Everything About the World', pages: 291, cover: 'prisoners-of-geography' },
  { page: 'Quốc Gia Thăng Trầm', en: 'The Rise and Fall of Nations', full: 'The Rise and Fall of Nations: Forces of Change in the Post-Crisis World', pages: 466, cover: 'rise-and-fall-of-nations' },
  { page: 'Trò chơi quyền lực', en: 'The Power Game', full: 'The Power Game: The Past, Present and Future of the World Order', pages: 370, cover: 'power-game' },   // Omega+ 2024 (no English edition)
  { page: 'Người thợ đồng hồ mù', en: 'The Blind Watchmaker', pages: 368, cover: 'blind-watchmaker' },
  { page: 'Lược Sử Thời Gian', en: 'A Brief History of Time', pages: 241, cover: 'brief-history-of-time' },
  { page: 'Deep Simplicity', en: 'Deep Simplicity', full: 'Deep Simplicity: Bringing Order to Chaos and Complexity', pages: 304, cover: 'deep-simplicity' },
  // the Geography topic's two pages, as atlases of one format: taken out, one opens on its map (ui/atlas.js), and the
  // map leads to the page (G, 16/10/2026)
  { page: 'Việt Nam', en: 'Vietnam', map: 'vn', t: 0.034, h: 0.3 },
  { page: 'Phú Quốc', en: 'Phú Quốc', map: 'phuquoc', t: 0.034, h: 0.3 },
];
const isMapItem = it => { const b = bookInfo(it); return !!(b && b.map && it.href); };
// a book of the page's notes (its chips open dialogs): taken out, it opens on its contents and its leaves turn (ui/leaves.js)
const isReadItem = it => { const b = bookInfo(it); return !!(b && b.read && it.chips && it.chips.some(c => c.el && c.el.dataset && c.el.dataset.dialog)); };
const opensFlat = it => isMapItem(it) || isReadItem(it);   // (taken out, it opens in front of the camera)
const bookKey = s => String(s || '').normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
const BOOK_BY_TITLE = new Map(BOOK_INFO.map(b => [bookKey(b.page), b]));
const bookInfo = it => (it && BOOK_BY_TITLE.get(bookKey(it.title))) || null;
const pageLang = () => document.documentElement.getAttribute('data-lang') === 'vi' ? 'vi' : 'en';
// the title in a language: Vietnamese as the page writes it, English from the table (else the page's)
const titleIn = (it, lang = pageLang()) => { const b = bookInfo(it); return lang === 'en' && b ? b.en : it.title; };
// as printed on a spine, a cover or a title page: without the brackets the page marks a heading with
const printTitle = (it, lang) => titleIn(it, lang).replace(/^\[(.+)\]$/, '$1');
// the page's author · year, or the table's where the page has none (or only the year)
const byOf = it => { const b = bookInfo(it); return b && b.by && (!it.by || /^\d{3,4}$/.test(it.by.trim())) ? b.by : it.by || ''; };
// a book's cover, where there is one: the original English edition's, from Open Library (The Nvidia Way's from its
// publisher, Trò chơi quyền lực's, the Vietnamese edition's, from Goodreads; tools/covers/make.py; the covers are their
// publishers'). The page carries where each is (#book-covers: a file next to the page on GitHub Pages,
// the image itself in the one-file build)
const BOOK_COVERS = (() => { try { return JSON.parse(document.getElementById('book-covers').textContent); } catch (e) { return {}; } })();
const coverOf = it => { const b = bookInfo(it); return (b && b.cover && BOOK_COVERS[b.cover]) || null; };
// the cover pictures' shapes (width over height, of src/covers): a book with a cover is made the shape of its cover (the
// board as wide as the picture is for the book's height), so the picture covers its board (G, 17/10/2026)
const COVER_AR = { '80-20-principle': 0.66, 'blind-watchmaker': 0.647, 'brief-history-of-time': 0.653, 'damn-right': 0.676, 'deep-simplicity': 0.662, 'encouragement-of-learning': 0.674, 'guns-germs-and-steel': 0.633, 'innovators-dilemma': 0.658, 'laws-of-human-nature': 0.662, 'money-masters': 0.651, 'motivation-and-personality': 0.629, 'nvidia-way': 0.66, 'paths-to-wealth': 0.649, 'poor-charlies-almanack': 0.968, 'power-game': 0.671, 'predictably-irrational': 0.658, 'prisoners-of-geography': 0.667, 'psychology-of-money': 0.638, 'quirkology': 0.622, 'rise-and-fall-of-nations': 0.664, 'think-again': 0.662, 'think-like-a-freak': 0.616, 'wealth-and-poverty-of-nations': 0.647, 'when-to-rob-a-bank': 0.658 };
const coverAr = it => { const b = bookInfo(it); return b && b.cover && COVER_AR[b.cover] || 0; };
// a book's thickness from its pages: ~0.06 mm a page (about 420 pages to the inch, common book paper) and ~4 mm of covers
const spineOf = pages => 0.004 + pages * 0.00006;
/* ---- categories and items, read from the page's own (hidden) cards */
function readCategories() {
  return [...document.querySelectorAll('#pages .page .cat')].map(el => {
    const page = el.closest('.page'), head = el.querySelector('.cat-head .swap');
    return { id: el.dataset.cat, el, page: page ? page.dataset.page : '', group: page && page.dataset.page === 'books' ? 'books' : 'research',
      en: (head && head.querySelector('.en') ? head.querySelector('.en').textContent : el.dataset.cat).trim(),
      vi: (head && head.querySelector('.vi') ? head.querySelector('.vi').textContent : '').trim(),
      count: +((el.querySelector('.count') || {}).textContent || 0) };
  });
}
/* a book category is a section on its own; a research topic gathers the categories of its sub-page */
function readSections() {
  const cats = readCategories(), secs = cats.filter(c => c.group === 'books').map(c => ({ id: c.id, group: 'books', en: c.en, vi: c.vi, count: c.count, cats: [c] }));
  const pages = [];
  for (const c of cats.filter(c => c.group === 'research')) { let p = pages.find(q => q.id === c.page); if (!p) pages.push(p = { id: c.page, cats: [] }); p.cats.push(c); }
  for (const p of pages) {
    const h = document.querySelector(`.toc-sub[data-sub="${CSS.escape(p.id)}"] .toc-sub-h`) || document.querySelector(`.subtab[data-goto="${CSS.escape(p.id)}"]`);
    const txt = cls => { const n = h && h.querySelector('.' + cls); return n ? n.textContent.trim() : ''; };
    const pg = document.querySelector(`#pages .page[data-page="${CSS.escape(p.id)}"]`), en = txt('en') || (pg && pg.getAttribute('aria-label')) || p.id;
    secs.push({ id: p.id, group: 'research', en, vi: txt('vi') || en, count: p.cats.reduce((n, c) => n + c.count, 0), cats: p.cats });
  }
  return secs;
}
function readItems(sec) {
  const out = [];
  for (const c of sec.cats) {
    if (sec.group === 'research') out.push({ head: true, cat: c.id, en: c.en, vi: c.vi || c.en, count: c.count });
    for (const li of c.el.querySelectorAll('.items > li')) {
      if (li.classList.contains('sep')) { out.push({ sep: true }); continue; }
      const t = li.querySelector('.t'), a = t && t.querySelector('a[href]'), byEl = t && t.querySelector('.by');
      const tc = t ? t.cloneNode(true) : null; if (tc) tc.querySelectorAll('.by, svg').forEach(n => n.remove());
      out.push({ li, src: li.dataset.src || '', title: li.dataset.title || (tc ? tc.textContent.trim() : ''), href: a ? a.getAttribute('href') : '',
        by: byEl ? byEl.textContent.trim() : '', bold: !!(t && t.classList.contains('t-bold')),
        chips: [...li.querySelectorAll('.extras .chip')].map(ch => ({ el: ch, label: ch.textContent.trim(), href: ch.getAttribute('href') || '' })) });
    }
  }
  return out;
}

/* ---- the 3D side of a section: hit area, glow, brass plate, and the books its items will take off the shelf */
function gatherBooks(slot, cols) {
  const cand = [], rows = slot.bookRows || slot.rows;
  BOOK.list.forEach((b, idx) => {
    const cl = b.cell; if (!cl || !b.up || b.lean || cl.shelf !== slot.shelf) return;
    if (cl.i < cols[0] || cl.i > cols[1] || cl.j < rows[0] || cl.j > rows[1]) return;
    const t = new V3().setFromMatrixColumn(b.m, 0).length(), h = new V3().setFromMatrixColumn(b.m, 1).length(), d = new V3().setFromMatrixColumn(b.m, 2).length();
    // the tall shelf's books take the thickness of their pages anyway, so any upright book will do there: more of them in
    // a cell, fewer cells to a section, a closer view and wider spines
    if (t < (slot.shelf === 'R' ? 0.012 : 0.022) || h < 0.2) return;
    const p = new V3().setFromMatrixPosition(b.m);
    if (slot.bookCut) { const xa = SHELF.B.X[cols[0]], xb = SHELF.B.X[cols[1] + 1]; if (p.x < xa + (xb - xa) * slot.bookCut) return; }
    cand.push({ idx, t, h, d, key: -cl.j * 100 + (slot.shelf === 'R' ? p.z : p.x) });
  });
  return cand.sort((a, b) => a.key - b.key);
}
function glowTexture(w, h) {   // the light on a chosen section: soft edges, a little stronger under the board above
  const W = w > h ? 512 : 128, H = Math.max(24, Math.round(W * h / w)), c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H);
  const fx = Math.min(W * 0.08, H * 0.6), fy = Math.min(H * 0.18, 18), ss = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = ss(Math.min(x + 0.5, W - x - 0.5) / fx) * ss(Math.min(y + 0.5, H - y - 0.5) / fy), a = e * (0.7 + 0.3 * (1 - y / H)), i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0); return ctex(c, { rep: false });
}
const BOOK_BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, -0.5), HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
function buildSections() {
  const all = readSections(), nRes = all.filter(s => s.group === 'research').length, used = { books: 0, research: 0 };
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xb38b4c, metalness: 0.85, roughness: 0.35, fog: false });
  for (const s0 of all) {
    const k = used[s0.group]++, slot = s0.group === 'books' ? bookSlot(k) : researchSlot(k, nRes); if (!slot) continue;
    const sec = { ...s0, slot, glow: 0, glowT: 0, books: [] }; sec.items = readItems(sec);
    // books of this section, one per item (its title on the spine): upright, not leaning, thick enough to read a spine,
    // spread evenly. A row lends the books of the narrowest run of cells that holds enough of them (ornament cells hold
    // none), the run nearest its middle column; the camera frames that run.
    const items = sec.items.filter(it => !it.sep && !it.head);
    let cand = gatherBooks(slot, slot.cols);
    if (slot.pick) {
      const per = []; for (let c = slot.cols[0]; c <= slot.cols[1]; c++) per[c] = gatherBooks(slot, [c, c]);
      const need = Math.max(items.length + 1, 3); let best = null;
      for (let w = 1; w <= slot.cols[1] - slot.cols[0] + 1 && !best; w++) for (let a = slot.cols[0]; a + w - 1 <= slot.cols[1]; a++) {
        const b = a + w - 1; if (!per[a].length || !per[b].length) continue;
        let n = 0; for (let c = a; c <= b; c++) n += per[c].length;
        const off = Math.abs((a + b) / 2 - slot.mid); if (n >= need && (!best || off < best.off)) best = { a, b, off };
      }
      if (best) { slot.pick = [best.a, best.b]; cand = gatherBooks(slot, slot.pick); }
    }
    const box = slotBox(slot); sec.box = box;
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(box.w, box.h), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(box.face); hit.rotation.y = box.rotY; hit.userData.sec = sec; room.add(hit); sec.hit = hit;
    const gm = new THREE.MeshBasicMaterial({ color: 0xffe3ad, map: glowTexture(box.w, box.h), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    // the chosen section lights up at the back of its cells, so the books in front keep their colours
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(box.w - 0.02, box.h - 0.02), gm); glow.position.copy(box.back); glow.rotation.y = box.rotY; glow.renderOrder = 3; room.add(glow); sec.glowMesh = glow;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.024, 0.006), plateMat); plate.position.copy(box.plate).addScaledVector(box.normal, 0.004); plate.rotation.y = box.rotY; room.add(plate);
    // the widest spines read best: of the books on offer take the thickest ones, keeping their order on the shelf
    // (on the tall shelf a category's books stand together, the run of books in the middle of its cells: they take the
    // thickness of their pages, and the camera comes as close as that run allows)
    const together = slot.shelf === 'R', first = Math.max(0, Math.floor((cand.length - items.length) / 2));
    if (!together && cand.length > items.length) { const keep = new Set([...cand].sort((a, b) => b.t - a.t).slice(0, items.length)); cand = cand.filter(c => keep.has(c)); }
    items.forEach((it, k) => {
      const c0 = together ? cand[first + k] : cand[Math.floor((k + 0.5) * cand.length / items.length)]; if (!c0) return;
      const bl = BOOK.list[c0.idx], hsl = {}; bl.c.getHSL(hsl, THREE.SRGBColorSpace);
      if (hsl.l < 0.45) {   // a book that will be read in front of the camera is never a very dark one (lifted on the shelf too)
        bl.c.setHSL(hsl.h, Math.min(hsl.s, 0.5), 0.45, THREE.SRGBColorSpace); booksMesh.setColorAt(c0.idx, bl.c); booksMesh.instanceColor.needsUpdate = true;
      }
      const bk = { sec, it, idx: c0.idx, m0: bl.m.clone(), color: bl.c.clone(), t: c0.t, h: c0.h, d: c0.d, out: false, slide: 0, hero: null, pose: null, goal: null, fk: 1 };
      bk.normal = box.normal.clone(); it.book = bk; sec.books.push(bk); if (it.src) UIS.bySrc.set(it.src, bk);
      // an invisible box over the shelf book: the pointer finds it to select its row in the card, a click plays it
      const hit = new THREE.Mesh(BOOK_BOX, HIDDEN); hit.matrixAutoUpdate = false; hit.matrix.copy(bk.m0); hit.userData.book = bk; booksMesh.parent.add(hit); bk.hit = hit;
    });
    // each book of the page takes the thickness of its pages (and a book's height): its cells are packed again
    const byCell = new Map(), keep = new Set(sec.books.map(bk => bk.idx));
    for (const bk of sec.books) {
      const info = bookInfo(bk.it), cl = BOOK.list[bk.idx].cell; if (!info || !(info.pages || info.t) || !cl || !cl.B) continue;
      // heights of trade books, 20.5 to 24.5 cm, in the order the shelf's random ones had (0.2 to 0.34 m)
      const h = info.h || 0.205 + Math.min(1, Math.max(0, (bk.h - 0.2) / 0.14)) * 0.04, t = info.pages ? spineOf(info.pages) : info.t;
      // a book with a cover: as wide (deep on the shelf) as its cover is for its height, the board's width being the
      // book's less its rounded spine (hero-books.js: bz), within what its shelf holds
      const ar = coverAr(bk.it), d = ar ? THREE.MathUtils.clamp(ar * h + Math.min(0.006, t * 0.2), 0.12, 0.26) : info.d || 0;   // (or the table's own)
      (byCell.get(cl) || byCell.set(cl, new Map()).get(cl)).set(bk.idx, d ? { t, h, d } : { t, h });
    }
    for (const [cl, sizes] of byCell) {
      for (const i of refitCell(cl, sizes, keep)) booksMesh.setMatrixAt(i, BOOK.list[i].m);
      for (const [i, sz] of sizes) { const bk = sec.books.find(b => b.idx === i); bk.t = sz.t; bk.h = sz.h; if (sz.d) bk.d = sz.d; }
    }
    if (byCell.size) {
      booksMesh.instanceMatrix.needsUpdate = true; setShadowsDirty(true);
      for (const bk of sec.books) { bk.m0.copy(BOOK.list[bk.idx].m); bk.hit.matrix.copy(bk.m0); }
    }
    if (together && box.focus && sec.books.length) {   // the view frames the books themselves
      let z0 = Infinity, z1 = -Infinity; for (const bk of sec.books) { const z = bk.m0.elements[14]; z0 = Math.min(z0, z - bk.t / 2); z1 = Math.max(z1, z + bk.t / 2); }
      box.focus.z = (z0 + z1) / 2; box.focusW = z1 - z0 + 0.12;
    }
    UIS.secs.push(sec); UIS.byId.set(sec.id, sec); for (const c of sec.cats) UIS.byCat.set(c.id, sec);
  }
}
/* ---- the book that leaves the shelf, made as a binder makes a hardcover (G, 15/10/2026: "render cho detail hơn"):
   two boards (2.4 mm) covered in book cloth, standing 2.5 mm proud of the pages at the head, the foot and the fore-edge
   (the "squares"), their edges rounded off so they catch the light; a rounded spine, with the groove of the joint along
   each board; between them the page block, its edges ruled with the leaves' edges (a darker line where a section was
   sewn), its fore-edge hollowed as a rounded back makes it; a striped headband at the head and the foot of the spine;
   endpapers inside the boards. The cloth is woven and a little velvety at a glance (sheen). The title, its frame and
   the spine's lettering are stamped into the cloth: pressed in, glossier than the cloth, a touch of foil. A book with its
   own cover wears it as a laminated jacket (a clear gloss). Lit as the room lights it, plus a soft studio reflection
   (three.js RoomEnvironment) for the sheen of the cloth, the stamping and the jacket, and a little light of its own so it
   is never too dark to read. It is drawn sharp over the picture, not watercoloured, so a cover reads as printed: on its
   own layer (HERO_LAYER), which the room's camera does not see, in a pass of its own (pets.js drawSharpBooks), its
   fragments dropped where the room is nearer. The shape is made in metres and brought to the book's unit box (the hero
   is scaled by its size, as the shelf books are: origin at the foot of the spine, spine toward +z, front cover +x). */
const HERO_LAYER = 3;
const HERO = { list: [], keep: 5, env: null };   // the books made so far (past `keep`, the one longest unseen is let go: ~11 MB of pictures each)
// the front board opening (the Geography books open on their map: G, 16/10/2026): each corner turned about the hinge
// by uOpen times its flap (heroGeometry), in metres (the mesh is the unit box, scaled by the book's size), its normal
// with it; nothing moves while uOpen is 0
const HERO_FLAP = `attribute float aFlap; uniform float uOpen; uniform vec2 uHinge; uniform vec3 uSize;
  vec2 heroTurn(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }\n`;
function heroSharp(mat, U) {   // (the room's depth, as the deck and the animals are tested against it; and the cover's turn)
  mat.onBeforeCompile = sh => {
    sh.uniforms.uDepth = DECKR.u.uDepth; sh.uniforms.uFull = DECKR.u.uFull; sh.uniforms.uOff = DECKR.u.uOff;
    sh.uniforms.uOpen = U.uOpen; sh.uniforms.uHinge = U.uHinge; sh.uniforms.uSize = U.uSize;
    sh.vertexShader = HERO_FLAP + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  if (aFlap * uOpen > 0.0) { vec3 fn = objectNormal / uSize; fn.xz = heroTurn(fn.xz, uOpen * aFlap); objectNormal = normalize(fn * uSize); }')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  if (aFlap * uOpen > 0.0) { vec3 fp = transformed * uSize; fp.xz = uHinge + heroTurn(fp.xz - uHinge, uOpen * aFlap); transformed = fp / uSize; }');
    sh.fragmentShader = 'uniform sampler2D uDepth; uniform vec2 uFull, uOff;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;');
  };
  return mat;
}
function wrapText(g, text, maxW) {
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const w of words) { const tryL = line ? line + ' ' + w : w; if (g.measureText(tryL).width > maxW && line) { lines.push(line); line = w; } else line = tryL; }
  if (line) lines.push(line); return lines;
}
function inkFor(col) { const hsl = {}; col.getHSL(hsl, THREE.SRGBColorSpace); return hsl.l < 0.55 ? '#f3ead6' : '#2a2118'; }
// the book's own lights (on its layer only), as a product is lit: a key lamp a third of a metre off to the viewer's upper
// left, its light falling off across the cover, bringing out the rounded edges, the groove of the joint and the stamping;
// and a weak fill from the right, low, so the fore-edge (turned away from the key) shows its pages; softer and warmer at
// night
function heroKey(camera, at) {
  if (!HERO.key) { for (const k of ['key', 'fill']) { HERO[k] = new THREE.PointLight(0xfff3e2, 1, 0, 2); HERO[k].layers.set(HERO_LAYER); scene.add(HERO[k]); } }
  const n = NIGHT.u.value, i = (0.85 - 0.35 * n) * 0.3;
  for (const [k, f, x, y] of [[HERO.key, 1, -0.3, 0.32], [HERO.fill, 0.6, 0.34, -0.04]]) {
    k.intensity = i * f; k.color.setRGB(1, 0.95 - 0.07 * n, 0.88 - 0.16 * n);
    _hk.copy(camera.position).sub(at).normalize(); k.position.copy(at).addScaledVector(_hk, 0.3).add(_hk.set(x, y, 0).applyQuaternion(camera.quaternion)); k.updateMatrixWorld();
  }
}
const _hk = new THREE.Vector3();
function heroEnv() {
  if (!HERO.env) { const pm = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(); HERO.env = pm.fromScene(room, 0.04).texture; pm.dispose(); if (room.dispose) room.dispose(); }
  return HERO.env;
}

/* ---- the shape. Groups: 0 the front's cloth, 1 the spine's, 2 plain cloth (the back, the boards' edges), 3 endpapers
   (inside the boards, the flyleaves), 4 the page edges, 5 the headbands */
function heroGeometry(bk) {
  const t = bk.t, h = bk.h, d = bk.d, T2 = t / 2, PI = Math.PI;
  const b = Math.min(0.0024, t * 0.13), sq = Math.min(0.0026, h * 0.012), rb = b * 0.42, bz = Math.min(0.006, t * 0.2);
  const gw = Math.min(0.0045, d * 0.03), gd = Math.min(0.0007, b * 0.35), e = Math.min(0.0007, b * 0.3);
  const PT = T2 - b - 0.0002, cv = Math.min(0.004, t * 0.12), zc = -bz - 0.0004, rzp = Math.max(0.0005, bz - 0.0018);
  const G = [[], [], [], [], [], [], [], []];   // per group: x, y, z, nx, ny, nz, u, v, flap of each corner of each triangle
  const vtx = (g, p, n, uv, w = 0) => G[g].push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], w);
  const tri = (g, A, B, C) => {   // three [p, n, uv]: wound so the face looks the way its normals do
    const ux = B[0][0] - A[0][0], uy = B[0][1] - A[0][1], uz = B[0][2] - A[0][2], wx = C[0][0] - A[0][0], wy = C[0][1] - A[0][1], wz = C[0][2] - A[0][2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx, s = fx * (A[1][0] + B[1][0] + C[1][0]) + fy * (A[1][1] + B[1][1] + C[1][1]) + fz * (A[1][2] + B[1][2] + C[1][2]);
    for (const V of s >= 0 ? [A, B, C] : [A, C, B]) vtx(g, ...V);
  };
  // a closed cross-section (x, z), its points' outward normals and the length along it
  const section = (pts) => {
    let area = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p.x * q.z - q.x * p.z; }
    let s = 0;
    pts.forEach((p, i) => { const a = pts[(i + pts.length - 1) % pts.length], c = pts[(i + 1) % pts.length], tx = c.x - a.x, tz = c.z - a.z, l = Math.hypot(tx, tz) || 1;
      p.nx = (area > 0 ? tz : -tz) / l; p.nz = (area > 0 ? -tx : tx) / l; if (i) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); p.s = s; });
    return pts;
  };
  const pusher = arr => (x, z, part) => { const q = arr[arr.length - 1]; if (q && Math.hypot(q.x - x, q.z - z) < 1e-7) return; arr.push({ x, z, part }); };
  // the case: the front board from its joint out to the fore-edge, round its end and back inside, through the spine to
  // the back board, out round its end, back along it to its joint, and round the spine to the front
  const P = [], add = pusher(P);
  const arc = (cx, cz, rx, rz, a0, a1, n, part) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; add(cx + rx * Math.cos(a), cz + rz * Math.sin(a), part); } };
  add(T2, -bz - gw, 'front'); add(T2, -d + rb, 'front');
  arc(T2 - rb, -d + rb, rb, rb, 0, -PI / 2, 4, 'edge'); add(T2 - b + rb, -d, 'edge'); arc(T2 - b + rb, -d + rb, rb, rb, -PI / 2, -PI, 4, 'edge');
  add(T2 - b, -bz - gw, 'inner'); const iJin = P.length - 1;                                   // (the joint, inside)
  for (let i = 1; i <= 6; i++) add(T2 - b, -bz - gw + gw * i / 6, 'inner'); const iSin = P.length - 1;   // (to the spine, in steps)
  arc(0, -bz, T2 - b, Math.max(0.0004, bz - 0.0012), 0, PI, 16, 'inner'); add(-T2 + b, -d + rb, 'inner');
  arc(-T2 + b - rb, -d + rb, rb, rb, 0, -PI / 2, 4, 'edge'); add(-T2 + rb, -d, 'edge'); arc(-T2 + rb, -d + rb, rb, rb, -PI / 2, -PI, 4, 'edge');
  add(-T2, -bz - gw, 'back');
  for (let i = 1; i <= 6; i++) { const s = i / 6; add(-T2 + gd * Math.sin(PI * s), -bz - gw + gw * s, 'back'); }   // the back joint's groove
  arc(0, -bz, T2, bz, PI, 0, 20, 'spine'); const iSout = P.length - 1;
  for (let i = 1; i < 6; i++) { const s = i / 6; add(T2 - gd * Math.sin(PI * s), -bz - gw * s, 'front'); }       // the front joint's groove
  section(P);
  // how much of the front board's turn each point takes as the book opens: all of it beyond the joint, none from the
  // spine on, a smooth share across the joint's groove (where the cloth and the endpaper bend)
  const flap = (x, z) => x > T2 - b - 1e-6 ? THREE.MathUtils.smoothstep(-z, bz, bz + gw) : 0;
  const sp0 = P.find(p => p.part === 'spine'), spL = P.filter(p => p.part === 'spine').pop().s - sp0.s + Math.hypot(sp0.x + T2, sp0.z + bz);   // (from the back joint)
  const cm = (d - bz) / 3;   // the cloth's tile, as large as on the front (heroMaterials: 768 px across, 256 px a tile)
  const caseUV = (p, part, y) => part === 'front' ? [(-p.z - bz) / (d - bz), y / h] : part === 'spine' ? [Math.min(1, Math.max(0, (p.s - sp0.s + Math.hypot(sp0.x + T2, sp0.z + bz)) / spL)), y / h]
    : [p.s / cm, y / cm];
  const GROUP = { front: 0, spine: 1, back: 2, edge: 2, inner: 3 };
  // its walls: rings at the foot, just above it, just below the head and at the head; the end rings' normals tipped
  // out (the edges look rounded)
  const rings = [[0, -0.9], [e, 0], [h - e, 0], [h, 0.9]];
  // (the front board's inside, the endpaper pasted to it, a group of its own (7): what an open book shows on its left,
  // its uv from the fore-edge (0) to the joint (1), up from its foot)
  const zE0 = -d + rb, zE1 = -bz - gw;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], part = q.part, end = i === iJin - 1, g = end ? 7 : GROUP[part];
    for (let r = 0; r < rings.length - 1; r++) {
      const [y0, k0] = rings[r], [y1, k1] = rings[r + 1];
      const V = (pt, y, k) => [[pt.x, y, pt.z], [pt.nx, k, pt.nz], end ? [(pt.z - zE0) / (zE1 - zE0), y / h] : caseUV(pt, part, y), flap(pt.x, pt.z)];
      const a = V(p, y0, k0), bb = V(q, y0, k0), c = V(q, y1, k1), dd = V(p, y1, k1);
      tri(g, a, bb, c); tri(g, a, c, dd);
    }
  }
  // its head and foot: the cross-section, its normals tipped out at the rim
  const flat = (pts, y, up, g, uv) => {
    const idx = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p.x, p.z)), []);
    for (const [i, j, k] of idx) tri(g, ...[pts[i], pts[j], pts[k]].map(p => [[p.x, y, p.z], [p.nx * 0.45 * (g === 4 ? 0 : 1), up, p.nz * 0.45 * (g === 4 ? 0 : 1)], uv(p), g === 4 ? 0 : flap(p.x, p.z)]));
  };
  const capParts = [P.slice(0, iJin + 1), [...P.slice(iSout), P[0], ...P.slice(iJin, iSin + 1)], P.slice(iSin, iSout + 1)];
  for (const part of capParts) { flat(part, h, 1, 2, p => [p.x / cm, p.z / cm]); flat(part, 0, -1, 2, p => [p.x / cm, p.z / cm]); }
  // the page block: its fore-edge hollowed, its back rounded into the spine
  const Q = [], addq = pusher(Q), zf = x => -d + sq + cv * (1 - (x / PT) ** 2);
  addq(PT, zc, 'back'); addq(PT, zf(PT), 'side');
  for (let i = 1; i <= 18; i++) { const x = PT - 2 * PT * i / 18; addq(x, zf(x), 'fore'); }
  addq(-PT, zc, 'side');
  for (let i = 1; i < 16; i++) { const a = PI - PI * i / 16; addq(PT * Math.cos(a), zc + rzp * Math.sin(a), 'back'); }
  section(Q);
  const zfp = zf(PT);
  for (let i = 0; i < Q.length; i++) {
    const p = Q[i], q = Q[(i + 1) % Q.length], g = q.part === 'fore' ? 4 : q.part === 'side' && p.x > 0 && q.x > 0 ? 6 : 3;
    const V = (pt, y) => [[pt.x, y, pt.z], [pt.nx, 0, pt.nz], g === 4 ? [(pt.x + PT) / (2 * PT), (y - sq) / (h - 2 * sq)] : g === 6 ? [(zc - pt.z) / (zc - zfp), (y - sq) / (h - 2 * sq)] : [pt.s / 0.1, y / 0.1]];
    tri(g, V(p, sq), V(q, sq), V(q, h - sq)); tri(g, V(p, sq), V(q, h - sq), V(p, h - sq));
  }
  flat(Q, h - sq, 1, 4, p => [(p.x + PT) / (2 * PT), (p.z + d) / d]); flat(Q, sq, -1, 4, p => [(p.x + PT) / (2 * PT), (p.z + d) / d]);
  // the headbands, where the page block meets the spine at the head and the foot
  const rh = Math.min(0.0012, sq * 0.5);
  for (const y of [h - sq + rh * 0.7, sq - rh * 0.7]) {
    const pts = []; for (let i = 0; i <= 16; i++) { const a = PI * (0.1 + 0.8 * i / 16); pts.push(new THREE.Vector3((PT - 0.0005) * Math.cos(a), y, zc + rzp * Math.sin(a) - rh * 0.6)); }
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, rh, 6, false), tp = tg.attributes.position, tn = tg.attributes.normal, tu = tg.attributes.uv, ti = tg.index;
    const TV = j => [[tp.getX(j), tp.getY(j), tp.getZ(j)], [tn.getX(j), tn.getY(j), tn.getZ(j)], [tu.getX(j), tu.getY(j)]];
    for (let j = 0; j < ti.count; j += 3) tri(5, TV(ti.getX(j)), TV(ti.getX(j + 1)), TV(ti.getX(j + 2)));
    tg.dispose();
  }
  // into the unit box: positions over the size, normals times it
  const n = G.reduce((s, a) => s + a.length / 9, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), fl = new Float32Array(n), geo = new THREE.BufferGeometry();
  let o = 0;
  G.forEach((a, g) => {
    const start = o;
    for (let i = 0; i < a.length; i += 9, o++) {
      pos[o * 3] = a[i] / t; pos[o * 3 + 1] = a[i + 1] / h; pos[o * 3 + 2] = a[i + 2] / d;
      const nx = a[i + 3] * t, ny = a[i + 4] * h, nz = a[i + 5] * d, l = Math.hypot(nx, ny, nz) || 1; nor[o * 3] = nx / l; nor[o * 3 + 1] = ny / l; nor[o * 3 + 2] = nz / l;
      uv[o * 2] = a[i + 6]; uv[o * 2 + 1] = a[i + 7]; fl[o] = a[i + 8];
    }
    geo.addGroup(start, o - start, g);
  });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aFlap', new THREE.BufferAttribute(fl, 1));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  // (the hinge: the middle of the joint's groove, halfway through the board; the first page: its face and size)
  return { geo, frontU0: gw / (d - bz), frontW: d - bz, spineL: spL, hinge: new THREE.Vector2(T2 - b / 2, -bz - gw / 2), page: { x: PT, z0: zc, z1: zfp, y0: sq, y1: h - sq }, endW: zE1 - zE0 };
}

/* ---- the cloth, the stamping, the pages */
const _hc = new THREE.Color();
function heroCloth(bk, S = 256) {   // a tile of the book's cloth, ~5 cm square: a fine weave whose threads are not all
  // alike (each a little lighter or darker, here and there a slub, a thicker stretch of thread), and flecks
  const c = canvas(S, S), g = c.getContext('2d'), r = rng(bk.idx * 31 + 5);
  g.fillStyle = '#' + bk.color.getHexString(THREE.SRGBColorSpace); g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(255,255,255,${0.03 + 0.04 * r()})`; g.fillRect(0, y, S, 1); }
  for (let x = 0; x < S; x += 2) { g.fillStyle = `rgba(0,0,0,${0.035 + 0.04 * r()})`; g.fillRect(x, 0, 1, S); }
  for (let k = 0; k < 40; k++) {   // slubs, along the weft and the warp: they catch the light a little
    const along = r() < 0.6, l = 5 + r() * 14, x = r() * S, y = Math.floor(r() * S / 2) * 2; g.fillStyle = `rgba(255,252,244,${0.025 + 0.03 * r()})`;
    for (const ox of [-S, 0]) for (const oy of [-S, 0]) along ? g.fillRect(x + ox + S, y + oy + S, l, 1.6) : g.fillRect(y + ox + S, x + oy + S, 1.6, l);   // (wrapped: the tile repeats)
  }
  for (let k = 0; k < S * S / 90; k++) { g.fillStyle = `rgba(${r() < .5 ? '0,0,0' : '255,255,255'},${r() * .07})`; g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r()); }
  return c;
}
function heroCanvasTex(c, color, rep) {
  const t = new THREE.CanvasTexture(c); if (color) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
// the front: the cover's own picture, or the cloth with a ruled frame, the title as large as fits above the author
// (italics) and the year, all centred on the board (the groove of the joint takes the strip on the left)
function heroCoverLayout(g, W, H, bk, x0, frameOnly) {
  const w = W - x0, k = w / 576, serif = `Georgia, 'Times New Roman', serif`;
  g.save(); g.translate(x0, 0); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.lineWidth = 3.4 * k; g.strokeRect(36 * k, 36 * k, w - 72 * k, H - 72 * k); g.lineWidth = 1.6 * k; g.strokeRect(50 * k, 50 * k, w - 100 * k, H - 100 * k);
  if (frameOnly) { g.restore(); return; }
  const by = byOf(bk.it), parts = by ? by.split(/\s+·\s+/) : [], year = parts.length && /^\d{3,4}$/.test(parts[parts.length - 1]) ? parts.pop() : '', who = parts.join(' · ');
  const bs = Math.round(w * 0.072), ys = Math.round(w * 0.056);
  g.font = `italic ${bs}px ${serif}`; const wl = who ? wrapText(g, who, w - 110 * k) : [];
  const yearY = H - w * 0.15, lastWho = year ? yearY - ys * 1.45 : yearY;
  const top = wl.length ? lastWho - (wl.length - 1) * bs * 1.2 - bs : year ? yearY - ys : H - w * 0.1;
  let size = Math.round(w * 0.118), lines = [];
  const bottom = () => H * 0.2 + size + (lines.length - 1) * size * 1.16 + size * 0.55;
  for (;; size -= 2) { g.font = `600 ${size}px ${serif}`; lines = wrapText(g, printTitle(bk.it), w - 104 * k); if (size <= 22 || (lines.length <= 5 && bottom() < top - w * 0.05)) break; }
  const y0 = H * 0.2 + size; lines.forEach((l, i) => g.fillText(l, w / 2, y0 + i * size * 1.16));
  g.fillRect(w / 2 - 44 * k, bottom(), 88 * k, 3.4 * k);
  if (year) { g.font = `500 ${ys}px ${serif}`; g.fillText(year, w / 2, yearY); }
  g.font = `italic ${bs}px ${serif}`; wl.forEach((l, i) => g.fillText(l, w / 2, lastWho - (wl.length - 1 - i) * bs * 1.2));
  g.restore();
}
// the spine: a pair of rules at the head and the foot, the title along it (two lines on a thick spine, narrowed a little
// rather than cut), as on the shelf
function heroSpineLayout(g, W, H, bk) {
  const k = W / 96; g.save();
  for (const y of [24 * k, H - 27 * k]) { g.fillRect(0, y, W, 2.6 * k); g.fillRect(0, y + 6 * k, W, 1.2 * k); }
  const font = n => `600 ${n}px Inter, 'Helvetica Neue', Arial, sans-serif`;
  g.translate(W / 2, H / 2); g.rotate(Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle';
  const room = H - 80 * k, two = bk.t >= 0.028, S = W * 0.9;   // (the middle of the round: its sides turn away)
  let size = Math.round(S * (two ? 0.38 : 0.6)), txt = printTitle(bk.it); g.font = font(size);
  while (g.measureText(txt).width > room * (two ? 2 : 1) && size > Math.round(S * (two ? 0.32 : 0.48))) { size -= 1; g.font = font(size); }
  const fit = (s, f) => { while (g.measureText(s).width * f > room && s.length > 4) s = s.slice(0, -2).trimEnd() + '…'; return s; };
  if (two && g.measureText(txt).width > room) {
    const words = txt.split(/\s+/); let a = '', i = 0; while (i < words.length && g.measureText((a ? a + ' ' : '') + words[i]).width <= room) a += (a ? ' ' : '') + words[i++];
    if (!a) { a = words[0]; i = 1; }
    g.fillText(fit(a, 1), 0, -size * 0.58); g.fillText(fit(words.slice(i).join(' '), 1), 0, size * 0.58);
  } else { const sx = Math.max(0.8, Math.min(1, room / g.measureText(txt).width)); txt = fit(txt, sx); g.scale(sx, 1); g.fillText(txt, 0, 0); }
  g.restore();
}
// one face (front or spine) as two pictures: its colours, and its surface: how high (red: the weave, the stamping
// pressed in; three.js bumps by red), how rough (green) and how metallic (blue) each part is: the cloth matte, the
// stamping smoother with a touch of foil
function heroFace(bk, W, H, cloth, layout, ink) {
  const col = canvas(W, H), surf = canvas(W, H), gc = col.getContext('2d');
  let bump, rm, gb, gr;
  const merge = () => {   // red from the height, green and blue from the roughness and metal
    const a = gb.getImageData(0, 0, W, H).data, b = gr.getImageData(0, 0, W, H), d = b.data;
    for (let i = 0; i < d.length; i += 4) d[i] = a[i];
    surf.getContext('2d').putImageData(b, 0, 0);
  };
  const paint = () => {
    bump = canvas(W, H); rm = canvas(W, H); gb = bump.getContext('2d', { willReadFrequently: true }); gr = rm.getContext('2d', { willReadFrequently: true });   // (read back to merge)
    gc.fillStyle = gc.createPattern(cloth, 'repeat'); gc.fillRect(0, 0, W, H);
    const r = rng(bk.idx + 7);
    for (let k = 0; k < 36; k++) {   // the dye a little uneven: soft, wide patches, lighter and darker (across the face, so the tile's repeat does not show)
      const x = r() * W, y = r() * H, rr = W * (0.08 + 0.2 * r()), lt = r() < 0.5, m = gc.createRadialGradient(x, y, 0, x, y, rr);
      m.addColorStop(0, lt ? 'rgba(255,250,240,0.045)' : 'rgba(0,0,0,0.05)'); m.addColorStop(1, 'rgba(0,0,0,0)'); gc.fillStyle = m; gc.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
    }
    const wear = gc.createLinearGradient(0, 0, 0, H);   // the cloth rubbed paler toward the head and the foot
    wear.addColorStop(0, 'rgba(255,250,240,0.10)'); wear.addColorStop(0.06, 'rgba(255,250,240,0)'); wear.addColorStop(0.94, 'rgba(255,250,240,0)'); wear.addColorStop(1, 'rgba(255,250,240,0.12)');
    gc.fillStyle = wear; gc.fillRect(0, 0, W, H);
    for (let k = 0; k < 900; k++) { gc.fillStyle = `rgba(255,250,240,${r() * 0.05})`; const ed = r() < 0.5, x = ed ? W - r() * W * 0.03 : r() * W, y = ed ? r() * H : (r() < 0.5 ? r() * H * 0.02 : H - r() * H * 0.02); gc.fillRect(x, y, 1 + r() * 3, 1 + r() * 3); }
    for (const y of [0, H]) {   // the fore-edge's corners rubbed pale, the cloth worn through to its threads there
      const cr = W * 0.05, rg = gc.createRadialGradient(W, y, 0, W, y, cr); rg.addColorStop(0, 'rgba(255,248,236,0.28)'); rg.addColorStop(1, 'rgba(255,248,236,0)');
      gc.fillStyle = rg; gc.fillRect(W - cr, y ? H - cr : 0, cr, cr);
      for (let k = 0; k < 60; k++) { const a = r() * Math.PI / 2, rr = cr * Math.pow(r(), 1.6); gc.fillStyle = `rgba(255,250,240,${0.1 + 0.15 * r()})`; gc.fillRect(W - Math.cos(a) * rr, y ? H - Math.sin(a) * rr : Math.sin(a) * rr, 1 + r() * 2, 1); }
    }
    gb.fillStyle = '#8c8c8c'; gb.fillRect(0, 0, W, H); gb.globalAlpha = 0.5; gb.fillStyle = gb.createPattern(cloth, 'repeat'); gb.fillRect(0, 0, W, H); gb.globalAlpha = 1;   // (the weave)
    gr.fillStyle = 'rgb(0,214,0)'; gr.fillRect(0, 0, W, H);
    if (layout) {   // (the cloth pressed round the stamping darkens a little: it also keeps the words clear of the cloth)
      gc.save(); gc.shadowColor = ink === '#2a2118' ? 'rgba(255,248,232,.55)' : 'rgba(20,14,8,.6)'; gc.shadowBlur = Math.max(3, W * 0.012);
      gc.fillStyle = gc.strokeStyle = ink; layout(gc); gc.restore();
      gb.filter = 'blur(1.2px)'; gb.fillStyle = gb.strokeStyle = '#1a1a1a'; layout(gb); gb.filter = 'none';
      gr.fillStyle = gr.strokeStyle = 'rgb(0,92,96)'; layout(gr);
    }
    merge();
  };
  paint();
  const face = { col, paint, tex: heroCanvasTex(col, true), surfTex: heroCanvasTex(surf),
    flat: (x, y, w, h) => { gb.fillStyle = '#8c8c8c'; gb.fillRect(x, y, w, h); gr.fillStyle = 'rgb(0,150,0)'; gr.fillRect(x, y, w, h); merge(); face.surfTex.needsUpdate = true; } };
  return face;
}
/* ---- the page edges, drawn in the shader so their lines hold at any size (a texture's lines either blurred into one
   cream tone or shimmered). Across the block (u), one seam between each leaf and the next, and every 10 leaves (20
   pages) the fold of a sewn section, darker; each section's edge a little rounded, so the block reads as bundles of
   leaves; a leaf or a section standing a little proud, lighter; the leaves' edges wandering a little along the block
   (u nudged by a slow wave, each section its own); in the boards' shadow where they overhang; dustier at the head and
   the foot. Every pattern is box-filtered over the pixel it falls in (its integral differenced over the pixel's width,
   as in Apodaca & Gritz, "Advanced RenderMan", ch. 11, and Inigo Quilez's "filtering procedurals"): a line finer than a
   pixel fades into its average instead of breaking into moiré, and the folds, a few pixels apart on the screen, stay
   crisp. */
const HERO_PAGE_GLSL = `
  float hpg(float n) { return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }
  float pulseI(float t, float a) { float s = t + 0.5 * a; return floor(s) * a + min(fract(s), a); }
  float pulseF(float x, float w, float a) { return (pulseI(x + 0.5 * w, a) - pulseI(x - 0.5 * w, a)) / w; }   // how much of [x - w/2, x + w/2] lies within a/2 of a whole number
  float cosF(float x, float w) { return w < 1e-3 ? cos(6.2831853 * x) : (sin(6.2831853 * (x + 0.5 * w)) - sin(6.2831853 * (x - 0.5 * w))) / (6.2831853 * w); }
`;
const HERO_PAGE_MAIN = `
  {
    vec2 pu = vUv;   // u across the block (back board to front), v along it
    float L = uLeaves, S = 10.0, sec = floor(pu.x * L / S);   // (S leaves to a section: 20 pages)
    float wob = 0.12 * (0.6 * sin(pu.y * 9.0 + hpg(sec) * 6.283) + 0.4 * sin(pu.y * 23.0 + hpg(sec + 31.0) * 6.283));   // (in leaves)
    float x = pu.x * L + wob, w = max(fwidth(x), 1e-4), xs = x / S, ws = w / S;
    float seam = pulseF(x, w, 0.22), fold = pulseF(xs, ws, 0.12), bulge = 0.5 - 0.5 * cosF(xs, ws);
    float lf = (hpg(floor(x) + 17.0) - 0.5) * (1.0 - smoothstep(0.35, 1.0, w)), sf = (hpg(floor(xs) + 59.0) - 0.5) * (1.0 - smoothstep(0.5, 1.2, ws));
    float ao = smoothstep(0.0, 0.07, pu.x) * smoothstep(0.0, 0.07, 1.0 - pu.x);
    float k = (1.0 - 0.3 * seam) * (1.0 - 0.75 * fold * (0.55 + 0.9 * hpg(floor(xs + 0.5) + 3.0))) * mix(0.76, 1.0, bulge) * (1.0 + 0.1 * lf + 0.2 * sf);
    diffuseColor.rgb = vec3(0.86, 0.77, 0.58) * k * mix(0.5, 1.0, ao) * (1.0 - 0.07 * smoothstep(0.86, 1.0, abs(pu.y * 2.0 - 1.0)));
  }
`;
function heroPagesMat(bk, base) {
  const info = bookInfo(bk.it), leaves = Math.max(40, Math.round((info && info.pages ? info.pages : (bk.t - 0.004) / 0.00006) / 2));
  const m = heroSharp(new THREE.MeshStandardMaterial({ ...base, emissiveIntensity: 0.16, roughness: 0.9, metalness: 0 }), bk.flapU), patch = m.onBeforeCompile;   // (paper lit through: a little more light of its own)
  m.defines = { USE_UV: '' }; m.customProgramCacheKey = () => 'hero-pages';
  m.onBeforeCompile = sh => {
    patch(sh); sh.uniforms.uLeaves = { value: leaves }; sh.uniforms.uSeed = { value: (bk.idx * 0.137) % 1 };
    sh.fragmentShader = 'uniform float uLeaves, uSeed;\n' + HERO_PAGE_GLSL + sh.fragmentShader.replace('#include <map_fragment>', HERO_PAGE_MAIN)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= diffuseColor.rgb;');
  };
  return m;
}
function heroBand(bk) {   // the headband: silk wound on its core, two colours
  const c = canvas(64, 16), g = c.getContext('2d'), a = inkFor(bk.color) === '#f3ead6' ? '#e9dcc0' : '#7c2b26';
  g.fillStyle = '#8f2f29'; g.fillRect(0, 0, 64, 16); g.fillStyle = a;
  for (let x = -16; x < 80; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 4, 0); g.lineTo(x + 8, 16); g.lineTo(x + 4, 16); g.fill(); }
  const t = heroCanvasTex(c, true, true); t.repeat.set(14, 1); return t;
}
// the first page of an atlas (the Geography books): its map, drawn when the browser is next idle after the book leaves the
// shelf (some 50 to 150 ms), or as it starts to open if it has not been yet, and again in the other language
function heroAtlasPage(bk, shape, base) {
  const pg = shape.page, W = 1024, H = Math.round(W * (pg.y1 - pg.y0) / (pg.z0 - pg.z1)), c = canvas(W, H), g = c.getContext('2d'), info = bookInfo(bk.it);
  g.fillStyle = '#f1e8d2'; g.fillRect(0, 0, W, H);
  // and its endpaper, inside the front board: a printed pattern of compass roses, a bookplate, and a word on what the
  // map does
  const EW = 768, EH = Math.round(EW * bk.h / shape.endW), ce = canvas(EW, EH), ge = ce.getContext('2d'); ge.fillStyle = '#ece4d0'; ge.fillRect(0, 0, EW, EH);
  const tex = heroCanvasTex(c, true), etex = heroCanvasTex(ce, true), page = { done: false, frame: null, tex, etex,
    paint: () => { page.frame = drawAtlas(c, info.map, pageLang()); drawEndpaper(ce, info.map, pageLang(), titleIn(bk.it)); page.done = true; tex.needsUpdate = etex.needsUpdate = true; setNeeds(true); } };
  (window.requestIdleCallback || (f => setTimeout(f, 200)))(() => { if (!page.done && bk.hero) page.paint(); }, { timeout: 700 });
  bk.atlas = page;
  page.endMat = heroSharp(new THREE.MeshStandardMaterial({ ...base, map: etex, emissiveMap: etex, emissiveIntensity: 0.1, roughness: 0.9, metalness: 0 }), bk.flapU);
  return heroSharp(new THREE.MeshStandardMaterial({ ...base, map: tex, emissiveMap: tex, emissiveIntensity: 0.12, roughness: 0.86, metalness: 0 }), bk.flapU);
}
function heroMaterials(bk, shape) {
  const ink = inkFor(bk.color), cloth = heroCloth(bk), img = coverOf(bk.it), H = bk.h;
  bk.flapU = { uOpen: { value: 0 }, uHinge: { value: shape.hinge.clone() }, uSize: { value: new THREE.Vector3(bk.t, bk.h, bk.d) } };   // (the cover's turn: shared by its materials)
  const FW = 768, FH = Math.round(FW * H / shape.frontW), SW = 160, SH = Math.max(160, Math.round(SW * H / shape.spineL));
  const front = heroFace(bk, FW, FH, cloth, g => heroCoverLayout(g, FW, FH, bk, FW * shape.frontU0, !!img), ink);
  const spine = heroFace(bk, SW, SH, cloth, g => heroSpineLayout(g, SW, SH, bk), ink);
  const env = heroEnv(), sheenColor = _hc.copy(bk.color).lerp(new THREE.Color(1, 1, 1), 0.2).clone();
  const base = { fog: false, envMap: env, envMapIntensity: 0.16, emissive: 0xffffff, emissiveIntensity: 0.09 }; bk.heroBase = base;
  const clothMat = (face, o) => heroSharp(new THREE.MeshPhysicalMaterial({ ...base, map: face.tex, emissiveMap: face.tex, bumpMap: face.surfTex, bumpScale: 4.2,
    roughness: 1, metalness: 1, roughnessMap: face.surfTex, metalnessMap: face.surfTex, sheen: 0.4, sheenRoughness: 0.72, sheenColor, ...o }), bk.flapU);
  const ct = heroCanvasTex(cloth, true, true);
  const mats = [
    clothMat(front, img ? { sheen: 0, clearcoat: 0.5, clearcoatRoughness: 0.26 } : {}),
    clothMat(spine),
    heroSharp(new THREE.MeshPhysicalMaterial({ ...base, map: ct, emissiveMap: ct, bumpMap: ct, bumpScale: 1.6, roughness: 0.84, metalness: 0, sheen: 0.4, sheenRoughness: 0.72, sheenColor }), bk.flapU),
    heroSharp(new THREE.MeshStandardMaterial({ ...base, color: _hc.set(0xebe1c8).lerp(bk.color, 0.18).clone(), emissive: _hc.clone(), roughness: 0.92, metalness: 0 }), bk.flapU),
    null, null, null, null];
  mats[4] = heroPagesMat(bk, base);
  const bt = heroBand(bk); mats[5] = heroSharp(new THREE.MeshStandardMaterial({ ...base, map: bt, emissiveMap: bt, roughness: 0.55, metalness: 0 }), bk.flapU);
  const info = bookInfo(bk.it); mats[6] = info && info.map ? heroAtlasPage(bk, shape, base) : mats[3];   // (the first page: an atlas's map, else a flyleaf)
  mats[7] = bk.atlas ? bk.atlas.endMat : mats[3];   // (the front board's endpaper: an atlas's printed one)
  if (img) { const im = new Image(); im.onload = () => {   // the jacket over the whole board (and its joint): the book was made the cover's shape
    // (sections.js), so it fits; where the shelf held it to another shape, the picture still covers the board, its overflow cut
    const W = FW, Hh = FH, a = im.width / im.height, b2 = W / Hh, g = front.col.getContext('2d'), w = a > b2 ? Hh * a : W, hh = a > b2 ? Hh : W / a;
    g.drawImage(im, (W - w) / 2, (Hh - hh) / 2, w, hh); front.flat(0, 0, W, Hh);   // (printed paper: smoother than the cloth, and flat)
    front.tex.needsUpdate = true; setNeeds(true);
  }; im.src = img; }
  bk.heroFaces = { front: img ? null : front, spine };   // (a jacket's picture is not redrawn for another language)
  bk.heroShape = { hinge: shape.hinge, page: shape.page };
  return mats;
}
function heroMesh(bk) {
  if (bk.hero) return bk.hero;
  if (!heroMesh.lit) { heroMesh.lit = true; scene.traverse(o => { if (o.isLight) o.layers.enable(HERO_LAYER); }); }   // (the room's lights light it there too)
  const shape = heroGeometry(bk), m = new THREE.Mesh(shape.geo, heroMaterials(bk, shape));
  m.layers.set(HERO_LAYER); m.visible = false; m.userData.book = bk; scene.add(m); bk.hero = m;
  if (isReadItem(bk.it) && buildRead(bk, shape, m, bk.heroBase)) m.material[7] = heroSharp(bk.read.endMat, bk.flapU);   // (a book of notes: its leaves, and its title page inside the front board)
  HERO.list.push(bk); heroForget(); return m;
}
// past HERO.keep books made, the one longest out of sight (and not on its way anywhere) is let go: its pictures are large
function heroForget() {
  const idle = HERO.list.filter(bk => bk.hero && !bk.hero.visible && !UIS.touched.has(bk)).sort((a, b) => (a.heroSeen || 0) - (b.heroSeen || 0));
  while (HERO.list.length > HERO.keep && idle.length) {
    const bk = idle.shift(), m = bk.hero; scene.remove(m); m.geometry.dispose();
    for (const mt of m.material) { for (const k of ['map', 'bumpMap', 'roughnessMap']) if (mt[k]) mt[k].dispose(); mt.dispose(); }
    if (bk.read) readDispose(bk);
    bk.hero = null; bk.heroFaces = null; bk.atlas = null; HERO.list.splice(HERO.list.indexOf(bk), 1);
  }
}
// the page's language switched: the title on a book already out drawn again
function relabelHero(bk) {
  if (!bk.heroFaces) return;
  for (const f of [bk.heroFaces.front, bk.heroFaces.spine]) if (f) { f.paint(); f.tex.needsUpdate = f.surfTex.needsUpdate = true; }
  if (bk.atlas && bk.atlas.done) bk.atlas.paint();
  if (bk.read) relabelRead(bk);
}
/* The map of Vietnam in the Geography books, drawn by ui/atlas.js. Made by src/tools/vnmap/make.py (do not edit by hand)
   from G's own map of Vietnam (HTML MAP/Single VN map.html): the coastline and the border from OpenStreetMap
   (© OpenStreetMap contributors, ODbL: openstreetmap.org/copyright), the depth and height bands from AWS Terrain Tiles
   (terrarium); Hoang Sa's islands placed by hand. Rings as encoded polylines (lng, lat in 1/1000 degree), a layer's
   rings joined by spaces; `dots`: the archipelagos' islands too small to draw, as points.
   vn 79 rings / 2137 pts, border 878, pq 131, dots 65, foreign 34 / 1402, sea 200 31 / 424, sea 1000 32 / 459, sea 3000 25 / 394, relief 200 21 / 1424, relief 500 46 / 1657, relief 1000 42 / 860, relief 1500 11 / 188, rivers 62 / 671; Phu Quoc's map: isles 18 / 667, relief 50 12 / 217, 200 5 / 87, water 3 / 113, streams 7 / 63 */
const VN_GEO = {"f":1000.0,"vn":"m~jEmjS[l@RdAmAYFXc@B_ApAEvAc@Yy@|@WrCc@f@Ll@wAJ_BeCqAo@_ALkAp@cDtEuEOeDjD{@xBJZv@[l@NvDpDlB@^p@nA~IjAr\\@dGU\\ZPFtFd@dD}@vAoDkACPr@tAhDpAPl@[pAhAL|@S^j@W`AqElAuImAqEiAqCoEiD{@cCaCgBqEYkBoEcE}UmIqOmCkBuACoA`@QkA_AIeAgAC{@aA]aB|@g@a@WwB|@w@r@Ij@{D[iCwA}@}A[eBZoBzAy@EiApAsAUWWTL]kAbASa@b@]WQqCzCgB_Be@sAj@yAt@_@Cw@iBiB_Bg@kBiC\\iBlAg@uAeA`AkAcAaAAeDqDcAE~@o@^_ADmAa@m@Vh@a@GeAvA{@[s@g@NSmAg@Wy@`BUUmAvAmAEIf@^j@~AXy@xBu@oAkBmA}AKw@r@a@AeCgCyAg@qC@y@}@sAEcCsCqEeByDi@iBuBqC]sDj@k@gAm@cEwA{CcHwAeBZEp@YB[sA}@@UeBk@s@qAHi@g@oAAe@}By@qAqAUm@g@}@L_Aa@_BTQ`@m@i@o@{Dk@OSo@g@XJQUE@TKk@kC_@}A|@eDcBRkAKaFKi@[GD}A}BMiAn@k@mB]GUmBu@{@Le@QVw@[Dg@R@MQpAgAOg@XGHw@[}@z@f@T`At@?TcBa@eAWCI\\e@WiAyCUFAj@THYVZtB}@@_@v@_Aw@l@uAs@_AVBBk@rAkA`A}CAs@w@m@r@q@We@l@g@}@Hf@iAIwAmAq@nA{@F{BbAMXi@q@}@eCfBi@x@DZ_A^]sAg@\\[s@fBw@OoBtBu@PgAYoAZOb@p@E\\b@c@OyA\\MGYk@YHc@g@w@s@MaBsBe@Eg@gAgAnDXj@ZCPt@\\BQTYWYj@G}@q@FEa@a@fAD^f@HsAbCGaDs@GRg@r@A^o@MUVDXc@dAiEoCyBQTb@j@aAWEiB~C}D~CcGDw@Yi@X{@]WHi@[IbAaCE][?Hy@fAJ\\}@v@I]c@TKc@S^c@i@{AcBfAbAv@Q^o@IKXYQI{A[EDU`@P`@c@EwAR`@jA_@_@w@SDH`@c@HTe@k@i@hAe@|@yAGaBf@_Cw@s@}A^QyFFa@NT\\St@wA@_@_@MR_@IiAtAuCAcAjA@^cA?[_@G{@~Aa@BMWxAgC?g@]Md@kAMU|BsDIm@X}@Se@pBaFEg@U?`@wCe@_@J_AzDyHhCwIf@{HoAu@Ks@~@MdAsAQiAb@OI]d@Dh@s@FwA^JVY`@Ls@PV\\HORXBQ@Pv@EdB_BJsAb@KIo@~@h@UMzAm@dJ{Nv@}DvEkDtAaDLmAUq@iAIWRI_@u@K\\m@TANd@tB_AhA~@aATHd@V_@h@TMNRGKTVRvAe@t@}A[ECk@YBEw@kAS?U|ASx@Nt@YdB}CJ}@^KGj@VJbAGh@s@pBo@tKmIxCgAbPuKrK}J|@mBI_CxQiLrHgHdHoLrBmFVoBSmA}@}A{@e@g@Jp@QFYUEj@IfA_BPgCCp@VJPYWMNDZeA[g@d@E`@r@pAUrEqEtDiBtBMfFiFtA}Cf@d@bEkH`B{H~AsAVgB~CwAh@gDY{Bs@qAg@Ya@`@}Ao@P_AQcDw@Q[sAs@GQeAWRBsATTZSRo@W@VEJw@[_A]E?_HiAwFq@{@m@FeAoBCsB}@iB^DEaAqC}AqAbBq@Qs@f@v@XUJuCcDYiAi@RJYiHsIqBs@}Eo@i@BBr@qA]?sA`@a@w@s@TMQQZeB}@eCPC?cBl@eAIeAoBeB?g@{@EKTi@SPUg@aAcAKB_@q@EK]MN^d@g@FKa@s@v@d@y@Wo@\\F[ItAgBc@I@We@b@qASTcArAOESwAGUp@u@[`@iAc@Gc@iA}BDRYXFGm@q@f@Ck@c@YUTA[wA^o@KCo@n@c@~@E?a@UVaA@S]q@FRtBqBVOQY\\UOJZUUTSgARWo@RHgAq@PUqF@aAaATe@Gs@TQk@URKUSVm@m@CH_Bj@@GsDyAc@U\\@{@IVs@Fj@k@gABn@o@gAz@W?R]_AXV]WNDUe@@Aw@u@dAODA]Wh@[CLLOQa@JRa@[EIg@WHCo@SGNi@y@VUi@XS_@JUe@oDl@h@[Du@}AgBl@u@d@F_@e@mAXo@m@@r@u@i@Gf@[FSCEm@QV]KMn@u@H~@x@g@TKSG^g@??`@yAqA{B[~BCsAk@^AJT`@[aASXi@~CRVaAd@e@n@@`@i@K_@|@{@^Zt@c@~@DtE|AdDH\\[fAx@tBS]]^uAb@M|An@bAxAh@IB_CtB}ChAZ^p@r@Gr@[Rq@zA_@v@}@lEcAHc@W_@_B_A\\eAp@_@~@MXr@b@LPWj@?ZyAvCOv@T~AoAt@HTt@fA`@LkAq@o@Tu@_@uAp@sAa@m@dAq@_AcAb@yAMYn@OL_BfE[s@{Ar@w@Me@Pc@u@a@DqAy@oDi@@_@t@uCUOY`@Y]_@F]aA}@Fk@s@U\\Q?o@m@WBY_AIc@cAx@]rARG_@vBkAQWVWhAG^v@dB_CfARnAy@^@XtAl@IT\\PUp@d@NQXPKTpAQh@v@p@c@pALx@UMK\\S]_@v@wAdA_AdABh@Wt@TdA_@`DNDdBxCG~@LZj@lAmCbAEn@aA|AWh@eAAPdAA`Ag@p@`@XUbAHV_@?oA[_A|@aAxASHy@dBgCTEVb@~AcA|AsCnAdB|@FKf@p@z@?t@zBw@\\j@xAh@~@g@lB|AzBf@\\~AfBy@VJN`Bd@E|@f@n@Ou@hF_Ah@G|@r@r@~Bf@d@tAz@NMt@vBHbBy@Bp@h@J@y@j@Qz@ZOFpAzAvDjBl@bAv@Zd@It@iAnBWZgA_@eBV_@nFjAn@GvCpDP~Dp@bBUTTt@M\\dA^l@Iv@w@VHp@eAVHvEyFd@@Tm@`EkDn@XNx@zAbB_@rAbBhCpAm@`AqAIg@dAeA[oAfCyAxA]L`A~@vAJnBz@Nn@p@tAFt@`Bo@jAzD|A^f@QlA`BNnAi@F]tBINo@~@y@MQb@Y@_A\\a@jAe@fA@Bc@j@GVg@b@@xAkAbA\\|AsAjAx@d@uAtBcA`AZDbAh@|@bB^_@lAc@P|AtAp@FOl@bAPtAvCx@f@g@jALRtCg@v@F\\z@u@x@Dh@w@Zb@|@oBj@MxA}@BM|@sAB[hA}@Dc@ZAf@cBVKtA{CvA|@l@c@`AuEjBOf@Tj@eAf@E`B[^`@vBy@zCuCQyCmC^sDo@i@c@FGlFk@h@_EuA]n@Tp@WVR`AW`C|CdDJp@h@B?r@`@h@eAAg@s@c@?zAjCA`DxAHvAfA_@b@oAU_Bv@P|BeANU`@P\\u@v@At@cCX_D`IgBg@yA^o@v@Nh@Sb@_ATi@]U`@aC\\o@j@eBSUu@]IuApCwDR_BxAc@?]fAiBKSUXgBsB_@TmBy@i@Lq@W_@g@Kc@T_BwA_BR{@g@kBTc@YEeAkBu@q@x@uBOgBl@Dj@c@XQe@q@KsArAHp@eEbCe@QQh@w@V[lBs@VaAe@s@b@Ur@yAFPjAv@r@xBNb@~Ar@Fl@z@hAL^`@`ABT|AmA^Vp@Sh@wBVgBq@Ce@aDQ_@mAgA[Gl@mBxAJPz@KbCrAFlF_@Z}@GM\\gB`@mBDmDnBaCa@H`@W^}@r@y@HvC|C\\~AtBrAKjBZd@[PZ`BnCd@Lt@`AKxBhBQd@r@v@Md@TZbA[bBr@XUb@Jh@U^{@fA?Pa@d@AX}@~BXx@p@Ce@b@UdCUxBf@XQHp@h@R~@?hAi@R|B}AbBF~Ae@f@VV`@Ov@vASFF`Ab@QhAn@jAFd@\\Hr@hC~@Nd@mAB{AdBoAh@iC_@_A`ASQ_@d@gBLe@dAq@JHjAkC@o@x@mD|@o@dBs@h@o@CWa@w@n@a@IeBhDaB\\aBbBeA@s@dAk@Ni@Oa@f@sAGa@TkBc@q@b@EbAqB@o@UA`@kALP^iBDy@UWZP^yB|ALdA|@Qp@l@Ix@p@l@TvDa@v@e@AU|@cAD@xBuBx@WpAwA?Ad@S{@e@@P~B_BnA_@Qq@^U{@g@BEk@eBFJl@YUUjAJr@y@NIbA}@CSjCa@V_@S{@f@fAdFiBh@k@l@LjAkBbBi@xC}@O}Ar@]l@c@?wL~NiBfAUr@oE`Cu@i@By@y@AAhAYRRPs@Hz@r@k@PCd@w@j@RRSZwBlBZr@kArBi@KUb@uATeAeAB`Dv@FJr@iA|@?tI]jBq@b@Hh@o@K_@HCf@c@Wi@RIn@n@d@@d@c@b@F|@YCCl@QIEb@kAZQ[Iv@_Ai@@gAs@MITy@iD_ANu@x@XhAUn@^l@u@B?hAcCdAMdB_AS[RWSe@ToAQgClBVrA[zAeAn@{@Le@Ug@TGb@a@?cB~BwAe@i@VYk@qAGO^Z~@g@\\fB`Fj@p@zAMdEnBt@BRRe@rA`@xAiAK@b@w@d@XbBYJAd@cCd@Sp@TXk@Ja@vCmDIQh@gAJYz@Jx@mAd@uAu@i@Jv@~@[~Aq@^f@~@GpA[^bBbAwAzAd@`@]t@p@b@o@hAv@?Rl@vAk@lAv@r@@LZ]nBm@j@o@@Qf@yA^Ob@lDnDiAdAd@x@aA@N|BWdAtAhA]nAp@jAMRp@tDx@@VYh@RYt@|@d@b@hA_@z@AvBpCpFk@t@s@Pb@\\L~Aw@r@oBO[b@DbBg@Xd@zAe@`@j@tBcDdBiDlLYpIvGdTYzA`@HDj@c@~@Td@Od@oBxBYhDNn@k@x@XfAi@fDv@nAe@l@lAhDYz@T|@fEpBP`Bb@HnC_Er@XRUnANlAx@j@GfBh@b@`Bt@Rd@lAb@KIp@f@@Pt@|Ad@SDX`@~C`A|Fi@|AzB@jAn@\\hAFv@q@Gn@`@SNZLY`EHVWt@XhAi@j@`@h@EoBvEv@PQ~@dArBmAxCBf@~Cs@hCb@zA}AnACz@k@~@ZtAObBmAvAZBvAzBjD`CkAbAZzA|BS~@wABe@f@G|BTj@y@ZBd@x@n@W|Ad@jCwADCvA{@`AqC^O~AkBxAYC[v@eB{@e@r@aAfEvBGMjAXt@_BxCE~At@k@xD?|FqEW`Ar@f@Kr@jDq@YgAjDiG`BLvBhAdGfAnAHl@c@j@Rr@c@b@rAjClCpCgAp@FpAe@dEQa@qAdAFDj@r@HLv@b@RgA~Ew@n@KbA~GhDjBlD~@v@dFDrEi@BR|AEZv@n@VLdAdAb@f@fAf@w@lAP edjEymRPE?d@YPFq@ gvpEsrg@EcAZF^YF^ZaAQbBq@CUV owpEwqg@[LOo@\\WLx@ qupE{vg@m@EHq@@TRWx@Lb@SAb@SWUt@c@A mypEgxg@k@]PMv@X]P s|pE}xg@k@@[g@fAd@ wrpEexg@V_AFb@_@Z gtpEmxg@KQ\\GQX wtpE{{g@zAHsAT}@m@Ca@x@n@ uaqEs}g@[QkBcHtAjBClA^RTfB ezpEi{g@{@k@Ki@fAtA evpEwyg@sAYaA_B`Af@\\x@zBZeAC e`qEqch@m@]d@Ow@FQiAr@Dp@|@Sj@ yaqE}fh@_@e@d@DE^ kgqEihh@WI[kCb@r@N`B qpqEoth@k@_@^GlEjBwAIiBy@ qmqEeqh@uAYz@AXZ kxqEuwh@~Dj@sBO^`@n@NASBb@qAc@uBBuBqA~CR w|pEmpg@KW`@NUF asqEg`h@m@a@N_@d@B~@bBa@Pe@w@ cnqEk}g@n@j@sAu@d@q@e@ZIQjA_A\\d@{@jA eoqEwah@@]^d@a@G szqE{nh@ZT{@HBa@Z@ kkqE}hf@]@Mg@j@d@ iutEwoWd@o@PwA`C_@\\RWr@_@GKb@yBpAYM mbiEmcQq@UEk@xANa@p@ ertEsqYp@o@Sj@]B eptEy|XYGVO@V cvpEcmh@Nn@WHB[UP@m@k@SBWr@IJr@ mvpEech@@f@Y@iBwAUDFQ[@iAcAOs@a@EE]Kj@e@YiB{BxCv@d@c@c@JNk@dCeBBn@e@CJX`@UGbAU@TP_Ab@ZASVr@CA]^TAr@V_@XFi@j@\\DKb@PWv@jAODf@Z?p@ mmqEcvh@KU\\FQL m{mE}xd@Uc@l@KWn@ uitE_eWYGRUD\\ mopEwug@GRk@WVDFWAXTC ofpEepg@C\\]CPKOe@^V ajpE_xg@g@^QOh@]NL sqtE{jWKIXMMV {mtEkkWi@WZCLZ mjtEqbVWAD_@RV`@[G^[D {ekE_qRFo@RT[X sxkEknRr@DF\\OLk@q@ qyjEuzQLiBN~@]h@ g|oEcwg@OJISb@OIV g~oEoxg@`@?A^a@BTQSQ aaqE_bh@^~@?aAt@nA@_@j@dAREKTQK@n@HMdBxAnA^@TuBs@SFXLY?eB]kAsCRMUkA s|pE_xg@UPp@hBSBe@eB}BeCP_@Oc@~AbDx@J uwkEonODYh@r@e@@I[ _~oEqog@O`@Di@g@@?h@c@LHWSBOb@UOFy@c@Nx@c@Vw@[p@WGZEKSq@Ad@@e@Kl@aAw@jAKS@Xa@En@u@{@f@AU~@s@VTHg@RNBS@h@V_Bt@?Ol@j@m@R^BYl@VL}@F~@p@A\\j@Qp@eAJm@v@PLk@h@GM ofpEasg@^IWjA[e@R[ odpEivg@VTMJKSWf@Xu@ }hpEwug@D^UINU k_pEawg@@YRHUN ofqEmoh@`Bb@k@MNLSDq@i@ {hqEoqh@r@j@aBy@l@L u}rEqd^h@e@b@\\g@FG`@_Ah@@aA^I sgjEseSIq@j@_AzBcBj@XJ|@f@Nd@lApD_@LXy@|BeBTgA~AuAjKg@dAWOy@Xj@u@YiAn@[c@iAHi@aBoELiE uikEicR{@@Qi@x@El@j@Y@ {foEkaPxBtB_@hAgAJ\\w@KU_Ai@o@Lh@s@KYc@ANi@]?ZMbAd@ }`oE}cREn@[GCYd@M mwsEapSi@\\UU^uAv@JW`A m}pE_bh@kAYAc@lA|@ kaqEybh@@a@P^S@ oypEwkh@Jd@WCJa@ ieoE{sf@d@x@[h@a@eAV] i~oEe{g@RWn@AFTe@f@U?N_@]ZA_@ kloEy|OZUFR~@Oc@j@GWw@A }coEg{Oj@g@VDc@z@_@Y mjtEizVyA~@UAJWWWDZq@C?PYQb@cAT\\Tc@z@IL`@p@YId@ ymoE_~OOH?_@NT mitEsxVUQTC?T oatEe`]o@Ro@]~@O^X mvoE}tg@t@\\gAGPU {xoEyrg@NSTNHa@pAHYp@sAY_@p@Jm@ sdnEwye@HZVOKTUa@ iwoE{ug@[?Pw@Xj@OJ q_qEiqh@?f@{@_@z@G qbqEyoh@WAf@]bA\\sA@ sbyE{|OONI]XL","border":"m~jEmjSmAQg@v@g@gAeAc@MeAo@W[w@}ADCSsEh@eFE_Aw@kBmD_HiDJcAv@o@fA_Fc@SMw@s@IEk@eAG`@pAeEPqAd@q@GqCfAkCmCc@sAs@b@k@Sm@b@oAIeGgAwBiAaBMkDhGXfAkDp@Js@s@g@VaA}FpEyD?u@j@D_B~AyCYu@LkAwBF`AgEd@s@dBz@Zw@XBjByAN_BpC_@z@aABwAvAEe@kCV}Ay@o@Ce@x@[Uk@F}Bd@g@vACR_A{A}BcA[aCjA{BkDCwAwA[cBlAuAN_A[{@j@oAB{A|AiCc@_Dr@Cg@lAyCeAsBP_Aw@QnBwEi@Dk@a@iAh@u@YWVaEIMXO[a@RFo@w@p@iAGo@]AkA}A{B}Fh@_DaAYa@RE}Ae@Qu@g@AHq@c@Je@mAu@Sc@aBgBi@k@FmAy@oAOSTs@YoC~Dc@IQaBgEqBU}@X{@mAiDd@m@w@oAh@gDYgAj@y@Oo@XiDnByBNe@Ue@b@_AEk@a@IX{AwGeTXqIhDmLbDeBk@uBd@a@e@{Af@YEcBZc@nBNv@s@M_Bc@]r@Qj@u@qCqF@wB^{@c@iA}@e@Xu@i@SWXy@Aq@uDLSq@kA\\oAuAiAVeAO}B`AAe@y@hAeAmDoDNc@xA_@Pg@n@Al@k@\\oBM[s@AmAw@wAj@Sm@w@?n@iAq@c@\\u@e@a@vA{AcBcAZ_@FqAg@_Ap@_@Z_Bw@_Ah@KtAt@lAe@Ky@X{@fAKPi@lDH`@wCj@KUYRq@bCe@@e@XKYcBv@e@Ac@hAJa@yAd@sASSu@CeEoB{ALk@q@gBaFf@][_AN_@pAFXj@h@WvAd@bB_C`@?Fc@f@Ud@Tz@MdAo@Z{AWsAfCmBnAPd@UVRZS~@RLeBbCeA?iAt@C_@m@To@YiAt@y@~@Ox@hDHUr@LAfA~@h@Hw@PZjA[Dc@PHBm@XBG}@b@c@Ae@o@e@Ho@h@Sb@VBg@^In@JIi@p@c@\\kB?uIhA}@Ks@w@GCaDdAdAtAUTc@h@JjAsB[s@vBmBR[SSv@k@Be@j@Q{@s@r@ISQXS@iAx@@Cx@t@h@nEaCTs@hBgAvL_Ob@?\\m@|As@|@Nh@yCjBcBMkAj@m@hBi@gAeFz@g@^R`@WRkC|@BHcAx@OKs@TkAXTKm@dBGDj@f@CTz@p@_@^P~AoAQ_Cd@ARz@@e@vA?VqAtBy@AyBbAET}@d@@`@w@UwDq@m@Hy@q@m@}@PMeAxB}AQ_@V[x@ThBEQ_@jAM@a@n@TpBADcAp@c@jBb@`@UrAF`@g@h@Nj@Or@eAdAA`BcB`B]dBiD`@Hv@o@V`@n@Br@i@n@eBlD}@n@y@jCAIkAp@Kd@eAfBM^e@RP~@aAhC^nAi@zAeBlACOe@iC_AIs@e@]kAGiAo@c@PGaARGw@wAa@NWWd@g@G_B|AcBS}BiAh@_A?i@SIq@YPyBg@eCTc@TBd@y@q@_CYY|@e@@Q`@gA?_@z@i@Tc@KYTcBs@cAZU[Le@s@w@Pe@yBiBaAJMu@oCe@[aBZQ[e@JkBuBsA]_BwC}Cx@I|@s@V_@Ia@`C`@lDoBlBEfBa@L]|@F^[GmFcCsA{@JKQlByAFm@fAZ^lA`DPBd@fBp@vBWRi@Wq@lA_@U}AaAC_@a@iAMm@{@s@Gc@_ByBOw@s@QkAxAGTs@r@c@`Ad@r@WZmBv@WPi@d@PdEcCIq@rAsAp@JPd@b@YEk@fBm@tBNp@y@jBt@DdAb@XjBUz@f@~AS~AvAb@Uf@JV^Mp@x@h@UlBrB^YfBRThBJ\\gAb@?~AyAvDStAqC\\HTt@dBRn@k@`C]Ta@h@\\~@URc@Oi@n@w@xA_@fBf@~CaIbCY@u@t@w@Q]Ta@dAOQ}B~Aw@nAT^c@wAgAyAI@aD{AkCb@?f@r@dA@a@i@?s@i@CKq@}CeDVaCSaAVWUq@\\o@~DtAj@i@FmFb@Gn@h@_@rDxClCtCPx@{Ca@wBZ_@DaBdAg@Uk@Ng@tEkBb@aA}@m@zCwAJuAbBW@g@b@[|@EZiArACL}@|@CLyAnBk@c@}@v@[Ei@r@eA[o@w@GuCf@MSf@kAy@g@uAwCcAQNm@q@G}AuAb@Q^mAcB_@i@}@EcAaA[uBbAe@tAkAy@}ArAcA]yAjAc@AWf@k@FCb@gAAkAd@]`@A~@c@XLP_Ax@On@uBHG\\oAh@aBOPmA_@g@{D}An@kAu@aBuAGo@q@{@OKoB_AwAMaAyA\\gCxAZnAeAdAHf@aApAqAl@cBiC^sA{AcBOy@o@YaEjDUl@e@AwExFWIq@dAWIw@v@m@HeA_@L]Uu@TUq@cBQ_EwCqDo@FoFkAW^^dB[fAoBVu@hAe@Hw@[m@cAwDkBqA{ANG{@[k@PAx@i@KCq@cBx@wBILu@{@Oe@uA_Cg@s@s@F}@~@i@t@iFo@N}@g@e@DOaBWKgBx@]_B{Bg@mB}A_Af@yAi@]k@{Bv@?u@q@{@Jg@}@GoAeB}ArC_BbAWc@UDeBfCIx@yAR}@`AZ~@?nAW^cAIYTq@a@aAf@eA@@Qi@dA}AVo@`AcADmAlC[k@_AMyCFEeBaDOeA^u@Ui@VeACeA~@w@vA\\^]RLJy@TqAMq@b@i@w@qAPJUYQOPq@e@QTU]m@HYuA_@AoAx@gASeB~B_@w@iAFWVPVwBjAF^sASy@\\b@bA~@HCXl@V?n@]Pr@TGj@`A|@G\\\\^a@XNXtCT^u@h@Ax@nDEpAt@`@Qb@Ld@s@v@r@zAgEZM~Ao@NLXc@xA~@bAeAp@`@l@q@rA^tAUt@p@n@MjAgAa@Uu@u@I_BnAw@UwCN[xAk@?QVc@MYs@_ALq@^]dA~A~@V^Ib@mEbAw@|@{A^Sp@s@Zs@F_@q@iA[uB|CC~Bi@HcAyA}Ao@c@L_@tA\\\\uBR_Aw@e@XeDIuGcBu@b@][[Lg@`BUVm@C{@fB}CS","pq":"sgjEseSCIKGBCC@HMCOHOTWJWJCTUHFHCNQ\\q@VIXHPNJ|@ZFJFJl@JRLJPBDC\\Ef@MJ@LETAHEFDPED?CNJHCFODCHMt@K\\@@INAGOCUHKLAFGBUACEMDSTO`@SLOXMj@@@EBD?GBEPM|@e@tDGnAUDB@CA?DARACCB?BBAGH?REDEACKMAQNCGICMNKDBMBCDBDCVc@EOI@ACDE@OEMIC?OLENM@F@CD?FKMQA]IIIO@IJOCABCCIC??CEABCOMKu@Mk@OQC?IGS{@?QJq@Iy@Lw@AS","dots":"_exEmy]wQgpASlf@uCmCk@QwBtQyAuL{@Uw@xXkH~mM?EEA_PmKA?A?EqyN{@rwNA?m@TC@?EQezNcB`@g@bGEuFSJCjtNsIk{L{@vaMsAUeC^A@oCkiNyJncPcRoJoByC?AyAo@u@uD?As]{kB?EUIE{CaC`nAA?gCN?AuB|AoFbDGXE}B?Ag@xAoB}aAsC{ECq_BkAbfBA?{Egd@gDl\\m@s^AAw@zXm@vfA","foreign":"qjfEcfKuDxBgAgAsGnBmJ`Rmd@t]yMxVuG?xH?wz@?|lE??wiB?n\\?iAcDt@x@|EqA`BzDfUsFfEsDgBiAqEiRwFwE`HyBg@qCzAaFmFk@uFyFaFYeI s{_FowH{Q?yEeCsA{HtC^vFeFdA`@w@sEgL}L?fF[_B}GxAmDiAcDuKoF}CuDmMfAiBiF}EiCFAuApBDuO{LcPg`@yB`C[nCpAt@_BxAtCbMyB?aGgFgDsGt@iDaFqCaFbCt@nFcCjJeInDuCqCo@`DiIbDMxJbGlCyBvDv@bCgAdCnKnEaRmAOuAkEGmF{EsFpKbClBrG?mArF{IEsAeFyJQiMfGx@vHkD{EoIzHgEl@[xBeBuAyLKiCbDL~HjQ`IrJnAfS?lDqAbNpA__@?zxP?c~I? yldF}eLkAzD~Hb@aEwAvAoAiCw@ uocFwjMMvCzHbDmH{H ezcF}iM}ETf@bGzJfENqIuEoC ipfEsxj@rBv@~EaBlE`@n@dBtHaF~ElLhD~@uDhP_HnHj@bEyC~EjCdAh@rNwE`E|Bv@MxApJq@C_BbCe@bO~BdBeCs@kF~BmA_@gGfCaMlF`B?tP?g~Egcc@?bxF?cxF?fyB?gyB?tg@?uH?T|BvDAuCvBnJYvC|A[qBzBgBEzCdEScC`F_CkA{BrB|CjDtAYe@pDjCzBdImEEiCr@xDpFP`CpBtBoHbBxEbCcALpBzBNeDhArBxAk@p@lMi@gFbDoGk@t@~CuC[eA|CdHfEdAeBhAt@}@n@vAjGlBFtDfFcBcFfALAmBlAfApBy@sAv@Z`DlEpLh@kIrHwAqCbFnBpBxHKCbHnA|@PoDT|BlG|C^gEhFnAbAgBxAnBHxHzDhErNkCcB|D_JCoBrDrGyA_BhAfC`DdAwClEH_En@lChEy@rDfC~CpPwAeCp@lHlFxAUmAyAbDkAcA`CrOrFHiCpF}B{AoBpIhDX{AzG{@yCl@\\hB_H]hD`Ey@hBcAm@\\hCpKs@fAmAqCmBbJ?mD}B^gBdGbDMfAdFU~CtEtAaC|CQoElDlC~Fz@kBrFMBwF}CsBzAq@xNzEj@hBsDP|DbDuF~AjExBnFaIhTtEtD}@rChDGgCnGoMjDJlB}GTtA_AwJpAhFg@iFpA~DMcDjBRiBmDoNe@|FqAbK~DvDeAiDxCb@~D|Od@qG\\_HdFjBfAzBw@yL~JhBpG_CfCj@fGnEdD~KqL|EwKHnDcNfRdEEnB`GrDx@nCmJt@lDhAII`JbFxDjD{EhJhFhArCpBBxFoC\\oBeDaClERKaFnApDyAdJfFvDnEwAUsDhIzAYmDnCvB|CiE[zE_EpAfG`E`AsDxH[eDlBZbDqAv@tCMpCrDrBaB[~AnFf@vAqDKhCtCMqAZpGnDcAwBxE_Af@~@kB?rGr@gAcA~DcA~A~DqDw@vC~A`Mt@hFrGu@qDdAt@L_BwFuCvF~B?lHxKlALaEmB\\bAeAqAw@fBt@EqD|CkA}@tExBMeDnEVlBfJhHl@uAhB|C[|GgL?oAbEhBd@ZsDpAhIu@i@ZpAiIhCmBrD|FxI|FfBnHHrDkB`F~BGoDbC_DqAq@{C|Cw@cD|CoCZxB|DoCs@}Ct@pAhCmFwEqApCn@t@gIh@|AdAcA[bApBoFeBsErAqDmEwDLyG{HMg@cGlE[t@`BpAwF?~DtFcAu@mEhC~AMuCjBi@aAuC`GbDwEbDrArDtEnAlEw@vC~AJkBn@hCbCk@RhAdE_BmEwBLyDrD?i@qAtGx@pCkCiCcDlBXM}AtCa@uApC~Bd@aDbDfFpAf@}GrApAbAw@w@cDdDtCl@qCaCyCvCIYqBbD~DXqDx@|CoBzCt@pDu@v@w@_BZ~A{AOzAdDjAZSqAf@xB`DYaD_EhDCxAiBt@~GlE`Du@}GzBfCpJv@cBzH`BwHjAN~DiFvRbCtBSd@aCjE~BxB}G|CdAhLoFmBcCnAeB|Br@xAqBnHiArC`BAsR|@oBfE[B}EiBcHiFTgEwLzQkG~EpC~FNbBmDtDsA|GDDdBtFp@hIsHtGACoDrNqMrDfGrHIfGdFfBy@f@lBrCP}BpIfGvFhGLl@kAzKjIjEkBRmE~GbAvCpDzBlLzRuPfDdCxA~FrC_C^}D`FwBxAhG`EhADlDlHbFjEqAdCwFzNwFjAx@zCyCtE|DcA~ArI|IY~AdE]x@_I}@dI eywEgme@o@rAhCJrD~DjBw@qAqApBGHjFdG`FrDdMhE[wCbDu@}BhCfNbDhD{Bv@SqD}@~D`CPbCbFfCSgC}@fGfAlJfIjBOaBbAtA~DlCOgByBrJhCpD[ZtFzB?iCZz@fB~@kAfFvC?sDbDbCw@wBdCgAhP@t@qC`HObRcHQyKjCaG_A}DpA{HgCkBnBmFwBmEcOcF}BqEiHiBkBuC_EZbAeDzEhCG_DoDyDoBk@sHjDiFk@zBs@iAeAz@cA_KwB@hBsDLOoAe@vBwEwB}AhDo@gByE_@u@aAbDj@qDcDwJPqClGdA{H_KbD}@vCnAeH_F{D{ErHeH\\wClR utyEshi@iAF?`A|JnBaAsALiA_G[ i_{Eali@IpCxFpA@w@wAcAVa@qDeA wk{E{oi@e@v@`CnAYhFzAL|@}AoA}BzBUcCkCcCA }m|Ew_j@]h@`Ea@sCcC{@Zj@~A sz|Eaok@fAt@bIwG_DEkFfF _tcFazl@kBSEfDrJ}@aGuA yldFqkm@sBXrEzDU|B~EPsCqEhBS_A{C_EZ g|vEyah@|@dEvCgCdKf@u@uC{BO~AImEk@w@lBwEqAk@xA q`wEmkh@rCjDxFqCmKY yseFw}n@oDh@xArEbC}@m@_E uw|Eklk@qDjDKjBhIkFkCk@ {~jE_kSfHaB~AqD~Qc@~C}ExAtHlFe@yAjBtFNrFgFaC{EsF[aAsH|AqIzGeE~BTdCvOxFaBjBlB~DEPwOvBoC{DaEnDaG{Eh@bAeDt@pA`BgAt@iELzBtC[_BLPkDaBTjB_Bf@dAa@aCeEq@lEZpDgFwCfFZ~GpAwC?oFzLwXkCcOfPaMG}SbImP\\sOyP_CnBaCyHwDuMmZwKmFe^uFkApBcLzAgQ_C{UvAeCuBcIi@sKtBqClIqGgGsHvMeKkBeLxCwHfIqIJ_DqGpGwIjAwGmKGqBoFwCxAaFi@yDwF_AzCoIjD}D`F}FMyDeFsCt@mFsDeCiE_GnBqEcIuKp@vIJzBtOzBCd@xIpCpF_BfAp@|BcEfAHpJcDdBiDlLYpIdHvXcExOjApS|F|EnC_ExJnBvHnJ|KVnCdFhRMoBvEjBdEiA`EhHO`NoEvE~GdEo@zA|BqCjBk@dEjA~H{MlLkCGaAfEvBGJ`CeBxFnFk@|FqEN|CjDq@pCqI~M~C|Ei@nD`F~NaEjB`CkCrI~GhDjDdFzOUfE`GtBe@i@aIZnH awhEu}Si@n@pAbA|CqD}A_@gB|A yfhE{dUKhDdAb@t@kHOi@eAPYtB kfhE{mUi@bAh@rAbAoDY]i@t@ {~pEmv[lEnI~FoBdChElFrDrCu@`D|EpH@`DmEnIkD~@{CjFjGfIcApBnFvK\\uA`GiGrHvCtHpIKvHgIdLyCpIvBtE{CpCgIoMcDwDoGd@{LoEyKhH}GoFuGJgB`Dw@}FkDiAeNhMkFbBuHwBmBvU}EtAwHrNsMp@w]kCqIKqK`FsHpPyI|Zmf@hE~AhSgGbNUpCjCyBfC|FjA`EvF`AlGpJd@fJtESlBnD}@IcFvJmA~M{KxD[|I`JbFiAxBbIlHvAzEfH~CQjNjOxGmC?uTgIoIR{OxFqEyKkMRqLiEcH`EuFpBoM_DkFJwCjNwA?fGEgwBwIcHFhH{B|@n@zFeBdCcO_CsJvEiEiCe@{@vEoEg@qMgCmBtCwDk@cE~GoHtDiPiD_A_FmLoCf@sBpDoH_CeGfCeHgGpFvFq@bDcOvJgDlDH~BeEzAyBpOoH_DO}EwA~G_EuAc@|HtFxHqCw@xAnHpDpAoEbAP~BaC|DcCX_D`IaEGs@dCqHbByCsAuApCwDRaD`DwEiDm@iFsLkAuCuCmH|CcAq@{KfL{GrAlObMaErCuJsEuBfClEzADjFoNhEaCa@eC~BjHpINdGxIxDh@~CdFLbFsDxDjAdDqAfEzAhCi@gBhJdBhDbK|E_RvEmA|CiJxBcBnCaD?cLrJsWdD_CxC|B`B|@~GaDxB@xBgFpDy@y@mAnE{FmAmDrJ}Bj@fAdFuCvAgChI}EpAwPzRoE`CkBeB?lDoGhLuCl@eAeAfA|EiArKeAxDaD`@QfG_CpAuFcGQ`FgExFiFOgCjBCpD}I`FmFaAjA~IbKvCR~CcC~AAtCcCd@kAnFmDIuDpE_Ci@QpJbBbAmA`HrHvAwFhGhD`DaBnCtBnHi@{G c_hE{vUh@wFfFiGRyE`IaL`BhAq@lGvEgEbJqA`AgEqCa@_@wBvB`BWyEbAbA?}A~BFeCzExABxGyGq@oC~BI_@y@lBJ_B`E~DiCTiCBvCjF}GzFeAzBpB~LlBrSiDnD~@?dB?k~@?deLgNyAuEr@tB}CmMzDqNnUyQdNXdIxF`Fj@tF`FlFpC{AxBf@vEaHhRvFdEfHjHuD{DgUpAaBy@}EbDu@?hA?awZ?d{@?gGkNvAKvC~CjFqBnMaEtFhEbHSpLxKjMyFpESzOfInI?tTyGlCkNkO_DP{EgHmHwAyBcIcFhA}IaJyDZ_NzKwJlAHbFoD|@RmBgJuEqJe@aAmGaEwF}FkAxBgCqCkCcNTiSfGiE_B}Zlf@qPxIaFrHJpKjCpIq@v]sNrMuAvHwU|EvBlBcBtHiMjFhAdN|FjDaDv@KfBhEfDd@zCiHnFnExKe@zLvDnGhObEvEfFpCmIrKuBbIh@dCtBzUwAfQ~BbL{Av@sBx^vFtLlG`BfI`EhDrCzIxHvDoB`CxP~B]rOcIlPT|RuP`NjCbO{LvX?nF gigEwzUsAl@NrFfCsAg@eH[vA __gEuoVqAvCzBgApDv@nAcJyDx@qB`D kb~Ew`k@h@~@{Au@_DxAnIrBsA`BeFaDo@pBWkAoAp@rAnElAqBxBt@mAnEpA_C`@nAvAgAl@x@dCaD~HN~A}AcKyFuGk@ oa~E{oj@oAbD`AeA\\`B|DcDmE[ kj}Eijj@}A_EcIuAlBnFrHd@ sofF{tLdAdAvC}AeDy@w@pA ytcFsvNCrJxCnClB{FMoGg@dAmE}@ ycdFegO{@f@IfDjCdAR}FyAW wkhFqrS?jJrFt@vDdDrDxKlZ|Gi@dJxCsAmBvEbObU~GdGpLfBnGzNjNtJxJx@hBrHnIfArHhGqC_PoW_[sEg@{GmJeEv@eG{EcMuRuIgFaNiUPzBaBRGcGkFi@_@oCuCw@QmArBOs@qAkCJ_B_E]fE}GoFt@_BgCcAs@kGrF}FeAoAdAeBiCPZrB{JzGTcEjE}AdAuFqA?r@kE_D|At@eGmEsMQfu@ sffFu{n@oB`@@rDhI\\BwCeEDYaB","sea":[[200,"gmhFg`k@f@~iSpLdL|a@xr@d@fT~P~By@lCxMvO?`EjLfJHdJjKhRri@zc@XxE`QdUpBfSyAlDdFtRaCdFx`Axs@|n@vp@hc@pUdBhL`UnSpR|HxNSfFvDmBaGbP_CjZkR~DmOw@wUdGnL|GIrHzIpi@|MnOqAbO|BtJ}@`AwEnE^pG_HvA~CzDQrOsPjE{Lbd@o]hGyThC|AzCmHqBmSlBk`@sOuS`F~@pEjIdEy@kFqX`Ej@oAwEfCcF_Ikh@jM}BbDrIzEgCbAtEhGaA}CkDt@aJuLsF}F`G_HwKu@{KuGaF_AeKbEaE_PiNpC_GeI{OzBmFmEuCzAkDoImP~AcFoBy|@pCImC_BIcUj@eClAzAbDwWUaR`Fsb@mB}EpBon@xByY`D}EcCsDf@gGcD}BdEkZsCyPaGqE{Po^{W_PsS{Z}H[oV}S}\\_MDyF_EeCbEeDWqDkJv@IbG}]}QyCmF}Z}LiC}E_J`CoDiHeKuB|B}EbHtBkEkEaTjEq@wF`IeBgDiEePpJJwIuIuCcCfDWiGuCcAqGpGiGl@wAmCcCjBmDkCcBfAqF{FsItAf@sMmGdEyEkH|FwFkGoDaI^zCuG{BcDgWoI{FiN_Hw@`@_FeFmEe^kLs_@}BwLqFwBlBmBkDsGj@_KiEePDeGcJoN}DuKvBqS_E{DfBqGmEoCrA_DaGuJaD mocFkyg@`BfDlAaBdPvAz@jFyIfHiIiA_EqNpAuB adzEwg`@lCrAu@zLkLRaBgF`BoFrIkA _d{Eut_@lOdK~GxMsO}BeJoG_@}KjBs@ kbyEwn_@`HrApDzGoSI_A}EzFgC oeyEi|^hJbBp@lDkQNqAmD`GsB kd_Fcz^rUhHxM?xO|Qj@xIrIM`AzBoOdIoPf@uB}IyW_E_NwT[qH`IuD {`{Eyp^jQrE{Jn@oEcG wocFmnVpNjDrAdG|HvDi@pHjHbHvCzU`C?~FxLOdKuVu[kHtApCdMwMwCcHwGcCgXmIaIiJKfIiS~HjFhJ_Aj@kB}Hj@cH}DzJ_B ccbFw~UzPj\\{ClHwMg`@v@qD qjdFqhUzAlB}CfN{AeI|CoG cf_FyyTf]bXG`DoMcBiBwKeKiM kl~EkwTvKx@lJ`KiEh@mC}FoI\\}AeG ucdFmbTbKj@x@lGiOu@jAcG kacFkzSrJdFzDrLuKy@iKgJnFwF iv~EclSdKjAbHnKgFnAqRiEmE_G|JaB _k~E{uRrHfReBnDySkJsDiIdMfBxDiE wv}E{pPrGhC?fD_K^{D~EgFgDzDyEzE~@vBoF ok`FooOpSlB}SzBJiF ck|EmgOfKtNaEC{FwFt@yF {}~E}bOnJdHaRRw@oHhHI _{vEg`O`FnDaFx@mChG}A{LjFw@ a{uEwwNlHnGw@nEiPnDcDiGdGPV}HxDyA uk~EytNj@`FzE}@vLbLhPlFgYtAyScUvFgE abyEktNfF|IW`P_L}HLgK`EyD ehuE{{MxGlAxJfLkb@oGUyClNkA ctxEmxc@kFjJjBlD~ByO c}gFcuR{BhHkKZ?dfHhIn@`@sT~K{I{E_Ck@`FwCJmAoCoDvAu@sDpSyFlBdCrCuAdAmPbOiLhAsK~DcElBqXdDcEw@yMlBqAzElDd@{GwGz@dC_IiKiNfWc@fHtHvH{WjH{H_HmCnBmEsAeJoFvEtA|FcDwDaLp@nDiRkPkR}PmEb@_TwEqM_NdA}DiIoEkA[wH u`hF{~HaClHfUhFeQwO emhFcaHElYpc@Ad@sLoFeCcCpDgGNuPsM eofFyhG{C`AdO?iJaA"],[1000,"kmhFkwj@?doRpBtP|KpJ~ImQdELfDbHiDlP`VdZ~Jl^pF?dAnPlGvDxBzNxKdKFxLf_@na@vOzI~[xk@lRtr@|RnGrAxEzM|D~TbRdJlZnKpMfg@l[hj@xl@fKyCK{D`XjAbEcHzJeEiDmG|GnB~FyKqCgMgF~B{FsLbDgBhIrErHeP`@bLxE`G~KdAnBtFrj@nK`MoM`M|AdD{EdF|@fV}LpCgKxDjEvWiCdQwTuEsDr@{GdHO^eD_TeS_AeI_ViDiEkIySiFmFuXlQqQjLfFvMiEp]rKdD_KlHmFkDeJ|DmEgCeKvCgNkDwGoD\\oAaC|DaDg@yG{L{NsDqNqXaYzAaHqFqVlCmGs@mIlFt@QcM|CzCdEeBrAwIcBqxBcH_SyYg\\wQsJiJmg@n@}FiE?o@sEqGsAmNvAaBaDvCkD}GgHuLj@qEpOuLoGqFbFcQ}Ar@kDpG{AiD_EeNgCuGgHbVgCcWqMsAwMdIuCrJzE_AoJkHyFrRmYbIvGgBjBkHkBn@jEtJrAzFiDdFjClAcJjW[qFiHxOlGi@gJjBkApTtToFbC{F}EBfScFpD`IlItIcLzJrEvDdI}NzA_MnWvDnAvLuClN`ClYlQFyE~F_AfB{J~DlBpCiKvD~@lA}Be@ePgLsWiUuUcKeDiBeJqFfAwEyDqAoQib@{YkKgBeg@|@ei@oKDuCiMoHyg@{AmJmG_BoGwX_I?eXyZmDuKuHoDzAyC}CqGtBgFuGub@QsH{EqGxFqQiByO|CeZaU]gImD_AeNoVwIo@rD}PbGkEkOoIz@kGuG{AiHiUoNaDcZdCkXeFcNuH sv~Eib_@r\\xQrMpNTdI|H\\zDrEaWlImNXeFyI}U_FsSsa@n\\}I o~zEg}YpC`JoBxEoCyKlBaD _kcF{oV`LlD|IlKnPvg@lLxL{FpSyIoNoKwFw@jGgHrAdJpG`GbMoBpD{RgCmImLhCmGoAmE_LlNcNoAcDiU}JoMlUwm@hFuDlNC edbFuaVfSf]yEzN_Oad@pAaH {}~EgsUrD`Br@nMoKyIBmDbDi@ }k_FyfU|d@`d@TbFcI|@_JqE}@qJsP}V`AaC mn~EizTdO~BvJzLwH^cE_F_JbBuFiKrEuA eu_F_yTbL|SoHaBeEoMpAkB gceFktTzHrPuAdEuIqHnBgM }daFcfT|AnLxFlHiEzCsJuP`AeGbD}@ iy_FixS_@dJnElGqGjBcBbFeEQiFsGxLg@l@yEoEcH|IwB }k_F{rStKdEdQUrLjKd@bDkHlGpHpP{@jCaKl@{P}MyDsKxPtCzCsEeO_EeMqLQwD gq}EyiSnHrOg@jHsJeSjByD iz`F{xRtJ~GfFjTkUmSlB}H cruEgxRhApL_B|AeB_IzBoE eu_FgqRk@dP{A}JfCgD kjbFsiRjDR[nCeQvELoDfLkE }y{E}bRjLnEz@bHeOyE\\yG s{|EefQjEdDsCrRoCdBeG{AqAbEaMnGfDjExCuDzG_@iA~Kor@d@_I_EnCgG|GtBdK_BwQgEyHkKd`@hC`LmK`NfIuBkPvPeE akbFwaQdAxD}QvEvOqK unzEgsPtMpDj@vCwCvAaL{AwNlCuLuE~@gDbOfB`L}D ceyEebPrQnFx@vCuDlB_KyDsEyFzBaA {_`FqsOpObH_SnEmBdDuHmQpOkA wi|EaiOzLrMsDpL_UcYvLaA ypyEufO~FbEwH`I_KkHvLyE c|~E_fOpOt@nCtPzc@`Rd@vDoDlC~AvHcJq@fCwHuWnAeP}UiRgG}CcFrAsGvLsA abyEwwNxIvQqAjN}PuK^sNtGyD kr{EusN`FvAGdGiMcFnFyB c~zEueLrCxD}B`K_HcNhGwA _ahFgdRkKB?`nFbNkG|H_UtIa@tNcM|Hmc@eIyd@nGuRhGqBtHeQ}DaWmYwJuAmRg]uU _mhFu|GK~Tn^At@}HiMh@oQiL"],[3000,"imhFmdi@A~j@zAmPbY{IgNKaAyCcDjBoE{L cmhFy`g@G`rCvF|@ZnFjEgAoCrP|DvJ`@|TeKTdHbKqD|BvGvOoE`XtBxOi@fp@oE|JtErGuBdc@tBjEsGrScDX?hr@rS}C`MtKtKqGbMPkBpGz[`SqAnRdQ`IoE~I|G\\fGpKxf@yY~Hs@xDlCnDaC|GpJ{A_FrFyCzP|MyAcGfDqB`KrNtAfTzEdGpHZpJ|YaClHfElEbFwCaBsU{DaIdMiYjLn@~IqHvd@hEbDzDgH~A~PnRcUBx[lRnA`EaClGnG|@vBvG|GyGvd@~Rh@uEjJwH|GTfGfCPnH~KnJrOtAr\\vXnG^|R~KfHmAlMjGxFcGDiT}De@gEwQqJcJsNk]~E_B`MnKcBqKyDgIeE[HwGoY^fIuEe@cI|ToEz@uNjDgA~ArD`F^fBcPtLuCLaFcNkHwBpHuSESjBjJFxBvCmKnDg@rEmKmE|BkJyGaGyBtA|@jFsBT{GmMnB_GyGa@oHkKzDkNiVoHkm@c@_K}EsAeErBcDtHO{LkKnLuBsHuFqFdBmBwMvMFe@iF|Bo@r^d^FuEwJiGoJg`@{E|FmMEwMlHHqJgD_E`LuDyFqBqGxC}DoGfSiI}@{G~Jh@zExD|HaCdEpCzEiA`BmBgCgIwFcB\\oCcGmGqR{B_JjDsTPoCrDmNwEw[xDjDoMgO_GaVgf@|@wDzFEeAgDbE}B?qGiQ|B`NiWe^}B~FaO_FqHn[i@lNzE{ArBzBpCbQhD|ElJiHfFJhChIxCdDsE|J~IIrF|Q_Eh@eGkMaEoByCxAqCiJqHnPGdRmI`AhLzDlBzAkDyLgZiSoKeGQpAwKjHIcH{EvCwHvQs@aNiCeRzC{BcSeNkKeSoEgcA@k@mB|Fy@mB}G_JnBqFxKePlBaBaG_LoIkAyGaa@k]yZuEyC_HmNyDmA|IySgFhIpC\\bIeQmBmMgI{DgKuEh@gBtFuK|@yFyC~Ms@_DsH_E~DoEgAIgImIiG ehhFwbf@zFxCxAxJ|IpFa@fEyCMeRwUlBgF wmgF_`f@|ElGArGmFmCwAsJhB_@ _igFm|`@|QjAbDxNyOyBgFkM __gFoc`@xOhFzBlLcL~@mBeQgHeBbDk@ gsbF_x_@z@rC_DhFiJhAuEkD|B_DdP{B a`bFge_@`LnAfAvCcSgAxC_D s~bFyo^VdMgEzBnDaQ wlgFua^z]lShA`HgMIcWeVs@sCxEk@ _zdFg_]`FhAuCdNiKrB}JeEtCoFdPmF axbFiv\\rIh@jKrOwKtAyOiPpEiB cj`FgwZbFtBgAtHwInEsEyHnKaI sc`Fq~YdEdGePeA~I_E szeFqlYbCzEyNp@_HrMkDr@q@}FlIiLdPmB qj_F{iYxDjAm@~BsLdBKeCrHkD ybxEu`StEfNiDzEyKuPlJmC kt|Egwb@yBtAlN\\sJsB q_{Eq}\\sA|A~MdNuBeLuG}C yvzEmz[oLpCeCjGnCd@dD}Gt@zHhTrDoCiNoIkD }q|E{vR}BbE~F|LaCaS acaFwpRpA`PfFvByHyS }l_FamRu@zIbF~D`AuBoFeL cmhF_gOGtm@tJkFtKlT|FPp@}GuKaRL{GkTmW amhFgpMIveAxR_RfCcVmAwJyDQ{EsJsGuC"]],"relief":[[200,"uulEcul@sNnMGzDiGEiIpHqFo@KgB_HCsG|FaNaDkR|G|FhMbEw@jAlEhJeB_J~CNxFiEZs@xFvBt@p@{Bv@nAtHwEkDjFd@tCk@oBeCx@[rH}A{@tG_KwFhCo@wA?fCiCp@j@fGeCaBsH|Ax@rAy@eB_BnBaCs@kAdBnB`CiLrFgDcAsBzGoFqBNlCtElCbB{@uB`DfDKbA{B@dFx@oCZtAnDsCsFzFr@nDhBQfBcItAxBLmICpBpB@{@nAbDRsEGRnBpAhAi@cC~D~@DzAb@_B`D`C`@kBoEgEdEvCXmB~AnA{CgElEdDkA_ChE`@BsEnC^iCoBfHfF_I_KfBjAR}AfIvJ|DmE|ArAfEgAg@oBr@hBfGiBmCuC~LfC_IoHzCg@a@_BbDhHnBiBIpAvBc@w@sBfBEeDGpDoAqGeNjBIVaFlE|HiBQaBdDlA}@z@jCUuCjC`@_C|C~AQ}Al@bAjCzAiExFj@c@jB|ExGi@hDnDwI{BRD{CrCbCbAw@q@`FXmBj@pA^sB`Ap@wAjDvDeBiAwA~Ct@\\oAcEkBnFN{Cc@CuBwCx@^eChB~@PgAkCyAy@hDCeBwAl@|EgFoCNN_BoCrDzAiCaAgBvBb@sAgBdCaAWyAmBb@EmD_CEbEAsAgFvAzArG_Gm@_D~AwBOxEhCs@oDvCr@fBjAcCkAxC`BbAaDd@Q_F}E`ENpBdDMwCfCjBpCeAv@pDZ~CuBgDn@bDqCUqE\\bEtAUsAhBhCCKcDhAj@?uB|C{@wCoGx@}Af@dHtCbA{A{IqEqAEcCvEqCgCz@bC}Eo@yBz@vBzA}@gCrCpDa@pFkN_EaCeBx@mGgFoHJqDgG wwkEgxk@wH`IdCf@sAtEnBwAMtEjE|C{@~AhLp@tDgEvBNmGvDzEZsKlHfBfBuAdDbLsFmBoBrC\\mAs@jA{DNdFzFcFvBd@`AaDtA?g@`D|KeJ]oHcDuDsG_ASlEkEjB_JoHcJf@oF}E yxhE{pk@cFtBiD|HmG}JgHjI|@p@sA_@gDlE|@hAkBcAiAlDoA[lAv@yDzAh@|AkFfAiAzE_BcA|@fDwAoByDpDtEIuCnCo@cBoAx@bI_NsNrLZpC{AiAwAdAvErEoHeBl@nDwAgAVrByBJ~A`Ac@nEbBQsChAYsHmCrG_DcApEtCWhC]qC}BbB]iCk@dDsBNbA|BhEs@UrGoFaADmEsDtEbB`@]bCyAwCYbEwCdAnBbB`H}C_B`CdAz@kBp@cA}AyAdB~BMkBf@hAbDiBbA?oEw@|D_CT|Ah@oBOn@hBwA{Am@z@|@{C}DjGm@kAoArCg@qAXrGbCoB|@jDnEDaBiEnCnBfJqLhIk@pDeEg@wFdDvCkFnH|Ii@VoEEtCvD{Ax@qC`L}D`IcLpDDgAmDzC{A{A~ChDbA`NwH~@_HbIoMoQf`@nAkCmAaBsFtFuOlEoFzJwHbBo@rCuEv@\\lAgCk@k@dCeEJaAiB?rDk@{CaGf@wElGhDIiKvDbB|BsLpAQiAfFc@qKLWaFoBm@kAnDhCwAFtAwBdBvCLyIfEYbDbDf@x@cB`AbC~IcIj@hBbAqAiEfIiMpFKxAvIeCuIxCnCa@o@dBzJiFnBr@l@iCmBNdDkB_@nInFiDjA_FoBD`CmAsBcFzAvCfEeDiD`FtJgANkBPpFvNd@mM@}AcD{CtBiDq@hAdDqB}@u@tGtMiB{EnBrBpAgLwBe@hAvAdBzCs@{@tAhEvCoK}HeErE]lCvFiBqErDoAxIdDa@cDhCjHRwA^v@dBmFyCc@jD|ChBuBfA~@`AeEYh@aCsBpCpGx@uHjFzDnBGkBdB\\{AyBzBxBEuBn@tArAsCNbCzDGkBuAj@gBlBnBz@{@gBq@d@cD~FlK_Q|@HvBkAi@\\rAeD|AxCtCxFqAeA|@rA|@wCNvB|@cDIhFjCqC`@uEeC}@hA_BeBl@fDlHz@dBfCZyBpBzAm@eCvCdDzC{@qA{AbElAkAwBjHdAdAsCuB@nB}AyHa@|Nk@iD~@JjCfMyDuI}DsBwEdAYrC\\qDHrC~DzBAHjC|D]{Ar@nAhCpHeG`Gg@qL`EfAzCiHiA}CrAxA|@sN~CdDdAaFi@jAzFcDwDs@|CkC?|Az@eDd@lEjEkFqDOnBeBWl@pEiAiCeAhCkC?r@`BsDaAh@bDcFAfC~@yC|BxFn@wHnAfDDiA|BlEeAgBfAHxDOuBqC?MvCkAmDy@xJ{@mDwAzB?gB}CJrA~CkEB|AlBgGpCtBn@qCr@~@rAkBkBb@fDgAuCkCdABpA~BqA{CfFjBzH{BmHaDdE^qE{E`HcDf@h@gBtCBsAo@t@sBeQ|FjK}@oLrCnHFmBt@xBx@wEz@jAjE_Bo@aAdBa@iDiBrB]}BsBh@e@hEb@_BjAfAcDhEdBl@rAcCn@~AsBj@zBf@kD@QdDtBkAf@~BwE`AIvBlCCuDl@tBpBqDkBiFhD_@oBlDsAaAi@rFLQsDvA?yDaDkAtBzAhBcCWUnC_EfApATqBbAd@vBuAd@FkB{D~C|E`AaIbA~AtArGu@qFtAdCzBsDjAvEbCmE^]~Bi@qAqBl@k@pCmAKbBiByBBvGiAbAaBqBa@yFpCgDu@x@vBgEm@xCjBaFy@fBpAyC?G~BC}B}AlCwCoAfAhDhF}@mGrCpB~BcDlDXuGkEAn@dBsA`@pBxAeDSKlBdC`@sBBCjByA_Ad@kJYzBmDVQ~AhCTsDDrBpEaDk@PnBgAeEi@nBwF{AxFa@@kE_CrBi@{CsBfCoGgBgAzBiFClCjCjCaAfApACsAbElAuHHLrDzAEwAxApBfAeGTlE`CnOPoIjAhNrBx@vCcEkEgEK`DxAeBF~@jB~DhABhCyE{CkBzBnBdEeAf@yAoFxDwCkMaHvA|DgDAlJjIwEJ|BdGcDeBwCfC|@eBoCdArAsCyBHqAfIfFo@{A|CyAZa@mBuGnAeAk@nCMIaBoFnA{AqApEq@sFD^mA_A|DgL}@tEfE|IWkLtBbDn@_Cz@zFvEEwAdDi@u@}AzCNuCzCvAhCcBvAIcCyBbCzAjFcDoC_@bO_JcDz@pBoBf@tC?sDbB\\yFcCkCIdC_BwB_DbEgE\\D`BbBKG`KhCsBS{JfHtBAlC}@mCqC`AhAzDuAOkAjFrAw@SpFbByB{@rBpAc@VzAwBNrBVe@~BiD?k@_DgC|AvE|C}AbCrC^L|B}AbAdBTxDyJZuJfB_AyBdPpCu@cDpCf@|FyBvCcDdCjA_DoBGS`CmC}@dBt@H~EqDoDlD`L{DdLdEwAAwDhDG{HrLd@pCwDS]mBwAlDiCuBp@|LhAkC^hBT}Dt@~BrDqCtAxAdAmDfAvD~BgB_AiBnCvBpCw@}FsCvKDh@}CmE_@x@eApJZaA{BzCgFaEmGzBUv@`G`ByEpBz@iAtE~CqDzDhDoFlCgEvHkBwBMtC_CK`BpDgBtCQiEsCnDtArB{DhAjFpCOzAgBwA}A~@DoCkDuAq@~BoDDb@lCeEaBm@nDiIkA_D~B}B_DiD`CpFlBVjCxCg@`@rCvDLDpDlB_AhF~CqCvF~CN{@gAxAc@RnIdEeAi@vEgGdBaA{BaB\\qApBbA|AyDlBlDnDaBlF`BhAwAx@lA`DhK{@cIcFxA_BbCfC`EoCdD|B}@zCbB`@sAxAzAlBgHXjB|AoCpBrDtCqEdFxD?`@gBrBpCfAmDxAn@oBrDrBvA|G_Dk@oFbDvAs@mBvAfBtCqBOdDvC|AoBaAF~BvHNyBxAtCEc@jCxFcAgCrA`CbGjDcApArBw@cCbEsAa@jE~KrBsAiBsBf@f@cC_FyDnBgBdA~Cd@yEnLwDoBmBbAsAuEV\\{AfBxAhC_CkEyA~AImCsDbCtBJcCjAf@zBlDHoEZdD|@g@{@_FnD|CrBoB]eCwEoA`Ef@dCzFqBnBhCpBgCS_CfDxDhFd@wCjD?_@cD~Co@[}B~DyDq@wCfGmDaAiCqAhDkBQCcDhCJG}HkJoMcKuBmC~D_G_FyA_Lr@kMpCsEo@_DeAjDgDPGyAcBxDqAoBOjCwBu@oCzAdAiAoAcAxIcCXsCtJ]q@yCaWhAjA{BqBaErBOoAcCnDb@t@uCeFoEtAu@bFxCgCiEfBd@hA}BFjCrE~@v@uFwCcGlE`BtB_FcAw@hCIaBgGhA~@LiByD_CdFpC?wLlAtIxBk@q@{B|Aw@uD{Q}B@kCoLjBkIiDgDtFiGqHyAjAkHgBiFVeEzBn@jDkEvD@lAmFbGyFDoDwJcCwBsJvFn@~IeFBmDfCmBhFPdFaNhFhG|BqARgGbDe@`AwDBqRxEXnGkLAiDnBbBjEaCxP}R`FsAbCgIvCwAgAeF|Bk@lDsJzFnAnAqEpCTlCmC~CqF{DcK`CyCrWeDzKmJzRsGdAwC`RyEiNgKdBiJqTk@cFrDgFMsBeFiGoBSiGkHqIxVeHEkFmEwAtBmCrJtEdCe@h@kEwFeAcGyGzGyAbLkLnJgBpCtCdGClDpAj@fFjEhD|LiIvCtAxHiBl@aCbEHxC}HhG{ES}BpEeAuDyAwAgHpCt@wF{Hf@{H~DtAnByGGvEnH~CtBmOjV}RbEcIwFe@b@wAuI}IdA_BsE{D_DvCiAy@}NvFgCxF_HfAwE{ECkDcEoAuAcG o_lEexj@mGjCvAFCnD}Ay@yDvE|BrAWdE`BmF_@vC|D_DiBa@v@{AbAnA`DyDoAQzAcCsAgC osjEiwj@eFdBnCrAeEw@w@pAbB`@mEPnCv@sCzCaB}@?rBUsBK`BqBIRtCcB_@p@lAuMzMv`@wWc@uAvAPhCeFkD`A`BuC {~kEchj@b@|DeCh@hDvCbCqIkAtA^_C_DC }~lE}ii@eFtBmHxLzDBk@cAz@l@fKmL_AoB qbqEefi@aIt@rHxDo@~AjCUCfBrDY~A`BL{GkAz@o@mDoF{A }apE_yh@eCxBvBF{@nBdBi@xCtDSyAhDwAiE{CkBbBUsC kjoE_sh@wC^fCxEcPw@cB~BGkDmBtC}@cDa@xCy@cHsCrDn@rCqEiAlGhE`Bm@RhB\\uBdFpAKoCjGy@JpC`Ko@xG{B}HEvAy@}BDxA}BgAaA _emEcug@wCrMtG}GaBl@WcB|Di@aEuA _emEmyf@_GpDKlCpIoEeAoB onlEuvf@wBdCt@nB{HZ}@vB`H{AwBpB`Dk@nBsJ sanEegb@oExCtCf@}Hr@l@nCpAqBz@~@rHmCbAcCkG|@nA_C itnE}db@kGp@EpC|@iA|BbAPqBhBxAv@wB}Am@ _jrEwy]xBdIzFLcBkC}CGtByBiFeA cfsEkp\\cC~BzBrHwD{Ab@~B}Ab@bBxAbDaByCpDvD]w@|AbEzAx@eI{AoAxAyAwBk@wBeH cftEi|YoBjEbB@OxEbBx@mBrEx@`C~ByK~BlAj@_D_BHK}CiAjBoA}CgAr@LyD o_tEahWcClDsBcArAfDjHqAn@sCwDk@ ydtEgaVwCjDvASrCbFnAwCcDcF kkpEoiTaDbB\\jHzDwDw@wE"],[500,"uulEcul@sNnMBjEpHcJ{EnEvAjFzCeDG|AfB{AHbBLwA`Mu@aDh@pA~@_BfAiCeA}@|B}Eq@v@hEu@iA]hAQ{C{AZrAnAmC]jA`FtBqAyB|A|@jApDuE~@n@}EhFpFw@XlAp@_Cd@bClBYgA}C|@~@fBoCq@pD`Cm@l@_EfCf@{@uD`CZ\\rCbCwFo@bCdBDaFhEnEqA~DmLwHwCiCbB~A}BcKgD}Bt@qDgG uimEwal@oGvBRdCzCA?gDpAhAd@mBvAdFzBgATeCaGgA yrmE{|k@kDnDiF[cCxFTpAbHyIx@tAaIbI|Cf@yDd@|EhAmIRhH`AoBRjD|BwFwBxAvEmBvAeFcBrBnBuArAk@sAgBjDv@lBp@wC`DdDi@qBjAj@ZsCdCo@wClD`EgA_@~BuCK`BViCrB~@zBuBa@jHrDyAhC`C~@a@~AzA[e@rD~EsAoE}DdB?WaBqB`@dBu@uCsEzB_CeAcGnBsAkAq@nBn@pB}C`DmLhD{@eCdF~CsAi@pBhD~@oFq@IrBmAcCcBxFhC}A~@r@yA`AlCj@OwDhC[qAxClAtAtAUe@_CzBfAk@eElEnAcDiChBuC~C|C_Ax@vBU_DzCnAjBrGyFcAiCnBqCcEHkAzCgCiAjBqAmBs@kFtAtD}Bm@iBaC~AbB_D_CqBeA`Cn@_DuBaAUzEkBr@n@}EoDbAo@mE cenEq|k@iFXyB~EkDf@kI{DsDh@gCdCvBGd@lBmGaASlD`Ce@sBnBtCXIvAfBoChBDkAdBpCAjCyCO`EjDPAzB|@aGnLaE`DiGkAeB mvkE{wk@gGdGjDdA}Bb@pBnBaApCnDuDiDnFxE|BmB`Av@`BjET_C}GtAsA`@lEtBkAKnBoBBv@zBlHcDaAiDbBbCxDk@uGpDzFjApAeAeBvGnFgCkAwBpB|Ay@sC~BtBh@mCdCBwA}BnAMJ_Jy@zA}DuAoArBcDcAThDy@yAy@dAf@oBmFmBmEpAOaBjEAi@cEwEn@}DoE _gkEmsk@O~EhNfByMgI }rjE{rk@h@dGfDaBo@vRbDsDQmKlCvEBaCmDkFwGcA yxhE{pk@cFtBiD|HqF{IsGhIfApC}@oBMdBmB{@yAjClA|AuB{@qB~EiD\\rDlDaIo@kDvHbDdC`AcA^vDnBu@}@x@eLqBuCjD[gBmDfLdBnBiDa@WcG_Et@`B~BkDRfCfAeDBJfCzEv@bFmBqC|AtAPgBdDdBb@yBjAvBtAqJuBm@xBmCDlApCuBiBcApG{AkByApDrF_Cb@dCC_DzBd@rBvGjCyAhEz@yCtASrCdE{BMsChFBH_D~BdAhDeHqAg@`ELQmDlA`BMeDbEWmB_EbCtBfEuDnAyDiBuE~AzAUwDhBi@oCiBxEzAc@sDnBiAy@tCtCf@qC?k@lEm@_BkAnAbAlFqGlMnEHW_F`C?lAuCEnAvAm@oGbHdEkElCFrB{Eo@cD~@b@hAoGrBBp@yEoCNxAyElJoMn@jWxEcAqBcEtA^aAyArATw@{BtA_AeA_JkEsCqFrB_A_AlD_A[cBz@`BdBi@mAxAfDwBoAg@|FE}EwCuAcG }glEwok@gHbGv@~A|CkB}BxJdCqDl@~CsClAlCi@e@pAdBPGiArB^kEqI`AkJ sdgEwnk@_DvCiAy@}NvFaCtFmEtAoHeFj@gAoDAWjDtBdAN}BnBxBgBFr@vFx@qAw@vCdFl@sEBt@zEuBrA|AnBdHuGVrCfBIGgFjC|BpA}@aAuC~ByBaGzAbCuA_Dq@pDZjA{A~BjAxLyKhI^aC{BfAaBsE{D u}fEuak@cGBbDfCyDiB}DvD|@z@_BK`CvAmCsAeDjA_E`FpAfBwFbAt@pEpD{EdBpDzFEiDdA_GsChEtF_BT`@aCaDeAaAfGtFbCiEyAkBrB_@{FzA}@_CaCkLrCR`D`E^wDONtCgBcJmElAf@rDdC_AuEzHdCzDnGt@GaDhEvJl@uH~DtArA_Hl@|FtG~BtBmOjV}RbEcIoF]Z_BeGwE clmEmyj@qEnBoA`JhE{@}@jBxBRkBj@zBh@DsDfDhBXsBbA`CbBsA_GkDvAKi@iCcHrCtFiFcBcA cbmE{wj@Z~D{BnArDRBlBrDwAmBm@pAkBoF_D k`lE{vj@gCnApAn@eAtDyBc@}BxFjLeFw@eH _}jEckj@wS|PxLmG|EoH iyhE{fj@yCbGaAo@LjC{DhBaBvNuG|H{NzCcAjECgDcHnAmAhIqAsBwC`B|BJeAlAaEs@|BnAqDI~@vB`CYq@zAjFyCu@rDySzIdMmJcF_CcAfAfBl@mU`LxCiIiAzA\\{BiALyAbDp@}C{BHkBvC`BjBmEt@fAjAbGq@mOpHrK[wEnFvGyAEqCdI_AgGdChD\\sArAtDeAkC~BiC}@ApBhDj@PwALdBnD@MeCzA`Cj@{ArCnA_HeGrGmAbLmLnJeBtEpCgAsDhB_AEnEjBcE|@jB`AoBDbCv@cD`FuBu@u@lF{@sAwAwEv@xCs@cAyArAtAfCqAcA`BfC`@jHsGdAwElAXsB~D~EpCqG_CKnCsDhAtA~@iKzB}@fBvBp@kFJt@xCaCw@c@xBcBeAcCpAfHdAl@hFjEhD|LiIvCtAxHiBl@aCbEHxC}HhG{ES}BdEeA}Gm@fC{AkBwFpCt@eFqHy@dBcCyHmGHiD}EgCd@HnC{CgB_AxAVgCrBz@BaBtCDdCsGuCaL ydhE}zh@xAtHsDnAxAeK yvnEyzi@cClClB|FTkK _bpEgwi@dEbEdFyAkLiB qlkEypi@yCzGlBG^~B}BxCnLeHiBs@mDhBM}H }ppE}mi@eC|GoFiAhGnDdBkA?pDv@uBhBhBdBiBgI_DjB^KgBaC^hEiAk@nAzB|@gAkBhCIsFyB _amEuhi@mJ|MfMaKyA{A }gqE{ei@gAfB|H~AqA~@jC\\U|AfDe@aCcBlCaAqBoBsCdA?}BgEO {qiEubi@iQ~DdHHbHiE mnkEwqh@aEH~CzAaO|D|@|CuDvAdDFg@lDzE}JHlArE}ByEzElF{@hC}Gy@cD gbkEomh@{JnIbFaASiApB`Aq@gCjB}B mllEw`h@MbDlEa@Y~F`B}CvAn@C_EyCH~@}AgDnCoBWTwB {flEuog@sPxSbOgH_DjK~GyETuBkCx@xCeC}CcDh@}D eykEifg@iAhDgBsB_Bv@`DdCmDUpM`AhApA}FJpBzEbBMi@{CdInCBgBmEwAtBmCrJtEdCe@_DOWcFaDKZzAuFaBG`CqAeCcA|BP_C}A|AyBsF ojkEksf@kDJOvBiGoAk@tBdDOuA`ChL{CG_C c}kEsmf@cD^AnCiHi@mBrB`BtA~AcBvGb@{EzAbCl@oGj@rGh@kEfBpAhBpHmBw@kA`Fb@iHwIfC}BbC\\kCsB exkE{{e@gDxAfD\\mEf@{@vBbClEhDaCwD`EpDr@]`B}Dd@`Ev@~A{Cy@hDfC`AiDy@iA`AvCh@uBNaI{ErHxFsCm@zBnCcEYyCnBbErCcBiCnCxB|@{@R~BEgDnEc@\\eB}@vDlDmBrBdB?wCaEo@vBy@vApApA}CyBv@k@qApB?AyCvDxApB]uCuAbFd@vAeDdAdBrBo@e@uC_Cc@oFrDgFMsBeFiGoBa@wF ellEu{e@yAlA`D`DsB|AdAjAgFlEz@_BzBdBm@cBtFg@iBcBtEs@_EO`AiC_DoD _qjEkne@}DvA~ErEeDoBaGbBpA`C_CeCcI|D~Ej@hCyBsBzCxEg@wGnBjArAtC}BRxAVmAtCh@m@kBhCxAcA{CpApBrDJqAwBtEnB|@uAqBaBtBgHgIcB }dlEcce@_JfDrEQbBrB`AsBiC[nByB _ejEw{d@eMfC~BbB{EaAUtAzCt@aAdEwCg@hAaBiBeAgAjCiAoCcAzBjEzBwC}@h@`CeDOfBwA_CuAwHtCbKfBqL^nEjBeGm@`FlCiBIWrBCqBeDjAtBaB{De@\\cCOlFoFC`Iz@JtBcB]|@jAsGZlBwA{Bl@n@{AeEKnBxCiB@XpA}BwB[xCwBiAjA`C}Bs@yAlCwBMr@rDvBPLxAmDG`Dx@iBvAhAzByBnBcBeBcEhJu@{CaHjCRpDcC`@}AdJ}FrAdFPwCj@s@bEdBQ{BjATfCnH_LgAeF|Bk@lDsJzFnAjAoEtCRfHoJw@qH}BaBzBsCxWkDzKmJzRsGdAwChLcBjDcCkCkAkA~Bv@uCoCqA eumE{xa@iGxLiBkBaDdA`C{AeChCmBmAbDjDcDcCsCfAtB`Fy@nD~CZ}BHQbC}Ag@h@}AqEYNmB}At@k@}AvD{@yFqCv@lDiBfEzBkBlC`D{BvBnBT}DbDx@lCwD~@bBXm@hCe@aAcCzAf@aDcHvFkBgDBlCoCp@fCFYzA~CtAqGnC?bEfF_DwB`E|HSx@qLgDh@~@k@oDsAlDj@X}B~AtBo@oEpFBvF_QnBbBjEaCrV{UsBeH u}oEil_@oI~Gi@_Bk@|EcFb@lBVyCp@jCbCmDAUrAlBAmDlEoAcCZ|AyC\\`AbDwCh@j@{B}B]FmBQjAy@aAt@fDmCm@n@jAoBpAyCwDgG?tBt@oAtDzBB~@mCvDbFaFnAzF|BcHAzF\\dBzDtAuB_D{AfGr@sBP|AnCsBIFpBhGuHRvGtFtBeEJt@nBeF{GtB|E_DdEwAsGh@tAsDtBXnD_D]TnHwBsC[vEkEwBfDsDiKzAh@vB_Eb@rDRn@|CcEkAHjL}AmC}AX`CeFgEzApCuB_DOjCyBoWxBnAzAcCn@dCXVvBjA}BnAj@gAaC~Ap@zByBc@bCdD{CpAj@uIpJfDIb@lCtA{AUtDqAeAu@dCPiE{FfAnCrESdGqFmIiAhH~AzCcD\\jBbBkEwE?rB_BG~@zAcCsBmBtFwA@OsD{BtAzBpCmDd@DvAfEXaBlD\\lHrAOr@qMR~DxEaEmEbF@xAfBiA_CnKpA}A|DjB|@iDrBOuDrJfAjAxAcBJzBzCcBx@nAwB|CdCq@}@`BpB?jAvGzBeBt@tBC{AdArAUuA~B?oA}DzBp@lCjIlAiANnD`DeErAnA|EmGB_JjA|@|@}Cr@nCdAiAe@sIuGeBhFT{@mCzB{@bCdLtBmCn@dGjAk@RcLsC}@A|EaB}JgAdFG_DwAAvA_Bg@mI`EnBU~CnB_Br@|ExAlALqBzB`DoAeEuBLkCoL^cHgEz@fDcBgAiBnChAeCgCxF_FwHcClAkH_Bw@LuJ|Bl@jDkEtDDrIkNOcEeK{CuAgIxFn@~IeFBmDfCmBjFNdE{FVaF}@zBsDXNpCl@oB`BtAaElAVpAaDCsA_Cr@mA~BdBjA}EcDtAYeAnEwByCYxBmA wlqE{v^uBbCiL{BMvA{Ej@pGYzAzA~AqBi@vB|EEfCmE unqEar]iBdB~Bt@MdDsBj@~AvA~BaIsBcC uasEq_]cBFlAxCz@oAVfBrLm@qNkC _gsE{l\\hAlMyCdBpDcAg@zBbBh@|@aF}Ay@tAUuCoA|Au@{C}E _hsEehZsKrHWpHgDy@tB~GLgEf@~DpB_B|A|@\\oK~@lEgBfFjBpDuBbAI_FwCnDAvJ~EuBzD_HnCrCgBiA?oClBpAu@_GvCxAa@iDqFaAy@tC{@}FdBy@qBuCfAuAn@vEfCp@~AaCiHoEzAsC iarE{`YaHdE`AuCuB]{@pB?}BgA~ByD{BChEiBuAeF`JnBlIlEdAm@nDvEKrAfLnMkAeBcBnBaAuDuDtCiF_DsGnBY_BmB~Aq@{Bo@|CoH ilsEgfXyHdBTpCpJ}AfAuAiABwCzBjAcE adtEueXp@jC_E}BCjBiGQRbAtC]DnCfDu@HxDxEi@InCfDhBbEg@oAlDpDMlA}BlAv@kEzExCEiCbAk@vE~Em@YrFsF`@i@xBwAuCuBN~@zEkCg@k@zCdBl@RpEjE[`A~AlBcCp@nBtAmCuCkCoIhB|@cCvGCdAwB_@|DxA{Bg@rBhDlBaCjBnDzAq@`DzEtFcCE`DtAqE`AwEuB~A`C_DbB`G|A{BzC|BrBd@aHbCaAeArAjD|CcCrArALm@|CxCqBk@mA~A|ARiB~@n@_DkGvF]j@bBK}A~F`AhByA}BlDtA~AlCoARtBcCQhAxAxCwBf@hFjAmCn@vDj@qBvCxBzAiClDhCV}AdBzCZwCzBNy@oDmCOzCS{AkCtD@q@gFfEbDcDsCu@}HhEtFe@kE`CjC|@}ByDiBrCYvBlCv@iA{GmBcFqG{DbCcDw@~Ch@tAsDhCxABaBtEfHdGPcBkA~A}AdBpATwCwDkAN_CzAHGiB~BnBwAqEhD`AmBoDfDpCkAcDbDpCiA_D|EvAKoBqDe@hBOCiCmH_BoDtDaF_Fa@qIqH{BwB|GkFJjA`CcBZ`Bx@yCpBmEU{ExEzKwKcFYg@dBiAyA{DjCwAwFtCo@eLaCoC~@UwA@hBuDLBpCsEwElDdAu@s@jIsDkFTOsCkGtAbAgDbDg@cDo@t@_AcHzD_BaAFtDoAWhAwByIuEwAn@r@oDiFkA"],[1000,"qulEqtl@u@tArA?oBd@vAx@gB]wAxBPfDu@qBeDpFvKgAxCjAnJeHoJa@mDuF k|lEmol@}GxGTnEfGiN m{kEygl@iFpAAtBfEo@iGnEhA|@tDyEv@`DhCoA?lAx@iFaD{@y@~ALeD qclEael@cN~ExFnAGhBmK`CnAHkApClBuBfAjAZsC\\bAjIwDTvAG}CyBOjDoH ismEm|k@sBv@OzBhBKeFpHnAhEjAi@qB`BfAtEiBlAlCk@k@{BrA?qASlCGiAiB|E_Fs@s@k@hBQkA_BlCrFaLeDbAIkG cvkEuwk@jBxDsDeBAhBaDx@bE`@qCpCbFYKzCkDvAnB`BjFwGcCaBdDg@EwAtAjAp@sBcE@mDgE acmEwtk@aChCwBs@\\bC|BBq@`GnC[eBcEdB_G }rjE{rk@r@~CbFy@pB`BiKgE cfkEwrk@dAlBgBYFjAtB~AjIr@gLsH yxhE{pk@cFtByCvH}DeGaGlDObCfDIVbEmIsBmArAbBzC}DmAt@hB}BKJlCuEF|CtB`D}@qCjBb@xAaAoAyC~Ak@{DcBz@XdDeDbB`G@YdCbEETtAsJlDzBoB_FC_AmBuBvA|AAa@rA}E\\uA~HtGaBhAlAuKnHxAxB}AdC~A`BjBgBBjBcBpB{CeDpA|BmBnAoA{FmA]E~DsAgE[pC{CItCzByCLH~AjDw@qBhBtDhATmCd@fDdEc@gB`BhHi@q@yAnCuA`BhAnD{EwCe@~Ao@cAeAfClBjBoAiGmHvEpAbCxE{A_EpCn@nAgBiDeD`GKK`CdDyCwCiC~EMa@sAqAx@VyBcM|@vKgBsAeI`GkCfA_FjE{B[oBxHKjDuGsC]f@wAjFMq@mD`DtBb@iBlC?aF}BhCPkAcF sdgEwnk@_DvCiAy@}NvFaCtFmEtAoHyEbExBgDbExFG_DTc@fD`C_AlDlAyBdCsCy@dAfBkApDnIcIhEj@gAqAxCgB{H~A]aAzDk@oEgBzGXReG^jF`AgDVzCpDuAQ{ArB^aA{CjBp@cDeE`Do@tAnEtB{CjGbB_F}CXwCzExBwEeE atjEokk@oBb@bA`DiHuBr@rEuAoBaAbBDyCyGqBkBzBdC|@{Bf@zAx@M~EhC{AQkFdAbCnJSExClBsCxD\\mBsI iljE{jk@cAdG~BdB{@kJ mwhEe~j@uDtChAgCgBVoBfDnDw@WvAaCDeKtJ?tIpQ{T`BcG mthEw|j@mBpT|B`DdCk@cCcCrBqHeCqJ {ofE}xj@kChDaHxAvCv@uBHnA~@qDzDsERs@p@vBPuFpBGjA~D?sF~FfKaN`O{Jd@yF smgEiwj@yDpAdDdBuBTqAeC}BpDpCJsA~BfDoCbCf@_D`GfJeGyCDzAwBiBAbAcBsBaA ayhEyej@mDtHOtCnBlAtAg@gAyArBn@fAuC{BqH idhEeej@yE~ArAh@_BlAlBu@PdBnAkBObC~A]RtCeCbChCpBnAsPgAwA{@lC]oC cohEg|i@eEjEfD[MxAoDt@bE\\k@bCpAqAfBzAuBkN ehhEa{i@_BhAxArAwBT|BlF?aL }{gE{yi@wAdKmBsAe@dBzFNOgL owhEepi@o@`I|A_BhCn@_DfA|H@AzCfEdA}AgImA\\i@cCmElAwB}E ybiE{li@uEjI`CjD`BeA{@tBxB_CnAnC\\sEaDl@eAq@nB{CqDNbCwAS{B {ahEabi@~BfM_BgGpCt@qDuF snhEm`i@w@nCoCeAx@|By@eAG|AoCGrA`JhBiJ|C`CgBxF|Cw@SiEjBaAmC_BjBw@gBoB _fiEa|h@gIhDNxAfDEeFj@bBd@_BlArJ_EoAtFjCy@WsCtBJlAuDcB}@eBjC_@iD otiEgrh@uWpOeAvA|ANsF`B_Ca@xAsA_DXw@~A~BYcAj@xAh@eC]^nBk@yA}FhAdFt@mHT~Bh@o@zCaLbBnMy@bLmLfJeBlBtAqBaBfBFcBoAlAsAzBtBmBiD~QwESqE kbhEeoh@m@vBrCHgCnDcBqDcBnEhBAqAjBoAsAM~InL{OCaD{BG gxhEylh@_H`Aj@dEeOEzEGyC`AjBl@[nBfJkAqDzB|Al@{CL|Ch@eCb@ZdB{BcBtApB{AaAXdCoAiCgBrEwAcAN`C{Aq@`AoCsBFlBhH`MmDtAqCdCvAtIwBjBsDmEp@e@sCh@lEyBx@MqCaBxA|DoIgGRrG}BwEXrE}Am@_D _siEyih@aMhGnRyEmDo@ s~jE}`h@cHhBeG|FtN}Er@iC klkEgtg@wM^gBnCzPkABcB qwkEqve@{DxBjK|AgChCVjAlDgA_ChClD{BxC|C?uAfBbAxIeC_A{BcFrDgFMe@_DeJcG {gjEkzd@_@`BwCk@OfBlClAeGtAgAxArAhB{B?SeBoBz@rA|AkIZlB^e@xBaIq@`CjA_Dd@nAdBsBMw@zByA_B|@~BuC|AeIb@nJ[zKmJzRsGdAwChLcBdCcC{HpA`Dy@Q{ByDc@ gmlEwzb@}CNmEzIoByC_DhB_C|F|CwFdD~AnCy@LaDtCRbCyE {jpEor^mHpFzJsEmA] m{pEyl^]lEfCnEmAx@|Bz@o@nDvBaFE`EpA{AVvBfB_@yEvBpA`AoElIq@eCaB?B|BqAi@u@~FjDkEvD@vIeOUeDeK{C}AcJ }eqEoi]iAhB`Bj@yA~@jA|BsBc@mBvHsAyDa@lLkAcDkEbC~FiHcFb@p@uBgCmAZ`HyBt@OyCkBlEpBbFuDXYtBFgF_D`@ZbBcCr@xAhEeA~Au@gDkBdDq@iAk@`CzBzAuC~BsFgGl@bCuAd@xBnBcCjCfDl@aGAzBjBgCbC~Dw@^bEzAwAB`JdBvBiFtCLzDfCUi@qEfC|A~CsFFtDfBK}CeLhDU\\{BmEaBc@tJgAuLpBqB~CbA@{BdAjAPsEnBEjBcEqBtGxA|AuBhAhEFtAyHqAkFpB_EkAdD|CxF`B@`@qJ~AvGzEmA}AyImBzCgAuARwBhCIr@}K|BrGjBa@iBzGzBJ\\gCh@vA`DkA{@zCtBuAHeCeH{@lAkH_Bw@rAyLuAyC ihsEwmWaEl@`Dv@Q|BuCn@hCpA]bHsGr@v@~AsC~@qAkBTnCuDbAx@dAtL_H`BRs@xBpBsB{AjExDdDcBf@fDrDqAxBnIlKaAwC~FtBx@oEU_B{ESbIYE}ErBxD|BuAeCeBtCyCYzCnEt@w@pD~@wAvBrALcBdB`ASgG{FWv@hE{BwKyFiCeAuEkE\\iBeEiBzDh@qC}DOpEEmAw@vC@IoB~DdEXmChAlCzFbAw@cCcDELyBbCa@k@iDsBI`@jB}AZc@yD}BEq@tBaBcAq@nBtBv@kF`EyBuBxCkBgFiF cfrEitUaBlAPnG`Cc@GvCnAaCIxBxAoCrC~DaA}H{Bf@w@eC}@|Bi@{E m_sEosUkHrAhJ`BrBm@_A}@yAvAWaD"],[1500,"{vkEmtk@CrB_D\\xDRcBhCdLmEkC{@y@xAqC_C yxhE{pk@cFtByCvH}Cg@SaDeGtCp@`BjEEgBbC`AlAqKvB]tCcD{Ba@vEbHyB}GrEzAhBcDDFsAmBnC}AcFcBfGbDUE~CdFGfB{CpAhAx@iBmAe@rCs@gAiA|FqByAwCxDxAzGoF{BsDxFa@_@yChEm@{A{@xBa@yAwAtBPS{B sdgEwnk@_DvCiAy@}NvFgCzFaL|AxNVzAyHJrBxCv@o@xBnBu@|AiBgCyFjHaC{@rB~Bb@hC{GfBlBaBaC {rhE_xj@_BpE`AlD\\_K ibiEsqj@mFdC}@pGnDkBzBkH k`jEi_j@aFpD{Ed@fBiC{Di@oFvBr@jCkCfC`IyBqA|AxBR}InFc@hD`C`@oCzBpE]gClGwE|@_BuFUrCgC{CkA`B`FhC?nDdEc@cA|AtAGlBsE|ErA|@oA}A]tCIuCsFjC_@dBbCCqF_IsBvByBjCpCkBeFrFwGdIkAM}D kejEcti@eIxF~EfFlB}@aD_DfJi@_BsBuDDlCy@eAq@ e`jEurd@cNr@wA`Dd@dAtAaD~LyB y{qE_s\\wB^lBvFqEn@e@rDnDl@c@}DxClArAeA_ApFrBg@x@{FfCDiAyFcDA?fE_CsG gurEyiWcCzAyB{@hEbFX_BxC|A_CaG sisEg`WS`GsBXvCXb@lIf@iB`DzCeEaNjCfFhDqBwAnExAgB`Cl@QxBqBMTpC~CFv@iGjLrD}HcKyMV{EeBS}D"]],"rivers":"ygoEqmRtIaD~GwKxELvCwAmL{B{W`D ugsEoxVtEfIu@vJzF|DvD[`ChE gsrEyiVdAvI|Bf@r@bEfCPzHyC`BuDrBRJ}BnFj@|BqC~AdAq@mF {wpE_jVbHvA`C|DpEf@lGeDXaEbEFPfBlDjA{@dSnDdMmFlFgCiAi@cArAqD{CkL isqEu}TzElFhGyAfAkCfCGjB|HbBbAw@X gbpEafUrFhCt@dCH|AyB`Bf@lDrCjAjCoAv@hBuEhKrAfDTcA kllEyvP{ClOxE|BhCu@nCr@jDfCzEcA clnEwmRcCiEtE}G`MwCxGGbBuDfG{@vBmFfEs@jD}IQtHyCf@ s}nEwbU{GbP`CFtA_E~BJpBcBxByHgEaK_CcAp@kF{CsA k`mE}oRdGfMy@`A~BlAoF[_ExAuCuB sqmEmpTsDjG`@xAeHrGmCYq@tAiEp@mCg@}ElF smqEcwUlEpClBpHpE_AdFdBnBvHbClBo@nEgFnA {gqE}eV|E~DpO`Cf@fCyAnEeAT]mAM`CoElArAjB menE}|TaBOQxCiDPsChNwFbF }slEslQeA{DfAyEgBxA}GReKcC cgsE}|VzJmBvAvBnEB|DlDvCgAxAj@|CaF`EkA|@oCqD{CbF_C{A}Ap@wHrD}BZiClAX[{AfCInCuCbDl@~BeA umsEcsYwAbFsE~Ao@vDuDbAgDo@iB~AeDcA wksE}~YzDhFlCuA|@~DpAPrBhIUrEgG~AwBvGsDfAj@r@kHvEgBoBsBzAeEo@yCvBsIcE swrEqqXjB|AY~EyGlF_E}CaEk@|AsCgDwE mlrEikZu@bAdBrAk@fBbD~Cc@tH_BRsAnEaDKwE`H qkrEqv\\yJvGOtBsCl@cCUDeCyB_@GcCoOd@ eesEqaWrDmAw@yDpDgElQrAfAlD~Ab@fEEKoC`AK smqEga]qDyCz@qAiA}EdDgCgD}FgNqA}GwHoAlB e_rEkwZgCgBjBcElAjAvFyAfCxHdGKlAtHzFdB|BtDXaC isqEig\\fAhA~@}@tBt@h@pJ}AnE_E|AaBhGRdF qarEoy[oFjRbCt@BzAmA|B}D^ }esEoe[yEdFHtGqCdM_FhBmDM cpqEcsY|DzMeB~@aPeFgDoG|AuA ojsE_z[aCeDn@qEgGuGpDvC~Ay@yCW iirEu}XdAo@]qC`Cy@dJpAfF`JvD{ChFw@ iyrEsb[qBzIuIpKnB~DpBHO~@lBg@jAbAwCzH qjsEwmWfDuGnCoAvEX~BhBi@{A~G{JHgC ahmEiib@qLhAxFkGtByHrEkDP{FhBfArG?rBzClIZ aglEu_e@|CBqBoE}KbBiCdIiDp@ZnEnB`AYfAzCj@X`CxC?pBxBdGeBnAd@UrA_E~BOu@gK`A[v@hANcAPf@lA_@dBkA?RxAoErCcCo@gApCoD|@?zBxBN wikEwsf@{Fa@}AzA}CwC_LkBqCdAq@nCeAaCwBEuClAw@fDkEd@{AhEqDbCn@r@{IlCDvCsDrEaDUrAV }fjEo|d@kL`CeFxDsAw@oMzCs@xB_OjF _wjEgle@]vCkKzD_EYtG|InC^WbA cmqEkl^GuBfCaArEgLzHbJ wgoEkc`@IoE`CgB`DHtAaFqE_EkDM`@uF imnE}ea@eBmCeFuAwAuEpPmDnNmJ|DrBi@pAhAtCxE_DlAb@ anmEmwf@sIjCaCaAgEnEwAiA]lAyAS_@|DfCfL {sjEklk@`AhA`AeAr@h@[pMcEdEuGlB}BpBP|AyJzCeDrGoIrFqDxGeJvE gimEqjj@mA~DwGiB_ELhFbMVzAoCrDfC|Dg@tCsDvAmBhEOnCzC`CmBfEsAZ_@qA_B|ByD_@gI~DEbAdHm@jIlCdHuA gvlEo_l@wHlAyBhC~F~JdK^aAfCl@rBcHvGc@fErFbLUtD|CxCBhC|AP^_F|EcBnEkGjAgC{@a@fAiEaAsArAoB {{fE_bk@iIF_FtFiHzCmApG{D|@}@hCaE?kN~DEmCsE}AqNh]}CPwEzE{PjF}B`FiTlN{AQsCnBwC}AeI~AyM`PaN}C|BoS_C_E~Dw@h@}EbBbCnAiEjN_Ky@_BtDwAtFaHbCId@tJdGd@SpFlFlCv@_B crpEugi@`F~@hFwEzHk@`FyD`LiBl@sFaAaB|FmIoBScDtBeB{@ ginEuyi@a@qBaDLSwCsCuCdFiEpDb@tBmB\\qE _goEg`h@[nAiGz@?`EfHiAn@wBrARbBgBnFRcEz@y@tH_KzE eunEcug@}@R`Ax@hBMtAeEyEw@zCcCgBsDiB~BqE_BsCbCmBa@pC_ABkAmHWOaA cxkEqxk@iGjEq@lCnAlBy@zAbF~GgAlD`AnAgAhEz@d@{GnK}EbBqCzLwCr@fAFh@~FzAj@iGzEg@pDaBCC~ByB~AO~FsC|@uDg@iLrDcC|Dr@nBuDzK ukjE_si@vJsB`DBrA`Bo@tFqDtETzC {zlE_~f@yDnAsAzH}FvFrAz@W~D {{hEcai@lAzByC~AZrB}CdFcMxG{ElGcIbC i}lE}vg@uHuAkCr@mAjC{AGzEcP oqnEkbi@wC~AHbC`Fg@vBpA|DcH iooEoai@x@~CiCbHrM_BdCz@wDbB q_nE_yk@yJlOcBScItGoB_@_GdE _liEcqj@`@r@{@Q}C~F?|GuEfEMpC ymmEssg@VfCqC`@t@`AwBfBr@`@iG`Dt@jCkB`H khjEwvj@of@p`@ cbmEkcj@}@lB`@vFdAbAbCS]vFhC|CwHjMz@zEtBnA i_nE}lg@_CtDwBEiBlBgBfHaCXr@fCcD{AgEbDqDi@iAhA","pqmap":{"f":10000.0,"isles":"wwn~@}uaE?Od@eACG\\IGm@Pu@^Mf@}@RM^KdAFBLWv@{@`AAlAu@@[JQ^w@t@[EAI }rn~@ksaE`@g@\\DDOT?XSz@NCdAJFOJ[@Qv@Jd@PAHb@OGMf@UHC\\Hh@b@J?VVHKXy@VGJBNc@Me@RQP?b@]NGRm@LMc@]OQgAN]x@]LY?gAY]EkAlA}B mun~@w}`EASv@i@z@L^\\KR@`@o@Zo@e@[CKU can~@_p`Eo@_@EU]OCQVJtA_@h@XVBDZS^YAELWEQJ {xn~@qlbEULA^MAOXs@Ta@v@JSC]Te@z@g@J@JURKF@AH mkn~@cjbEFHGl@DJMh@Fj@k@r@WB@Jm@G_@a@Dk@p@cAvAcA u~n~@afbEBWTS?Te@`Ag@^[DAa@l@Cb@k@ kbn~@_m`E?b@]DFk@T@ uym~@uv`EFJWPs@M@iAJ@Bp@TLZG ako~@cejEAFo@BKSBM`@OVd@ eqj~@iriEBJ]PQGZENO }to~@maiEOw@Yi@k@i@c@@Se@UCTAFc@]?IZDa@\\AJKp@yAFm@I{@SSIc@\\}@z@eABg@VC?GDDr@sAdBqAn@aAX{Af@q@d@SH_@E_@n@?rAk@dCkC^y@p@Yp@LLd@VPv@E|@a@tAqAhA}ArCmFRq@`@a@zAgDNBn@YPBv@i@l@At@a@|@b@bBV^Gh@^Z?^VZh@j@T^v@^RXbA@`EPjBb@|Bd@tAAh@TCzAp@TAb@Ld@IbA\\JCfA`@p@j@Jn@JDv@lHj@nBtBbEfCzBlBj@bAC`Ao@XDf@QVBbCe@bAAv@QrAk@^D`@M`@]vAAlAc@xBT~@_@VBn@]~A@PEBKf@FRMCKr@H~Ay@^NKBRTj@Nn@KXe@jBQj@JEd@]f@B|@fAz@IVJPb@FQPL\\]\\WMo@j@IGQJ@HMJa@Fo@`Bc@~AkAzGWhDkApCo@fCDXPHGTcAn@[nASBNs@Sa@aBc@cADgCl@iAl@gAbAo@bA]z@?\\e@Hk@ZaAGu@Hq@Wm@?a@s@sCz@{@l@wA~Ak@~@oBdF?Vq@zAeAh@w@bAm@NWRs@|Ag@h@S|@w@x@aBtGk@`D@T\\Bo@AQb@DHt@Sq@XS^}@jDw@vEMvBQZ{@rFqFld@Ql@y@tGy@zHa@jFJJMVc@pFDd@NJE`@K?KXCl@LVCXQLGZH\\g@`@kCAUZb@Lc@MSt@Mv@LV[`AJ`@A^Ek@IIg@n@?TJCHFCHO@FF`@QONe@HIx@ULQ|AR`@SNLr@MVBH_@Zu@KKMAw@Wa@JIQO}A[SDAHAI_@AwAp@k@l@o@hA?k@]q@g@Yk@EUDMJY~@eAj@Yf@SA]TaAPOL@cAh@cAp@k@T@H\\JFVCn@c@H_@VKD}@`DeEVm@G{A]_ASUYK_Ab@CSWO@M^QH[XGDqCWiB[o@i@e@UNe@IJ{@Ca@Q[Be@n@c@v@QNB@ITHP_@J@Ha@N?HMDFdBqAJ\\Ih@NJNe@XLb@KJIEUJFd@k@N}@G]c@o@MA[q@O@_@w@L}C_@eCkAuAUDOMm@eBm@y@Pw@?q@JFJIXkAZQLYNCL]a@UJUHBFYKSQALKMw@IKOHCGUDBSI?TMIQOWGDGIMJEEd@g@o@i@KCEJ@WmBcAJI?MSe@UyBwAwHA[HUO@WwC}AyEK}@u@yA]QS[KHWSFCUg@IEQROI_@k@MKGDc@e@S{@q@oAs@oF[u@DGg@gB]u@PyACoAGIHMHaAPUXaBEMX_@ReARsDAqAEa@KM@s@cAsDUgBFu@KaAVuARSRoBLOCSVc@L}@?]Ma@Te@\\{A@yCMy@ qtn~@yn`ERVQ@M[UKCQJ[NDBEEPTDCFHHOP qqn~@er`EBI_@QDOf@f@x@HXM\\Pg@TWIUFOXUIJISc@ mgn~@gu`Ei@j@GKPgBEOR[rBn@GXYNk@BST kwn~@au`EXe@LE^LKSDMTMLDC`ASV{@HQ[ c|r~@kmfE^X@f@w@aAT? _{r~@kjfEDEBJCXIKBS","relief":[[50,"__n~@q`kEwE?cBpAB`D~ArBhIVtCqBu@aDqEkB gom~@kfjEqBMaBnDrDfHTxJgArFlApAOdCzBlCzDwAzAcIuCmG_AiHtBkBE{D}AkB{Du@ }{n~@udjEcEHqGtCi@fCClGuBrFeAtK`ArK{@vPz@|DgGpQpClR|AhB~J`AlBkAlBdAhCMpAfA~DuB~DPhCs@rAcBwFYeNwETcDtAkByAaDt@W`FbCjBaDcAeChEsDzEJ~@|E~Bx@dA_@n@cI{D_J`FwE?eCeByAcDIa@dGcC`@eGmCrAkBMiAgC@sAbCTqBo@u@eDpBYuBeD`@WoBkCm@[iDhC}@fCrE`E\\pA{AfCrCvDm@b@eDpAfBdDG?}FbD`HfC_CkGgN{FuE[wBmLoJc@eBaD_@ ajk~@criEmMlAmBs@mNfC{K`EqA`ClBxAbGyAqFrFb@z@rBETlAvFiCfC|AlBuJhCR~D_Dv@dBpAeAlBN?_F~Dy@EeA qpl~@muhEoALuDnD`BnFrAeCfDs@B}D{Au@ kcl~@_mhEeCfCaAbFfCQpBcHq@u@ }nm~@s~gE{BAWlB~ClG~DsAyAdD~@fBpAGpBgFcEwBqDkE kom~@algEsAx@YtBmBh@OdCoC`DNt@hDWlCeDpAmG]kB _wm~@iofEgA?i@fDkFpEtDnGlC[{@cCpAyAtADUmBpB{DmDkB }nn~@gjfEqO^aBvDjFtHpG~@rAw@pARnBcAAoEfCjA|@iCsBkDoFk@ w{m~@}peEqK`IaBcC}A^[_BcAHoA`Dr@fCcAxCqG`FBhBrEhHWvEpAvAhBiDyA{DO_FlBh@bByA]qFjEoFzEp@`Bu@s@eC~BqAj@gCc@u@ kin~@eidEaEdCtBxEfB}D[aD"],[200,"y_n~@e}jEaDQaAfAnDlCxF{@eEgC iom~@{cjEuAJCdAhDbFzBmDkEgC c{n~@m{iEoBQ_EvBaFnHqAhHf@zOgAjRlArFgGlRpBzOlBlApAEZqBlBGxAsAq@eIpC{DwAgCj@oAg@u@jDsF~DtDzEuIpA_@lBp@zBiAmEiAcDZ{EsAw@uAgCMXsDkBNw@aApAiCmEWl@kBs@kBPaDgAkBzCiHhIpLv@fDpAEpAsGfA^_@fCzBvCrAo@MyDgBoA`@g@rBf@l@jBpB]`BlByBcIhDZ_BsFgCu@sFuHgI_B wkm~@criE{@XLlG|A|C~AeBoC_J ern~@wgfE{LpArE~HtCB@wEbCt@s@sF"]],"water":"{wn~@_xcES@e@f@EVJX|@d@T@BLMA@LL@AVNPf@RjAGs@@cA]Iw@WWIBBGk@e@j@y@GE _lm~@oqfE?RYELk@MI[Pu@lAa@Hq@E_Ag@j@q@MY[?{Cr@yA~@{@??Iz@AfBkArCi@ZBRXc@z@hA^^@VMh@cAb@URHFf@ orm~@qhjEMOaARU\\u@a@_AoAUGq@\\IdCO?GWUKu@Aa@\\WYOAf@\\`@[r@?TJFVLBNMDLCZi@LILFPVHAj@g@DWP]CWHAPVHXEEJHM_@BQG?M^KVDXQf@EAs@UEGOv@a@IiATcBXEXL^t@hAz@VIR]`AK","streams":"qgm~@iehEr@~@bARTiAz@b@xBeBp@@Z^k@_ANQe@[`@cAzEfG\\|AxArA i}m~@myfEpAjBb@Fg@l@l@JoATj@Ng@p@kAe@CnArABlBgAhCk@n@Xc@~@z@X`A@tAcBVt@ s{m~@qfjEDsBb@[tCxBV_@fAK wfn~@u~cEgAO]|CnBt@wCrB}BToB|A {sn~@igjE{@kBaCe@ y}l~@ghiERmAWW`@CG[p@A anl~@_dhE]BLo@j@CNsAr@g@KY"}};
/* ---- the atlas page of the Geography books (G, 16/10/2026: "khi select sách, thì sách mở ra có hình bản đồ việt nam,
   khi click vào bản đồ ViệtNam thì mới vào page"): the first leaf of the book, printed as a page of a school atlas is.
   Vietnam whole, its mainland and its islands, Hoàng Sa and Trường Sa among them, with the East Sea round them: the land
   in the relief colours of G's own map (deltas green, hills cream, uplands ochre, mountains brown), the sea deepening in
   blue bands, the neighbours' land pale, the border dash-dotted, the great rivers, the capital and the large cities, the
   seas, the gulfs, the archipelagos and the neighbours named in the page's language; a graticule every 5°, a compass rose
   and a scale; the title over it and the sources under it, on a cream paper a little darker toward the gutter. The
   Phú Quốc book opens on the island alone (drawIsland, below). Drawn once a book opens (and again in the other language
   when the page's language is switched), from the outlines in vn-geo.js (OpenStreetMap). */
const ATLAS = { geo: null };
const KX = Math.cos(15 * Math.PI / 180);   // (longitude shrunk as at 15° N: a plain equirectangular map)
function decodeRings(s, f = VN_GEO.f) {   // a layer's rings: encoded polylines (lng, lat in 1/f degree) joined by spaces
  const out = [];
  for (const str of s.split(' ')) {
    if (!str) continue;
    const pts = []; let i = 0, x = 0, y = 0;
    while (i < str.length) {
      for (let k = 0; k < 2; k++) {
        let sh = 0, res = 0, b;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
        const v = res & 1 ? ~(res >> 1) : res >> 1; if (k) y += v; else x += v;
      }
      pts.push(x / f, y / f);
    }
    out.push(pts);
  }
  return out;
}
function atlasGeo() {
  if (!ATLAS.geo) ATLAS.geo = { vn: decodeRings(VN_GEO.vn), border: decodeRings(VN_GEO.border)[0] || [], dots: decodeRings(VN_GEO.dots)[0] || [], foreign: decodeRings(VN_GEO.foreign),
    sea: VN_GEO.sea.map(([d, s]) => [d, decodeRings(s)]), relief: VN_GEO.relief.map(([d, s]) => [d, decodeRings(s)]), rivers: decodeRings(VN_GEO.rivers) };
  return ATLAS.geo;
}
// names on the map: [lng, lat, Vietnamese, English, kind, where the name goes: l(eft), r(ight), t(op), b(elow)]
const PLACES = [
  [105.854, 21.028, 'Hà Nội', 'Hà Nội', 'capital', 'l'], [106.688, 20.845, 'Hải Phòng', 'Hải Phòng', 'city', 'r'], [107.59, 16.463, 'Huế', 'Huế', 'city', 'l'],
  [108.202, 16.054, 'Đà Nẵng', 'Đà Nẵng', 'city', 'l'], [109.196, 12.238, 'Nha Trang', 'Nha Trang', 'city', 'l'],
  [106.701, 10.776, 'TP. Hồ Chí Minh', 'Ho Chi Minh City', 'city', 'r'], [105.747, 10.045, 'Cần Thơ', 'Cần Thơ', 'city', 'b']];
const SEAS = [   // (a gulf's name in two lines where it has little room)
  [112.6, 13.2, 'BIỂN ĐÔNG', 'EAST SEA', 1], [107.35, 19.75, 'Vịnh Bắc Bộ', 'Gulf of Tonkin', 0], [103.05, 7.75, 'Vịnh\nThái Lan', 'Gulf of\nThailand', 0]];
const LANDS = [[106.0, 23.9, 'TRUNG QUỐC', 'CHINA'], [103.25, 19.0, 'LÀO', 'LAOS'], [103.35, 15.6, 'THÁI LAN', 'THAILAND'], [104.6, 12.75, 'CAMPUCHIA', 'CAMBODIA']];
const ISLES = [[112.05, 16.15, 'QĐ. Hoàng Sa', 'Hoàng Sa Is.'], [114.45, 9.35, 'QĐ. Trường Sa', 'Trường Sa Is.'], [103.97, 10.23, 'Phú Quốc', 'Phú Quốc'], [106.61, 8.69, 'Côn Đảo', 'Côn Đảo']];
const RELIEF = { base: '#a7cf98', 200: '#d8d3a4', 500: '#d9bd88', 1000: '#c59a62', 1500: '#ac7b48' };   // (G's map's colours: its LAND_COLORS)
const SEA = { base: '#d3e5e6', 200: '#bcd7dd', 1000: '#a3c6d3', 3000: '#8cb5c7' };
const serif = `Georgia, 'Times New Roman', serif`, sans = `Inter, 'Helvetica Neue', Arial, sans-serif`;
// a projection onto the frame: the box [lng0, lat0, lng1, lat1] fitted to it, centred
function frameProj(x0, y0, x1, y1, box, kx = KX) {   // (kx: longitude's shrink: cos 15° for the country, the island's own latitude for it)
  const [l0, b0, l1, b1] = box, s = Math.min((x1 - x0) / ((l1 - l0) * kx), (y1 - y0) / (b1 - b0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, lc = (l0 + l1) / 2, bc = (b0 + b1) / 2;
  return { s, x: lng => cx + (lng - lc) * kx * s, y: lat => cy - (lat - bc) * s, lng: px => lc + (px - cx) / (kx * s), lat: py => bc - (py - cy) / s };
}
function pathRings(g, rings, P) {
  g.beginPath();
  for (const r of rings) { g.moveTo(P.x(r[0]), P.y(r[1])); for (let i = 2; i < r.length; i += 2) g.lineTo(P.x(r[i]), P.y(r[i + 1])); g.closePath(); }
}
function strokeLines(g, lines, P) {
  g.beginPath();
  for (const r of lines) { g.moveTo(P.x(r[0]), P.y(r[1])); for (let i = 2; i < r.length; i += 2) g.lineTo(P.x(r[i]), P.y(r[i + 1])); }
  g.stroke();
}
function spaced(g, text, x, y, sp) {   // a line of capitals with space between the letters, centred on x
  const w = [...text].reduce((s, ch) => s + g.measureText(ch).width, 0) + sp * (text.length - 1); let cx = x - w / 2;
  g.textAlign = 'left'; for (const ch of text) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + sp; } g.textAlign = 'center';
}
function haloText(g, text, x, y, halo, ink, lw) { g.lineJoin = 'round'; g.strokeStyle = halo; g.lineWidth = lw; g.strokeText(text, x, y); g.fillStyle = ink; g.fillText(text, x, y); }
// the whole map in a frame: the sea, the neighbours, Vietnam in relief, rivers, coasts, the border, the archipelagos
function drawMap(g, P, k, lang, opts = {}) {
  const G = atlasGeo(), vi = lang === 'vi', free = opts.free || (() => true);   // (free: whether a name may go there: not under an inset)
  g.fillStyle = SEA.base; g.fillRect(-1e4, -1e4, 2e4, 2e4);
  for (const [d, rings] of G.sea) { g.fillStyle = SEA[d] || SEA[3000]; pathRings(g, rings, P); g.fill('evenodd'); }
  g.fillStyle = '#ebe2cb'; pathRings(g, G.foreign, P); g.fill('evenodd');
  g.strokeStyle = 'rgba(120, 104, 78, 0.55)'; g.lineWidth = 0.9 * k; g.stroke();
  // Vietnam: its land, the relief over it (inside it only), its rivers, its coast
  g.save(); pathRings(g, G.vn, P); g.fillStyle = RELIEF.base; g.fill('evenodd'); g.clip('evenodd');
  for (const [d, rings] of G.relief) { g.fillStyle = RELIEF[d] || RELIEF[1500]; pathRings(g, rings, P); g.fill('evenodd'); }
  g.strokeStyle = 'rgba(48, 102, 150, 0.85)'; g.lineWidth = 1.15 * k; g.lineJoin = 'round'; g.lineCap = 'round'; strokeLines(g, G.rivers, P);
  g.restore();
  pathRings(g, G.vn, P); g.strokeStyle = '#3c5a66'; g.lineWidth = 1.1 * k; g.lineJoin = 'round'; g.stroke();
  // the archipelagos' islands too small to draw: dots
  g.fillStyle = '#a7cf98'; g.strokeStyle = '#3c5a66'; g.lineWidth = 0.8 * k;
  for (let i = 0; i < G.dots.length; i += 2) { g.beginPath(); g.arc(P.x(G.dots[i]), P.y(G.dots[i + 1]), Math.max(1.6, 2.1 * k), 0, Math.PI * 2); g.fill(); g.stroke(); }
  // the border on land, dash-dotted in red over a pale band (as an atlas draws a national border)
  g.lineJoin = 'round'; g.lineCap = 'butt'; g.strokeStyle = 'rgba(214, 120, 96, 0.35)'; g.lineWidth = 5 * k; strokeLines(g, [G.border], P);
  g.setLineDash([10 * k, 4 * k, 2.4 * k, 4 * k]); g.strokeStyle = 'rgba(160, 44, 34, 0.95)'; g.lineWidth = 2.2 * k; strokeLines(g, [G.border], P); g.setLineDash([]);
  if (opts.after) opts.after(g, P);
  // the graticule, every 5°
  g.strokeStyle = 'rgba(70, 92, 104, 0.32)'; g.lineWidth = 0.9 * k;
  for (let lng = 100; lng <= 120; lng += 5) { g.beginPath(); g.moveTo(P.x(lng), P.y(0)); g.lineTo(P.x(lng), P.y(30)); g.stroke(); }
  for (let lat = 0; lat <= 30; lat += 5) { g.beginPath(); g.moveTo(P.x(95), P.y(lat)); g.lineTo(P.x(125), P.y(lat)); g.stroke(); }
  // names: the neighbours, the seas, the archipelagos and islands, the cities
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(96, 84, 66, 0.72)'; g.font = `600 ${Math.round(24 * k)}px ${sans}`;
  for (const [lng, lat, v, e] of LANDS) if (free(P.x(lng), P.y(lat))) spaced(g, vi ? v : e, P.x(lng), P.y(lat), 4.5 * k);
  for (const [lng, lat, v, e, big] of SEAS) {
    g.fillStyle = 'rgba(38, 86, 120, 0.85)'; if (!free(P.x(lng), P.y(lat))) continue;
    if (big) { g.font = `italic 600 ${Math.round(40 * k)}px ${serif}`; spaced(g, vi ? v : e, P.x(lng), P.y(lat), 7 * k); }
    else { g.font = `italic ${Math.round(23 * k)}px ${serif}`; const ls = (vi ? v : e).split('\n'); ls.forEach((l, i) => g.fillText(l, P.x(lng), P.y(lat) + (i - (ls.length - 1) / 2) * 26 * k)); }
  }
  const halo = 'rgba(246, 240, 224, 0.92)';
  for (const [lng, lat, v, e] of ISLES) {
    if (!free(P.x(lng), P.y(lat))) continue;
    const arch = v.startsWith('QĐ'); g.font = `italic ${arch ? 600 : 500} ${Math.round((arch ? 26 : 21) * k)}px ${serif}`;
    haloText(g, vi ? v : e, P.x(lng) + (arch ? 0 : (lng < 105 ? -12 : 12) * k), P.y(lat) + (arch ? 0 : 20 * k), halo, arch ? '#7a2c22' : '#3c4a40', 5 * k);
  }
  for (const [lng, lat, v, e, kind, at] of PLACES) {
    const x = P.x(lng), y = P.y(lat), cap = kind === 'capital'; if (!free(x, y)) continue;
    if (cap) star(g, x, y, 11 * k, '#b0302a'); else { g.beginPath(); g.arc(x, y, 5 * k, 0, Math.PI * 2); g.fillStyle = '#fbf6ea'; g.fill(); g.lineWidth = 2.4 * k; g.strokeStyle = '#3a2f26'; g.stroke(); }
    g.font = `${cap ? 700 : 600} ${Math.round((cap ? 29 : 23) * k)}px ${sans}`;
    const off = (cap ? 15 : 11) * k, [tx, ty, al] = at === 'l' ? [x - off, y, 'right'] : at === 'r' ? [x + off, y, 'left'] : at === 't' ? [x, y - 22 * k, 'center'] : [x, y + 22 * k, 'center'];
    g.textAlign = al; haloText(g, vi ? v : e, tx, ty, halo, '#2b231c', 6 * k); g.textAlign = 'center';
  }
}
function star(g, x, y, r, col) {
  g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); }
  g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = r * 0.16; g.strokeStyle = 'rgba(255, 248, 230, 0.9)'; g.stroke();
}
function compass(g, x, y, r, lang, k) {   // an eight-point rose, its north point dark
  g.save(); g.translate(x, y);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, long = i % 2 === 0, L = long ? r : r * 0.55, w = long ? r * 0.17 : r * 0.12;
    g.save(); g.rotate(a);
    g.beginPath(); g.moveTo(0, -L); g.lineTo(w, 0); g.lineTo(0, 0); g.closePath(); g.fillStyle = i === 0 ? '#3a2f26' : '#6b5c49'; g.fill();
    g.beginPath(); g.moveTo(0, -L); g.lineTo(-w, 0); g.lineTo(0, 0); g.closePath(); g.fillStyle = i === 0 ? '#9a3326' : '#efe5cd'; g.fill();
    g.lineWidth = 0.8 * k; g.strokeStyle = '#3a2f26'; g.beginPath(); g.moveTo(0, -L); g.lineTo(w, 0); g.lineTo(-w, 0); g.closePath(); g.stroke();
    g.restore();
  }
  g.beginPath(); g.arc(0, 0, r * 0.62, 0, Math.PI * 2); g.lineWidth = 1 * k; g.strokeStyle = 'rgba(58, 47, 38, 0.6)'; g.stroke();
  g.fillStyle = '#3a2f26'; g.font = `700 ${Math.round(r * 0.42)}px ${serif}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(lang === 'vi' ? 'B' : 'N', 0, -r - 6 * k);
  g.restore();
}
function scaleBar(g, x, y, P, lang, k) {   // 0 to 300 km, in hundreds
  const kmPx = P.s / 111.2, w = 300 * kmPx, h = 7 * k;
  g.textBaseline = 'alphabetic'; g.textAlign = 'center';
  for (let i = 0; i < 3; i++) { g.fillStyle = i % 2 ? '#fbf6ea' : '#3a2f26'; g.fillRect(x + i * w / 3, y, w / 3, h); }
  g.lineWidth = 1.2 * k; g.strokeStyle = '#3a2f26'; g.strokeRect(x, y, w, h);
  g.fillStyle = '#3a2f26'; g.font = `500 ${Math.round(17 * k)}px ${sans}`;
  for (let i = 0; i <= 3; i++) g.fillText(String(i * 100), x + i * w / 3, y - 7 * k);
  g.textAlign = 'left'; g.fillText('km', x + w + 26 * k, y - 7 * k);
}
function paper(g, W, H, seed) {   // cream paper: a little uneven, flecked, darker toward the gutter (the left: the spine)
  g.fillStyle = '#f1e8d2'; g.fillRect(0, 0, W, H);
  const r = rng(seed);
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = r() * H, rr = W * (0.1 + 0.25 * r()), m = g.createRadialGradient(x, y, 0, x, y, rr);
    m.addColorStop(0, r() < 0.5 ? 'rgba(255, 252, 240, 0.18)' : 'rgba(170, 140, 90, 0.07)'); m.addColorStop(1, 'rgba(0, 0, 0, 0)'); g.fillStyle = m; g.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
  }
  for (let i = 0; i < W * H / 700; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '120, 96, 60' : '255, 255, 250'}, ${r() * 0.06})`; g.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r()); }
  const gut = g.createLinearGradient(0, 0, W * 0.12, 0);
  gut.addColorStop(0, 'rgba(92, 70, 40, 0.22)'); gut.addColorStop(0.35, 'rgba(92, 70, 40, 0.07)'); gut.addColorStop(1, 'rgba(92, 70, 40, 0)'); g.fillStyle = gut; g.fillRect(0, 0, W * 0.12, H);
}
// the page, W × H (portrait): `which` is 'vn' (Việt Nam: the country and the East Sea) or 'phuquoc' (the island alone:
// drawIsland); returns the frame of the map on the page, as fractions of the page
function drawAtlas(c, which, lang) {
  if (which === 'phuquoc') return drawIsland(c, lang);
  const W = c.width, H = c.height, g = c.getContext('2d'), k = W / 1024, vi = lang === 'vi', m = 58 * k;
  paper(g, W, H, 11);
  // the title
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#2f261d';
  g.font = `700 ${Math.round(70 * k)}px ${serif}`; spaced(g, vi ? 'VIỆT NAM' : 'VIETNAM', W / 2, m + 70 * k, 9 * k);
  g.font = `italic ${Math.round(26 * k)}px ${serif}`; g.fillStyle = '#5a4a38';
  g.fillText(vi ? 'Địa hình · Biển Đông · Hoàng Sa · Trường Sa' : 'Relief · the East Sea · Hoàng Sa · Trường Sa', W / 2, m + 104 * k);
  // the map
  const x0 = m, x1 = W - m, y0 = m + 138 * k, y1 = H - m - 44 * k, P = frameProj(x0, y0, x1, y1, [101.8, 5.4, 118.2, 24.2]);
  g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
  drawMap(g, P, k, lang);
  compass(g, x1 - 92 * k, y0 + 120 * k, 54 * k, lang, k);
  scaleBar(g, P.x(111.2), P.y(6.25), P, lang, k);
  g.restore();
  frameAround(g, x0, y0, x1, y1, k, [[105, '105°E'], [110, '110°E'], [115, '115°E']].map(([v, t]) => [P.x(v), t]), [[10, '10°N'], [15, '15°N'], [20, '20°N']].map(([v, t]) => [P.y(v), t]));
  sources(g, W, H, m, k, vi, true);
  return { x0: x0 / W, y0: y0 / H, x1: x1 / W, y1: y1 / H };
}
// a map's frame: a heavy rule and a fine one, the degrees along it (xs: [x, label] along the top and the foot; ys: [y,
// label] up the left side), and the sources under it
function frameAround(g, x0, y0, x1, y1, k, xs, ys) {
  g.lineWidth = 3.2 * k; g.strokeStyle = '#3a2f26'; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
  g.lineWidth = 1 * k; g.strokeRect(x0 - 7 * k, y0 - 7 * k, x1 - x0 + 14 * k, y1 - y0 + 14 * k);
  g.fillStyle = '#5a4a38'; g.font = `500 ${Math.round(15 * k)}px ${sans}`; g.textBaseline = 'alphabetic'; g.textAlign = 'center';
  for (const [x, t] of xs) if (x > x0 + 30 * k && x < x1 - 30 * k) { g.fillText(t, x, y0 - 12 * k); g.fillText(t, x, y1 + 24 * k); }
  for (const [y, t] of ys) if (y > y0 + 30 * k && y < y1 - 30 * k) { g.save(); g.translate(x0 - 12 * k, y); g.rotate(-Math.PI / 2); g.fillText(t, 0, 0); g.restore(); }
}
function sources(g, W, H, m, k, vi, depths) {
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#6b5a45'; g.font = `italic ${Math.round(16 * k)}px ${serif}`;
  g.fillText(vi ? `Dữ liệu: © OpenStreetMap contributors · độ cao${depths ? ', độ sâu' : ''}: AWS Terrain Tiles` : `Data: © OpenStreetMap contributors · heights${depths ? ', depths' : ''}: AWS Terrain Tiles`, W / 2, H - m + 6 * k);
}

/* ---- Phú Quốc alone (the Phú Quốc book: G, 16/10/2026: "cho sách Phú Quốc mở ra bản đồ riêng đảo Phú Quốc"): the
   island and its islets at some 50 m to the pixel, from the same OpenStreetMap coast at its own detail (pqmap); the sea
   lighter where it is shallow along the coast; its heights (50 and 200 m) softened, as the bands were traced at 200 m;
   its lakes and streams; its towns, the airport, the highest peak (Núi Chúa, 603 m, where the 200 m band is largest),
   the national park, the beaches, the An Thới islands, which way Cambodia lies, how far the mainland's ports are; and a
   small map of Vietnam in a corner with the island boxed in it. */
const ISLAND = { geo: null, box: [103.72, 9.93, 104.2, 10.49], kx: Math.cos(10.2 * Math.PI / 180) };
function islandGeo() {
  if (!ISLAND.geo) {
    const M = VN_GEO.pqmap, f = M.f, isles = decodeRings(M.isles, f);
    ISLAND.geo = { isles, main: isles.reduce((a, r) => r.length > a.length ? r : a, []),
      relief: M.relief.map(([d, s]) => [d, decodeRings(s, f)]), water: decodeRings(M.water, f), streams: decodeRings(M.streams, f) };
    // the peak: the middle of the largest piece of the 200 m band (Núi Chúa, 603 m, stands in its north-east range)
    const hi = (ISLAND.geo.relief.find(([d]) => d === 200) || [0, []])[1].reduce((a, r) => r.length > a.length ? r : a, []);
    let sx = 0, sy = 0; for (let i = 0; i < hi.length; i += 2) { sx += hi[i]; sy += hi[i + 1]; } ISLAND.geo.peak = hi.length ? [sx / (hi.length / 2), sy / (hi.length / 2)] : null;
  }
  return ISLAND.geo;
}
// a place on the coast: where given, moved onto the island's coast (the nearest point of its outline) and a little
// inland, so a town's dot sits on its shore whatever the outline's detail
function onCoast(main, lng, lat, inland = 0.004) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < main.length; i += 2) { const dx = (main[i] - lng) * ISLAND.kx, dy = main[i + 1] - lat, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
  const cx = 103.96, cy = 10.22, x = main[best], y = main[best + 1], dx = (cx - x) * ISLAND.kx, dy = cy - y, l = Math.hypot(dx, dy) || 1;
  return [x + dx / l * inland / ISLAND.kx, y + dy / l * inland];
}
function drawIsland(c, lang) {
  const W = c.width, H = c.height, g = c.getContext('2d'), k = W / 1024, vi = lang === 'vi', m = 58 * k, I = islandGeo(), V = atlasGeo();
  paper(g, W, H, 23);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#2f261d';
  g.font = `700 ${Math.round(70 * k)}px ${serif}`; spaced(g, 'PHÚ QUỐC', W / 2, m + 70 * k, 9 * k);
  g.font = `italic ${Math.round(26 * k)}px ${serif}`; g.fillStyle = '#5a4a38';
  g.fillText(vi ? 'Đảo Ngọc · Vịnh Thái Lan' : 'The pearl island · the Gulf of Thailand', W / 2, m + 104 * k);
  const x0 = m, x1 = W - m, y0 = m + 138 * k, y1 = H - m - 44 * k, P = frameProj(x0, y0, x1, y1, ISLAND.box, ISLAND.kx);
  g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
  // the sea, paler in the shallows along the coasts
  g.fillStyle = '#c9dfe3'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.lineJoin = 'round';
  for (const [w, a] of [[46, 0.16], [26, 0.2], [12, 0.26]]) { pathRings(g, I.isles, P); g.strokeStyle = `rgba(240, 248, 246, ${a})`; g.lineWidth = w * k; g.stroke(); }
  // the island: its lowland, its heights (softened: the bands were traced at 200 m), its lakes and streams
  g.save(); pathRings(g, I.isles, P); g.fillStyle = '#a7cf98'; g.fill('evenodd'); g.clip('evenodd');
  g.filter = `blur(${Math.round(7 * k)}px)`;
  for (const [d, rings] of I.relief) { g.fillStyle = d >= 200 ? '#d6c38f' : '#c9d79e'; pathRings(g, rings, P); g.fill('evenodd'); }
  g.filter = 'none';
  pathRings(g, I.water, P); g.fillStyle = '#9fc6d6'; g.fill('evenodd'); g.strokeStyle = '#4c7f99'; g.lineWidth = 1 * k; g.stroke();
  g.strokeStyle = 'rgba(48, 102, 150, 0.85)'; g.lineWidth = 1.6 * k; g.lineCap = 'round'; strokeLines(g, I.streams, P);
  g.restore();
  pathRings(g, I.isles, P); g.strokeStyle = '#3c5a66'; g.lineWidth = 1.6 * k; g.stroke();
  // the graticule, every 10′
  g.strokeStyle = 'rgba(70, 92, 104, 0.3)'; g.lineWidth = 0.9 * k;
  const ticks = (a, b) => { const out = []; for (let v = Math.ceil(a * 6) / 6; v <= b; v += 1 / 6) out.push(+v.toFixed(4)); return out; };
  const LX = ticks(ISLAND.box[0] - 0.2, ISLAND.box[2] + 0.2), LY = ticks(ISLAND.box[1] - 0.2, ISLAND.box[3] + 0.2);
  for (const v of LX) { g.beginPath(); g.moveTo(P.x(v), y0); g.lineTo(P.x(v), y1); g.stroke(); }
  for (const v of LY) { g.beginPath(); g.moveTo(x0, P.y(v)); g.lineTo(x1, P.y(v)); g.stroke(); }
  // names
  const halo = 'rgba(246, 240, 224, 0.92)';
  const place = (lng, lat, name, at, o = {}) => {   // a dot (or a mark) and its name beside it
    const x = P.x(lng), y = P.y(lat);
    if (o.mark) o.mark(x, y); else { g.beginPath(); g.arc(x, y, (o.big ? 6 : 4.8) * k, 0, Math.PI * 2); g.fillStyle = '#fbf6ea'; g.fill(); g.lineWidth = 2.4 * k; g.strokeStyle = '#3a2f26'; g.stroke(); }
    g.font = o.font || `${o.big ? 700 : 600} ${Math.round((o.big ? 27 : 21) * k)}px ${sans}`; g.textBaseline = 'middle';
    const off = (o.off || 12) * k, [tx, ty, al] = at === 'l' ? [x - off, y, 'right'] : at === 'r' ? [x + off, y, 'left'] : at === 't' ? [x, y - 20 * k, 'center'] : [x, y + 21 * k, 'center'];
    g.textAlign = al; haloText(g, name, tx, ty, halo, o.ink || '#2b231c', 6 * k); g.textAlign = 'center';
  };
  g.fillStyle = 'rgba(38, 86, 120, 0.85)'; g.font = `italic 600 ${Math.round(30 * k)}px ${serif}`; g.textBaseline = 'middle';
  (vi ? ['VỊNH', 'THÁI LAN'] : ['GULF OF', 'THAILAND']).forEach((l, i) => spaced(g, l, P.x(103.785), P.y(10.13) + (i - 0.5) * 38 * k, 5 * k));
  g.fillStyle = 'rgba(96, 84, 66, 0.75)'; g.font = `600 ${Math.round(21 * k)}px ${sans}`; spaced(g, vi ? '↑ CAMPUCHIA' : '↑ CAMBODIA', P.x(103.83), P.y(10.472), 4 * k);   // (its coast lies just north of the frame; the outline G's map has of it is too coarse for this scale)
  g.fillStyle = 'rgba(46, 108, 60, 0.9)'; g.font = `italic 600 ${Math.round(22 * k)}px ${serif}`;
  (vi ? ['Vườn quốc gia', 'Phú Quốc'] : ['Phú Quốc', 'National Park']).forEach((l, i) => g.fillText(l, P.x(103.935), P.y(10.355) + (i - 0.5) * 27 * k));
  if (I.peak) place(I.peak[0], I.peak[1], vi ? 'Núi Chúa 603 m' : 'Mt Chúa 603 m', 'r', { font: `italic 600 ${Math.round(19 * k)}px ${serif}`, ink: '#5a3a1e', off: 13,
    mark: (x, y) => { g.beginPath(); g.moveTo(x, y - 9 * k); g.lineTo(x + 8 * k, y + 6 * k); g.lineTo(x - 8 * k, y + 6 * k); g.closePath(); g.fillStyle = '#6b4a2a'; g.fill(); } });
  const M = I.main;
  for (const [lng, lat, name, at, big] of [[103.957, 10.215, 'Dương Đông', 'l', 1], [104.008, 10.02, 'An Thới', 'l', 1], [104.052, 10.178, 'Hàm Ninh', 'r'], [103.845, 10.37, 'Gành Dầu', 'l'],
    [104.0, 10.405, 'Bãi Thơm', 'r'], [103.885, 10.282, 'Cửa Cạn', 'l']]) { const [x, y] = onCoast(M, lng, lat); place(x, y, name, at, { big }); }
  place(103.993, 10.17, vi ? 'Sân bay' : 'Airport', 'r', { font: `600 ${Math.round(18 * k)}px ${sans}`, off: 16, mark: (x, y) => plane(g, x, y, 12 * k) });
  g.font = `italic ${Math.round(19 * k)}px ${serif}`; g.textBaseline = 'middle';
  for (const [lng, lat, name, at] of [[103.858, 10.335, 'Bãi Dài', 'l'], [103.963, 10.13, 'Bãi Trường', 'l'], [104.045, 10.055, 'Bãi Sao', 'r']]) {
    const [x, y] = onCoast(M, lng, lat, -0.006); g.textAlign = at === 'l' ? 'right' : 'left'; haloText(g, name, P.x(x), P.y(y), halo, '#6b4a2a', 5 * k);
  }
  g.textAlign = 'left'; haloText(g, 'Hòn Thơm', P.x(104.031), P.y(9.955), halo, '#3c4a40', 5 * k);
  g.textAlign = 'right'; g.font = `italic 600 ${Math.round(19 * k)}px ${serif}`; haloText(g, vi ? 'Quần đảo An Thới' : 'An Thới Islands', P.x(103.975), P.y(9.948), halo, '#3c4a40', 5 * k);
  // how far the mainland's ports are, along the right edge
  g.font = `italic 600 ${Math.round(20 * k)}px ${serif}`; g.textAlign = 'right'; g.fillStyle = '#5a4a38';
  g.fillText('Hà Tiên ~45 km →', x1 - 16 * k, P.y(10.262)); g.fillText('Rạch Giá ~115 km →', x1 - 16 * k, P.y(10.1));   // (below the corner map and the peak's name)
  // the compass, the scale (0 to 10 km), and Vietnam in a corner, the island boxed in it
  compass(g, P.x(104.14), P.y(10.0), 50 * k, lang, k);
  { const kmPx = P.s / 111.2, w = 10 * kmPx, h = 7 * k, x = P.x(103.745), y = P.y(9.955); g.textBaseline = 'alphabetic'; g.textAlign = 'center';
    for (let i = 0; i < 2; i++) { g.fillStyle = i % 2 ? '#fbf6ea' : '#3a2f26'; g.fillRect(x + i * w / 2, y, w / 2, h); }
    g.lineWidth = 1.2 * k; g.strokeStyle = '#3a2f26'; g.strokeRect(x, y, w, h); g.fillStyle = '#3a2f26'; g.font = `500 ${Math.round(17 * k)}px ${sans}`;
    for (let i = 0; i <= 2; i++) g.fillText(String(i * 5), x + i * w / 2, y - 7 * k); g.textAlign = 'left'; g.fillText('km', x + w + 14 * k, y - 7 * k); }
  { const bw = 150 * k, bh = 262 * k, bx = x1 - 14 * k - bw, by = y0 + 14 * k;   // (the locator)
    g.fillStyle = 'rgba(247, 242, 228, 0.97)'; g.fillRect(bx, by, bw, bh); g.lineWidth = 2.2 * k; g.strokeStyle = '#3a2f26'; g.strokeRect(bx, by, bw, bh);
    const Q = frameProj(bx + 8 * k, by + 8 * k, bx + bw - 8 * k, by + bh - 8 * k, [101.9, 8.3, 109.7, 23.6]);
    g.save(); g.beginPath(); g.rect(bx + 2 * k, by + 2 * k, bw - 4 * k, bh - 4 * k); g.clip();
    g.fillStyle = SEA.base; g.fillRect(bx, by, bw, bh); pathRings(g, V.foreign, Q); g.fillStyle = '#ebe2cb'; g.fill('evenodd');
    pathRings(g, V.vn, Q); g.fillStyle = '#a7cf98'; g.fill('evenodd'); g.strokeStyle = '#3c5a66'; g.lineWidth = 0.7 * k; g.stroke();
    g.restore();
    const [l0, b0, l1, b1] = ISLAND.box; g.strokeStyle = '#b0302a'; g.lineWidth = 2.4 * k; g.strokeRect(Q.x(l0) - 3 * k, Q.y(b1) - 3 * k, Q.x(l1) - Q.x(l0) + 6 * k, Q.y(b0) - Q.y(b1) + 6 * k);
    star(g, Q.x(105.854), Q.y(21.028), 6 * k, '#b0302a'); }
  g.restore();
  const dm = v => { const d = Math.floor(v + 1e-6), mm = Math.round((v - d) * 60); return `${d}°${String(mm).padStart(2, '0')}′`; };
  frameAround(g, x0, y0, x1, y1, k, LX.map(v => [P.x(v), dm(v) + 'E']), LY.map(v => [P.y(v), dm(v) + 'N']));
  sources(g, W, H, m, k, vi, false);
  return { x0: x0 / W, y0: y0 / H, x1: x1 / W, y1: y1 / H };
}
function plane(g, x, y, r) {   // an airport: a small aeroplane, nose to the north-east
  g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillStyle = '#3a2f26';
  g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.16, -r * 0.6); g.lineTo(r * 0.16, -r * 0.2); g.lineTo(r, r * 0.25); g.lineTo(r, r * 0.42); g.lineTo(r * 0.16, r * 0.2);
  g.lineTo(r * 0.16, r * 0.66); g.lineTo(r * 0.42, r * 0.86); g.lineTo(r * 0.42, r); g.lineTo(0, r * 0.88); g.lineTo(-r * 0.42, r); g.lineTo(-r * 0.42, r * 0.86); g.lineTo(-r * 0.16, r * 0.66);
  g.lineTo(-r * 0.16, r * 0.2); g.lineTo(-r, r * 0.42); g.lineTo(-r, r * 0.25); g.lineTo(-r * 0.16, -r * 0.2); g.lineTo(-r * 0.16, -r * 0.6); g.closePath(); g.fill();
  g.restore();
}

// the endpaper pasted inside the front board (what an open atlas shows on its left): a printed pattern of small compass
// stars in rows, a bookplate with the book's name, and under it a word on what the map beside it does; darker toward the
// joint (the right, by the spine)
function drawEndpaper(c, which, lang, title) {
  const W = c.width, H = c.height, g = c.getContext('2d'), k = W / 768, vi = lang === 'vi';
  g.fillStyle = '#ebe2cc'; g.fillRect(0, 0, W, H);
  const r = rng(which === 'vn' ? 5 : 9), st = 64 * k;
  for (let row = 0, y = st / 2; y < H + st; row++, y += st * 0.86) for (let x = (row % 2 ? st / 2 : 0); x < W + st; x += st) {
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4 * (row % 2)); g.fillStyle = 'rgba(92, 118, 128, 0.3)';
    g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? 2.6 * k : 10 * k; g.lineTo(rr * Math.sin(a), -rr * Math.cos(a)); } g.closePath(); g.fill();
    g.restore();
    g.fillStyle = 'rgba(92, 118, 128, 0.22)'; g.beginPath(); g.arc(x + st / 2, y + st * 0.43, 1.8 * k, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < W * H / 900; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '120, 96, 60' : '255, 255, 250'}, ${r() * 0.05})`; g.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r()); }
  // the bookplate
  const bw = 400 * k, bh = 330 * k, bx = (W - bw) / 2, by = H * 0.36 - bh / 2;
  g.fillStyle = '#f6f0e0'; g.fillRect(bx, by, bw, bh); g.strokeStyle = '#4a3b2a'; g.lineWidth = 3 * k; g.strokeRect(bx + 10 * k, by + 10 * k, bw - 20 * k, bh - 20 * k);
  g.lineWidth = 1.2 * k; g.strokeRect(bx + 18 * k, by + 18 * k, bw - 36 * k, bh - 36 * k);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#4a3b2a';
  g.font = `600 ${Math.round(22 * k)}px ${serif}`; spaced(g, 'EX LIBRIS', W / 2, by + 66 * k, 6 * k);
  compass(g, W / 2, by + 150 * k, 44 * k, lang, k * 0.8);
  g.font = `italic ${Math.round(30 * k)}px ${serif}`; g.fillStyle = '#2f261d'; g.fillText('Hidden Library', W / 2, by + 238 * k);
  g.fillRect(W / 2 - 50 * k, by + 256 * k, 100 * k, 1.6 * k);
  g.font = `600 ${Math.round(24 * k)}px ${serif}`; g.fillText((vi ? 'Tập bản đồ · ' : 'Atlas · ') + title, W / 2, by + 292 * k);
  // the word on the map
  g.fillStyle = '#7a2c22'; g.font = `italic ${Math.round(29 * k)}px ${serif}`;
  const lines = vi ? ['Bấm vào bản đồ bên cạnh', 'để mở trang →'] : ['Click the map beside it', 'to open its page →'];
  lines.forEach((l, i) => g.fillText(l, W / 2, by + bh + 78 * k + i * 40 * k));
  const gut = g.createLinearGradient(W, 0, W * 0.88, 0);
  gut.addColorStop(0, 'rgba(92, 70, 40, 0.22)'); gut.addColorStop(0.4, 'rgba(92, 70, 40, 0.06)'); gut.addColorStop(1, 'rgba(92, 70, 40, 0)'); g.fillStyle = gut; g.fillRect(W * 0.88, 0, W * 0.12, H);
}
/* ---- a book read in the room (G, 17/10/2026: "[Economic models] book: add animation book open và list of các nước,
   thay vì popup thì đưa vào từng trang sách, click vào thì animation lật tới trang đó"). An item whose notes are the
   page's dialogs (its chips: the economic models of Korea, Japan, Singapore, China and Taiwan) becomes a book of them.
   - Taken out, it opens as the atlases do: on its title page (inside the front board) and its contents (on the right).
     Each note is a chapter on a spread of its own: its title, its picture and its words, set as a book is (a serif at
     the largest size that lets the chapter fill its two pages, ~25 to 35 px on a page 1024 px across).
   - The pages are leaves. Each turns on the front board's hinge, so a turned leaf lies on the endpaper and closes with
     the board. Its fore-edge lifts first and the leaf bows as it goes over (~0.75 s); several in a row are riffled one
     after another.
   - A click on a chapter in the contents, or on its name in the card (which no longer opens the dialog), turns to it.
     A click on the right page turns to the next spread, on the left page to the one before, on a page's "Contents"
     back to the contents.
   - Its pictures are the page's (Wix's, which allows them to be drawn here). Its pages are painted while the book is
     out (in the browser's idle time, the title page and the contents first) and let go when it is back on the shelf. */
const READ = { stagger: 0.12, dur: 0.75, gap: 0.00003, turn: 2.7 };   // (turn: as far as the board opens: flight.js OPEN_TURN)
const SERIF = `Georgia, 'Times New Roman', serif`, INK = '#2c241b', MUTED = '#7d6c56', ACCENT = '#8a3b2a';
const NAMES_EN = { 'Hàn Quốc': 'South Korea', 'Nhật Bản': 'Japan', 'Singapore': 'Singapore', 'Trung Quốc': 'China', 'Đài Loan': 'Taiwan' };
const WORDS = { contents: ['Contents', 'Mục lục'], hint: ['Click a country to turn to its pages', 'Bấm tên một nước để lật tới trang'], end: ['The end', 'Hết'],
  back: ['‹ Contents', '‹ Mục lục'], from: ['From the notes of Hidden Library', 'Từ các ghi chép của Hidden Library'] };
const say = (k, lang) => WORDS[k][lang === 'vi' ? 1 : 0];
const fontOf = (fs, b, i) => `${i ? 'italic ' : ''}${b ? 700 : 400} ${Math.round(fs)}px ${SERIF}`;

/* ---- the chapters: the page's dialogs, read into blocks (a title, a picture, paragraphs of runs of plain or bold
   words, bulleted lists, boxes of them) */
function runsOf(el, bold = false, out = [], href = '') {   // (a link's words keep where it goes, and end in an arrow)
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out.push({ t: n.textContent, b: bold, h: href });
    else if (n.nodeType === 1) {
      if (n.tagName === 'BR') { out.push({ br: true }); continue; }
      const a = n.tagName === 'A' && n.getAttribute('href'); runsOf(n, bold || n.tagName === 'STRONG' || n.tagName === 'B', out, a || href);
      if (a) out.push({ t: ' ↗', b: bold, h: a });
    }
  }
  return out;
}
function blocksOf(root) {
  const out = [];
  for (const el of root.children) {
    const tg = el.tagName;
    if (/^H[1-6]$/.test(tg)) out.push({ k: 'h', text: el.textContent.replace(/\s+/g, ' ').trim() });
    else if (tg === 'IMG') out.push({ k: 'img', src: el.getAttribute('src'), ar: (+el.getAttribute('width') || 16) / (+el.getAttribute('height') || 9) });
    else if (tg === 'UL' || tg === 'OL') out.push({ k: 'ul', items: [...el.children].map(li => runsOf(li)) });
    else if (el.classList.contains('info-box')) out.push({ k: 'box', blocks: blocksOf(el) });
    else if (tg === 'DIV') out.push(...blocksOf(el));
    else if (tg !== 'BUTTON') out.push({ k: 'p', runs: runsOf(el) });
  }
  return out;
}
function chaptersOf(it) {
  const out = [];
  for (const c of it.chips || []) {
    const id = c.el && c.el.dataset ? c.el.dataset.dialog : '', dlg = id ? document.getElementById(id) : null; if (!dlg) continue;
    const blocks = blocksOf(dlg.querySelector('.sheet-body') || dlg), h = blocks.find(b => b.k === 'h');
    out.push({ name: c.label, en: NAMES_EN[c.label] || c.label, title: h ? h.text : c.label, blocks: blocks.filter(b => b !== h) });
  }
  return out;
}
const isReadable = it => chaptersOf(it).length > 0;

/* ---- setting type: runs broken into lines (justified, the last line of a paragraph left as it is), a chapter's
   blocks flowed down its pages */
function wordsOf(runs) {   // words with their weight, and whether a space follows (a word with none before it is kept with the one before)
  const ws = [];
  for (const r of runs) {
    if (r.br) { ws.push({ br: true }); continue; }
    for (const part of r.t.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { if (ws.length) ws[ws.length - 1].sp = true; continue; }
      const prev = ws[ws.length - 1]; ws.push({ t: part, b: r.b, h: r.h, glue: !!(prev && !prev.br && !prev.sp) });
    }
  }
  return ws;
}
function setLines(g, runs, width, fs) {
  const ws = wordsOf(runs), lines = []; let line = [], x = 0;
  const space = b => { g.font = fontOf(fs, b); return g.measureText(' ').width; };
  const end = last => { if (line.length) lines.push({ words: line, w: x, last }); line = []; x = 0; };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]; if (w.br) { end(true); continue; }
    // a word and those glued to it go together
    let j = i, gw = 0; const grp = [];
    do { const v = ws[j]; g.font = fontOf(fs, v.b); const vw = g.measureText(v.t).width; grp.push({ ...v, w: vw }); gw += vw; j++; } while (j < ws.length && ws[j].glue);
    const sp = line.length ? space(line[line.length - 1].b) : 0;
    if (line.length && x + sp + gw > width) end(false);
    for (const v of grp) { v.x = x + (line.length && v === grp[0] ? space(line[line.length - 1].b) : 0); line.push(v); x = v.x + v.w; }
    i = j - 1;
  }
  end(true);
  return lines;
}
function drawLine(g, ln, x0, y, width, fs, color, lk) {   // (lk: where a link's words are, so a click there opens it)
  let gaps = 0; for (let k = 1; k < ln.words.length; k++) if (!ln.words[k].glue) gaps++;
  const extra = !ln.last && gaps ? Math.min((width - ln.w) / gaps, fs * 0.6) : 0;   // (justified; a line far too short is left ragged)
  let add = 0; g.textBaseline = 'alphabetic';
  ln.words.forEach((w, k) => {
    if (k && !w.glue) add += extra; const x = x0 + w.x + add; g.font = fontOf(fs, w.b); g.fillStyle = w.h ? ACCENT : color || INK; g.fillText(w.t, x, y);
    if (w.h) { g.fillRect(x, y + fs * 0.14, w.w + (k < ln.words.length - 1 && ln.words[k + 1].h === w.h ? extra + fs * 0.25 : 0), Math.max(1.5, fs * 0.05)); if (lk) lk(x - 2, y - fs * 0.85, x + w.w + 2, y + fs * 0.3, w.h); }
  });
}
// a chapter flowed down pages: items of a height, drawn at their place; those of a box carry its number
function flowChapter(g, ch, P, fs) {
  const items = [], LH = fs * 1.42, TW = P.tw, PAD = fs * 0.7;
  const gap = (h, box = null) => items.push({ h, box, gap: true });
  const text = (runs, x0, w, box, f = fs, lh = LH, color) => { for (const ln of setLines(g, runs, w, f)) items.push({ h: lh, box, draw: (g, x, y, lang, pic, lk) => drawLine(g, ln, x + x0, y + lh * 0.74, w, f, color, lk) }); };
  // the chapter's country, small and spaced in the accent, over its title
  items.push({ h: fs * 1.5, head: true, draw: (g, x, y, lang) => { g.font = `600 ${Math.round(fs * 0.62)}px ${SERIF}`; g.fillStyle = ACCENT; g.letterSpacing = `${(fs * 0.18).toFixed(1)}px`; g.fillText((lang === 'vi' ? ch.name : ch.en).toUpperCase(), x, y + fs * 0.75); g.letterSpacing = '0px'; } });
  const TF = fs * 1.48; g.font = fontOf(TF, true);
  for (const ln of setLines(g, [{ t: ch.title, b: true }], TW, TF)) items.push({ h: TF * 1.2, draw: (g, x, y) => drawLine(g, { ...ln, last: true }, x, y + TF * 0.92, TW, TF) });
  items.push({ h: fs * 0.55, draw: (g, x, y) => { g.fillStyle = ACCENT; g.fillRect(x, y + fs * 0.2, fs * 2.2, Math.max(2, fs * 0.08)); } });
  gap(fs * 0.5);
  const flow = (blocks, x0, w, box) => {
    for (const b of blocks) {
      if (b.k === 'img') { const h = w / b.ar; items.push({ h: h + fs * 0.8, img: b, draw: (g, x, y, lang, pic) => drawPicture(g, pic, x + x0, y, w, h) }); }
      else if (b.k === 'p') { text(b.runs, x0, w, box); gap(fs * 0.45, box); }
      else if (b.k === 'ul') {
        for (const li of b.items) {
          const lines = setLines(g, li, w - fs * 1.25, fs);
          lines.forEach((ln, k) => items.push({ h: LH, box, draw: (g, x, y, lang, pic, lk) => { if (!k) { g.fillStyle = ACCENT; g.beginPath(); g.arc(x + x0 + fs * 0.42, y + LH * 0.74 - fs * 0.3, fs * 0.13, 0, 7); g.fill(); } drawLine(g, ln, x + x0 + fs * 1.25, y + LH * 0.74, w - fs * 1.25, fs, null, lk); } }));
        }
        gap(fs * 0.35, box);
      } else if (b.k === 'box') {
        const id = items.length + 1; gap(PAD * 0.8, id); flow(b.blocks, x0 + PAD, w - 2 * PAD, id);
        while (items.length && items[items.length - 1].gap && items[items.length - 1].box === id) items.pop();   // (the box ends at its last line)
        gap(PAD * 0.8, id); gap(fs * 0.5);
      }
    }
  };
  flow(ch.blocks, 0, TW, null);
  // onto the pages: an item that does not fit goes over to the next (a gap at the top of a page is dropped)
  const pages = [[]], room = P.y1 - P.y0; let y = 0;
  for (const it of items) {
    if (y + it.h > room && y > 0) { pages.push([]); y = 0; if (it.gap && it.box === null) continue; }
    pages[pages.length - 1].push({ it, y }); y += it.h;
  }
  return pages;
}
function drawPicture(g, pic, x, y, w, h) {
  g.save(); const r = Math.min(12, w * 0.012);
  g.beginPath(); g.roundRect(x, y, w, h, r); g.clip();
  if (pic && pic.complete && pic.naturalWidth) g.drawImage(pic, x, y, w, h);
  else { g.fillStyle = 'rgba(120, 96, 60, 0.12)'; g.fillRect(x, y, w, h); }
  g.restore(); g.strokeStyle = 'rgba(60, 44, 24, 0.18)'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(x, y, w, h, r); g.stroke();
}

/* ---- the pages. A page's picture is drawn as it is read: the gutter (the spine side) toward the middle of the open book,
   its edge shaded; the turned leaf's back is shown mirrored in the shader so it reads the right way round */
function pagePaper(g, W, H, gutterLeft) {
  g.fillStyle = '#f4ecd8'; g.fillRect(0, 0, W, H);
  const gx = gutterLeft ? 0 : W, gr = g.createLinearGradient(gx, 0, gutterLeft ? W * 0.12 : W * 0.88, 0);
  gr.addColorStop(0, 'rgba(96, 70, 36, 0.20)'); gr.addColorStop(0.35, 'rgba(96, 70, 36, 0.06)'); gr.addColorStop(1, 'rgba(96, 70, 36, 0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const ex = gutterLeft ? W : 0, er = g.createLinearGradient(ex, 0, gutterLeft ? W * 0.96 : W * 0.04, 0);
  er.addColorStop(0, 'rgba(96, 70, 36, 0.07)'); er.addColorStop(1, 'rgba(96, 70, 36, 0)'); g.fillStyle = er; g.fillRect(0, 0, W, H);
}
function frameOf(W, H, gutterLeft) {   // a page's text block
  const inner = W * 0.1, outer = W * 0.075, x0 = gutterLeft ? inner : outer;
  return { x0, tw: W - inner - outer, y0: H * 0.088, y1: H - H * 0.082, head: H * 0.05, foot: H - H * 0.04 };
}
function runningHead(g, P, W, left, right, fs, leftColor) {
  g.font = `500 ${Math.round(fs * 0.6)}px ${SERIF}`; g.fillStyle = leftColor || MUTED; g.letterSpacing = `${(fs * 0.12).toFixed(1)}px`;
  if (left) { g.textAlign = 'left'; g.fillText(left.toUpperCase(), P.x0, P.head); } g.fillStyle = MUTED;
  if (right) { g.textAlign = 'right'; g.fillText(right.toUpperCase(), P.x0 + P.tw, P.head); }
  g.letterSpacing = '0px'; g.textAlign = 'left';
  g.fillStyle = 'rgba(125, 108, 86, 0.45)'; g.fillRect(P.x0, P.head + fs * 0.42, P.tw, 1.5);
}
function folio(g, P, n, rightPage, fs) {
  g.font = `400 ${Math.round(fs * 0.68)}px ${SERIF}`; g.fillStyle = MUTED; g.textAlign = rightPage ? 'right' : 'left';
  g.fillText(String(n), rightPage ? P.x0 + P.tw : P.x0, P.foot); g.textAlign = 'left';
}
// a link on a page: where (in the page's pixels) and where it leads
const linkAt = (face, x0, y0, x1, y1, go) => face.links.push({ x0, y0, x1, y1, go });

function paintContents(face, R, lang) {
  const { c, W, H } = face, g = c.getContext('2d'), P = frameOf(W, H, true), fs = W * 0.034; face.links = [];
  pagePaper(g, W, H, true);
  g.textAlign = 'center'; g.fillStyle = ACCENT; g.font = `600 ${Math.round(fs * 0.7)}px ${SERIF}`; g.letterSpacing = `${(fs * 0.3).toFixed(1)}px`;
  g.fillText(say('contents', lang).toUpperCase(), P.x0 + P.tw / 2, P.y0 + fs * 0.6); g.letterSpacing = '0px';
  g.fillStyle = 'rgba(138, 59, 42, 0.5)'; g.fillRect(P.x0 + P.tw / 2 - fs * 1.4, P.y0 + fs * 1.15, fs * 2.8, 2);
  g.font = `italic 400 ${Math.round(fs * 1.25)}px ${SERIF}`; g.fillStyle = INK; g.fillText(R.title, P.x0 + P.tw / 2, P.y0 + fs * 3.0);
  g.textAlign = 'left';
  // the chapters: number, country, its title in italics under it, a leader of dots to its first page
  let y = P.y0 + fs * 5.2; const step = Math.min(fs * 3.5, (P.y1 - fs * 3 - y) / Math.max(1, R.ch.length));
  R.ch.forEach((ch, k) => {
    const name = lang === 'vi' ? ch.name : ch.en, pg = String(2 * (k + 1)), top = y;
    g.font = `400 ${Math.round(fs * 0.9)}px ${SERIF}`; g.fillStyle = ACCENT; g.fillText(String(k + 1).padStart(2, '0'), P.x0, y + fs);
    g.font = fontOf(fs * 1.12, true); g.fillStyle = INK; const nx = P.x0 + fs * 1.9; g.fillText(name, nx, y + fs);
    const nw = g.measureText(name).width; g.font = fontOf(fs, false); g.textAlign = 'right'; g.fillText(pg, P.x0 + P.tw, y + fs); const pw = g.measureText(pg).width; g.textAlign = 'left';
    g.fillStyle = 'rgba(125, 108, 86, 0.65)'; for (let x = nx + nw + fs * 0.5; x < P.x0 + P.tw - pw - fs * 0.5; x += fs * 0.45) { g.beginPath(); g.arc(x, y + fs * 0.92, fs * 0.05, 0, 7); g.fill(); }
    g.font = fontOf(fs * 0.78, false, true); g.fillStyle = MUTED; let t = ch.title; while (g.measureText(t).width > P.tw - fs * 1.9 && t.length > 8) t = t.slice(0, -2).trimEnd() + '…';
    g.fillText(t, nx, y + fs * 2.05);
    linkAt(face, P.x0 - fs * 0.4, top - fs * 0.25, P.x0 + P.tw + fs * 0.4, top + step - fs * 0.3, k + 1);
    y += step;
  });
  g.font = fontOf(fs * 0.72, false, true); g.fillStyle = MUTED; g.textAlign = 'center'; g.fillText(say('hint', lang) + ' →', P.x0 + P.tw / 2, P.y1 - fs * 0.4); g.textAlign = 'left';
  folio(g, P, 1, true, fs);
}
function paintChapter(face, R, lang) {
  const { c, W, H, ch, part } = face, g = c.getContext('2d'), right = part === 1, P = frameOf(W, H, right), k = R.ch.indexOf(ch);
  const lay = layoutOf(R, ch, P, g), pics = R.pics, fs = lay.fs; face.links = [];
  pagePaper(g, W, H, right);
  const name = lang === 'vi' ? ch.name : ch.en, fsH = W * 0.03;
  if (right) runningHead(g, P, W, '', R.title, fsH); else runningHead(g, P, W, say('back', lang), name, fsH, ACCENT);   // (the way back to the contents, in the accent)
  if (!right) { g.font = `500 ${Math.round(fsH * 0.6)}px ${SERIF}`; g.letterSpacing = `${(fsH * 0.12).toFixed(1)}px`; linkAt(face, P.x0 - fsH * 0.5, P.head - fsH * 1.2, P.x0 + g.measureText(say('back', lang).toUpperCase()).width + fsH * 0.6, P.head + fsH * 0.6, 0); g.letterSpacing = '0px'; }
  // the boxes behind their lines, then the lines
  const placed = lay.pages[part] || [];
  for (let i = 0; i < placed.length;) {
    const b = placed[i].it.box; if (!b) { i++; continue; }
    let j = i; while (j + 1 < placed.length && placed[j + 1].it.box === b) j++;
    const y0 = P.y0 + placed[i].y, y1 = P.y0 + placed[j].y + placed[j].it.h;
    g.fillStyle = 'rgba(150, 112, 58, 0.085)'; g.beginPath(); g.roundRect(P.x0 - fs * 0.15, y0, P.tw + fs * 0.3, y1 - y0, fs * 0.35); g.fill();
    g.fillStyle = 'rgba(138, 59, 42, 0.55)'; g.fillRect(P.x0 - fs * 0.15, y0 + fs * 0.25, Math.max(3, fs * 0.1), y1 - y0 - fs * 0.5);
    i = j + 1;
  }
  const lk = (x0, y0, x1, y1, href) => face.links.push({ x0, y0, x1, y1, href });
  for (const { it, y } of placed) if (it.draw) it.draw(g, P.x0, P.y0 + y, lang, it.img ? pics.get(it.img.src) : null, lk);
  const n = 2 * (k + 1) + part; folio(g, P, n, right, fsH);
  // the corners turn the page: drawn as a quiet arrow by the folio
  g.font = `400 ${Math.round(fsH * 0.95)}px ${SERIF}`; g.fillStyle = MUTED; g.textAlign = right ? 'right' : 'left';
  if (right && k < R.ch.length - 1) g.fillText('›', P.x0 + P.tw - fsH * 1.6, P.foot);
  if (!right) g.fillText('‹', P.x0 + fsH * 1.6, P.foot);
  g.textAlign = 'left';
}
function paintEnd(face, R, lang) {
  const { c, W, H } = face, g = c.getContext('2d'), fs = W * 0.034; face.links = [];
  pagePaper(g, W, H, false);
  g.textAlign = 'center'; g.fillStyle = MUTED; g.font = fontOf(fs * 0.9, false, true); g.fillText('— ' + say('end', lang) + ' —', W * 0.46, H * 0.48); g.textAlign = 'left';
}
// the title page, printed on the endpaper inside the front board: a double rule, the book's name, its chapters
function paintTitlePage(R, lang) {
  const { c, W, H } = R.title_, g = c.getContext('2d'), fs = W * 0.042;
  g.fillStyle = '#efe5cf'; g.fillRect(0, 0, W, H);
  const gr = g.createLinearGradient(W, 0, W * 0.86, 0); gr.addColorStop(0, 'rgba(96, 70, 36, 0.22)'); gr.addColorStop(1, 'rgba(96, 70, 36, 0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const m = W * 0.09; g.strokeStyle = 'rgba(138, 59, 42, 0.6)'; g.lineWidth = 3; g.strokeRect(m, m, W - 2 * m - W * 0.03, H - 2 * m); g.lineWidth = 1.2; g.strokeRect(m + 12, m + 12, W - 2 * m - W * 0.03 - 24, H - 2 * m - 24);
  const cx = (W - W * 0.03) / 2; g.textAlign = 'center';
  g.fillStyle = MUTED; g.font = `600 ${Math.round(fs * 0.55)}px ${SERIF}`; g.letterSpacing = `${(fs * 0.3).toFixed(1)}px`; g.fillText('HIDDEN LIBRARY', cx, H * 0.2); g.letterSpacing = '0px';
  g.fillStyle = INK; let size = fs * 1.9; g.font = fontOf(size, true); while (g.measureText(R.title).width > W * 0.68 && size > fs) { size -= 2; g.font = fontOf(size, true); }
  g.fillText(R.title, cx, H * 0.36);
  g.fillStyle = ACCENT; g.beginPath(); for (const [dx, s] of [[-fs * 1.1, 0.5], [0, 1], [fs * 1.1, 0.5]]) { g.moveTo(cx + dx, H * 0.41 - fs * 0.22 * s); g.lineTo(cx + dx + fs * 0.22 * s, H * 0.41); g.lineTo(cx + dx, H * 0.41 + fs * 0.22 * s); g.lineTo(cx + dx - fs * 0.22 * s, H * 0.41); } g.fill();
  g.font = fontOf(fs * 0.82, false, true); g.fillStyle = INK;
  R.ch.forEach((ch, k) => g.fillText(lang === 'vi' ? ch.name : ch.en, cx, H * 0.5 + k * fs * 1.35));
  g.font = fontOf(fs * 0.55, false, true); g.fillStyle = MUTED; g.fillText(say('from', lang), cx, H * 0.86);
  g.textAlign = 'left';
}
// a chapter's type size: the largest (35 px to a page 1024 across, down to 20) at which it fills no more than its two pages
function layoutOf(R, ch, P, g) {
  const key = `${R.W}`; if (ch.lay && ch.lay.key === key) return ch.lay;
  let lay = null;
  for (let fs = R.W * 0.034; fs >= R.W * 0.0195; fs -= R.W * 0.001) { const pages = flowChapter(g, ch, P, fs); lay = { key, fs, pages }; if (pages.length <= 2) break; }
  ch.lay = lay; return lay;
}

/* ---- the leaves: a strip from the gutter to the fore-edge, turned in the shader about the board's hinge (in metres:
   uSize), by uPhi, the fore-edge ahead or behind by uBend (it bows), never past the board (uMax); their front shows
   the page on the right, their back (mirrored) the one on the left */
const LEAF_VS = `attribute float aU; uniform float uPhi, uBend, uMax; uniform vec2 uHinge; uniform vec3 uSize;
  vec2 leafTurn(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
  float leafAngle() { return clamp(uPhi + uBend * pow(aU, 1.5), 0.0, uMax); }\n`;
function leafMaterial(R, L, base) {
  const m = new THREE.MeshStandardMaterial({ ...base, map: R.blank, emissiveIntensity: 0.14, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  m.customProgramCacheKey = () => 'hero-leaf';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, L.u, { uHinge: R.flapU.uHinge, uSize: R.flapU.uSize, uDepth: DECKR.u.uDepth, uFull: DECKR.u.uFull, uOff: DECKR.u.uOff });
    sh.vertexShader = LEAF_VS + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  { vec3 fn = objectNormal / uSize; fn.xz = leafTurn(fn.xz, leafAngle()); objectNormal = normalize(fn * uSize); }')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  { vec3 fp = transformed * uSize; fp.xz = uHinge + leafTurn(fp.xz - uHinge, leafAngle()); transformed = fp / uSize; }');
    sh.fragmentShader = 'uniform sampler2D uDepth, uVerso; uniform vec2 uFull, uOff;\n' + sh.fragmentShader
      .replace('void main() {', 'void main() {\n  if (gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;')
      .replace('#include <map_fragment>', 'diffuseColor *= gl_FrontFacing ? texture2D(map, vMapUv) : texture2D(uVerso, vec2(1.0 - vMapUv.x, vMapUv.y));')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= diffuseColor.rgb;');
  };
  return m;
}
function leafStrip(bk, pg, x) {   // in the unit box (the hero is scaled by the book's size), facing +x (its front)
  const n = 30, pos = [], nor = [], uv = [], au = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, z = pg.z0 + (pg.z1 - pg.z0) * u;
    for (const [y, v] of [[pg.y0, 0], [pg.y1, 1]]) { pos.push(x / bk.t, y / bk.h, z / bk.d); nor.push(1, 0, 0); uv.push(u, v); au.push(u); }
  }
  for (let i = 0; i < n; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const geo = new THREE.BufferGeometry(); geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('aU', new THREE.Float32BufferAttribute(au, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0.5, -0.5), 2);   // (it turns out of its box in the shader)
  return geo;
}

/* ---- the book: its chapters, faces (0: the contents; 2k−1 and 2k: chapter k's two pages; the last: the end), leaves
   (leaf i shows face 2(i−1) on its front and 2i−1 on its back) and title page */
function buildRead(bk, shape, mesh, base) {
  const ch = chaptersOf(bk.it); if (!ch.length) return null;
  const pg = shape.page, W = 1024, H = Math.round(W * (pg.y1 - pg.y0) / (pg.z0 - pg.z1));
  const blank = canvas(8, 8), bg = blank.getContext('2d'); bg.fillStyle = '#f4ecd8'; bg.fillRect(0, 0, 8, 8);
  const R = { bk, ch, W, H, shape, spread: 0, pending: null, open: false, flapU: bk.flapU, title: printTitle(bk.it), faces: [], leaves: [], pics: new Map(), blank: heroCanvasTex(blank, true) };
  const nf = 2 * ch.length + 2;
  for (let f = 0; f < nf; f++) R.faces.push({ f, W, H, c: null, tex: null, links: [], done: '', ch: f && f < nf - 1 ? ch[Math.ceil(f / 2) - 1] : null, part: f && f < nf - 1 ? (f % 2 ? 0 : 1) : -1 });
  // the leaves, stacked on the page block (the first on top); turned, the same offsets put them on the endpaper in the
  // reverse order (the first underneath)
  const nl = ch.length + 1;
  for (let i = 0; i < nl; i++) {
    const L = { i, phi: 0, bend: 0, from: 0, to: 0, t0: null, dur: 1, dir: 1, u: { uPhi: { value: 0 }, uBend: { value: 0 }, uMax: { value: 0 }, uVerso: { value: R.blank } } };
    L.mat = leafMaterial(R, L, base);
    L.mesh = new THREE.Mesh(leafStrip(bk, pg, pg.x + (nl - i) * READ.gap), L.mat); L.mesh.layers.set(HERO_LAYER); L.mesh.frustumCulled = false;
    mesh.add(L.mesh); R.leaves.push(L);
  }
  // the title page on the endpaper (its picture from the fore-edge to the joint, up from the foot)
  const EW = 768, EH = Math.round(EW * bk.h / shape.endW); R.title_ = { c: canvas(EW, EH), W: EW, H: EH };
  R.endTex = heroCanvasTex(R.title_.c, true);
  R.endMat = new THREE.MeshStandardMaterial({ ...base, map: R.endTex, emissiveMap: R.endTex, emissiveIntensity: 0.1, roughness: 0.9, metalness: 0 });
  R.pending = bk.readWant !== undefined && bk.readWant !== null ? bk.readWant : null; bk.readWant = null;   // (a chapter asked for before the book was made)
  bk.read = R; return R;
}
function facePaint(R, f) {   // a face painted (again if the language changed), its texture given to its leaf
  const F = R.faces[f], lang = pageLang(); if (!F || F.done === lang) return;
  if (!F.c) { F.c = canvas(F.W, F.H); F.tex = heroCanvasTex(F.c, true); F.tex.generateMipmaps = false; F.tex.minFilter = THREE.LinearFilter; }
  if (f === 0) paintContents(F, R, lang); else if (F.ch) paintChapter(F, R, lang); else paintEnd(F, R, lang);
  F.done = lang; F.tex.needsUpdate = true;
  const L = R.leaves[f % 2 ? (f + 1) / 2 - 1 : f / 2];
  if (f % 2) L.u.uVerso.value = F.tex; else { L.mat.map = F.tex; L.mat.needsUpdate = true; }
  // its pictures, once loaded, paint it again
  if (F.ch) for (const b of F.ch.blocks) if (b.k === 'img' && !R.pics.has(b.src)) {
    const im = new Image(); im.crossOrigin = 'anonymous'; R.pics.set(b.src, im);
    im.onload = () => { for (const G of R.faces) if (G.ch === F.ch && G.done) { G.done = ''; facePaint(R, G.f); } setNeeds(true); };
    im.src = b.src.replace(/w_\d+,h_\d+/, `w_1000,h_${Math.round(1000 / b.ar)}`);
  }
  setNeeds(true);
}
function titlePaint(R) { const lang = pageLang(); if (R.titleDone === lang) return; paintTitlePage(R, lang); R.titleDone = lang; R.endTex.needsUpdate = true; setNeeds(true); }
// as the book starts to open: its title page and contents now, the rest in the browser's idle time
function readOpening(bk) {
  const R = bk.read; if (!R || R.painting) return; R.painting = true;
  titlePaint(R); facePaint(R, 0); facePaint(R, 1); facePaint(R, 2);
  const next = () => { if (!bk.read || !R.painting) return; const F = R.faces.find(F => F.done !== pageLang()); if (!F) return; facePaint(R, F.f); (window.requestIdleCallback || (f => setTimeout(f, 60)))(next, { timeout: 400 }); };
  next();
}
// back on its shelf: its pages let go (painted again when it next comes out), closed on its contents
function readRelease(bk) {
  const R = bk.read; if (!R) return; R.painting = false; R.open = false; R.pending = null; R.spread = 0;
  for (const F of R.faces) { if (F.tex) F.tex.dispose(); if (F.c) { F.c.width = F.c.height = 0; } F.c = F.tex = null; F.done = ''; }
  for (const L of R.leaves) { L.phi = L.from = L.to = L.bend = 0; L.t0 = null; L.u.uPhi.value = L.u.uBend.value = 0; L.u.uVerso.value = R.blank; L.mat.map = R.blank; L.mat.needsUpdate = true; }
  for (const im of R.pics.values()) im.onload = null; R.pics.clear();
}
function readDispose(bk) {
  const R = bk.read; if (!R) return; readRelease(bk);
  for (const L of R.leaves) { L.mesh.geometry.dispose(); L.mat.dispose(); }
  R.blank.dispose(); R.endTex.dispose(); R.endMat.dispose(); bk.read = null;
}
// turn to a spread (0: the contents; k: chapter k): the leaves between turn, one after another
function readTurnTo(bk, s) {
  const R = bk.read; if (!R) { bk.readWant = s; return; }
  s = THREE.MathUtils.clamp(s, 0, R.ch.length); if (!R.open) { R.pending = s; return; }
  for (const f of [2 * s - 1, 2 * s]) if (f >= 0) facePaint(R, f);
  const now = performance.now() / 1000, go = [];
  R.leaves.forEach((L, i) => { const want = i < s ? READ.turn : 0; if (L.to !== want) go.push([L, want]); });
  if (go.length && go[0][1] === 0) go.reverse();   // (turning back: the last turned goes first)
  go.forEach(([L, want], k) => {
    for (const f of [2 * L.i, 2 * L.i + 1]) facePaint(R, f);
    L.from = L.phi; L.to = want; L.dir = Math.sign(want - L.phi) || 1; L.t0 = now + k * READ.stagger * (reduceMotion ? 0 : 1);
    L.dur = reduceMotion ? 0.001 : READ.dur * Math.max(0.35, Math.abs(want - L.phi) / READ.turn);
  });
  R.spread = s; setNeeds(true);
}
// each frame: the leaves' turns; the board's angle (opening or closing) bounds them; true while any moves
function stepRead(bk) {
  const R = bk.read; if (!R) return false;
  const now = performance.now() / 1000, open = bk.flapU.uOpen.value; let moving = false;
  R.open = open >= READ.turn - 1e-3;
  if (R.open && R.pending !== null) { const s = R.pending; R.pending = null; readTurnTo(bk, s); }
  for (const L of R.leaves) {
    if (L.t0 !== null) {
      moving = true;
      if (now >= L.t0) {
        const p = Math.min(1, (now - L.t0) / L.dur), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        L.phi = L.from + (L.to - L.from) * e; L.bend = L.dir * 0.55 * Math.sin(Math.PI * p);
        if (p >= 1) { L.phi = L.to; L.bend = 0; L.t0 = null; }
      }
    }
    L.u.uPhi.value = L.phi; L.u.uBend.value = L.bend; L.u.uMax.value = open;
  }
  return moving;
}
const readTurning = bk => !!(bk.read && bk.read.leaves.some(L => L.t0 !== null));
// where a ray (in the book's frame, metres) meets the open book: the right page (the top leaf not turned, or the block
// under them), the left (the top leaf turned, or the title page on the board), or the board: and a link there
function readHit(bk, o, d) {
  const R = bk.read, S = R && R.shape; if (!S || bk.flapU.uOpen.value < 1.2) return null;
  const pg = S.page, a = bk.flapU.uOpen.value, H = S.hinge, hits = [];
  if (Math.abs(d.x) > 1e-9) {
    const t = (pg.x - o.x) / d.x, y = o.y + d.y * t, z = o.z + d.z * t;
    if (t > 0 && y > pg.y0 && y < pg.y1 && z < pg.z0 && z > pg.z1) hits.push({ side: 'right', t, u: (pg.z0 - z) / (pg.z0 - pg.z1), v: (y - pg.y0) / (pg.y1 - pg.y0) });
  }
  const nx = Math.cos(a), nz = Math.sin(a), den = d.x * nx + d.z * nz;
  if (Math.abs(den) > 1e-9) {   // the board turned open, and what lies on it: the point turned back to where it was says where on the leaf
    const t = ((H.x - o.x) * nx + (H.y - o.z) * nz + (pg.x - H.x)) / den, x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;   // (the plane the turned leaves lie in)
    const c = Math.cos(-a), s = Math.sin(-a), rx = c * (x - H.x) - s * (z - H.y), rz = s * (x - H.x) + c * (z - H.y), z0 = H.y + rz;
    if (t > 0 && y > 0 && y < bk.h && z0 < 0.002 && z0 > -bk.d) {
      const onLeaf = z0 < pg.z0 && z0 > pg.z1 && y > pg.y0 && y < pg.y1;
      hits.push({ side: onLeaf && R.spread > 0 ? 'left' : 'cover', t, u: (pg.z0 - z0) / (pg.z0 - pg.z1), v: (y - pg.y0) / (pg.y1 - pg.y0), rx });
    }
  }
  const h = hits.sort((p, q) => p.t - q.t)[0]; if (!h) return null;
  if (h.side === 'cover') return h;
  const f = h.side === 'right' ? 2 * R.spread : 2 * R.spread - 1, F = R.faces[f];
  const px = (h.side === 'right' ? h.u : 1 - h.u) * R.W, py = (1 - h.v) * R.H;
  h.face = f; h.link = F ? F.links.find(l => px >= l.x0 && px <= l.x1 && py >= l.y0 && py <= l.y1) || null : null;
  return h;
}
// what a click there does: a link turns to its spread; the right page to the next, the left to the one before; the
// board puts the book back (the caller)
function readClick(bk, h) {
  const R = bk.read; if (!R || readTurning(bk)) return true;
  if (h.link) { if (h.link.href) window.open(h.link.href, '_blank', 'noopener'); else readTurnTo(bk, h.link.go); }
  else if (h.side === 'right') { if (R.spread < R.ch.length) readTurnTo(bk, R.spread + 1); }
  else if (h.side === 'left') readTurnTo(bk, R.spread - 1);
  else return false;
  return true;
}
// the words for the pointer's tip there
function readHint(bk, h) {
  const R = bk.read; if (!R || !h) return null;
  if (h.link && h.link.href) return ['Open the link ↗', 'Mở liên kết ↗'];
  if (h.link) { const s = h.link.go, ch = R.ch[s - 1]; return s ? ['Turn to ' + ch.en, 'Lật tới ' + ch.name] : ['Back to the contents', 'Về mục lục']; }
  if (h.side === 'right') return R.spread < R.ch.length ? ['Click to turn the page', 'Bấm để lật trang'] : null;
  if (h.side === 'left') return ['Click to turn back', 'Bấm để lật lại'];
  return ['Click to put it back', 'Bấm để cất sách'];
}
function relabelRead(bk) { const R = bk.read; if (!R || !R.painting) return; titlePaint(R); for (const f of [2 * R.spread - 1, 2 * R.spread]) if (f >= 0) facePaint(R, f); R.painting = false; readOpening(bk); }
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
  g.fillStyle = ink; g.textAlign = 'center'; g.shadowColor = ink === '#2a2118' ? 'rgba(255,248,232,.55)' : 'rgba(20,14,8,.6)'; g.shadowBlur = Math.max(4, W * 0.012);
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
  const band = (w, h) => { g.save(); g.shadowBlur = 0; g.fillStyle = g.fillStyle === '#2a2118' ? 'rgba(255,248,232,.5)' : 'rgba(22,16,10,.42)';
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
  OVER.u.uDepth.value = POST.rt.depthTexture; renderer.getDrawingBufferSize(OVER.u.uRes.value); if (OVER.u.uPR) OVER.u.uPR.value = renderer.getPixelRatio();
  // the night sky first: it darkens the dome behind it (fx/sky.js), so the rain, the deck, the animals and the rest stand in front of it
  if (OVER.sky && OVER.sky.visible) { renderer.autoClear = false; renderer.render(OVER.skyScene, camera); renderer.autoClear = true; }
  drawRain(); drawDeck(); drawPets();   // (the rain first: the deck and the animals stand in front of it)
  // the shelves' titles and the fireflies, then the book out of the shelf over them (sharp: it is not in the picture, so the
  // room's depth does not hide the titles behind it)
  if (any) { renderer.autoClear = false; renderer.render(OVER.scene, camera); renderer.autoClear = true; }
  drawSharpBooks();
}
/* The Yale Bright Star Catalogue, 5th edition (Hoffleit & Warren, Yale / NASA ADC): its 2887 stars to magnitude 5.5,
   J2000 positions, from github.com/brettonw/YaleBrightStarCatalog (bsc5-short.json, MIT licence), packed as the 3D
   garden packs it (3d-garden: app/core/star-catalog.js). Each star: its right ascension (rising; the difference as a
   7-bit varint, in 360°/16384 steps), then 4 bytes: declination 13 bits (180°/8191 from −90°), V magnitude 8 bits
   (0.05 from −1.5), colour temperature 5 bits (2400 to 42000 K on a log scale). */
const STAR_BSC5 =
  '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';
/* ---- the night sky over the glass, drawn sharp after the watercolour pass (its filter wipes out points this small) and
   only where the room shows sky: every pixel is tested against the room's depth, which the sky dome and the glass leave
   empty. As the real sky over the visitor is (G, 15/10/2026: "make the night sky realistic"; the 3D garden's research,
   3d-garden: app/core/night-sky.js):
   - the stars of the Yale Bright Star Catalogue (2887, to magnitude 5.5) where they stand at this minute: their J2000
     places turned by the local sidereal time where the visitor's clock says they are (src/sun: Pleiku, 13.98° N,
     108° E, for a clock on Vietnam's time) and set in the room by its compass (the same
     one the sun is placed by, fx/hour.js: the left glass looks west, the back glass north), so they rise in the east,
     wheel round the pole star 14° up in the north and set in the west as the night goes on; and the fainter ones under
     the catalogue's limit, 5.5 to 7.5, made up as many as the sky has (about 21,000: some 2.5 times as many each
     magnitude fainter), crowding toward the Milky Way's plane and its centre, so the band is grainy with stars as it is;
   - each as bright as its magnitude (light ∝ 10^(−0.4 m), sized by its logarithm), the brightest with a halo; the
     colour of its temperature (B−V), seen only in the bright ones (night vision barely sees colour); dimmed and reddened
     low down by the air (0.2 magnitude per airmass, Kasten & Young 1989) and twinkling more and more slowly toward the
     horizon, the bright ones there flashing colours;
   - the faintest seen as dark a sky allows: magnitude 6.5 once the twilight is over (a country sky, Bortle 3, the
     garden's Pleiku), as the sun goes down: ~1.5 at the end of civil twilight (−6°), ~4.5 at −12°, all of them past
     astronomical twilight (−18°); less under the moon (up to 1.8 magnitudes lost at full moon, more close to it);
   - the Milky Way (G, 15/10/2026: "realistic night sky phải có cả dải ngân hà, và nhiều sao"), in galactic
     coordinates: a thin disk of light (±4° far out, ±7° toward the centre) in a faint wide glow, brightest toward the
     centre in Sagittarius (its bulge, warm in colour), with the Scutum and Cygnus star clouds and the Carina arm,
     faintest toward the anticentre in Auriga; mottled with star clouds and cut by dark nebulae, the Great Rift splitting
     it from Cygnus down to Ophiuchus; dimmed and lost low down by the air (airmass), coming out only as the twilight
     ends and washed out by moonlight; as bright, where it is brightest, as two to three times the dark sky round it
     (its surface brightness ~20.5 against ~21.8 magnitudes per square arcsecond); and the moon's light scattered round
     the moon.
   The sky is set as a painter would set it (G, 15/10/2026: "cho dải ngân hà nằm ngay góc"): the real sky, its
   constellations as they are, turned so that the Milky Way crosses the corner of the left glass that the room's first
   view shows (only some 12° of sky across, 3° to 16° up, round the moon), rising steeply through it from lower left to
   upper right past the moon: its stretch from Sagittarius's edge up to Scutum (longitude ~15° to ~31°), warm low down
   toward the centre, blue-white higher up, the Great Rift down one side of it, drawn narrower and brighter than the real
   one (so a band, not a glow, in so small a window), and held there; low as that corner is, the air there takes only a
   little of it. And it is drawn as a long exposure shows it (G, 16/10/2026: his photo of the Milky Way, "em reference
   sreenshot này"): the sky's own dark laid over the sky dome (a deep navy, a touch of teal in it), the whole sky crowded
   with faint stars (a field of them, made in the shader, as many as the photo shows: some 35 a 100 × 100 px patch), the
   band clumped into star clouds that sparkle with the stars they are made of, cut by ragged dust lanes, and the moon
   washing out less of it than it would the real one; then the band 20 % fainter, twice (G, 16/10/2026: "less bright
   20%", "bớt sáng lại 20%"), and with 30 % less light from it again (G, 17/10/2026: "cho dải ngân hà bớt sáng lại 30%"; its terms at 0.75 of what they were, as its fainter grain thins out too: measured 0.70 of the light it added), the field of stars and the dark of the sky as they were. ?sky=real shows the sky as it stands over the visitor at this minute
   instead (turning with the hours, dimmed low down by the full air).
   Drawn back to front: the Milky Way, the stars, the comet, then the moon over them (it hides what is behind it), and
   the shooting stars last (they burn in our own air, in front of the moon). The moon has the phase of the page's sky
   clock and hangs in the left glass. */
const SDEG = Math.PI / 180;
// the sky's own dark (the night's, times how clear the sky is: under thick cloud and rain no stars, no moon: fx/rain.js)
const SKYN = { value: 0 }, SKYCLEAR = { value: 1 };
// equatorial (J2000) → galactic
const GAL = new THREE.Matrix3().set(-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.4448296300, 0.7469822445, -0.8676661490, -0.1980763734, 0.4559837762);
const STARU = { uEq: { value: new THREE.Matrix3() }, uGal: { value: new THREE.Matrix3() }, uLim: { value: 6.3 }, uMW: { value: 1 }, uMoon: { value: new THREE.Vector3(0, 1, 0) }, uMoonK: { value: 0 }, uEye: { value: new THREE.Vector3() },
  uExtS: { value: 0.2 }, uExtM: { value: 0.32 }, uHz: { value: 0.12 },   // the air's toll low down: magnitudes per airmass (stars), its log (the Milky Way), the haze's height
  uBand: { value: 1 }, uMWK: { value: 0.38 }, uBandStars: { value: 0 }, uGrain: { value: 1 }, uBandMag: { value: 0 },   // (and its clouds finer, its stars brighter)   // (the painter's sky: the band drawn narrower and brighter, with its own grain of stars)
  uDeep: { value: 0 }, uField: { value: 0 }, uFaintMag: { value: 0 } };   // (the dark it lays over the sky dome; the painter's field of faint stars; the made-up stars a little brighter there)
// where the Milky Way is set (compass bearing from north and height, degrees): a point on it (on the horizon), and a
// point further along it toward Scutum and Aquila; lc: the galactic longitude midway between them (the centre lc back
// along it: below the horizon, its warm glow coming up into the corner); ?sky=real: the sky of this minute instead
const SKYSET = { real: (() => { try { return new URLSearchParams(location.search).get('sky') === 'real'; } catch (e) { return false; } })(), a: [351.9, 0], b: [7.3, 22], lc: 25, key: '' };   // (the band from a to b; galactic longitude lc between them)
const SKY_NOISE = `
  float sh3(vec3 p) { p = fract(p * 0.3183099 + 0.1) * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float sn3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(sh3(i), sh3(i + vec3(1, 0, 0)), f.x), mix(sh3(i + vec3(0, 1, 0)), sh3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(sh3(i + vec3(0, 0, 1)), sh3(i + vec3(1, 0, 1)), f.x), mix(sh3(i + vec3(0, 1, 1)), sh3(i + 1.0), f.x), f.y), f.z); }
  float sfbm(vec3 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * sn3(p); p = p * 2.03 + 7.1; a *= 0.5; } return s * 1.0667; }`;
const AIRMASS = 'float airmass(float el) { return 1.0 / (max(el, 0.0) + 0.50572 * pow(max(96.07995 - acos(clamp(el, -1.0, 1.0)) * 57.29578, 1.0), -1.6364)); }';   // (Kasten–Young)
function kelvinRGB(K, out) {   // a black body's colour (Tanner Helland's fit), linear, its largest channel 1
  const t = K / 100, r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332), g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * Math.pow(t - 60, -0.0755), b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305;
  const c = [r, g, b].map(v => Math.pow(Math.max(0, Math.min(255, v)) / 255, 2.2)), m = Math.max(...c); out.push(c[0] / m, c[1] / m, c[2] / m);
}
function buildStars(sky) {
  const dir = [], mag = [], col = [], seed = [], r = rng(90417), L0 = Math.log(2400), L1 = Math.log(42000);
  { const raw = atob(STAR_BSC5); let p = 0, q = 0;   // the catalogue
    while (p < raw.length) {
      let dl = 0, sh = 0, c; do { c = raw.charCodeAt(p++); dl |= (c & 127) << sh; sh += 7; } while (c & 128);
      q += dl; const y = raw.charCodeAt(p) | raw.charCodeAt(p + 1) << 8 | raw.charCodeAt(p + 2) << 16 | raw.charCodeAt(p + 3) << 24; p += 4;
      const ra = q / 16384 * 2 * Math.PI, de = ((y & 8191) / 8191 * 180 - 90) * SDEG;
      dir.push(Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)); mag.push((y >>> 13 & 255) * 0.05 - 1.5);
      kelvinRGB(Math.exp(L0 + (y >>> 21 & 31) / 31 * (L1 - L0)), col); seed.push(r());
    }
  }
  const iF = dir.length / 3;   // (the made-up ones from here: aBand 1; the band's own grain 2)
  { const v = new THREE.Vector3(), gv = new THREE.Vector3(), a = 0.4, A0 = Math.pow(10, a * 5.5), A1 = Math.pow(10, a * 7.5);   // fainter ones made up: ~2.5 times as many each magnitude, crowding to the galactic plane and its centre
    for (let n = 0; n < 21000;) {
      const z = r() * 2 - 1, f = r() * 2 * Math.PI, sq = Math.sqrt(1 - z * z); v.set(sq * Math.cos(f), sq * Math.sin(f), z);
      gv.copy(v).applyMatrix3(GAL); const gb = Math.abs(gv.z), gc = 0.5 + 0.5 * gv.x / Math.max(1e-6, Math.hypot(gv.x, gv.y));
      if (r() > 0.22 + 0.78 * Math.exp(-gb / 0.16) * (0.55 + 0.45 * gc * gc)) continue;
      dir.push(v.x, v.y, v.z); mag.push(Math.log10(A0 + r() * (A1 - A0)) / a);
      const u = r(); kelvinRGB(u < 0.55 ? 4200 + r() * 1800 : u < 0.88 ? 6000 + r() * 3500 : 9500 + r() * 12000, col); seed.push(r()); n++;
    }
  }
  // the band's own grain (the painter's sky only): 20,000 faint stars, 5.8 to 8, packed into a band ±1.2° wide along the plane,
  // thicker where the band is bright; set in galactic coordinates and turned back to equatorial ones (GAL is orthonormal)
  const band = new Float32Array(dir.length / 3 + 20000); band.fill(1, iF, dir.length / 3);
  { const v = new THREE.Vector3(), Gt = GAL.clone().transpose(), a = 0.4, A0 = Math.pow(10, a * 5.8), A1 = Math.pow(10, a * 8.0), i0 = dir.length / 3;
    for (let n = 0; n < 20000;) {
      const l = (r() * 2 - 1) * Math.PI, bright = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.cos(l), 1.6) + 0.4 * Math.exp(-Math.pow((l - 0.47) / 0.1, 2)) + 0.35 * Math.exp(-Math.pow((l - 1.33) / 0.17, 2));
      if (r() * 1.6 > bright) continue;
      const g1 = r(), g2 = r(), b = Math.sqrt(-2 * Math.log(g1 + 1e-9)) * Math.cos(2 * Math.PI * g2) * 0.021 * (1 + 0.8 * Math.exp(-l * l / 0.5));   // (wider toward the centre)
      v.set(Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)).applyMatrix3(Gt);
      dir.push(v.x, v.y, v.z); mag.push(Math.log10(A0 + r() * (A1 - A0)) / a);
      const u = r(); kelvinRGB(u < 0.6 ? 4300 + r() * 1700 : 6000 + r() * 4000, col); seed.push(r()); band[i0 + n] = 2; n++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(dir, 3)); g.setAttribute('aMag', new THREE.Float32BufferAttribute(mag, 1));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1)); g.setAttribute('aBand', new THREE.BufferAttribute(band, 1));
  const stars = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uTime: OVER.u.uTime, uNight: SKYN, uPR: OVER.u.uPR, ...STARU },
    vertexShader: `attribute float aMag, aSeed, aBand; attribute vec3 aCol; uniform mat3 uEq; uniform vec3 uEye, uMoon; uniform float uTime, uLim, uPR, uMoonK, uExtS, uBandStars, uBandMag, uFaintMag;
      varying vec3 vCol; varying float vHalo; ${AIRMASS}
      void main() {
        gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        float isB = step(1.5, aBand), isF = step(0.5, aBand) - isB;   // (the band's own grain; the made-up faint ones)
        if (isB > 0.5 && uBandStars < 0.5) return;
        vec3 d = uEq * position; float el = d.y;
        if (el < -0.005) return;
        float X = airmass(el), lo = smoothstep(1.3, 7.0, X), fq = mix(4.5, 1.8, lo), ph = aSeed * 50.0;
        float near = dot(d, uMoon), lost = uMoonK * (0.5 * smoothstep(0.7, 0.98, near) + 1.2 * smoothstep(0.985, 0.9995, near));   // (the moon's glare round it)
        float m = aMag + isB * uBandMag + isF * uFaintMag + uExtS * (X - 1.0) + (0.05 + 0.4 * lo) * (0.6 * sin(uTime * fq + ph) + 0.4 * sin(uTime * fq * 1.71 + ph * 1.3));   // the air: dimmer, twinkling
        float dm = uLim - lost - m;   // how many magnitudes above the faintest seen (a little under it still glimpsed)
        if (dm < -1.1) return;
        gl_Position = projectionMatrix * viewMatrix * vec4(uEye + d * 240.0, 1.0);
        float I = min(1.0, 0.15 * exp2(0.6645 * dm));   // its peak: the square root of its light (the eye's compressed response), 1 some 5.5 magnitudes up
        gl_PointSize = uPR * (2.2 + 0.5 * max(dm, 0.0) + 2.6 * smoothstep(4.5, 7.5, dm));
        vHalo = smoothstep(4.5, 7.5, dm);
        vec3 c = mix(vec3(1.0), aCol, 0.2 + 0.55 * smoothstep(1.5, 5.0, dm));   // (the eye sees colour only in the bright ones)
        c *= exp2(-(X - 1.0) * uExtS * vec3(0.0, 0.45, 1.17));   // reddened low down (as much as dimmed)
        c *= 1.0 + lo * smoothstep(3.0, 6.0, dm) * 0.3 * vec3(sin(uTime * 6.0 + ph), sin(uTime * 7.3 + ph * 2.0), sin(uTime * 8.9 + ph * 3.0));   // the bright ones low down flash colours
        vCol = c * I * smoothstep(-1.1, -0.5, dm);
      }`,
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNight; varying vec3 vCol; varying float vHalo;
      void main() { ${SKY_DEPTH}
        vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard;
        vec3 o = vCol * (exp(-r2 * 4.5 * mix(1.0, 3.5, vHalo)) + vHalo * 0.25 * exp(-r2 * 2.5) * (1.0 - r2)) * uNight;
        if (max(o.r, max(o.g, o.b)) < 0.003) discard; gl_FragColor = vec4(o, 0.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true, depthTest: false, depthWrite: false }));
  stars.frustumCulled = false; stars.renderOrder = 1; sky.add(stars);
  // the Milky Way and the moonlight in the air: a shell just inside the stars. It lays the night's own dark over the sky
  // dome too (blended premultiplied: the dome keeps 1 − uDeep of itself), a deep navy as a long exposure of a dark sky
  // shows it (G, 16/10/2026: his photo of the Milky Way), and over that the band and the field of faint stars
  const mw = new THREE.Mesh(new THREE.SphereGeometry(236, 64, 32), new THREE.ShaderMaterial({ side: THREE.BackSide,
    uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uNight: SKYN, ...STARU },
    vertexShader: 'uniform vec3 uEye; varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * viewMatrix * vec4(uEye + position, 1.0); }',
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNight, uMW, uMoonK, uExtM, uHz, uBand, uMWK, uGrain, uDeep, uField; uniform mat3 uGal; uniform vec3 uMoon; varying vec3 vD;
      ${SKY_NOISE} ${AIRMASS} ${SKY_COVER}
      float ridge(vec3 p) { return 1.0 - abs(2.0 * sfbm(p) - 1.0); }   // (1 along the noise's middle value: lines)
      void main() { float cov = skyCover(); if (cov < 0.01) discard;
        vec3 d = normalize(vD); float el = d.y; if (el < -0.02) discard;
        vec3 c = vec3(0.0);
        if (uMW > 0.003) {   // in galactic coordinates (x toward the centre, z toward the north galactic pole)
          vec3 g = uGal * d; float b = asin(clamp(g.z, -1.0, 1.0)) * uBand, l = atan(g.y, g.x), cl = cos(l);
          vec3 gn = vec3(g.xy, g.z * sqrt(uBand)) * mix(1.0, uGrain, 0.6);   // (its clouds a little drawn out along it as it is narrowed; a little finer in a small window)
          float sg = 0.07 + 0.05 * exp(-l * l / 0.5), disk = exp(-b * b / (2.0 * sg * sg));   // the thin disk: ±4° far out, ±7° toward the centre
          float glow = exp(-b * b / 0.16) * 0.12 / uBand;                                      // the faint wide glow round it
          float bul = exp(-l * l / 0.12 - b * b / 0.035);                                      // the bulge in Sagittarius
          float lon = 0.18 + 0.82 * pow(0.5 + 0.5 * cl, 1.6)                                   // brightest toward the centre, faintest toward Auriga
            + 0.35 * exp(-pow((l - 0.47) / 0.1, 2.0)) + 0.3 * exp(-pow((l - 1.33) / 0.17, 2.0)) + 0.22 * exp(-pow((l + 1.38) / 0.22, 2.0));   // Scutum, Cygnus, Carina
          float kw = clamp(1.6 * exp(-l * l / 0.09 - b * b / 0.08) + 0.12 * smoothstep(0.4, 1.0, 0.5 + 0.5 * cl), 0.0, 1.0);   // (warm along its stretch toward the centre, blue further out)
          // the cells of its three grains of stars, and how many pixels each spans (taken here, where every pixel takes it:
          // derivatives are not to be had in a branch some pixels skip)
          vec3 sd = d * 900.0 * uGrain, bd = d * 240.0 * uGrain, fd = d * 160.0 * uGrain;
          float cellPx = 1.0 / max(length(fwidth(sd)), 1e-5), bPx = 1.0 / max(length(fwidth(bd)), 1e-5), fPx = 1.0 / max(length(fwidth(fd)), 1e-5);
          float I = 0.0, dust = 0.0;
          if ((disk * lon + bul) * 3.0 + glow * lon > 0.004) {   // (its clouds and dust only where there is a band to have them)
            // star clouds, clumped as a long exposure shows them: broad clouds drawn out along the band, round knots in
            // them (~1°), mottled (~0.4°)
            vec3 gk = g * mix(1.0, uGrain, 0.6);
            float n1 = sfbm(gn * 6.0), n2 = sfbm(gk * 30.0 + 3.0), n4 = sfbm(gk * 72.0 + 11.0);
            float clouds = (0.35 + 1.3 * pow(smoothstep(0.22, 0.85, n1), 1.3)) * (0.5 + 0.9 * smoothstep(0.32, 0.8, n2)) * (0.65 + 0.7 * smoothstep(0.3, 0.72, n4));
            // the dust in front of them: dark clouds drawn out a little along the band, the Great Rift, and a few winding
            // lanes, broken (the ridges of a noise, where a second one lets them be)
            vec3 gf = vec3(g.xy, g.z * uBand * 0.5) * mix(1.0, uGrain, 0.6);
            float lanes = smoothstep(0.74, 0.95, ridge(gf * 4.5 + 5.0)) * smoothstep(0.42, 0.62, sfbm(gn * 3.0 + 21.0));
            float dark = smoothstep(0.5, 0.65, sfbm(gf * 9.0 + 7.0));
            float rb = b - 0.075 + 0.07 * (n1 - 0.5) + 0.08 * (n2 - 0.5), rift = exp(-rb * rb / ((0.0016 + 0.004 * exp(-l * l / 0.15)) * (0.45 + 1.1 * n4)));
            rift = smoothstep(0.22, 0.72, rift + 0.4 * (n4 - 0.5) + 0.25 * (n2 - 0.5)) * smoothstep(-0.25, 0.0, l) * smoothstep(1.5, 1.2, l);   // the Great Rift, Cygnus to Ophiuchus, down one side of the band: winding, now wide now narrow (wider toward the centre), its edges ragged
            dust = clamp(0.92 * rift + 0.6 * dark + 0.7 * lanes * smoothstep(0.04, 0.4, disk + bul), 0.0, 0.95);
            I = (disk * lon + 0.8 * bul) * clouds * (1.0 - dust) + glow * lon * (1.0 - 0.4 * dust);
            // its colour: blue-white star clouds (whiter where they are thickest), a cream core in a warm brown-orange glow,
            // the light reddened where the dust thins it
            vec3 tint = mix(mix(vec3(0.62, 0.72, 1.0), vec3(0.86, 0.9, 1.0), smoothstep(0.7, 1.8, clouds)), mix(vec3(1.0, 0.64, 0.42), vec3(1.0, 0.88, 0.72), smoothstep(0.3, 0.8, bul)), kw);
            tint *= mix(vec3(1.0), vec3(1.0, 0.7, 0.48), smoothstep(0.15, 0.75, dust));
            c += uMW * I * tint * uMWK * 0.48;   // (its glow: the rest of its light is in its stars, below)
            // the pink of the glowing hydrogen in the clouds round the centre (the Lagoon and Trifid nebulae, and others)
            float em = smoothstep(0.6, 0.8, sfbm(gn * 26.0 + 13.0)) * exp(-l * l / 0.07 - b * b / 0.03) * (1.0 - 0.8 * dust);
            c += uMW * em * vec3(1.0, 0.3, 0.45) * uMWK * 0.25;
          }
          // its finest grain: the faint stars it is made of, as thick as the band is bright (a cell of the sky ~0.03° across
          // holds one or none, where it falls in the cell, how bright), let go where cells come smaller than two pixels
          { vec3 ci = floor(sd), cf = fract(sd) - 0.5;
            float s1 = fract(sin(dot(ci, vec3(12.9898, 78.233, 37.719))) * 43758.5453), s2 = fract(s1 * 37.13 + 0.17), s3 = fract(s1 * 91.7 + 0.53), s4 = fract(s1 * 13.1 + 0.71);
            float sdd = length(cf - (vec3(s2, s3, s4) - 0.5) * 0.6);
            float grain = smoothstep(0.32, 0.0, sdd) * step(s1, clamp(I * 1.7, 0.0, 0.85)) * (0.3 + 0.7 * s3 * s3) * smoothstep(1.2, 2.4, cellPx);
            c += uMW * grain * mix(vec3(0.76, 0.85, 1.0), vec3(1.0, 0.92, 0.8), s2 * 0.7) * 0.719; }
          // its stars that a long exposure picks out one by one, as many and as bright as the band is there, so that it
          // sparkles (cells of ~0.1°; each a soft point a pixel or two across, its size in pixels whatever the view, kept
          // inside its cell)
          { vec3 bi = floor(bd), bf = fract(bd) - 0.5;
            float k1 = fract(sin(dot(bi, vec3(269.5, 183.3, 246.1))) * 43758.5453), k2 = fract(k1 * 29.71 + 0.43), k3 = fract(k1 * 67.13 + 0.29), k4 = fract(k1 * 11.37 + 0.77), k5 = fract(k1 * 83.91 + 0.59);
            float k53 = k5 * k5 * k5, rq = length(bf - (vec3(k2, k3, k4) - 0.5) * 0.3) * bPx, sq = 0.65 + 0.45 * k53;
            float sb = step(k1, clamp(I * 1.2, 0.0, 0.9)) * (0.1 + 0.8 * k53) * (0.5 + 0.7 * min(I, 1.5)) * exp(-rq * rq / (2.0 * sq * sq)) * smoothstep(2.5, 5.0, bPx);
            c += uMW * sb * mix(vec3(0.8, 0.87, 1.0), vec3(1.0, 0.86, 0.66), max(kw, step(0.8, k4))) * 0.719; }
          // the field: faint stars all over the sky, thicker toward the band and fewer behind its dust, as the photo is
          // crowded with them (cells of ~0.15°, a star in about a third of them, most faint, a few bright, the brighter the
          // wider; let go where the cells come under 3 pixels)
          if (uField > 0.0) {
            vec3 fi = floor(fd), ff = fract(fd) - 0.5;
            float h1 = fract(sin(dot(fi, vec3(127.1, 311.7, 74.7))) * 43758.5453), h2 = fract(h1 * 41.37 + 0.31), h3 = fract(h1 * 73.11 + 0.61), h4 = fract(h1 * 19.73 + 0.87), h5 = fract(h1 * 57.29 + 0.13);
            float rp = length(ff - (vec3(h2, h3, h4) - 0.5) * 0.3) * fPx, hide = dust * smoothstep(0.05, 0.4, disk + bul);
            float p = (0.42 + 0.25 * smoothstep(0.02, 0.6, I)) * (1.0 - 0.7 * hide), h54 = h5 * h5 * h5 * h5, sig = 0.7 + 0.9 * h54;
            float fs = step(h1, p * uField) * (0.08 + h54) * exp(-rp * rp / (2.0 * sig * sig)) * smoothstep(2.5, 5.0, fPx);
            c += uMW * fs * mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.86, 0.68), step(0.85, h4)) * 1.2;
          }
        }
        c *= exp(-uExtM * (airmass(el) - 1.0)) * smoothstep(-0.01, uHz, el);   // dimmed by the air and lost in the haze low down
        c += uMW * vec3(0.012, 0.022, 0.013) * smoothstep(0.0, 0.06, el) * exp(-el / 0.3);   // the airglow: the upper air's own faint green light, low in a dark sky
        float mn = max(dot(d, uMoon), 0.0);
        c += uMoonK * vec3(0.05, 0.065, 0.09) * (0.35 * pow(mn, 6.0) + 0.65 * pow(mn, 60.0));   // the moon's light in the air round it
        float a = uDeep * smoothstep(-0.02, 0.04, el);   // the dark over the dome, a hint of teal in it
        c += a * vec3(0.0, 0.028, 0.046);
        c *= uNight * cov; a *= uNight * cov; if (max(c.r, max(c.g, c.b)) < 0.002 && a < 0.004) discard;
        gl_FragColor = vec4(c, a); }`,
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false }));   // (normal blending, premultiplied: ONE, ONE − alpha)
  mw.frustumCulled = false; mw.renderOrder = 0; sky.add(mw);
}
// the sky turned to this minute: equatorial → the room, by the local sidereal time and the room's compass
const _E = new THREE.Vector3(), _N = new THREE.Vector3(), _Z = new THREE.Vector3(), _gt = new THREE.Matrix3();
const _sX = new THREE.Vector3(), _sP = new THREE.Vector3(), _sY = new THREE.Vector3(), _sZ = new THREE.Vector3(), _sM = new THREE.Matrix3();
function skyDir(az, el, v) { const p = (az - 103.7) * SDEG, e = el * SDEG; return v.set(Math.cos(e) * Math.cos(p), Math.sin(e), Math.cos(e) * Math.sin(p)); }   // (the room's compass: fx/hour.js sunDirAt)
function stepStars() {
  SKYN.value = NIGHT.u.value * SKYCLEAR.value;
  if (!SKYSET.real) {   // the painter's sky: the galactic centre and the plane through it, set where SKYSET says
    const key = SKYSET.a.join() + '|' + SKYSET.b.join() + '|' + SKYSET.lc;
    if (key !== SKYSET.key) {
      SKYSET.key = key; skyDir(SKYSET.a[0], SKYSET.a[1], _sX); skyDir(SKYSET.b[0], SKYSET.b[1], _sP);
      _sZ.crossVectors(_sX, _sP).normalize();                      // the plane through a and b: its north pole
      _sP.add(_sX).normalize(); _sY.crossVectors(_sZ, _sP);        // the middle of the two, and the way along the plane toward b there
      const t = SKYSET.lc * SDEG; _sX.copy(_sP).multiplyScalar(Math.cos(t)).addScaledVector(_sY, -Math.sin(t));   // the centre: lc back along it
      _sY.crossVectors(_sZ, _sX);                                   // (longitude 90° along it toward b)
      _sM.set(_sX.x, _sY.x, _sZ.x, _sX.y, _sY.y, _sZ.y, _sX.z, _sY.z, _sZ.z);   // galactic → the room
      STARU.uEq.value.multiplyMatrices(_sM, GAL); STARU.uGal.value.copy(_sM).transpose();
      STARU.uExtS.value = 0.07; STARU.uExtM.value = 0.07; STARU.uHz.value = 0.035; STARU.uBand.value = 3.4; STARU.uMWK.value = 1.483; STARU.uBandStars.value = 1; STARU.uGrain.value = 2.4; STARU.uBandMag.value = -1.59;   // (10 % brighter and clearer again: G, 16/10/2026; then 30 % less light from it, measured: G, 17/10/2026)
      STARU.uField.value = 1; STARU.uFaintMag.value = -1.0;   // (the sky crowded with faint stars, as G's photo of it is: 16/10/2026)
    }
  } else stepRealSky();
  skyLight();
}
function stepRealSky() {
  STARU.uExtS.value = 0.2; STARU.uExtM.value = 0.32; STARU.uHz.value = 0.12; STARU.uBand.value = 1; STARU.uMWK.value = 0.42; STARU.uBandStars.value = 0; STARU.uGrain.value = 1; STARU.uBandMag.value = 0; STARU.uField.value = 0; STARU.uFaintMag.value = 0;
  const d = HOUR.pin || new Date(), P = window.HL_SUN.place, lat = P.lat * SDEG, lon = P.lon;
  const jd = d.getTime() / 864e5 + 2440587.5, th = ((280.46061837 + 360.98564736629 * (jd - 2451545.0) + lon) % 360) * SDEG;   // local sidereal time
  const sf = Math.sin(lat), cf = Math.cos(lat), st = Math.sin(th), ct = Math.cos(th), p0 = 103.7 * SDEG, sp = Math.sin(p0), cp = Math.cos(p0);
  _Z.set(cf * ct, cf * st, sf); _N.set(-sf * ct, -sf * st, cf); _E.set(-st, ct, 0);   // the zenith, north and east, in equatorial terms
  const X = _E.clone().multiplyScalar(sp).addScaledVector(_N, cp), Z = _E.clone().multiplyScalar(cp).addScaledVector(_N, -sp);   // the room's x and z (as the sun is placed: fx/hour.js sunDirAt)
  STARU.uEq.value.set(X.x, X.y, X.z, _Z.x, _Z.y, _Z.z, Z.x, Z.y, Z.z);
  STARU.uGal.value.copy(GAL).multiply(_gt.copy(STARU.uEq.value).transpose());   // the room → galactic
}
function skyLight() {   // how faint a star is still seen, and how bright the Milky Way: the dark of the night, the moon's light
  const e = HOUR.e === null ? -20 : HOUR.e, lit = 0.5 - 0.5 * Math.cos(moonAge() * 2 * Math.PI), up = OVER.moon && OVER.moon.visible ? 1 : 0;
  STARU.uMoonK.value = up * Math.pow(lit, 0.8);
  const mk = STARU.uMoonK.value * (SKYSET.real ? 1 : 0.4);   // (the painter's sky is set for its look: the moon takes less of it)
  STARU.uLim.value = 6.5 - 5.0 * THREE.MathUtils.smoothstep(e, -18, -4) - 1.8 * mk;   // (the twilight's glow, then the moon's)
  STARU.uMW.value = (1 - THREE.MathUtils.smoothstep(e, -17, -10)) * (1 - 0.88 * mk) * (STARU.boost || 1);   // (out as the twilight ends; boost: for tests)
  STARU.uDeep.value = 0.65 * (1 - THREE.MathUtils.smoothstep(e, -16, -9)) * (1 - 0.5 * mk);   // the dark of the sky itself, deep once the twilight is over (less under the moon)
  if (OVER.moon) STARU.uMoon.value.copy(OVER.moon.position).sub(REF.eye).normalize();
  STARU.uEye.value.copy(REF.eye);
}

const LUNAR = 29.530588853, NEW_MOON = Date.UTC(2025, 6, 25, 18, 2);   // the page's own reference new moon
const moonAge = (t = Date.now()) => ((((t - NEW_MOON) / 864e5) % LUNAR) + LUNAR) % LUNAR / LUNAR;   // 0 new, 0.5 full
const SKY_DEPTH = 'if (gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 1e-7) discard;';
// how much of a pixel shows sky, softly: the room's depth is a coarser grid than the screen (80 % of CSS pixels against
// the screen's two a pixel), so a test of its one nearest texel left the leaves' edges against a lit sky in steps (G,
// 16/10/2026: the trees by night jagged where by day they were not); 3 × 3 taps across a texel and a third, averaged
const SKY_COVER = `float skyCover() {
  vec2 uv = gl_FragCoord.xy / uRes, tx = 0.66 / vec2(textureSize(uDepth, 0)); float s = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) s += step(gl_FragCoord.z, texture2D(uDepth, uv + vec2(float(i), float(j)) * tx).r + 1e-7);
  return s / 9.0; }`;
function buildNightSky() {
  const eye = REF.eye, far = 240, sky = new THREE.Group(); sky.visible = false; OVER.sky = sky;
  OVER.skyScene = new THREE.Scene(); OVER.skyScene.add(sky);   // (a scene of its own, drawn before the rest of the sharp layer: its dark is laid over the dome, so all else goes in front of it)
  OVER.moonAge = { value: moonAge() };
  buildStars(sky);
  // the moon: the page's own moon picture for tonight's phase (the one its sky clock shows), 1.6° across (the real one is
  // 0.5°), with a soft halo
  const rad = far * Math.tan(0.8 * Math.PI / 180);
  OVER.moonImg = { value: null };
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(6 * rad, 6 * rad), new THREE.ShaderMaterial({
    uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uNight: SKYN, uAge: OVER.moonAge, uImg: OVER.moonImg },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uDepth, uImg; uniform vec2 uRes; uniform float uNight, uAge; varying vec2 vUv; ${SKY_COVER}
      void main(){ float cov = skyCover(); if (cov < 0.01) discard;
        vec2 p = (vUv - 0.5) * 6.0; float r = length(p), lit = 0.5 - 0.5 * cos(uAge * 6.2831853);
        vec4 c = vec4(0.0);
        if (r < 1.02) { vec4 m = texture2D(uImg, p * 0.5 + 0.5); c = vec4(m.rgb * m.a, m.a); }   // straight-alpha picture, made premultiplied
        float halo = 0.3 * exp(-max(r - 1.0, 0.0) * 1.7) * (0.45 + 0.55 * lit) * smoothstep(3.0, 2.2, r) * (1.0 - c.a);
        c += vec4(vec3(0.82, 0.86, 1.0) * halo, halo);
        if (c.a < 0.004) discard; gl_FragColor = c * uNight * cov; }`,
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false }));
  moon.visible = false;   // until its picture has loaded
  moon.renderOrder = 3;   // (over the Milky Way, the stars and the comet: it hides them)
  sky.add(moon); OVER.moon = moon; placeMoon();
  buildMeteors(sky);
}
/* ---- shooting stars, now and then, as the garden's night sky draws them (3d-garden: app/core/night-sky.js): about one
   in 16 s at full night, at most three at once, each a streak across the sky in about a second (the faster the
   shorter; half the speed they first had, G 15/10/2026), its tail thinning out behind a bright round head, now and then a brighter, slower fireball; and only
   where the room shows sky (they pass 230 m off, inside the stars' sphere, under the same depth test). Each is a strip
   on the screen, rebuilt every frame from its two ends on the sky. Where one flies is chosen so that it is seen: when
   one is due, 32 paths are tried against the room's depth on the GPU (two points of each, a third and two thirds of
   the way, where it burns brightest; one row of pixels, read back without stalling the frame) and the first whose
   two points both show sky, with none of the page's panels over them, is sent; if none does, it is tried again 1.5 s later, up to five times (a view with little
   sky still gets its share; one with none, none). */
const METEOR = { list: [], mesh: null, on: false, last: 0 };
const _m0 = new THREE.Vector3(), _m1 = new THREE.Vector3(), _mh = new THREE.Vector3(), _mt = new THREE.Vector3();
function buildMeteors(sky) {
  const MQ = 3, idx = []; for (let k = 0; k < MQ; k++) idx.push(4 * k, 4 * k + 1, 4 * k + 2, 4 * k + 2, 4 * k + 1, 4 * k + 3);
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MQ * 12), 3)); g.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(MQ * 16), 4)); g.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(MQ * 12), 3));
  METEOR.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uNight: SKYN },
    vertexShader: 'attribute vec4 aC; attribute vec3 aT; varying vec4 vC; varying vec3 vT; void main(){ vC = aC; vT = aT; gl_Position = vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNight; varying vec4 vC; varying vec3 vT; ${SKY_COVER}
      void main(){ float cov = skyCover(); if (cov < 0.01) discard;
        float u = clamp(vT.x, 0.0, 1.0), w = vT.y * vT.y;
        float k = pow(u, 2.6) * exp(-w * 5.0) + 1.6 * exp(-pow((1.0 - u) / 0.05, 2.0) - w * 1.5);   // the tail thinning out, the head bright
        float a = vC.a * k * smoothstep(1.04, 0.995, vT.x) * uNight * cov * 0.8; if (a < 0.003) discard;      // (a round tip, not a square end; 20 % fainter: G, 16/10/2026)
        gl_FragColor = vec4(vC.rgb * a, 0.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true, depthTest: false, depthWrite: false }));   // (added as it is: ONE, ONE)
  METEOR.mesh.frustumCulled = false; METEOR.mesh.visible = false; METEOR.mesh.renderOrder = 4; sky.add(METEOR.mesh);   // (in our air: in front of the moon)
  METEOR.spawn = spawnMeteor; METEOR.probe = PROBE;   // (for tests)
  METEOR.moonPos = () => { const p = OVER.moon.position.clone().project(OVER.cam || window.__lib3d.camera); return [(p.x + 1) * innerWidth / 2, (1 - p.y) * innerHeight / 2]; };   // (for tests)
  buildComet(sky);
}
function meteorPath(camera) {   // a start somewhere in the upper part of the view, 6° or more up; a path down and across
  _m0.set(Math.random() * 1.9 - 0.95, 0.15 + Math.random() * 0.8, 0.5).unproject(camera).sub(camera.position).normalize();
  if (_m0.y < 0.1) return null;   // (6° up or more)
  const side = _mh.set(0, 1, 0).cross(_m0).normalize(), down = _mt.crossVectors(_m0, side), th = Math.random() * Math.PI * 2;
  const tn = side.multiplyScalar(Math.cos(th)).addScaledVector(down, Math.sin(th) - 0.35); tn.addScaledVector(_m0, -tn.dot(_m0)).normalize();   // (leaning a little downward)
  const fire = Math.random() < 0.05, v = fire ? 18 + Math.random() * 14 : 20 + Math.random() * 50, ang = (fire ? 14 + Math.random() * 12 : 5 + Math.random() * 15) * Math.PI / 180;
  return { d0: _m0.clone(), d1: _m0.clone().multiplyScalar(Math.cos(ang)).addScaledVector(tn, Math.sin(ang)).normalize(), t: 0,
    dur: 2 * Math.min(fire ? 2.2 : 1.4, Math.max(0.3, ang * 180 / Math.PI / (v * 0.45 * (0.8 + 0.4 * Math.random())))), b: fire ? 2.2 : 0.9 + Math.random() * 0.8,   // (half the speed: G 15/10/2026)
    w: fire ? 1.7 : 1, fast: Math.min(1, Math.max(0, (v - 35) / 30)) };
}
const PROBE = { n: 32, rt: null, quad: null, cand: [], busy: false, buf: new Uint8Array(256), left: 0, at: 0, tries: 0, sent: 0 };   // (tries, sent: for tests)
// n paths from make() tried against the room's depth on the GPU: the first whose two points (f0 and f1 of the way along
// it) show sky, with none of the page's panels over them, goes to hit(); miss() if none does. false if a probe is
// already out (it is read back without stalling the frame)
function probeSky(camera, make, f0, f1, hit, miss) {
  if (PROBE.busy || !OVER.u.uDepth.value) return false;
  if (!PROBE.rt) {
    PROBE.rt = new THREE.WebGLRenderTarget(2 * PROBE.n, 1, { depthBuffer: false });
    PROBE.quad = new FullScreenQuad(new THREE.ShaderMaterial({ depthTest: false, depthWrite: false,
      uniforms: { uDepth: OVER.u.uDepth, uP: { value: Array.from({ length: 2 * PROBE.n }, () => new THREE.Vector3()) } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D uDepth; uniform vec3 uP[${2 * PROBE.n}];
        void main() { vec3 p = uP[int(gl_FragCoord.x)]; vec2 uv = p.xy * 0.5 + 0.5;   // one pixel per point: 1 where it shows sky
          bool on = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && p.z < 1.0 && p.z * 0.5 + 0.5 <= texture2D(uDepth, uv).r + 1e-7;
          gl_FragColor = vec4(on ? 1.0 : 0.0, 0.0, 0.0, 1.0); }` }));
  }
  const C = PROBE.cand, U = PROBE.quad.material.uniforms.uP.value; C.length = 0; PROBE.tries++;
  for (let i = 0; i < PROBE.n; i++) {
    const e = make(); C.push(e);
    if (!e) { U[2 * i].set(9, 9, 9); U[2 * i + 1].set(9, 9, 9); continue; }
    for (let j = 0; j < 2; j++) U[2 * i + j].copy(e.d0).lerp(e.d1, j ? f1 : f0).normalize().multiplyScalar(230).add(camera.position).project(camera);
  }
  const prev = renderer.getRenderTarget(); renderer.setRenderTarget(PROBE.rt); PROBE.quad.render(renderer);
  const done = () => {
    PROBE.busy = false;
    const r = CANVAS.getBoundingClientRect(), bare = q => document.elementFromPoint(r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height) === CANVAS;
    let found = null;
    for (let i = 0; i < PROBE.n && !found; i++) if (C[i] && PROBE.buf[8 * i] > 127 && PROBE.buf[8 * i + 4] > 127 && bare(U[2 * i]) && bare(U[2 * i + 1])) found = C[i];
    C.length = 0; if (found) { hit(found); setNeeds(true); } else if (miss) miss();
  };
  if (renderer.readRenderTargetPixelsAsync) {   // (it leaves its target bound until it resolves: the frame's own put back at once)
    PROBE.busy = true; renderer.readRenderTargetPixelsAsync(PROBE.rt, 0, 0, 2 * PROBE.n, 1, PROBE.buf).then(done, () => { PROBE.busy = false; });
  } else { renderer.readRenderTargetPixels(PROBE.rt, 0, 0, 2 * PROBE.n, 1, PROBE.buf); done(); }
  renderer.setRenderTarget(prev);
  return true;
}
function spawnMeteor(camera) {   // 32 paths tried: the first whose bright middle (a third and two thirds of the way) shows sky is sent
  if (METEOR.list.length >= 3) return;
  probeSky(camera, () => meteorPath(camera), 0.3, 0.7,
    e => { if (METEOR.list.length < 3) { METEOR.list.push(e); PROBE.sent++; } PROBE.left = 0; },
    () => { PROBE.left = Math.max(0, PROBE.left - 1); });
}
function stepMeteors(t, camera) {
  stepStars();
  const dt = Math.min(0.1, Math.max(0, t - METEOR.last)); METEOR.last = t;
  const night = NIGHT.u.value, M = METEOR.list, mesh = METEOR.mesh; if (!mesh) return;
  if (night > 0.6 && SKYCLEAR.value > 0.5 && Math.random() < dt / 16) PROBE.left = 5;   // one due (tried until it finds sky, five times at most)
  if (PROBE.left && M.length < 3 && t - PROBE.at > 1.5) { PROBE.at = t; spawnMeteor(camera); }
  const g = mesh.geometry, P = g.attributes.position.array, C = g.attributes.aC.array, T = g.attributes.aT.array, W = OVER.u.uRes.value.x / 2, H = OVER.u.uRes.value.y / 2;
  let nq = 0;
  for (let i = M.length - 1; i >= 0; i--) {
    const e = M[i]; e.t += dt; const k = e.t / e.dur; if (k >= 1) { M.splice(i, 1); continue; }
    const at = Math.max(0, k - 0.35 - 0.25 * e.fast), fl = Math.sin(Math.PI * Math.pow(k, 1.4));
    const head = _mh.copy(e.d0).lerp(e.d1, k).normalize().multiplyScalar(230).add(camera.position).project(camera);
    const tail = _mt.copy(e.d0).lerp(e.d1, at).normalize().multiplyScalar(230).add(camera.position).project(camera);
    if (head.z > 1 || tail.z > 1) continue;
    let dx = (head.x - tail.x) * W, dy = (head.y - tail.y) * H; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const wpx = 1.3 * e.w * (OVER.u.uPR ? OVER.u.uPR.value : 1), nx = -dy * wpx / W, ny = dx * wpx / H, ex = dx * wpx * 1.5 / W, ey = dy * wpx * 1.5 / H, o = nq * 12, oc = nq * 16;
    const Q = [tail.x + nx, tail.y + ny, tail.z, tail.x - nx, tail.y - ny, tail.z, head.x + nx + ex, head.y + ny + ey, head.z, head.x - nx + ex, head.y - ny + ey, head.z];
    for (let j = 0; j < 4; j++) { P[o + 3 * j] = Q[3 * j]; P[o + 3 * j + 1] = Q[3 * j + 1]; P[o + 3 * j + 2] = Q[3 * j + 2];
      C[oc + 4 * j] = 0.95 - 0.25 * e.fast; C[oc + 4 * j + 1] = 0.9 + 0.08 * e.fast; C[oc + 4 * j + 2] = 0.7 + 0.25 * e.fast; C[oc + 4 * j + 3] = e.b * fl;
      T[o + 3 * j] = j < 2 ? 0 : 1.04; T[o + 3 * j + 1] = j % 2 ? -1 : 1; T[o + 3 * j + 2] = 0; }
    nq++;
  }
  g.setDrawRange(0, nq * 6); mesh.visible = nq > 0; METEOR.on = M.length > 0;
  if (nq) { g.attributes.position.needsUpdate = g.attributes.aC.needsUpdate = g.attributes.aT.needsUpdate = true; }
  stepComet(t, dt, camera);
}
/* ---- a comet gliding by now and then (G, 15/10/2026: "sao chổi lướt qua nhẹ nhàng"): a little while after night falls,
   then every three or four minutes, one drifts across the sky in about forty seconds, fading in and out. Drawn as a
   comet looks: a soft greenish coma round a bright point (its gas glows green: diatomic carbon), a dust tail behind it,
   widening and fading, curving a little away from its path and finely streaked, and a narrower, straight blue ion tail
   leaning up and away (the two tails of a comet like Hale-Bopp). Sizes are angles on the sky (a tail of 2.3 to 3.3°:
   a quarter of the first size, G 15/10/2026, halved twice), so it looks the same however far the view is zoomed; its
   thinnest parts are kept about a pixel wide. The tails move as they do in
   a comet's time-lapse, slowed down to a few seconds: matter streams away from the head (the striae of the dust tail
   and the knots of the ion tail drift outward along them), the ion tail's rays brighten and fade and it waves like a
   flag in the solar wind (a kink running down it), and the dust tail's bend breathes a little. Its path is chosen as a shooting star's is (probeSky: its middle
   half where the room shows sky), and it is drawn under the same depth test, added to the sky. */
const COMET = { mesh: null, e: null, next: 0, on: false, spawn: null };
METEOR.comet = COMET;
const NS = 24, NI = 16, _cv = new THREE.Vector3(), _cm = new THREE.Vector3(), _cn = new THREE.Vector3(), _cu = new THREE.Vector3(), _ci = new THREE.Vector3(), _cs = new THREE.Vector3(), _cp = [];
function buildComet(sky) {
  const nv = (NS + 1) * 2 + (NI + 1) * 2 + 4, idx = [], strip = (o, n) => { for (let i = 0; i < n; i++) { const a = o + 2 * i; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); } };
  strip(0, NS); strip((NS + 1) * 2, NI); const c0 = (NS + 1) * 2 + (NI + 1) * 2; idx.push(c0, c0 + 1, c0 + 2, c0 + 2, c0 + 1, c0 + 3);
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  for (const [k, n] of [['position', 3], ['aT', 3], ['aC', 4]]) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(nv * n), n));
  COMET.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uNight: SKYN, uTime: OVER.u.uTime },
    vertexShader: 'attribute vec4 aC; attribute vec3 aT; varying vec4 vC; varying vec3 vT; void main(){ vC = aC; vT = aT; gl_Position = vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNight, uTime; varying vec4 vC; varying vec3 vT; ${SKY_COVER}
      void main(){ float cov = skyCover(); if (cov < 0.01) discard;
        float u = clamp(vT.x, 0.0, 1.0), v = vT.y, k; vec3 col = vC.rgb;
        if (vT.z < 0.5) {   // the dust tail: striae fanning out and drifting away from the head, the density breathing as it flows
          float fl = u * 7.0 - uTime * 0.32;
          float st = 0.78 + 0.22 * sin(v * 6.5 + u * 4.0 + 0.7 * sin(fl)) * sin(v * 11.0 - u * 2.5 + uTime * 0.06);
          k = exp(-v * v * 2.4) * pow(1.0 - u, 1.6) * st * (0.84 + 0.16 * sin(fl * 1.7 + v * 1.3));
        } else if (vT.z < 1.5) {   // the ion tail: a few thin rays, each brightening and fading, knots streaming out along them
          float r = 0.0;
          for (int i = 0; i < 3; i++) { float fi = float(i), c = (fi - 1.0) * 0.45 + 0.12 * sin(uTime * 0.21 + fi * 2.3 + u * 3.0);
            float kn = 0.55 + 0.45 * sin(u * 15.0 - uTime * (1.5 + 0.3 * fi) + fi * 2.1);
            r += exp(-pow((v - c) / (0.16 + 0.1 * u), 2.0)) * kn * (0.6 + 0.4 * sin(uTime * (0.35 + 0.13 * fi) + fi * 1.7)); }
          k = (0.45 * exp(-v * v * 5.0) + 0.55 * r) * pow(1.0 - u, 1.25);
        }
        else { float r2 = dot(vT.xy, vT.xy); k = 0.42 * exp(-r2 * 3.0) + 0.62 * exp(-r2 * 18.0) * (0.95 + 0.05 * sin(uTime * 1.3)); col = mix(col, vec3(1.0, 1.0, 0.97), exp(-r2 * 14.0)); }   // the coma, a white point at its heart
        float a = vC.a * k * uNight * cov * 0.8; if (a < 0.002) discard;   // (20 % more see-through: G, 16/10/2026)
        gl_FragColor = vec4(col * a, 0.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true, depthTest: false, depthWrite: false }));
  COMET.mesh.frustumCulled = false; COMET.mesh.visible = false; COMET.mesh.renderOrder = 2; sky.add(COMET.mesh);   // (far beyond the moon: behind it)
  for (let i = 0; i <= Math.max(NS, NI); i++) _cp.push(new THREE.Vector3());
  COMET.spawn = camera => probeSky(camera, () => cometPath(camera), 0.25, 0.75, e => { COMET.e = e; });   // (for tests)
}
function cometPath(camera) {   // somewhere in the upper part of the view, 12° or more up; across the sky, drifting a little down
  _m0.set(Math.random() * 1.6 - 0.8, 0.2 + Math.random() * 0.7, 0.5).unproject(camera).sub(camera.position).normalize();
  if (_m0.y < 0.2) return null;
  const side = _mh.set(0, 1, 0).cross(_m0).normalize(), up = _mt.crossVectors(_m0, side), dir = Math.random() < 0.5 ? 1 : -1;
  const tn = side.multiplyScalar(dir).addScaledVector(up, -0.12 + (Math.random() - 0.5) * 0.3); tn.addScaledVector(_m0, -tn.dot(_m0)).normalize();
  const ang = (12 + Math.random() * 8) * Math.PI / 180;
  return { d0: _m0.clone(), d1: _m0.clone().multiplyScalar(Math.cos(ang)).addScaledVector(tn, Math.sin(ang)).normalize(), t: 0, dur: 36 + Math.random() * 10,
    L: (9 + Math.random() * 4) * Math.PI / 180, curl: (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.12), b: 0.85 + Math.random() * 0.25 };
}
function stepComet(t, dt, camera) {
  const C = COMET, mesh = C.mesh; if (!mesh) return;
  if (!C.e) {
    C.on = false; mesh.visible = false;
    if (NIGHT.u.value <= 0.6 || SKYCLEAR.value < 0.5) { C.next = Math.max(C.next, t + 15 + Math.random() * 20); return; }   // (the first a little after night falls)
    if (t > C.next && probeSky(camera, () => cometPath(camera), 0.25, 0.75, e => { C.e = e; })) C.next = t + 4;   // (no sky in view: tried again in a while)
    return;
  }
  const e = C.e; e.t += dt; const k = e.t / e.dur;
  if (k >= 1) { C.e = null; C.next = t + 150 + Math.random() * 120; C.on = false; mesh.visible = false; return; }
  const fade = THREE.MathUtils.smoothstep(k, 0, 0.13) * (1 - THREE.MathUtils.smoothstep(k, 0.8, 1)) * e.b;
  const H = _cv.copy(e.d0).lerp(e.d1, k).normalize(), m = _cm.copy(e.d1).sub(e.d0); m.addScaledVector(H, -m.dot(H)).normalize();   // where it is, and which way it goes
  const n = _cn.crossVectors(H, m).normalize(), up = _cu.set(0, 1, 0); up.addScaledVector(H, -up.dot(H)).normalize();
  const ion = _ci.copy(m).multiplyScalar(-0.85).addScaledVector(up, 0.53).normalize(), side = _cu.crossVectors(H, ion).normalize();   // (up is done with)
  const g = mesh.geometry, P = g.attributes.position.array, T = g.attributes.aT.array, A = g.attributes.aC.array;
  const W = OVER.u.uRes.value.x / 2, Hh = OVER.u.uRes.value.y / 2, ppr = Hh / Math.tan(camera.fov * Math.PI / 360);   // pixels a radian, near the middle
  const at = d => d.multiplyScalar(230).add(camera.position).project(camera), minPx = 1.1 * (OVER.u.uPR ? OVER.u.uPR.value : 1);
  let o = 0;
  const tail = (N, pt, w0, w1, kind, col, alpha) => {   // a strip along points pt(s), s from the head (0) to the end (1)
    for (let i = 0; i <= N; i++) { _cp[i].copy(pt(i / N)); if (at(_cp[i]).z > 1) return false; }
    for (let i = 0; i <= N; i++) {
      const a = _cp[Math.max(0, i - 1)], b = _cp[Math.min(N, i + 1)]; let tx = (b.x - a.x) * W, ty = (b.y - a.y) * Hh; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const s = i / N, wpx = Math.max(minPx, (w0 + (w1 - w0) * s) * ppr), nx = -ty * wpx / W, ny = tx * wpx / Hh;
      for (let j = 0; j < 2; j++) { const sg = j ? -1 : 1, v = o + 2 * i + j;
        P[v * 3] = _cp[i].x + nx * sg; P[v * 3 + 1] = _cp[i].y + ny * sg; P[v * 3 + 2] = _cp[i].z;
        T[v * 3] = s; T[v * 3 + 1] = sg; T[v * 3 + 2] = kind; A[v * 4] = col[0]; A[v * 4 + 1] = col[1]; A[v * 4 + 2] = col[2]; A[v * 4 + 3] = alpha; }
    }
    o += 2 * (N + 1); return true;
  };
  const D = Math.PI / 180, L = e.L * 0.25, Li = L * 0.85, curl = e.curl * (1 + 0.18 * Math.sin(t * 0.27 + e.b * 9));   // (half the first size; the bend breathing)
  const wave = s => Li * s * Math.pow(s, 0.3) * (0.05 * Math.sin(Math.PI * 2 * (1.1 * s - 0.2 * t)) + 0.02 * Math.sin(Math.PI * 2 * (2.3 * s - 0.37 * t) + 1.3));   // (a kink running down the ion tail)
  const ok = tail(NS, s => _cs.copy(H).addScaledVector(m, -s * L).addScaledVector(n, curl * L * s * s).normalize(), 0.075 * D, 0.55 * D, 0, [1.0, 0.95, 0.82], 0.5 * fade)   // (bending away from its path)
    && tail(NI, s => _cs.copy(H).addScaledVector(ion, s * Li).addScaledVector(side, wave(s)).normalize(), 0.065 * D, 0.28 * D, 1, [0.55, 0.75, 1.0], 0.2 * fade);
  if (!ok) { mesh.visible = false; C.on = true; return; }
  const h = at(_cs.copy(H)), r = Math.max(4 * minPx, 0.25 * D * ppr);   // the coma: a square round the head (a soft dot at least)
  for (let j = 0; j < 4; j++) { const sx = j & 1 ? 1 : -1, sy = j & 2 ? 1 : -1, v = o + j;
    P[v * 3] = h.x + sx * r / W; P[v * 3 + 1] = h.y + sy * r / Hh; P[v * 3 + 2] = h.z; T[v * 3] = sx; T[v * 3 + 1] = sy; T[v * 3 + 2] = 2;
    A[v * 4] = 0.75; A[v * 4 + 1] = 1.0; A[v * 4 + 2] = 0.82; A[v * 4 + 3] = 0.95 * fade; }
  g.attributes.position.needsUpdate = g.attributes.aT.needsUpdate = g.attributes.aC.needsUpdate = true;
  mesh.visible = true; C.on = true;
}
// the page's moon pictures (its MOON_IMGS: 8 phase buckets, new moon first), used when its sky clock has not shown one yet
const MOON_IDS = ['35cea205e90443258d2aeaa54414881a', '60161204787446faa5348897ff9578ef', '60161204787446faa5348897ff9578ef', 'f2c8bd9a09d54d75b97bd8ef98842611',
  'b61c8002bffd4d34818b968a0e34aeb9', '5d2bbcc638ca492dbe5f16998fe651a7', 'cb81a46d1ed145098b0f4e9c55197c90', '35cea205e90443258d2aeaa54414881a'];
function moonUrl() {
  const img = document.querySelector('.sky .moon img[src]'), src = img && img.getAttribute('src');
  if (src) return src.replace(/w_\d+,h_\d+/, 'w_256,h_256');
  const id = '1ded0e_' + MOON_IDS[Math.floor(((moonAge() + 0.0625) % 1) / 0.125)];
  return `https://static.wixstatic.com/media/${id}~mv2.png/v1/fill/w_256,h_256,al_c,q_90,enc_auto/${id}.png`;
}
function loadMoon() {
  const url = moonUrl(); if (url === OVER.moonUrl) return; OVER.moonUrl = url;
  new THREE.TextureLoader().setCrossOrigin('anonymous').load(url, t => {
    if (OVER.moonUrl !== url) { t.dispose(); return; }
    t.anisotropy = 4; if (OVER.moonImg.value) OVER.moonImg.value.dispose(); OVER.moonImg.value = t; OVER.moon.visible = true; setNeeds(true);
  });
}
function placeMoon() {   // in the left glass, between the posts at z −6.6 and −4.55: over the transom if the frame shows it, else under it
  if (!OVER.moon) return;
  const az = 13.7 * Math.PI / 180, top = REF.h / 2 - Math.min(REF.h, REF.w * innerHeight / innerWidth) / 2;   // painting row at the frame's top
  const upper = 12.3 * Math.PI / 180, yUp = REF.py - REF.f * Math.tan(upper) / Math.cos(az);   // its lower edge clears the transom's inner top
  const el = yUp - 21 - 5 >= top ? upper : 7.4 * Math.PI / 180, dir = new V3(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  OVER.moon.position.copy(REF.eye).addScaledVector(dir, 240); OVER.moon.lookAt(REF.eye);
  if (window.HL_SUN.place.lat < 0) OVER.moon.rotateZ(Math.PI);   // (seen from south of the equator the moon is turned over, as the clock's is: src/sun)
}
/* ---- fireflies: from dusk on, three drift through the room and seven through the garden outside, and flash, drawn sharp over the picture like the stars
   (the paint pass would smear points this small) and hidden behind whatever the room puts in front of them. Each one
   wanders slowly around its own spot (three unrelated sways, so no two paths repeat together) and flashes on its own
   beat: a ~0.7 s yellow-green pulse every 3 to 7 s, with a dimmer glow in between. They come out as the sun goes under
   the trees (3° to −5°). All the motion is in the vertex shader: nothing on the CPU per frame. */
const FLY = { u: { value: 0 }, t: { value: 0 }, rain: { value: 0 }, pts: null, on: false };   // (rain: how hard it rains; those outside keep in: fx/rain.js)
function buildFireflies() {
  const n = 22, inside = 3, home = new Float32Array(n * 3), sway = new Float32Array(n * 4), beat = new Float32Array(n * 3), r = rng(77);
  for (let i = 0; i < n; i++) {
    if (i < inside) {   // three in the room: over the sofa, the rug and the floor by the deck, under eye height
      home.set([[0.2, 1.1, 0.95][i], [1.1, 0.7, 1.3][i], [-6.9, -3.6, -5.0][i]], i * 3);
      sway.set([0.35 + r() * 0.2, 0.15 + r() * 0.15, 0.45 + r() * 0.3, r() * 100], i * 4);   // reach x, y, z (m), phase
    } else {            // the rest in the garden, where the painting's eye sees out: low among the shrubs past the left
      // glass (x/−z from −0.25 to −0.15 from the eye), and up in the trees over the low bookcase under the back glass
      // (the case hides anything lower than ~1.75 + 0.11·depth there)
      let x, y, z;
      // Close to the glass: further out the foliage hides them.
      if (i < inside + 11) { do { const d = lerp(6.2, 9.5, r()); z = -d; x = lerp(-0.25, -0.16, r()) * d; } while (x > R.xL - 0.35 || x < R.xL - 1.4); y = 0.6 + r() * 2.6; }
      else { const d = lerp(R.zB * -1 + 0.3, R.zB * -1 + 1.4, r()); z = -d; x = lerp(-0.12, 0.24, r()) * d; y = 1.75 + 0.11 * d + 0.3 + r() * 1.6; }
      home.set([x, y, z], i * 3);
      sway.set([0.5 + r() * 0.6, 0.15 + r() * 0.3, 0.5 + r() * 0.6, r() * 100], i * 4);
    }
    beat.set([3 + r() * 4, r() * 10, (0.6 + r() * 0.4) * (i < inside ? 1 : 1.35)], i * 3);   // period (s), phase, size (larger outside: seen far off)
  }
  // fewer than were placed (G: 30 % fewer on 14/10/2026, 30 % fewer again on 15/10): the room's three, four of the eleven
  // by the glass, three of the eight in the trees; the ones kept stay where they were
  const kept = [...Array(n).keys()].filter(i => i < inside || (i < inside + 11 ? i < inside + 4 : i < inside + 11 + 3));
  const pick = (a, k) => Float32Array.from(kept.flatMap(i => Array.from(a.subarray(i * k, i * k + k))));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pick(home, 3), 3)); g.setAttribute('aSway', new THREE.BufferAttribute(pick(sway, 4), 4)); g.setAttribute('aBeat', new THREE.BufferAttribute(pick(beat, 3), 3));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uTime: FLY.t, uOn: FLY.u, uRain: FLY.rain },
    vertexShader: `attribute vec4 aSway; attribute vec3 aBeat; uniform float uTime, uOn, uRain; uniform vec2 uRes; varying float vB;
      void main(){ float t = uTime + aSway.w, k = 0.6 + 0.4 * fract(aSway.w * 7.13);
        vec3 p = position + vec3(sin(t * 0.23 * k) + 0.45 * sin(t * 0.61 + 1.3), sin(t * 0.37 * k + 2.0) + 0.35 * sin(t * 1.7), sin(t * 0.17 * k + 4.0) + 0.4 * cos(t * 0.53)) * aSway.xyz;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float ph = fract((uTime + aBeat.y) / aBeat.x), flash = smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.05, 0.05 + 0.7 / aBeat.x, ph));
        vB = (0.3 + 0.9 * flash) * uOn * (1.0 - uRain * (1.0 - step(-1.25, position.x) * step(-8.6, position.z)));   // (out in the rain: none)
        gl_PointSize = clamp(0.22 * aBeat.z * projectionMatrix[1][1] * 0.5 * uRes.y / -mv.z, 6.0, 90.0); }`,
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; varying float vB;
      void main(){ if (gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 4e-6) discard;
        float d = length(gl_PointCoord - 0.5) * 2.0, core = smoothstep(0.16, 0.03, d), halo = pow(max(1.0 - d, 0.0), 3.0);
        float a = (core + 0.7 * halo) * vB; if (a < 0.004) discard;
        gl_FragColor = vec4(mix(vec3(0.62, 0.95, 0.22), vec3(1.0, 1.0, 0.78), core) * a, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
  pts.frustumCulled = false; pts.visible = false; OVER.scene.add(pts); FLY.pts = pts;
}
/* ---------------------------------------------------------------- rain
   Rain outside the glass when it rains where the visitor is now (G, 16/10/2026: "làm mưa ngoài kính khi (local time) có
   mưa"; 17/10/2026: the weather of the visitor's place, as the page's sun is worked out for it: src/sun): the page's live
   weather (weather/sky-weather.js: Open-Meteo, the 3D garden's source; window.HL_WEATHER and its 'hl-weather' event),
   how hard from its WMO code and the last quarter hour's rain, as the garden reads it.
   - The rain itself: thousands of drops falling past the glass at their terminal speed (6.5 to 9 m/s for 2 to 4 mm
     drops: Gunn & Kinzer 1949), slanting with the wind (blowing as it does there, turned into the room's compass),
     each drawn as a camera sees a drop, a short streak (its fall in a 30th of a second) one or two pixels wide, nearer
     ones wider and brighter, thicker near the glass; light ones against the dark garden by day, and by night lit warm by
     the room's lamps where they pass close to the glass. Where one reaches the patio or the lawn it splashes, a small
     ring opening and gone in a tenth of a second. They are drawn sharp over the picture (the watercolour pass would wipe
     out lines this thin), before the deck and the animals, and only where the room shows what is out there (each pixel
     tested against the room's depth, as the stars are: hidden by the posts, the frames and the trees in front of them).
   - On the glass: drops beading on the panes and drops running down them in jerks (stick and slip), each leaving a trail
     of droplets, more on the side the wind drives the rain against. Each drop is a little lens: it shows the picture
     behind it bent and turned over (the painted view sampled through it, offset by its shape, as in the well-known
     shader drops on glass), darker at its rim where light leaves it sideways, with a glint of the sky by day or of the
     lamps by night. When the rain stops the running drops stop with it; the beaded ones stay a while, then dry.
   - The day goes grey: an overcast takes the sun (and its shadows) and its warm light, the skylight dims and turns grey,
     the sky becomes one grey layer, the far trees go into the haze of the rain (fx/hour.js applyHour reads WX.ov); a day
     under thick cloud without rain goes grey too. By night only the rain hides the stars, the moon, the Milky Way, the
     comet and the shooting stars (fx/sky.js SKYCLEAR): under mere cloud they stay out (G, 16/10/2026); the hen keeps in,
     the fireflies in the garden too.
   - A thunderstorm: now and then the lightning, the sky and the garden flashing twice (a stroke and its return).
   ?wx=rain (or drizzle, storm) shows it whatever the weather. */
const RAIN = { on: false, scene: new THREE.Scene(), built: false, streaks: null, drops: null, flash: null };
const WX = { k: 0, kT: 0, ov: 0, ovT: 0, ovRain: 0, ovCloud: 0, ovSet: 0, wet: 0, storm: false, cover: 0, clear: 1, first: true, wind: new THREE.Vector2(), windT: new THREE.Vector2(), last: 0, bolt: -1e9, nextBolt: 0, fl: 0 };
RAIN.wx = WX;   // (for tests)
const RAIN_K = { 51: 0.22, 53: 0.32, 55: 0.42, 56: 0.32, 57: 0.42, 61: 0.45, 63: 0.66, 65: 0.92, 66: 0.5, 67: 0.75, 80: 0.5, 81: 0.75, 82: 1, 95: 0.85, 96: 0.92, 99: 1 };
const RU = { uTime: { value: 0 }, uK: { value: 0 }, uWet: { value: 0 }, uWind: { value: new THREE.Vector2() }, uDay: { value: 1 }, uLamp: { value: 0 }, uFlash: { value: 0 },
  uPic: { value: null }, uRoom: { value: new THREE.Vector4(R.xL - 0.06, R.zB - 0.02, R.xW, R.zF) }, uInvVP: { value: new THREE.Matrix4() } };

// the weather now: how hard it rains (0 to 1), how overcast, the storm, the wind (m/s, the way it blows, in the room)
function readWeather() {
  const W = window.HL_WEATHER, c = W && W.cur; if (!c) return;
  const code = c.weather_code, mmh = (c.precipitation || 0) * 4;   // (a quarter hour's rain: weather/sky-weather.js)
  let k = RAIN_K[code] || 0; if (mmh > 0.05) k = Math.max(k, Math.min(1, 0.28 + mmh / 9));
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) k = 0;   // (snow: the garden gets none; only its grey light)
  WX.kT = k; WX.storm = code >= 95; WX.cover = (c.cloud_cover ?? 0) / 100;
  WX.ovRain = k > 0 ? 0.82 + 0.18 * k : 0; WX.ovCloud = Math.max(THREE.MathUtils.smoothstep(WX.cover, 0.6, 1.0) * 0.6, code === 45 || code === 48 ? 0.7 : 0);
  WX.ovT = Math.max(WX.ovRain, WX.ovCloud * (1 - NIGHT.u.value));
  const to = ((c.wind_direction_10m || 0) + 180 - 103.7) * Math.PI / 180, v = (c.wind_speed_10m || 0) / 3.6;   // (the compass of fx/hour.js sunDirAt)
  WX.windT.set(Math.cos(to), Math.sin(to)).multiplyScalar(Math.min(8, v * 0.55));   // (near the ground the wind is less; the drops take up most of it)
  if (WX.first) { WX.first = false; WX.k = WX.kT; WX.wind.copy(WX.windT); WX.wet = k > 0 ? 1 : 0; if (!ready) WX.ov = WX.ovSet = WX.ovT; }   // (raining when the page opens: raining at once; its grey light too, if it is known before the room is first drawn)
  setNeeds(true);
}
addEventListener('hl-weather', readWeather);

/* ---- the falling drops: one instance each (a quad: x across, y from its head to its tail), placed in the shader */
const STREAK_VS = `attribute vec4 aDrop; uniform float uTime, uK, uDay, uLamp, uPR; uniform vec2 uWind, uRes; uniform vec4 uRoom;
  varying vec2 vQ; varying float vA, vMode; varying vec3 vC;
  void main() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0;
    if (fract(aDrop.w * 31.7) > uK) return;   // (as many as the rain is heavy)
    float v = 6.5 + 2.6 * fract(aDrop.w * 7.3), G = -0.105, top = 6.6, sp = 0.11;   // its speed, the ground, where it comes into view, a splash's time
    float T = (top - G) / v + sp, tau = fract(aDrop.z + uTime / T) * T;
    vec3 p = vec3(aDrop.x + uWind.x * (tau - 0.5 * T), top - v * tau, aDrop.y + uWind.y * (tau - 0.5 * T));
    if (p.x > uRoom.x - 0.1 && p.z > uRoom.y - 0.1 && p.x < uRoom.z + 0.2 && p.z < uRoom.w + 0.2) return;   // (blown over the house: under its roof)
    float dist = length(p - cameraPosition);
    float dL = uRoom.x - p.x, dB = uRoom.y - p.z, dG = dL > 0.0 && dB > 0.0 ? min(dL, dB) : max(dL, dB);   // how far out from the glass
    vC = mix(vec3(0.3, 0.33, 0.38), vec3(0.93, 0.95, 0.98), uDay) + vec3(1.0, 0.8, 0.52) * uLamp * 0.85 * exp(-dG / 1.3);   // (by night lit by the lamps near the glass)
    if (p.y > G) {   // falling: a streak, its head below, its tail up the way it came
      vMode = 0.0;
      vec3 vel = vec3(uWind.x, -v, uWind.y);
      vec4 c0 = projectionMatrix * viewMatrix * vec4(p, 1.0), c1 = projectionMatrix * viewMatrix * vec4(p - vel * 0.03, 1.0);
      if (c0.w < 0.1 || c1.w < 0.1) return;
      vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uRes; float L = length(d); d = L > 1e-3 ? d / L : vec2(0.0, 1.0);
      float w = uPR * clamp(2.2 / dist, 0.55, 1.5);   // (half its width, device pixels: nearer, wider)
      vec4 c = mix(c0, c1, position.y); c.xy += vec2(-d.y, d.x) * position.x * w * 2.0 / uRes * c.w;
      gl_Position = c; vQ = position.xy;
      vA = (0.2 + 0.25 * uK) * clamp(2.8 / dist, 0.25, 1.0) * smoothstep(top, top - 0.8, p.y);
    } else {   // landed: a ring on the ground, opening, gone
      vMode = 1.0; float age = (G - p.y) / v, rr = 0.01 + 0.2 * age;
      gl_Position = projectionMatrix * viewMatrix * vec4(p.x + position.x * rr, G + 0.006, p.z + (position.y * 2.0 - 1.0) * rr, 1.0);
      vQ = vec2(position.x, position.y * 2.0 - 1.0);
      vA = (0.3 + 0.3 * uK) * (1.0 - age / sp) * clamp(3.0 / dist, 0.2, 1.0) * step(dist, 10.0);
    }
  }`;
const STREAK_FS = `uniform sampler2D uDepth; uniform vec2 uRes; varying vec2 vQ; varying float vA, vMode; varying vec3 vC;
  void main() {
    if (vA < 0.002 || gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 2e-6) discard;   // (behind a post, a frame, a tree)
    float a;
    if (vMode < 0.5) a = vA * (1.0 - vQ.x * vQ.x) * smoothstep(0.0, 0.2, vQ.y) * (1.0 - 0.6 * vQ.y);   // brightest at its head
    else { float r = length(vQ); a = vA * smoothstep(1.0, 0.8, r) * smoothstep(0.4, 0.8, r); }
    if (a < 0.003) discard;
    gl_FragColor = vec4(vC * a, a); }`;

/* ---- the drops on the glass: a lens each (see above); q is the place on the pane, in metres (across, up) */
const DROPS_FS = `uniform sampler2D uDepth, uPic; uniform vec2 uRes, uWind; uniform float uTime, uK, uWet, uDay, uLamp; uniform vec4 uRoom;
  varying vec3 vW;
  float hr(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 hr2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  void main() {
    if (gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 2e-6) discard;   // (a post, a frame, the shelves in front of the pane)
    vec2 out2 = vW.x < uRoom.x + 0.02 ? vec2(-1.0, 0.0) : vW.z < uRoom.y + 0.02 ? vec2(0.0, -1.0) : vec2(0.0, 1.0);   // which way the pane faces out
    vec2 q = vec2(abs(out2.x) > 0.5 ? vW.z : vW.x, vW.y);
    vec2 jx = dFdx(q), jy = dFdy(q);   // (the place on the pane against the screen: for the lens's offset)
    float ws = length(uWind), dens = clamp(0.55 + 0.45 * (ws > 0.01 ? dot(uWind / ws, -out2) * min(1.0, ws / 2.5) : 0.0), 0.3, 1.0);   // (more where the wind drives it)
    float m = 0.0, r = 1.0; vec2 dv = vec2(0.0);   // the drop here: how much, its size (m), where in it
    // beaded drops, one to a cell of 1.8 cm: each comes, stays a while, dries; another takes its place
    { vec2 g = q / 0.018, id = floor(g), f = fract(g) - 0.5, rn = hr2(id); float rz = hr(id + 17.3);
      vec2 c = (rn - 0.5) * 0.56; float rad = mix(0.07, 0.2, rz * rz), life = fract(uTime * 0.03 + rz * 13.0);
      float show = step(hr(id + 3.1), uWet * dens * 0.85) * smoothstep(0.0, 0.04, life) * smoothstep(1.0, 0.85, life);
      vec2 d = (f - c) / rad; float dd = dot(d, d), mm = show * smoothstep(1.0, 0.8, dd);
      if (mm > m) { m = mm; r = rad * 0.018; dv = d; } }
    // running drops, in columns 5.5 cm wide: sliding down in jerks, a trail of droplets above each
    { float ci = floor(q.x / 0.055); vec2 cr = hr2(vec2(ci, 7.7)); float P = 0.85, s = uTime * (0.05 + 0.08 * cr.y) + cr.x * 9.0;
      float st = 0.018, prog = (floor(s / st) + smoothstep(0.7, 1.0, fract(s / st))) * st;   // (stick, slip)
      float idx = floor((q.y + prog) / P), u = mod(q.y + prog, P) - 0.5 * P;   // (along the column: the drop at u = 0, going down)
      if (hr(vec2(ci, idx)) < uK * dens * 0.9) {
        float cx = (ci + 0.5 + (hr(vec2(ci, idx + 0.5)) - 0.5) * 0.5) * 0.055 + 0.004 * sin(q.y * 23.0 + ci), rr = 0.0024 + 0.0016 * hr(vec2(idx, ci));
        vec2 d = vec2((q.x - cx) / rr, u / (rr * 1.25)); float dd = dot(d, d), mm = smoothstep(1.0, 0.8, dd);
        if (mm > m) { m = mm; r = rr; dv = d; }
        if (u > 0.0 && u < 0.45 * P) {   // its trail: droplets left behind, every 1.1 cm, fewer further up
          float bi = floor(u / 0.011), bu = u - (bi + 0.5) * 0.011, br = rr * (0.22 + 0.25 * hr(vec2(ci * 3.0 + bi, idx)));
          vec2 bd = vec2((q.x - cx - 0.0015 * (hr(vec2(bi, ci)) - 0.5)) / br, bu / br);
          float bm = smoothstep(1.0, 0.75, dot(bd, bd)) * step(hr(vec2(bi, idx + ci)), 0.75 - u / (0.45 * P));
          if (bm > m) { m = bm; r = br; dv = bd; } }
      } }
    m *= smoothstep(0.7, 1.8, r / max(length(jx), length(jy)));   // (a drop smaller than a pixel or two, seen from across the room, is let go: not a speck)
    if (m < 0.01) discard;
    // the lens: the picture behind seen through the drop, turned over and drawn in
    vec2 o = -dv * r * 1.25, sp = vec2(jy.y * o.x - jy.x * o.y, -jx.y * o.x + jx.x * o.y) / (jx.x * jy.y - jy.x * jx.y);   // (that offset on the screen, px)
    vec3 pic = texture2D(uPic, clamp((gl_FragCoord.xy + sp) / uRes, 0.001, 0.999)).rgb;
    float e = sqrt(dot(dv, dv)), rim = smoothstep(0.5, 1.0, e);
    vec3 col = mix(pic * 1.06 + 0.035, pic * 0.42, rim * 0.65);
    vec2 h = dv - vec2(-0.32, 0.42); col += (vec3(0.55, 0.57, 0.6) * uDay + vec3(0.6, 0.45, 0.26) * uLamp) * exp(-dot(h, h) * 16.0);   // a glint: the sky by day, the lamps by night
    gl_FragColor = vec4(col * m, m); }`;

/* ---- lightning: the sky and the garden flash (the room a little), a full-screen pass over the picture */
const FLASH_FS = `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uFlash; uniform mat4 uInvVP; uniform vec4 uRoom;
  void main() {
    float z = texture2D(uDepth, gl_FragCoord.xy / uRes).r; vec4 w = uInvVP * vec4(gl_FragCoord.xy / uRes * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); w.xyz /= w.w;
    float outside = z > 0.99999 ? 1.0 : (w.x < uRoom.x || w.z < uRoom.y || w.z > uRoom.w) ? 0.5 : 0.09;
    gl_FragColor = vec4(vec3(0.8, 0.85, 1.0) * uFlash * outside * 0.55, 0.0); }`;

function buildRain() {
  RAIN.built = true;
  const N = 7000, a = new Float32Array(N * 4), r = rng(4417), xL = R.xL - 0.06, zB = R.zB - 0.02;
  for (let i = 0; i < N; i++) {   // out from the left glass (and the back glass), thicker near it
    const d = 0.22 + 9.0 * Math.pow(r(), 1.7);
    let x, z; if (r() < 0.74) { z = R.zB - 9 + r() * (R.zF + 2 - R.zB + 9); x = xL - d; } else { x = xL - 0.3 + r() * (R.xW + 3 - xL + 0.3); z = zB - d; }
    a.set([x, z, r(), r()], i * 4);
  }
  const g = new THREE.InstancedBufferGeometry(); g.setIndex([0, 1, 2, 2, 1, 3]);
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3)); g.setAttribute('aDrop', new THREE.InstancedBufferAttribute(a, 4)); g.instanceCount = N;
  const common = { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uPR: OVER.u.uPR, ...RU };
  RAIN.streaks = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: common, vertexShader: STREAK_VS, fragmentShader: STREAK_FS,
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));   // (built on the screen: either winding)
  RAIN.streaks.frustumCulled = false; RAIN.streaks.renderOrder = 0; RAIN.scene.add(RAIN.streaks);
  const pane = room.userData.glass;
  if (pane) {
    RAIN.drops = new THREE.Mesh(pane.geometry, new THREE.ShaderMaterial({ uniforms: common, fragmentShader: DROPS_FS,
      vertexShader: 'varying vec3 vW; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }',
      transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    RAIN.drops.matrixAutoUpdate = false; RAIN.drops.matrix.copy(pane.matrixWorld); RAIN.drops.frustumCulled = false; RAIN.drops.renderOrder = 1; RAIN.scene.add(RAIN.drops);
  }
  const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  RAIN.flash = new THREE.Mesh(tri, new THREE.ShaderMaterial({ uniforms: common, fragmentShader: FLASH_FS, vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    transparent: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true, depthTest: false, depthWrite: false }));
  RAIN.flash.frustumCulled = false; RAIN.flash.renderOrder = 2; RAIN.scene.add(RAIN.flash);
  readWeather();
}
function stepRain(t) {
  const dt = Math.min(0.25, Math.max(0, t - WX.last)); WX.last = t;
  WX.k += (WX.kT - WX.k) * Math.min(1, dt / 10); if (Math.abs(WX.k - WX.kT) < 0.002) WX.k = WX.kT;   // (rain comes on and eases off over some seconds)
  WX.ovT = Math.max(WX.ovRain, WX.ovCloud * (1 - NIGHT.u.value));   // (a cloudy day goes grey; a cloudy night keeps its stars: G, 16/10/2026)
  // an overcast's light comes in (or goes) once the shaders for every state of the lights are made (core/loop.js
  // precompileLightStates): on a dark day it switches the lamps on, and before that every lit shader would be made
  // again at once, holding a frame some 0.4 s
  if (REVEAL.lit) { WX.ov += (WX.ovT - WX.ov) * Math.min(1, dt / 8); if (Math.abs(WX.ov - WX.ovT) < 0.002) WX.ov = WX.ovT; }
  WX.wind.lerp(WX.windT, Math.min(1, dt / 4));
  WX.wet = WX.k > 0.02 ? Math.min(1, WX.wet + dt / 8) : Math.max(0, WX.wet - dt / 150);   // (the beaded drops dry over a few minutes)
  if (Math.abs(WX.ov - WX.ovSet) > 0.012 && HOUR.e !== null) { WX.ovSet = WX.ov; applyHour(HOUR.e, HOUR.az); setNeeds(true); }   // (the light of an overcast)
  WX.clear = 1 - 0.97 * THREE.MathUtils.smoothstep(WX.k, 0.04, 0.3);   // (the stars, the moon and the Milky Way always out, but when it rains: G, 16/10/2026)
  SKYCLEAR.value = WX.clear; FLY.rain.value = Math.min(1, WX.k * 3);
  setHenAway(WX.k > 0.08);
  // a storm's lightning: a stroke, then its return a fifth of a second later
  WX.fl = 0;
  if (WX.storm && WX.k > 0.2 && !reduceMotion) {
    if (!WX.nextBolt) WX.nextBolt = t + 4 + Math.random() * 6;
    if (t > WX.nextBolt) { WX.bolt = t; WX.nextBolt = t + 6 + Math.random() * 14; }
    const age = t - WX.bolt; if (age < 1) WX.fl = Math.exp(-age * 22) + (age > 0.18 ? 0.75 * Math.exp(-(age - 0.18) * 12) : 0);
  }
  if (WX.hold !== undefined) WX.fl = WX.hold;   // (for tests: a flash held)
  RAIN.on = WX.k > 0.003 || WX.wet > 0.003 || WX.fl > 0.01;
}
// before the deck and the animals: the rain, the drops on the glass, a flash
function drawRain() {
  if (!RAIN.built) buildRain();
  stepRain(clock.getElapsedTime());
  if (!RAIN.on || REVEAL.stage < 3) return;   // (the weather comes in last)
  const S = HOUR.S || {};
  RU.uTime.value = reduceMotion ? 0 : clock.getElapsedTime(); RU.uK.value = WX.k; RU.uWet.value = WX.wet; RU.uWind.value.copy(WX.wind);
  RU.uDay.value = (1 - NIGHT.u.value) * (1 - 0.35 * WX.ov); RU.uLamp.value = (S.lamps || 0) * 0.9; RU.uFlash.value = WX.fl; RU.uPic.value = POST.out.texture;
  RU.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
  RAIN.streaks.visible = WX.k > 0.003 && !reduceMotion; if (RAIN.drops) RAIN.drops.visible = WX.k > 0.003 || WX.wet > 0.003; RAIN.flash.visible = WX.fl > 0.01;
  renderer.autoClear = false; renderer.render(RAIN.scene, camera); renderer.autoClear = true;
}
/* ---------------------------------------------------------------- the cat's body
   "cat" by artofaria (Sketchfab, Free Standard licence): a black cat with a white bib, blaze and toes, modelled standing
   and without a skeleton. tools/pets/rig_cat.py gives it one (hips, spine, chest, neck, head; two ears; seven tail
   bones; each foreleg a shoulder blade, upper arm, forearm and paw; each hind leg a thigh, shin, foot and toes) and skin
   weights. This module is its body: its poses, the springs that carry it from pose to pose, its legs' reach and its
   gait. Its life (what it does, and when) is in pets.js.
   A pose is a list of turns of its bones about the axes of its own frame (forward +z, up +y, left +x), each through the
   bone's joint, the right side mirroring the left; the cat is then set down so its lowest point touches the ground.
   From pose to pose it is carried by springs, as games do it (D. Holden, "Spring-It-On", theorangeduck.com): each
   bone's turn away from where it should be decays as a critically damped spring, so a change of pose starts and ends
   at rest, keeps the speed a bone already had, and needs no blend time fixed in advance.
   Its gait follows measurements of walking cats: a lateral sequence (left hind, left fore, right hind, right fore, a
   quarter of a stride apart), each paw down about 60 % of the stride (Zubair et al. 2016); a swing that lasts about
   as long at every speed, a faster cat shortening the stance instead (Halbertsma 1983); a body carried a little lower
   as it walks (cats walk crouched: Bishop et al. 2008). How far a paw sweeps under the body is what its leg can reach:
   measured on the skeleton (each paw's sweep centred under its shoulder or hip, the shortest leg, the forearm, setting
   it), so no leg is ever pulled straight (a leg stretched past its reach drags its skin into a thin stick). For this
   short-legged cat that is a stride of ~0.16 m in 0.6 s. Walking, its head is
   held steady and a little nose-down while the trunk rises and falls twice a stride and sways once (Zubair et al.);
   its shoulder blades ride up over each forepaw in stance; its tail, carried up, follows the body as a damped chain. */
const CATR = { bones: {}, rest: null, body: null, mesh: null, ground: null, gaze: null, poses: {}, legs: null, S: null, scale: 1.375, tail: null };
const C_SIDED = /^(scap|arm|fore|paw|thigh|shin|foot|toe|ear)$/;   // (a pose op ['tailArc', from, step, dip] lays the tail on an arc)
const C_AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const C_TAIL = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6', 'tail7'];
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c3 = new THREE.Vector3(), _c4 = new THREE.Vector3(), _c5 = new THREE.Vector3();
const _cq1 = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _cq3 = new THREE.Quaternion(), _cq4 = new THREE.Quaternion();
const cwp = (o, v = new THREE.Vector3()) => v.setFromMatrixPosition(o.matrixWorld);
const _cE = new THREE.Euler(), _cS = new THREE.Vector3(), _cU = new THREE.Vector3(), _cL1 = new THREE.Quaternion(), _cL2 = new THREE.Quaternion();   // (per-frame scratch)
function catTurn(b, q) {   // a turn given in world space, through the bone's own joint
  b.parent.updateWorldMatrix(true, false); b.parent.getWorldQuaternion(_cq1);
  b.quaternion.premultiply(_cq2.copy(_cq1).invert().multiply(q).multiply(_cq1)); b.updateWorldMatrix(false, true);
}
function catAim(b, dir) {   // the bone turned the shortest way so its length (its own +y) points along dir (world space)
  b.updateWorldMatrix(true, false); _c1.set(0, 1, 0).applyQuaternion(b.getWorldQuaternion(_cq3)).normalize();
  catTurn(b, _cq3.setFromUnitVectors(_c1, _c2.copy(dir).normalize()));
}
const catAxis = (ax, v) => v.copy(C_AX[ax]).applyQuaternion(CATR.body.getWorldQuaternion(_cq4));   // an axis of its frame, in the world
function catRest() {   // every bone as modelled, the body at the origin
  for (const [b, t] of CATR.rest) { b.position.copy(t.p); b.quaternion.copy(t.q); b.scale.copy(t.s); }
  CATR.body.position.set(0, 0, 0); CATR.body.quaternion.identity(); CATR.body.updateMatrixWorld(true);
}
function catPose(spec) {   // a pose worked out on the cat at the origin: its bones' turns and where its body sits
  const B = CATR.bones; catRest();
  for (const [n, ax, deg, dip = 0] of spec.ops) {
    if (n === 'tailArc') {   // the tail laid along an arc: from straight back turned by ax degrees, each bone deg more; its root
      // dipping down to the ground (dip, less each bone, flat from the fourth)
      C_TAIL.forEach((t, i) => { const a = (ax + deg * i) * Math.PI / 180; catAim(B[t], _c5.set(Math.sin(a), -dip * Math.max(0, 1 - i / 3), -Math.cos(a))); }); continue;
    }
    for (const s of C_SIDED.test(n) ? ['_L', '_R'] : ['']) {
    const b = B[n + s]; if (!b) continue;
    catTurn(b, _cq4.setFromAxisAngle(C_AX[ax], (s === '_R' && ax !== 'x' ? -deg : deg) * Math.PI / 180));
  } }
  const body = CATR.body, m = CATR.mesh; body.updateMatrixWorld(true);
  let low = Infinity; for (const i of CATR.ground) low = Math.min(low, m.getVertexPosition(i, _c1).applyMatrix4(m.matrixWorld).y);   // (the tail may lie on the floor)
  body.position.y = (spec.y || 0) - low; body.updateMatrixWorld(true);
  return { q: new Map([...CATR.rest.keys()].map(b => [b, b.quaternion.clone()])), pos: body.position.clone(), quat: body.quaternion.clone() };
}
/* ---- its poses (degrees; x: + tips forward parts down and lower parts back, y: + turns forward parts to its left,
   z: + lifts its left side). Read top to bottom: each turn is made on the pose as the turns above it left it. */
const CAT_POSES = {
  stand: { ops: [] },   // as modelled: standing square, tail up in a hook (a friendly carriage), head level
  // lying like a sphinx, alert: belly down, forearms flat ahead, hind legs folded at its sides, head up, tail along the floor
  sphinx: { ops: [['arm', 'x', 10], ['fore', 'x', -75], ['paw', 'x', 5], ['thigh', 'x', -60], ['thigh', 'z', 14], ['shin', 'x', 120], ['foot', 'x', -70],
    ['neck', 'x', -8], ['tail1', 'x', -42], ['tail2', 'x', -30], ['tail3', 'y', -18], ['tail4', 'y', -22], ['tail5', 'y', -26], ['tail6', 'y', -26], ['tail7', 'y', -20]] },
  // asleep, curled up on its side (as cats sleep when they curl up): the legs folded, then rolled onto its right side,
  // the back bent round toward the belly so the head comes down by the hind paws, chin tucked, the tail wrapped
  // round in front of its face
  curl: { ops: [['arm', 'x', 10], ['fore', 'x', -75], ['paw', 'x', 5], ['thigh', 'x', -55], ['shin', 'x', 115], ['foot', 'x', -65],
    ['hips', 'z', 80],
    ['spine', 'y', 24], ['chest', 'y', 30], ['neck', 'y', 36], ['head', 'y', 34], ['neck', 'z', -18], ['head', 'z', -12],
    ['tailArc', 10, 25, 1.2]] },
  // asleep lightly, curled up in a ball (as cats first fall asleep, before they roll onto their side and sleep deeply: G,
  // 17/10/2026, after his photo of a tabby curled up so): belly down, its forelegs tucked under its chest and its hind
  // legs folded under it; the head lowered first, its face kept forward, then the back curved round to its left into a
  // ring, so the head rests low at the front, chin by the cushion and cheek a little down; rolled a touch onto its
  // right side; the tail wrapped round its left side to the front
  nest: { ops: [['arm', 'x', 45], ['fore', 'x', 105], ['paw', 'x', 50], ['thigh', 'x', -48], ['thigh', 'z', -14], ['shin', 'x', 125], ['foot', 'x', -72],
    ['neck', 'x', 38], ['head', 'x', -18], ['hips', 'z', 22],
    ['spine', 'y', 28], ['chest', 'y', 32], ['neck', 'y', 28], ['head', 'y', 14], ['head', 'z', -14],
    ['tailArc', 55, 28, 1.1]] },
  // sitting: haunches down (the trunk only ~26° up, as far as its short forelegs reach), forelegs straight, head level,
  // tail round its side on the floor
  sit: { ops: [['hips', 'x', -26], ['thigh', 'x', -62], ['thigh', 'z', 10], ['shin', 'x', 118], ['foot', 'x', -58], ['arm', 'x', 22], ['fore', 'x', 6],
    ['neck', 'x', 14], ['head', 'x', 12], ['tail1', 'x', -20], ['tail2', 'x', -25], ['tail3', 'y', -25], ['tail4', 'y', -30], ['tail5', 'y', -32], ['tail6', 'y', -30], ['tail7', 'y', -24]] },
  // stalking: head low and level, tail held low behind it
  stalk: { ops: [['neck', 'x', 14], ['head', 'x', -10], ['tail1', 'x', -62], ['tail2', 'x', -14], ['tail3', 'x', 6], ['tail5', 'x', 8]] },
  // in the air: forelegs reaching ahead, hind legs stretched back, tail out behind
  air: { ops: [['arm', 'x', -55], ['fore', 'x', -25], ['thigh', 'x', 45], ['shin', 'x', 25], ['foot', 'x', 20], ['tail1', 'x', -40], ['tail2', 'x', -15], ['tail3', 'x', -10]] },
  // the stretch on waking ("bow"): forelegs reaching flat ahead, chest low, haunches up, tail raised
  bow: { ops: [['hips', 'x', 22], ['thigh', 'x', -22], ['arm', 'x', -62], ['fore', 'x', -18], ['paw', 'x', 25], ['neck', 'x', -30], ['head', 'x', -6]] },
};
// grooming, from sitting: a forepaw licked, then drawn over the face
CAT_POSES.lick = { ops: [...CAT_POSES.sit.ops, ['arm_L', 'x', -62], ['fore_L', 'x', -75], ['paw_L', 'x', -20], ['neck', 'x', 18], ['head', 'x', 18], ['head', 'y', 12]] };
CAT_POSES.wipe = { ops: [...CAT_POSES.sit.ops, ['arm_L', 'x', -95], ['fore_L', 'x', -70], ['paw_L', 'x', -30], ['arm_L', 'y', -18], ['head', 'x', 12], ['head', 'z', 16], ['head', 'y', 10]] };
/* ---- the springs */
const cqlog = (q, v) => { const s = Math.hypot(q.x, q.y, q.z); if (s < 1e-9) return v.set(2 * q.x, 2 * q.y, 2 * q.z); const a = 2 * Math.atan2(s, q.w) / s; return v.set(q.x * a, q.y * a, q.z * a); };
const cqexp = (v, q) => { const a = v.length(); if (a < 1e-9) return q.set(v.x / 2, v.y / 2, v.z / 2, 1).normalize(); const s = Math.sin(a / 2) / a; return q.set(v.x * s, v.y * s, v.z * s, Math.cos(a / 2)); };
function cspringQ(q, w, qt, y, ey, dt) {   // q (turning at w) toward qt: the turn left to go decays, critically damped
  _cq3.copy(qt).invert().multiply(q); if (_cq3.w < 0) _cq3.set(-_cq3.x, -_cq3.y, -_cq3.z, -_cq3.w);
  cqlog(_cq3, _c3); _c4.copy(w).addScaledVector(_c3, y);
  w.addScaledVector(_c4, -y * dt).multiplyScalar(ey); _c3.addScaledVector(_c4, dt).multiplyScalar(ey);
  q.copy(qt).multiply(cqexp(_c3, _cq3));
}
function catSprings() {   // the springs' state: each bone as shown and its rate; the body's place likewise
  CATR.S = { bones: new Map([...CATR.rest.keys()].map(b => [b, { q: b.quaternion.clone(), w: new THREE.Vector3() }])),
    pos: CATR.body.position.clone(), vel: new THREE.Vector3(), quat: CATR.body.quaternion.clone(), w: new THREE.Vector3() };
}
function catToward(P, dt, half) {   // everything toward pose P (half: the time to go half the way, s)
  const S = CATR.S, y = 1.3862944 / Math.max(half, 0.01), ey = Math.exp(-y * dt);
  for (const [b, st] of S.bones) { cspringQ(st.q, st.w, P.q.get(b), y, ey, dt); b.quaternion.copy(st.q); }
  _c3.copy(S.pos).sub(P.pos); _c4.copy(S.vel).addScaledVector(_c3, y);
  S.vel.addScaledVector(_c4, -y * dt).multiplyScalar(ey); _c3.addScaledVector(_c4, dt).multiplyScalar(ey); S.pos.copy(P.pos).add(_c3);
  cspringQ(S.quat, S.w, P.quat, y, ey, dt);
  CATR.body.position.copy(S.pos); CATR.body.quaternion.copy(S.quat);
}
function catSnap(P) {   // at pose P at once, at rest
  for (const [b, st] of CATR.S.bones) { st.q.copy(P.q.get(b)); st.w.set(0, 0, 0); b.quaternion.copy(st.q); }
  CATR.S.pos.copy(P.pos); CATR.S.vel.set(0, 0, 0); CATR.S.quat.copy(P.quat); CATR.S.w.set(0, 0, 0);
  CATR.body.position.copy(P.pos); CATR.body.quaternion.copy(P.quat);
}
function catKeep(bones, dt) {   // bones placed by other means (the legs' reach): the springs go on from where they are
  for (const b of bones) { const st = CATR.S.bones.get(b); if (!st) continue;
    _cq3.copy(st.q).invert().multiply(b.quaternion); if (_cq3.w < 0) _cq3.set(-_cq3.x, -_cq3.y, -_cq3.z, -_cq3.w);
    cqlog(_cq3, st.w).multiplyScalar(dt > 0 ? 0.5 / dt : 0); st.q.copy(b.quaternion); }
}
/* ---- set up: the bones, their rest, the poses, the legs */
function rigCat(node) {
  node.removeFromParent();
  const inner = new THREE.Group(); inner.add(node); inner.rotation.y = -Math.PI / 2; inner.scale.setScalar(CATR.scale);   // the model faces +x: turned to +z
  const body = new THREE.Group(); body.add(inner); CATR.body = body;
  node.traverse(o => { if (o.isBone) CATR.bones[o.name] = o; if (o.isSkinnedMesh) CATR.mesh = o; });
  { const m = CATR.mesh, J = m.geometry.attributes.skinIndex, W = m.geometry.attributes.skinWeight, tail = m.skeleton.bones.map(b => /^tail/.test(b.name));
    CATR.ground = []; for (let i = 0; i < J.count; i++) { let w = 0; for (let c = 0; c < 4; c++) if (tail[J.getComponent(i, c)]) w += W.getComponent(i, c); if (w < 0.5) CATR.ground.push(i); } }   // what it stands on: all but its tail
  CATR.rest = new Map(Object.values(CATR.bones).map(b => [b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }]));
  catRest(); CATR.gaze = new THREE.Vector3(0, 0, 1).applyQuaternion(CATR.bones.head.getWorldQuaternion(new THREE.Quaternion()).invert());   // its eyes' line, in the head's frame
  for (const [k, P] of Object.entries(CAT_POSES)) CATR.poses[k] = catPose(P);
  catRest(); catLegs(); catSprings(); catSnap(CATR.poses.stand);
  CATR.tail = C_TAIL.map(() => ({ e: new THREE.Vector2(), w: new THREE.Vector2() }));
  return body;
}
// each leg, standing: its joints, its two lengths to reach with, and where its paw meets the ground under the body
function catLegs() {
  const B = CATR.bones, k = CATR.scale; CATR.legs = {}; catRest();
  for (const [f, s, hind] of [['lh', 'L', 1], ['rh', 'R', 1], ['lf', 'L', 0], ['rf', 'R', 0]]) {
    const up = B[(hind ? 'thigh_' : 'arm_') + s], mid = B[(hind ? 'shin_' : 'fore_') + s], end = B[(hind ? 'foot_' : 'paw_') + s], toe = hind ? B['toe_' + s] : null;
    const A = cwp(up), K = cwp(mid), J = cwp(end), tipOf = b => cwp(b).add(new THREE.Vector3(0, 1, 0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(b.userData.len * k));
    const tip = tipOf(toe || end), ball = toe ? cwp(toe) : J.clone().lerp(tip, 0.6);   // the pad it stands on
    const contact = new THREE.Vector3(ball.x, 0, ball.z);
    CATR.legs[f] = { up, mid, end, toe, hind: !!hind, l1: A.distanceTo(K), l2: K.distanceTo(J), home: contact.clone(), jo: J.clone().sub(contact),
      dEnd: (toe ? ball.clone().sub(J) : tip.clone().sub(J)).normalize(), dToe: toe ? tip.clone().sub(ball).normalize() : null, scap: hind ? null : B['scap_' + s] };
  }
  // the stride its legs can make: each paw's sweep centred under its shoulder or hip, as far either way as the leg reaches
  // (93 % of it, never straight) with the body lowered by the walk's crouch; the shortest sets it
  let half = Infinity;
  for (const L of Object.values(CATR.legs)) {
    const A = cwp(L.up), J = L.home.clone().add(L.jo), c = J.z - A.z;
    L.home.z -= c;   // (the paw's home moved under the joint above it)
    const h = A.y - J.y - CGAIT.crouch, R = 0.93 * (L.l1 + L.l2);
    half = Math.min(half, Math.sqrt(Math.max(0, R * R - h * h)));
  }
  CGAIT.sst = 2 * 0.9 * half; CGAIT.sref = CGAIT.sst / (1 - CGAIT.tsw / CGAIT.Tref); CGAIT.vref = CGAIT.sref / CGAIT.Tref;
}
/* ---- reach: a leg to a paw on the ground, by two-bone inverse kinematics (thigh and shin to the hock, upper arm and
   forearm to the wrist; the knee bending forward, the elbow back), the foot down to the pad and the toes ahead; a paw in
   the air curls under (a cat's forepaw folds at the wrist as it swings) */
const _r = { J: new THREE.Vector3(), A: new THREE.Vector3(), u: new THREE.Vector3(), n: new THREE.Vector3(), K: new THREE.Vector3(), d: new THREE.Vector3(), side: new THREE.Vector3(), fwd: new THREE.Vector3() };
function catReach(f, P, curl, yawQ) {   // (no new objects: it runs for four legs every frame)
  const L = CATR.legs[f], R = _r, fwd = R.fwd.set(0, 0, 1).applyQuaternion(yawQ), up = C_AX.y, side = R.side.set(1, 0, 0).applyQuaternion(yawQ);
  const J = R.J.copy(L.jo).applyQuaternion(yawQ);
  if (curl > 0) J.applyAxisAngle(side, (L.hind ? -0.25 : -0.3) * curl);   // the joint above swings back as the paw lifts
  J.add(P);
  L.up.updateWorldMatrix(true, false); const A = cwp(L.up, R.A), u = R.u.copy(J).sub(A);
  const d = Math.min(Math.max(u.length(), Math.abs(L.l1 - L.l2) + 1e-4), L.l1 + L.l2 - 1e-4); u.normalize();
  const ca = (L.l1 * L.l1 - L.l2 * L.l2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, L.l1 * L.l1 - ca * ca));
  const n = R.n.copy(fwd).multiplyScalar(L.hind ? 1 : -1).addScaledVector(up, -0.05); n.addScaledVector(u, -n.dot(u)).normalize();
  const K = R.K.copy(A).addScaledVector(u, ca).addScaledVector(n, hh);
  catAim(L.up, R.d.copy(K).sub(A)); catAim(L.mid, R.d.copy(J).sub(K));
  const dEnd = R.d.copy(L.dEnd).applyQuaternion(yawQ);
  if (curl > 0) dEnd.applyAxisAngle(side, (L.hind ? 0.35 : 0.7) * curl);   // the paw folds under
  catAim(L.end, dEnd);
  if (L.toe) { const dt = R.d.copy(L.dToe).applyQuaternion(yawQ); if (curl > 0) dt.applyAxisAngle(side, 0.5 * curl); catAim(L.toe, dt); }
}
/* ---- the gait: where each paw is. A paw in stance stays where it came down; a paw in swing lifts, clears the ground and
   comes down where its home under the body will be when it lands, half a stance ahead of it. */
const CGAIT = { Tref: 0.6, tsw: 0.24, off: { lh: 0, lf: 0.25, rh: 0.5, rf: 0.75 }, lift: 0.022, crouch: 0.02, sref: 0.16, vref: 0.27, sst: 0.1 };
function catGait(G, dt, v, w) {   // G: { x, z, yaw, y (the ground), phase, feet }; v its speed (m/s), w its turning (rad/s)
  const L = CATR.legs, moving = Math.abs(v) > 0.004 || Math.abs(w) > 0.05;
  const ve = Math.max(Math.abs(v), Math.abs(w) * 0.1, 0.1);   // the pace its steps keep (turning on the spot too)
  const sst = CGAIT.sst * (0.75 + 0.25 * Math.min(1.6, ve / CGAIT.vref)), T = sst / ve + CGAIT.tsw, beta = 1 - CGAIT.tsw / T;
  const home = (f, s) => {   // where a paw's home is, s seconds on (going on as now)
    const h = L[f].home, yw = G.yaw + w * s, c = Math.cos(yw), n = Math.sin(yw), dx = Math.sin(G.yaw + w * s / 2) * v * s, dz = Math.cos(G.yaw + w * s / 2) * v * s;
    return new THREE.Vector3(G.x + dx + h.x * c + h.z * n, G.y, G.z + dz - h.x * n + h.z * c);
  };
  if (!G.feet) G.feet = Object.fromEntries(Object.keys(L).map(f => [f, { planted: home(f, 0), lift: null, land: null, swing: false, target: null, curl: 0 }]));
  const swinging = Object.values(G.feet).some(F => F.swing);
  if (moving || swinging) G.phase += dt / T;
  G.T = T; G.beta = beta; G.moving = moving;
  for (const f of Object.keys(L)) {
    const F = G.feet[f], p = (((G.phase + CGAIT.off[f]) % 1) + 1) % 1, inSwing = p >= beta;
    if (inSwing && !F.swing && (moving || F.planted.distanceTo(home(f, 0)) > 0.025) && !F.stay) { F.swing = true; F.lift = F.planted.clone(); }
    if (!inSwing) F.stay = false; else if (!F.swing) F.stay = true;   // a paw that did not lift this stride waits for the next
    if (F.swing) {
      const s = inSwing ? (p - beta) / (1 - beta) : 1, left = (1 - s) * CGAIT.tsw;
      F.land = home(f, left); if (moving) F.land.add(new THREE.Vector3(Math.sin(G.yaw), 0, Math.cos(G.yaw)).multiplyScalar(Math.sign(v) * sst / 2));
      if (s >= 1) { F.swing = false; F.planted.copy(F.land); F.target = F.planted; F.curl = 0; }
      else { const e = s * s * s * (s * (6 * s - 15) + 10); F.target = F.lift.clone().lerp(F.land, e); F.target.y += CGAIT.lift * Math.pow(Math.sin(Math.PI * s), 0.8); F.curl = Math.sin(Math.PI * Math.min(1, s * 1.15)); }
    } else { F.target = F.planted; F.curl = 0; }
  }
}
// the trunk over the stepping legs (k: how much it is walking, 0..1): down twice a stride (just after each hind paw
// lands), haunches and chest dipping in turn, a sway and a roll once a stride, the shoulder blades riding over the forepaws
function catStride(G, k) {
  if (k <= 0) return;
  const p = G.phase, B = CATR.bones, body = CATR.body;
  body.position.y += (-CGAIT.crouch - 0.003 * Math.cos(4 * Math.PI * (p - 0.08))) * k;   // a little crouched, rising and falling
  body.position.x += 0.003 * Math.sin(2 * Math.PI * (p - 0.15)) * k;
  body.quaternion.multiply(_cq4.setFromEuler(_cE.set(0.018 * Math.sin(4 * Math.PI * (p - 0.2)) * k, 0, 0.028 * Math.sin(2 * Math.PI * (p - 0.15)) * k)));
  body.updateMatrixWorld(true);
  const side = catAxis('x', _cS), upw = catAxis('y', _cU);
  catTurn(B.chest, _cq4.setFromAxisAngle(upw, 0.045 * Math.sin(2 * Math.PI * (p - 0.3)) * k));   // the trunk bends a little toward the reaching forepaw
  for (const [f, s] of [['lf', '_L'], ['rf', '_R']]) {   // a shoulder blade: forward as its paw swings, back and up over it in stance
    const q = (((p + CGAIT.off[f]) % 1) + 1) % 1, a = q < G.beta ? -0.06 + 0.12 * q / G.beta : 0.06 - 0.12 * (q - G.beta) / (1 - G.beta);
    catTurn(B['scap' + s], _cq4.setFromAxisAngle(side, a * k));
  }
}
// the head toward a direction (world), the neck taking part of the turn, within a limit; k: how much
function catLook(dir, k, lim = 1.2) {
  const head = CATR.bones.head; head.updateWorldMatrix(true, false);
  const nose = _c1.copy(CATR.gaze).applyQuaternion(head.getWorldQuaternion(_cq4)).normalize();
  _cq4.setFromUnitVectors(nose, _c2.copy(dir).normalize()); const a = 2 * Math.acos(Math.min(1, Math.abs(_cq4.w)));
  if (a > lim) _cq4.slerp(_cq3.identity(), 1 - lim / a);
  const part = _cL1.identity().slerp(_cq4, 0.45 * k), rest = _cL2.identity().slerp(_cq4, 0.55 * k);
  catTurn(CATR.bones.neck, part); catTurn(head, rest);
}
/* ---- the tail: each joint's bend away from its pose, a damped spring pushed by the body's own moves (it swings out
   on a turn, drops as the cat speeds up, lifts as it lands), stiffer at the root than at the tip */
function catTail(dt, acc, yawAcc, sway) {
  const T = CATR.tail, B = CATR.bones; if (!T) return;
  const side = catAxis('y', _cS), pitch = catAxis('x', _cU);
  for (let i = 1; i < 7; i++) {
    const st = T[i], kk = 120 - 14 * i, c = 2 * Math.sqrt(kk) * 0.55;   // natural frequency falling toward the tip, under-damped
    const fx = -yawAcc * 0.004 * i + sway * (i > 2 ? 1 : 0.3), fy = -(acc.z * 0.03 + acc.y * 0.02);   // a turn swings it out behind, a start or a landing drops it
    for (let n = 0; n < 2; n++) { const h = dt / 2;
      st.w.x += (-kk * st.e.x - c * st.w.x + fx * kk) * h; st.w.y += (-kk * st.e.y - c * st.w.y + fy * kk) * h;
      st.e.x += st.w.x * h; st.e.y += st.w.y * h; }
    st.e.clampScalar(-0.5, 0.5);
    catTurn(B[C_TAIL[i]], _cq4.setFromAxisAngle(side, st.e.x)); catTurn(B[C_TAIL[i]], _cq4.setFromAxisAngle(pitch, st.e.y));
  }
}
/* ---------------------------------------------------------------- fur
   The cat's coat drawn as shells, the way games draw short animal fur (Lengyel, Praun, Finkelstein & Hoppe, "Real-Time
   Fur over Arbitrary Surfaces", 2001; NVIDIA's "Fur: shells and fins"): its skin drawn again in FUR.shells layers, each
   pushed out along the skin's normal a little further (combed back along the body and drooping a touch toward the
   tips), keeping only where a strand reaches. The strands are cells of the coat's texture space (~1.3 mm apart on this
   cat), each of its own height, thinning toward its tip; the layers are 0.4 mm apart, about a thousandth of the cat
   (Lengyel's rule of thumb). So its outline turns soft and the coat takes depth: the roots in shadow, the tips catching
   the light. Each strand takes the colour of the coat where it grows (white on the bib, the blaze and the toes); none
   grow on the eyes or the nose (the wet parts of its roughness map). Where strands are smaller than a pixel a layer
   keeps its average cover instead of its pattern, so the coat does not shimmer as the cat moves. The layers are not
   lit one by one (twenty layers of the room's lights cost too much close up): each frame the skin is lit once, as the
   room lights it, into its own texture space (512 px, the empty texels filled from their neighbours so seams do not
   show), and every layer takes its colour from there ("texture-space lighting"). The layers are blended
   over the skin, depth-tested but not writing depth (as NVIDIA's sample does), in one draw whose triangles go layer by
   layer from the inside out, so each lies over the one beneath; blended, the crisp pass's target keeps premultiplied
   colour, which its composite expects. The fur is shorter on the head, ears and paws and longer on the tail. The layers
   are copies of the skin in one mesh, bound to the cat's skeleton, so they move with it.                          */
const FUR = { shells: 20, density: 440, layer: 2, size: 512, bake: null, rt: null, rt2: null, cam: new THREE.Camera(), dil: null,
  u: { uFurLen: { value: 0.008 }, uComb: { value: new THREE.Vector3(0, 0, -1) }, uFurMask: { value: null } } };
// how long the fur is on each part, as a share of the body's
const FUR_PART = [[/^head$/, 0.55], [/^ear/, 0.3], [/^(paw|toe|foot)/, 0.5], [/^fore/, 0.8], [/^tail/, 1.3]];
function furCoat(skin, patch) {
  const src = skin.geometry, N = FUR.shells, n = src.attributes.position.count, g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) {   // each attribute copied N times (as stored: quantized, interleaved or not)
    const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array, out = new arr.constructor(n * a.itemSize * N);
    for (let i = 0; i < n; i++) for (let c = 0; c < a.itemSize; c++) {
      const v = a.isInterleavedBufferAttribute ? arr[i * a.data.stride + a.offset + c] : arr[i * a.itemSize + c];
      for (let s = 0; s < N; s++) out[(s * n + i) * a.itemSize + c] = v;
    }
    g.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize, a.normalized));
  }
  const shell = new Float32Array(n * N), len = new Float32Array(n * N);
  const J = src.attributes.skinIndex, W = src.attributes.skinWeight, part = skin.skeleton.bones.map(b => (FUR_PART.find(([re]) => re.test(b.name)) || [0, 1])[1]);
  for (let i = 0; i < n; i++) {
    let l = 0; for (let c = 0; c < 4; c++) l += W.getComponent(i, c) * part[J.getComponent(i, c)];
    for (let s = 0; s < N; s++) { shell[s * n + i] = (s + 1) / N; len[s * n + i] = l; }
  }
  g.setAttribute('aShell', new THREE.BufferAttribute(shell, 1)); g.setAttribute('aFur', new THREE.BufferAttribute(len, 1));
  const idx = src.index, I = new (n * N > 65535 ? Uint32Array : Uint16Array)(idx.count * N);
  for (let s = 0; s < N; s++) for (let i = 0; i < idx.count; i++) I[s * idx.count + i] = idx.getX(i) + s * n;
  g.setIndex(new THREE.BufferAttribute(I, 1));
  // the skin lit into texture space: the cat's own material, its vertices placed by their texture coordinates
  const lit = () => new THREE.WebGLRenderTarget(FUR.size, FUR.size, { type: THREE.HalfFloatType, depthBuffer: false });
  FUR.rt = lit(); FUR.rt2 = lit();
  const bm = skin.material.clone(); bm.side = THREE.DoubleSide; bm.customProgramCacheKey = () => 'fur-bake';
  bm.onBeforeCompile = sh => {   // (drawn both ways round in texture space, so no face is taken for a back face)
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position = vec4(vMapUv * 2.0 - 1.0, 0.0, 1.0);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
  };
  FUR.bake = new THREE.SkinnedMesh(skin.geometry, bm); FUR.bake.bind(skin.skeleton, skin.bindMatrix);
  FUR.bake.position.copy(skin.position); FUR.bake.quaternion.copy(skin.quaternion); FUR.bake.scale.copy(skin.scale);
  FUR.bake.frustumCulled = false; FUR.bake.layers.set(FUR.layer); skin.parent.add(FUR.bake); FUR.cam.layers.set(FUR.layer);
  FUR.dil = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { t: { value: null }, px: { value: 1 / FUR.size } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D t; uniform float px; varying vec2 vUv;
      void main() { vec4 c = texture2D(t, vUv); if (c.a > 0.5) { gl_FragColor = c; return; }   // an empty texel takes its filled neighbours' mean
        vec4 s = vec4(0.0); for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) { vec4 n = texture2D(t, vUv + vec2(i, j) * px); s += vec4(n.rgb, 1.0) * step(0.5, n.a); }
        gl_FragColor = s.a > 0.0 ? vec4(s.rgb / s.a, 1.0) : vec4(0.0); }` }));
  FUR.u.uFurMask.value = skin.material.roughnessMap;
  const mat = new THREE.MeshBasicMaterial({ map: FUR.rt.texture, transparent: true, depthWrite: false, side: THREE.FrontSide });
  mat.fog = false;
  mat.onBeforeCompile = sh => {
    patch(sh); Object.assign(sh.uniforms, FUR.u);
    sh.vertexShader = 'attribute float aShell, aFur; uniform float uFurLen; uniform vec3 uComb; varying float vShell, vFur;\n' + sh.vertexShader
      .replace('#include <project_vertex>', `#include <project_vertex>
        // out along the normal, combed back along the body and drooping as it goes (in view space: metres)
        vShell = aShell; vFur = aFur;
        vec3 nv = normalize(transformedNormal), cb = mat3(viewMatrix) * uComb, dn = mat3(viewMatrix) * vec3(0.0, -1.0, 0.0);
        cb -= nv * dot(cb, nv);
        mvPosition.xyz += (nv * aShell + cb * 0.6 * aShell * aShell + dn * 0.15 * aShell * aShell) * uFurLen * aFur;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = `uniform sampler2D uFurMask; varying float vShell, vFur;
      float furHash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }\n` + sh.fragmentShader
      .replace('#include <map_fragment>', `
        {
          // the strand this fragment would belong to: its cell, height, place in the cell; thinner toward the tip
          vec2 gc = vMapUv * ${FUR.density.toFixed(1)}, id = floor(gc), f = fract(gc) - 0.5;
          vec2 lean = vec2(furHash(id + 5.17), furHash(id + 9.41)) - 0.5;   // each strand leans its own way as it rises (no rows)
          float hgt = 0.3 + 0.7 * furHash(id), d = length(f - (vec2(furHash(id + 17.31), furHash(id + 41.73)) - 0.5) * 0.36 - lean * 0.7 * vShell);
          float r = 0.6 * (1.0 - vShell / hgt), aw = fwidth(d) + 1e-4;
          float exact = vShell < hgt ? 1.0 - smoothstep(r - aw, r + aw, d) : 0.0;
          float avg = clamp(1.15 * (1.0 - vShell) * (1.0 - vShell), 0.0, 1.0) * clamp((1.0 - vShell) / 0.7, 0.0, 1.0);   // the same, on average
          float px = length(fwidth(gc)), cover = mix(exact, avg, smoothstep(0.3, 1.1, px));
          vec2 e0 = (vMapUv - vec2(0.4019, 0.2964)) / vec2(0.0125, 0.0185), e1 = (vMapUv - vec2(0.4985, 0.2969)) / vec2(0.0125, 0.0185);   // the eyes (as in pets.js)
          cover *= smoothstep(0.35, 0.7, texture2D(uFurMask, vMapUv).g) * step(0.05, vFur) * smoothstep(0.9, 1.25, min(dot(e0, e0), dot(e1, e1)));   // none on the eyes or the nose
          if (cover < 0.02) discard;
          diffuseColor = vec4(texture2D(map, vMapUv).rgb * mix(0.4, 1.04, vShell), cover);   // the skin as lit; the roots in its shade, the tips in the light
        }`);
  };
  const fur = new THREE.SkinnedMesh(g, mat); fur.bind(skin.skeleton, skin.bindMatrix);
  fur.position.copy(skin.position); fur.quaternion.copy(skin.quaternion); fur.scale.copy(skin.scale);
  fur.frustumCulled = false; fur.layers.mask = skin.layers.mask; fur.renderOrder = skin.renderOrder + 1;
  skin.parent.add(fur);
  return fur;
}
// each frame: which way is back along the body (the fur is combed that way), in the world
function furComb(body) { FUR.u.uComb.value.set(0, 0, -1).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion())); }
// each frame, before the cat is drawn: its skin lit as the room lights it (seen from the camera), into texture space,
// then its empty texels filled twice from their neighbours
const _furC = new THREE.Color();
function furLight(renderer, scene, camera) {
  if (!FUR.bake) return;
  camera.matrixWorld.decompose(FUR.cam.position, FUR.cam.quaternion, FUR.cam.scale); FUR.cam.projectionMatrix.copy(camera.projectionMatrix); FUR.cam.updateMatrixWorld(true);
  const cc = renderer.getClearColor(_furC), ca = renderer.getClearAlpha(), ac = renderer.autoClear;
  renderer.autoClear = true; renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(FUR.rt); renderer.render(scene, FUR.cam);
  for (const [a, b] of [[FUR.rt, FUR.rt2], [FUR.rt2, FUR.rt]]) { FUR.dil.material.uniforms.t.value = a.texture; renderer.setRenderTarget(b); FUR.dil.render(renderer); }
  renderer.setRenderTarget(null); renderer.setClearColor(cc, ca); renderer.autoClear = ac;
}
/* ---------------------------------------------------------------- the cat and the chicken
   A black cat with a white bib, blaze and toes lives in the room ("cat" by artofaria, rigged and moved in code: cat.js,
   its coat drawn as shells of fur: fur.js),
   and a chicken ("Chicken" by pooiloui2, CC BY 4.0) forages outside the left glass. Both are drawn crisp over the
   painted room (not watercoloured), lit by the room's lights and toned like the painting, hidden where the room is
   nearer. What the cat does follows what cats do:
   - By day it lies like a sphinx by the glass, its eyes and ears on the hen. When the hen pecks or scratches near, it
     may rise into a hunting crouch, ears forward, tail lashing, haunches wiggling (the weight-shift before a pounce),
     find the glass in the way, and sit and wash (cats groom after a thwarted hunt). Now and then it sits up to wash
     anyway: a forepaw licked, then drawn over the face. It blinks, and when it looks at you it may blink slowly (the
     "slow blink" cats give people they are at ease with: Humphrey et al. 2020).
   - At dusk (cats are most active at dusk and dawn) it wakes, stretches (forelegs out, haunches up), walks to the
     sofa, looks up and gauges the jump, gathers, jumps (a ballistic arc, g = 9.81 m/s²) and lands forepaws first, the
     hind paws after (the forelimbs take the larger share of a cat's landing: Wu et al. 2019), kneads the cushion,
     turns round and lies down, curled up in a ball to doze (belly down, legs tucked under, head resting at the front,
     tail wrapped round: G's photo, 17/10/2026), eyes shut; after a while it rolls slowly onto its side and sleeps
     deeply (back rounded, head down by its paws, tail round in front), the Zzz rising only then; pressed a little into
     the cushion and never through it; asleep it breathes slowly, sighs, twitches an ear, now and then lifts its head
     and settles again. At dawn the other way, down to the floor and back to the glass.
   How it moves is in cat.js. The chicken: feet planted for 60 % of its stride, the body riding over the standing leg
   like an inverted pendulum and swaying over it, the head holding still in space while the body passes, then
   thrusting ahead; it scratches in a four-stroke bout, steps back, looks at the ground with one eye and pecks in quick
   bouts. It has no skeleton: its head and neck, body and feet move in the vertex shader by regions of its mesh. They
   come from cat.bin and hen.glb (src/tools/pets/), fetched once the room shows, on layer 1, which only their crisp
   pass sees.                                                                                                        */
const PETS = { ok: false, cat: null, holder: null, chicken: null, layer: 1, last: 0, state: null, surfaceAt: (x, z) => surfaceAt(x, z) };
// where the cat stays (by day the floor between the stump table and the glass, by night the chaise: on the flat of its
// cushion, back from the front edge where it rounds off), and where it jumps. sink: how far it presses into what it
// lies on (a soft cushion gives ~1 cm under a cat; the floor none)
const CAT_SPOT = { day: { x: -0.82, z: -5.02, yaw: -Math.PI / 2 - 0.12, sink: 0 }, night: { x: 1.62, z: -6.1, yaw: -1.83, sink: 0.024 } };   // (night: into the ~3 cm hollow it makes)   // (asleep on its side, its face and paws toward the room)
const CAT_WAY = { floor: [1.22, -5.22], seat: [1.5, -6.02] };   // the floor left of the deck, the chaise's cushion
// the chicken's patch of lawn outside the left glass (it wanders in it), and its height
const HEN_AREA = { x0: -2.45, x1: -1.85, z0: -5.7, z1: -4.5, h: 0.42 };   // clear of the sill, so its legs show
const HEN_GROUND = -0.1;   // it walks on the patio's flags (outside.js: 2 cm above the lawn; on the lawn's level its toes sank out of sight)
// the surface under a point: the first thing a ray from above meets (the floor if nothing)
function surfaceAt(x, z) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 2.5, z), new THREE.Vector3(0, -1, 0), 0, 3); ray.camera = camera;   // (sprites ask for it)
  const hit = ray.intersectObject(room, true).find(h => h.object.isMesh && h.object.visible && h.point.y < 1.2);
  return hit ? hit.point.y : 0;
}
async function petBytes(id) {   // inline (base64) in the one-file build, a file next to the page on GitHub Pages
  const el = document.getElementById(id); if (!el) return null;
  if (el.dataset.src) { const r = await fetch(el.dataset.src); if (!r.ok) throw new Error(id + ' ' + r.status); return r.arrayBuffer(); }
  if (el.textContent.trim().length > 100) return (await fetch('data:application/octet-stream;base64,' + el.textContent.trim())).arrayBuffer();
  return null;
}
// cat.bin back to the cat's GLB: its bytes XORed with the same xorshift stream that tools/pets/pack.mjs laid on them
// (the model's licence asks that it not be made available as a file of its own)
function catBytes(buf) {
  const b = new Uint8Array(buf); let s = 0x2545F491;
  for (let i = 0; i < b.length; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; b[i] ^= s & 255; }
  return b.buffer;
}
// a soft shadow where an animal touches the ground (in the room, so it is painted with it)
let _shadowTex = null;
function contactShadow(w, d) {
  if (!_shadowTex) { const c = canvas(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(18,11,5,.72)'); gr.addColorStop(0.55, 'rgba(18,11,5,.38)'); gr.addColorStop(1, 'rgba(18,11,5,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); _shadowTex = ctex(c, { rep: false }); }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: _shadowTex, transparent: true, depthWrite: false, fog: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1; return m;
}
/* ---- crisp: drawn over the picture, a fragment is dropped where the room is nearer (the room's depth, as the deck).
   Laid over the picture through the room's own tone (its exposure, the filmic curve; toneK of the paper's lift and
   warmth and its veil). The chicken is given a watercolour's surface with its detail kept (uWash: washAt): the paper's
   grain over it, pigment settled in the paper's valleys where it is dark (granulation), darker where one wash meets
   another (the pigment that gathers at a drying wash's edge: Curtis et al. 1997, "Computer-Generated Watercolor";
   Montesdeoca et al. 2016), a touch less saturated and warmer (pigment on paper), its outline a little uneven where
   the paper took the paint unevenly, and a little colour bled past it into the paper; then 15 % of the painted pass
   itself (post.js PAINT_GLSL) over that (G, 15/10/2026: 70 % less watercolour than the 50 % it had, but truer). */
function sharpQuad(P) {
  P.quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { t: { value: null }, uScale: { value: new THREE.Vector2(1, 1) }, uPaint: { value: P.paint }, uWash: { value: P.wash || 0 }, uToneK: { value: P.toneK }, ...SHARP.u, ...paintUniforms() },
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, vertexShader: QUAD_VS,
    fragmentShader: `uniform sampler2D t; uniform vec2 uScale; uniform float uExp, uLift, uVeil, uPaint, uWash, uToneK; varying vec2 vUv;
      ${PAINT_GLSL}
      vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
      vec3 toS(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(0.0031308,c)); }
      vec3 tone(vec3 c){ vec3 col = toS(aces(c * uExp * 0.85));
        col = mix(vec3(dot(col, vec3(0.299,0.587,0.114))), col, mix(1.0, 0.97, uToneK));
        col = 1.0 - (1.0 - col) * mix(1.0, uLift, 0.75 * uToneK);   // most of the paper's lift: blacks as deep as the painting's
        return mix(col, col * vec3(1.02,1.0,0.95), 0.6 * uToneK) * (1.0 - uVeil * uToneK); }
      vec4 shadeAt(vec2 uv){ vec4 c = texture2D(t, clamp(uv, uTexel * 0.5, uScale - uTexel * 0.5)); return c.a < 0.002 ? vec4(0.0) : vec4(tone(c.rgb / c.a), c.a); }
      vec4 washAt(vec2 uv, vec4 o){   // the crisp picture with a watercolour's surface, its detail kept
        vec2 sp = gl_FragCoord.xy / uCanvas, d = uTexel * uStep; vec4 n1 = texture2D(tN1, sp), n2 = texture2D(tN2, sp);
        vec4 b = vec4(0.0); for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec4 c = shadeAt(uv + vec2(float(i), float(j)) * d * 1.6); b += vec4(c.rgb * c.a, c.a); } b /= 9.0;
        vec3 col = o.rgb; float lum = dot(col, vec3(0.299, 0.587, 0.114)), dog = length(col * o.a - b.rgb) + abs(o.a - b.a) * 0.5;
        col *= 1.0 - 0.2 * smoothstep(0.03, 0.2, dog) * o.a;                 // pigment gathered where one wash meets another
        col *= 1.0 - 0.13 * (1.0 - n2.z) * (1.0 - lum);                     // granulation, in the paper's valleys
        col *= 0.965 + n2.z * 0.06;                                          // the paper's grain
        col = mix(vec3(lum), col, 0.93) * vec3(1.012, 1.0, 0.972);          // pigment on paper
        float a = o.a * mix(1.0, smoothstep(0.3, 0.6, n2.z + o.a * 0.5), (1.0 - smoothstep(0.75, 1.0, o.a)) * 0.8);   // the outline taken unevenly
        if (b.a > 0.02 && a < 0.5) { float bl = b.a * 0.22 * (0.55 + 0.9 * n1.z); col = mix(b.rgb / b.a * 1.04, col, a / max(a + bl, 1e-4)); a = max(a, bl); }   // a little colour bled past it
        return vec4(col, a);
      }
      void main(){ vec2 uv = vUv * uScale; vec4 o = shadeAt(uv); if (uWash > 0.001) o = mix(o, washAt(uv, o), uWash); if (uPaint > 0.001) { float det; vec4 pt = paintAt(uv, det); o = mix(o, pt, uPaint * (1.0 - 0.45 * smoothstep(0.004, 0.04, det))); }   // (busy detail kept crisper)
        if (o.a < 0.002) discard; gl_FragColor = vec4(o.rgb * o.a, o.a); }` }));
}
const SHARP = { cam: new THREE.Camera(), v: new THREE.Vector3(), u: { uExp: { value: 1 }, uLift: { value: 0.88 }, uVeil: { value: 0.06 } },
  cat: { rt: null, quad: null, paint: 0, layer: 1, toneK: 1 }, hen: { rt: null, quad: null, paint: 0.15, wash: 1, layer: 1, toneK: 1 },   // (each its own target; the chicken 15 % painted over a watercolour's surface: G, 15/10/2026)
  book: { rt: null, quad: null, paint: 0, layer: 3, toneK: 0.35 } };   // the book out of the shelf: sharp, its colours nearly as printed (G, 15/10/2026)
PETS.sharp = SHARP;   // (for tests)
function crispPatch(sh) {
  sh.uniforms.uDepth = DECKR.u.uDepth; sh.uniforms.uFull = DECKR.u.uFull; sh.uniforms.uOff = DECKR.u.uOff;
  sh.fragmentShader = 'uniform sampler2D uDepth; uniform vec2 uFull, uOff;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;');
}
/* ---- the cat's eyes are painted on its face: lids are drawn over them in the shader. The upper lid comes down and the
   lower one a little up (on its texture the brow lies toward +v), in the fur beside the eye; the closed lid is fur. */
const CAT_EYE = { u: { uBlink: { value: 0 } } };
function catPatch(sh) {
  crispPatch(sh); sh.uniforms.uBlink = CAT_EYE.u.uBlink;
  sh.fragmentShader = 'uniform float uBlink;\n' + sh.fragmentShader
    .replace('#include <map_fragment>', `#include <map_fragment>
      float catLid = 0.0;
      for (int k = 0; k < 2; k++) {
        vec2 c = k == 0 ? vec2(0.4019, 0.2964) : vec2(0.4985, 0.2969), r = vec2(0.0108, 0.0162), e = (vMapUv - c) / r;
        if (dot(e, e) < 1.0) {
          float up = 1.1 - 1.95 * uBlink, lo = -1.1 + 0.45 * uBlink;
          float cover = max(smoothstep(up - 0.06, up + 0.06, e.y), 1.0 - smoothstep(lo - 0.06, lo + 0.06, e.y));
          vec3 fur = texture2D(map, vec2(c.x + (k == 0 ? -1.9 : 1.9) * r.x, vMapUv.y)).rgb * (1.0 - 0.45 * exp(-pow((e.y - up) / 0.09, 2.0)));   // its lash line darker
          diffuseColor.rgb = mix(diffuseColor.rgb, fur, cover); catLid = max(catLid, cover);
        }
      }`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 1.0, catLid);');   // a lid is not wet
}
/* ---- Zzz over the sleeping cat, drawn as the garden draws them (3d-garden: van/sleep-fx.js and the nap in
   engineer/routine-fx.js): three small cream z's with a dark halo, each rising from just over its head, swaying a
   little, growing and fading as it goes, a third of a cycle apart; here at the cat's size (rising 32 cm in 3.3 s). They
   come only while it sleeps (eyes shut, not stirring) and fade in and out. In the crisp pass, like the cat. */
const ZZZ = { grp: null, zs: [], k: 0 };
function buildZzz() {
  const c = canvas(64, 64), x = c.getContext('2d');
  x.font = 'bold 46px Outfit, system-ui, sans-serif'; x.fillStyle = '#E2D6C0'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = '#243240'; x.shadowBlur = 6; x.fillText('z', 32, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  ZZZ.grp = new THREE.Group(); ZZZ.grp.visible = false; scene.add(ZZZ.grp);
  for (let n = 0; n < 3; n++) {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false }); m.onBeforeCompile = crispPatch;
    const sp = new THREE.Sprite(m); sp.layers.set(PETS.layer); sp.frustumCulled = false; ZZZ.grp.add(sp); ZZZ.zs.push({ s: sp, ph: n / 3 });
  }
}
function stepZzz(t, dt, asleep) {
  ZZZ.k += ((asleep ? 1 : 0) - ZZZ.k) * Math.min(1, dt * 1.2); ZZZ.grp.visible = ZZZ.k > 0.01; if (!ZZZ.grp.visible) return;
  CATR.bones.head.getWorldPosition(_hp);
  for (const z of ZZZ.zs) {
    const k = (t * 0.3 + z.ph) % 1;
    z.s.position.set(_hp.x + Math.sin(t * 1.6 + z.ph * 6) * 0.025, _hp.y + 0.07 + k * 0.32, _hp.z);
    z.s.material.opacity = 0.9 * Math.min(1, (1 - k) * 2.5, k * 6) * ZZZ.k; z.s.scale.setScalar(0.035 + k * 0.065);
  }
}
/* ---- the chicken's head and neck, body and feet, moved in the vertex shader. Its mesh is baked into a frame where it
   stands on y = 0 facing +x, 0.42 m tall: head and neck are what lies above 0.26 m ahead of x = 0.02 (turning about the
   neck's base), the feet and shanks what lies under 0.13 m, each going with the shank it is nearest to (its toes spread
   both ways); the rest of the body pitches and rolls about the hips and rides up and sideways over the feet. */
const HEN = { u: { uNeck: { value: new THREE.Vector3(0.085, 0.255, 0.02) }, uHeadR: { value: new THREE.Matrix3() }, uHeadT: { value: new THREE.Vector3() },
  uHip: { value: new THREE.Vector3(0, 0.12, 0) }, uBodyR: { value: new THREE.Matrix3() }, uBodyT: { value: new THREE.Vector3() }, uFootL: { value: new THREE.Vector3() }, uFootR: { value: new THREE.Vector3() },
  uShankL: { value: new THREE.Vector2(0, 0.04) }, uShankR: { value: new THREE.Vector2(0, -0.04) }, uRestL: { value: new THREE.Vector3() }, uRestR: { value: new THREE.Vector3() } } };
PETS.hen = HEN;   // (for tests)
function henPatch(sh) {
  crispPatch(sh); Object.assign(sh.uniforms, HEN.u);
  sh.vertexShader = 'uniform vec3 uNeck, uHeadT, uHip, uBodyT, uFootL, uFootR, uRestL, uRestR; uniform mat3 uHeadR, uBodyR; uniform vec2 uShankL, uShankR;\n' + sh.vertexShader
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      float wH = smoothstep(0.26, 0.33, position.y) * smoothstep(0.02, 0.1, position.x), wF = 1.0 - smoothstep(0.08, 0.13, position.y);
      float sideL = smoothstep(-0.012, 0.012, distance(position.xz, uShankR) - distance(position.xz, uShankL));
      objectNormal = normalize(mix(objectNormal, uHeadR * objectNormal, wH)); objectNormal = normalize(mix(uBodyR * objectNormal, objectNormal, wF));`)
    .replace('#include <begin_vertex>', `vec3 transformed = position;
      vec3 foot = mix(uFootR, uFootL, sideL);   // (x ahead, y up; z: how far its toes are drawn in)
      // a foot in the air draws its toes in toward its shank (as a bird's do) and spreads them again to come down
      transformed.xz += (mix(uShankR, uShankL, sideL) - position.xz) * wF * foot.z * 0.6 * (1.0 - smoothstep(0.0, 0.035, position.y));
      // (the model stands mid-stride, its left foot 8 cm ahead of its right: each foot is first set back square under the
      // hips, rest, and the stride is taken from there)
      vec3 rest = mix(uRestR, uRestL, sideL);
      transformed += wF * clamp(1.0 - position.y / 0.13, 0.0, 1.0) * vec3(foot.x + rest.x, foot.y, rest.z);
      transformed = mix(transformed, uHeadR * (transformed - uNeck) + uNeck + uHeadT, wH);
      transformed = mix(uBodyR * (transformed - uHip) + uHip + uBodyT, transformed, wF);`);
}
const toFloat = (attr, m, normal) => {   // a (quantized) attribute as plain floats, moved by a matrix
  const out = new Float32Array(attr.count * 3), v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
  for (let i = 0; i < attr.count; i++) { v.fromBufferAttribute(attr, i); if (normal) v.applyMatrix3(nm).normalize(); else v.applyMatrix4(m); v.toArray(out, i * 3); }
  return new THREE.BufferAttribute(out, 3);
};
// fur and feathers take a soft sheen at grazing angles (a black cat keeps its shape)
function petMaterial(src, o) {
  const m = new THREE.MeshPhysicalMaterial({ map: src.map, color: src.color, roughness: 0.65, metalness: 0, transparent: src.transparent, alphaTest: src.alphaTest,
    depthWrite: src.depthWrite, side: src.side, ...o });
  if (m.map) m.map.anisotropy = 8; return m;
}
async function loadPets() {
  const [catBuf, henBuf] = await Promise.all([petBytes('cat-bin'), petBytes('hen-glb')]);
  if (!catBuf) return;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), L = PETS.layer;
  const node = (await loader.parseAsync(catBytes(catBuf), '')).scene.getObjectByName('cat');
  if (!node) return;
  // the cat: its coat (its occlusion, its roughness: the eyes and nose wet), a sheen on the black fur, lids over its eyes
  node.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false; o.layers.set(L); const src = o.material;
    const m = petMaterial(src, { normalMap: src.normalMap, normalScale: src.normalScale, aoMap: src.aoMap, aoMapIntensity: 0.75, roughnessMap: src.roughnessMap, roughness: 1,
      sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x667080), side: THREE.FrontSide, transparent: false, depthWrite: true });
    m.fog = false; m.onBeforeCompile = catPatch; o.material = m;
  });
  PETS.cat = rigCat(node);
  PETS.fur = furCoat(CATR.mesh, crispPatch);   // its coat: shells of fur over the skin (fur.js)
  const holder = new THREE.Group(); holder.add(PETS.cat); PETS.holder = holder;
  for (const k of ['day', 'night']) { const s = CAT_SPOT[k]; s.y = surfaceAt(s.x, s.z); }
  CAT_WAY.seatY = surfaceAt(...CAT_WAY.seat); SOFT.u.uDentY.value = CAT_WAY.seatY;
  PETS.catShadow = contactShadow(0.62, 0.36); room.add(PETS.catShadow); buildZzz();
  const hen = henBuf && (await loader.parseAsync(henBuf, '')).scene.getObjectByName('chicken');
  if (hen) {   // the chicken: its mesh baked into its own frame (standing on y = 0, facing +x, 0.42 m tall)
    hen.removeFromParent(); hen.updateMatrixWorld(true);
    let mesh = null; hen.traverse(o => { if (o.isMesh) mesh = o; });
    const box = new THREE.Box3().setFromObject(hen), k = HEN_AREA.h / (box.max.y - box.min.y);
    const m = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)).multiply(mesh.matrixWorld);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', toFloat(mesh.geometry.attributes.position, m)); g.setAttribute('normal', toFloat(mesh.geometry.attributes.normal, m, true));
    if (mesh.geometry.attributes.uv) g.setAttribute('uv', mesh.geometry.attributes.uv); if (mesh.geometry.index) g.setIndex(mesh.geometry.index);
    // where its two shanks come down (the toes follow the nearer one)
    const p = g.attributes.position, sh = [[0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0.04 || y > 0.09) continue; const s = sh[p.getZ(i) > 0 ? 0 : 1]; s[0] += p.getX(i); s[1] += p.getZ(i); s[2]++; }
    if (sh[0][2] && sh[1][2]) { HEN.u.uShankL.value.set(sh[0][0] / sh[0][2], sh[0][1] / sh[0][2]); HEN.u.uShankR.value.set(sh[1][0] / sh[1][2], sh[1][1] / sh[1][2]); }
    // and where its feet stand (toes and ankles): the model has them a stride apart, the left ahead; the offsets that set
    // them side by side under the hips, as far out either side
    const ft = [[0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < p.count; i++) { if (p.getY(i) > 0.035) continue; const f = ft[p.getZ(i) > 0 ? 0 : 1]; f[0] += p.getX(i); f[1] += p.getZ(i); f[2]++; }
    if (ft[0][2] && ft[1][2]) {
      const xL = ft[0][0] / ft[0][2], zL = ft[0][1] / ft[0][2], xR = ft[1][0] / ft[1][2], zR = ft[1][1] / ft[1][2], xc = (xL + xR) / 2, zw = (zL - zR) / 2;
      HEN.u.uRestL.value.set(xc - xL, 0, zw - zL); HEN.u.uRestR.value.set(xc - xR, 0, -zw - zR);
    }
    const mat = petMaterial(mesh.material, { roughness: 0.8, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffefd8) }); mat.onBeforeCompile = henPatch; mat.fog = true;
    const bird = new THREE.Mesh(g, mat); bird.frustumCulled = false; bird.layers.set(L);
    PETS.chicken = new THREE.Group(); PETS.chicken.add(bird);
    PETS.henShadow = contactShadow(0.36, 0.22); PETS.henShadow.material.fog = true; outside.add(PETS.henShadow);   // (with the garden: hidden until it is in)
    Object.assign(HEN, { x: -2.0, z: -5.0, yaw: 0.25, act: null, queue: null, t: 0, look: 0, tilt: 0, lookT: 0, tiltT: 0, phase: 0, v: 0, feet: [0, 0, 0, 0, 0, 0] });
  }
  // the room's lights light them too (they are on their own layer, which only the crisp pass sees)
  scene.traverse(o => { if (o.isLight) { o.layers.enable(L); o.layers.enable(FUR.layer); } });   // (and the cat's skin lit for its fur)
  SHARP.cam.layers.set(L);
  for (const P of [SHARP.cat, SHARP.hen]) sharpQuad(P);
  // their shaders compiled in the background (for a linear target like theirs) before they appear
  scene.add(holder); if (PETS.chicken) scene.add(PETS.chicken);
  if (renderer.compileAsync) { renderer.setRenderTarget(POST.rt); try { await renderer.compileAsync(holder, SHARP.cam, scene); if (PETS.chicken) await renderer.compileAsync(PETS.chicken, SHARP.cam, scene); } catch (e) { /* compiled on first use */ } renderer.setRenderTarget(null); }
  bindTouch(); PETS.ok = true; PETS.state = null; petsForHour(HOUR.S); setNeeds(true);
}
/* ---- the cat's life: in its place (lying, with its small life and its acts) or on its way between its places. Each
   frame its wishes are gathered (W: the pose to go toward and how fast, its legs on the ground or in the pose, its speed
   and turning, how it looks, its lids), then its body is moved by them (moveCat). */
const CAT = { mode: 'still', place: 'day', seq: null, G: null, v: 0, ikW: 0, lid: 0, look: null, blinkT: 3, blinkK: 0, slow: 0, earT: [1, 2.5], ear: [0, 0],
  tailT: 2, kick: 0, lashP: 0, sigh: 0, sighT: 20, glance: 0, glanceT: 6, actT: 20, huntT: 30, twitchT: 30, prev: null,
  sleep: 'light', sleepT: 45 };   // (asleep: dozing in a ball first, then deeply on its side, sleepT seconds later)
const sleepPose = () => CAT.sleep === 'deep' ? 'curl' : 'nest';
PETS.CAT = CAT; PETS.act = k => dayActs(k);   // (for tests: an act can be started by hand)
const rnd = (a, b) => a + (b - a) * Math.random();
const ease = k => k * k * (3 - 2 * k), angTo = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const W = {};
function wishes() { Object.assign(W, { pose: 'stand', half: 0.3, ik: false, v: 0, w: 0, dy: 0, pitch: 0, roll: 0, look: null, lookK: 0, lid: null, sway: 0, hindUp: 0, knead: -1, wiggle: 0, ears: 0, walk: 0, lick: 0, wipe: 0, lash: 0, lashF: 1.3 }); }
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _hp = new THREE.Vector3(), _ax = new THREE.Vector3(), _e3 = new THREE.Euler(), _UP = new THREE.Vector3(0, 1, 0);
const henHead = v => v.set(HEN.x + Math.cos(HEN.yaw) * 0.12, 0.25, HEN.z - Math.sin(HEN.yaw) * 0.12);
const henBusy = () => !!(PETS.chicken && PETS.chicken.visible && HEN.act && /peck|scratch/.test(HEN.act.kind));
// a sequence of steps: each runs every frame (with how far through it is, 0..1) until its time is up or it says it is done
function play(steps, then) { CAT.seq = { steps, i: 0, t: 0, then }; }
function stepSeq(dt) {
  const S = CAT.seq, st = S.steps[S.i]; if (!st) { CAT.seq = null; if (S.then) S.then(); return; }
  S.t += dt; const k = st.dur ? Math.min(1, S.t / st.dur) : 0;
  const done = st.run(k, dt, st, S.t);
  if (done || (st.dur && S.t >= st.dur)) { S.i++; S.t = 0; }
}
const at = (x, y, z, yaw, sink = 0) => { const G = CAT.G || (CAT.G = { phase: 0, feet: null }); Object.assign(G, { x, y: y - sink, z, yaw, sink }); };   // (sink: how far below the surface it is pressed in)
// the steps it is made of
const stay = (pose, dur, o = {}) => ({ dur, run: k => { W.pose = pose; W.half = o.half || 0.3; W.ik = !!o.ik; W.lid = o.lid === undefined ? null : o.lid; if (o.look) { W.look = o.look(); W.lookK = 1; } } });
const walkTo = (x, z) => ({ run: (k, dt) => {   // there at a walk: speeding up and slowing down as a body does, turning as it goes
  const G = CAT.G, dx = x - G.x, dz = z - G.z, d = Math.hypot(dx, dz), turn = angTo(G.yaw, Math.atan2(dx, dz));
  const want = Math.min(CGAIT.vref, Math.sqrt(2 * 0.8 * Math.max(0, d - 0.008))) * Math.max(0, Math.cos(turn)) ** 2;
  CAT.v += Math.max(-1.0 * dt, Math.min(0.6 * dt, want - CAT.v));
  const w = Math.sign(turn) * Math.min(Math.abs(turn) * 3.5, 2.2); G.yaw += w * dt;
  G.x += Math.sin(G.yaw) * CAT.v * dt; G.z += Math.cos(G.yaw) * CAT.v * dt;
  Object.assign(W, { pose: 'stand', ik: true, v: CAT.v, w, walk: Math.min(1, CAT.v / 0.15) });
  W.look = _w.set(G.x + Math.sin(G.yaw) * 0.6, G.y - 0.02, G.z + Math.cos(G.yaw) * 0.6); W.lookK = 0.8;   // its eyes on the floor ahead, its head held steady
  if (d < 0.015 && CAT.v < 0.04) { CAT.v = 0; return true; }
} });
const turnTo = target => ({ run: (k, dt) => {   // round on the spot, stepping, to a heading or toward a point
  const G = CAT.G, yaw = typeof target === 'number' ? target : Math.atan2(target[0] - G.x, target[1] - G.z), d = angTo(G.yaw, yaw);
  const w = Math.sign(d) * Math.min(1.7, Math.abs(d) * 4 + 0.15); G.yaw += Math.abs(w * dt) > Math.abs(d) ? d : w * dt;
  Object.assign(W, { pose: 'stand', ik: true, w: Math.abs(d) > 0.02 ? w : 0 }); return Math.abs(d) < 0.02;
} });
const gauge = (p, dur) => ({ dur, run: (k, dt, st, t) => {   // it looks at where it will jump, its head bobbing to judge it
  Object.assign(W, { pose: 'stand', ik: true, dy: -0.006 });
  W.look = _w.set(p[0], p[1] + 0.025 * Math.sin(Math.PI * 2 * 1.7 * t) * Math.min(1, t * 3), p[2]); W.lookK = 1; W.ears = 1;
} });
const gather = (dur, depth) => ({ dur, run: k => { const e = ease(k); Object.assign(W, { pose: 'stalk', ik: true, dy: -depth * e, pitch: -0.08 * e, half: 0.2 }); W.ears = 1; } });
const leap = (to, T) => ({ run: (k, dt, st, t) => {   // ballistic: up as much faster as it has to rise, g pulling it back down
  const G = CAT.G; if (!st.s) { if (G.y > 0.2) DENT.body.v += 0.28; st.s = { x: G.x, y: G.y, z: G.z }; st.vy = (to[1] - G.y + 4.905 * T * T) / T; st.vh = Math.hypot(to[0] - G.x, to[2] - G.z) / T; G.yaw = Math.atan2(to[0] - G.x, to[2] - G.z); }
  const u = Math.min(T, t), q = u / T; G.x = st.s.x + (to[0] - st.s.x) * q; G.z = st.s.z + (to[2] - st.s.z) * q; G.y = st.s.y + st.vy * u - 4.905 * u * u;
  Object.assign(W, { pose: 'air', half: 0.07, pitch: -Math.atan2(st.vy - 9.81 * u, st.vh) * 0.5 });
  W.look = _w.set(to[0], to[1], to[2]); W.lookK = 0.8;
  if (t >= T) { G.y = to[1]; G.sink = 0; G.feet = null; if (to[1] > 0.2) DENT.body.v += 0.55; delete st.s; return true; }   // (landing on the cushion: it gives)
} });
// the cushion under the cat (velvet.js SOFT), as a seat cushion gives (G, 17/10/2026: "do research và tăng độ lún mềm của
// sofa khi mèo tương tác"). A seat cushion's foam is rated by the force (IFD, ASTM D3574) that presses 10 cm of it down by
// a quarter under a 50 in² plate: some 20 to 40 lbf for a seat; the layers over the core softer, a feather wrap softest.
// - Lying, a hollow the shape of its body (an ellipse along it, round as it curls), ~3 cm. A 4.5 kg cat over ~0.04 m²
//   is ~1.1 kPa, a third of what takes an IFD 25 core down by a quarter (3.4 kPa): ~8 % of 10 cm. The feather wrap over
//   it gives about half of its ~4 cm.
// - Standing, walking, kneading: each paw its own deep, narrow print, a forepaw's ~3 cm and a hind paw's ~2.4. The
//   forelimbs carry 48–62 % of a cat's weight (pressure walkways: Schnabl-Feichter et al. 2017); ~12 N on a few cm² of
//   pad crushes the soft wrap. The body only sags the cover between them. A paw lifted lets its print go where it was,
//   and the cat stands as deep as its paws are in (give).
// - Sitting: the haunches' hollow and the forepaws'.
// - Each a damped spring: the body's bounces a little as the cat lands, the paws' are quicker.
// - Where it lay a while, a third of the hollow stays when it gets up, going over ~20 s: a feather wrap keeps to a
//   favourite spot until it is plumped.
// The room is drawn again only while a hollow moves.
const FEET_D = ['lf', 'rf', 'lh', 'rh'];
const DENT = { body: { x: 0, z: 0, ca: 1, sa: 0, ra: 0.16, rb: 0.12, d: 0, v: 0 }, imp: { x: 0, z: 0, ca: 1, sa: 0, ra: 0.16, rb: 0.12, d: 0 },
  paws: FEET_D.map(f => ({ f, x: 0, z: 0, r: f.endsWith('f') ? 0.055 : 0.05, d: 0, v: 0 })), lyingT: 0, give: 0, sig: '' };
PETS.dent = DENT; PETS.soft = SOFT;   // (for tests)
const _dh = new THREE.Vector3(), _dc = new THREE.Vector3(), _dp = new THREE.Vector3(), _dt = new THREE.Vector3();
function padAt(L, out) {   // where a paw's pad is (world): the hind's toe, a forepaw's ball (60 % of the way to the paw bone's tip, as cat.js has it)
  if (L.toe) return L.toe.getWorldPosition(out);
  L.end.getWorldPosition(out); _dt.set(0, L.end.userData.len, 0).applyMatrix4(L.end.matrixWorld);
  return out.lerp(_dt, 0.6);
}
function spring(o, goal, w2, c, dt) { for (let n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n, i = 0; i < n; i++) { o.v += (w2 * (goal - o.d) - c * o.v) * h; o.d = Math.max(0, o.d + o.v * h); } if (Math.abs(o.d - goal) < 1e-5 && Math.abs(o.v) < 1e-4) { o.d = goal; o.v = 0; } }
function stepDent(dt) {
  const hp = PETS.holder.position, pose = W.pose || '', on = PETS.holder.visible && hp.y > 0.2 && pose !== 'air';
  const lying = /curl|nest|side|sphinx|loaf/.test(pose), sitting = /sit|lick|wipe/.test(pose), B = DENT.body, Bn = CATR.bones;
  // the body: where its hips and chest are, and the hollow's shape for the pose
  let goal = 0;
  if (on && Bn.hips && Bn.chest) {
    Bn.hips.getWorldPosition(_dh); Bn.chest.getWorldPosition(_dc);
    const ax = _dc.x - _dh.x, az = _dc.z - _dh.z, len = Math.hypot(ax, az) || 1, k = B.d < 1e-4 ? 1 : 1 - Math.exp(-dt / 0.08);
    let x = (_dh.x + _dc.x) / 2, z = (_dh.z + _dc.z) / 2, ra, rb;
    if (lying) { goal = 0.03; if (/curl|nest/.test(pose)) ra = rb = 0.187; else if (pose === 'side') { ra = len / 2 + 0.14; rb = 0.143; } else { ra = len / 2 + 0.11; rb = 0.132; } }   // (the cat 10 % larger: G, 17/10/2026)
    else if (sitting) { goal = 0.026; x = _dh.x; z = _dh.z; ra = rb = 0.132; }
    else { goal = 0.006; ra = len / 2 + 0.08; rb = 0.1; }
    B.x += (x - B.x) * k; B.z += (z - B.z) * k; B.ca += (ax / len - B.ca) * k; B.sa += (az / len - B.sa) * k; B.ra += (ra - B.ra) * k; B.rb += (rb - B.rb) * k;
    const n = Math.hypot(B.ca, B.sa) || 1; B.ca /= n; B.sa /= n;
  }
  spring(B, goal, 504, 13.5, dt);
  // where it lay a while: an imprint stays as it gets up, going slowly
  const I = DENT.imp;
  if (on && lying) DENT.lyingT += dt;
  else { if (DENT.lyingT > 5 && B.d > 0.01) { Object.assign(I, { x: B.x, z: B.z, ca: B.ca, sa: B.sa, ra: B.ra, rb: B.rb }); I.d = Math.max(I.d, 0.32 * B.d); } DENT.lyingT = 0; }
  I.d = I.d > 1e-4 ? I.d * Math.exp(-dt / 18) : 0;
  // the paws: each bearing on the cushion presses its own print (not while it lies: they are tucked under it)
  const ground = CAT_WAY.seatY - DENT.give; let gs = 0, gw = 0; DENT.pose = pose;   // (pose, and each paw's h: its pad's height over the cushion, for tests)
  for (const P of DENT.paws) {
    const L = CATR.legs && CATR.legs[P.f]; let c = 0;
    if (on && L && !lying && !(sitting && L.hind)) { padAt(L, _dp); P.h = _dp.y - ground; c = 1 - THREE.MathUtils.smoothstep(P.h, 0.015, 0.035); if (c > 0.25) { const kk = 1 - Math.exp(-dt / 0.03); P.x += (_dp.x - P.x) * (P.d < 1e-4 ? 1 : kk); P.z += (_dp.z - P.z) * (P.d < 1e-4 ? 1 : kk); } }
    spring(P, c * (L && !L.hind ? (sitting ? 0.026 : 0.03) : 0.024), 900, 36, dt);
    if (c > 0) { gs += P.d * c; gw += c; }
  }
  // how deep it stands: its paws in their prints (sitting: its haunches in theirs)
  const giveT = !on || lying ? 0 : sitting ? 0.8 * B.d : gw > 0 ? 0.85 * gs / gw : DENT.give;
  DENT.give += (giveT - DENT.give) * Math.min(1, dt / 0.05);
  const U = SOFT.u; U.uDentB.value.set(B.x, B.z, B.d, 0); U.uDentA.value.set(B.ca, B.sa, B.ra, B.rb); U.uDentI.value.set(I.x, I.z, I.d, 0); U.uDentIA.value.set(I.ca, I.sa, I.ra, I.rb);
  DENT.paws.forEach((P, i) => U.uPaw.value[i].set(P.x, P.z, P.r, P.d));
  const sig = [B.d, B.x, B.z, B.ra, I.d, ...DENT.paws.flatMap(P => [P.d, P.x, P.z])].map(v => Math.round(v * 500)).join(',');   // (2 mm steps)
  if (sig !== DENT.sig) { DENT.sig = sig; setNeeds(true); }
}
const touch = dur => ({ dur, run: k => {   // forepaws first, elbows giving, then the hind paws
  Object.assign(W, { pose: 'stand', half: 0.1, ik: true, pitch: 0.2 * (1 - ease(Math.min(1, k * 1.7))), dy: -0.028 * Math.sin(Math.PI * Math.min(1, k * 1.25)), hindUp: Math.max(0, 1 - k * 3.2) });
} });
const knead = dur => ({ dur, run: (k, dt, st, t) => {   // treading the cushion, paw by paw, eyes half shut
  Object.assign(W, { pose: 'stand', ik: true, dy: -0.01, lid: 0.55, knead: t * 1.6, sway: 0.004 * Math.sin(Math.PI * 2 * 0.8 * t) });
} });
const circle = (turns, dur) => ({ dur, run: (k, dt, st) => {   // round on the spot before lying down
  const G = CAT.G; if (st.y0 === undefined) st.y0 = G.yaw; const y = st.y0 + turns * Math.PI * 2 * ease(k);
  const w = (y - G.yaw) / Math.max(dt, 1e-4); G.yaw = y; Object.assign(W, { pose: 'stand', ik: true, w }); if (k >= 1) delete st.y0;
} });
const lieDown = (pose, spot, dur) => ({ dur, run: (k, dt, st) => {   // down into a pose, easing onto its spot (and into the cushion)
  const G = CAT.G; if (!st.s) st.s = { x: G.x, y: G.y, z: G.z, yaw: G.yaw, sink: G.sink || 0 };
  const e = ease(k); G.x = st.s.x + (spot.x - st.s.x) * e; G.z = st.s.z + (spot.z - st.s.z) * e; G.yaw = st.s.yaw + angTo(st.s.yaw, spot.yaw) * e;
  G.y = st.s.y + (spot.y - spot.sink - st.s.y) * e; G.sink = (st.s.sink || 0) + (spot.sink - (st.s.sink || 0)) * e;
  Object.assign(W, { pose, half: 0.32, lid: /curl|nest/.test(pose) ? Math.min(1, k * 1.4) : null }); if (k >= 1) delete st.s;
} });
const groomSteps = () => [   // sitting up to wash: a forepaw licked, drawn over the face, licked again
  stay('sit', 1.3, { half: 0.3 }),
  { dur: 2.4, run: (k, dt, st, t) => { Object.assign(W, { pose: 'lick', half: 0.18, lid: 0.35 }); W.lick = Math.sin(Math.PI * 2 * 3 * t); } },
  { dur: 2.2, run: (k, dt, st, t) => { Object.assign(W, { pose: 'wipe', half: 0.16, lid: 0.6 }); W.wipe = Math.sin(Math.PI * 2 * 1.4 * t); } },
  { dur: 1.2, run: (k, dt, st, t) => { Object.assign(W, { pose: 'lick', half: 0.18, lid: 0.35 }); W.lick = Math.sin(Math.PI * 2 * 3 * t); } },
  stay('sit', 0.9, { half: 0.25 }),
];
function dayActs(kind) {   // what it may do by day: wash, or (the hen pecking near) stalk it until the glass stops it
  const s = CAT_SPOT.day, back = () => { CAT.actT = rnd(30, 70); };
  if (kind === 'hunt' || (!kind && henBusy() && CAT.huntT <= 0 && Math.random() < 0.6)) {
    CAT.huntT = rnd(60, 120); at(s.x, s.y, s.z, s.yaw); CAT.G.feet = null;
    play([stay('stand', 1.0, { half: 0.22 }),
      { dur: 1.2, run: k => { Object.assign(W, { pose: 'stalk', ik: true, dy: -0.038 * ease(k), pitch: 0.06 * ease(k), lid: 0 }); W.look = henHead(_w); W.lookK = 1; W.ears = 1; W.lash = 1; } },
      { dur: 1.7, run: (k, dt, st, t) => { Object.assign(W, { pose: 'stalk', ik: true, dy: -0.038, pitch: 0.06, wiggle: Math.sin(Math.PI * 2 * 3.4 * t) * Math.sin(Math.PI * k), lid: 0 }); W.look = henHead(_w); W.lookK = 1; W.ears = 1; W.lash = 1; } },
      { dur: 1.3, run: k => { Object.assign(W, { pose: 'stalk', ik: true, dy: -0.038 * (1 - ease(k)), pitch: 0.06 * (1 - k) }); W.look = henHead(_w); W.lookK = 1; W.ears = 1; } },
      ...groomSteps().slice(0, 2), stay('sit', 0.6), stay('sphinx', 1.5, { half: 0.35 })], back);
  } else play([...groomSteps(), stay('sphinx', 1.5, { half: 0.35 })], back);
}
function nightActs() {   // asleep: now and then it lifts its head, looks about, and settles again
  CAT.actT = rnd(40, 90);
  play([{ dur: 4.2, run: k => { W.pose = sleepPose(); W.lid = k < 0.15 ? 1 - k / 0.15 * 0.6 : k > 0.75 ? 0.4 + (k - 0.75) / 0.25 * 0.6 : 0.4;
    W.look = _w.copy(camera.position); W.lookK = Math.sin(Math.PI * Math.min(1, k * 1.25)) * 0.35; W.ears = 0.6; } }]);   // (a half-raised head, curled as it is)
}
// by day on the floor (and the chicken outside), by night asleep on the chaise (the chicken has gone to roost)
function petsForHour(S) {
  if (!PETS.ok) return;
  const state = S.n > 0.5 ? 'night' : 'day'; if (state === PETS.state) return;
  const first = PETS.state === null; PETS.state = state;
  if (PETS.chicken) PETS.chicken.visible = PETS.henShadow.visible = state === 'day' && !PETS.henAway;
  if (CAT.mode === 'trip') settle(state === 'night' ? 'day' : 'night');   // already on its way the other way: there at once, then off again
  if (first || reduceMotion || !on || document.hidden) settle(state); else startTrip(state);
  setShadowsDirty(true); setNeeds(true);
}
function settle(state, soft) {   // in its place for that time of day (at once, unless it has just got there)
  const s = CAT_SPOT[state]; CAT.mode = 'still'; CAT.place = state; CAT.seq = null; CAT.v = 0;
  at(s.x, s.y, s.z, s.yaw, s.sink); CAT.G.feet = null;
  if (state === 'night') { CAT.sleep = 'light'; CAT.sleepT = rnd(35, 55); }   // (asleep in a ball first, on its side later)
  if (!soft) { catSnap(CATR.poses[state === 'night' ? 'nest' : 'sphinx']); CAT.lid = state === 'night' ? 1 : 0; CAT.ikW = 0; }
  PETS.holder.position.set(s.x, s.y, s.z); PETS.holder.rotation.set(0, s.yaw, 0); PETS.holder.updateMatrixWorld(true);
  Object.assign(CAT, { look: null, actT: rnd(14, 26), huntT: rnd(10, 30), prev: null });
}
/* ---- its way between its places */
function startTrip(to) {
  const from = to === 'night' ? 'day' : 'night', S0 = CAT_SPOT[from], S1 = CAT_SPOT[to], F = CAT_WAY.floor, Sx = CAT_WAY.seat, sy = CAT_WAY.seatY;
  at(S0.x, S0.y, S0.z, S0.yaw, S0.sink);
  CAT.mode = 'trip'; CAT.G.feet = null;
  const seat = [Sx[0], sy + 0.04, Sx[1]];
  const steps = to === 'night'
    ? [{ dur: 0.9, run: k => { W.pose = 'sphinx'; W.lid = 0; W.look = _w.set(F[0], 0.3, F[1]); W.lookK = ease(k); } },   // awake: it looks over to the sofa
       stay('stand', 1.0, { half: 0.24 }), stay('bow', 1.6, { half: 0.3, lid: 0.5 }), stay('stand', 0.7, { half: 0.25 }),
       walkTo(F[0], F[1]), turnTo(Sx), gauge(seat, 1.1), gather(0.4, 0.034), leap([Sx[0], sy, Sx[1]], 0.42), touch(0.42),
       knead(2.8), circle(1.15, 2.4), lieDown('sphinx', S1, 1.2), lieDown('nest', S1, 1.8)]   // down onto its belly, then curled up in a ball (later onto its side)
    : [{ dur: 1.0, run: k => { W.pose = sleepPose(); W.lid = 1 - ease(k); W.look = _w.set(F[0], 0.2, F[1]); W.lookK = ease(k) * 0.35; } },   // eyes open, head up
       stay('sphinx', 1.0, { half: 0.28 }), stay('stand', 1.1, { half: 0.26 }),   // over onto its belly, then up stay('bow', 1.5, { half: 0.3, lid: 0.5 }), stay('stand', 0.6, { half: 0.25 }),
       turnTo(F), gauge([F[0], 0, F[1]], 0.6), gather(0.28, 0.02), leap([F[0], 0, F[1]], 0.36), touch(0.42),
       walkTo(S1.x, S1.z), turnTo(S1.yaw), lieDown('sphinx', S1, 1.5)];
  play(steps, () => settle(to, true));
}
/* ---- the pointer (G, 17/10/2026: "do research cat behaviour khi hover chuột vào"). What a cat does when a hand, or
   something small that moves, comes near it, from what has been watched and measured of cats:
   - It turns to it first: its ears swivel toward it, then its head and eyes follow it (a cat's ears turn to what it
     hears even while it dozes).
   - Something small darting about near it is prey: its eyes lock on it, its ears go forward and the tip of its tail
     twitches; kept up, it bats at it with a forepaw from where it lies, and kept up still it gets up into a crouch, its
     haunches wiggling as it sets its hind feet, and strikes (the hunt's stare, stalk and pounce, which cats play
     through with toys they know are not alive).
   - A hand by its face it sniffs, its head stretched out to it and its ears forward, then rubs, its cheek and the side
     of its head pushed along it, eyes half shut (rubbing leaves the scent of the glands there on a friend). Cats are
     best touched round the cheeks and between the eyes and ears (Soennichsen & Chamove 2002; Ellis et al. 2015). Held
     still by its face a while, it narrows its eyes slowly at it: the slow blink, a friendly sign cats give and answer
     (Humphrey et al. 2020).
   - Stroked along the back it half shuts its eyes. But stroking adds up, fastest at the base of the tail and on the
     legs (where cats like being touched least: Ellis et al. 2015): its tail begins to swish, then lashes, faster; its
     skin twitches; its ears turn back and flatten; its eyes open and it turns its head quickly to the hand; and if the
     stroking goes on, it bats at it (the signs of petting-induced aggression, in the order shelters list them). Then
     it turns away, washes, and pays the hand no attention for a while.
   - Asleep it keeps listening: an ear swivels to the pointer and flicks, the tip of its tail flicks; held on it a while
     it opens its eyes a slit, lifts its head to look, blinks slowly and settles again. From deep sleep it first comes
     up into a doze, curled up again.
   What is under the pointer is found on the cat's own skinned mesh (965 vertices, as posed this frame): the part is the
   bone its hit corners hang on most. */
const TOUCH = { x: 0, y: 0, in: false, moved: 0, speed: 0, ndc: new THREE.Vector2(), ray: new THREE.Raycaster(), p: new THREE.Vector3(), near: 0, on: null, headC: null,
  awake: false, onT: 0, offT: 9, restT: 0, prey: 0, preyN: 0, over: 0, sniff: 0, rub: 0, rubBlink: false, wake: 0, away: 0, cool: 0, twitch: 0, twitchT: 0, earT: 0, swiv: 0, flat: 0, swat: null, active: false };
PETS.touch = TOUCH; PETS.swat = r => swatAt(r);   // (for tests)
const T_PART = n => /^(head|neck|ear)/.test(n) ? 'head' : /^tail[12]$/.test(n) ? 'base' : /^tail/.test(n) ? 'tail' : /^(arm|fore|paw|thigh|shin|foot|toe)/.test(n) ? 'leg' : 'back';
const T_OVER = { head: 0.025, back: 0.085, leg: 0.12, base: 0.22, tail: 0.15 };   // how fast stroking there adds up (a second of it)
const _tv = new THREE.Vector3(), _tf = new THREE.Vector3(), _tl = new THREE.Vector3(), _tu = new THREE.Vector3(), _tq = new THREE.Quaternion(), _tpl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function bindTouch() {
  TOUCH.ray.layers.set(PETS.layer);   // (the cat is on its own layer)
  CANVAS.addEventListener('pointermove', e => {   // (where it is on the canvas read here, as picking does, not every frame: that would force a layout)
    const T = TOUCH, r = CANVAS.getBoundingClientRect(); if (T.in) T.moved += Math.hypot(e.clientX - T.x, e.clientY - T.y);
    T.x = e.clientX; T.y = e.clientY; T.in = true; T.ndc.set((T.x - r.left) / r.width * 2 - 1, -((T.y - r.top) / r.height) * 2 + 1);
  }, { passive: true });
  CANVAS.addEventListener('pointerleave', () => { TOUCH.in = false; });
}
function senseTouch(dt) {   // where the pointer is: how fast it moves, how near the cat's head it passes, what part of it is under it
  const T = TOUCH, m = CATR.mesh, B = CATR.bones;
  T.speed += (T.moved / Math.max(dt, 1e-3) - T.speed) * Math.min(1, dt / 0.1); T.moved = 0;   // (screen px a second, over a tenth)
  if (!T.headC) {   // the middle of its head in the head's own frame (the head's joint is at the back of the skull)
    const J = m.geometry.attributes.skinIndex, Wt = m.geometry.attributes.skinWeight, c = new THREE.Vector3(); let n = 0;
    for (let i = 0; i < J.count; i++) { let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = Wt.getComponent(i, k); if (w > bw) { bw = w; best = J.getComponent(i, k); } }
      if (/^(head|ear)/.test(m.skeleton.bones[best].name)) { c.add(m.getVertexPosition(i, _tv).applyMatrix4(m.matrixWorld)); n++; } }
    T.headC = c.divideScalar(Math.max(n, 1)).applyMatrix4(_m4.copy(B.head.matrixWorld).invert());
  }
  T.on = null; T.near = 0;
  if (!T.in || !PETS.holder.visible) return;
  T.ray.setFromCamera(T.ndc, camera);
  const hc = _tv.copy(T.headC).applyMatrix4(B.head.matrixWorld);
  T.ray.ray.closestPointToPoint(hc, T.p);   // what it looks at: the pointer's line where it passes nearest its head
  T.near = 1 - THREE.MathUtils.smoothstep(T.p.distanceTo(hc), 0.1, 0.75);
  if (T.near > 0.15) {
    m.computeBoundingSphere();   // (as it is posed now)
    const hit = T.ray.intersectObject(m, false)[0];
    if (hit) {
      const J = m.geometry.attributes.skinIndex, Wt = m.geometry.attributes.skinWeight, f = hit.face; let best = 0, bw = -1;
      for (const i of [f.a, f.b, f.c]) for (let k = 0; k < 4; k++) { const w = Wt.getComponent(i, k); if (w > bw) { bw = w; best = J.getComponent(i, k); } }
      T.on = T_PART(m.skeleton.bones[best].name);
    }
  }
}
function slowBlink() { if (CAT.blinkK > 0) return; CAT.blinkK = 1e-3; CAT.slow = true; CAT.blinkT = rnd(4, 8); }
const lookP = k => { if (TOUCH.in) { W.look = _w.copy(TOUCH.p); W.lookK = k; } };
// what the pointer makes it wish for, on top of what it is doing (only in its place and doing nothing else: on its way,
// washing or after the chicken it keeps to that, though its ears still turn)
function touchWishes(dt, night) {
  const T = TOUCH, free = CAT.mode === 'still' && !CAT.seq, on = T.on, clamp = THREE.MathUtils.clamp;
  T.awake = free && !night && !reduceMotion; T.cool = Math.max(0, T.cool - dt); T.away = Math.max(0, T.away - dt);
  if (on) { T.onT += dt; T.offT = 0; } else { T.offT += dt; if (T.offT > 0.5) { T.onT = 0; T.sniff = 0; } }
  if (!on && T.near <= 0.4) T.wake = T.wake > 0 ? Math.max(0, T.wake - 0.25 * dt) : Math.min(0, T.wake + 0.3 * dt);   // (left alone it settles: the urge to wake goes, and after a rousing, the reluctance)
  T.restT = T.in && T.speed < 30 && T.near > 0.5 && !on ? T.restT + dt : Math.min(T.restT, 0) + dt;   // (negative: a while since its last slow blink)
  const stroking = !!on && T.speed > 40 && T.speed < 1100, fast = !on && T.speed > 520 && T.near > 0.15;
  T.prey = clamp(T.prey + (fast ? 1.3 : -0.45) * dt, 0, 3);
  T.over = clamp(T.over + (stroking ? T_OVER[on] : on ? -0.01 : -0.07) * dt, 0, 1);
  if (!stroking || on !== 'head') T.rub = Math.max(0, T.rub - dt * 1.5);
  T.active = T.near > 0.05 || T.prey > 0.02 || T.over > 0.02 || T.rub > 0.01 || !!T.swat;
  if (!T.active || reduceMotion) return;
  if (night) { touchAsleep(dt, free); return; }
  if (!free) return;
  // its eyes on it (unless it has had enough of it)
  if (T.away <= 0 && (on || T.near > 0.35 || (T.near > 0.1 && T.speed > 60) || T.prey > 0.3)) { lookP(1); W.ears = T.prey > 0.3 ? 1 : 0.5; }
  // prey: eyes wide on it, the tail's tip twitching (idleLife); a bat at it, and kept up, the crouch and the strike
  if (T.prey > 0.3) W.lid = 0;
  if (T.prey > 1.5 && T.cool <= 0 && !T.swat) {
    T.cool = 1.7; T.preyN++;
    if (T.preyN >= 3 && T.prey > 2.2) { T.preyN = 0; pounceAct(); return; }
    swatAt();
  }
  if (T.prey < 0.05) T.preyN = 0;
  // a hand by its face: sniffed, then rubbed; and when the rubbing has settled, a slow blink
  if (on === 'head' && T.speed < 400 && T.away <= 0 && T.over < 0.5) {
    T.sniff += dt; W.ears = 1;
    if (T.sniff > 0.8) { T.rub = Math.min(1, T.rub + dt * 2); W.lid = 0.55; }
    if (T.rub > 0.6 && !T.rubBlink) { T.rubBlink = true; slowBlink(); }
  } else if (T.rub < 0.05) T.rubBlink = false;
  // stroked: content, until it adds up
  if (stroking && on !== 'head' && T.over < 0.35) W.lid = 0.45;
  if (T.over > 0.35) { W.lash = THREE.MathUtils.smoothstep(T.over, 0.35, 0.8) * 1.3; W.lashF = 1.2 + 1.8 * T.over; }
  if (T.over > 0.5) {
    T.twitchT -= dt; if (T.twitchT <= 0) { T.twitch = 1; T.twitchT = rnd(0.7, 1.6) * (1.4 - T.over); }
    W.lid = 0; if (T.away <= 0) { lookP(1); W.ears = 0; }
  }
  if (T.over > 0.88 && stroking && T.cool <= 0 && !T.swat) {   // enough: a bat at the hand, then it turns away and washes
    swatAt(); T.cool = 3; T.over = 0.55; T.away = 6;
    play([stay('sphinx', 0.7, { half: 0.25 }), ...groomSteps().slice(0, 3), stay('sphinx', 1.2, { half: 0.35 })], () => { CAT.actT = rnd(25, 50); });
  }
  // the pointer held still by its face (not on it), calm: now and then it narrows its eyes slowly at it
  if (T.restT > 1.4 && T.prey < 0.2 && T.over < 0.3) { slowBlink(); T.restT = -rnd(5, 9); }
}
function touchAsleep(dt, free) {   // asleep: listening to it, and roused by it a little
  const T = TOUCH, deep = CAT.sleep === 'deep';
  T.earT -= dt * (T.near * (T.speed > 30 ? 1 : 0.35) + (T.on ? 0.8 : 0));   // (an ear flicks to it, oftener the nearer it is and the more it moves)
  if (T.earT <= 0) { CAT.ear[T.swiv > 0 ? 0 : 1] = 1; T.earT = deep ? rnd(1.6, 3.2) : rnd(0.8, 2); if (Math.random() < 0.35) CAT.kick = (Math.random() < 0.5 ? -1 : 1) * 0.3; }
  if (!free) { T.wake = Math.min(T.wake, 0); return; }   // (roused, or rolling over: it starts again from there)
  if (T.on || T.near > 0.4) T.wake = Math.min(2, T.wake + (T.on ? (deep ? 0.35 : 0.7) : 0.12) * dt);
  if (deep && T.wake > 1) {   // up from deep sleep into a doze, curled up again
    CAT.sleep = 'light'; CAT.sleepT = rnd(35, 55); T.wake = 0.6;
    play([{ dur: 2.6, run: () => { Object.assign(W, { pose: 'nest', half: 0.6, lid: 1 }); } }]);
  } else if (!deep && T.wake > 1.3) { T.wake = -1.5; rouse(); }   // (and a while before it rouses again)
}
function rouse() {   // dozing, touched a while: its eyes open a slit, its head comes up to look, a slow blink, and down again
  CAT.actT = Math.max(CAT.actT, rnd(25, 45));
  play([{ dur: 9, run: (k, dt, st, t) => {
    const T = TOUCH, there = T.in && (!!T.on || T.near > 0.3); W.pose = sleepPose();
    if (!st.end && ((!there && t > 2.4) || t > 6.5)) st.end = t;   // (the pointer gone, or long enough)
    const out = st.end ? Math.min(1, (t - st.end) / 1.4) : 0, up = Math.min(1, t / 0.9) * (1 - out);
    W.lid = 1 - 0.5 * up; if (there) lookP(0.42 * up); else { W.look = _w.copy(camera.position); W.lookK = 0.42 * up; } W.ears = 0.7 * up;
    if (t > 1.7 && !st.blink) { st.blink = true; slowBlink(); }
    return out >= 1;
  } }]);
}
function pounceAct() {   // prey kept up: up into a crouch, eyes on it, haunches wiggling, a strike at it; then it sits and washes
  TOUCH.prey = 0.6; TOUCH.cool = 5; CAT.huntT = Math.max(CAT.huntT, 20);
  play([stay('stand', 0.6, { half: 0.2 }),
    { dur: 0.8, run: k => { Object.assign(W, { pose: 'stalk', ik: true, dy: -0.038 * ease(k), pitch: 0.06 * ease(k), lid: 0 }); lookP(1); W.ears = 1; W.lash = 1; } },
    { dur: 1.1, run: (k, dt, st, t) => { Object.assign(W, { pose: 'stalk', ik: true, dy: -0.038, pitch: 0.06, wiggle: Math.sin(Math.PI * 2 * 3.4 * t) * Math.sin(Math.PI * k), lid: 0 }); lookP(1); W.ears = 1; W.lash = 1; } },
    { dur: 0.6, run: (k, dt, st) => { if (!st.go) { st.go = true; swatAt(0.3); } Object.assign(W, { pose: 'stalk', ik: true, dy: -0.03, pitch: 0.03 }); lookP(1); W.ears = 1; if (k >= 1) st.go = false; } },
    { dur: 1.0, run: k => { Object.assign(W, { pose: 'stalk', ik: true, dy: -0.038 * (1 - ease(k)), pitch: 0.06 * (1 - k) }); lookP(0.8); } },
    ...groomSteps().slice(0, 2), stay('sit', 0.5), stay('sphinx', 1.5, { half: 0.35 })], () => { CAT.actT = rnd(30, 70); });
}
function swatAt(reach = 0.22) {   // a bat with the forepaw on the pointer's side: up and out to where it is, a moment there, back (claws in: play)
  const T = TOUCH, G = CAT.G; if (!G) return;
  const y = G.y - DENT.give + 0.045; _tpl.constant = -y;   // (a plane just over what it lies on)
  const p = T.ray.ray.intersectPlane(_tpl, _tv) || _tv.copy(T.p).setY(y);
  const fx = Math.sin(G.yaw), fz = Math.cos(G.yaw), lx = fz, lz = -fx;   // its forward and its left
  const f = (p.x - G.x) * lx + (p.z - G.z) * lz > 0 ? 'lf' : 'rf', A = CATR.legs[f].up.getWorldPosition(_tu);
  // within the paw's reach of its shoulder, and ahead of it
  let dx = p.x - A.x, dz = p.z - A.z; const ahead = dx * fx + dz * fz; if (ahead < 0.05) { dx += (0.05 - ahead) * fx; dz += (0.05 - ahead) * fz; }
  const d = Math.hypot(dx, dz); if (d > reach) { dx *= reach / d; dz *= reach / d; }
  T.swat = { f, to: new THREE.Vector3(A.x + dx, y, A.z + dz), t: 0, dur: 0.55 };
}
// the body's share: the head rubbing, sniffing, a twitch of the skin, the bat (after the head has been turned to look)
function touchBody(t, dt) {
  const T = TOUCH, B = CATR.bones;
  if (T.awake && (T.rub > 0.01 || (T.on === 'head' && T.sniff > 0 && T.sniff < 0.8))) {
    // the head reaching to the hand (sniffing: stretched out; rubbing: pushed along it, rolled to bring a cheek to it)
    B.neck.getWorldPosition(_tl); const hc = _tu.copy(T.headC).applyMatrix4(B.head.matrixWorld), from = _tf.copy(hc).sub(_tl).normalize(), to = _tv.copy(T.p).sub(_tl).normalize();
    const reach = T.rub > 0.01 ? 0.12 * T.rub * (0.55 + 0.45 * Math.sin(t * Math.PI * 2 * 0.85 + 1.2)) : 0.16 * Math.sin(Math.PI * T.sniff / 0.8);
    _tq.setFromUnitVectors(from, to); const a = 2 * Math.acos(Math.min(1, Math.abs(_tq.w))); if (a > 1e-4) catTurn(B.neck, _q.identity().slerp(_tq, Math.min(1, reach / a)));
    if (T.rub > 0.01) { B.head.getWorldQuaternion(_tq); _tf.copy(CATR.gaze).applyQuaternion(_tq).normalize(); catTurn(B.head, _q.setFromAxisAngle(_tf, 0.24 * T.rub * Math.sin(t * Math.PI * 2 * 0.85))); }
  }
  if (T.twitch > 0) {   // the skin along its back twitching: a quick shiver of the trunk
    T.twitch = Math.max(0, T.twitch - dt / 0.3); catAxis('z', _tf); const a = 0.035 * Math.sin(Math.PI * 2 * 12 * t) * Math.sin(Math.PI * T.twitch);
    catTurn(B.spine, _q.setFromAxisAngle(_tf, a)); catTurn(B.chest, _q.setFromAxisAngle(_tf, -0.7 * a));
  }
  if (T.swat) {
    const S = T.swat; S.t += dt; const k = S.t / S.dur;
    if (k >= 1) T.swat = null;
    else {
      const w = k < 0.28 ? ease(k / 0.28) : k < 0.42 ? 1 : 1 - ease((k - 0.42) / 0.58), L = CATR.legs[S.f], bones = L.bones || (L.bones = [L.up, L.mid, L.end, L.toe].filter(Boolean));
      for (const b of bones) { let q = _ikq.get(b); if (!q) _ikq.set(b, q = new THREE.Quaternion()); q.copy(b.quaternion); }
      _tv.copy(S.to); _tv.y += 0.05 * Math.sin(Math.PI * Math.min(1, k / 0.42));   // (up over the line to it, and down onto it)
      catReach(S.f, _tv, 0.3 * (1 - w), PETS.holder.getWorldQuaternion(_yawQ));
      for (const b of bones) { _q.copy(b.quaternion); b.quaternion.copy(_ikq.get(b)).slerp(_q, w); b.updateWorldMatrix(false, true); }
    }
  }
}
/* ---- every frame */
const _ikq = new Map(), FEET = ['lh', 'rh', 'lf', 'rf'], _yawQ = new THREE.Quaternion(), _tgt = new THREE.Vector3(), _nv = new THREE.Vector3(), _acc = new THREE.Vector3();
function stepCat(t, dt) {
  const night = CAT.place === 'night' && CAT.mode === 'still';
  wishes(); senseTouch(dt);
  if (CAT.mode === 'trip' || CAT.seq) { if (CAT.seq) stepSeq(dt); }
  if (!CAT.seq && CAT.mode === 'trip') return;   // (settled by the sequence's end)
  if (!CAT.seq) {   // in its place
    W.pose = night ? sleepPose() : 'sphinx'; W.half = 0.35;
    CAT.actT -= dt; CAT.huntT -= dt; if (night && CAT.sleep === 'light') CAT.sleepT -= dt;
    if (night && CAT.sleep === 'light' && CAT.sleepT <= 0) {   // dozing done: over onto its side, slowly, into deep sleep
      CAT.sleep = 'deep'; CAT.actT = Math.max(CAT.actT, rnd(30, 60));
      play([{ dur: 4.4, run: k => { Object.assign(W, { pose: 'curl', half: 0.85, lid: 1 }); } }]);
    } else if (CAT.actT <= 0) { if (night) nightActs(); else dayActs(); }
    else if (!night && henBusy() && CAT.huntT <= 0 && Math.random() < dt * 0.15) dayActs();
    if (!night && !CAT.seq) {   // awake in its place: its eyes on the chicken, with glances into the room (at you)
      CAT.glanceT -= dt; if (CAT.glanceT <= 0) { CAT.glance = CAT.glance ? 0 : 1; CAT.glanceT = CAT.glance ? rnd(2, 3.5) : rnd(5, 11); if (CAT.glance) CAT.blinkT = 0.8; }
      const hen = PETS.chicken && PETS.chicken.visible;
      W.look = hen && !CAT.glance ? henHead(_w) : _w.copy(camera.position); W.lookK = 1; W.ears = hen && !CAT.glance ? 0.8 : 0;
    }
  }
  touchWishes(dt, night);
  moveCat(t, dt, night);
}
function moveCat(t, dt, night) {
  const G = CAT.G, P = CATR.poses[W.pose] || CATR.poses.stand, H = PETS.holder;
  catToward(P, dt, W.half); furComb(CATR.body);
  // the holder: where it is and which way it faces; the body over it, pitched and lowered as wished
  H.position.set(G.x, G.y - DENT.give, G.z); H.rotation.set(0, G.yaw, 0);   // (as deep as its paws, or its haunches, are in the cushion)
  const sl = CAT.sigh > 0 ? 1 + 1.4 * Math.sin(Math.PI * CAT.sigh) : 1, br = Math.sin(t * Math.PI * 2 * (night ? 0.3 : 0.38)) * sl;   // breaths: ~23 a minute awake, 18 asleep
  const bk = 1 - CAT.ikW;   // (not while it stands or walks: the whole body swelling would thicken and thin its legs)
  H.scale.set(1 + (night ? 0.012 : 0.008) * br * bk, 1 + (night ? 0.016 : 0.01) * br * bk, 1); H.updateMatrixWorld(true);
  const body = CATR.body, M = CAT.sm || (CAT.sm = { dy: 0, pitch: 0, roll: 0, sway: 0, wiggle: 0, ears: 0, lookK: 0 });
  // what the steps wish for changes at a step's edge: the body follows it in a few hundredths of a second, never at a jump
  // (the leap's own arc is not smoothed: it follows g)
  const kf = 1 - Math.exp(-dt / (W.pose === 'air' ? 0.02 : 0.07));
  for (const k of ['dy', 'pitch', 'roll', 'sway', 'wiggle']) M[k] += (W[k] - M[k]) * kf;
  M.ears += (W.ears - M.ears) * (1 - Math.exp(-dt / 0.12)); M.lookK += ((W.look ? W.lookK : 0) - M.lookK) * (1 - Math.exp(-dt / 0.15));
  if (M.pitch || M.roll) body.quaternion.multiply(_q.setFromEuler(_e3.set(M.pitch, 0, M.roll)));
  body.position.y += M.dy; body.position.x += M.sway + 0.009 * M.wiggle;
  if (Math.abs(M.wiggle) > 1e-4) body.quaternion.multiply(_q.setFromEuler(_e3.set(0, 0.05 * M.wiggle, -0.04 * M.wiggle)));   // the haunches swing side to side
  body.updateMatrixWorld(true);
  if (W.lick || W.wipe) { const B = CATR.bones; catAxis('x', _ax);
    if (W.lick) catTurn(B.head, _q.setFromAxisAngle(_ax, 0.09 * W.lick));   // the tongue's strokes: the head nods to the paw
    if (W.wipe) { catTurn(B.arm_L, _q.setFromAxisAngle(_ax, 0.16 * W.wipe)); catTurn(B.head, _q.setFromAxisAngle(_ax, -0.07 * W.wipe)); } }
  if (!W.ik && W.pose !== 'air') {   // between poses no part of it may go into what it lies on (deeper than a cushion gives)
    const m = CATR.mesh, g = CATR.ground; let low = Infinity;
    for (let i = 0; i < g.length; i += 3) low = Math.min(low, m.getVertexPosition(g[i], _v).applyMatrix4(m.matrixWorld).y);
    const floor = G.y - DENT.give - 0.004;   // (G.y is the surface less the cushion's give)
    if (low < floor) { body.position.y += floor - low; body.updateMatrixWorld(true); }
  }
  // the legs: by the gait on the ground, or as the pose has them (crossing between the two over a fifth of a second)
  CAT.ikW += ((W.ik ? 1 : 0) - CAT.ikW) * Math.min(1, dt / Math.max(0.04, Math.min(0.14, W.half * 0.6))); if (W.ik && CAT.ikW > 0.97) CAT.ikW = 1;
  if (CAT.ikW > 0.01) {
    catGait(G, dt, W.v, W.w);
    catStride(G, W.walk);
    const yawQ = H.getWorldQuaternion(_yawQ);
    for (const f of FEET) {
      const L = CATR.legs[f], F = G.feet[f], bones = L.bones || (L.bones = [L.up, L.mid, L.end, L.toe].filter(Boolean));
      for (const b of bones) { let q = _ikq.get(b); if (!q) _ikq.set(b, q = new THREE.Quaternion()); q.copy(b.quaternion); }
      const p = _tgt.copy(F.target); let curl = F.curl;
      if (L.hind && W.hindUp > 0) { p.y += 0.03 * W.hindUp; p.addScaledVector(_v.set(Math.sin(G.yaw), 0, Math.cos(G.yaw)), -0.02 * W.hindUp); curl = Math.max(curl, 0.5 * W.hindUp); }
      if (!L.hind && W.knead >= 0) { const s = Math.sin(Math.PI * 2 * W.knead + (f === 'rf' ? Math.PI : 0)); if (s > 0) { p.y += 0.014 * s; curl = Math.max(curl, 0.35 * s); } }
      if (L.hind && M.wiggle) p.y += 0.006 * Math.max(0, (f === 'lh' ? 1 : -1) * M.wiggle);   // treading as it wiggles
      p.y -= DENT.give; catReach(f, p, curl, yawQ);   // (into its print)
      if (CAT.ikW < 1) for (const b of bones) { _q.copy(b.quaternion); b.quaternion.copy(_ikq.get(b)).slerp(_q, CAT.ikW); b.updateWorldMatrix(false, true); }
      catKeep(bones, dt);
    }
  } else G.feet = null;
  // the head: on what it looks at (or held steady), the gaze springing toward it
  if (W.look) CAT.lookAt = (CAT.lookAt || new THREE.Vector3()).copy(W.look);
  if (M.lookK > 0.005 && CAT.lookAt) {
    const head = CATR.bones.head; head.getWorldPosition(_hp); const want = _v.copy(CAT.lookAt).sub(_hp).normalize();
    if (!CAT.look) CAT.look = _w.copy(CATR.gaze).applyQuaternion(head.getWorldQuaternion(_q)).normalize().clone();   // from where it looks now
    const a = CAT.look.angleTo(want); if (a > 1e-4) CAT.look.lerp(want, Math.min(1, dt * 5 / Math.max(a, 0.25))).normalize();
    catLook(CAT.look, M.lookK, 1.2);
  } else CAT.look = null;
  touchBody(t, dt);
  idleLife(t, dt, night);
  stepZzz(t, dt, night && !CAT.seq && CAT.sleep === 'deep' && CAT_EYE.u.uBlink.value > 0.9);   // Zzz while it sleeps deeply
  // its tail: pushed by the body's own moves (and swinging once a stride as it walks, lashing as it stalks)
  const vel = _v.set(G.x, G.y, G.z), prev = CAT.prev || (CAT.prev = { p: vel.clone(), v: new THREE.Vector3(), yaw: G.yaw, w: 0 });
  const nv = _nv.copy(vel).sub(prev.p).divideScalar(Math.max(dt, 1e-3)), acc = _acc.copy(nv).sub(prev.v).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 12);
  const yw = angTo(prev.yaw, G.yaw) / Math.max(dt, 1e-3), yawAcc = THREE.MathUtils.clamp((yw - prev.w) / Math.max(dt, 1e-3), -40, 40);
  prev.p.copy(vel); prev.v.copy(nv); prev.yaw = G.yaw; prev.w = yw;
  acc.applyQuaternion(_q.copy(H.quaternion).invert());
  CAT.lashP += dt * Math.PI * 2 * W.lashF;   // (lashing faster as it gets crosser: the phase kept, so the tail never jumps)
  const sway = W.walk * 0.05 * Math.sin(Math.PI * 2 * (G.phase + 0.3)) + (W.lash ? 0.22 * W.lash * Math.sin(CAT.lashP) : 0) + CAT.kick;
  catTail(dt, acc, yawAcc, sway);
  placeShadow(G, W.pose);
}
// breathing is in moveCat; here the lids, ears, a sigh, the tail's tip, and (by day) where it glances
function idleLife(t, dt, night) {
  const B = CATR.bones;
  // lids: as wished (asleep shut), else open, with blinks: quick ones every few seconds, and a slow one when it looks at you
  const lid = W.lid !== null ? W.lid : night ? 1 : 0; CAT.lid += (lid - CAT.lid) * Math.min(1, dt * (lid > CAT.lid ? 5 : 3));
  CAT.blinkT -= dt; let bk = 0;
  if (CAT.blinkK <= 0 && CAT.blinkT <= 0 && CAT.lid < 0.5) { CAT.blinkK = 1e-3; CAT.slow = CAT.glance && Math.random() < 0.5 && TOUCH.prey < 0.2 && TOUCH.over < 0.3; CAT.blinkT = rnd(3.5, 9); }
  if (CAT.blinkK > 0) { CAT.blinkK += dt / (CAT.slow ? 2.2 : 0.2);
    if (CAT.blinkK >= 1) CAT.blinkK = 0; else bk = CAT.slow ? Math.min(1, 1.6 * Math.sin(Math.PI * CAT.blinkK)) * 0.9 : Math.sin(Math.PI * CAT.blinkK); }
  CAT_EYE.u.uBlink.value = Math.max(CAT.lid, bk);
  // a deeper breath now and then, asleep
  CAT.sighT -= dt; if (night && CAT.sighT <= 0) { CAT.sigh = 1; CAT.sighT = rnd(25, 60); } CAT.sigh = Math.max(0, CAT.sigh - dt / 4.5);
  // ears: forward when it is intent, a flick now and then, each on its own (rarer asleep)
  const fwd = _tf.copy(CATR.gaze).applyQuaternion(B.head.getWorldQuaternion(_q)).normalize(), side = _ax.crossVectors(_UP, fwd).normalize();   // the head's left
  const up = _tu.copy(_UP).addScaledVector(fwd, -fwd.y).normalize();   // and its up
  // toward the pointer: both ears swivel to it (the far one less), as far as a cat's turn (they face behind it too);
  // flattened, out to the sides and back, as it gets cross (TOUCH)
  const T = TOUCH; let aim = 0;
  if (T.in && (T.near > 0.05 || T.on) && !reduceMotion && T.headC) {   // (from the middle of its head; the closer to that, the less they turn: on its face they stay forward)
    const d = _tv.copy(T.p).sub(_hp.copy(T.headC).applyMatrix4(B.head.matrixWorld)), r = d.length();
    let ang = Math.atan2(d.dot(side), d.dot(fwd)); if (Math.abs(ang) > 2 && Math.abs(T.swiv) > 0.3 && Math.sign(ang) !== Math.sign(T.swiv)) ang = -ang;   // (behind it: kept on the side it was)
    aim = THREE.MathUtils.clamp(ang, -1.4, 1.4) * Math.max(T.near, T.on ? 1 : 0) * THREE.MathUtils.smoothstep(r, 0.07, 0.2); }
  T.swiv += (aim - T.swiv) * Math.min(1, dt * 9); T.flat += (THREE.MathUtils.smoothstep(T.over, 0.55, 0.85) - T.flat) * Math.min(1, dt * 6);
  for (let e = 0; e < 2; e++) {
    CAT.earT[e] -= dt; if (CAT.earT[e] <= 0) { CAT.ear[e] = 1; CAT.earT[e] = night ? rnd(6, 18) : rnd(2, 7); }
    CAT.ear[e] = Math.max(0, CAT.ear[e] - dt / 0.24);
    const b = B[e ? 'ear_R' : 'ear_L'];
    catTurn(b, _q.setFromAxisAngle(side, 0.2 * (CAT.sm ? CAT.sm.ears : W.ears) - 0.45 * Math.sin(Math.PI * CAT.ear[e]) - 0.4 * T.flat));
    if (Math.abs(T.swiv) > 1e-3) catTurn(b, _q.setFromAxisAngle(up, T.swiv * ((T.swiv > 0) === !e ? 1 : 0.6)));
    if (T.flat > 1e-3) catTurn(b, _q.setFromAxisAngle(fwd, (e ? 0.75 : -0.75) * T.flat));
  }
  // the tail's tip: a flick, often while the chicken is busy (asleep, rarely)
  CAT.tailT -= dt; if (CAT.tailT <= 0) { CAT.kick = (Math.random() < 0.5 ? -1 : 1) * 0.35; CAT.tailT = night ? rnd(8, 20) : TOUCH.prey > 0.3 ? rnd(0.25, 0.6) : henBusy() ? rnd(0.6, 1.8) : rnd(2.5, 6); }
  CAT.kick *= Math.max(0, 1 - dt * 6);
}
function placeShadow(G, pose) {   // the contact shadow: its shape (lying, sitting, curled, standing) and where the cat is
  const sh = PETS.catShadow, S = { sphinx: [1, 1], sit: [0.62, 0.9], lick: [0.62, 0.9], wipe: [0.62, 0.9], curl: [0.75, 1.15], nest: [0.8, 0.9], air: [0.5, 0.5] }[pose] || [0.85, 0.65];
  const y = pose === 'air' ? (G.y > 0.2 ? CAT_WAY.seatY : 0) : G.y + (G.sink || 0) - 0.9 * DENT.body.d;   // on the hollow's floor (only its middle shows: the cushion hides the rest)
  sh.position.set(G.x, y + 0.004, G.z); sh.rotation.z = G.yaw + Math.PI / 2; sh.scale.set(S[0], S[1], 1);
}
/* ---- the chicken: acts (walk, scratch, step back, peer, peck, stand, turn) over a gait that keeps its feet planted */
const HEN_ACTS = {
  walk: n => ({ kind: 'walk', steps: n, v: 0.18 }), back: () => ({ kind: 'walk', steps: 1, v: -0.12 }), scratch: () => ({ kind: 'scratch', dur: 4 * 0.27 }),
  peer: () => ({ kind: 'peer', dur: rnd(0.5, 0.9) }), peck: n => ({ kind: 'peck', dur: n * 0.24 }), stand: () => ({ kind: 'stand', dur: rnd(1, 2.6) }), turn: a => ({ kind: 'turn', a }),
};
function henPlan() {   // what it does next: forage (scratch, step back, look, peck), wander, or stand and look about
  const A = HEN_AREA, inside = HEN.x > A.x0 + 0.12 && HEN.x < A.x1 - 0.12 && HEN.z > A.z0 + 0.12 && HEN.z < A.z1 - 0.12;
  if (!inside) { const cx = (A.x0 + A.x1) / 2 + rnd(-0.15, 0.15), cz = (A.z0 + A.z1) / 2 + rnd(-0.2, 0.2); return [HEN_ACTS.turn(Math.atan2(-(cz - HEN.z), cx - HEN.x)), HEN_ACTS.walk(4)]; }
  // (pecking only now and then, G 14/10/2026, twice over: about a tenth as often as at first; more walking, standing
  // and looking about)
  const r = Math.random();
  if (r < 0.18) return [HEN_ACTS.scratch(), HEN_ACTS.back(), HEN_ACTS.peer(), ...(Math.random() < 0.4 ? [HEN_ACTS.peck(1)] : [])];
  if (r < 0.5) return [HEN_ACTS.walk(2 + 2 * Math.floor(rnd(0, 3))), Math.random() < 0.15 ? HEN_ACTS.peck(1) : HEN_ACTS.stand()];
  if (r < 0.72) return [HEN_ACTS.turn(HEN.yaw + rnd(-1.4, 1.4)), HEN_ACTS.walk(2 + 2 * Math.floor(rnd(0, 2)))];
  return [HEN_ACTS.stand(), HEN_ACTS.stand()];
}
const STRIDE_T = 0.72, DUTY = 0.6;   // a stride (two steps) and the part of it a foot is down
const _m4 = new THREE.Matrix4(), _e = new THREE.Euler();
function stepHen(dt) {
  if (!HEN.queue || !HEN.queue.length) HEN.queue = henPlan();
  if (!HEN.act) { HEN.act = HEN.queue.shift(); HEN.t = 0; if (HEN.act.kind === 'walk') HEN.act.dur = HEN.act.steps * STRIDE_T / 2; if (HEN.act.kind === 'turn') { HEN.act.yaw0 = HEN.yaw; HEN.act.d = angTo(HEN.yaw, HEN.act.a); HEN.act.dur = Math.max(0.36, Math.abs(HEN.act.d) / 2.4); } }
  const A = HEN.act; HEN.t += dt; const k = Math.min(1, HEN.t / A.dur);
  let pitch = 0, roll = 0, neck = 0, headX = 0, headY = 0, by = 0, bz = 0, stepping = false, v = 0;
  if (A.kind === 'walk' || A.kind === 'turn') {
    stepping = true; v = A.kind === 'walk' ? A.v : 0;
    if (A.kind === 'turn') HEN.yaw = A.yaw0 + A.d * ease(k);
    HEN.x += Math.cos(HEN.yaw) * v * dt; HEN.z -= Math.sin(HEN.yaw) * v * dt; HEN.phase += dt / STRIDE_T;
  } else if (A.kind === 'scratch') {   // four strokes, each raking backwards: one foot, the other twice, the first again; it leans over the other foot
    const s = HEN.t / 0.27, i = Math.min(3, Math.floor(s)), f = s - Math.floor(s), left = [1, 0, 0, 1][i];
    const fx = f < 0.35 ? 0.03 * f / 0.35 : 0.03 - 0.11 * (f - 0.35) / 0.65, fy = 0.022 * Math.sin(Math.PI * Math.min(1, f / 0.5));
    HEN.feet = left ? [fx, fy, 0, 0, 0, 0] : [0, 0, fx, fy, 0, 0]; pitch = 0.08; neck = 0.15; bz = left ? -0.01 : 0.01; roll = left ? 0.05 : -0.05;
  } else if (A.kind === 'peer') { pitch = -0.12 * Math.sin(Math.PI * Math.min(1, k * 2)); neck = -0.25 * Math.min(1, k * 3); HEN.tiltT = 0.5; }   // one eye to the ground (a glance, not a bow)
  else if (A.kind === 'peck') {   // quick strikes at the ground: the body leans about its hips, the neck bends right down, the feet stay
    const f = (HEN.t / 0.24) % 1, d = f < 0.35 ? f / 0.35 : 1 - (f - 0.35) / 0.65, e = ease(d);
    pitch = -0.6 * e; neck = -1.3 * e; HEN.tiltT = 0;
  } else if (A.kind === 'stand') { headY = 0.015; if (HEN.t > A.dur * 0.3 && !A.looked) { A.looked = true; HEN.lookT = rnd(-0.8, 0.8); HEN.tiltT = rnd(-0.35, 0.35); } }
  if (stepping) {
    // each foot: down for 60 % of the stride, moving back under the body exactly as fast as the body goes (so it stays put
    // on the ground), then up, clearing the ground, and forward to land ahead; the two feet half a stride apart
    const a = Math.max(0.006, Math.abs(v) * STRIDE_T * DUTY / 2) * (v < 0 ? -1 : 1), foot = ph => {
      const p = ((ph % 1) + 1) % 1; if (p < DUTY) return [a - 2 * a * p / DUTY, 0, 0];
      const s = (p - DUTY) / (1 - DUTY); return [-a + 2 * a * ease(s), 0.032 * Math.pow(Math.sin(Math.PI * s), 0.8), Math.sin(Math.PI * Math.min(1, s * 1.25))]; };   // up early, toes in; down flat, toes spread
    const L = foot(HEN.phase), R = foot(HEN.phase + 0.5), g = [L[0], L[1], R[0], R[1], L[2] || 0, R[2] || 0];
    if (!HEN.gw0) HEN.gw0 = HEN.feet.slice(); HEN.gw = Math.min(1, (HEN.gw || 0) + dt / 0.18);   // (the gait eased in from where the feet were)
    const e = ease(HEN.gw); HEN.feet = g.map((x, i) => HEN.gw0[i] + (x - HEN.gw0[i]) * e);
    // the body rides over the standing leg (highest mid-stance, lowest when both feet are down) and sways over it
    const ps = (HEN.phase * 2) % 1; by = -0.007 * Math.cos(Math.PI * 2 * ps) * (v ? 1 : 0.4);
    bz = 0.008 * Math.cos(Math.PI * 2 * (HEN.phase - DUTY / 2)); roll = -0.04 * Math.cos(Math.PI * 2 * (HEN.phase - DUTY / 2)); pitch = v > 0 ? -0.05 : 0;
    // the head holds still in space while the body passes, then thrusts ahead: one bob a step
    if (v > 0) { const step = v * STRIDE_T / 2; headX = ps < 0.62 ? 0.012 - step * ps : 0.012 - step * 0.62 + step * 0.62 * ease((ps - 0.62) / 0.38); }
  } else if (A.kind !== 'scratch') {   // the feet set square under it: a foot left ahead or behind is lifted and stepped in (never slid)
    const F = HEN.feet, st = HEN.settle || (HEN.settle = { i: -1, t: 0, x0: 0 });
    if (st.i < 0) {
      const dl = Math.abs(F[0]), dr = Math.abs(F[2]);
      if (Math.max(dl, dr) > 0.005) { st.i = dl >= dr ? 0 : 1; st.t = 0; st.x0 = F[st.i * 2]; } else F.fill(0);
    }
    if (st.i >= 0) { st.t += dt / 0.24; const q = Math.min(1, st.t), j = st.i * 2;
      F[j] = st.x0 * (1 - ease(q)); F[j + 1] = 0.022 * Math.sin(Math.PI * q); F[4 + st.i] = Math.sin(Math.PI * Math.min(1, q * 1.25)); if (q >= 1) st.i = -1; }
  }
  if (stepping || A.kind === 'scratch') HEN.settle = null;
  if (!stepping) { HEN.gw = 0; HEN.gw0 = null; }
  if (k >= 1) { HEN.act = null; HEN.lookT = Math.random() < 0.3 ? rnd(-0.6, 0.6) : 0; }
  // the head turns and tilts in quick moves, then holds
  HEN.look += (HEN.lookT - HEN.look) * Math.min(1, dt * 12); HEN.tilt += (HEN.tiltT - HEN.tilt) * Math.min(1, dt * 12);
  const S = HEN.sm || (HEN.sm = { pitch: 0, roll: 0, neck: 0, headX: 0, headY: 0, by: 0, bz: 0 }), T = { pitch, roll, neck, headX, headY, by, bz };
  for (const k in S) S[k] += (T[k] - S[k]) * (1 - Math.exp(-dt / (k === 'neck' || k === 'pitch' ? 0.035 : 0.06)));   // (quick, but never a jump)
  HEN.u.uHeadR.value.setFromMatrix4(_m4.makeRotationFromEuler(_e.set(HEN.tilt, HEN.look, S.neck, 'YXZ')));
  HEN.u.uHeadT.value.set(S.headX, S.headY, 0); HEN.u.uBodyR.value.setFromMatrix4(_m4.makeRotationFromEuler(_e.set(S.roll, 0, S.pitch, 'XYZ'))); HEN.u.uBodyT.value.set(0, S.by, S.bz);
  HEN.u.uFootL.value.set(HEN.feet[0], HEN.feet[1], HEN.feet[4] || 0); HEN.u.uFootR.value.set(HEN.feet[2], HEN.feet[3], HEN.feet[5] || 0);
  PETS.chicken.position.set(HEN.x, HEN_GROUND, HEN.z); PETS.chicken.rotation.y = HEN.yaw;
  PETS.henShadow.position.set(HEN.x + Math.cos(HEN.yaw) * 0.02, HEN_GROUND + 0.004, HEN.z - Math.sin(HEN.yaw) * 0.02); PETS.henShadow.rotation.z = HEN.yaw;
}
/* ---- the crisp pass: the animals over the finished picture, in a small target covering where they are on screen */
const _c = new THREE.Color();
function drawPets() {
  if (!PETS.ok) return;
  const t = clock.getElapsedTime(), dt = Math.min(0.1, Math.max(0, t - PETS.last)); PETS.last = t;
  if (!reduceMotion) { stepCat(t, dt); if (PETS.chicken && PETS.chicken.visible) stepHen(dt); }
  else if (CAT.mode === 'trip') settle(PETS.state);
  stepDent(reduceMotion ? 1 : dt);
  const U = POST.mat.uniforms; SHARP.u.uExp.value = U.exposure.value; SHARP.u.uLift.value = U.lift.value; SHARP.u.uVeil.value = U.veil.value;
  // the chicken first (beyond the glass, so the cat is never behind it), then the cat and its Zzz, each alone; the
  // chicken not before the garden is in (core/loop.js reveal)
  const henOut = PETS.chicken && PETS.chicken.visible && REVEAL.stage < 1; if (henOut) PETS.chicken.visible = false;
  const hen = PETS.chicken && PETS.chicken.visible, zzz = ZZZ.grp && ZZZ.grp.visible, hp = PETS.holder.position;
  let henDrawn = false;
  if (hen) { PETS.holder.visible = false; if (zzz) ZZZ.grp.visible = false;
    henDrawn = crispPass(SHARP.hen, [HEN.x, HEN_GROUND - 0.02, HEN.z, 0.3, 0.52, 0.3]);
    PETS.holder.visible = true; if (zzz) ZZZ.grp.visible = true; PETS.chicken.visible = false; }
  const catDrawn = crispPass(SHARP.cat, [hp.x, hp.y - 0.04, hp.z, 0.5, zzz ? 0.8 : 0.55, 0.5], C => { if (PETS.fur && PETS.fur.visible) furLight(renderer, scene, C); });   // (high enough for the Zzz)
  // on screen and on the move (the hen always is; the cat on its way or busy): the sharp layer at 60 frames a second
  PETS.fast = henDrawn || (catDrawn && (CAT.mode === 'trip' || !!CAT.seq || CAT.ikW > 0.01 || TOUCH.active));
  if (hen || henOut) PETS.chicken.visible = true;
}
// one crisp pass: what is shown on layer 1 inside a box (centre, half widths, height), into a target just covering it on
// screen (the camera's projection narrowed to that rectangle, depth as in the picture), then laid over the picture
function crispPass(P, [bx, by, bz, rx, ry, rz], before) {   // (true if it drew)
  const W_ = OVER.u.uRes.value.x, H = OVER.u.uRes.value.y, pr = renderer.getPixelRatio();
  let x0 = W_, y0 = H, x1 = 0, y1 = 0, any = false;
  for (let i = 0; i < 8; i++) { const v = SHARP.v.set(bx + (i & 1 ? rx : -rx), by + (i & 2 ? ry : 0), bz + (i & 4 ? rz : -rz)).project(camera); if (v.z > 1 || v.z < -1) continue;
    any = true; const px = (v.x + 1) / 2 * W_, py = (v.y + 1) / 2 * H; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  if (!any) return false;
  x0 = Math.max(0, Math.floor(x0) - 8); y0 = Math.max(0, Math.floor(y0) - 8); x1 = Math.min(W_, Math.ceil(x1) + 8); y1 = Math.min(H, Math.ceil(y1) + 8);   // (room for the paint's strokes)
  const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return false;
  if (!P.rt || P.rt.width < w || P.rt.height < h) {
    if (P.rt) P.rt.dispose();
    P.rt = new THREE.WebGLRenderTarget(Math.ceil(w * 1.25), Math.ceil(h * 1.25), { samples: 4, type: THREE.HalfFloatType });
    P.quad.material.uniforms.t.value = P.rt.texture;
  }
  const cx = (x0 + x1) / W_ - 1, cy = (y0 + y1) / H - 1, sx = W_ / w, sy = H / h, C = SHARP.cam; C.layers.set(P.layer);
  C.projectionMatrix.set(sx, 0, 0, -sx * cx, 0, sy, 0, -sy * cy, 0, 0, 1, 0, 0, 0, 0, 1).multiply(camera.projectionMatrix);
  C.projectionMatrixInverse.copy(C.projectionMatrix).invert(); camera.matrixWorld.decompose(C.position, C.quaternion, C.scale); C.updateMatrixWorld(true);
  DECKR.u.uFull.value.set(W_, H); DECKR.u.uOff.value.set(x0, y0);
  const cc = renderer.getClearColor(_c), ca = renderer.getClearAlpha();
  // no backdrop in these passes: until the sky is let in the room's is a plain colour (core/loop.js reveal), which filled
  // the target, so an opaque box showed round the animals as they came in, and the fur's light (fur.js) went wrong
  const bg = scene.background; scene.background = null;
  if (before) before(C);
  P.rt.viewport.set(0, 0, w, h); P.rt.scissor.set(0, 0, w, h); P.rt.scissorTest = true;
  renderer.setRenderTarget(P.rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, C);
  renderer.setRenderTarget(null); renderer.setClearColor(cc, ca); scene.background = bg;
  const Q = P.quad.material.uniforms; Q.uScale.value.set(w / P.rt.width, h / P.rt.height); setPaint(Q, P.rt, W_, H);
  renderer.autoClear = false; renderer.setViewport(x0 / pr, y0 / pr, w / pr, h / pr); P.quad.render(renderer);   // over the picture: no clear
  renderer.setViewport(0, 0, W_ / pr, H / pr); renderer.autoClear = true;
  return true;
}

/* ---- the book out of the shelf (hero-books.js), sharp over the picture: one pass for each one showing */
const _bb = new THREE.Box3(), _bv = new THREE.Vector3();
function drawSharpBooks() {
  const U = POST.mat.uniforms; SHARP.u.uExp.value = U.exposure.value; SHARP.u.uLift.value = U.lift.value; SHARP.u.uVeil.value = U.veil.value;
  if (!SHARP.book.quad) sharpQuad(SHARP.book);
  for (const bk of HERO.list) {
    const h = bk.hero; if (!h || !h.visible) continue;
    bk.heroSeen = performance.now(); _bb.setFromObject(h);
    if (bk.flapU && bk.flapU.uOpen.value > 0.01 && bk.heroShape) {   // an atlas opening: its cover turns out of the mesh's box (in the shader)
      const a = bk.flapU.uOpen.value, H = bk.heroShape.hinge;
      for (const y of [0, 1]) _bb.expandByPoint(h.localToWorld(_bv.set((H.x + Math.sin(a) * bk.d) / bk.t, y, (H.y - Math.cos(a) * bk.d) / bk.d)));
      // (a book's leaves as they turn: each one's root and fore-edge at their angles; a leaf standing up is a page's width out of the box)
      if (bk.read) for (const L of bk.read.leaves) if (L.t0 !== null || (L.phi > 0.01 && L.phi < a - 0.01)) {
        for (const e of [L.phi, L.phi + L.bend]) { const r = Math.min(a, Math.max(0, e)); for (const y of [0, 1]) _bb.expandByPoint(h.localToWorld(_bv.set((H.x + Math.sin(r) * bk.d) / bk.t, y, (H.y - Math.cos(r) * bk.d) / bk.d))); }
      }
    }
    const c = _bb.getCenter(SHARP.v); heroKey(camera, c);
    crispPass(SHARP.book, [c.x, _bb.min.y, c.z, (_bb.max.x - _bb.min.x) / 2, _bb.max.y - _bb.min.y, (_bb.max.z - _bb.min.z) / 2]);
  }
}

// the hen keeps in out of the rain (fx/rain.js), and comes out again after it
function setHenAway(away) {
  if (!!PETS.henAway === away) return; PETS.henAway = away;
  if (PETS.chicken) { PETS.chicken.visible = PETS.henShadow.visible = PETS.state === 'day' && !away; setShadowsDirty(true); setNeeds(true); }
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function setInst(bk, amount) {
  setShadowsDirty(true);
  booksMesh.setMatrixAt(bk.idx, amount === null ? ZERO : new THREE.Matrix4().makeTranslation(bk.normal.x * amount, 0, bk.normal.z * amount).multiply(bk.m0));
  booksMesh.instanceMatrix.needsUpdate = true;
}
function slidePose(bk, amount) {
  const p = new V3(), q = new THREE.Quaternion(), s = new V3();
  new THREE.Matrix4().makeTranslation(bk.normal.x * amount, 0, bk.normal.z * amount).multiply(bk.m0).decompose(p, q, s); return { p, q };
}
const pulledPose = bk => slidePose(bk, PULL);
// how far in front of the camera a book is shown: as far as `want`, but never back in among its shelves (a section's
// view may stand only ~1 m from them on a wide screen: the book shown 1.3 m off went in among the books there, cut by
// them: G, 17/10/2026); 35 cm clear of the shelves' face, its own depth turned toward the camera within that
function nearOf(v, want) { return Math.max(0.5, Math.min(want, v.tgt.distanceTo(v.pos) - 0.35)); }
function presentPose(bk) {
  const v = focusView(bk.sec), fwd = v.tgt.clone().sub(v.pos).normalize(), up = new V3(0, 1, 0), right = fwd.clone().cross(up).normalize();
  const D = nearOf(v, 1.3), k = D / 1.3;   // (the offsets in the view kept as they were, nearer or not)
  const p = v.pos.clone().addScaledVector(fwd, D).addScaledVector(right, -0.1 * k).addScaledVector(up, (-0.03 - bk.h / 2) * Math.max(k, 0.75));
  const x = fwd.clone().negate().applyAxisAngle(up, -0.52), z = x.clone().cross(up).normalize();   // front cover to the camera, fore-edge showing a little
  const th = 0.07, x2 = x.clone().multiplyScalar(Math.cos(th)).addScaledVector(up, Math.sin(th)), y2 = up.clone().multiplyScalar(Math.cos(th)).addScaledVector(x, -Math.sin(th));   // leaning back 4°, as on a stand
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x2, y2, z));
  return { p: p.addScaledVector(z, bk.d / 2), q };
}
// an atlas open in front of the camera (the Geography books: G, 16/10/2026): nearer than a closed book is shown, facing
// the camera, its spread's middle (the spine, a little toward the map) where the closed book's middle was. A book to
// read (ui/leaves.js) comes nearer still, square to the camera, its spine in the middle of the free side
function openPose(bk) {
  const v = focusView(bk.sec), fwd = v.tgt.clone().sub(v.pos).normalize(), up = new V3(0, 1, 0), right = fwd.clone().cross(up).normalize(), rd = !!bk.read;
  const D = nearOf(v, rd ? 0.66 : 0.8), p = v.pos.clone().addScaledVector(fwd, D).addScaledVector(right, rd ? 0 : -0.02).addScaledVector(up, -0.02 - bk.h / 2);
  const x = fwd.clone().negate().applyAxisAngle(up, rd ? 0 : -0.1), z = x.clone().cross(up).normalize();
  const th = rd ? 0.05 : 0.09, x2 = x.clone().multiplyScalar(Math.cos(th)).addScaledVector(up, Math.sin(th)), y2 = up.clone().multiplyScalar(Math.cos(th)).addScaledVector(x, -Math.sin(th));
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x2, y2, z));
  return { p: p.addScaledVector(z, rd ? 0 : bk.d * 0.16), q };
}
const OPEN_TURN = 2.7;   // (the cover turned 155°: open as far as a hardcover opens in the hand)
let SEAT = null;
function restPose(bk) {
  if (!SEAT) {   // the middle seat of the sofa, found by dropping a ray on it
    const rc = new THREE.Raycaster(new V3(0.62, 2, -7.15), new V3(0, -1, 0)); rc.camera = camera;
    const hit = LIGHTS.sofa ? rc.intersectObject(LIGHTS.sofa, true).find(h => h.object.isMesh) : null;
    SEAT = hit ? hit.point : new V3(0.62, 0.47, -7.15);
  }
  const x = new V3(0, 1, 0), y = new V3(Math.sin(2.5), 0, Math.cos(2.5)), z = x.clone().cross(y);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  const p = SEAT.clone().add(new V3(0, bk.t / 2 + 0.004, 0)).addScaledVector(y, -bk.h / 2).addScaledVector(z, bk.d / 2);
  return { p, q };
}
function startFlight(bk, goal) {
  bk.goal = goal; bk.fk = 0; bk.from = { p: bk.pose.p.clone(), q: bk.pose.q.clone() };
  bk.to = goal === 'present' ? presentPose(bk) : goal === 'rest' ? restPose(bk) : pulledPose(bk);
  bk.fdur = reduceMotion ? 0.001 : goal === 'pulled' ? 0.9 : 1.05;
}
function wantOf(bk) {
  if (bk === UIS.mapBook) return UIS.open === bk.sec && !offMode() ? 'present' : 'shelf';   // (an atlas goes back to its shelf)
  if (bk === UIS.active) return UIS.open === bk.sec && !offMode() ? 'present' : 'rest';
  return bk === UIS.peek ? 'peek' : 'shelf';
}
function stepBooks(dt, t) {
  let moving = false;
  for (const bk of [...UIS.touched]) {
    const want = wantOf(bk);
    if (!bk.out) {
      const target = want === 'shelf' ? 0 : want === 'peek' ? PEEK : PULL;
      if (Math.abs(bk.slide - target) > 1e-4) { bk.slide += THREE.MathUtils.clamp(target - bk.slide, -dt * 0.65, dt * 0.65); moving = true; } else bk.slide = target;
      // once a book leaves its place it shows its title: the hero (with its sharp words) stands in for the shelf instance
      const away = bk.slide > 1e-4, h = away ? heroMesh(bk) : bk.hero;
      if (away !== !!bk.away) { bk.away = away; setInst(bk, away ? null : 0); if (h) h.visible = away; }
      if (away) { const ps = slidePose(bk, bk.slide); h.position.copy(ps.p); h.quaternion.copy(ps.q); h.scale.set(bk.t, bk.h, bk.d); }
      if (bk.slide === PULL && (want === 'present' || want === 'rest')) { bk.out = true; bk.pose = pulledPose(bk); startFlight(bk, want); moving = true; }
      else if (target === 0 && !away) UIS.touched.delete(bk);
    } else {
      const goal = want === 'present' || want === 'rest' ? want : 'pulled';
      if (bk.goal !== goal) startFlight(bk, goal);
      if (bk.fk < 1) {
        bk.fk = Math.min(1, bk.fk + dt / bk.fdur); const k = bk.fk, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const lift = (bk.goal === 'present' ? 0.08 : 0.22) * Math.sin(Math.PI * e);
        bk.pose = { p: bk.from.p.clone().lerp(bk.to.p, e).add(new V3(0, lift, 0)), q: bk.from.q.clone().slerp(bk.to.q, e) }; moving = true;
        if (bk.fk >= 1 && bk.goal === 'pulled') { bk.out = false; bk.slide = PULL; if (bk.read) readRelease(bk); continue; }   // back at its place: it slides in on the shelf (a book of notes lets its pages go)
      }
      // an atlas, once in front of the camera, opens: it comes nearer and turns to face the camera as its cover turns
      // open (that a little later, so it clears the camera's way); it closes again as it goes back (a closing cover
      // flies back with it)
      let ok = 0;
      if (bk.flapU && opensFlat(bk.it)) {
        const want = bk.goal === 'present' && bk.fk >= 1 ? 1 : 0, k0 = bk.openK || 0;
        bk.openK = reduceMotion ? want : THREE.MathUtils.clamp(k0 + (want ? dt / 1.15 : -dt / 0.55), 0, 1); if (bk.openK !== k0) moving = true;
        if (bk.openK > 0 && bk.atlas && !bk.atlas.done) bk.atlas.paint();
        if (bk.openK > 0 && bk.read) readOpening(bk);
        const k = bk.openK; ok = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const kc = THREE.MathUtils.smoothstep(k, 0.12, 1); bk.flapU.uOpen.value = OPEN_TURN * kc;
        if (bk.read && stepRead(bk)) moving = true;   // (its leaves: turning, and closing with the board)
        if (bk.goal === 'present' && bk.fk >= 1) {
          if (!bk.openTo) bk.openTo = openPose(bk);
          bk.pose = { p: bk.to.p.clone().lerp(bk.openTo.p, ok), q: bk.to.q.clone().slerp(bk.openTo.q, ok) };
        } else bk.openTo = null;
      }
      const h = bk.hero; h.position.copy(bk.pose.p); h.quaternion.copy(bk.pose.q); h.scale.set(bk.t, bk.h, bk.d);
      if (bk.goal === 'present' && bk.fk >= 1 && !reduceMotion) { const b = 1 - (bk.read ? 1 : 0.85) * ok; h.position.y += Math.sin(t * 1.4) * 0.006 * b; h.rotateY(Math.sin(t * 0.9) * 0.04 * b); }   // (an open atlas held steadier: its map is to be clicked; an open book still: it is read)
    }
  }
  return moving;
}
function syncActive() {   // which book is "current" in the page's player
  const cur = document.querySelector('#pages .item.is-current');
  const bk = cur ? UIS.bySrc.get(cur.dataset.src) || null : null;
  if (bk !== UIS.active) { if (UIS.active) UIS.touched.add(UIS.active); UIS.active = bk; if (bk) UIS.touched.add(bk); setNeeds(true); }
}
/* ---- the record player on the floor, between the chaise and the tall shelf: the page's own packed model (paper-and-ink
   base, platter and tonearm), drawn in the sharp layer like the page's sidebar deck, so the watercolour pass leaves it
   alone. It is tested against the room's depth like the titles. Its record carries the label art of the song playing;
   the platter turns and the arm tracks the song. A click on it brings out the page's player in the left corner (or
   puts it away); the player stays hidden otherwise.
   The canvas has no depth buffer of its own, so the deck is drawn into a small multisampled target that just covers
   it on screen (the camera's projection narrowed to that rectangle), then laid over the picture, 60 % of it painted as
   the picture is (G, 14/10/2026: 10 %, then 30 % more, then 20 % more; the paint pass's own steps, post.js PAINT_GLSL, so the turning
   label is painted as it turns). */
const DECK = { ok: false, angle: 0, speed: 0, playing: false, progress: 0, hover: false, scene: new THREE.Scene() };
const DECKR = { rt: null, cam: new THREE.Camera(), corners: [], u: { uDepth: OVER.u.uDepth, uFull: { value: new THREE.Vector2(1, 1) }, uOff: { value: new THREE.Vector2() } }, quad: null };
DECK.R = DECKR;   // (for tests)
function sharpDepth(mat) {   // fragments behind the room are dropped (the target's pixels map back to the whole picture)
  mat.onBeforeCompile = sh => {
    sh.uniforms.uDepth = DECKR.u.uDepth; sh.uniforms.uFull = DECKR.u.uFull; sh.uniforms.uOff = DECKR.u.uOff;
    sh.fragmentShader = 'uniform sampler2D uDepth; uniform vec2 uFull, uOff;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;');
  };
  return mat;
}
function drawDeck() {   // the deck over the finished picture
  if (!DECK.ok) return;
  const W = OVER.u.uRes.value.x, H = OVER.u.uRes.value.y, pr = renderer.getPixelRatio();
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const c of DECKR.corners) { const v = TMPV.copy(c).applyMatrix4(DECK.deck.matrixWorld).project(camera); if (v.z > 1) return;
    const px = (v.x + 1) / 2 * W, py = (v.y + 1) / 2 * H; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  x0 = Math.max(0, Math.floor(x0) - 4); y0 = Math.max(0, Math.floor(y0) - 4); x1 = Math.min(W, Math.ceil(x1) + 4); y1 = Math.min(H, Math.ceil(y1) + 4);
  const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
  if (!DECKR.rt || DECKR.rt.width < w || DECKR.rt.height < h) {
    if (DECKR.rt) DECKR.rt.dispose();
    DECKR.rt = new THREE.WebGLRenderTarget(Math.ceil(w * 1.25), Math.ceil(h * 1.25), { samples: 4, type: THREE.HalfFloatType });
    DECKR.quad.material.uniforms.t.value = DECKR.rt.texture;
  }
  // the camera's projection narrowed to the rectangle (x, y scaled in clip space; depth as in the picture)
  const cx = (x0 + x1) / W - 1, cy = (y0 + y1) / H - 1, sx = W / w, sy = H / h, C = DECKR.cam;
  C.projectionMatrix.set(sx, 0, 0, -sx * cx, 0, sy, 0, -sy * cy, 0, 0, 1, 0, 0, 0, 0, 1).multiply(camera.projectionMatrix);
  C.projectionMatrixInverse.copy(C.projectionMatrix).invert(); C.matrix.copy(camera.matrixWorld); C.updateMatrixWorld(true);
  DECKR.u.uFull.value.set(W, H); DECKR.u.uOff.value.set(x0, y0);
  DECK.body3.uniforms.uLight.value.set(-0.45, 0.85, 0.35).transformDirection(DECK.deck.matrixWorld).transformDirection(camera.matrixWorldInverse);
  const cc = renderer.getClearColor(TMPC), ca = renderer.getClearAlpha();
  DECKR.rt.viewport.set(0, 0, w, h); DECKR.rt.scissor.set(0, 0, w, h); DECKR.rt.scissorTest = true;
  renderer.setRenderTarget(DECKR.rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(DECK.scene, C);
  renderer.setRenderTarget(null); renderer.setClearColor(cc, ca);
  DECKR.quad.material.uniforms.uScale.value.set(w / DECKR.rt.width, h / DECKR.rt.height); setPaint(DECKR.quad.material.uniforms, DECKR.rt, W, H);
  renderer.autoClear = false; renderer.setViewport(x0 / pr, y0 / pr, w / pr, h / pr); DECKR.quad.render(renderer);   // over the picture: no clear
  renderer.setViewport(0, 0, W / pr, H / pr); renderer.autoClear = true;
}
const TMPC = new THREE.Color();
function buildRecordPlayer() {
  const txt = window.__lib3dTT; delete window.__lib3dTT; if (!txt) return;
  const J = JSON.parse(txt), M = J.meta, bin = Uint8Array.from(atob(J.bin), ch => ch.charCodeAt(0)).buffer;
  // the page's own paper-and-ink shading: its texture is a mask (1 paper, 0 ink), uploaded as is; paper lit softly
  // from the upper left of the deck, as in the sidebar
  const ink = new THREE.TextureLoader().load('data:image/png;base64,' + J.tex); ink.flipY = false; ink.anisotropy = 8;
  const body3 = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { uTex: { value: ink }, uPaper: { value: new THREE.Color() }, uInk: { value: new THREE.Color() },
      uLight: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: 0 }, uDepth: DECKR.u.uDepth, uFull: DECKR.u.uFull, uOff: DECKR.u.uOff },
    vertexShader: 'varying vec3 vN; varying vec2 vUv; void main(){ vN = normalize(normalMatrix * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uTex, uDepth; uniform vec3 uPaper, uInk, uLight; uniform float uGlow; uniform vec2 uFull, uOff; varying vec3 vN; varying vec2 vUv;
      void main(){ if (gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;
        float t = texture2D(uTex, vUv).r; vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        float shade = mix(0.8, 1.0, smoothstep(0.12, 0.32, dot(n, uLight)));
        gl_FragColor = vec4(mix(uInk, uPaper * shade, t) * (1.0 + uGlow), 1.0); }` });
  const line = sharpDepth(new THREE.MeshBasicMaterial({ color: 0x2a2219, side: THREE.BackSide }));
  const geo = e => { const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Int16Array(bin, e.pos, e.verts * 3), 3, true));
    if (e.nrm != null) g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, e.nrm, e.verts * 3), 3, true));
    if (e.uv != null) g.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(bin, e.uv, e.verts * 2), 2, true));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, e.idx, e.count), 1)); return g; };
  const part = (name, pivot) => { const grp = new THREE.Group(); grp.position.set(pivot[0], 0, pivot[1]);
    for (const [kind, mat] of [['main', body3], ['outline', line]]) { const m = new THREE.Mesh(geo(M.parts[name][kind]), mat);
      m.position.set(M.center[0] - pivot[0], M.center[1], M.center[2] - pivot[1]); m.scale.set(...M.half); grp.add(m); }
    return grp; };
  const deck = new THREE.Group(), base = part('base', [0, 0]), platter = part('platter', [M.platter.x, M.platter.z]), arm = part('arm', [M.pivot.x, M.pivot.z]);
  deck.add(base, platter, arm);
  const recMat = sharpDepth(new THREE.MeshBasicMaterial({ color: 0x1c1712 }));
  const rec = new THREE.Mesh(new THREE.CircleGeometry(M.platter.recordR, 64), recMat); rec.rotation.x = -Math.PI / 2; rec.position.y = M.platter.recordY + 0.01; platter.add(rec);
  // a deck (~52 cm, a console-size one) standing on the floor, turned toward the room
  const P = DECK_AT, s = 0.52 / (2 * M.half[2]); deck.scale.setScalar(s); deck.rotation.y = P.ry;
  const foot = new THREE.Vector3(M.center[0], M.center[1] - M.half[1], M.center[2]).multiplyScalar(s).applyAxisAngle(new THREE.Vector3(0, 1, 0), deck.rotation.y);
  deck.position.set(P.x, 0.004, P.z).sub(foot); DECK.scene.add(deck); deck.updateMatrixWorld(true);
  { const b = new THREE.Box3(); deck.traverse(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); } });
    const inv = deck.matrixWorld.clone().invert(); for (let i = 0; i < 8; i++) DECKR.corners.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(inv)); }
  DECKR.cam.matrixAutoUpdate = false;
  DECKR.quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { t: { value: null }, uScale: { value: new THREE.Vector2(1, 1) }, uPaint: { value: 0.6 }, ...paintUniforms() },
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, vertexShader: QUAD_VS,
    fragmentShader: `uniform sampler2D t; uniform vec2 uScale; uniform float uPaint; varying vec2 vUv;
      ${PAINT_GLSL}
      vec3 toS(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(0.0031308,c)); }
      vec4 shadeAt(vec2 uv) { vec4 c = texture2D(t, clamp(uv, uTexel * 0.5, uScale - uTexel * 0.5)); return c.a < 0.002 ? vec4(0.0) : vec4(toS(c.rgb / c.a), c.a); }
      void main(){ vec2 uv = vUv * uScale; vec4 o = shadeAt(uv); if (uPaint > 0.001) { float det; vec4 pt = paintAt(uv, det); o = mix(o, pt, uPaint * (1.0 - 0.45 * smoothstep(0.004, 0.04, det))); }   // (busy detail kept crisper)
        if (o.a < 0.002) discard; gl_FragColor = vec4(o.rgb * o.a, o.a); }` }));
  // its contact shadow on the floor (in the room, so it is painted with it)
  { const c = canvas(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    gr.addColorStop(0, 'rgba(20,12,6,.8)'); gr.addColorStop(0.5, 'rgba(20,12,6,.5)'); gr.addColorStop(1, 'rgba(20,12,6,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.62), new THREE.MeshBasicMaterial({ map: ctex(c, { rep: false }), transparent: true, depthWrite: false, fog: false }));
    sh.rotation.set(-Math.PI / 2, 0, P.ry + Math.PI / 2); sh.position.set(P.x, 0.003, P.z); room.add(sh); }
  const hit = new THREE.Mesh(new THREE.BoxGeometry(2 * M.half[0], 2 * M.half[1] + 0.6, 2 * M.half[2]), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(M.center[0], M.center[1], M.center[2]); hit.userData.deck = true; deck.add(hit); hit.updateMatrixWorld(true);
  Object.assign(DECK, { ok: true, deck, platter, arm, rec, recMat, body3, line, hit, M });
  arm.rotation.y = M.arm.rest;
  const img = document.getElementById('disc-img');
  const loadDish = () => { if (!img || !img.src) return; const src = img.src.replace(/w_\d+,h_\d+/, 'w_256,h_256');
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(src, tx => { tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; recMat.map = tx; recMat.color.set(0xffffff); recMat.alphaTest = 0.5; recMat.needsUpdate = true; setNeeds(true); }); };
  loadDish(); if (img) new MutationObserver(loadDish).observe(img, { attributes: true, attributeFilter: ['src'] });
}
const DECK_AT = { x: 1.86, z: -5.12, ry: -Math.PI / 2 - 0.36 };   // the floor in front of the chaise's end, by the shelf
function stepDeck(dt) {   // follows the sidebar deck: spins while the music plays, the arm tracks the song
  if (!DECK.ok) return false;
  const disc = document.getElementById('disc'), seek = document.getElementById('music-seek');
  DECK.playing = !!(disc && disc.classList.contains('is-spinning'));
  DECK.progress = seek && +seek.max ? +seek.value / +seek.max : 0;
  const M = DECK.M, target = DECK.playing ? M.arm.outer + (M.arm.inner - M.arm.outer) * DECK.progress : M.arm.rest;
  const omega = DECK.playing ? 33.333 / 60 * Math.PI * 2 * 0.25 : 0;
  DECK.speed += (omega - DECK.speed) * Math.min(1, dt * (omega > DECK.speed ? 1.3 : 0.55)); if (Math.abs(omega - DECK.speed) < 0.01) DECK.speed = omega;
  DECK.angle = (DECK.angle - DECK.speed * dt) % (Math.PI * 2); DECK.platter.rotation.y = DECK.angle;
  const armMoving = Math.abs(target - DECK.arm.rotation.y) > 0.001;
  DECK.arm.rotation.y += (target - DECK.arm.rotation.y) * Math.min(1, dt * 1.6);
  // the page's day and night paper and ink (its sidebar deck's theme), dimmed and warmed a little with the room's light
  const S = HOUR.S, n = S.n, U = DECK.body3.uniforms, k = lerp(lerp(0.8, 1, Math.min(1, S.amb)), 1, n);
  U.uPaper.value.setRGB(lerp(0.94, 0.74, n) * k, lerp(0.91, 0.70, n) * k * (1 - 0.06 * S.warm), lerp(0.84, 0.62, n) * k * (1 - 0.16 * S.warm), THREE.SRGBColorSpace);
  U.uInk.value.setRGB(lerp(0.17, 0.07, n), lerp(0.14, 0.06, n), lerp(0.11, 0.05, n), THREE.SRGBColorSpace); DECK.line.color.copy(U.uInk.value);
  if (DECK.recMat.map) DECK.recMat.color.setScalar(lerp(1, 0.64, n)); else DECK.recMat.color.copy(U.uInk.value);   // the label art, dimmed by night like the page's
  const hv = DECK.hover ? 0.12 : 0; U.uGlow.value += (hv - U.uGlow.value) * Math.min(1, dt * 10);
  return armMoving || (DECK.speed !== omega) || Math.abs(hv - U.uGlow.value) > 0.004;   // a steady spin is drawn cheaply (loop)
}
function togglePlayer(open = !body.classList.contains('l3-player-open')) {   // the page's own player, in the left corner
  clearTimeout(togglePlayer.t);
  if (open) {
    body.classList.remove('l3-player-closing'); body.classList.add('l3-player-open');
    // the page redraws its deck only on its own events (it skips them while the tab is hidden): its visibility
    // handler resumes it, so it is shown drawn even if the page loaded in a background tab
    document.dispatchEvent(new Event('visibilitychange'));
  }
  else if (body.classList.contains('l3-player-open')) { body.classList.add('l3-player-closing'); togglePlayer.t = setTimeout(() => body.classList.remove('l3-player-open', 'l3-player-closing'), 280); }
}
/* ---- labels and the card (HTML over the canvas: crisp text in either language) */
const UIEL = {};
// the book under the pointer, named beside it: title, author · year and pages, in the page's language (a thin spine
// cannot hold its title legibly, and a long title is cut short on any spine)
let tipBook = null, tipKey = '';
function showTip(bk, x, y, map, say) {   // (map: the pointer is on an open atlas's map: the tip says a click opens its page; say: what a click does on an open book of notes, there)
  const t = UIEL.tip; if (!t) return;
  if (!bk) { if (tipBook) { t.classList.remove('is-on'); tipBook = null; tipKey = ''; } return; }
  const key = say ? 'say:' + say.join('|') : map ? 'map' : isMapItem(bk.it) ? 'atlas' : isReadItem(bk.it) ? 'read' + (bk.out ? 1 : 0) : '';
  if (tipBook !== bk || tipKey !== key) {
    tipBook = bk; tipKey = key; const it = bk.it, info = bookInfo(it), by = byOf(it), n = info && info.pages;
    const line = pages => esc([by, pages].filter(Boolean).join(' · '));
    const hint = say ? say : key === 'map' ? ['Click the map to open the page ↗', 'Bấm vào bản đồ để mở trang ↗'] : key === 'atlas' ? [bk.out ? 'Click to put it back' : 'Click to open the atlas', bk.out ? 'Bấm để cất sách' : 'Bấm để mở tập bản đồ']
      : key.startsWith('read') ? [bk.out ? 'Click to put it back' : 'Click to open the book', bk.out ? 'Bấm để cất sách' : 'Bấm để mở sách'] : null;
    t.innerHTML = `<b><span class="en">${esc(titleIn(it, 'en'))}</span><span class="vi">${esc(it.title)}</span></b>`
      + (by || n ? `<small><span class="en">${line(n && n + ' pages')}</span><span class="vi">${line(n && n + ' trang')}</span></small>` : '')
      + (hint ? `<small><span class="en">${esc(hint[0])}</span><span class="vi">${esc(hint[1])}</span></small>` : '');
    t.classList.add('is-on');
  }
  t.style.left = Math.max(8, Math.min(x + 16, innerWidth - t.offsetWidth - 8)) + 'px';
  t.style.top = (y - t.offsetHeight - 14 > 8 ? y - t.offsetHeight - 14 : y + 22) + 'px';
}
function buildOverlay() {
  const ui = document.createElement('div'); ui.id = 'l3-ui'; ui.innerHTML = `<svg id="l3-lines" aria-hidden="true"></svg><div id="l3-labels"></div>
    <section id="l3-card" class="l3-card" aria-labelledby="l3-card-h" hidden>
      <header class="l3-card-head"><h3 id="l3-card-h"></h3><span class="l3-count" id="l3-count"></span><button type="button" class="l3-close" id="l3-close" aria-label="Close / Đóng">&times;</button></header>
      <ul class="l3-items" id="l3-items"></ul></section>
    <div id="l3-tip" class="l3-tip" aria-hidden="true"></div>`;
  body.appendChild(ui); Object.assign(UIEL, { ui, svg: ui.querySelector('#l3-lines'), labels: ui.querySelector('#l3-labels'), card: ui.querySelector('#l3-card'), items: ui.querySelector('#l3-items'), tip: ui.querySelector('#l3-tip') });
  for (const sec of UIS.secs) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'l3-label l3-' + sec.group; b.dataset.sec = sec.id;
    b.innerHTML = `<span class="en">${esc(sec.en)}</span><span class="vi">${esc(sec.vi || sec.en)}</span><i>${sec.count}</i>`;
    b.addEventListener('click', () => openSection(sec)); b.addEventListener('pointerenter', () => setHover(sec)); b.addEventListener('pointerleave', () => setHover(null));
    UIEL.labels.appendChild(b); sec.label = b;
  }
  UIEL.caps = {};   // the two parts of the room, named like the sidebar groups
  for (const [g, en, vi] of [['books', 'Books', 'Sách'], ['research', 'Research', 'Nghiên cứu']]) {
    if (!UIS.secs.some(s => s.group === g)) continue;
    const h = document.querySelector(`.toc-group[data-group="${g}"] .toc-group-h`), txt = cls => { const n = h && h.querySelector('.' + cls); return n ? n.textContent.trim() : ''; };
    const c = document.createElement('button'); c.type = 'button'; c.className = 'l3-cap l3-cap-' + g;   // (a click: that part of the room, close: G, 17/10/2026)
    c.addEventListener('click', () => (g === 'research' ? showResearch() : showBooks()));
    c.innerHTML = `<span class="en">${esc(txt('en') || en)}</span><span class="vi">${esc(txt('vi') || vi)}</span>`; UIEL.labels.appendChild(c); UIEL.caps[g] = c;
  }
  UIEL.card.querySelector('#l3-close').addEventListener('click', () => closeCard());
  UIEL.items.addEventListener('click', e => {
    const row = e.target.closest('.l3-item'); if (!row) return; const it = UIS.open && UIS.open.items[+row.dataset.k]; if (!it) return;
    const chip = e.target.closest('[data-chip]');
    if (chip && isReadItem(it) && it.book) {   // a book of notes: a note's name turns the book to it (no dialog)
      e.preventDefault(); const c = it.chips[+chip.dataset.chip], k = it.chips.filter(x => x.el && x.el.dataset && x.el.dataset.dialog).indexOf(c);
      if (k >= 0) { setMapBook(it.book); readTurnTo(it.book, k + 1); } return;
    }
    if (chip) { const c = it.chips[+chip.dataset.chip]; if (c && !c.href) c.el.click(); return; }
    if (opensFlat(it) && it.book) { e.preventDefault(); setMapBook(UIS.mapBook === it.book ? null : it.book); return; }
    if (e.target.closest('.l3-play') || (it.src && !e.target.closest('a'))) { const p = it.li.querySelector('.play'); if (p) p.click(); }
  });
  UIEL.items.addEventListener('pointerover', e => { const row = e.target.closest('.l3-item'); const it = row && UIS.open && UIS.open.items[+row.dataset.k]; setPeek(it && it.book ? it.book : null); });
  UIEL.items.addEventListener('pointerleave', () => setPeek(null));
}
function setPeek(bk) { if (UIS.peek === bk) return; if (UIS.peek) UIS.touched.add(UIS.peek); UIS.peek = bk; if (bk) UIS.touched.add(bk); setNeeds(true); }
// the atlas taken out of its shelf and opened on its map (null: put back); its row in the card marked
function setMapBook(bk) {
  if (UIS.mapBook === bk) return; if (UIS.mapBook) UIS.touched.add(UIS.mapBook); UIS.mapBook = bk; if (bk) UIS.touched.add(bk);
  if (UIEL.items) for (const row of UIEL.items.querySelectorAll('.l3-item')) { const it = UIS.open && UIS.open.items[+row.dataset.k]; row.classList.toggle('is-current', !!(bk && it && it.book === bk)); }
  setNeeds(true);
}
function setHover(sec) {   // a section, or several (a group's title in the sidebar), or none
  const list = Array.isArray(sec) ? sec : sec ? [sec] : [], key = list.map(s => s.id).join('|');
  if (UIS.hoverKey === key) return; UIS.hoverKey = key; UIS.hover = list.length === 1 ? list[0] : null; UIS.hovers = new Set(list);
  for (const s of UIS.secs) s.label.classList.toggle('is-hover', UIS.hovers.has(s));
  CANVAS.style.cursor = list.length ? 'pointer' : ''; setNeeds(true);
}
function renderCard(sec) {
  UIEL.card.querySelector('#l3-card-h').innerHTML = `<span class="en">${esc(sec.en)}</span><span class="vi">${esc(sec.vi || sec.en)}</span>`;
  UIEL.card.querySelector('#l3-count').textContent = sec.count;
  UIEL.items.innerHTML = sec.items.map((it, k) => {
    if (it.head) return `<li class="l3-sub" data-cat="${esc(it.cat)}"><span class="en">${esc(it.en)}</span><span class="vi">${esc(it.vi)}</span><i>${it.count}</i></li>`;
    if (it.sep) return '<li class="l3-sep" role="separator"></li>';
    // the title in the page's language (English: the original title, its full form on hover), the author and the pages
    const info = bookInfo(it), en = titleIn(it, 'en'), name = en === it.title ? esc(it.title) : `<span class="en">${esc(en)}</span><span class="vi">${esc(it.title)}</span>`;
    const full = info && info.full ? ` title="${esc(info.full)}"` : '';
    const atlas = isMapItem(it), read = isReadItem(it), flat = atlas || read;   // (an atlas's row is no link: its page is reached through its map)
    const title = it.href && !atlas ? `<a href="${esc(it.href)}" target="_blank" rel="noopener noreferrer"${full}>${name}</a>` : full ? `<span${full}>${name}</span>` : name;
    const by = byOf(it), pages = info && info.pages ? `<span class="en">${info.pages} pages</span><span class="vi">${info.pages} trang</span>` : '';
    const chips = it.chips.map((c, ci) => c.href ? `<a class="l3-chip" href="${esc(c.href)}" target="_blank" rel="noopener noreferrer">${esc(c.label)} ↗</a>` : `<button type="button" class="l3-chip" data-chip="${ci}">${esc(c.label)}</button>`).join('');
    const play = it.src ? `<button type="button" class="l3-play" aria-label="Play / Phát: ${esc(it.title)}"><svg class="i ic-play" aria-hidden="true"><use href="#i-play"/></svg><svg class="i ic-pause" aria-hidden="true"><use href="#i-pause"/></svg></button>`
      : atlas ? '<span class="l3-map" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z M9 4.5v13 M15 6.5v13"/></svg></span>'
      : read ? '<span class="l3-map" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 6.6C9.6 5.1 6.6 4.7 3.5 5.3v13c3.1-.6 6.1-.2 8.5 1.3 2.4-1.5 5.4-1.9 8.5-1.3v-13c-3.1-.6-6.1-.2-8.5 1.3z M12 6.6v13"/></svg></span>' : '<span class="l3-noplay"></span>';   // (an atlas: a folded map; a book of notes: an open book)
    return `<li class="l3-item${it.src ? ' has-audio' : ''}${flat ? ' is-atlas' : ''}${flat && UIS.mapBook && UIS.mapBook.it === it ? ' is-current' : ''}" data-k="${k}">${play}<div class="l3-main"><span class="l3-t${it.bold ? ' is-bold' : ''}">${title}</span>${by || pages ? `<span class="l3-by">${esc(by)}${by && pages ? ' · ' : ''}${pages}</span>` : ''}${chips ? `<div class="l3-chips">${chips}</div>` : ''}</div><span class="l3-time"></span></li>`;
  }).join('');
  refreshCard();
}
function refreshCard() {   // mirror play state and time from the page's hidden rows
  if (!UIS.open) return;
  for (const row of UIEL.items.querySelectorAll('.l3-item')) {
    const it = UIS.open.items[+row.dataset.k]; if (!it || !it.li) continue; const cl = it.li.classList;
    row.classList.toggle('is-current', opensFlat(it) ? !!(UIS.mapBook && UIS.mapBook.it === it) : cl.contains('is-current')); row.classList.toggle('is-playing', cl.contains('is-playing')); row.classList.toggle('is-loading', cl.contains('is-loading'));
    const tm = it.li.querySelector('.time'); const txt = tm ? tm.textContent : ''; const el = row.querySelector('.l3-time'); if (el.textContent !== txt) el.textContent = txt;
  }
}
function openSection(sec, cat) {
  if (offMode()) return;
  if (UIS.mapBook && UIS.mapBook.sec !== sec) setMapBook(null);
  UIS.open = sec; UIS.mode = 'focus'; renderCard(sec); UIEL.card.hidden = false; UIEL.card.classList.remove('is-in'); requestAnimationFrame(() => UIEL.card.classList.add('is-in'));
  const sub = cat && UIEL.items.querySelector(`.l3-sub[data-cat="${CSS.escape(cat)}"]`);   // a research category: scroll its heading to the top
  UIEL.items.scrollTop = sub ? sub.offsetTop - UIEL.items.offsetTop - 4 : 0;
  for (const h of UIEL.items.querySelectorAll('.l3-sub')) h.classList.toggle('is-target', h === sub);
  for (const s of UIS.secs) s.glowT = s === sec ? 1 : 0;
  goView(focusView(sec)); if (UIS.active) UIS.touched.add(UIS.active); setNeeds(true);
}
function closeCard(home = true) {
  if (!UIS.open && !home) return;
  const was = UIS.open; UIS.open = null; UIEL.card.classList.remove('is-in'); setTimeout(() => { if (!UIS.open) UIEL.card.hidden = true; }, 260);
  for (const s of UIS.secs) s.glowT = 0; setSpine(null); setPeek(null); setMapBook(null);
  if (home) { UIS.mode = 'home'; goView(homeView()); }
  if (UIS.active) UIS.touched.add(UIS.active); setNeeds(true); return was;
}
function showResearch() { closeCard(false); UIS.mode = 'research'; goView(researchView()); }
function showBooks() { const v = booksView(); if (!v) return; closeCard(false); UIS.mode = 'books'; goView(v); }
function stepGlow(dt) {
  let moving = false;
  for (const s of UIS.secs) {
    const tgt = Math.max(s.glowT, UIS.hovers.has(s) ? 0.6 : 0);
    if (Math.abs(s.glow - tgt) > 1e-3) { s.glow += THREE.MathUtils.clamp(tgt - s.glow, -dt * 3, dt * 3); moving = true; }
    const showing = [UIS.active, UIS.mapBook].some(b => b && b.sec === s && b.goal === 'present');   // the book in front reads better on a calm shelf
    s.glowMesh.material.opacity = s.glow * (NIGHT.u.value > 0.5 ? 0.42 : 0.5) * (showing ? 0.6 : 1); s.glowMesh.visible = s.glow > 0.001;
  }
  return moving;
}
const _p = new V3(), _face = new THREE.Plane(), _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
function faceAnchor(b, sx, sy) {   // the point of a section's face seen at screen (sx, sy), kept inside the section (a row: on its board)
  _ndc.set(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1); _ray.setFromCamera(_ndc, camera);
  _face.setFromNormalAndCoplanarPoint(b.normal, b.face);
  return _ray.ray.intersectPlane(_face, _p) ? _p.clone().clamp(b.lo, b.hi) : null;
}
function project(v) { _p.copy(v).project(camera); return { x: (_p.x * 0.5 + 0.5) * innerWidth, y: (-_p.y * 0.5 + 0.5) * innerHeight, ok: _p.z > -1 && _p.z < 1 }; }
function layoutOverlay() {
  if (!UIEL.ui) return;
  const side = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 290;
  const show = !offMode(), home = UIS.mode === 'home';
  const boxes = [], lines = [];
  // a label hangs at `tag` (+dx, dy px; 'left' starts there, 'center' centres on it); it shows while `anchor` is in view
  const place = (el, anchor, tag, dx, dy, align, visible, sec) => {
    if (!visible) { el.classList.add('is-off'); return; }
    const a = project(anchor), t = tag === anchor ? a : project(tag);
    const inView = a.ok && a.x > side + 6 && a.x < innerWidth - 6 && a.y > 6 && a.y < innerHeight - 6;
    if (!inView) { el.classList.add('is-off'); return; }
    el.classList.remove('is-off'); const w = el.offsetWidth, h = el.offsetHeight;
    let x = t.x + dx - (align === 'right' ? w : align === 'left' ? 0 : w / 2), y = t.y + dy - h / 2;
    x = THREE.MathUtils.clamp(x, side + 10, innerWidth - w - 10); y = THREE.MathUtils.clamp(y, 10, innerHeight - h - 10);
    boxes.push({ el, a, x, y, w, h, sec });
  };
  for (const s of UIS.secs) {
    const vis = show && (home || UIS.mode === s.group);   // (in the close-up of its part of the room, its own labels)
    const lh = s.label.offsetHeight || 26;   // (the labels' size follows the window: build.py's CSS)
    if (s.group === 'books') place(s.label, s.box.plate, s.box.tag, 30 + lh * 0.4, 0, 'left', vis, s);   // on its row, just past the plate
    else place(s.label, s.box.plate, s.box.tag, 0, -31 - lh / 2, 'center', vis, s);                       // above its bay
  }
  // the shelf's labels in one column at the left edge of their rows (the frame of the four shelves: G, 15/10/2026), each
  // in its own row (centred on the row's middle line where the label is), all starting at the frame's edge. They keep the
  // size G asked for (twice the first) where the frame has room for the widest; on a narrower window they are made just
  // small enough to fit in it (--l3-k, not below 62 %), and only then would the column move left of the edge
  const shelfCol = boxes.filter(b => b.el.classList.contains('l3-books'));
  if (shelfCol.length) {
    const rowsAt = shelfCol.map(b => { const c = b.sec.box.corners, L0 = project(c[0]), L1 = project(c[3]), R0 = project(c[1]), R1 = project(c[2]);
      return { b, ok: L0.ok && L1.ok && R0.ok && R1.ok, xl: (L0.x + L1.x) / 2, yl: (L0.y + L1.y) / 2, xr: (R0.x + R1.x) / 2, yr: (R0.y + R1.y) / 2 }; });
    if (rowsAt.every(r => r.ok)) {
      const edge = Math.max(...rowsAt.map(r => r.xl)) + 14, room = innerWidth - 10 - edge, k0 = UIEL.booksK || 1, wNow = Math.max(...shelfCol.map(b => b.w)), w1 = wNow / k0;
      if (wNow > room + 1 || (k0 < 1 && room / w1 > k0 + 0.03)) {   // (a step at a time, with some slack: no flicker between two sizes)
        const k = THREE.MathUtils.clamp(Math.floor(room / w1 * 100) / 100, 0.62, 1);
        if (k !== k0) { UIEL.booksK = k; UIEL.labels.style.setProperty('--l3-k', k); for (const b of shelfCol) { b.w = b.el.offsetWidth; b.h = b.el.offsetHeight; } }
      }
      const wMax = Math.max(...shelfCol.map(b => b.w)), x = Math.max(side + 10, Math.min(edge, innerWidth - 10 - wMax));
      // each lies along its shelf (G, 15/10/2026): sheared to the slope of its row on the screen (its boards rise toward the
      // viewer above eye level and fall below it), its upright strokes kept upright, as if printed on the shelf's face
      for (const r of rowsAt) { const cx = x + r.b.w / 2, k = (cx - r.xl) / Math.max(1, r.xr - r.xl); r.b.x = x; r.b.y = THREE.MathUtils.clamp(r.yl + (r.yr - r.yl) * k - r.b.h / 2, 10, innerHeight - r.b.h - 10);
        r.b.skew = THREE.MathUtils.clamp(Math.atan((r.yr - r.yl) / Math.max(1, r.xr - r.xl)), -0.45, 0.45); }
    }
  }
  // the bays' labels in a row over them, left to right, each as near over its bay as the one before allows; kept clear of
  // the shelf's labels on the right (the row moves left, toward the panel, as far as it can), and a label that still
  // will not fit starts a second row under the first
  const row = boxes.filter(b => b.el.classList.contains('l3-research')).sort((p, q) => p.a.x - q.a.x);
  if (row.length > 1) {
    const books = boxes.filter(b => b.el.classList.contains('l3-books')), h = Math.max(...row.map(b => b.h)), x0 = side + 10;
    const limAt = y => Math.min(innerWidth - 10, ...books.filter(b => b.y < y + h + 8 && b.y + b.h > y - 8).map(b => b.x - 16));
    let y = Math.min(...row.map(b => b.y)), line = [];
    // (clear of the page's sky clock and its weather line above them)
    const clock = document.querySelector('.page.is-active .sky'), cq = clock && clock.getBoundingClientRect(), cr = cq && cq.height > 0 && cq.left < innerWidth && cq.right > side ? cq : null;
    if (cr) y = Math.max(y, cr.bottom + 10);
    const settle = () => { if (!line.length) return; const last = line[line.length - 1], over = last.x + last.w - limAt(y);
      if (over > 0) { const room = line[0].x - x0, d = Math.min(over, room); for (const b of line) b.x -= d; } };
    for (const b of row) {
      const prev = line[line.length - 1]; b.y = y; b.x = Math.max(b.a.x - b.w / 2, prev ? prev.x + prev.w + 12 : x0);
      line.push(b); settle();
      if (b.x + b.w > limAt(y) && line.length > 1) {   // no room left in this row: it goes down to the next
        line.pop(); y += h + 8; line = [b]; b.y = y; b.x = Math.max(x0, Math.min(b.a.x - b.w / 2, limAt(y) - b.w));
      }
    }
    // the group's name over the row: centred over it, or as far left (toward the panel, no further than the row's start)
    // as it must to keep clear of the clock; if it still meets the clock, the row goes down under it
    const cap = UIEL.caps && UIEL.caps.research; UIEL.capAt = null;
    if (cap) {
      const cw = cap.offsetWidth, ch = cap.offsetHeight, l = Math.min(...row.map(b => b.x)), r = Math.max(...row.map(b => b.x + b.w)), top = Math.min(...row.map(b => b.y));
      const meets = (x, yy) => cr && x < cr.right + 12 && x + cw > cr.left - 12 && yy < cr.bottom + 6 && yy + ch > cr.top;
      let cx = THREE.MathUtils.clamp((l + r - cw) / 2, side + 10, innerWidth - cw - 10), cy = top - ch - 10;
      if (meets(cx, cy)) cx = Math.max(side + 10, l, Math.min(cx, cr.left - 12 - cw));
      if (meets(cx, cy)) { const d = cr.bottom + 6 - cy; for (const b of row) b.y += d; cy += d; }
      UIEL.capAt = { research: [cx, cy] };
    }
  }
  boxes.sort((p, q) => p.y - q.y);
  for (let k = 1; k < boxes.length; k++) for (let j = 0; j < k; j++) {
    const p = boxes[j], q = boxes[k];
    if (q.x < p.x + p.w + 8 && q.x + q.w + 8 > p.x && q.y < p.y + p.h + 6) q.y = p.y + p.h + 6;
  }
  for (const b of boxes) {   // (no leader lines to the shelves: G, 16/10/2026; each label stands on its own row or bay)
    const sk = b.skew || 0;
    b.el.style.transform = `translate(${Math.round(b.x)}px, ${Math.round(b.y)}px)` + (sk ? ` skewY(${sk.toFixed(4)}rad)` : '');
  }
  // the group names sit over their labels: Books over the stack of rows, Research centred over the three bays
  for (const [g, cap] of Object.entries(UIEL.caps)) {
    const bs = boxes.filter(b => b.el.classList.contains('l3-' + g));
    if (!bs.length) { cap.classList.add('is-off'); continue; }
    cap.classList.remove('is-off'); const w = cap.offsetWidth, h = cap.offsetHeight, l = Math.min(...bs.map(b => b.x)), r = Math.max(...bs.map(b => b.x + b.w));
    const first = bs.reduce((p, q) => q.y < p.y ? q : p), sk = first.skew || 0;
    if (g === 'research' && UIEL.capAt && UIEL.capAt.research) {   // (placed with its row: clear of the clock)
      const [x, y] = UIEL.capAt.research; cap.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; continue;
    }
    // over a sheared label: along it, above its edge there; moved on along it (right) where it would meet the clock
    const clock = document.querySelector('.page.is-active .sky'), cr = clock && clock.getBoundingClientRect(), t = Math.tan(sk);
    const yAt = x => sk ? first.y + (x + w / 2 - first.x - first.w / 2) * t - h - 10 : first.y - h - 10;
    let x = g === 'books' ? l + 6 : (l + r - w) / 2, y = yAt(x);
    const ext = (x, y) => [y - Math.abs(t) * w / 2, y + h + Math.abs(t) * w / 2];   // (its height on the screen, sheared)
    const meets = (x, y) => { if (!cr || !cr.height) return false; const [a, b] = ext(x, y); return x < cr.right + 12 && x + w > cr.left - 12 && a < cr.bottom + 6 && b > cr.top; };
    if (meets(x, y)) { x = Math.min(cr.right + 12, first.x + first.w - w); y = yAt(x); }
    if (y < 8) { x = first.x - w - 12; y = first.y + (first.h - h) / 2; }   // no room above (a very wide window): beside the first label
    x = THREE.MathUtils.clamp(x, side + 10, innerWidth - w - 10);
    cap.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)` + (sk ? ` skewY(${sk.toFixed(4)}rad)` : '');
  }
  // a white outline around the section under the pointer (and, fainter, around the open one): the boards of a row, the posts of a bay;
  // not the open one's while a book lies open in front of it (its lines would cross the pages)
  const bookOpen = !!(UIS.mapBook && UIS.mapBook.out && UIS.mapBook.flapU && UIS.mapBook.flapU.uOpen.value > 0.5);
  for (const [sec, cls] of [[UIS.open, 'l3-outline is-open'], ...[...UIS.hovers].map(s => [s, 'l3-outline'])]) {
    if (!sec || !show || (cls === 'l3-outline is-open' && (UIS.hovers.has(sec) || bookOpen))) continue;
    const pts = sec.box.corners.map(project); if (pts.some(q => !q.ok)) continue;
    lines.push(`<polygon class="${cls}" points="${pts.map(q => q.x.toFixed(1) + ',' + q.y.toFixed(1)).join(' ')}"/>`);
  }
  if (UIS.open && !UIEL.card.hidden && !bookOpen) {   // the open card points at its section, at the first books right of the card
    const r = UIEL.card.getBoundingClientRect(), b = UIS.open.box, p = faceAnchor(b, r.right + 46, r.top + 40), a = project(p || b.plate);
    const ey = THREE.MathUtils.clamp(a.y, r.top + 30, r.bottom - 30);
    if (a.ok) lines.push(`<path class="l3-card-line" d="M${a.x.toFixed(1)},${a.y.toFixed(1)} L${(r.right).toFixed(1)},${ey.toFixed(1)}"/><circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="4"/>`);
  }
  UIEL.svg.innerHTML = lines.join('');
}
/* ---- picking in the room */
const RAY = new THREE.Raycaster(), NDC = new THREE.Vector2(); RAY.layers.enable(3);   // (the book out of the shelf is on its own layer: hero-books.js)
// where the pointer's ray meets an open atlas: its map page, or its cover turned open (which the ray cannot find in the
// mesh: it turns in the shader); worked out in the book's own frame, in metres. Its distance along the ray, for the order
const _mi = new THREE.Matrix4(), _mo = new THREE.Vector3(), _md = new THREE.Vector3();
function bookRay(bk) {   // the pointer's ray in an open book's own frame, in metres
  const h = bk && bk.hero; if (!h || !h.visible || !bk.heroShape || !bk.flapU || bk.flapU.uOpen.value < 1.2) return null;
  _mi.copy(h.matrixWorld).invert();
  const o = _mo.copy(RAY.ray.origin).applyMatrix4(_mi), d = _md.copy(RAY.ray.origin).add(RAY.ray.direction).applyMatrix4(_mi).sub(o);
  o.multiply(h.scale); d.multiply(h.scale);   // (the unit box back into metres)
  return { o, d };
}
function mapHit(bk) {
  const r = bookRay(bk); if (!r) return null;
  const { o, d } = r, S = bk.heroShape, pg = S.page, hits = [];
  if (Math.abs(d.x) > 1e-9) { const t = (pg.x - o.x) / d.x, y = o.y + d.y * t, z = o.z + d.z * t; if (t > 0 && y > pg.y0 && y < pg.y1 && z < pg.z0 && z > pg.z1) hits.push({ at: 'page', t }); }
  const a = bk.flapU.uOpen.value, H = S.hinge, ax = Math.sin(a), az = -Math.cos(a), nx = Math.cos(a), nz = Math.sin(a), den = d.x * nx + d.z * nz;
  if (Math.abs(den) > 1e-9) {
    const t = ((H.x - o.x) * nx + (H.y - o.z) * nz) / den, x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, L = (x - H.x) * ax + (z - H.y) * az;
    if (t > 0 && L > 0 && L < bk.d && y > 0 && y < bk.h) hits.push({ at: 'cover', t });
  }
  return hits.sort((p, q) => p.t - q.t)[0] || null;
}
function pickAt(e) {
  const r = CANVAS.getBoundingClientRect(); NDC.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  RAY.setFromCamera(NDC, camera);
  const ob = UIS.mapBook && UIS.mapBook.out ? UIS.mapBook : null;
  if (ob && ob.read) { const r = bookRay(ob), rh = r && readHit(ob, r.o, r.d); if (rh) return { book: ob, read: rh }; }   // (a book of notes: its pages)
  else { const mh = ob ? mapHit(ob) : null; if (mh) return { book: ob, map: mh.at === 'page' }; }
  // books first (they stand just behind their section's face): those of the open section, and the one out of the shelf
  const books = UIS.open ? UIS.open.books.map(b => b.hit) : [];
  for (const b of [UIS.active, UIS.peek]) if (b && b.hero && b.hero.visible) books.push(b.hero);
  const hb = books.length ? RAY.intersectObjects(books, false)[0] : null; if (hb) return { book: hb.object.userData.book };
  const hs = RAY.intersectObjects(UIS.secs.map(s => s.hit), false)[0], hd = DECK.ok ? RAY.intersectObject(DECK.hit, false)[0] : null;
  if (hd && (!hs || hd.distance < hs.distance)) return { deck: true };
  return hs ? { sec: hs.object.userData.sec } : null;
}
function activateItem(it) {   // what a click on its book does: play it, else (an atlas, a book of notes) take it out to open, else open its link, else its first extra (a note, a chart…)
  const pl = it.li && it.li.querySelector('.play'); if (pl) { pl.click(); return; }
  if (opensFlat(it) && it.book) { setMapBook(it.book); return; }
  if (it.href) { window.open(it.href, '_blank', 'noopener'); return; }
  const c = it.chips[0]; if (c) { if (c.href) window.open(c.href, '_blank', 'noopener'); else c.el.click(); }
}
function setSpine(bk) {   // a book of the open section under the pointer: it leans out and its row lights up in the card
  if (UIS.spine === bk) return; UIS.spine = bk;
  for (const row of UIEL.items.querySelectorAll('.l3-item.is-hot')) row.classList.remove('is-hot');
  const row = bk && UIS.open === bk.sec ? UIEL.items.querySelector(`.l3-item[data-k="${UIS.open.items.indexOf(bk.it)}"]`) : null;
  if (row) {
    row.classList.add('is-hot'); const L = UIEL.items, top = row.offsetTop - L.offsetTop;
    if (top < L.scrollTop || top + row.offsetHeight > L.scrollTop + L.clientHeight) L.scrollTop = top - (L.clientHeight - row.offsetHeight) / 2;
  }
  setPeek(bk);
}
function bindPicking() {
  let down = null;
  CANVAS.addEventListener('pointermove', e => {
    if (!ready || offMode()) return;
    const p = pickAt(e), bk = p && p.book && p.book.sec === UIS.open ? p.book : null;
    setSpine(bk); showTip(p && p.book ? p.book : null, e.clientX, e.clientY, !!(p && p.map), p && p.read ? readHint(p.book, p.read) : null); setHover(!p || p.book || p.deck || UIS.open === p.sec ? null : p.sec);
    CANVAS.style.cursor = p && (p.book || p.deck || UIS.open !== p.sec) ? 'pointer' : '';
    const dh = !!(p && p.deck); if (dh !== DECK.hover) { DECK.hover = dh; CANVAS.title = dh ? (document.documentElement.lang === 'vi' ? 'Máy hát' : 'Record player') : ''; setNeeds(true); }
  });
  CANVAS.addEventListener('pointerleave', () => { setHover(null); setSpine(null); showTip(null); if (DECK.hover) { DECK.hover = false; CANVAS.title = ''; setNeeds(true); } });
  CANVAS.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; showTip(null); });
  CANVAS.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600 || offMode()) { down = null; return; }
    down = null; const p = pickAt(e);
    if (p && p.book && p.book === UIS.mapBook && p.book.out) {   // an open atlas: its map opens its page, the rest of it puts it back; a book of notes: its pages turn, its board puts it back
      if (p.read) { if (!readClick(p.book, p.read)) setMapBook(null); }
      else if (p.map) window.open(p.book.it.href, '_blank', 'noopener'); else setMapBook(null);
    }
    else if (p && p.book && p.book === UIS.active && p.book.out) { const x = document.getElementById('np-close'); if (x) x.click(); }   // the book out of the shelf: back to its place (the player closes)
    else if (p && p.book) activateItem(p.book.it);
    else if (p && p.deck) togglePlayer();   // the record player on the floor: the page's player comes out (or goes away)
    else if (p && p.sec) openSection(p.sec);
    else if (UIS.mode !== 'home') closeCard();
  });
  addEventListener('keydown', e => { if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return; if (UIS.mode !== 'home') closeCard(); else togglePlayer(false); });
  // a title in the sidebar under the pointer: its section is shown chosen in the room, as when its label there is
  // hovered; a group's title (Books, Research) lights all of its sections (G, 15/10/2026)
  const toc = document.getElementById('toc-groups');
  if (toc) {
    const secsOf = el => {
      const lk = el && el.closest ? el.closest('.toc-link[href]') : null, bk = lk && toc.contains(lk) ? atlasOf(lk) : null; if (bk) return bk.sec;
      const a = el && el.closest ? el.closest('.toc-link[data-nav], [data-goto]') : null; if (!a || !toc.contains(a)) return null;
      if (a.dataset.nav) return UIS.byCat.get(a.dataset.nav) || null;
      const g = a.dataset.goto; return UIS.byId.get(g) || (g === 'books' || g === 'research' ? UIS.secs.filter(s => s.group === g) : null);
    };
    toc.addEventListener('pointerover', e => { if (ready && !offMode()) setHover(secsOf(e.target)); });
    toc.addEventListener('pointerleave', () => setHover(null));
  }
  // the sidebar and the now-playing bar steer the room (the page's own handlers still run on the hidden pages)
  document.addEventListener('click', e => {
    if (!ready) return;
    const lk = e.target.closest('.toc .toc-link[href]'), atlas = lk && !lk.dataset.nav && !offMode() ? atlasOf(lk) : null;
    if (atlas) { e.preventDefault(); openSection(atlas.sec); setMapBook(atlas); return; }   // (an atlas's page: through its map)
    const nav = e.target.closest('.toc-link[data-nav]');
    if (nav) { const s = UIS.byCat.get(nav.dataset.nav); if (s) { e.preventDefault(); openSection(s, s.group === 'research' ? nav.dataset.nav : null); } return; }
    const go = e.target.closest('.toc [data-goto]');   // Books: the whole room; Research: the back bookcase; a research topic: its bay
    if (go) { e.preventDefault(); const g = go.dataset.goto, s = UIS.byId.get(g); if (g === 'books') showBooks(); else if (s && s.group === 'research') openSection(s); else showResearch(); return; }
    if (e.target.closest('#np-info')) { const cur = document.querySelector('#pages .item.is-current') || null; const bk = cur && UIS.bySrc.get(cur.dataset.src); if (bk) openSection(bk.sec); }
  }, true);
}
function atlasOf(a) {   // the atlas whose page a link goes to
  const href = a.getAttribute('href'); if (!href) return null;
  for (const s of UIS.secs) for (const bk of s.books) if (bk.it.href === href && isMapItem(bk.it)) return bk;
  return null;
}
function buildInterface() {
  buildSections(); buildRecordPlayer(); buildOverlay(); bindPicking(); syncActive();
  const pages = document.getElementById('pages');
  let pend = 0; new MutationObserver(() => { if (pend) return; pend = setTimeout(() => { pend = 0; syncActive(); refreshCard(); }, 30); })
    .observe(pages, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true, characterData: true });
}
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
  await notBefore(600); reveal(1);
  buildNightSky(); buildFireflies(); await compileFor(OVER.skyScene, null); await compileFor(OVER.scene, null);   // (the sharp layer: drawn on the page's own canvas)
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
/* ---------------------------------------------------------------- page hooks */
addEventListener('resize', () => {
  if (!ready) return; resize();
  if (CAM.k >= 1) { CAM.cur = UIS.open ? focusView(UIS.open) : UIS.mode === 'research' ? researchView() : UIS.mode === 'books' ? (booksView() || homeView()) : homeView(); applyView(CAM.cur); }
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
}
