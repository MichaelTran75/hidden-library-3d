import './wood.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { rng } from '../core/utils.js';

/* ---------------------------------------------------------------- things as a hand and the years leave them
   Four finishes with no picture, each worked out from where a point lies on the thing (as wood.js), and none of them
   even: what makes a pot, a lamp or a leaf look real is what is a little wrong with it.
   - 'fired': thrown and glazed clay. The potter's fingers leave ridges round it; the glaze ran before it set (thick in
     the hollows and where it pooled, thin over the rim and the ridges, where the clay shows through browner); it stops
     in a wavering line above the foot, which is bare clay; iron in the clay burns through as specks; an old glaze is
     crazed. `foot`, `rim`: their heights (the mesh's own units); `speckle`, `craze`: how much.
   - 'woven': a lamp shade's linen, lit from inside. Threads over and under, uneven along their length; the light comes
     through the gaps between them most, less through the hems folded over the rings and the seam where the cloth laps;
     brightest level with the bulb; the cloth not quite flat on its frame.
   - 'tarnish': metal spun on a lathe (fine rings round its axis), dulled in clouds where no hand or cloth reaches,
     bright where they do, with dark specks of oxide.
     With c[3] = 1 the same shader makes potting earth instead: crumbs, pale grit, damp round the stems.
   - 'leaf' (an instanced mesh of leaves, +z along each): a midrib and slanting veins, a net of small veins between
     them, paler and darker patches, a darker margin, the underside paler and duller; and each leaf its own age: some
     yellowing from the edge, a few with a dry brown tip.
   handMade() does the same to a shape: a turned thing is never quite round, its wall wavers, it leans a little and its
   rim is not level. turned() is a lathe whose seam is welded, so it shades smoothly there after that.
   Fine detail fades out by its size on the screen (fwidth). One shader a kind (customProgramCacheKey). */
const MATTER_LIB = `
  varying vec3 vMatP;
  uniform vec4 uMA, uMC; uniform vec3 uMB;
  float mh(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
  float mn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(mh(i), mh(i + vec3(1,0,0)), f.x), mix(mh(i + vec3(0,1,0)), mh(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(mh(i + vec3(0,0,1)), mh(i + vec3(1,0,1)), f.x), mix(mh(i + vec3(0,1,1)), mh(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float mfbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * mn(p); p = p * 2.03 + vec3(17.1, 3.7, 9.3); a *= 0.5; } return s / 0.875; }
  vec3 matterBump(vec3 sp, vec3 sn, float hgt) {
    vec3 sx = dFdx(sp), sy = dFdy(sp), r1 = cross(sy, sn), r2 = cross(sn, sx); float det = dot(sx, r1);
    return normalize(abs(det) * sn - sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2));
  }`;
// each kind: the colour at a point p of the mesh, from the colour it has there (base); h: its relief (m); rg: rougher by;
// em: its own light times
const MATTER_KIND = {
  fired: `float mcell(vec2 p) {   // how far a point is from the wall between its cell and the next (cells about 1 across): a net of cracks where that is small
    vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0;
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) { vec2 o = vec2(float(x), float(y)), c = o + vec2(mh(vec3(i + o, 1.0)), mh(vec3(i + o, 7.0))) - f; float d = dot(c, c); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
    return sqrt(d2) - sqrt(d1);
  }
  vec3 matterAt(vec3 p, vec3 base, out float h, out float rg, out float em) {   // uMA: foot, rim, speckle, craze; uMB: the bare clay; uMC.x: ridges a metre, .y: the glaze's gloss, .z: the ridges' depth, .w: 1 for earth
    em = 1.0; float y = p.y;
    if (uMC.w > 0.5) {   // potting earth (in the pot: the same shader): crumbs, pale grit, damp and darker round the stems
      float cr = mfbm(p * 130.0), lump = mfbm(p * 38.0), grit = smoothstep(0.86, 0.95, mn(p * 330.0)) * (1.0 - smoothstep(0.2, 0.6, fwidth(p.x) * 330.0)), damp = 1.0 - smoothstep(0.02, 0.09, length(p.xz));
      h = (cr - 0.5) * 0.0012 + (lump - 0.5) * 0.004 + grit * 0.0006; rg = 0.0;
      return mix(base * (0.45 + 1.1 * cr * lump) * (1.0 - 0.45 * damp), vec3(0.30, 0.27, 0.22), grit * 0.8);
    }
    float rings = 0.5 + 0.5 * sin(y * uMC.x + 3.0 * mn(vec3(p.xz * 6.0, y * 4.0)));
    float run = mfbm(vec3(p.xz * 9.0, y * 3.0 + 2.0)), thick = clamp(0.55 + 0.9 * (run - 0.5) + 0.22 * (0.5 - rings), 0.0, 1.0);
    float line = uMA.x + 0.02 * (mfbm(vec3(p.xz * 7.0, 3.0)) - 0.5), glazed = smoothstep(line - 0.0012, line + 0.0012, y);
    thick = clamp(thick - 0.55 * smoothstep(uMA.y - 0.014, uMA.y - 0.003, y), 0.0, 1.0);
    float sp = smoothstep(0.83, 0.95, mn(p * 420.0)) * (1.0 - smoothstep(0.2, 0.7, fwidth(p.x) * 420.0)), sp2 = smoothstep(0.88, 0.97, mn(p * 170.0 + 9.0));
    vec3 body = uMB * (0.82 + 0.36 * mfbm(p * 55.0)) * (1.0 - 0.45 * sp2);
    vec3 gl = base * (0.86 + 0.24 * thick); gl = mix(gl, mix(base, uMB, 0.75) * 0.92, smoothstep(0.42, 0.08, thick));
    gl = mix(gl, uMB * 0.38, clamp(sp * 0.45 + sp2 * 0.85, 0.0, 1.0) * uMA.z);
    float cl = 0.0; if (uMA.w > 0.0) { vec2 q = vec2(atan(p.z, p.x) * length(p.xz), y) * 170.0 + 3.0 * mfbm(p * 20.0); float cz = mcell(q); cl = (1.0 - smoothstep(0.02, 0.06 + fwidth(cz) * 1.2, cz)) * uMA.w * (1.0 - smoothstep(0.15, 0.5, fwidth(q.x) + fwidth(q.y))) * smoothstep(0.25, 0.6, mfbm(p * 14.0 + 5.0)); }   // (crazed in patches, a fine net)
    gl *= 1.0 - 0.30 * cl; gl *= 1.0 - 0.10 * smoothstep(line + 0.03, line, y);   // (and grime gathers low on it)
    h = rings * 0.0003 * uMC.z + glazed * (0.00025 + thick * 0.00035) - glazed * (sp2 * 0.00015 + cl * 0.00004);
    rg = mix(0.42, (0.5 - thick) * uMC.y + 0.25 * sp2 + 0.1 * cl, glazed);
    return mix(body, gl, glazed);
  }`,
  woven: `vec3 matterAt(vec3 p, vec3 base, out float h, out float rg, out float em) {   // uMA: foot y, top y, radius at each; uMC: threads a metre, the seam's angle, the bulb's height
    float th = atan(p.z, p.x), t = clamp((p.y - uMA.x) / (uMA.y - uMA.x), 0.0, 1.0), R = mix(uMA.z, uMA.w, t);
    vec2 uv = vec2(th * R, p.y) * uMC.x; float fw = max(fwidth(uv.x), fwidth(uv.y)), aa = 1.0 - smoothstep(0.10, 0.40, fw);
    if (fw > 3.0) aa = 0.0;   // (the seam of the angle, where uv jumps)
    float su = mn(vec3(uv.x * 0.07, floor(uv.y) * 1.7, 2.0)), sv = mn(vec3(floor(uv.x) * 1.7, uv.y * 0.07, 5.0));
    float wa = abs(fract(uv.x) - 0.5) * 2.0, we = abs(fract(uv.y) - 0.5) * 2.0, over = step(0.5, fract((floor(uv.x) + floor(uv.y)) * 0.5));
    float gap = smoothstep(0.55, 0.95, wa) * smoothstep(0.55, 0.95, we) * aa;
    float wv = mix(0.5, mix((1.0 - wa * wa) * (0.8 + 0.4 * sv), (1.0 - we * we) * (0.8 + 0.4 * su), over), aa);
    float fold = mfbm(vec3(p.xz * 5.0, p.y * 5.0)) - 0.5;
    float da = th - uMC.y; da -= 6.2832 * floor(da / 6.2832 + 0.5); float seam = 1.0 - smoothstep(0.005, 0.007, abs(da * R));
    float hem = 1.0 - smoothstep(0.011, 0.013, min(p.y - uMA.x, uMA.y - p.y));
    float hot = exp(-pow((p.y - uMC.z) / 0.085, 2.0));
    em = (0.60 + 0.58 * hot) * (0.86 + 0.30 * gap - 0.16 * (wv - 0.5)) * (1.0 - 0.42 * hem) * (1.0 - 0.28 * seam) * (1.0 + 0.3 * fold);
    h = wv * 0.00018 + fold * 0.0007 + (hem + seam) * 0.00035; rg = 0.0;
    return base * (0.86 + 0.20 * wv + 0.12 * fold) * (1.0 - 0.08 * hem);
  }`,
  tarnish: `vec3 matterAt(vec3 p, vec3 base, out float h, out float rg, out float em) {   // uMA: the lathe's rings a metre, how tarnished; uMB: the oxide
    em = 1.0; float s = (p.y + length(p.xz)) * uMA.x, aa = 1.0 - smoothstep(0.08, 0.3, fwidth(s) / 6.2832);
    float spin = mix(0.5, 0.5 + 0.5 * sin(s + 1.5 * mn(vec3(p.xz * 3.0, p.y * 30.0))), aa);
    float pat = mfbm(p * 9.0 + 2.0 * mfbm(p * 3.0)), worn = smoothstep(0.42, 0.72, pat), spot = smoothstep(0.82, 0.94, mn(p * 70.0));
    vec3 c = mix(base * mix(0.6, 1.0, worn), uMB, (1.0 - worn) * 0.5 * uMA.y); c = mix(c, uMB * 0.5, spot * 0.55 * uMA.y) * (0.95 + 0.1 * spin);
    h = (spin - 0.5) * 0.00004 - spot * 0.00008; rg = ((1.0 - worn) * 0.28 + spot * 0.2) * uMA.y + 0.10 * (spin - 0.5);
    return c;
  }`,
  leaf: `varying float vLeafR;
  vec3 matterAt(vec3 p, vec3 base, out float h, out float rg, out float em) {
    em = 1.0; float z = clamp(p.z, 0.0, 1.0), ax = abs(p.x), hw = sin(3.14159 * pow(z, 0.75)) * 0.32 * (1.0 - 0.25 * z), e = clamp(ax / max(hw, 1e-3), 0.0, 1.0);
    float mid = 1.0 - smoothstep(0.010, 0.028, ax);
    float vph = z * 10.0 - ax * 8.0 + 0.5 * mn(vec3(p.x * 8.0, z * 6.0, vLeafR * 9.0));
    float vein = pow(0.5 + 0.5 * cos(vph * 6.2832), 16.0) * (1.0 - 0.6 * e) * (1.0 - smoothstep(0.08, 0.3, fwidth(vph)));
    float mott = mfbm(vec3(p.x * 9.0, z * 7.0, vLeafR * 20.0));
    float net = 0.0; if (fwidth(p.x) < 0.006) { float nt = mn(vec3(p.x * 70.0 + 2.0 * mott, z * 46.0, vLeafR * 31.0)); net = (1.0 - smoothstep(0.0, 0.05 + fwidth(nt) * 1.5, abs(nt - 0.5))) * (1.0 - smoothstep(0.1, 0.35, fwidth(nt))); }   // the small veins: a net between the slanting ones
    float under = gl_FrontFacing ? 0.0 : 1.0;                                 // its underside: paler, duller, its veins standing out
    vec3 c = base * (0.80 + 0.38 * mott) * (1.08 - 0.16 * z) * (1.0 - 0.14 * smoothstep(0.86, 1.0, e));
    c = mix(c, c * vec3(1.28, 1.22, 0.86) + 0.02, max(mid, max(vein * 0.6, net * 0.12)) * (1.0 + 0.5 * under));
    c = mix(c, c * vec3(1.10, 1.16, 1.02) + vec3(0.025, 0.035, 0.012), 0.6 * under);
    float old = smoothstep(0.62, 0.9, vLeafR), dry = smoothstep(0.84, 0.97, vLeafR);
    c = mix(c, vec3(0.42, 0.38, 0.07) * (0.8 + 0.4 * mott), old * smoothstep(0.5, 1.0, e + 0.35 * (mott - 0.5)) * 0.8);
    float tip = smoothstep(0.70, 0.93, z + 0.25 * (mn(vec3(p.x * 14.0, z * 9.0, vLeafR * 7.0)) - 0.5));
    c = mix(c, vec3(0.19, 0.11, 0.045) * (0.8 + 0.4 * mott), dry * tip);
    h = -mid * 0.0005 - vein * 0.0002 - net * 0.00005 + (mott - 0.5) * 0.0003; rg = -0.14 + 0.22 * mott + 0.3 * dry * tip + 0.2 * under;
    return c;
  }`,
};
function makeMatter(kind, m, { a = [0, 0, 0, 0], b = 0x000000, c = [0, 0, 0, 0] } = {}) {   // m: the material to give that finish (its colour is the glaze's, the cloth's, the metal's)
  const U = { uMA: { value: new THREE.Vector4().fromArray(a) }, uMB: { value: new THREE.Color(b) }, uMC: { value: new THREE.Vector4().fromArray(c) } };
  m.userData.matter = U; m.customProgramCacheKey = () => 'matter-' + kind;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMatP;' + (kind === 'leaf' ? '\nvarying float vLeafR;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMatP = position;' + (kind === 'leaf' ? '\n#ifdef USE_INSTANCING\n  vLeafR = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);\n#else\n  vLeafR = 0.3;\n#endif' : ''));
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + MATTER_LIB + MATTER_KIND[kind])
      .replace('#include <color_fragment>', '#include <color_fragment>\n  float mH, mR, mE; diffuseColor.rgb = matterAt(vMatP, diffuseColor.rgb, mH, mR, mE);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + mR, 0.06, 1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = matterBump(-vViewPosition, normal, mH);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= mE;');
  };
  return m;
}
// a lathe with its seam welded (no texture coordinates: the finishes above need none): profile [[radius, height], ...]
function turned(profile, segs = 48) {
  const n = profile.length, pos = new Float32Array(segs * n * 3), idx = [];
  for (let i = 0; i < segs; i++) { const a = i / segs * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); for (let j = 0; j < n; j++) pos.set([profile[j][0] * c, profile[j][1], profile[j][0] * s], (i * n + j) * 3); }
  for (let i = 0; i < segs; i++) { const i2 = (i + 1) % segs; for (let j = 0; j < n - 1; j++) { const p = i * n + j, q = i2 * n + j; idx.push(p, p + 1, q, q, p + 1, q + 1); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function smoothProfile(pts, n = 28) { return new THREE.SplineCurve(pts.map(p => new THREE.Vector2(p[0], p[1]))).getPoints(n).map(v => [Math.max(v.x, 0.0005), v.y]); }   // (a profile's few points as one curve)
// a turned shape as a hand leaves it: `oval` (not round, more so toward its top), `wave` (its wall wavers), `lean` (m a
// metre of height), `rim` (m: its top not level)
function handMade(geo, { oval = 0.012, wave = 0.004, lean = 0, rim = 0, seed = 1 } = {}) {
  const p = geo.attributes.position, r = rng(seed), ph = r() * 6.28, ph2 = r() * 6.28, la = r() * 6.28; geo.computeBoundingBox();
  const y0 = geo.boundingBox.min.y, H = geo.boundingBox.max.y - y0 || 1;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), t = (y - y0) / H;
    const k = 1 + oval * Math.cos(2 * a + ph) * t + wave * (Math.sin(3 * a + ph2 + t * 5) + 0.6 * Math.sin(5 * a - t * 7 + ph)) * (0.4 + 0.6 * t);
    p.setXYZ(i, x * k + lean * Math.cos(la) * (y - y0), y + rim * t * t * Math.sin(2 * a + ph2), z * k + lean * Math.sin(la) * (y - y0));
  }
  p.needsUpdate = true; geo.computeVertexNormals(); return geo;
}

export { handMade, makeMatter, smoothProfile, turned };
