import './wind.js';   // build order: the module before this one runs first
import * as THREE from 'three';

/* ---------------------------------------------------------------- solid wood
   Wood as a solid, with no picture: a point's colour comes from where it lies in the tree. Its distance from the pith
   gives the growth rings (pale early wood darkening to the year's end, then sharply pale again), so a face cut along the
   grain shows long stripes and cathedral arches, a face cut across it shows rings, and the two meet rightly at an edge:
   no seam, no repeat, nothing to download. On top of the rings: fibres along the grain, the pores' short dark dashes,
   broad figure, and a relief of the same (the late wood stands a little proud, the pores are pits).
   - `scale`: the mesh's own units to metres (a mesh scaled unevenly keeps its grain true).
   - `grain`: 'x' or 'y', the mesh's axis the trunk runs along.
   - `pith`: where the tree's middle lies, in the plane across the grain (m).
   - `plank` (m): boards glued side by side across the grain, each cut from its own place in a log, each a little its
     own tone; 0: one piece.
   - `ring` (m): a year's growth.
   - `checks`: the drying cracks of a disc cut across the trunk (on faces across the grain), from the pith outward; and on
     a face that lies along a ring (a peeled trunk's side): a few knots, and cracks down it.
   - `bark` (m): from that distance from the mesh's upright axis outward, bark (a slab's live edge).
   One shader for every wood (customProgramCacheKey), told apart by its uniforms. Fine detail fades out by its size on
   the screen (fwidth), so it does not shimmer far off. */
const WOOD_GLSL = `
  varying vec3 vWoodP;
  uniform vec3 uWScale, uWLight, uWDark; uniform mat3 uWRot; uniform vec4 uWPith, uWFin;
  float wh(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
  float wn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(wh(i), wh(i + vec3(1,0,0)), f.x), mix(wh(i + vec3(0,1,0)), wh(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(wh(i + vec3(0,0,1)), wh(i + vec3(1,0,1)), f.x), mix(wh(i + vec3(0,1,1)), wh(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float wfbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * wn(p); p = p * 2.03 + vec3(17.1, 3.7, 9.3); a *= 0.5; } return s / 0.875; }
  // the wood at a point of the mesh: its colour; h: its relief (m); rg: how much rougher than the finish
  vec3 woodAt(vec3 P, out float h, out float rg) {
    vec3 pm = P * uWScale, q = uWRot * pm;                       // the tree's frame (m): z along the grain
    vec2 pith = uWPith.xy; float tone = 0.0;
    if (uWPith.z > 0.0) {                                         // boards across x, each from its own place in a log
      float b = floor(q.x / uWPith.z), r1 = wh(vec3(b, 3.1, 7.7)), r2 = wh(vec3(b, 9.4, 1.3));
      pith = vec2((b + 0.5 + (r1 - 0.5) * 1.7) * uWPith.z, uWPith.y - 0.012 - 0.11 * r2 * r2 + (r1 - 0.5) * 0.09 * q.z); q.z += 5.0 * r1; tone = r2 - 0.5;   // (the log's middle not level with the board: the rings rise through its face, in arches)
    }
    vec2 rp = q.xy - pith;
    rp += 0.02 * (vec2(wn(vec3(q.z * 1.6, 1.0, 4.0)), wn(vec3(q.z * 1.6, 7.0, 2.0))) - 0.5);   // (a trunk is never straight)
    float r = length(rp);
    r += 0.004 * (wfbm(vec3(rp * 13.0, q.z * 0.9)) - 0.5) + 0.0011 * (wn(vec3(rp * 70.0, q.z * 3.0)) - 0.5);   // (nor are its rings round)
    float ring = r / uWPith.w + 0.9 * wn(vec3(r / (uWPith.w * 6.0), 3.0, 1.0)), f = fract(ring), aa = 1.0 - smoothstep(0.3, 0.85, fwidth(ring));   // (years of wide rings, years of narrow)
    float year = wh(vec3(floor(ring), 2.0, 5.0));               // (a good year, a lean one)
    float late = smoothstep(0.42, 0.93, f) * (1.0 - smoothstep(0.93, 1.0, f)) * (0.7 + 0.5 * year); late = mix(0.3, late, aa);
    vec3 nrm = normalize(uWRot * cross(dFdx(pm), dFdy(pm))); float end = smoothstep(0.6, 0.9, abs(nrm.z));   // (the face, in the tree's frame; across the grain: end)
    float lie = abs(dot(nrm.xy, rp / max(r, 1e-4)));          // (a face lying along a ring, as a peeled trunk's: one year's wood all over it, no stripes)
    late = mix(late, 0.3, 0.8 * smoothstep(0.80, 0.985, lie) * (1.0 - end));
    float fw = max(fwidth(q.x), fwidth(q.y)), fa = 1.0 - smoothstep(0.25, 0.9, fw * 240.0);
    float fib = mix(0.5, wfbm(vec3(q.xy * 240.0, q.z * 6.0)), fa);                                           // fibres along the grain
    float po = smoothstep(0.76, 0.92, wn(vec3(q.xy * 620.0, q.z * 26.0))) * (1.0 - smoothstep(0.2, 0.7, fw * 620.0)) * (1.0 - 0.6 * late);   // pores, in the early wood most
    float fig = 0.6 * (wn(vec3(q.xy * 7.0, q.z * 0.9)) - 0.5) + 0.7 * (wfbm(vec3(q.xy * 26.0, q.z * 1.7)) - 0.5);   // figure: broad, and in long streaks
    vec3 c = mix(uWLight, uWDark, late * 0.72) * (0.88 + 0.24 * fib) * (1.0 - 0.38 * po) * (1.0 + 0.22 * tone + 0.30 * fig);
    h = late * 0.00010 + (fib - 0.5) * 0.00008 - po * 0.00022; rg = 0.16 * po + 0.07 * (0.5 - late) + 0.10 * (0.5 - fib);
    c *= 1.0 - 0.10 * end;                                                                                    // (end grain drinks the finish: darker)
    if (uWFin.z > 0.0 && end > 0.0) {                            // the checks of a disc: some of nine rays from the pith
      float th = atan(rp.y, rp.x), k = 9.0, sec = floor(th / 6.2832 * k + 0.5), on = step(0.4, wh(vec3(sec, 5.0, 2.0)));
      float d = abs(th - sec * 6.2832 / k + 0.16 * (wn(vec3(r * 24.0, sec, 1.0)) - 0.5)) * r, len = 0.10 + 0.17 * wh(vec3(sec, 1.0, 8.0));
      float wd = 0.0016 * smoothstep(0.0, 0.04, r) * (1.0 - smoothstep(len - 0.05, len, r)) * (0.5 + wh(vec3(sec, 6.0, 3.0)));
      float ck = on * end * uWFin.z * (1.0 - smoothstep(wd * 0.5, wd + fwidth(d), d)) * step(1e-5, wd);
      c = mix(c, uWDark * 0.22, ck); h -= ck * 0.0015; rg += 0.3 * ck;
    }
    float skin = uWFin.z * smoothstep(0.80, 0.985, lie) * (1.0 - end);
    if (skin > 0.0) {                                            // a peeled trunk's own marks: knots, and cracks down it as it dried
      float th = atan(rp.y, rp.x), kn = 0.0, rim = 0.0;
      for (int i = 0; i < 4; i++) { float fi = float(i); vec2 kc = vec2(wh(vec3(fi, 1.3, 4.0)) * 6.2832 - 3.1416, 0.06 + 0.36 * wh(vec3(fi, 7.1, 2.0)));
        float da = th - kc.x; da -= 6.2832 * floor(da / 6.2832 + 0.5); vec2 dk = vec2(da * r, (q.z - kc.y) * 0.62) / (0.010 + 0.008 * wh(vec3(fi, 5.0, 9.0))); float d2 = dot(dk, dk);
        kn = max(kn, exp(-d2 * d2)); rim = max(rim, exp(-pow(sqrt(d2) - 1.5, 2.0) * 5.0) * 0.5 + exp(-pow(sqrt(d2) - 2.3, 2.0) * 6.0) * 0.25); }
      float cl = wn(vec3(th * 11.0 + 0.5 * wn(vec3(q.z * 9.0, th * 3.0, 2.0)), q.z * 1.1, 4.0)), cw = 0.035 + fwidth(th) * 11.0, ck = (1.0 - smoothstep(0.0, cw, abs(cl - 0.5))) * smoothstep(0.35, 0.6, wn(vec3(th * 3.0, q.z * 2.3, 8.0)));
      c = mix(c, uWDark * 0.30, skin * max(kn * 0.9, ck * 0.75)) * (1.0 - 0.22 * skin * rim); h -= skin * (kn * 0.0008 + ck * 0.0012); rg += 0.2 * skin * max(kn, ck);
    }
    if (uWFin.w > 0.0) {                                         // bark, from that far from the mesh's upright axis
      float rb = length(pm.xz) + 0.004 * (wn(vec3(pm.xz * 55.0, pm.y * 9.0)) - 0.5), bk = smoothstep(uWFin.w - 0.004, uWFin.w + 0.001, rb);
      float fur = wfbm(vec3(atan(pm.z, pm.x) * 9.0, pm.y * 5.0, 3.0)), rid = wn(vec3(atan(pm.z, pm.x) * 40.0, pm.y * 14.0, 9.0));
      vec3 bc = vec3(0.105, 0.072, 0.048) * (0.55 + 0.9 * fur) * (0.8 + 0.4 * rid);
      c = mix(c * (1.0 - 0.35 * smoothstep(uWFin.w - 0.03, uWFin.w, rb)), bc, bk); h = mix(h, (fur - 0.5) * 0.004 + (rid - 0.5) * 0.0012, bk); rg = mix(rg, 0.35, bk);
    }
    return c;
  }
  vec3 woodBump(vec3 sp, vec3 sn, float hgt) {   // (the normal tipped by a relief in metres: as three's perturbNormalArb)
    vec3 sx = dFdx(sp), sy = dFdy(sp), r1 = cross(sy, sn), r2 = cross(sn, sx); float det = dot(sx, r1);
    vec3 g = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2); return normalize(abs(det) * sn - g);
  }`;
function makeWood({ light, dark, scale = [1, 1, 1], grain = 'y', pith = [0, 0], plank = 0, ring = 0.007, rough = 0.5, bump = 1, gloss = 1, checks = 0, bark = 0 }) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0 });
  const rot = new THREE.Matrix3(); if (grain === 'x') rot.set(0, 0, 1, 0, 1, 0, 1, 0, 0); else rot.set(1, 0, 0, 0, 0, 1, 0, 1, 0);   // (the mesh's axes to the tree's: across, across, along)
  const U = { uWScale: { value: new THREE.Vector3().fromArray(scale) }, uWRot: { value: rot }, uWPith: { value: new THREE.Vector4(pith[0], pith[1], plank, ring) },
    uWLight: { value: new THREE.Color(light) }, uWDark: { value: new THREE.Color(dark) }, uWFin: { value: new THREE.Vector4(bump, gloss, checks, bark) } };
  m.userData.wood = U; m.customProgramCacheKey = () => 'wood';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWoodP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWoodP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + WOOD_GLSL)
      .replace('#include <map_fragment>', '#include <map_fragment>\n  float wH, wR; diffuseColor.rgb *= woodAt(vWoodP, wH, wR);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + wR * uWFin.y, 0.08, 1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = woodBump(-vViewPosition, normal, wH * uWFin.x);');
  };
  return m;
}

export { makeWood };
