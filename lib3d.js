// three.js is fetched only where the room is shown (wide screens with WebGL 2): phones never download it. If it cannot
// be fetched (offline, a blocked CDN) the page gets lib3d-failed and keeps its own card layout.
const LIB = innerWidth > 768 && window.WebGL2RenderingContext ? await Promise.all([
  import('three'), import('three/addons/libs/meshopt_decoder.module.js'), import('three/addons/lights/RectAreaLightUniformsLib.js'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/postprocessing/Pass.js'), import('three/addons/utils/BufferGeometryUtils.js')
]).catch(e => { console.warn('3D library unavailable', e); document.documentElement.classList.add('lib3d-failed'); return null; }) : null;
if (LIB) {
const [THREE, { MeshoptDecoder }, { RectAreaLightUniformsLib }, { GLTFLoader }, { FullScreenQuad }, { mergeGeometries }] = LIB;
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
/* ---------------------------------------------------------------- utils */
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(20261012);
const rr = (a, b) => a + (b - a) * rand();
const pick = arr => arr[Math.floor(rand() * arr.length)];
// value noise (tileable over period p)
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
const _px = new THREE.Color(), hslPx = (h, s, l) => _px.setHSL(h / 360, s, l);   // per-pixel painters: no allocation

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
/* ---------------------------------------------------------------- textures */
function woodPlanks({ w = 512, h = 2048, planks = 6, hue = 33, sat = .52, light = .60, vary = .07, seed = 3, gap = 0.42, grain = 1 } = {}) {
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data; const r = rng(seed);
  const pw = w / planks, segs = [];
  for (let i = 0; i < planks; i++) { const list = []; let v = r() * h; const start = v; while (v < start + h) { const len = (0.22 + r() * 0.35) * h; list.push({ a: v, b: v + len, l: light + (r() - .5) * 2 * vary, hu: hue + (r() - .5) * 6, s: sat + (r() - .5) * .12, k: r() * 100 }); v += len; } segs.push(list); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
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
    const col = hslPx(seg.hu + (streak - .5) * 4, seg.s, Math.min(.92, l));
    const o = (y * w + x) * 4; d[o] = col.r * 255; d[o + 1] = col.g * 255; d[o + 2] = col.b * 255; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}
function grainTex({ w = 256, h = 1024, hue = 32, sat = .55, light = .58, seed = 9 } = {}) {
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h; const wob = fbm(u * 3 + seed, v * 2, 3, 3, 2) * 2.2;
    const s = fbm(u * 18 + wob, v * 3, 4, 18, 3); const ring = 0.5 + 0.5 * Math.sin((u * 7 + wob * 1.6) * 6.283);
    const col = hslPx(hue + (s - .5) * 5, sat, light * (0.84 + 0.24 * s) * (0.94 + 0.07 * ring));
    const o = (y * w + x) * 4; d[o] = col.r * 255; d[o + 1] = col.g * 255; d[o + 2] = col.b * 255; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}
function noiseTex(w, h, f, { base = [235, 228, 214], amp = 30, oct = 5, seed = 0 } = {}) {
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const n = fbm(x / w * f + seed, y / h * f, oct, f, f) - .5; const o = (y * w + x) * 4; d[o] = base[0] + n * amp; d[o + 1] = base[1] + n * amp; d[o + 2] = base[2] + n * amp * 1.1; d[o + 3] = 255; }
  g.putImageData(img, 0, 0); return c;
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
const TEX = {};
async function buildTextures() {
  TEX.floor = ctex(woodPlanks({ hue: 28, sat: .55, light: .5, vary: .06, seed: 3 }));
  TEX.floor.repeat.set(1 / 1.08, 1 / 4.32);
  await tick();
  TEX.ceil = ctex(woodPlanks({ w: 256, h: 1024, planks: 8, hue: 27, sat: .5, light: .42, vary: .035, seed: 11, gap: .6, grain: 1.4 }));   // mostly out of view: half size
  TEX.ceil.repeat.set(1 / 1.08, 1 / 4.32);
  await tick();
  TEX.oak = ctex(grainTex({ hue: 29, sat: .5, light: .5 }));
  TEX.frame = ctex(grainTex({ hue: 25, sat: .52, light: .42, seed: 4 }));
  await tick();
  TEX.fabric = ctex(noiseTex(256, 256, 64, { base: [128, 128, 128], amp: 90, oct: 3 }), { srgb: false });
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
  const glass = new THREE.Mesh(mergeGeometries(gl), MAT.glass); glass.renderOrder = 2; room.add(glass);
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
      e.b.m.multiplyMatrices(cell.B, new THREE.Matrix4().makeTranslation(s.nx0 + (e.x0 - s.x0) + sz.t / 2, 0, z).multiply(new THREE.Matrix4().makeScale(sz.t, sz.h, d)));
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
/* ---------------------------------------------------------------- outside */
const outside = new THREE.Group(); scene.add(outside);
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
    fragmentShader: `uniform float uNight, uTime, uDay, uGlow, uWarm; uniform vec3 uSunDir, uSunCol; varying vec3 vP;
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
        // twilight: violet low down to deep blue overhead, an orange band on the sun's side, the clouds lit from below
        vec3 twi = mix(vec3(0.34, 0.24, 0.4), vec3(0.05, 0.09, 0.28), pow(h, 0.45));
        twi = mix(twi, mix(vec3(0.1, 0.1, 0.17), vec3(0.95, 0.45, 0.32), pow(toward, 2.0) * 0.8), cl * 0.8);
        vec3 band = mix(vec3(1.0, 0.36, 0.12), vec3(1.0, 0.7, 0.35), smoothstep(0.0, 0.25, h)) * exp(-h * 5.0) * pow(toward, 2.5);
        vec3 col = mix(twi, day, uDay) + band * uGlow * 1.15;
        vec3 night = mix(vec3(0.045,0.07,0.13), vec3(0.01,0.02,0.055), pow(h,0.5));
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
  // far trees get a thinned leaf LOD (fewer, larger leaf cards)
  const cx = (R.xL + R.xW) / 2, cz = (R.zB + R.zF) / 2;
  for (const k of ['A', 'B', 'C']) for (const p of spots[k]) p.far = !p.near && Math.hypot(p.x - cx, (p.z - cz) * 0.8) > 17;
  for (const k of ['A', 'B', 'C']) {
    for (const far of [false, true]) {
      const list = spots[k].filter(p => p.far === far); if (!list.length) continue;
      for (const part of T[k].parts) {
        const geo = far && part.leaf ? (part.lod ||= lodLeaves(part.geometry, k === 'A' ? 0.55 : 0.4, k === 'A' ? 1.2 : 1.32)) : part.geometry;
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
  // shrubs right outside the glass
  const leafMat = T.A.parts.find(p => p.leaf).material;
  for (const [x, z, sc] of [[-2.0, -1.0, 1.2], [-2.2, -6.0, 1.1], [-2.5, -8.3, 1.4], [-1.9, 1.3, 1.0], [-4.8, -4.6, 0.9], [-5.0, -7.4, 1.3], [-4.6, -0.6, 1.0], [-0.4, -9.9, 1.3], [1.3, -9.8, 1.1], [2.8, -10.1, 1.2], [-1.9, -10.2, 1.3], [-3.6, -9.5, 1.2], [-0.8, 3.6, 1.1], [1.8, 3.9, 1.0], [-6.2, -10.8, 1.5], [-6.8, 0.2, 1.4], [-6.6, -3.2, 1.3], [4.2, -12.4, 1.4]])
    if (!unseen(x, z, 1.6 * sc)) outside.add(shrub(x, z, sc, leafMat));
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
function shrub(x, z, s, mat) {   // cards of A's first sprig, stem down (the old GLB texture showed it that way up)
  const n = 90; const q = new THREE.PlaneGeometry(0.5625, 0.9); q.translate(0, 0.45, 0);
  const uv = q.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, 1 - uv.getY(i));
  const im = new THREE.InstancedMesh(q, mat, n); const r = rng(Math.floor(x * 100 + z * 7 + 999)); const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, u = r(), rad = Math.sqrt(u) * 1.0 * s, h = Math.sqrt(Math.max(0, 1 - u)) * 1.3 * s * (0.4 + 0.6 * r()); const sc = (0.75 + r() * 0.6) * s;
    m.compose(new THREE.Vector3(x + Math.cos(a) * rad, -0.12 + h * 0.75, z + Math.sin(a) * rad), new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - .5) * 1.2, r() * 6.28, (r() - .5) * 1.2)), new THREE.Vector3(sc, sc, sc)); im.setMatrixAt(i, m); }
  return im;
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
  const B_VOX = { lo: [-4.4, 3.2, -4.8], res: 0.4, dims: [21, 24, 23], wts: [0, 1.812, 5.244, 11.321], data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAJAFAAAAAGUAAAAAQAYAAAAAQCEAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAAAB9AAAAAFAfAAAAACQFAAAAAH9rAAAAhEsJAAAAsPIBAAAA1G0AAAAA1AEAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAEABAAAAAFAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAEB0AgAAABCZBQAAAKV6AQAAAOW/AAAA0H5bAQAA5PsKAAAA9b8BAAAAkTkAAAAA+QUAAAAA/QEAAAAAQAAAAAAAAAAAAAApAQAAAIBrAAAAABAGAAAAAGAFAAAAACgAAAAAQAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAFQAAQAAlBgAAQJr+AQAAAGSrAQAAgKn7AQAA8F++AAAAdHcXAAAA/r4FAAAA/p8BAABA6SoAAABA/QcAAAAAQAAAAAAAAQAAAACAAgAAABCoAAAAAAE0AAAAAKQNAAAAQH0BAAAAgB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABEAAAAIQQAQAAQBNUAQAAkFmmAQAAZW5kBQBApCepAgAASF9uAAAA5GtfAAAA+u0LAAAA+b8DAABA/zoAAABA2QYAAAAAOQAAAAAAAQAAAAAUBAAAAFGQAQAAQFGuAAAAQPgPAAAAAH4CAAAA4C0AAAAAgAEAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAQFYRAAAAoEVFAAAAaGlCBQAAn1aRAwBApQH1AQBAn0GmAQBAde4NAAAAut4aAABA/v8XAABA/b8AAACA/gsAAACQPwEAAAAAAQAAAABAAAAAABSgAAAAAFU5AAAAUH4vAAAAgKsHAAAA8GoAAAAA4HUAAAAAVAAAAAAAAAAAAEACAAAAAEAAUAAAgBcAAAAAcJYYAAAAbVZAEgBA9hZQAgBQVhv1AQDQ5wm7AQCQ/aa/AAAA3tt+AABA/f4rAACA+34AAACQ/q8AAABAdQoAAAAAAAAAAAAAAAAAAEBAAgAAAG1kAAAAoG85AAAAkK4WAAAAtL8AAAAA4D4AAAAAkAsAAAAAUQEAAAAAAAAAAAAAFAAAQAIQFAAAkAEUBAAAVFAACQBAX1WQBQCQlAZEBABAlkZ+AQDkvqmeAgBJrprtAAAB+K85AJVB7eoGAARA/qoCAAAAuScAAAAApAUAAAAAAAAAAAAAAAAAAGRQAAAAAH9aAAAA0FoAAAAAuG8BAAAA1JYAAAAAaT8AAAAAvQEAABAAAAAAABEAAAAAQAEABQAAVJAVUQAAFWVQVQFAFVBlUABQVknqBQDwlWk6AQClam+RAyUCtBW5ARkF2pdeQCoavZcaQFZAfu4KAAFAKrYAAAAA6QYAAAAACQAAAABEAQAAkFnQAQAAbZ5RAABAtVsBAAAAkFoBAAAAZFsBAAAAqAoAAAAAfgAAABQBAAAAAEUAAAEAAAAACAAAUAFARQEABZBB5gZASZR1tgFAFilafVCURXJZGSiQSX6lB2gBoAWpgy8VhCbuwFUFaJFrQJEClPwPQCUAlu4AQAAA5R8AAAAAZQAAAAFYAQAAkAZQAQAAnl5BAACAvR4xAABQ6ocaAABQqYEBAAAAZRkAAAAAqgAAAEAEAAAAABABAAAAAAAAQEQApFUAQBYASQFAUBwAZAAAWgIAJlWWpoBURdaWCRBQSaX/AmlBBRHkh1ZEkQHs8RYVBEAufFkFEPkKYLoBcKsA4AAA6R8AQAAAfQAAAAABRAAAZFURJAAApZYFDQBA6ZpFAQAQ9asrAADgrJEAAAAA9QQAAAAAFQAAAAAAAAAAAAAAQQAAAEAAUJEAAEARUBAARFUYACUAaFBXkQYALYSU2VABGgB5LFSFC1TaRTlFUkusgl+UU1Xp8BoJGOEqpKsqFdkGoG5AuSoB+AmA/wcAAABARAAAAAUBUAAAEFABGABATLsRCABgr1kGBQD0R2thAAD0/rgKAAD4ogEAAACEAgAAAAAAAAAAAAAABQUAAAAAABQAAAAAUC4AAAhUVCsASEAF4QUGZRFUlJFWdAFlAeSRXkXmAhuFqqqvgS+1tJZWoEplEIUr8KsRpOoD9LZC+i8AuBtA/wcAAACgagAAAASkBQAAAJQFFAAAYPYGBABQn60uAQCgr65bAACwv/8KAADw30QAAADZDwAAAAAAAAAAAAAAQEUAAAAAAKQAAAAAUHgAEABphSpAVkVmlAdSKUBlWcFFaJUqKaDGpmaWAW7FV0QewFXlnUYVkGlqVOoGsGoGpKoCqOtSvy8A8AJAqwIAAAAdrgAABACmGgAARWRRVgAAJaaCCQCA7roZBQDo+30bAAD4f70HAACoLwAAAADwDwAAAAAAAAAAAAAAAAQAAAAAABQAAAAAgG4AFABApB8QWQBQoAvVClCh5gFZFpZZJmRSFqD4AJquFhAVwGr4BlEAkHW/EmUA0GlEBNQAUJ1AUXsAYACYmQ4AACCs+wEAAAD6LgAAAQB6GAAApYaqHgBApicWAgDQfZ4FAADkLpYJAACgPRAAAAD0CwAAAAAAAAAAAAAAAAQAAAAAAFAAQAABFCAAhEFSZA0AKRBUnQWQahXQZQC2UliUEZBJWRmpAVTqXwUBQHZ+K0AFADn+BwAGgO4AAKgBAAlAUV0AQADk5g4AABCl7wEAAAT9bwAAlATsBQAAeUOhAgBA5kp9AACQS1kGAADw6UIBAACwbwAAAACQAQAAAAAAAAAAAAAAAAAAAAgQBAoAAARFQAAARBRlfQFAFVVo1gDAXmSUGgDwFyTWAkB9lRpUAAD9bgsAAKT/qgAAAK27BEQAQBkBAGUAAABAUVUAAABUmgkAAACl+gEAAFH5HwAAYAVxBQAApBUEAAAAaQoEAAAAEQIAAACg8QEAAACAGQAAAABAAAAAAAAAAAAAAAAAAAAAAAARAAUAAEEYAAAAQAZZFAAApFVVFQCACuVRBQDwRltUAAC0lhMAAABunwEAAACvWkAAAAD+AA0AAAAAkBoAAABQkBIAAABkLgEAAACYugEAAASQCgAAAAAAAAAAEAUAAAAAUQEAAABAVAEAAAAAVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVAAAAAAQEAAAAkFIFAAAAtAEBBACAF1YBAADQ7hsAAABw/gcAAACo7QEAAAC8G0AAAABUQHkAAAAAkAYAAAAAxAcAAABAlQEAAACAXwAAAABAAAAAAAAAAAAAAAEAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAQAAAAAFAAAAAAgFAAAAAAeIEBAAAAWqsAAADQ+h4AAACg/gIAAACwfwAAAACQBQAAAAAQQAUAAAAAwAoAAAAA9AIAAABAQAAAAAAQBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAACUAAAAAVB0AAABAuAcAAABAvgEAAABQCQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
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
  const C_SKEL = { o: [0.0, -0.1, 0.0], q: 0.02, rq: 0.002, data: 'AAAAAEYBBA0ARQEDD/9NAQAdAU0B/yAATQH9EAFNAQAN/0wB/hACSgEAHwBKAQQd+0MB9yAGQwH8CwVDAQYU8kMB/Av+QQEKEQM4AQYOBTgB/RD8OAEFGvw2AfwSCDUB+xAAMgEEDwUwAQESBTABAAcGLgH8E/kuAfkQAy0BAw38JgH9Ev0mAf4J+yYBARIEJQEDEP4jAfwNACEBAA8BIAEAIAIcAQQO/BoBAhD/GQH/IAIXAf0KAhYBBg/7FgEDDv8VAfz+ARUB+g36FQH8DPoVAfcM9wwB9AT+CgHsDQUDA/oJ/AYB+BD8Bgb/EAAHAfkdAgQI8AQFCgHoCQMGC/IFAgYB8wYEBg4DDQcIAf4aDAYB/QwIBRIDEAAQAQUeAwwBAA8BCRf2CwYRAf0NAw0B7ywLBR78CAsUAf8LChQBAxoNEwH+/gMTAQQDDxMBAgMOEwEIAg8QAQsHBQkBBgsECQMFChkGBfsIDAcB/BAXAwcMDAALARERCAUKCwsDBgEHCQMGDfUMBwkB+woHBwH5GA0DEQUMCA4BBA4HDgH9GhAJAQAWCwc2AQf7IAEDDvkgAfcJ+CABAw30IAH/DvcXAfYI9RcB+Aj7EgHyB/8SAe4YBQYB+gkABAT/D/YJAfsa8wcIBA3/CAEFHfoFAQEb+wQM8ggFDwHrFv8LAeoSAwgB+QcEBRHzCgELAeoWBwYUDQkHFAEFD/4MAQQeBAcBCRsABlENBgMZARkRBRgBBwwDFwENLAMVAf38/hUBAhQIFQEAE/4PAfwOCA8BAAgICwEJBAoKARcKDwID/REDCwH/DgUJAfwKCAgIAgv6BwEJGvUGAQQX/AQMBQsGDwEHCwQNAQsLAQwBCQsDBwEFCAUHEQj/DgoBCAQIChQNDfQMAQor8QcBAQv9BhgGDgIRAQ8ZBAkBCBsDBRwC+v4XAQ0J9hcBDQb7FwEPBAIXARD/9RQBDgACDAEOAwIJAQ4BBAgBC/0CBgUGBfcKAQ4Q7AMICQoKCQESEwwGAQkJAgUMBQv2DwESF/oKAQkG+QkQ/Qn1CgECDfUKEwoMCQ0BCgkFCwEfHAgFhwEBA+0fAf8J9R8B/RnvGwECAfkbAfwG7xsBAwPxGwEC/O8bAf4A9AwBBfrwCgED/eYDA/kB8wYB+QDoAgcL/vUIAQsB8wcBCAP2BwEKCfQGC/4N+hABBAjyBwH/CukED/oO/gkB/Q35CRIQBPcMARMJ2AYBBQb3BBYBDPcXAQAN9xYBBBryDQH/EPoJAQMV+gWnAfcGCR0B+AoIHQHzGQsbAfwDAxsB9gQOGwH1AA0VAfoEDBUB/wIQFQEABQoNAQULCQ0B/hcPAwP0BA4HAfkGCgcH9AYECAHhFRUFCgYJBgwBAhcUBwEFFQ4FDgYHCQsBCAoMCgEFDAYHEvEK+wwB3RsHBwHyEwIDFvsOARgB+A4BFwHsFggWAfoNAxUB/Q8FFQH/AQMVAQMLDBUB/wsMFAEJCgoRAQkHAAwBBg//CQMBCwkFAQEKBwUG+wwEBQH6GQoDCQQKBA4BGCD+BAsLDPwGAQYK/gYO8w7/CQH6DQEGAfgX/gMSAA0GEAEADwUPAfwOAg7aAQIHEiEB/RkQHwEBDAgeAQYMCB0BChIWGwEE//wbARAH/hsBDwL+FQENBv4UAQsJ9xQBBgr7DgEBDv0OAQkZAgMDEgUACAEMCAAIBwsFBgcBJBMPBQoAC/0MAQoe/QgBAxr+BQ4BDPoKAQAN+QgB/hD/BxIIAxELAQoFCwsBEwwSBwELDg8DFwALCxQB/wkKEAEADggOAQUMBQ4BAg0BCx38/gQdAfv9ER0B+/cMFQH+/Q4UAQT9DxQBAwIMDQEFBwsNAf0PFgQD+foQCAH8/g0IB/YACAgB5v8jBQoEBwgMAQMQGwcBBRAVBQ4IBgsKAQcHCgkBBAwKBxLxBAILAfIDBwsB6AUSBwHuCg8DkwL0B/siAfQK/iIB7RYHHgHuG/0bAfkK+RsBAP4HGwHuCQQbAfkABxsB8Qr+GwHyCgQbAe79CBsB+AAIDwH6/Q4OAfsEEAQB9gcSAgTwCwIJAesMCwUI+wwCCQHwGgoFAfIRCAMM/v4SDgHxBBoKAfcAGwcB/gIKBBH6AA8KAfgFHgYV/RMADgH1GgULAfkcDQgB+BUGBRr4C/cVAfUZ9hQB9Br6DgH1Ff0KIfwI/BwB/gvyGgH+BPAUAf0I9RMB9wr3EwH8CfwQAfsOARABARz8AwP/CvAHAf8K9QcHBgf2BwEOGuAFCv0KAgwB+x/9BwH8GwEFDv4KAQ8BCh4FBRESBfgLARIQ7gkBEhL0BssCCwTwJgEIBvQlAQwU6yUBBPkCGwEM+vEXAQz+9RUBDAD2EgEX9fAQAQ38/Q4BDgD7CwElDPMDBAH79QwBDPvWBAcMBv4LAQ4G/gsBCgj8CgEQGvMFAQUH+QQN/wLyDgEDA/ILARMH6QoBDvzqBhL7AfINAfwH2wMVDw38EAELCfwQARcM8AoBEhHyBgEFCPcFGwka8CMB+/3/IwH5D/YbAfUK+hoB+gz5GgH/Ef0OAQUL/QoBBQn5CQEJEO4EBPwK+wcB9hXuBwf5AvIHAfES3wQKCQn7DAENF+8HAQ0P8wUOCQj2CwEQBuwEEfv68A0B+wDxDAH4BeMHAQAD6QMWBQr1IQEGE+sgAQEK9R4BAQv4GgEJHfcLhQMOAwomAQ0FCSYBCQoGJQEPFwwkAQkLAyEBFhYBHQED/wIcAQ8E+BsBDgD3FgEMBPoUAQgH8hQBBQj6DgECDvwNAQ4X/QQDEgL5CAELBfsIBw0CAgcBKQz/BAoBDP4NAQsb+AcBBxj7BQ4ADPgNAQAO+AwB+x31BhIPAQ0LARsHCQoBGQsLBhYKCfsVAQwI+BUBCQoCFAEHDgIQAQUM/Q8eAAEHHAEJBBEWAQMEDhYBBQcHFgH8BhAWAQgAExABCgIIDgEIBwcNARAYCwME/AAcCQH5/B0HB/cJCgsB+wsKCgH+DAcHAQEYDAQMDA4EDwEDCQsJAQALCggBBBcPBxILCAANARsbCQMV+QgIEAH5CgkQAfgbIgcB/BcRBcAD8Af7KgH0CPkqAfcH9ygB8hLrJgH/AvghAfoH8CAB+gHxGgH8BPIZAfUK9g4B/Az9CgEAC/sKAQMX8gQE/QX2CAH6C+YGBwYB8wcBBwvYBAoBDv4LAf4c8wcBARf6BQ4CDP4MAQ4Z+AURDv7yCwEQBuYHARAJ7AUV+gv4JAH6DPgiAfcJ+iAB9Aj6HAH3CvwbAf0Y9REc/AAGGQH1CwUZAfsK/hgB7AYGGAH0CwESAe8W/REB9AoFCQHuEwcHA/on7wkF8//9CQHxAvwIAfME/wYB6Av/BAoAC/YNAfoL+A0B4BrxCA4DC/cOAfgX7wQS8AL+DwHyBf4NAegQAAsB5Q37BwH1CP8F9wP1CQ8vAeoaHy4B+QYMLAH5CQsrAfsLBycB+x0OHwEDA/4XAQAS/xcB+wkCFwEGEgQXAQAQBRcB+Q/9FwH4CgERAfIHAhEB7g4QBQH6CAcDBAIRBQkB/BsKBwgECQsKAQIKCgkBAiEZBAzxAwcQAfcIBg8B9xkTCAH5DxAFEfABAxAB5QoRBxUICgoPAQUJCg8BBBgSCQEAHR4FGvwMBx0B8RgNFQH5IxIIHwP9BB4BCgcQGwEEBRAbAQMJBhsBAQYRGwERCgcSAQgKAAsBBQ0CCgEBDwEDAQIQBQMFBAcJCgEKGiEGCPkJDQgB+RokBwsEEfwPAQIOBwwB/yMYBxAHDfwOAQYo/QUT9gYSDgH8Bw0NAfsQGAkB9xwcBTgABPsXAfIP/BcB+Q79FwH4BwIXAfkQ/xcB7Qb+FwH2BAIRAfMACQ8B7QwWBAP3Ev8KAfEUBAUHAQ4ECgH6HAkGAfcWBgQL9QAODgH2CAgMAesgFAgQ9P0IDwHmBh8FEwMQAg8BAA4DDwH5HQYJAfYlEQXJBA4I+DUBCgr3NQEQGPcxAR0h+SwB+wMFHAEJDQYcAQgMARwBBA78HAEEDwoXAQEQ/gwBCRf0BwMLBgcHARUOCgIGBQzzCAEHBvcIARII8AMKDwIDDgEMCf4KAREUBAgODvwGCgEWAwUCEQcJ8wsBEBXyCQEKCfcEAQkF+gQWDQb7IwEOCPoiAS0n8xkBGx3vFugE/g/4Ae8E+RkCEQEBEAIR8QT8DQcY' };
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
function makeVelvet({ color, sheen, sheenRough = 0.6, rough = 0.95, map = null, normalMap = null, normalScale = null, ao = false, pleat = 0, crease = 0.4, allFaces = 0, crush = 1, seam = 0, freq = 1, spec = 0.1, sheenAmt = 0.8 }) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0, sheen: sheenAmt, sheenColor: new THREE.Color(sheen), sheenRoughness: sheenRough, specularIntensity: spec, side: THREE.DoubleSide, vertexColors: ao });
  if (map) m.map = map; if (normalMap) { m.normalMap = normalMap; if (normalScale) m.normalScale.copy(normalScale); }
  const U = { uPleat: { value: pleat }, uCrease: { value: crease }, uAll: { value: allFaces }, uCrush: { value: crush }, uSeam: { value: seam }, uFreq: { value: freq } };
  m.userData.velvet = U;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjP;\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position;\nvObjN = objectNormal;');
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
  MAT.sofaCushion = makeVelvet({ color: 0x40603f, sheen: 0xdfe6c4, sheenAmt: 1, map: ref.map, normalMap: ref.normalMap, normalScale: nS.clone().multiplyScalar(0.9), ao: true, pleat: 1, crease: 1, seam: 1, freq: 1 });
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
  const cj = candleJar(); cj.position.set(-0.72, 0.42, -6.25); F.add(cj); LIGHTS.candle = cj;
  const tb1 = flatBook(B.book_book002, 0.35 + Math.PI / 2, 1.15); tb1.position.set(-0.13, 0.42, -6.22); F.add(tb1);
  const tb2 = flatBook(B.book_book01, 0.2 + Math.PI / 2, 1.1); tb2.position.set(-0.13, 0.42 + tb1.userData.h, -6.21); F.add(tb2);
  // ---- floor lamp in the back-right corner, behind the sofa
  const fl = floorLamp(); fl.position.set(R.xS - 0.28, 0, R.zB + R.caseD + 0.16); fl.rotation.y = -0.15; F.add(fl); LIGHTS.floor = fl;
  // ---- stump side table + plant
  const st = stumpTable(); st.position.set(R.xL + 0.32, 0, -5.85); F.add(st);
  const pot = new THREE.Mesh(new THREE.LatheGeometry([[.001, 0], [.1, 0], [.14, .05], [.15, .11], [.14, .12]].map(p => new THREE.Vector2(p[0], p[1])), 28), MAT.stone); pot.position.set(R.xL + 0.28, 0.53, -5.98); pot.castShadow = true; F.add(pot);
  const pl = plant({ leaves: 120, spread: 0.55, height: 0.7, seed: 11, scale: 0.13 }); pl.position.set(R.xL + 0.28, 0.6, -5.98); F.add(pl);
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
const POST = {};
/* The watercolour picture is made in three passes:
   1. tone: the scene's colours through the tone curve, once per pixel (the paint pass reads each one ~50 times);
   2. paper: the noise fields that only depend on the screen position (wobble, pigment, fibres, blotches, paper grain),
      baked when the window size changes instead of being recomputed every frame;
   3. paint: Kuwahara smoothing, ink edges and the paper, reading the two above.                                  */
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }';
function buildPost() {
  POST.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(4, 4) });
  const exposure = { value: 0.87 }, quad = (uniforms, fragmentShader) => new FullScreenQuad(new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VS, fragmentShader, depthTest: false, depthWrite: false }));
  POST.tone = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
  POST.toneQuad = quad({ tColor: { value: null }, exposure }, /* glsl */`
    precision highp float; uniform sampler2D tColor; uniform float exposure; varying vec2 vUv;
    vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
    vec3 toS(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(0.0031308,c)); }
    void main(){ gl_FragColor = vec4(toS(aces(texture2D(tColor, vUv).rgb*exposure*0.85)), 1.0); }`);
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
    res: { value: new THREE.Vector2(1, 1) }, near: { value: 0.05 }, far: { value: 400 }, exposure, lift: { value: 0.88 }, veil: { value: 0.06 } }, /* glsl */`
    precision highp float;
    uniform sampler2D tTone, tDepth, tN1, tN2; uniform vec2 res; uniform float near, far, lift, veil;
    varying vec2 vUv;
    float ld(float d){ float z=d*2.0-1.0; return 2.0*near*far/(far+near-z*(far-near)); }
    vec3 samp(vec2 uv){ return texture2D(tTone, uv).rgb; }
    void main(){
      vec2 tx = 1.0/res; float sc = res.y/1000.0;
      vec4 n1 = texture2D(tN1, vUv), n2 = texture2D(tN2, vUv);
      // --- wobble (pigment pushed by paper)
      vec2 uvw = vUv + (n1.xy - 0.5)*tx*3.5*sc;
      // --- 4-sector Kuwahara (radius 3)
      vec3 m[4]; vec3 s2[4]; for(int k=0;k<4;k++){ m[k]=vec3(0.0); s2[k]=vec3(0.0); }
      for(int j=-3;j<=3;j++) for(int i=-3;i<=3;i++){
        vec3 c = samp(uvw + vec2(float(i),float(j))*tx*1.25*sc);
        if(i<=0&&j<=0){ m[0]+=c; s2[0]+=c*c; } if(i>=0&&j<=0){ m[1]+=c; s2[1]+=c*c; }
        if(i<=0&&j>=0){ m[2]+=c; s2[2]+=c*c; } if(i>=0&&j>=0){ m[3]+=c; s2[3]+=c*c; } }
      vec3 col = vec3(0.0); float best = 1e9;
      for(int k=0;k<4;k++){ vec3 mu = m[k]/16.0; vec3 v = abs(s2[k]/16.0 - mu*mu); float sv = v.r+v.g+v.b; if (sv<best){ best=sv; col=mu; } }
      // --- edges: depth + colour sobel
      float d00=ld(texture2D(tDepth,uvw+vec2(-1,-1)*tx*sc).r), d10=ld(texture2D(tDepth,uvw+vec2(0,-1)*tx*sc).r), d20=ld(texture2D(tDepth,uvw+vec2(1,-1)*tx*sc).r);
      float d01=ld(texture2D(tDepth,uvw+vec2(-1,0)*tx*sc).r), d11=ld(texture2D(tDepth,uvw).r), d21=ld(texture2D(tDepth,uvw+vec2(1,0)*tx*sc).r);
      float d02=ld(texture2D(tDepth,uvw+vec2(-1,1)*tx*sc).r), d12=ld(texture2D(tDepth,uvw+vec2(0,1)*tx*sc).r), d22=ld(texture2D(tDepth,uvw+vec2(1,1)*tx*sc).r);
      float gx = (d20+2.0*d21+d22)-(d00+2.0*d01+d02), gy = (d02+2.0*d12+d22)-(d00+2.0*d10+d20);
      float de = clamp(length(vec2(gx,gy))/max(d11,0.3)*6.0 - 0.25, 0.0, 1.0);
      vec3 a1 = samp(uvw+vec2(1.5,0)*tx*sc), a2 = samp(uvw-vec2(1.5,0)*tx*sc), a3 = samp(uvw+vec2(0,1.5)*tx*sc), a4 = samp(uvw-vec2(0,1.5)*tx*sc);
      float ce = length(a1-a2)+length(a3-a4);
      float ink = max(de*0.85, smoothstep(0.25,0.65,ce)*0.38) * (0.55 + 0.6*n1.z) * smoothstep(16.0, 8.5, d11);
      // --- watercolour transparency: lift + slight desaturation, pigment granulation, edge darkening
      float lum = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(lum), col, 1.08);
      col *= 1.0 + (n1.w - 0.5)*0.10*(1.0-lum) + (n2.x - 0.5)*0.03;
      col *= 1.0 - smoothstep(0.08,0.5,ce)*0.10;
      col = mix(col, col*col*1.06 + 0.02, 0.10 + 0.1*n2.y);           // wet-in-wet blotches
      col = mix(vec3(dot(col, vec3(0.299,0.587,0.114))), col, 0.9);
      col = 1.0 - (1.0 - col)*lift;                                    // paper shows through (less at night)
      col = mix(col, col*vec3(1.02,1.0,0.95), 0.6);                   // warm paper tint
      col = mix(col, vec3(0.24,0.17,0.11), ink*0.55);                  // brown ink line
      col *= 0.96 + n2.z*0.07;                                         // paper texture
      gl_FragColor = vec4(col*(1.0-veil),1.0);
    }`);
  POST.mat = POST.quad.material;
  POST.out = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });   // the finished picture, at CSS resolution
  POST.blit = quad({ t: { value: POST.out.texture } }, 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }');
}
function bakePaper(w, h) {   // the screen-fixed noise of the paint pass, for this window size
  POST.n1.setSize(w, h); POST.n2.setSize(w, h); const U = POST.bakeQuad.material.uniforms; U.res.value.set(w, h);
  for (const [rt, which] of [[POST.n1, 0], [POST.n2, 1]]) { U.which.value = which; renderer.setRenderTarget(rt); POST.bakeQuad.render(renderer); }
  renderer.setRenderTarget(null);
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
/* ---------------------------------------------------------------- main */
let A = null, booksMesh, motes;
async function main() {
  const bufP = getLibBuffer(); bufP.catch(() => {});   // the models download while the room is built
  setLoad(0.05); await tick();
  await buildTextures(); setLoad(0.25); buildMaterials();
  buildRoom(); setLoad(0.3);
  BOOK.atlas = buildSpineAtlas(); buildShelves(); booksMesh = buildBookInstances(); setLoad(0.45); await tick();
  buildLights(); buildPost();
  const trees = await makeTrees(); await tick();   // built in code while the models download
  // they sway as the GLB trees did: the sway grows with the square of the height in model units, and those models were
  // drawn at scales 0.82, 23 and 0.024, so the same motion in metres takes the inverse
  for (const [k, t] of Object.entries(trees)) for (const p of t.parts) { windify(p.material, p.leaf, { windScale: 1 / { A: 0.82, B: 23, C: 0.024 }[k] }); p.material.fog = true; }
  const buf = await bufP; setLoad(0.7); await tick();
  A = await loadAssets(buf); A.trees = trees; setLoad(0.85);
  await buildFurniture(A); await tick(); buildDecor(A); buildOutside(A); motes = dust(); await tick();
  // interior materials ignore fog
  scene.fog = new THREE.FogExp2(0xd6e2e6, 0.03);   // a light blue haze over the far trees, matching the sky
  room.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.fog = false); });
  setLoad(1);
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
   - Where the sun is: NOAA's solar equations (declination and equation of time from the date) for Pleiku (13.98° N,
     108.0° E) when the clock keeps Vietnam time, else for 14° N on the time zone's meridian. The room is turned so
     that its left glass looks west-south-west: an October afternoon sun (~15:15, 30° up) comes in as in the painting;
     in the morning the sun stands behind the shelf wall, at noon high over the front glass.
   - Sunlight crosses more air as the sun sinks (air mass, Kasten & Young 1989) and loses blue first: per air mass the
     optical depth is ~0.17 red, ~0.25 green, ~0.41 blue (Rayleigh scattering plus haze). So the light is white-gold
     high up, gold under ~10°, orange at 5°, red at the horizon, and weaker; it goes out as the sun reaches the trees.
   - Skylight falls with the sun (here as sin(elevation)^0.35); the window facing the sun is the brightest one.
   - Twilight: civil (0 to −6°) brings an orange band on the sun's side under a sky turning violet, then deep blue
     (the blue hour, around −4°); in nautical twilight (−6 to −12°) the stars come out and the night look takes over.
   - The lamps come on as the daylight goes (sun from 6° to −4°), as someone reading there would switch them on.
   The page's day/night switch still wins when it is used by hand: the room then goes to the painting's afternoon or
   to night (a 4 s time-lapse). `?at=17:40` in the address pins the room's clock (to preview an hour).            */
const DEG = Math.PI / 180, smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const SUN_REF = { e: 29.7, az: 245 };   // the painting's afternoon: the sun the room was lit by
const SKYU = { uSunDir: { value: new THREE.Vector3(-0.68, 0.5, 0.54) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uDay: { value: 1 }, uGlow: { value: 0 }, uWarm: { value: 0 } };
const TINT = { warm: { hemi: new THREE.Color(0xffcb92), win: new THREE.Color(0xffc489), fog: new THREE.Color(0xe8c6a2), ring: new THREE.Color(0xd0ae7e) },
  blue: { hemi: new THREE.Color(0x6c74b4), win: new THREE.Color(0x7880c4), fog: new THREE.Color(0x3c4664), ring: new THREE.Color(0x2c3548) } };
const HOUR = { e: null, az: null, pin: null, moving: false, S: {}, dir: new THREE.Vector3(), refDots: null };
function sunPlace(d) {   // the sun's elevation and azimuth (degrees; azimuth from north, clockwise) at the date d
  const tz = -d.getTimezoneOffset() / 60, vn = tz === 7, lat = (vn ? 13.98 : 14) * DEG, lon = vn ? 108.0 : tz * 15;
  const doy = Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 864e5) + 1, hr = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  const g = 2 * Math.PI / 365 * (doy - 1 + (hr - 12) / 24);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = ((hr * 60 + eot + 4 * lon - 60 * tz) / 4 - 180) * DEG;
  const e = Math.asin(THREE.MathUtils.clamp(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha), -1, 1)) / DEG;
  const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) / DEG + 540) % 360;
  return { e, az };
}
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
  const L = LIGHTS, D = NIGHT.day, U = POST.mat.uniforms, S = hourState(e, HOUR.S), n = S.n;
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
  SKYU.uDay.value = S.skyDay; SKYU.uGlow.value = S.glow; SKYU.uWarm.value = S.warm;
  const amb = S.amb, full = n >= 0.999;
  L.hemi.intensity = lerp(D.hemi * amb, 0.15, n); tint3(L.hemi.color, D.hemiC, TINT.warm.hemi, TINT.blue.hemi, NC.hemi, S); L.hemi.groundColor.lerpColors(D.hemiG, NC.hemiG, n);
  const NRM = [[-1, 0], [0, -1], [0, 1]], side = (k, x, z) => Math.max(0, NRM[k][0] * x + NRM[k][1] * z);   // left, back, front glass
  if (!HOUR.refDots) { const r = sunDirAt(SUN_REF.e, SUN_REF.az, new THREE.Vector3()); HOUR.refDots = NRM.map((_, k) => 1 + 0.35 * side(k, r.x, r.z)); }
  L.rects.forEach((r, k) => {
    const face = (1 + 0.35 * side(k, dir.x, dir.z) * S.sun) / HOUR.refDots[k];
    r.intensity = D.rects[k][0] * lerp(amb * face, 0.22, n); tint3(r.color, D.rects[k][1], TINT.warm.win, TINT.blue.win, NC.win, S); r.visible = !full;
  });
  scene.environmentIntensity = lerp(D.env * amb, 0.09, n) + (full ? 0.02 : 0);
  tint3(scene.fog.color, D.fog, TINT.warm.fog, TINT.blue.fog, NC.fog, S);
  if (L.ring) { tint3(L.ring.material.color, D.ring, TINT.warm.ring, TINT.blue.ring, NC.ring, S); L.ring.material.color.multiplyScalar(lerp(0.55 + 0.45 * Math.min(amb, 1), 1, n)); }
  // the lamps
  const k = S.lamps;
  L.table.userData.light.intensity = lerp(D.table, 7, k); L.table.userData.glow.material.opacity = lerp(D.tableGlow, 0.9, k);
  L.floor.userData.light.intensity = lerp(D.floor, 32, k); L.floor.userData.pt.intensity = lerp(D.floorPt, 5, k); L.floor.userData.glow.material.opacity = lerp(D.floorGlow, 0.95, k);
  MAT.shade.emissiveIntensity = lerp(D.shade, 2.4, k);
  for (const sp of NIGHT.spots) { sp.sp.intensity = 55 * sp.k * k; sp.sp.visible = k > 0.001; sp.disc.material.color.setRGB(0.1, 0.086, 0.07).lerp(NC.disc, k); }
  // the eye opens a little as the light goes
  petsForHour(S);
  U.exposure.value = lerp(D.exposure * (1 + 0.25 * (1 - Math.min(amb, 1))), 1.0, n); U.lift.value = lerp(D.lift, 0.96, n); U.veil.value = lerp(D.veil, 0.07, n);
}
const TMPV = new THREE.Vector3();
function hourTarget() {   // where the light should be: the sun of the clock, or the page's switch when it was used by hand
  if (HOUR.pin) return sunPlace(HOUR.pin);
  const d = new Date(), m = d.getHours() * 60 + d.getMinutes(), clockDark = m < 382 || m >= 1050;   // the page's own rule (6:22, 17:30)
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
/* ---------------------------------------------------------------- library interface
   Hidden Library keeps its data and its audio engine: its old cards stay in the DOM, hidden, and are driven by
   clicks. This layer reads the categories from them and makes the room the interface. Every book category and every
   research topic is a shelf section with a brass plate, a label and a leader line; a click flies the camera there and
   opens its card; the book that is playing comes off the shelf (in front of the camera while its card is open, on the
   sofa otherwise). The record player stays the page's own, in the sidebar.                                     */
const UIS = { secs: [], byId: new Map(), byCat: new Map(), hover: null, open: null, mode: 'home', peek: null, active: null, touched: new Set(), bySrc: new Map() };
/* The room is organised in two parts. Books: every category is one whole row of the tall shelf on the right wall,
   top to bottom from the row under the 3.5 m board (rows 8, 7, 6, 5 for four categories). Research: every topic
   (a sub-page of the Research group) is one bay of the low bookcase under the back glass, left to right; with more
   than three topics the bays are split into an upper and a lower half.                                          */
function bookSlot(k) { const row = 8 - k; return row < 2 ? null : { shelf: 'R', cols: [0, 6], rows: [row, row], pick: [3, 3], mid: 3, anchor: 2 }; }
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
/* ---- the page's books in both languages, with their page counts
   The page lists its books under their Vietnamese titles (a few under their English ones). Here each also has its
   original English title (a Vietnamese book: a translation), its author and year where the page gives none, and its
   page count: the median over the work's editions on Open Library (looked up 13/10/2026), else the publisher's or a
   bookseller's listing. The spines, covers and the card follow the page's language switch; a book's thickness
   follows its pages (see spineOf), so a long book stands out on the shelf as it would. A book the page adds later
   and this table lacks keeps the page's title and the shelf book it was given. */
const BOOK_INFO = [
  // the title as the page has it, the English title (and the full one), author · year when the page lacks them, pages
  // (t: a thickness in metres where there are no pages to go by; h: a height, for a book of a larger format)
  { page: 'Nguyên lý Pareto: 80/20', en: 'The 80/20 Principle', full: 'The 80/20 Principle: The Secret to Achieving More with Less', by: 'Richard Koch · 1997', pages: 283 },
  { page: 'Lịch Sử Mô Hình DISC. Từ Lý Thuyết Đến Ứng Dụng', en: 'The DISC Model: From Theory to Practice', pages: null, t: 0.012 },   // a talk: no printed edition found; a slim booklet
  { page: '"Damn Right!" Bí Ẩn Charlie Munger', en: 'Damn Right!', full: 'Damn Right! Behind the Scenes with Berkshire Hathaway Billionaire Charlie Munger', pages: 304 },
  { page: 'Paths to Wealth Through Common Stocks', en: 'Paths to Wealth Through Common Stocks', pages: 214 },
  { page: 'Money Masters of Our Time', en: 'Money Masters of Our Time', pages: 400 },
  { page: "The Innovator's Dilemma", en: "The Innovator's Dilemma", full: "The Innovator's Dilemma: When New Technologies Cause Great Firms to Fail", pages: 286 },
  { page: 'Phong cách NVIDIA: Chiến lược và Văn hóa dẫn đầu AI', en: 'The Nvidia Way', full: 'The Nvidia Way: Jensen Huang and the Making of a Tech Giant', by: 'Tae Kim · 2024', pages: 272 },   // W. W. Norton
  { page: 'A. Charlie Munger: Poor Charlie’s Almanack Tư Duy Đa Chiều', en: "Poor Charlie's Almanack", full: "Poor Charlie's Almanack: The Wit and Wisdom of Charles T. Munger", by: 'Charles T. Munger, ed. Peter D. Kaufman · 2005', pages: 512, h: 0.31 },   // a large-format book
  { page: 'Khuyến Học', en: 'An Encouragement of Learning', pages: 192 },   // Fukuzawa's Gakumon no susume, tr. David A. Dilworth
  { page: 'Động lực và Nhân cách', en: 'Motivation and Personality', pages: 400 },
  { page: 'Phi Lý Trí', en: 'Predictably Irrational', full: 'Predictably Irrational: The Hidden Forces That Shape Our Decisions', pages: 368 },
  { page: 'Tâm lý học Hài hước', en: 'Quirkology', full: 'Quirkology: How We Discover the Big Truths in Small Things', pages: 322 },
  { page: 'Tư duy như một kẻ lập dị', en: 'Think Like a Freak', pages: 274 },
  { page: 'Khi nào cướp nhà băng', en: 'When to Rob a Bank', full: 'When to Rob a Bank: …And 131 More Warped Suggestions and Well-Intended Rants', pages: 400 },
  { page: 'Quy Luật Bản Chất Con Người', en: 'The Laws of Human Nature', pages: 617 },
  { page: 'Tâm lý học về tiền', en: 'The Psychology of Money', full: 'The Psychology of Money: Timeless Lessons on Wealth, Greed, and Happiness', pages: 288 },
  { page: 'Think Again', en: 'Think Again', full: "Think Again: The Power of Knowing What You Don't Know", pages: 320 },
  { page: '[Mô hình kinh tế]', en: '[Economic models]', pages: null },   // a heading on the page, not a book
  { page: 'Súng, Vi Trùng và Thép', en: 'Guns, Germs, and Steel', full: 'Guns, Germs, and Steel: The Fates of Human Societies', pages: 528 },
  { page: 'Sự giàu có và nghèo đói của các Quốc gia', en: 'The Wealth and Poverty of Nations', full: 'The Wealth and Poverty of Nations: Why Some Are So Rich and Some So Poor', pages: 650 },
  { page: 'Những Tù Nhân Của Địa Lý', en: 'Prisoners of Geography', full: 'Prisoners of Geography: Ten Maps That Explain Everything About the World', pages: 291 },
  { page: 'Quốc Gia Thăng Trầm', en: 'The Rise and Fall of Nations', full: 'The Rise and Fall of Nations: Forces of Change in the Post-Crisis World', pages: 466 },
  { page: 'Trò chơi quyền lực', en: 'The Power Game', full: 'The Power Game: The Past, Present and Future of the World Order', pages: 370 },   // Omega+ 2024 (no English edition)
  { page: 'Người thợ đồng hồ mù', en: 'The Blind Watchmaker', pages: 368 },
  { page: 'Lược Sử Thời Gian', en: 'A Brief History of Time', pages: 241 },
  { page: 'Deep Simplicity', en: 'Deep Simplicity', full: 'Deep Simplicity: Bringing Order to Chaos and Complexity', pages: 304 },
];
const bookKey = s => String(s || '').normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
const BOOK_BY_TITLE = new Map(BOOK_INFO.map(b => [bookKey(b.page), b]));
const bookInfo = it => (it && BOOK_BY_TITLE.get(bookKey(it.title))) || null;
const pageLang = () => document.documentElement.getAttribute('data-lang') === 'vi' ? 'vi' : 'en';
// the title in a language: Vietnamese as the page writes it, English from the table (else the page's)
const titleIn = (it, lang = pageLang()) => { const b = bookInfo(it); return lang === 'en' && b ? b.en : it.title; };
// the page's author · year, or the table's where the page has none (or only the year)
const byOf = it => { const b = bookInfo(it); return b && b.by && (!it.by || /^\d{3,4}$/.test(it.by.trim())) ? b.by : it.by || ''; };
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
      const h = info.h || 0.205 + Math.min(1, Math.max(0, (bk.h - 0.2) / 0.14)) * 0.04;
      (byCell.get(cl) || byCell.set(cl, new Map()).get(cl)).set(bk.idx, { t: info.pages ? spineOf(info.pages) : info.t, h });
    }
    for (const [cl, sizes] of byCell) {
      for (const i of refitCell(cl, sizes, keep)) booksMesh.setMatrixAt(i, BOOK.list[i].m);
      for (const [i, sz] of sizes) { const bk = sec.books.find(b => b.idx === i); bk.t = sz.t; bk.h = sz.h; }
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
/* ---- the book that leaves the shelf: a real box with its title printed on the cover and the spine */
function wrapText(g, text, maxW) {
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const w of words) { const tryL = line ? line + ' ' + w : w; if (g.measureText(tryL).width > maxW && line) { lines.push(line); line = w; } else line = tryL; }
  if (line) lines.push(line); return lines;
}
function inkFor(col) { const hsl = {}; col.getHSL(hsl, THREE.SRGBColorSpace); return hsl.l < 0.55 ? '#f3ead6' : '#2a2118'; }
function coverTexture(bk) {   // cloth and a printed frame; the words are drawn sharp on top (see bookWords)
  const W = 420, H = Math.round(420 * bk.h / bk.d), c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#' + bk.color.getHexString(THREE.SRGBColorSpace); g.fillRect(0, 0, W, H);
  const r = rng(bk.idx + 7); for (let k = 0; k < 2600; k++) { g.fillStyle = `rgba(${r() < .5 ? '0,0,0' : '255,255,255'},${r() * .05})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
  const ink = inkFor(bk.color); g.strokeStyle = ink; g.globalAlpha = 0.55; g.lineWidth = 2; g.strokeRect(22, 22, W - 44, H - 44); g.lineWidth = 1; g.strokeRect(30, 30, W - 60, H - 60); g.globalAlpha = 1;
  const t = ctex(c, { rep: false }); t.anisotropy = 8; return t;
}
function spineTexture(bk) {
  const W = 96, H = Math.round(96 * bk.h / bk.t), c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#' + bk.color.getHexString(THREE.SRGBColorSpace); g.fillRect(0, 0, W, H);
  const ink = inkFor(bk.color); g.fillStyle = ink; g.globalAlpha = 0.6; g.fillRect(0, 24, W, 3); g.fillRect(0, H - 27, W, 3); g.globalAlpha = 1;
  const t = ctex(c, { rep: false }); t.anisotropy = 8; return t;
}
function heroMesh(bk) {
  if (bk.hero) return bk.hero;
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, -0.5);   // like the shelf books: origin at the foot of the spine, spine toward +z
  // lit like the room, but it glows a little from within so it is never too dark to read (in front of the camera, by night)
  const std = o => new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0, fog: false, emissiveIntensity: 0.32, ...o });
  const cover = coverTexture(bk), spine = spineTexture(bk);
  const pages = std({ color: 0xeee5cf, emissive: 0xeee5cf, roughness: 0.9 }), plain = std({ color: bk.color, emissive: bk.color });
  const m = new THREE.Mesh(geo, [std({ map: cover, emissive: 0xffffff, emissiveMap: cover }), plain, pages, pages, std({ map: spine, emissive: 0xffffff, emissiveMap: spine }), pages]);
  m.castShadow = true; m.visible = false; m.userData.book = bk; scene.add(m); bk.hero = m; bookWords(bk); return m;
}
/* ---- the printed words of a book on the move: drawn after the watercolour pass so they stay sharp, and hidden
   wherever the room stands in front of the book (each pixel is tested against the room's depth) */
const OVER = { scene: new THREE.Scene(), u: { uDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) } }, words: [] };
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
function coverWords(bk) {   // the title as large as fits above the author (italics) and the year
  const W = 576, H = Math.round(W * bk.h / bk.d), { c, g } = wordsCanvas(W, H, bk), serif = `Georgia, 'Times New Roman', serif`, halo = g.shadowBlur;
  g.textBaseline = 'alphabetic';
  const by = byOf(bk.it), parts = by ? by.split(/\s+·\s+/) : [], year = parts.length && /^\d{3,4}$/.test(parts[parts.length - 1]) ? parts.pop() : '', who = parts.join(' · ');
  const bs = Math.round(W * 0.072), ys = Math.round(W * 0.056);
  g.font = `italic ${bs}px ${serif}`; const wl = who ? wrapText(g, who, W - 110) : [];
  const yearY = H - W * 0.15, lastWho = year ? yearY - ys * 1.45 : yearY;
  const top = wl.length ? lastWho - (wl.length - 1) * bs * 1.2 - bs : year ? yearY - ys : H - W * 0.1;
  let size = Math.round(W * 0.118), lines = [];
  const bottom = () => H * 0.2 + size + (lines.length - 1) * size * 1.16 + size * 0.55;
  for (;; size -= 2) { g.font = `600 ${size}px ${serif}`; lines = wrapText(g, titleIn(bk.it), W - 104); if (size <= 22 || (lines.length <= 5 && bottom() < top - W * 0.05)) break; }
  const y0 = H * 0.2 + size; lines.forEach((l, k) => g.fillText(l, W / 2, y0 + k * size * 1.16));
  g.shadowBlur = 0; g.globalAlpha = 0.65; g.fillRect(W / 2 - 44, bottom(), 88, 3); g.globalAlpha = 1; g.shadowBlur = halo;
  if (year) { g.font = `500 ${ys}px ${serif}`; g.fillText(year, W / 2, yearY); }
  g.font = `italic ${bs}px ${serif}`; wl.forEach((l, k) => g.fillText(l, W / 2, lastWho - (wl.length - 1 - k) * bs * 1.2));
  const t = ctex(c, { srgb: false, rep: false }); t.anisotropy = 8; return t;
}
function spineWords(bk) {   // the title along the spine, as large as the spine allows (narrowed a little rather than cut)
  if (bk.spineTex) return bk.spineTex;
  const W = 64, H = Math.max(64, Math.round(W * bk.h / bk.t)), { c, g } = wordsCanvas(W, H, bk), font = n => `600 ${n}px Inter, 'Helvetica Neue', Arial, sans-serif`;
  g.shadowBlur = 4; g.translate(W / 2, H / 2); g.rotate(Math.PI / 2); g.textBaseline = 'middle';
  const room = H * 0.88 - 6, two = bk.t >= 0.028;   // a thick spine (from ~400 pages) takes two lines
  let size = Math.round(W * (two ? 0.4 : 0.62)), txt = titleIn(bk.it); g.font = font(size);
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
    if (bk.words) {
      const [cover, spine] = bk.words.children; cover.material.uniforms.map.value.dispose();
      cover.material.uniforms.map.value = coverWords(bk); spine.material.uniforms.map.value = spineWords(bk);
    }
  }
}
function spinePx(bk) {   // how wide the spine shows on screen, in pixels
  _sa.set(-0.5, 0.5, 0).applyMatrix4(bk.m0).project(camera); _sb.set(0.5, 0.5, 0).applyMatrix4(bk.m0).project(camera);
  if (Math.abs(_sa.z) > 1 || Math.abs(_sb.z) > 1) return 0;
  return Math.hypot((_sa.x - _sb.x) * innerWidth, (_sa.y - _sb.y) * innerHeight) / 2;
}
function bookWords(bk) {   // planes 2 mm off the cover and the spine, in the book's own unit-box frame
  if (bk.words) return bk.words;
  const grp = new THREE.Group(); grp.matrixAutoUpdate = false; grp.visible = false;
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), crispMaterial(coverWords(bk)));
  cover.matrixAutoUpdate = false; cover.matrix.makeRotationY(Math.PI / 2).setPosition(0.5 + 0.002 / bk.t, 0.5, -0.5);
  const spine = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), crispMaterial(spineWords(bk)));
  spine.matrixAutoUpdate = false; spine.matrix.makeTranslation(0, 0.5, 0.002 / bk.d);
  grp.add(cover, spine); OVER.scene.add(grp); OVER.words.push(bk); bk.words = grp; return grp;
}
function drawWords() {   // the sharp layer: titles on the spines, words of the books on the move, and the night sky
  let any = false;
  for (const bk of OVER.words) { const on = !!(bk.hero && bk.hero.visible); bk.words.visible = on; if (on) { bk.words.matrix.copy(bk.hero.matrixWorld); any = true; } }
  for (const sec of UIS.secs) for (const bk of sec.books) {
    const on = !bk.away && spinePx(bk) >= 14; if (on) { shelfSpine(bk).visible = true; any = true; } else if (bk.shelfSpine) bk.shelfSpine.visible = false;   // too narrow to read (the whole room in view): none
  }
  if (OVER.sky) { const night = NIGHT.u.value > 0.005; OVER.sky.visible = night; if (night) { any = true; OVER.u.uTime.value = clock.getElapsedTime(); OVER.moonAge.value = moonAge(); loadMoon(); } }
  if (FLY.pts) { FLY.on = FLY.u.value > 0.01; FLY.pts.visible = FLY.on; if (FLY.on) { any = true; FLY.t.value = clock.getElapsedTime(); } }
  OVER.u.uDepth.value = POST.rt.depthTexture; renderer.getDrawingBufferSize(OVER.u.uRes.value); if (OVER.u.uPR) OVER.u.uPR.value = renderer.getPixelRatio();
  drawDeck(); drawPets();
  if (!any) return;
  renderer.autoClear = false; renderer.render(OVER.scene, camera); renderer.autoClear = true;
}
/* ---- the night sky over the glass: stars and the moon, drawn sharp after the watercolour pass (its filter wipes out
   points this small) and only where the room shows sky: every pixel is tested against the room's depth, which the sky
   dome and the glass leave empty. The moon has the phase of the page's sky clock and hangs in the left glass. */
const LUNAR = 29.530588853, NEW_MOON = Date.UTC(2025, 6, 25, 18, 2);   // the page's own reference new moon
const moonAge = (t = Date.now()) => ((((t - NEW_MOON) / 864e5) % LUNAR) + LUNAR) % LUNAR / LUNAR;   // 0 new, 0.5 full
const SKY_DEPTH = 'if (gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 1e-7) discard;';
function buildNightSky() {
  const eye = REF.eye, far = 240, sky = new THREE.Group(); sky.visible = false; OVER.scene.add(sky); OVER.sky = sky;
  OVER.u.uTime = { value: 0 }; OVER.u.uPR = { value: 1 }; OVER.moonAge = { value: moonAge() };
  // stars: uniform over the dome from ~1° up, most faint, a few bright; each twinkles at its own pace
  const n = 8000, pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n), r = rng(2024);
  for (let i = 0; i < n; i++) {
    const az = r() * Math.PI * 2, el = Math.asin(0.02 + 0.98 * r()), b = Math.pow(r(), 6);
    pos.set([eye.x + Math.cos(el) * Math.sin(az) * far, eye.y + Math.sin(el) * far, eye.z + Math.cos(el) * Math.cos(az) * far], i * 3);
    size[i] = 1.6 + b * 3.2; seed[i] = r();
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const stars = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uTime: OVER.u.uTime, uNight: NIGHT.u, uPR: OVER.u.uPR },
    vertexShader: `attribute float aSize, aSeed; uniform float uTime, uPR; varying float vB;
      void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPR;
        vB = (0.6 + 0.4 * smoothstep(1.6, 4.0, aSize)) * (0.74 + 0.26 * sin(uTime * (0.8 + aSeed * 1.9) + aSeed * 37.0)); }`,
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNight; varying float vB;
      void main(){ ${SKY_DEPTH} float d = length(gl_PointCoord - 0.5) * 2.0, a = smoothstep(1.0, 0.25, d) * vB * uNight; if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * a, a); }`,
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false }));
  stars.frustumCulled = false; sky.add(stars);
  // the moon: the page's own moon picture for tonight's phase (the one its sky clock shows), 1.6° across (the real one is
  // 0.5°), with a soft halo
  const rad = far * Math.tan(0.8 * Math.PI / 180);
  OVER.moonImg = { value: null };
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(6 * rad, 6 * rad), new THREE.ShaderMaterial({
    uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uNight: NIGHT.u, uAge: OVER.moonAge, uImg: OVER.moonImg },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uDepth, uImg; uniform vec2 uRes; uniform float uNight, uAge; varying vec2 vUv;
      void main(){ ${SKY_DEPTH}
        vec2 p = (vUv - 0.5) * 6.0; float r = length(p), lit = 0.5 - 0.5 * cos(uAge * 6.2831853);
        vec4 c = vec4(0.0);
        if (r < 1.02) { vec4 m = texture2D(uImg, p * 0.5 + 0.5); c = vec4(m.rgb * m.a, m.a); }   // straight-alpha picture, made premultiplied
        float halo = 0.3 * exp(-max(r - 1.0, 0.0) * 1.7) * (0.45 + 0.55 * lit) * smoothstep(3.0, 2.2, r) * (1.0 - c.a);
        c += vec4(vec3(0.82, 0.86, 1.0) * halo, halo);
        if (c.a < 0.004) discard; gl_FragColor = c * uNight; }`,
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false }));
  moon.visible = false;   // until its picture has loaded
  sky.add(moon); OVER.moon = moon; placeMoon();
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
}
/* ---- fireflies: from dusk on, three drift through the room and nineteen through the garden outside, and flash, drawn sharp over the picture like the stars
   (the paint pass would smear points this small) and hidden behind whatever the room puts in front of them. Each one
   wanders slowly around its own spot (three unrelated sways, so no two paths repeat together) and flashes on its own
   beat: a ~0.7 s yellow-green pulse every 3 to 7 s, with a dimmer glow in between. They come out as the sun goes under
   the trees (3° to −5°). All the motion is in the vertex shader: nothing on the CPU per frame. */
const FLY = { u: { value: 0 }, t: { value: 0 }, pts: null, on: false };
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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(home, 3)); g.setAttribute('aSway', new THREE.BufferAttribute(sway, 4)); g.setAttribute('aBeat', new THREE.BufferAttribute(beat, 3));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uTime: FLY.t, uOn: FLY.u },
    vertexShader: `attribute vec4 aSway; attribute vec3 aBeat; uniform float uTime, uOn; uniform vec2 uRes; varying float vB;
      void main(){ float t = uTime + aSway.w, k = 0.6 + 0.4 * fract(aSway.w * 7.13);
        vec3 p = position + vec3(sin(t * 0.23 * k) + 0.45 * sin(t * 0.61 + 1.3), sin(t * 0.37 * k + 2.0) + 0.35 * sin(t * 1.7), sin(t * 0.17 * k + 4.0) + 0.4 * cos(t * 0.53)) * aSway.xyz;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float ph = fract((uTime + aBeat.y) / aBeat.x), flash = smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.05, 0.05 + 0.7 / aBeat.x, ph));
        vB = (0.3 + 0.9 * flash) * uOn;
        gl_PointSize = clamp(0.22 * aBeat.z * projectionMatrix[1][1] * 0.5 * uRes.y / -mv.z, 6.0, 90.0); }`,
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; varying float vB;
      void main(){ if (gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 4e-6) discard;
        float d = length(gl_PointCoord - 0.5) * 2.0, core = smoothstep(0.16, 0.03, d), halo = pow(max(1.0 - d, 0.0), 3.0);
        float a = (core + 0.7 * halo) * vB; if (a < 0.004) discard;
        gl_FragColor = vec4(mix(vec3(0.62, 0.95, 0.22), vec3(1.0, 1.0, 0.78), core) * a, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
  pts.frustumCulled = false; pts.visible = false; OVER.scene.add(pts); FLY.pts = pts;
}
/* ---------------------------------------------------------------- the cat and the chicken
   A black cat with white paws lives in the room ("Cat Walk", CC BY-NC 4.0: its mesh and skeleton; see the credits). By
   day it lies on the floor by the left glass, awake, watching a chicken ("Chicken", CC BY 4.0) forage outside; at night
   it sleeps curled up on the chaise and the chicken has gone to roost. Both are drawn crisp over the painted room (not
   watercoloured), lit by the room's own lights, hidden where the room stands in front of them.
   The cat's poses are made on its own skeleton: each bone is aimed (turned about its joint so the line to its next joint
   takes a chosen direction, parents first) in the cat's frame (forward +z, up +y, left +x); then it is laid on its right
   side and set down. What both do follows how the animals behave:
   - the cat: a resting cat breathes 16 to 25 times a minute, a sleeper slower; one watching a bird through glass keeps
     its head on it and its ears forward, its tail tip twitches, now and then its jaw chatters; a relaxed cat blinks
     slowly. So: breathing; head (and gaze) on the chicken with glances back into the room; ear flicks; tail-tip
     twitches, quicker while the hen is busy; blinks, slow ones when it looks away; chatter when the hen pecks. Asleep:
     slower breathing with a sigh now and then, an ear or the tail tip twitching, eyes shut.
   - the chicken: a walking bird's head holds still in space while the body passes under it, then thrusts ahead, one
     bob a step; a foraging hen scratches in a four-stroke bout (one foot, the other twice, the first again), steps
     back, looks at the ground with one eye and pecks in quick bouts; between bouts it stands and looks about, and it
     wanders within its patch. Its model has no skeleton: its head and neck, body and feet move in the vertex shader,
     by regions of the mesh (measured on it).
   Both come from pets.glb (src/tools/pets/pack.mjs), fetched once the room shows; they are on layer 1, which only
   their crisp pass sees (the painted pass, the shadows and the picking see layer 0).                              */
const PETS = { ok: false, cat: null, holder: null, chicken: null, bones: {}, poses: {}, state: null, layer: 1, last: 0 };
// where the cat stays: by day the floor between the stump table and the glass, by night the chaise of the sofa
const CAT_SPOT = { day: { x: -0.82, z: -5.02, yaw: -Math.PI / 2 - 0.12 }, night: { x: 1.6, z: -5.95, yaw: 0.6 } };
// the chicken's patch of lawn outside the left glass (it wanders in it), and its height
const HEN_AREA = { x0: -2.3, x1: -1.6, z0: -5.7, z1: -4.5, h: 0.42 };
const CAT_POSES = {
  // awake, lying on its side: back nearly straight, head up and looking ahead, front legs reaching, tail along the floor
  day: { spine: [4, 6, 8, 10, [0.45, -0.05, 0.89], [0.75, 0.05, 0.66]], head: [[0, 0, 1], -55],
    arm: [[0, -0.8, 0.6], [0, -0.42, 0.91], [0, -0.15, 0.99]], leg: [[0, -0.72, 0.69], [0, -0.5, -0.87], [0, -0.8, 0.6]],
    tail: [[-0.3, 0, -0.95], [-0.15, -0.3, -0.94], [0, -0.7, -0.71], [0, -0.95, -0.3]] },
  // asleep, curled into a ring: back bent round, head tucked toward the hind legs, legs folded in, tail wrapped round
  night: { spine: [32, 68, 104, 142, 176, 206], head: [[1, 0, 0], 45],
    arm: [[0, 0.3, -0.95], [0, -0.95, -0.3], [0, -0.6, 0.8]], leg: [[0, -0.55, 0.83], [0, -0.35, -0.94], [0, -0.5, 0.87]],
    tail: [[-0.3, 0.1, -0.95], [-0.3, -0.5, -0.81], [-0.25, -0.93, -0.25], [-0.2, -0.8, 0.56]] },
};
const _pq = new THREE.Quaternion(), _r = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
function aimBone(b, child, dir) {
  b.updateWorldMatrix(true, true);
  _a.setFromMatrixPosition(child.matrixWorld).sub(_b.setFromMatrixPosition(b.matrixWorld)).normalize();
  _r.setFromUnitVectors(_a, _b.set(...dir).normalize()); b.parent.getWorldQuaternion(_pq);
  b.quaternion.premultiply(_pq.clone().invert().multiply(_r).multiply(_pq)); b.updateWorldMatrix(false, true);
}
function turnWorld(b, q) {   // a turn given in world space, through the bone's own joint
  b.parent.updateWorldMatrix(true, false); b.parent.getWorldQuaternion(_pq);
  b.quaternion.premultiply(_pq.clone().invert().multiply(q).multiply(_pq)); b.updateWorldMatrix(false, true);
}
const turnBone = (b, axis, deg) => turnWorld(b, _r.setFromAxisAngle(_b.set(...axis).normalize(), deg * Math.PI / 180));
// a pose, worked out on the cat at the origin and kept as its bones' rotations and its body's place
function catPose(P) {
  const B = PETS.bones, body = PETS.cat;
  for (const [k, q] of PETS.rest) k.quaternion.copy(q);
  body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); body.updateMatrixWorld(true);
  const arc = th => [0, -Math.sin(th * Math.PI / 180), Math.cos(th * Math.PI / 180)];   // bent th degrees toward the belly
  const chain = (names, dirs) => names.slice(0, -1).forEach((k, i) => aimBone(B[k], B[names[i + 1]], dirs[i]));
  chain(['Spine', 'Spine1', 'Spine2', 'Spine3', 'Neck', 'Neck1', 'Head'], P.spine.map(a => typeof a === 'number' ? arc(a) : a));
  turnBone(B.Head, ...P.head);
  for (const s of ['L', 'R']) {
    chain([s + '-UpperArm', s + '-Forearm', s + '-Hand', s + '-Finger0'], P.arm);
    chain([s + '-Thigh', s + '-Calf', s + '-Foot', s + '-Toe0'], P.leg);
  }
  chain(['Tail', 'Tail1', 'Tail2', 'Tail3', 'TailNub'], P.tail);
  body.rotation.z = Math.PI / 2; body.updateMatrixWorld(true);   // onto its right side
  const box = new THREE.Box3().setFromObject(body, true); body.position.y = -box.min.y; body.updateMatrixWorld(true);
  return { q: new Map([...PETS.rest.keys()].map(b => [b, b.quaternion.clone()])), pos: body.position.clone(), quat: body.quaternion.clone() };
}
// the surface under a point: the first thing a ray from above meets (the floor if nothing)
function surfaceAt(x, z) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 2.5, z), new THREE.Vector3(0, -1, 0), 0, 3); ray.camera = camera;   // (sprites ask for it)
  const hit = ray.intersectObject(room, true).find(h => h.object.isMesh && h.object.visible && h.point.y < 1.2);
  return hit ? hit.point.y : 0;
}
async function getPetsBuffer() {   // inline (base64) in the one-file build, a file next to the page on GitHub Pages
  const el = document.getElementById('pets-glb');
  if (el && el.dataset.src) { const r = await fetch(el.dataset.src); if (!r.ok) throw new Error('pets.glb ' + r.status); return r.arrayBuffer(); }
  if (el && el.textContent.trim().length > 100) return (await fetch('data:application/octet-stream;base64,' + el.textContent.trim())).arrayBuffer();
  return null;
}
// a soft shadow where an animal touches the ground (in the room, so it is painted with it)
let _shadowTex = null;
function contactShadow(w, d) {
  if (!_shadowTex) { const c = canvas(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(18,11,5,.72)'); gr.addColorStop(0.55, 'rgba(18,11,5,.38)'); gr.addColorStop(1, 'rgba(18,11,5,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); _shadowTex = ctex(c, { rep: false }); }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: _shadowTex, transparent: true, depthWrite: false, fog: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1; return m;
}
/* ---- crisp: drawn over the picture, a fragment is dropped where the room is nearer (the room's depth, as the deck) */
const SHARP = { rt: null, cam: new THREE.Camera(), quad: null, exp: { value: 1 }, v: new THREE.Vector3() };
function crispPatch(sh) {
  sh.uniforms.uDepth = DECKR.u.uDepth; sh.uniforms.uFull = DECKR.u.uFull; sh.uniforms.uOff = DECKR.u.uOff;
  sh.fragmentShader = 'uniform sampler2D uDepth; uniform vec2 uFull, uOff;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;');
}
/* ---- the chicken's head and neck, body and feet, moved in the vertex shader. Its mesh is baked into a frame where it
   stands on y = 0 facing +x, 0.42 m tall: head and neck are what lies above 0.26 m ahead of x = 0.02 (turning about the
   neck's base), the feet and shanks what lies under 0.13 m (left foot at +z); the body pitches about the hips. */
const HEN = { u: { uNeck: { value: new THREE.Vector3(0.085, 0.255, 0.02) }, uHeadR: { value: new THREE.Matrix3() }, uHeadT: { value: new THREE.Vector3() },
  uHip: { value: new THREE.Vector3(0, 0.12, 0) }, uBodyR: { value: new THREE.Matrix3() }, uFootL: { value: new THREE.Vector3() }, uFootR: { value: new THREE.Vector3() } } };
function henPatch(sh) {
  crispPatch(sh); Object.assign(sh.uniforms, HEN.u);
  sh.vertexShader = 'uniform vec3 uNeck, uHeadT, uHip, uFootL, uFootR; uniform mat3 uHeadR, uBodyR;\n' + sh.vertexShader
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      float wH = smoothstep(0.26, 0.33, position.y) * smoothstep(0.02, 0.1, position.x), wF = 1.0 - smoothstep(0.08, 0.13, position.y);
      objectNormal = normalize(mix(objectNormal, uHeadR * objectNormal, wH)); objectNormal = normalize(mix(uBodyR * objectNormal, objectNormal, wF));`)
    .replace('#include <begin_vertex>', `vec3 transformed = position;
      transformed += wF * (1.0 - position.y / 0.13) * mix(uFootR, uFootL, smoothstep(-0.02, 0.02, position.z));
      transformed = mix(transformed, uHeadR * (transformed - uNeck) + uNeck + uHeadT, wH);
      transformed = mix(uBodyR * (transformed - uHip) + uHip, transformed, wF);`);
}
const toFloat = (attr, m, normal) => {   // a (quantized) attribute as plain floats, moved by a matrix
  const out = new Float32Array(attr.count * 3), v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
  for (let i = 0; i < attr.count; i++) { v.fromBufferAttribute(attr, i); if (normal) v.applyMatrix3(nm).normalize(); else v.applyMatrix4(m); v.toArray(out, i * 3); }
  return new THREE.BufferAttribute(out, 3);
};
async function loadPets() {
  const buf = await getPetsBuffer(); if (!buf) return;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '');
  const cat = gltf.scene.getObjectByName('cat'), hen = gltf.scene.getObjectByName('chicken');
  if (!cat) return;
  const L = PETS.layer;
  // the cat: centimetres to metres; its bones by name (the jaw is fst-Xtra01)
  cat.removeFromParent(); const body = new THREE.Group(); body.add(cat); body.scale.setScalar(0.01);
  cat.traverse(o => {
    if (/^cat_bip-|^fst-Xtra01/.test(o.name)) PETS.bones[o.name.replace(/^cat_bip-/, '').replace(/_\d+$/, '')] = o;
    if (o.isMesh) { o.frustumCulled = false; o.layers.set(L); [].concat(o.material).forEach(m => { m.fog = false; m.onBeforeCompile = crispPatch; if (/eye/i.test(m.name)) PETS.eyes = o; }); }
  });
  PETS.cat = body; PETS.rest = new Map(Object.values(PETS.bones).map(b => [b, b.quaternion.clone()]));
  // where the head looks, in its own frame (the cat faces +z in its rest pose)
  body.updateMatrixWorld(true); PETS.nose = new THREE.Vector3(0, 0, 1).applyQuaternion(PETS.bones.Head.getWorldQuaternion(new THREE.Quaternion()).invert());
  PETS.poses.day = catPose(CAT_POSES.day); PETS.poses.night = catPose(CAT_POSES.night);
  const holder = new THREE.Group(); holder.add(body); PETS.holder = holder;
  for (const k of ['day', 'night']) { const s = CAT_SPOT[k]; s.y = surfaceAt(s.x, s.z); }
  PETS.catShadow = contactShadow(0.7, 0.42); room.add(PETS.catShadow);
  if (hen) {   // the chicken: its mesh baked into its own frame (standing on y = 0, facing +x, 0.42 m tall)
    hen.removeFromParent(); hen.updateMatrixWorld(true);
    let mesh = null; hen.traverse(o => { if (o.isMesh) mesh = o; });
    const box = new THREE.Box3().setFromObject(hen), k = HEN_AREA.h / (box.max.y - box.min.y);
    const m = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)).multiply(mesh.matrixWorld);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', toFloat(mesh.geometry.attributes.position, m)); g.setAttribute('normal', toFloat(mesh.geometry.attributes.normal, m, true));
    if (mesh.geometry.attributes.uv) g.setAttribute('uv', mesh.geometry.attributes.uv); if (mesh.geometry.index) g.setIndex(mesh.geometry.index);
    const mat = mesh.material; mat.onBeforeCompile = henPatch; mat.fog = true;
    const bird = new THREE.Mesh(g, mat); bird.frustumCulled = false; bird.layers.set(L);
    PETS.chicken = new THREE.Group(); PETS.chicken.add(bird);
    PETS.henShadow = contactShadow(0.36, 0.22); PETS.henShadow.material.fog = true; scene.add(PETS.henShadow);
    Object.assign(HEN, { x: -1.75, z: -5.0, yaw: 0.25, act: null, queue: null, t: 0, look: 0, tilt: 0, lookT: 0, tiltT: 0 });
  }
  // the room's lights light them too (they are on their own layer, which only the crisp pass sees)
  scene.traverse(o => { if (o.isLight) o.layers.enable(L); });
  SHARP.cam.layers.set(L);
  SHARP.quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { t: { value: null }, uScale: { value: new THREE.Vector2(1, 1) }, uExp: SHARP.exp }, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false,
    vertexShader: QUAD_VS, fragmentShader: 'uniform sampler2D t; uniform vec2 uScale; uniform float uExp; varying vec2 vUv; void main(){ vec4 c = texture2D(t, vUv * uScale); gl_FragColor = vec4(c.rgb * uExp, c.a);\n#include <colorspace_fragment>\n}' }));
  // their shaders compiled in the background (for a linear target like theirs) before they appear
  scene.add(holder); if (PETS.chicken) scene.add(PETS.chicken);
  if (renderer.compileAsync) { renderer.setRenderTarget(POST.rt); try { await renderer.compileAsync(holder, SHARP.cam, scene); if (PETS.chicken) await renderer.compileAsync(PETS.chicken, SHARP.cam, scene); } catch (e) { /* compiled on first use */ } renderer.setRenderTarget(null); }
  PETS.ok = true; PETS.state = null; petsForHour(HOUR.S); setNeeds(true);
}
// by day on the floor (and the chicken outside), by night asleep on the chaise (the chicken has gone to roost)
const CAT = {};
function petsForHour(S) {
  if (!PETS.ok) return;
  const state = S.n > 0.5 ? 'night' : 'day'; if (state === PETS.state) return;
  PETS.state = state; const P = PETS.poses[state], s = CAT_SPOT[state];
  for (const [b, q] of P.q) b.quaternion.copy(q);
  PETS.cat.position.copy(P.pos); PETS.cat.quaternion.copy(P.quat);
  PETS.holder.position.set(s.x, s.y, s.z); PETS.holder.rotation.y = s.yaw; PETS.holder.scale.set(1, 1, 1); PETS.holder.updateMatrixWorld(true);
  const sh = PETS.catShadow; sh.position.set(s.x, s.y + 0.004, s.z); sh.rotation.z = s.yaw + Math.PI / 2; sh.scale.set(state === 'night' ? 0.62 : 1, 1, 1);
  if (PETS.chicken) PETS.chicken.visible = PETS.henShadow.visible = state === 'day';
  Object.assign(CAT, { look: null, ear: [0, 0], earT: [1, 2.5], tail: 0, tailT: 1, blink: 0, blinkT: 2, slow: false, chatter: 0, chatterT: 8, sigh: 0, sighT: 20, glance: 0, glanceT: 5 });
  setShadowsDirty(true); setNeeds(true);
}
/* ---- the cat's small life, on top of its pose */
const rnd = (a, b) => a + (b - a) * Math.random();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _hp = new THREE.Vector3(), _Z = new THREE.Vector3(0, 0, 1);
function stepCat(t, dt) {
  const B = PETS.bones, P = PETS.poses[PETS.state], night = PETS.state === 'night';
  for (const k of ['Neck1', 'Head', 'Ponytail1', 'Ponytail2', 'Tail2', 'Tail3', 'fst-Xtra01']) { const b = B[k]; if (b) b.quaternion.copy(P.q.get(b)); }
  // breathing: about 22 breaths a minute awake, 17 asleep; asleep, now and then a deeper sigh
  CAT.sighT -= dt; if (night && CAT.sighT <= 0) { CAT.sigh = 1; CAT.sighT = rnd(25, 60); }
  CAT.sigh = Math.max(0, CAT.sigh - dt / 4.5);
  const br = Math.sin(t * Math.PI * 2 * (night ? 0.28 : 0.37)), deep = 1 + 1.6 * Math.sin(Math.PI * CAT.sigh);
  PETS.holder.scale.set(1, 1 + (night ? 0.018 : 0.011) * br * deep, 1 + (night ? 0.01 : 0.006) * br * deep);
  // ears: a flick now and then, each on its own (rarer asleep)
  for (let e = 0; e < 2; e++) {
    CAT.earT[e] -= dt; if (CAT.earT[e] <= 0) { CAT.ear[e] = 1; CAT.earT[e] = night ? rnd(6, 18) : rnd(2, 7); }
    CAT.ear[e] = Math.max(0, CAT.ear[e] - dt / 0.22);
    const b = B[e ? 'Ponytail2' : 'Ponytail1']; if (b && CAT.ear[e] > 0) b.quaternion.multiply(_q.setFromAxisAngle(_Z, (e ? -1 : 1) * 0.55 * Math.sin(Math.PI * CAT.ear[e])));
  }
  // the tail's tip: twitches, often while the chicken is busy scratching or pecking; asleep, rarely
  const hen = PETS.chicken && PETS.chicken.visible, busy = !!(hen && HEN.act && /peck|scratch/.test(HEN.act.kind));
  CAT.tailT -= dt; if (CAT.tailT <= 0) { CAT.tail = 1; CAT.tailT = night ? rnd(8, 20) : busy ? rnd(0.5, 1.6) : rnd(2, 6); }
  CAT.tail = Math.max(0, CAT.tail - dt / 0.35);
  const tw = Math.sin(Math.PI * CAT.tail) * (night ? 0.25 : 0.45), sway = night ? 0 : 0.12 * Math.sin(t * 0.7);
  if (B.Tail2) B.Tail2.quaternion.multiply(_q.setFromAxisAngle(_Z, sway + tw * 0.5));
  if (B.Tail3) B.Tail3.quaternion.multiply(_q.setFromAxisAngle(_Z, tw));
  if (night) { if (PETS.eyes) PETS.eyes.visible = false; return; }   // asleep: eyes shut
  // awake: the head follows the chicken's head, with glances back into the room
  CAT.glanceT -= dt; if (CAT.glanceT <= 0) { CAT.glance = CAT.glance ? 0 : 1; CAT.glanceT = CAT.glance ? rnd(1.2, 2.8) : rnd(4, 10); }
  const head = B.Head; PETS.holder.updateMatrixWorld(true); head.getWorldPosition(_hp);
  const target = hen && !CAT.glance ? _w.set(HEN.x + Math.cos(HEN.yaw) * 0.12, 0.25, HEN.z - Math.sin(HEN.yaw) * 0.12) : _w.copy(camera.position).lerp(_hp, 0.4);
  const want = target.sub(_hp).normalize();
  if (!CAT.look) CAT.look = want.clone();
  const ang = CAT.look.angleTo(want); if (ang > 1e-4) CAT.look.lerp(want, Math.min(1, dt * 4.5 / Math.max(ang, 0.2))).normalize();
  const nose = _v.copy(PETS.nose).applyQuaternion(head.getWorldQuaternion(_q2));
  _q.setFromUnitVectors(nose, CAT.look); const lim = 2 * Math.acos(Math.min(1, Math.abs(_q.w)));
  if (lim > 1.2) _q.slerp(_q3.identity(), 1 - 1.2 / lim);   // a cat lying down turns its head ~70° at most
  const half = _q3.identity().slerp(_q, 0.5).clone(); turnWorld(B.Neck1, half); turnWorld(head, half);
  // blinks: a quick one every few seconds; a slow one (the relaxed cat's) when it looks away from the hen
  CAT.blinkT -= dt; if (CAT.blinkT <= 0) { CAT.slow = !!CAT.glance && Math.random() < 0.6; CAT.blink = 1; CAT.blinkT = rnd(3, 8); }
  CAT.blink = Math.max(0, CAT.blink - dt / (CAT.slow ? 0.9 : 0.16)); if (PETS.eyes) PETS.eyes.visible = CAT.blink <= 0.05;
  // chatter: the jaw clicks fast when the chicken pecks and the cat is watching
  CAT.chatterT -= dt; if (CAT.chatterT <= 0 && busy && !CAT.glance) { CAT.chatter = 1; CAT.chatterT = rnd(10, 25); }
  CAT.chatter = Math.max(0, CAT.chatter - dt / 1.3);
  const jaw = B['fst-Xtra01']; if (jaw && CAT.chatter > 0) jaw.quaternion.multiply(_q.setFromAxisAngle(_Z, -0.3 * Math.max(0, Math.sin(t * 2 * Math.PI * 7)) * Math.min(1, CAT.chatter * 3)));
}
/* ---- the chicken's foraging: a queue of acts, each moving its body, head and feet for a while */
const HEN_ACTS = {
  walk: n => ({ kind: 'walk', dur: n * 0.36, steps: n }), scratch: () => ({ kind: 'scratch', dur: 4 * 0.27 }), back: () => ({ kind: 'back', dur: 0.32 }),
  peer: () => ({ kind: 'peer', dur: rnd(0.5, 0.9) }), peck: n => ({ kind: 'peck', dur: n * 0.24 }), stand: () => ({ kind: 'stand', dur: rnd(1, 2.6) }), turn: a => ({ kind: 'turn', dur: 0.5, a }),
};
function henPlan() {   // what it does next: forage (scratch, step back, look, peck), wander, or stand and look about
  const A = HEN_AREA, inside = HEN.x > A.x0 + 0.12 && HEN.x < A.x1 - 0.12 && HEN.z > A.z0 + 0.12 && HEN.z < A.z1 - 0.12;
  if (!inside) { const cx = (A.x0 + A.x1) / 2 + rnd(-0.15, 0.15), cz = (A.z0 + A.z1) / 2 + rnd(-0.2, 0.2); return [HEN_ACTS.turn(Math.atan2(-(cz - HEN.z), cx - HEN.x)), HEN_ACTS.walk(3)]; }
  const r = Math.random();
  if (r < 0.5) return [HEN_ACTS.scratch(), HEN_ACTS.back(), HEN_ACTS.peer(), HEN_ACTS.peck(2 + Math.floor(rnd(0, 4)))];
  if (r < 0.75) return [HEN_ACTS.walk(2 + Math.floor(rnd(0, 4))), HEN_ACTS.peck(1 + Math.floor(rnd(0, 3)))];
  if (r < 0.88) return [HEN_ACTS.turn(HEN.yaw + rnd(-1.4, 1.4)), HEN_ACTS.walk(2)];
  return [HEN_ACTS.stand()];
}
const _m4 = new THREE.Matrix4(), _e = new THREE.Euler();
function stepHen(dt) {
  if (!HEN.queue || !HEN.queue.length) HEN.queue = henPlan();
  if (!HEN.act) { HEN.act = HEN.queue.shift(); HEN.t = 0; HEN.from = { x: HEN.x, z: HEN.z, yaw: HEN.yaw }; }
  const A = HEN.act; HEN.t += dt; const k = Math.min(1, HEN.t / A.dur), ease = k * k * (3 - 2 * k);
  let pitch = 0, neck = 0, headX = 0, headY = 0; const foot = [0, 0, 0, 0];   // left x, y, right x, y
  const fwd = d => { HEN.x = HEN.from.x + Math.cos(HEN.yaw) * d; HEN.z = HEN.from.z - Math.sin(HEN.yaw) * d; };
  if (A.kind === 'walk') {   // one bob a step: the head holds still in space as the body passes under it, then thrusts ahead
    const step = 0.065, s = Math.min(A.steps - 1e-6, HEN.t / 0.36), i = Math.floor(s), f = s - i; fwd(s * step);
    headX = f < 0.62 ? 0.03 - f / 0.62 * step : 0.03 - step + (f - 0.62) / 0.38 * step;
    const a = i % 2 ? 2 : 0, lift = Math.sin(Math.PI * f); foot[a] = (f - 0.5) * 0.07; foot[a + 1] = 0.028 * lift; foot[2 - a] = -(f - 0.5) * 0.03;
    pitch = -0.04 * lift;
  } else if (A.kind === 'scratch') {   // four strokes, each raking the ground backwards: one foot, the other twice, the first again
    const s = HEN.t / 0.27, i = Math.min(3, Math.floor(s)), f = s - Math.floor(s), a = [0, 2, 2, 0][i];
    foot[a] = f < 0.35 ? 0.03 * f / 0.35 : 0.03 - 0.11 * (f - 0.35) / 0.65; foot[a + 1] = 0.022 * Math.sin(Math.PI * Math.min(1, f / 0.5));
    pitch = 0.08; neck = 0.15;
  } else if (A.kind === 'back') { fwd(-0.06 * ease); pitch = 0.05 * Math.sin(Math.PI * k); }   // a step back to see what it turned up
  else if (A.kind === 'peer') { pitch = -0.25 * Math.sin(Math.PI * Math.min(1, k * 2)); neck = -0.45 * Math.min(1, k * 3); HEN.tiltT = 0.5; }   // one eye to the ground
  else if (A.kind === 'peck') {   // quick strikes at the ground: the body leans, the neck bends right down
    const f = (HEN.t / 0.24) % 1, d = f < 0.35 ? f / 0.35 : 1 - (f - 0.35) / 0.65, e = d * d * (3 - 2 * d);
    pitch = -0.6 * e; neck = -1.3 * e; HEN.tiltT = 0;
  } else if (A.kind === 'turn') HEN.yaw = HEN.from.yaw + (A.a - HEN.from.yaw) * ease;
  else if (A.kind === 'stand') { headY = 0.015; if (HEN.t > A.dur * 0.3 && !A.looked) { A.looked = true; HEN.lookT = rnd(-0.8, 0.8); HEN.tiltT = rnd(-0.35, 0.35); } }
  if (k >= 1) { HEN.act = null; HEN.lookT = Math.random() < 0.3 ? rnd(-0.6, 0.6) : 0; }
  // the head turns and tilts in quick moves, then holds
  HEN.look += (HEN.lookT - HEN.look) * Math.min(1, dt * 12); HEN.tilt += (HEN.tiltT - HEN.tilt) * Math.min(1, dt * 12);
  HEN.u.uHeadR.value.setFromMatrix4(_m4.makeRotationFromEuler(_e.set(HEN.tilt, HEN.look, neck, 'YXZ')));
  HEN.u.uHeadT.value.set(headX, headY, 0); HEN.u.uBodyR.value.setFromMatrix4(_m4.makeRotationZ(pitch));
  HEN.u.uFootL.value.set(foot[0], foot[1], 0); HEN.u.uFootR.value.set(foot[2], foot[3], 0);
  PETS.chicken.position.set(HEN.x, -0.12, HEN.z); PETS.chicken.rotation.y = HEN.yaw;
  PETS.henShadow.position.set(HEN.x + Math.cos(HEN.yaw) * 0.02, -0.116, HEN.z - Math.sin(HEN.yaw) * 0.02); PETS.henShadow.rotation.z = HEN.yaw;
}
/* ---- the crisp pass: the animals over the finished picture, in a small target covering where they are on screen */
const _c = new THREE.Color();
function drawPets() {
  if (!PETS.ok) return;
  const t = clock.getElapsedTime(), dt = Math.min(0.1, Math.max(0, t - PETS.last)); PETS.last = t;
  if (!reduceMotion) { stepCat(t, dt); if (PETS.chicken && PETS.chicken.visible) stepHen(dt); }
  const W = OVER.u.uRes.value.x, H = OVER.u.uRes.value.y, pr = renderer.getPixelRatio();
  let x0 = W, y0 = H, x1 = 0, y1 = 0, any = false;
  const add = (cx, cy, cz, rx, ry, rz) => { for (let i = 0; i < 8; i++) { const v = SHARP.v.set(cx + (i & 1 ? rx : -rx), cy + (i & 2 ? ry : 0), cz + (i & 4 ? rz : -rz)).project(camera); if (v.z > 1 || v.z < -1) continue;
    any = true; const px = (v.x + 1) / 2 * W, py = (v.y + 1) / 2 * H; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); } };
  const hp = PETS.holder.position; add(hp.x, hp.y - 0.02, hp.z, 0.48, 0.42, 0.48);
  if (PETS.chicken && PETS.chicken.visible) add(HEN.x, -0.14, HEN.z, 0.3, 0.52, 0.3);
  if (!any) return;
  x0 = Math.max(0, Math.floor(x0) - 4); y0 = Math.max(0, Math.floor(y0) - 4); x1 = Math.min(W, Math.ceil(x1) + 4); y1 = Math.min(H, Math.ceil(y1) + 4);
  const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
  if (!SHARP.rt || SHARP.rt.width < w || SHARP.rt.height < h) {
    if (SHARP.rt) SHARP.rt.dispose();
    SHARP.rt = new THREE.WebGLRenderTarget(Math.ceil(w * 1.25), Math.ceil(h * 1.25), { samples: 4, type: THREE.HalfFloatType });
    SHARP.quad.material.uniforms.t.value = SHARP.rt.texture;
  }
  // the camera's projection narrowed to that rectangle (x, y scaled in clip space; depth as in the picture)
  const cx = (x0 + x1) / W - 1, cy = (y0 + y1) / H - 1, sx = W / w, sy = H / h, C = SHARP.cam;
  C.projectionMatrix.set(sx, 0, 0, -sx * cx, 0, sy, 0, -sy * cy, 0, 0, 1, 0, 0, 0, 0, 1).multiply(camera.projectionMatrix);
  C.projectionMatrixInverse.copy(C.projectionMatrix).invert(); camera.matrixWorld.decompose(C.position, C.quaternion, C.scale); C.updateMatrixWorld(true);
  DECKR.u.uFull.value.set(W, H); DECKR.u.uOff.value.set(x0, y0); SHARP.exp.value = POST.mat.uniforms.exposure.value;
  const cc = renderer.getClearColor(_c), ca = renderer.getClearAlpha();
  SHARP.rt.viewport.set(0, 0, w, h); SHARP.rt.scissor.set(0, 0, w, h); SHARP.rt.scissorTest = true;
  renderer.setRenderTarget(SHARP.rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, C);
  renderer.setRenderTarget(null); renderer.setClearColor(cc, ca);
  SHARP.quad.material.uniforms.uScale.value.set(w / SHARP.rt.width, h / SHARP.rt.height);
  renderer.autoClear = false; renderer.setViewport(x0 / pr, y0 / pr, w / pr, h / pr); SHARP.quad.render(renderer);   // over the picture: no clear
  renderer.setViewport(0, 0, W / pr, H / pr); renderer.autoClear = true;
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
function presentPose(bk) {
  const v = focusView(bk.sec), fwd = v.tgt.clone().sub(v.pos).normalize(), up = new V3(0, 1, 0), right = fwd.clone().cross(up).normalize();
  const p = v.pos.clone().addScaledVector(fwd, 1.3).addScaledVector(right, -0.1).addScaledVector(up, -0.03 - bk.h / 2);
  const x = fwd.clone().negate().applyAxisAngle(up, -0.42), z = x.clone().cross(up).normalize();   // front cover to the camera, spine showing a little
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
  return { p: p.addScaledVector(z, bk.d / 2), q };
}
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
        if (bk.fk >= 1 && bk.goal === 'pulled') { bk.out = false; bk.slide = PULL; continue; }   // back at its place: it slides in on the shelf
      }
      const h = bk.hero; h.position.copy(bk.pose.p); h.quaternion.copy(bk.pose.q); h.scale.set(bk.t, bk.h, bk.d);
      if (bk.goal === 'present' && bk.fk >= 1 && !reduceMotion) { h.position.y += Math.sin(t * 1.4) * 0.006; h.rotateY(Math.sin(t * 0.9) * 0.04); }
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
   it on screen (the camera's projection narrowed to that rectangle), then laid over the picture. */
const DECK = { ok: false, angle: 0, speed: 0, playing: false, progress: 0, hover: false, scene: new THREE.Scene() };
const DECKR = { rt: null, cam: new THREE.Camera(), corners: [], u: { uDepth: OVER.u.uDepth, uFull: { value: new THREE.Vector2(1, 1) }, uOff: { value: new THREE.Vector2() } }, quad: null };
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
  DECKR.quad.material.uniforms.uScale.value.set(w / DECKR.rt.width, h / DECKR.rt.height);
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
  DECKR.quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { t: { value: null }, uScale: { value: new THREE.Vector2(1, 1) } }, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false,
    vertexShader: QUAD_VS, fragmentShader: 'uniform sampler2D t; uniform vec2 uScale; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv * uScale);\n#include <colorspace_fragment>\n}' }));
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
/* ---- labels, leader lines and the card (HTML over the canvas: crisp text in either language) */
const UIEL = {};
// the book under the pointer, named beside it: title, author · year and pages, in the page's language (a thin spine
// cannot hold its title legibly, and a long title is cut short on any spine)
let tipBook = null;
function showTip(bk, x, y) {
  const t = UIEL.tip; if (!t) return;
  if (!bk) { if (tipBook) { t.classList.remove('is-on'); tipBook = null; } return; }
  if (tipBook !== bk) {
    tipBook = bk; const it = bk.it, info = bookInfo(it), by = byOf(it), n = info && info.pages;
    const line = pages => esc([by, pages].filter(Boolean).join(' · '));
    t.innerHTML = `<b><span class="en">${esc(titleIn(it, 'en'))}</span><span class="vi">${esc(it.title)}</span></b>`
      + (by || n ? `<small><span class="en">${line(n && n + ' pages')}</span><span class="vi">${line(n && n + ' trang')}</span></small>` : '');
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
    const c = document.createElement('div'); c.className = 'l3-cap'; c.setAttribute('aria-hidden', 'true');
    c.innerHTML = `<span class="en">${esc(txt('en') || en)}</span><span class="vi">${esc(txt('vi') || vi)}</span>`; UIEL.labels.appendChild(c); UIEL.caps[g] = c;
  }
  UIEL.card.querySelector('#l3-close').addEventListener('click', () => closeCard());
  UIEL.items.addEventListener('click', e => {
    const row = e.target.closest('.l3-item'); if (!row) return; const it = UIS.open && UIS.open.items[+row.dataset.k]; if (!it) return;
    const chip = e.target.closest('[data-chip]');
    if (chip) { const c = it.chips[+chip.dataset.chip]; if (c && !c.href) c.el.click(); return; }
    if (e.target.closest('.l3-play') || (it.src && !e.target.closest('a'))) { const p = it.li.querySelector('.play'); if (p) p.click(); }
  });
  UIEL.items.addEventListener('pointerover', e => { const row = e.target.closest('.l3-item'); const it = row && UIS.open && UIS.open.items[+row.dataset.k]; setPeek(it && it.book ? it.book : null); });
  UIEL.items.addEventListener('pointerleave', () => setPeek(null));
}
function setPeek(bk) { if (UIS.peek === bk) return; if (UIS.peek) UIS.touched.add(UIS.peek); UIS.peek = bk; if (bk) UIS.touched.add(bk); setNeeds(true); }
function setHover(sec) {
  if (UIS.hover === sec) return; UIS.hover = sec;
  for (const s of UIS.secs) s.label.classList.toggle('is-hover', s === sec);
  CANVAS.style.cursor = sec ? 'pointer' : ''; setNeeds(true);
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
    const title = it.href ? `<a href="${esc(it.href)}" target="_blank" rel="noopener noreferrer"${full}>${name}</a>` : full ? `<span${full}>${name}</span>` : name;
    const by = byOf(it), pages = info && info.pages ? `<span class="en">${info.pages} pages</span><span class="vi">${info.pages} trang</span>` : '';
    const chips = it.chips.map((c, ci) => c.href ? `<a class="l3-chip" href="${esc(c.href)}" target="_blank" rel="noopener noreferrer">${esc(c.label)} ↗</a>` : `<button type="button" class="l3-chip" data-chip="${ci}">${esc(c.label)}</button>`).join('');
    const play = it.src ? `<button type="button" class="l3-play" aria-label="Play / Phát: ${esc(it.title)}"><svg class="i ic-play" aria-hidden="true"><use href="#i-play"/></svg><svg class="i ic-pause" aria-hidden="true"><use href="#i-pause"/></svg></button>` : '<span class="l3-noplay"></span>';
    return `<li class="l3-item${it.src ? ' has-audio' : ''}" data-k="${k}">${play}<div class="l3-main"><span class="l3-t${it.bold ? ' is-bold' : ''}">${title}</span>${by || pages ? `<span class="l3-by">${esc(by)}${by && pages ? ' · ' : ''}${pages}</span>` : ''}${chips ? `<div class="l3-chips">${chips}</div>` : ''}</div><span class="l3-time"></span></li>`;
  }).join('');
  refreshCard();
}
function refreshCard() {   // mirror play state and time from the page's hidden rows
  if (!UIS.open) return;
  for (const row of UIEL.items.querySelectorAll('.l3-item')) {
    const it = UIS.open.items[+row.dataset.k]; if (!it || !it.li) continue; const cl = it.li.classList;
    row.classList.toggle('is-current', cl.contains('is-current')); row.classList.toggle('is-playing', cl.contains('is-playing')); row.classList.toggle('is-loading', cl.contains('is-loading'));
    const tm = it.li.querySelector('.time'); const txt = tm ? tm.textContent : ''; const el = row.querySelector('.l3-time'); if (el.textContent !== txt) el.textContent = txt;
  }
}
function openSection(sec, cat) {
  if (offMode()) return;
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
  for (const s of UIS.secs) s.glowT = 0; setSpine(null); setPeek(null);
  if (home) { UIS.mode = 'home'; goView(homeView()); }
  if (UIS.active) UIS.touched.add(UIS.active); setNeeds(true); return was;
}
function showResearch() { closeCard(false); UIS.mode = 'research'; goView(researchView()); }
function stepGlow(dt) {
  let moving = false;
  for (const s of UIS.secs) {
    const tgt = Math.max(s.glowT, UIS.hover === s ? 0.6 : 0);
    if (Math.abs(s.glow - tgt) > 1e-3) { s.glow += THREE.MathUtils.clamp(tgt - s.glow, -dt * 3, dt * 3); moving = true; }
    const showing = UIS.active && UIS.active.sec === s && UIS.active.goal === 'present';   // the book in front reads better on a calm shelf
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
  // a label hangs at `tag` (+dx, dy px; 'left' starts there, 'center' centres on it); its leader line ends on `anchor`
  const place = (el, anchor, tag, dx, dy, align, visible) => {
    if (!visible) { el.classList.add('is-off'); return; }
    const a = project(anchor), t = tag === anchor ? a : project(tag);
    const inView = a.ok && a.x > side + 6 && a.x < innerWidth - 6 && a.y > 6 && a.y < innerHeight - 6;
    if (!inView) { el.classList.add('is-off'); return; }
    el.classList.remove('is-off'); const w = el.offsetWidth, h = el.offsetHeight;
    let x = t.x + dx - (align === 'right' ? w : align === 'left' ? 0 : w / 2), y = t.y + dy - h / 2;
    x = THREE.MathUtils.clamp(x, side + 10, innerWidth - w - 10); y = THREE.MathUtils.clamp(y, 10, innerHeight - h - 10);
    boxes.push({ el, a, x, y, w, h });
  };
  for (const s of UIS.secs) {
    const vis = show && (home || (UIS.mode === 'research' && s.group === 'research'));
    if (s.group === 'books') place(s.label, s.box.plate, s.box.tag, 30, 0, 'left', vis);   // on its row, just past the plate
    else place(s.label, s.box.plate, s.box.tag, 0, -44, 'center', vis);                    // above its bay
  }
  boxes.sort((p, q) => p.y - q.y);
  for (let k = 1; k < boxes.length; k++) for (let j = 0; j < k; j++) {
    const p = boxes[j], q = boxes[k];
    if (q.x < p.x + p.w + 6 && q.x + q.w + 6 > p.x && q.y < p.y + p.h + 4) q.y = p.y + p.h + 4;
  }
  for (const b of boxes) {
    b.el.style.transform = `translate(${Math.round(b.x)}px, ${Math.round(b.y)}px)`;
    const ex = b.a.x < b.x ? b.x : b.a.x > b.x + b.w ? b.x + b.w : b.x + b.w / 2, ey = b.a.y < b.y ? b.y : b.a.y > b.y + b.h ? b.y + b.h : b.y + b.h / 2;
    lines.push(`<path d="M${b.a.x.toFixed(1)},${b.a.y.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}"/><circle cx="${b.a.x.toFixed(1)}" cy="${b.a.y.toFixed(1)}" r="3"/>`);
  }
  // the group names sit over their labels: Books over the stack of rows, Research centred over the three bays
  for (const [g, cap] of Object.entries(UIEL.caps)) {
    const bs = boxes.filter(b => b.el.classList.contains('l3-' + g));
    if (!bs.length) { cap.classList.add('is-off'); continue; }
    cap.classList.remove('is-off'); const w = cap.offsetWidth, h = cap.offsetHeight, l = Math.min(...bs.map(b => b.x)), r = Math.max(...bs.map(b => b.x + b.w));
    const first = bs.reduce((p, q) => q.y < p.y ? q : p); let x = g === 'books' ? l + 4 : (l + r - w) / 2, y = first.y - h - 6;
    if (y < 8) { x = first.x - w - 12; y = first.y + (first.h - h) / 2; }   // no room above (a very wide window): beside the first label
    x = THREE.MathUtils.clamp(x, side + 10, innerWidth - w - 10);
    cap.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  // a white outline around the section under the pointer (and, fainter, around the open one): the boards of a row, the posts of a bay
  for (const [sec, cls] of [[UIS.open, 'l3-outline is-open'], [UIS.hover, 'l3-outline']]) {
    if (!sec || !show || (cls === 'l3-outline is-open' && sec === UIS.hover)) continue;
    const pts = sec.box.corners.map(project); if (pts.some(q => !q.ok)) continue;
    lines.push(`<polygon class="${cls}" points="${pts.map(q => q.x.toFixed(1) + ',' + q.y.toFixed(1)).join(' ')}"/>`);
  }
  if (UIS.open && !UIEL.card.hidden) {   // the open card points at its section, at the first books right of the card
    const r = UIEL.card.getBoundingClientRect(), b = UIS.open.box, p = faceAnchor(b, r.right + 46, r.top + 40), a = project(p || b.plate);
    const ey = THREE.MathUtils.clamp(a.y, r.top + 30, r.bottom - 30);
    if (a.ok) lines.push(`<path class="l3-card-line" d="M${a.x.toFixed(1)},${a.y.toFixed(1)} L${(r.right).toFixed(1)},${ey.toFixed(1)}"/><circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="4"/>`);
  }
  UIEL.svg.innerHTML = lines.join('');
}
/* ---- picking in the room */
const RAY = new THREE.Raycaster(), NDC = new THREE.Vector2();
function pickAt(e) {
  const r = CANVAS.getBoundingClientRect(); NDC.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  RAY.setFromCamera(NDC, camera);
  // books first (they stand just behind their section's face): those of the open section, and the one out of the shelf
  const books = UIS.open ? UIS.open.books.map(b => b.hit) : [];
  for (const b of [UIS.active, UIS.peek]) if (b && b.hero && b.hero.visible) books.push(b.hero);
  const hb = books.length ? RAY.intersectObjects(books, false)[0] : null; if (hb) return { book: hb.object.userData.book };
  const hs = RAY.intersectObjects(UIS.secs.map(s => s.hit), false)[0], hd = DECK.ok ? RAY.intersectObject(DECK.hit, false)[0] : null;
  if (hd && (!hs || hd.distance < hs.distance)) return { deck: true };
  return hs ? { sec: hs.object.userData.sec } : null;
}
function activateItem(it) {   // what a click on its book does: play it, else open its link, else its first extra (a note, a chart…)
  const pl = it.li && it.li.querySelector('.play'); if (pl) { pl.click(); return; }
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
    setSpine(bk); showTip(p && p.book ? p.book : null, e.clientX, e.clientY); setHover(!p || p.book || p.deck || UIS.open === p.sec ? null : p.sec);
    CANVAS.style.cursor = p && (p.book || p.deck || UIS.open !== p.sec) ? 'pointer' : '';
    const dh = !!(p && p.deck); if (dh !== DECK.hover) { DECK.hover = dh; CANVAS.title = dh ? (document.documentElement.lang === 'vi' ? 'Máy hát' : 'Record player') : ''; setNeeds(true); }
  });
  CANVAS.addEventListener('pointerleave', () => { setHover(null); setSpine(null); showTip(null); if (DECK.hover) { DECK.hover = false; CANVAS.title = ''; setNeeds(true); } });
  CANVAS.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; showTip(null); });
  CANVAS.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600 || offMode()) { down = null; return; }
    down = null; const p = pickAt(e);
    if (p && p.book && p.book === UIS.active && p.book.out) { const x = document.getElementById('np-close'); if (x) x.click(); }   // the book out of the shelf: back to its place (the player closes)
    else if (p && p.book) activateItem(p.book.it);
    else if (p && p.deck) togglePlayer();   // the record player on the floor: the page's player comes out (or goes away)
    else if (p && p.sec) openSection(p.sec);
    else if (UIS.mode !== 'home') closeCard();
  });
  addEventListener('keydown', e => { if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return; if (UIS.mode !== 'home') closeCard(); else togglePlayer(false); });
  // the sidebar and the now-playing bar steer the room (the page's own handlers still run on the hidden pages)
  document.addEventListener('click', e => {
    if (!ready) return;
    const nav = e.target.closest('.toc-link[data-nav]');
    if (nav) { const s = UIS.byCat.get(nav.dataset.nav); if (s) { e.preventDefault(); openSection(s, s.group === 'research' ? nav.dataset.nav : null); } return; }
    const go = e.target.closest('.toc [data-goto]');   // Books: the whole room; Research: the back bookcase; a research topic: its bay
    if (go) { e.preventDefault(); const g = go.dataset.goto, s = UIS.byId.get(g); if (g === 'books') closeCard(); else if (s && s.group === 'research') openSection(s); else showResearch(); return; }
    if (e.target.closest('#np-info')) { const cur = document.querySelector('#pages .item.is-current') || null; const bk = cur && UIS.bySrc.get(cur.dataset.src); if (bk) openSection(bk.sec); }
  }, true);
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
  renderer.setRenderTarget(POST.rt); renderer.render(scene, camera);
  POST.toneQuad.material.uniforms.tColor.value = POST.rt.texture; renderer.setRenderTarget(POST.tone); POST.toneQuad.render(renderer);
  const U = POST.mat.uniforms; U.tDepth.value = POST.rt.depthTexture; U.near.value = camera.near; U.far.value = camera.far;
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
    const live = !reduceMotion && !body.classList.contains('is-idle') && ((DECK.ok && DECK.speed > 0) || FLY.on || PETS.ok);
    if (still || now - lastDraw < FRAME_MS - 2) {
      if (live && now - lastSharp >= (FLY.on || PETS.ok ? SHARP_MS : FRAME_MS) - 2) { lastSharp = now; drawSharp(); }
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
  const L = LIGHTS, was = { sun: L.sun.visible, rects: L.rects.map(r => r.visible), spots: NIGHT.spots.map(s => s.sp.visible) };
  hold = true;
  try {
    for (const [sun, rects, spots] of [[true, true, false], [true, true, true], [false, true, true], [false, false, true]]) {
      L.sun.visible = sun; L.rects.forEach(r => { r.visible = rects; }); NIGHT.spots.forEach(s => { s.sp.visible = spots; });
      await compileFor(scene);
    }
  } catch (e) { /* compiled on first use instead */ }
  L.sun.visible = was.sun; L.rects.forEach((r, i) => { r.visible = was.rects[i]; }); NIGHT.spots.forEach((s, i) => { s.sp.visible = was.spots[i]; });
  hold = false; needs = true;
}

// other modules change these through a setter (an imported binding is read-only)
function setNeeds(v) { needs = v; }
function setReady(v) { ready = v; }
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
window.__lib3d = { PETS, clock, FLY, DECOR, DECK, togglePlayer, state: () => ({ ready, hold, scale: RT_SCALE }), BOOK, SHELF, coverWords, scene, camera, renderer, LIGHTS, MAT, POST, NIGHT, HOUR, UIS, CAM, applyHour, sunPlace, setClock: d => { HOUR.pin = d ? new Date(d) : null; setNeeds(true); }, draw, resize, applyRefCamera, openSection, closeCard, goView, homeView, focusView, loop };
(window.requestIdleCallback || (fn => setTimeout(fn, 300)))(() => start().catch(e => {
  console.warn('3D library unavailable', e); setReady(false); updateOn(); document.documentElement.classList.add('lib3d-failed');
}), { timeout: 800 });
}
