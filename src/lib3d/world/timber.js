import '../core/bake.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { mirrorRoom } from '../core/bake.js';

/* ---------------------------------------------------------------- the room's timber, seen near
   The floor, the ceiling, the shelves' boards and the frames wear painted pictures (textures.js): a board's figure, a
   pixel every millimetre or two. That is all there is to see from across the room, and too little from a hand's
   breadth: so the material adds, by the place on the board in metres (the mesh's uv), what a picture that size cannot
   hold. Each layer fades out as its grain nears the size of a pixel on the screen, and is not worked out at all beyond.
   - fibres: fine lines along the grain, two sizes; pores: an oak's short dark dashes, pits in the relief.
   - lines: grain lines a few millimetres apart, for a picture too small to hold its own rings (the frames').
   - joints: where the picture's alpha says how far the nearest joint between two boards is (a floor's, a ceiling's),
     the gap drawn sharp at any distance by how much of a pixel it covers, its edges eased over; none where the alpha is 1.
   - wear: a finish is never one gloss all over (broad dull patches, scuffs along the grain).
   - relief: all of the above, and the picture's own figure, as a relief in metres (no bump map: one look-up of the
     picture a pixel, not four).
   One shader for them all (customProgramCacheKey), told apart by their uniforms. */
const TIMBER_GLSL = `
  varying vec2 vTbUv;
  uniform vec4 uTbA, uTbB; uniform vec2 uTbC;   // A: lines, fibres, pores, relief; B: joints, wear, the picture's relief, lines a metre; C: half a joint's gap (m), 1.5 pixels of the picture along the grain (its v)
  float tbh(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float tbn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(tbh(i), tbh(i + vec2(1.0, 0.0)), f.x), mix(tbh(i + vec2(0.0, 1.0)), tbh(i + vec2(1.0, 1.0)), f.x), f.y); }
  // q: metres across the grain and along it; tex: the picture there; a2: its alpha a little way along the grain.
  // The colour's factor; h: relief (m); rg: rougher by
  float timberAt(vec2 q, vec4 tex, float a2, out float h, out float rg) {
    float c = 1.0, fw = fwidth(q.x); rg = 0.0;
    h = -(dot(tex.rgb, vec3(0.3, 0.6, 0.1)) - 0.3) * 0.0005 * uTbB.z;                 // (the pale early wood is the softer: worn a little hollow)
    if (uTbA.x > 0.0) {                                                              // grain lines the picture is too small for
      float ph = q.x * uTbB.w + 7.0 * tbn(vec2(q.x * 21.0, q.y * 0.9)), la = (1.0 - smoothstep(0.12, 0.42, fwidth(ph))) * uTbA.x;
      if (la > 0.0) { float ln = 0.5 + 0.5 * cos(6.2832 * ph); ln *= ln * (0.5 + tbn(vec2(floor(ph) * 0.37, q.y * 2.0))); c *= 1.0 - la * 0.42 * (ln - 0.3); h += la * ln * 0.00005; }
    }
    float fa = (1.0 - smoothstep(0.25, 0.8, fw * 1100.0)) * uTbA.y;
    if (fa > 0.0) {                                                                  // fibres, and pores
      float fib = 0.6 * tbn(vec2(q.x * 1100.0, q.y * 13.0)) + 0.4 * tbn(vec2(q.x * 2600.0 + 5.0, q.y * 31.0));
      float po = uTbA.z * (1.0 - smoothstep(0.25, 0.8, fw * 1700.0)); if (po > 0.0) po *= smoothstep(0.78, 0.92, tbn(vec2(q.x * 1700.0 + 3.0, q.y * 55.0)));
      c *= 1.0 + fa * (0.24 * (fib - 0.5) - 0.32 * po); h += fa * ((fib - 0.5) * 0.00006 - po * 0.00016); rg += fa * (0.14 * po + 0.10 * (0.5 - fib));
    }
    if (uTbB.y > 0.0) { rg += uTbB.y * 0.22 * (tbn(q * vec2(2.3, 0.9)) - 0.5); if (fw < 0.006) rg += uTbB.y * 0.08 * (tbn(q * vec2(31.0, 4.0) + 9.0) - 0.5); }   // the finish's wear: broad dull patches; scuffs along the grain
    float d = tex.a * 0.012;
    if (uTbB.x > 0.0 && d < 0.0114) {                                                // the joints
      // (how wide a pixel is across the joint: across the grain by a side joint, along it by an end joint, told apart by
      // the alpha a little way along the grain. Not fwidth(d): d turns back at the joint, and there its slope reads as none)
      float end = step(0.0015, abs(a2 - tex.a) * 0.012), aa = max(mix(fw, fwidth(q.y), end), 2e-5), g = uTbC.x;
      float line = clamp(min(g, d + 0.5 * aa) + min(g, 0.5 * aa - d), 0.0, aa) / aa, bev = 1.0 - smoothstep(0.0, 0.002 + g, d);   // (how much of the pixel the gap covers)
      c *= 1.0 - uTbB.x * 0.8 * line; h -= uTbB.x * (0.0005 * bev * bev + 0.0012 * line) * (1.0 - smoothstep(0.0005, 0.002, aa)); rg += 0.25 * line;
    }
    return c;
  }
  vec3 timberBump(vec3 sp, vec3 sn, float hgt) {   // (the normal tipped by a relief in metres: as three's perturbNormalArb)
    vec3 sx = dFdx(sp), sy = dFdy(sp), r1 = cross(sy, sn), r2 = cross(sn, sx); float det = dot(sx, r1);
    return normalize(abs(det) * sn - sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2));
  }`;
// m: a material whose map is one of the painted woods, on a mesh whose uv is in metres (u across the grain, v along)
function fineTimber(m, { lines = 0, fibre = 1, pore = 1, relief = 1, joint = 0, gap = 0.0013, wear = 0, figure = 1, pitch = 0.0026, rows = 1024, mirror = 0 } = {}) {   // (gap: a joint's width, m; rows: the picture's height in pixels; mirror: its varnish mirrors the room, core/bake.js)
  const U = { uTbA: { value: new THREE.Vector4(lines, fibre, pore, relief) }, uTbB: { value: new THREE.Vector4(joint, wear, figure, 1 / pitch) }, uTbC: { value: new THREE.Vector2(gap / 2, 1.5 / rows) } };
  m.userData.timber = U; m.customProgramCacheKey = () => 'timber' + (mirror ? '-mirror' : '');
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTbUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTbUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + TIMBER_GLSL)
      .replace('#include <map_fragment>', '#include <map_fragment>\n  float tbH, tbR, tbA = sampledDiffuseColor.a; if (uTbB.x > 0.0 && tbA < 0.95) tbA = texture2D(map, vMapUv + vec2(0.0, uTbC.y)).a;\n  diffuseColor.rgb *= timberAt(vTbUv, sampledDiffuseColor, tbA, tbH, tbR); diffuseColor.a = 1.0;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + tbR, 0.08, 1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = timberBump(-vViewPosition, normal, tbH * uTbA.w);');
    if (mirror) mirrorRoom(sh, 0.6, mirror);
  };
  return m;
}

export { fineTimber };
