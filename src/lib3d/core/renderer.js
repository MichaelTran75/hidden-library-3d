import '../world/textures.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { CANVAS } from './base.js';

/* ---------------------------------------------------------------- renderer */
// the canvas itself needs no depth or stencil buffer: the scene renders into its own target, everything after is flat
const renderer = new THREE.WebGLRenderer({ canvas: CANVAS, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
// the watercolour picture is made at 1 px per CSS px (it softens everything anyway) and scaled up to the canvas, which
// holds device pixels: the sharp layer drawn over it (titles on the books, stars, the moon) stays crisp on high-DPI screens
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
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
// a shader's compile log is read only with ?shaders in the address: reading it on a shader's first use waited for its
// compile there and then (~0.36 s through the day/night switch: G, 23/10/2026; three.js's advice for pages in use)
renderer.debug.checkShaderErrors = /[?&]shaders\b/.test(location.search);
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

export { RT_SCALE, camera, renderer, scene, setRtScale, setShadowsDirty, shadowsDirty };
