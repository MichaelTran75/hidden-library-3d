import '../world/textures.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CANVAS } from './base.js';

/* ---------------------------------------------------------------- renderer */
// the canvas itself needs no depth or stencil buffer: the scene renders into its own target, everything after is flat
const renderer = new THREE.WebGLRenderer({ canvas: CANVAS, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
// the watercolour picture is made at 1 px per CSS px (it softens everything anyway) and scaled up to the canvas, which
// holds device pixels: the sharp layer drawn over it (titles on the books, stars, the moon) stays crisp on high-DPI screens
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
// the room's picture: 1.25 px a CSS px (no more than the screen has), the same at rest and in motion. Nothing indoors
// is watercolour now, so the picture is seen as drawn: at the 0.8 it had while the paint pass softened everything it was
// blurred, and a size that changes with motion shows as a blur each time the pointer stirs. A frame's cost goes with
// its pixels (home view by day: 22 ms at 0.8, 27 at 1, 35 at 1.25, 45 at 1.5); a GPU that falls behind gets less
// (adaptQuality: steps of RT_STEPS).
const RT_STEPS = [2, 1.5, 1.25, 1, 0.8, 0.65, 0.5], RT_TOP = Math.min(1, Math.max(0.8, devicePixelRatio || 1));   // (the room drawn at one CSS pixel at most: on a 2x screen ~170 MB less GPU memory than at 2, the blit enlarges it to the canvas)
let RT_SCALE = RT_TOP;
try {   // a step down is remembered for a week (a laptop may only have been slowed for a while, e.g. on battery saving)
  const q = JSON.parse(localStorage.getItem('hiddenLibrary.lib3dScale3'));
  if (q && q.s >= 0.5 && q.s < RT_TOP && Date.now() - q.t < 7 * 864e5) RT_SCALE = q.s;
} catch (e) { /* storage blocked or old value */ }
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;        // the room stands still: shadows are redrawn only when a book moves (shadowsDirty)
let shadowsDirty = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// a shader's compile log is read only with ?shaders in the address: reading it on a shader's first use waited for its
// compile there and then (~0.36 s through the day/night switch; three.js's advice for pages in use)
renderer.debug.checkShaderErrors = /[?&]shaders\b/.test(location.search);
renderer.toneMapping = THREE.NoToneMapping; // done in the final pass
RectAreaLightUniformsLib.init();
// The windows' area lights shine on everything as a diffuse glow; their glossy reflections (a second, as costly LTC
// integral per light and pixel) are kept for the glass only (RECT_SPEC): on the rough wood, books and velvet they were
// ~2 % of the picture and ~2 ms of a frame. The exposure is raised a touch to make up the light they gave.
{ const spec = 'reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );';
  if (THREE.ShaderChunk.lights_physical_pars_fragment.includes(spec))
    THREE.ShaderChunk.lights_physical_pars_fragment = THREE.ShaderChunk.lights_physical_pars_fragment.replace(spec, '#ifdef RECT_SPEC\n' + spec + '\n#endif'); }
/* The sun's shadow, soft as far as its caster is. three's soft PCF blurs every shadow edge by the same ~2 texels (its radius is not read for that type), so a
   window bar's shade 3 m off the floor was as sharp as a cat's paw on it. A real sun is a disc, ~0.5° across: its shadow
   is sharp where the caster touches and widens with the distance to it (penumbra = distance x the disc's angle).
   Percentage-closer soft shadows (R. Fernando, NVIDIA 2005): the casters' mean depth found round the point first, then a
   PCF as wide as the penumbra they make. Taken here as a disc of 1° (light through the panes, softened); none found: lit
   at once; all of them, close: in the umbra. Kept lean: 5 taps to find the casters and 8 for the PCF, each set a Vogel
   disc turned per pixel by interleaved gradient noise (J. Jimenez 2014), written out, no loop: as loops of 16 and 24
   taps it made every lit shader in the room ~2.4 times as slow even where it was not taken (home view 70 ms a frame
   against 29, measured on the M4 in headless Chrome); lean, the same 29. Only for a shadow whose radius is set above 1.5
   (the sun's, world/lights.js); the floor lamp's keeps the soft PCF. SUN_SHADOW: its shadow camera, which the
   penumbra's size in the map's units is worked out from. */
const SUN_SHADOW = { half: 8, near: 1, far: 40, deg: 1.0, maxDist: 8 };
{ const S = SUN_SHADOW, t = Math.tan(S.deg / 2 * Math.PI / 180), C = THREE.ShaderChunk, open = '#elif defined( SHADOWMAP_TYPE_PCF_SOFT )', next = '#elif defined( SHADOWMAP_TYPE_VSM )';
  const pen = ((S.far - S.near) * t / (2 * S.half)).toFixed(6), search = (S.maxDist * t / (2 * S.half)).toFixed(6);   // (uv per unit of depth; the widest search, in uv)
  const disc = (pts, f) => pts.map(([x, y]) => f(`a * ${x.toFixed(3)} + b * ${y.toFixed(3)}`)).join(' + ');   // (a Vogel disc's points, along the turned axes a, b)
  const fns = `
	float pcssTap( sampler2D map, vec2 uv, float z, inout float zs ) { float d = unpackRGBAToDepth( texture2D( map, uv ) ), k = step( d + 1e-6, z ); zs += d * k; return k; }
	float pcssShadow( sampler2D map, vec2 mapSize, vec4 sc ) {
		float n = 6.2831853 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
		vec2 r = vec2( cos( n ), sin( n ) ), q = vec2( -r.y, r.x ), a = r * ${search}, b = q * ${search};
		float zs = 0.0, nb = ${disc([[0.278, 0.152], [-0.532, 0.131], [0.392, -0.589], [0.128, 0.827], [-0.741, -0.593]], o => `pcssTap( map, sc.xy + ${o}, sc.z, zs )`)};
		if ( nb < 0.5 ) return 1.0;
		float p = clamp( ( sc.z - zs / nb ) * ${pen}, 1.25 / mapSize.x, ${search} );
		if ( nb > 4.5 && p < ${search} * 0.5 ) return 0.0;
		a = r * p; b = q * p;
		return ( ${disc([[0.25, 0], [-0.319, 0.292], [0.049, -0.557], [0.402, 0.525], [-0.739, -0.131], [0.7, -0.445], [-0.234, 0.87], [-0.446, -0.859]], o => `texture2DCompare( map, sc.xy + ${o}, sc.z )`)} ) * 0.125;
	}
	vec2 texture2DDistribution(`;
  const pf = C.shadowmap_pars_fragment;
  if (pf.includes(open) && pf.includes(next) && pf.includes('vec2 texture2DDistribution('))
    C.shadowmap_pars_fragment = pf.replace('vec2 texture2DDistribution(', fns.trim()).replace(open, open + '\n\t\t\tif ( shadowRadius > 1.5 ) shadow = pcssShadow( shadowMap, shadowMapSize, shadowCoord ); else {').replace(next, '}\n\t\t' + next); }
/* The shadow maps keep their depth only. three.js r170 draws a light's shadow as an RGBA8 picture of the packed depth
   beside a depth buffer of its own (the sun's 2048²: 16 + 16 MB of the GPU). Here that depth buffer is a texture the
   shaders read (texture2DCompare, pcssTap: its .r), and the picture is a 1-byte stand-in a framebuffer needs (4 MB):
   ~12 MB less (with the AO's one channel, fx/post.js: the GPU process ~35 MB less), the same shadows (24-bit depth, a step of ~2 µm over the sun's 39 m). The stand-in is the target's
   texture only while three draws the shadows (renderer.shadowMap.render); the rest of the time the depth texture is,
   and that is what three hands the materials (WebGLLights: shadow.map.texture). Point lights' shadows (distance packed
   into the colour, not depth) are left as three makes them: none here; one would need texture2DCompare's unpacking back. */
{ const C = THREE.ShaderChunk, a = 'step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) )';
  if (C.shadowmap_pars_fragment.includes(a)) {
    C.shadowmap_pars_fragment = C.shadowmap_pars_fragment.replace(a, 'step( compare, texture2D( depths, uv ).r )').replace('float d = unpackRGBAToDepth( texture2D( map, uv ) )', 'float d = texture2D( map, uv ).r');
    const SM = renderer.shadowMap, draw = SM.render, own = new WeakMap();   // (target: its stand-in; a render target has no userData in r170)
    const depthOnly = sh => { if (sh.map) return; const { x, y } = sh.mapSize;
      const rt = new THREE.WebGLRenderTarget(x, y, { format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthTexture: new THREE.DepthTexture(x, y, THREE.UnsignedIntType) });
      rt.texture.name = rt.depthTexture.name = 'shadowDepth'; own.set(rt, rt.texture); sh.map = rt; sh.camera.updateProjectionMatrix(); };   // (three updates the shadow camera's projection only when it makes the map itself)
    SM.render = function (lights, sc, cam) {
      const swapped = [];
      if (SM.enabled && (SM.autoUpdate || SM.needsUpdate)) for (const l of lights) { if (l.isPointLight || !l.shadow) continue; depthOnly(l.shadow); const rt = l.shadow.map; if (own.has(rt)) { rt.textures[0] = own.get(rt); swapped.push(rt); } }
      try { draw.call(this, lights, sc, cam); } finally { for (const rt of swapped) rt.textures[0] = rt.depthTexture; }
    }; } }
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);

/* Shaders made ahead of the picture they are first drawn in. A shader's first use asks the GPU's own thread what it is
   made of (its uniforms, its attributes), and the answer waits for everything sent before the question: asked in the
   middle of a picture, it waited for each thing drawn just before to be made ready for the screen (on a first visit
   ~0.1 s a shader; the page's thread was held 1-2.5 s at a time as the room came in, 16 s in all, measured with an
   emptied shader cache). So: the shader compiled in the background (prime), then, once the GPU has nothing left to do
   (gpuIdle: a fence looked at between tasks, nothing waits on it), asked for once (knowPrograms). A picture then only
   sends its drawing; the GPU makes it ready in its own time, the page's thread free meanwhile. A shader that is still
   first made while a picture is drawn is counted in WARM.late (tools/perf/cold.cjs). */
const KNOWN = new WeakSet(), WARM = { late: [], slow: [] }, QCAM = new THREE.Camera();   // (slow: pictures that held the page's thread over 80 ms: [when, in all, the room, its steps, the sharp layer])
const gpuIdle = (max = 20000) => new Promise(done => {
  const gl = renderer.getContext(); if (!gl.fenceSync) { setTimeout(done, 30); return; }
  const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), t0 = performance.now(); gl.flush();
  const look = () => { if (gl.isContextLost() || gl.getSyncParameter(f, gl.SYNC_STATUS) === gl.SIGNALED || performance.now() - t0 > max) { gl.deleteSync(f); done(); } else setTimeout(look, 8); };
  setTimeout(look, 0);
});
function knowPrograms() {
  for (const p of renderer.info.programs) if (!KNOWN.has(p) && (!p.isReady || p.isReady())) { KNOWN.add(p); try { p.getUniforms(); p.getAttributes(); } catch (e) { /* asked at its first use instead */ } }
}
// o (a scene, an object, a full-screen step's mesh): its shaders for the target it will be drawn into, a camera on its
// layer and the scene whose lights light it; resolved once they are compiled and known
// (layer: a thing of the sharp layer (a model on display, an animal), on its own layer: once compiled it is also drawn
// once, unseen, into a few pixels of a sharp pass's kind of target, and the GPU waited for: a shader is finished for
// the screen only as it is first drawn with, and on a first visit that held the pictures back just as the thing faded in)
let WARM_S = null;
function warmSharp(o, cam, lit, layer) {
  if (!WARM_S) WARM_S = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 2 });
  const mask = cam.layers.mask, rt = renderer.getRenderTarget(), bg = lit.background, off = [], made = renderer.info.programs.length;
  o.traverse(m => { if (m.frustumCulled) { m.frustumCulled = false; off.push(m); } });
  cam.layers.set(layer); camera.matrixWorld.decompose(cam.position, cam.quaternion, cam.scale); cam.projectionMatrix.copy(camera.projectionMatrix); cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse); cam.updateMatrixWorld(true);
  lit.background = null;
  try { renderer.setRenderTarget(WARM_S); renderer.render(lit, cam); } catch (e) { WARM.err = (e && e.stack) || String(e); }
  finally { renderer.setRenderTarget(rt); lit.background = bg; cam.layers.mask = mask; for (const m of off) m.frustumCulled = true; for (let P = renderer.info.programs, i = made; i < P.length; i++) KNOWN.add(P[i]); }
  return gpuIdle();
}
function prime(o, target = null, cam = QCAM, lit = o, layer = -1) {
  if (!o || !renderer.compileAsync) return Promise.resolve();
  const rt = renderer.getRenderTarget(); let p = null;
  renderer.setRenderTarget(target); try { p = renderer.compileAsync(o, cam, lit); } catch (e) { WARM.err = (e && e.stack) || String(e); /* compiled on first use instead */ } renderer.setRenderTarget(rt);
  const mats = new Set(); o.traverse(m => { for (const x of [].concat(m.material || [])) if (!mats.has(x)) { mats.add(x); x.userData.priming = (x.userData.priming || 0) + 1; } });   // (once a material, however many things wear it)
  return Promise.resolve(p).catch(() => {}).then(allReady).then(() => gpuIdle()).then(() => { knowPrograms(); return layer >= 0 ? warmSharp(o, cam, lit, layer) : null; }).then(() => { for (const x of mats) x.userData.priming--; });
}
// every shader made so far compiled (three's own wait looks at each material's shader of the moment, which a picture
// drawn meanwhile may have changed back)
const allReady = (max = 30000) => new Promise(done => { const t0 = performance.now();
  const look = () => { let ok = true; for (const p of renderer.info.programs) if (!KNOWN.has(p) && p.isReady && !p.isReady()) { ok = false; break; } if (ok || performance.now() - t0 > max) done(); else setTimeout(look, 10); };
  look(); });
// a full-screen step laid over the picture is left out while its shader is on its way (prime), not first used in the
// middle of a picture; the steps the picture is made of are primed before the first one (core/loop.js start)
{ const render = FullScreenQuad.prototype.render; FullScreenQuad.prototype.render = function (r) { if (this.material.userData.priming > 0) return; render.call(this, r); }; }

// other modules change these through a setter (an imported binding is read-only)
function setShadowsDirty(v) { shadowsDirty = v; }
function setRtScale(v) { RT_SCALE = v; }

export { KNOWN, RT_SCALE, RT_STEPS, SUN_SHADOW, WARM, camera, gpuIdle, knowPrograms, prime, renderer, scene, setRtScale, setShadowsDirty, shadowsDirty };
