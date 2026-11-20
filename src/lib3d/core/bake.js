import './renderer.js';   // build order: the module before this one runs first
import * as THREE from 'three';

/* ---------------------------------------------------------------- the room's light, worked out ahead by rays
   three's lights for the room cast no shadow but the sun's: the windows' glow, the sky's, the lamps' and the ceiling's
   downlights pass through the sofa, the shelves and the tables as if they were not there, and nothing comes back off
   the floor. What rays would find is worked out once, off the page (tools/bake: the room as the page builds it, every
   still thing in it), and kept as a small grid over the room (a cell 10 cm), which every lit material then looks up at
   the point it is drawing, a cell's width out along its normal (so a face takes the light of the side it looks to, and
   a thin board lets none through):
   - how much of the windows' light gets there past the furniture: their three lights are dimmed by it;
   - how much of the lamps': every point and spot light is dimmed by it (one figure for them all: each lamp weighed by
     the light it would send there in an empty room);
   - how open the place is: the sky's glow and the picture of the sky the surfaces mirror are dimmed by it (the back
     of a shelf's cell, under the sofa);
   - what six of the ceiling's downlights give (fx/night.js: no lights of three's any more): at each place, the light on
     a face looking each of the six ways along the axes, past the furniture, weighed by the way the face drawn looks;
   - the light that comes back off what the windows light (how much, a place; its colour one for the room: the
     floor's warmth), and off what the lamps light, added to the glow; the sun's own, by day, taken to go the windows' way.
   A day frame reads the grid once a pixel; by lamplight three times, with six lights fewer to work out.
   The lights themselves stay as they were, with their colours through the day: the grid only says where they reach.
   What moves is in no grid: the cat's shade is worked out as it goes, from three balls that stand for it (below), on
   the materials it comes near, which ask for it with the define PET_SHADE (the floor, the rug, the velvet): worked out
   on every lit pixel of the room it cost ~1 ms a frame, a test of the distance sparing none of it.
   Outside its box (the garden) nothing changes; a pass with no sky's glow in it (a thing shown on its own) is left
   alone as well. Every lit material takes this without being told: the hook each may set for its own shader
   (onBeforeCompile) is followed by this one. A material may keep out with the define NO_ROOM_BAKE.
   The grid comes as a picture (bake.webp: slices side by side, four blocks) with its measures between the marks
   below, both written by tools/bake; with no picture the room is lit as it was. */
const BAKE_META = /*BAKE-META*/{"n": [43, 64, 115], "cols": 12, "min": [-1.5, -0.1, -8.85], "s": 0.1, "sky": 0.08255, "lamp": 0.2238, "down": 200, "tint": [1.459, 0.852, 0.509]}/*BAKE-END*/;
const one = (r, g, b, a) => { const t = new THREE.Data3DTexture(new Uint8Array([r, g, b, a]), 1, 1, 1); t.needsUpdate = true; return t; };
const BAKE = { ok: false, down: false, sky: 0, gain: { sky: 1.3, lamp: 1, sun: 0.15, down: 1.25 }, lampCol: new THREE.Color(1, 0.62, 0.32),
  U: { uBakeA: { value: one(255, 255, 255, 0) }, uBakeC: { value: one(0, 0, 0, 0) }, uBakeD: { value: one(0, 0, 0, 255) }, uBakeDown: { value: new THREE.Color(0, 0, 0) }, uBakeTint: { value: new THREE.Vector3(1, 1, 1) }, uBakeMin: { value: new THREE.Vector3() }, uBakeInv: { value: new THREE.Vector3(1, 1, 1) },
    uBakeK: { value: new THREE.Vector4(0, 0.1, 0, 0) }, uBakeLamp: { value: new THREE.Color(0, 0, 0) }, uBakeSun: { value: new THREE.Color(0, 0, 0) }, uBakeG: { value: new THREE.Vector3(1.65, 1.15, 1.25) },
    uPetA: { value: new THREE.Vector4() }, uPetB: { value: new THREE.Vector4() }, uPetC: { value: new THREE.Vector4() }, uPetW: { value: new THREE.Vector4() }, uPetL: { value: new THREE.Vector4() } } };
// (K: on, how far out along the normal (m), the two lights that come back at full scale. G: the windows', the lamps' and the sky's light made up for what the furniture now keeps of it,
// so the room as a whole is as bright as it was tuned to be: more light in the open, less in the corners)
const BAKE_PARS = `
uniform highp sampler3D uBakeA, uBakeC, uBakeD; uniform vec3 uBakeMin, uBakeInv, uBakeLamp, uBakeSun, uBakeG, uBakeDown, uBakeTint; uniform vec4 uBakeK;
uniform vec4 uPetA, uPetB, uPetC, uPetW, uPetL;
// how much of a light a ball hides from a point (d: from the point to the ball's middle, r: its radius; L: the way to the
// light, and how sharp its shade: a lamp's is, a window's hardly). After I. Quilez's soft shadow of a sphere: by how far
// the ray to the light passes from the ball, against how far along it that is.
float petShade( vec3 d, vec4 L, float r ) {
	float b = dot( d, L.xyz ), h = b * b - dot( d, d ) + r * r, t = b - sqrt( max( h, 0.0 ) );
	return ( L.w <= 0.0 || t < 0.0 ) ? 1.0 : mix( smoothstep( 0.0, 1.0, 2.5 * L.w * ( sqrt( max( 0.0, r * r - h ) ) - r ) / max( t, 1e-4 ) ), 1.0, smoothstep( 0.12, 0.75, t ) );   // (gone within a stride: the room's other lights fill it)
}`;
const BAKE_AT = `
float bkWin = 1.0, bkLamp = 1.0, bkOpen = 1.0, bkSky = 0.0, bkIn = 0.0, bkPet = 1.0; vec3 bkWinL = vec3( 0.0 ), bkU = vec3( 0.0 ), bkN = vec3( 0.0, 1.0, 0.0 );
#if ( NUM_HEMI_LIGHTS > 0 ) && ! defined( NO_ROOM_BAKE )
{
	bkN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
	vec3 bkW = ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz + cameraPosition;
	bkU = ( bkW + bkN * uBakeK.y - uBakeMin ) * uBakeInv;
	vec3 bkE = smoothstep( vec3( 0.0 ), uBakeInv * 0.15, bkU ) * smoothstep( vec3( 0.0 ), uBakeInv * 0.15, 1.0 - bkU );
	bkIn = uBakeK.x * bkE.x * bkE.y * bkE.z;
	if ( bkIn > 0.0 ) {
		vec4 bkA = textureLod( uBakeA, bkU, 0.0 );   // (the one look-up of a day frame. textureLod: no slope is asked of it, so it is truly left out where the test above fails)
		bkWin = mix( 1.0, bkA.r * uBakeG.x, bkIn ); bkLamp = mix( 1.0, bkA.g * uBakeG.y, bkIn ); bkOpen = mix( 1.0, min( 1.0, bkA.b * uBakeG.z ), bkIn ); bkSky = bkA.a * bkA.a * bkIn;
	}
	#ifdef PET_SHADE
	// the cat is in no grid (it walks about): three balls stand for it (hips, chest, head: world/pets.js), and what they
	// hide of the sky above a face, of the windows and of the lamps is worked out here, within ~1.1 m of it
	vec3 bkQ = uPetA.xyz - bkW;
	if ( uPetA.w > 0.0 && dot( bkQ, bkQ ) < 1.2 ) {
		vec3 dA = bkQ, dB = uPetB.xyz - bkW, dC = uPetC.xyz - bkW; vec3 l2 = max( vec3( dot( dA, dA ), dot( dB, dB ), dot( dC, dC ) ), vec3( 1e-5 ) ), rr = vec3( uPetA.w, uPetB.w, uPetC.w );
		// (how much of the sky above the face each ball hides: wider than the ball, for its coat and its legs)
		float pO = dot( max( vec3( 0.0 ), vec3( dot( bkN, dA ), dot( bkN, dB ), dot( bkN, dC ) ) * inversesqrt( l2 ) ), 1.8 * rr * rr / l2 );
		float pW = min( petShade( dA, uPetW, rr.x ), min( petShade( dB, uPetW, rr.y ), petShade( dC, uPetW, rr.z ) ) );
		float pL = min( petShade( dA, uPetL, rr.x ), min( petShade( dB, uPetL, rr.y ), petShade( dC, uPetL, rr.z ) ) );
		float pK = 1.0 - smoothstep( 0.6, 1.2, dot( bkQ, bkQ ) );   // (all of it eased out by the edge of that reach)
		bkOpen *= mix( 1.0, ( 1.0 - 0.9 * min( 1.0, pO ) ) * mix( 1.0, pW, 0.45 ), pK ); bkWin *= mix( 1.0, pW, 0.9 * pK ); bkPet = mix( 1.0, pL, 0.6 * pK ); bkLamp *= bkPet;   // (the sky's glow comes in by the windows too: it takes part of their shade)
	}
	#endif
}
#endif
`;
let bakedBegin = null;
function bakeShader(sh) {   // a lit material's shader: its lights dimmed and added to by the grid
  if (!sh.fragmentShader.includes('#include <lights_fragment_begin>')) return;
  if (!bakedBegin) {
    const C = THREE.ShaderChunk.lights_fragment_begin, put = (s, a, b) => { if (!s.includes(a)) throw new Error('bake: three\'s lights have changed: ' + a); return s.replace(a, b); };
    // (the lamps are three's first lights: what they have given by the time the sun's turn comes is dimmed in one go, and
    // the windows' share likewise once they are done. A factor on each light's colour inside the loops cost a millisecond
    // and more of a night frame with its dozen lamps.)
    let s = put(C, '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )', '#if ( NUM_HEMI_LIGHTS > 0 ) && ! defined( NO_ROOM_BAKE )\n\treflectedLight.directDiffuse *= bkLamp; reflectedLight.directSpecular *= bkLamp;\n\t#ifdef USE_SHEEN\n\tsheenSpecularDirect *= bkLamp;\n\t#endif\n\t#ifdef USE_CLEARCOAT\n\tclearcoatSpecularDirect *= bkLamp;\n\t#endif\n#endif\n#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
    s = put(s, '\tRectAreaLight rectAreaLight;', '\tRectAreaLight rectAreaLight; vec3 bkD0 = reflectedLight.directDiffuse;');
    s = put(s, 'rectAreaLight = rectAreaLights[ i ];', 'rectAreaLight = rectAreaLights[ i ];\n\t\tbkWinL += rectAreaLight.color;');
    s = put(s, '\t#pragma unroll_loop_end\n#endif\n#if defined( RE_IndirectDiffuse )', '\t#pragma unroll_loop_end\n\treflectedLight.directDiffuse = bkD0 + ( reflectedLight.directDiffuse - bkD0 ) * bkWin;\n#endif\n#if defined( RE_IndirectDiffuse )');
    s = put(s, 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * bkOpen;');
    s = put(s, '#if defined( RE_IndirectSpecular )', '#if defined( RE_IndirectDiffuse )\n\t#if NUM_RECT_AREA_LIGHTS > 0\n\tbkWinL /= float( NUM_RECT_AREA_LIGHTS );\n\t#endif\n\tirradiance += PI * uBakeK.z * bkSky * uBakeTint * ( bkWinL + uBakeSun );\n'
      + '\tif ( uBakeDown.r > 0.0 && bkIn > 0.0 ) {   // by lamplight only, two look-ups more: the ceiling\'s baked downlights (what they give a face looking each of six ways, weighed by the way this one looks; kept as cube roots), and the lamps\' light that comes back\n\t\tvec4 bkP = textureLod( uBakeC, bkU, 0.0 ); vec3 bkM = textureLod( uBakeD, bkU, 0.0 ).rgb;\n\t\tvec3 bkDn = bkIn * uBakeDown * bkPet * dot( bkN * bkN, mix( bkM * bkM * bkM, bkP.rgb * bkP.rgb * bkP.rgb, step( 0.0, bkN ) ) );\n\t\tirradiance += bkDn + bkIn * PI * uBakeK.w * bkP.a * bkP.a * uBakeLamp;\n\t\t#ifdef USE_SHEEN\n\t\t// (the glow of a pile under those lamps: baked, they are no lights any more, and velvet lit by its colour alone goes near black; as from straight above)\n\t\tsheenSpecularDirect += bkDn * BRDF_Sheen( normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ), geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );\n\t\t#endif\n\t}\n#endif\n#if defined( RE_IndirectSpecular )');
    bakedBegin = BAKE_AT + s;
  }
  Object.assign(sh.uniforms, BAKE.U);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + BAKE_PARS).replace('#include <lights_fragment_begin>', bakedBegin)
    .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n#if defined( RE_IndirectDiffuse )\n\tiblIrradiance *= bkOpen;\n#endif\n#if defined( RE_IndirectSpecular )\n\tradiance *= 0.4 + 0.6 * bkOpen;\n#endif');
}
// every material: its own hook, then this one (a hook's text is part of what tells two shaders apart: kept so)
Object.defineProperty(THREE.Material.prototype, 'onBeforeCompile', { configurable: true,
  get() { return this._ownHook || bakeShader; },
  set(f) { const w = function (sh, r) { f.call(this, sh, r); bakeShader.call(this, sh); }; w.toString = () => 'bake+' + f.toString(); this._ownHook = w; } });
/* A glossy thing's mirror image of the room. three gives every material the same picture to mirror (a sky's gradient):
   a floor then shines alike under the shelves and before the windows. The room's own picture, taken from its middle
   for the glass (fx/glass.js: a cube map, taken again when the light changes), is looked up instead where the mirrored
   ray leaves the room's box (as the glass does: a parallax-corrected cube map), blurred by the material's roughness
   (the map's smaller copies): the windows lie on the floor as soft bright shapes, the lamps by night, dark where the
   shelves stand. Called from a material's own hook; `gloss`: its finish taken as that much smoother than its
   roughness says (a varnish over a rough wood), `k`: how much of the room's picture against three's.
   Until the room's picture is in (and while it is being taken: a picture cannot be read as it is drawn) uRoomK is 0. */
const ROOM_MIRROR = { u: { uRoomEnv: { value: null }, uRoomMin: { value: new THREE.Vector3() }, uRoomMax: { value: new THREE.Vector3() }, uRoomAt: { value: new THREE.Vector3() }, uRoomK: { value: 0 } } };
BAKE.mirror = ROOM_MIRROR;
function mirrorRoom(sh, gloss = 0.6, k = 1) {
  Object.assign(sh.uniforms, ROOM_MIRROR.u);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform samplerCube uRoomEnv; uniform vec3 uRoomMin, uRoomMax, uRoomAt; uniform float uRoomK;')
    .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
	if ( uRoomK > 0.0 ) {
		vec3 rmP = ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz + cameraPosition, rmR = normalize( ( vec4( reflect( - geometryViewDir, geometryNormal ), 0.0 ) * viewMatrix ).xyz ), rmS = rmR + vec3( 1e-5 );
		vec3 rmA = ( uRoomMax - rmP ) / rmS, rmB = ( uRoomMin - rmP ) / rmS, rmF = max( rmA, rmB ); float rmT = max( 0.0, min( min( rmF.x, rmF.y ), rmF.z ) ), rmQ = material.roughness * ${gloss.toFixed(3)};
		radiance = mix( radiance, textureLod( uRoomEnv, rmP + rmR * rmT - uRoomAt, rmQ * ( 1.7 - 0.7 * rmQ ) * 7.0 ).rgb * ( 0.4 + 0.6 * bkOpen ), uRoomK * ${k.toFixed(3)} );
	}
#endif`);
}
// the lamps: the baked downlights' light and all the lamps' light that comes back, as they are lit (k: 0 by day, when
// only the reading lamps glow a little and what comes back of that is let go, to 1 by night)
function bakeLamps(k) { BAKE.U.uBakeLamp.value.copy(BAKE.lampCol); BAKE.U.uBakeDown.value.set(0xffd6a0).multiplyScalar(BAKE.down ? k * BAKE_META.down * BAKE.gain.down : 0); BAKE.U.uBakeK.value.w = BAKE.down ? k * BAKE_META.lamp * BAKE.gain.lamp : 0; }
// the sun's: it comes in by the same windows and lands on the same floor, so what comes back of it is taken to go where
// the windows' own light goes back to, as strong as the sun is (no grid of its own: it moves all day)
// (windows: false once the windows' lights are out, deep in the night: no daylight left to come back, its grid not read)
function bakeSun(color, intensity, windows) { BAKE.U.uBakeSun.value.copy(color).multiplyScalar(intensity * BAKE.gain.sun); BAKE.U.uBakeK.value.z = BAKE.ok && (windows || intensity > 0) ? BAKE.sky : 0; }
// the grid's picture, read into its two textures: inline (base64) in the one-file build, a file next to the page on
// GitHub Pages. A promise of true when it is in.
async function loadBake() {
  const M = BAKE_META, el = document.getElementById('light-bake'); if (!M || !el) return false;
  try {
    const src = el.dataset.src || (el.textContent.trim().length > 100 ? 'data:image/webp;base64,' + el.textContent.trim() : null); if (!src) return false;
    const bmp = await createImageBitmap(await (await fetch(src)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0); const px = g.getImageData(0, 0, bmp.width, bmp.height).data, rows = bmp.height; if (bmp.close) bmp.close();   // (rows: a closed picture has no height left)
    const [nx, ny, nz] = M.n, W = M.cols * nx, Hb = Math.ceil(nz / M.cols) * ny, NV = nx * ny * nz * 4, A = new Uint8Array(NV), C = new Uint8Array(NV), D = new Uint8Array(NV); if (rows < 4 * Hb) return false;
    // (the picture's four blocks: the windows' share, the lamps', how open | the daylight and the lamplight that come back | the baked lamps on faces looking +x +y +z | and -x -y -z)
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) { const X = (z % M.cols) * nx, Y = Math.floor(z / M.cols) * ny + y;
      for (let x = 0; x < nx; x++) { const o = (x + nx * (y + ny * z)) * 4, a = (Y * W + X + x) * 4, b = a + Hb * W * 4, c = b + Hb * W * 4, d = c + Hb * W * 4;
        A[o] = px[a]; A[o + 1] = px[a + 1]; A[o + 2] = px[a + 2]; A[o + 3] = px[b]; C[o] = px[c]; C[o + 1] = px[c + 1]; C[o + 2] = px[c + 2]; C[o + 3] = px[b + 1]; D[o] = px[d]; D[o + 1] = px[d + 1]; D[o + 2] = px[d + 2]; D[o + 3] = 255; } }
    const tex = d => { const t = new THREE.Data3DTexture(d, nx, ny, nz); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true; return t; };
    const U = BAKE.U; for (const [k, d] of [['uBakeA', A], ['uBakeC', C], ['uBakeD', D]]) { const old = U[k].value; U[k].value = tex(d); old.dispose(); }
    BAKE.down = true; U.uBakeTint.value.fromArray(M.tint);
    U.uBakeMin.value.fromArray(M.min); U.uBakeInv.value.set(1 / (nx * M.s), 1 / (ny * M.s), 1 / (nz * M.s));
    BAKE.sky = M.sky * BAKE.gain.sky; U.uBakeK.value.set(1, M.s, BAKE.sky, 0); BAKE.ok = true; return true;
  } catch (e) { console.warn('the room\'s baked light could not be read', e); return false; }
}

export { BAKE, ROOM_MIRROR, bakeLamps, bakeSun, loadBake, mirrorRoom };
