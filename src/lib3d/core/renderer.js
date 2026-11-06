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
/* The sun's shadow, soft as far as its caster is (G, 06/11/2026: "do research n study and improve blur, shadow, texture
   effect"). three's soft PCF blurs every shadow edge by the same ~2 texels (its radius is not read for that type), so a
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
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);

// other modules change these through a setter (an imported binding is read-only)
function setShadowsDirty(v) { shadowsDirty = v; }
function setRtScale(v) { RT_SCALE = v; }

export { RT_SCALE, SUN_SHADOW, camera, renderer, scene, setRtScale, setShadowsDirty, shadowsDirty };
