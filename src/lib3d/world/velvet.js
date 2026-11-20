import './matter.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { rng } from '../core/utils.js';

/* ---------------------------------------------------------------- velvet
   Sheen = Charlie microfibre lobe (Estevez & Kulla 2017, KHR_materials_sheen): fibres stand along the normal,
   so velvet is dark head-on and glows at grazing angles. Low sheen roughness keeps that glow at the rim;
   the base gets high roughness and a weak specular. On top of that, procedural object-space detail:
   gathered pleats on vertical faces, soft creases + lumps on top faces, "crushed" pile patches that tilt
   the fibres (changing sheen locally), the pile's own grain (fibre tips, tufts: seen near, gone by its size on the
   screen), the strokes a hand leaves in it (clean-edged bands where the pile lies the other way: the mark of
   velvet), and baked contact AO (vertex colour) that also damps the sheen inside crevices.                                                              */
/* A cushion that gives (dent: true, and deeper and softer): where the cat lies, stands or
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
    float s = 1.0 / (1.0 + d / 0.12); grad *= h * s * s; return h * d * s;   // (bottoming out: d / (1 + d/12 cm): the lying cat's 9 cm, 5.1 deep)
  }`;
// the cover's folds round the body's hollow, as a height (metres) for the fabric's bump: radial, drawn in toward it.
// Done straight through, with no way out early (its result reaches the bump's dFdx: see velvetStroke): ~1 ms a frame less.
const DENT_FOLDS = DENT_U + `
  float dentFolds(vec3 w) {
    float h = smoothstep(uDentY - 0.12, uDentY - 0.015, w.y);
    vec2 d = w.xz - uDentB.xy, uv = vec2(dot(d, uDentA.xy), dot(d, vec2(-uDentA.y, uDentA.x))) / uDentA.zw; float q = length(uv);
    float ring = smoothstep(0.42, 0.78, q) * (1.0 - smoothstep(0.92, 1.38, q));
    float a = atan(uv.y, uv.x), ph = a * 11.0 + 1.3 * sin(a * 3.0 + 1.7) + 2.0 * q, aa = 1.0 - smoothstep(0.6, 1.5, fwidth(ph));
    return -h * ring * aa * min(1.2, max(uDentB.z, 0.0) / 0.03) * 0.0022 * pow(0.5 + 0.5 * cos(ph), 2.0);
  }`;
/* A press of the pointer on the velvet (the sofa, its pillows, the pouf): a hollow where it is held, ~13 cm across and
   up to 3 cm deep, pushed in along the surface's own way and shading as a hollow does (the normals tip into it); let go,
   the filling springs back with a small overshoot, and for some twenty seconds the pile keeps the mark, a fifth wider than the hollow (it lies the other way
   there: a paler patch in the pile's glow). ui/picking.js finds the place (softPress / softRelease), core/loop.js runs
   stepSoftPress. uPoke: where (world), how deep; uMark: where the last press was, how strong its mark still is. */
const POKE = { r: 0.0975, u: { uPoke: { value: new THREE.Vector4(0, 0, 0, 0) }, uPokeR: { value: 0.0975 }, uMark: { value: new THREE.Vector4(0, 0, 0, 0) } }, to: new THREE.Vector3(), d: 0, v: 0, held: false, live: false, on: [] };   // (w 0 to start: a Vector4 starts at w 1, a hollow 1 m deep at the origin) on: the meshes that take a press besides the sofa's own and the pouf (its loose pillows)
function softPress(p) { if (!POKE.held) { POKE.u.uPoke.value.set(p.x, p.y, p.z, POKE.u.uPoke.value.w); } POKE.to.copy(p); POKE.held = POKE.live = true; }
function softRelease() { if (!POKE.held) return; POKE.held = false; const P = POKE.u.uPoke.value; POKE.u.uMark.value.set(P.x, P.y, P.z, Math.min(1, POKE.d / 0.02)); }
function stepSoftPress(dt) {   // true while the hollow or its mark changes
  if (!POKE.live) return false;
  const P = POKE.u.uPoke.value, M = POKE.u.uMark.value, T = POKE.held ? 0.03 : 0, k = POKE.held ? 260 : 120, c = POKE.held ? 24 : 17;   // (let go: damped at 0.78 of critical, a rise of ~0.6 mm past flat, no bulge)
  for (let i = 0, n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n; i < n; i++) { POKE.v += (k * (T - POKE.d) - c * POKE.v) * h; POKE.d += POKE.v * h; }
  if (POKE.held) { const a = 1 - Math.exp(-dt * 18); P.x += (POKE.to.x - P.x) * a; P.y += (POKE.to.y - P.y) * a; P.z += (POKE.to.z - P.z) * a; M.w = 0; } else M.w *= Math.exp(-dt / 6);
  P.w = POKE.d;
  if (!POKE.held && Math.abs(POKE.d) < 2e-5 && Math.abs(POKE.v) < 2e-4 && M.w < 0.02) { POKE.d = POKE.v = P.w = M.w = 0; POKE.live = false; }
  return true;
}
function makeVelvet({ color, sheen, sheenRough = 0.6, rough = 0.95, map = null, normalMap = null, normalScale = null, ao = false, pleat = 0, crease = 0.4, allFaces = 0, crush = 1, seam = 0, freq = 1, spec = 0.1, sheenAmt = 0.8, dent = false, nap = false, wear = false, aoSharp = false, edge = false, broad = false }) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0, sheen: sheenAmt, sheenColor: new THREE.Color(sheen), sheenRoughness: sheenRough, specularIntensity: spec, side: THREE.DoubleSide, vertexColors: ao });
  if (nap || wear) m.defines = Object.assign(m.defines || {}, nap || wear ? { VELVET_NAP: '' } : {}, wear ? { VELVET_WEAR: '' } : {});
  if (aoSharp) m.defines = Object.assign(m.defines || {}, { VELVET_AO_SHARP: '' });
  if (pleat) m.defines = Object.assign(m.defines || {}, { VELVET_PLEAT: '' });
  if (broad) m.defines = Object.assign(m.defines || {}, { VELVET_BROAD: '' });   // (its geometry carries aBroadN: its normal without the folds)
  if (edge) m.defines = Object.assign(m.defines || {}, { VELVET_EDGE: '' });   // (dark lines along its own folded edges)   // (its vertex colour: red the shade, green the folds' alone)   // (its geometry carries aCB, aCY: setNap)
  if (map) m.map = map; if (normalMap) { m.normalMap = normalMap; if (normalScale) m.normalScale.copy(normalScale); }
  m.defines = Object.assign(m.defines || {}, { PET_SHADE: '' });   // (the cat's shade falls on it: core/bake.js)
  const U = { uPleat: { value: pleat }, uCrease: { value: crease }, uAll: { value: allFaces }, uCrush: { value: crush }, uSeam: { value: seam }, uFreq: { value: freq } };
  m.userData.velvet = U;
  if (dent) m.customProgramCacheKey = () => 'velvet-dent';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, POKE.u);
    // the pointer's hollow: the surface pushed in along its own normal, by (1 - q²)² of the depth out to its edge (the shading
    // of the slope is the fragment shader's)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 uPoke; uniform float uPokeR; varying vec3 vPokeW; vec3 pokeMove;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { mat3 mm = mat3(modelMatrix); vec3 w0 = (modelMatrix * vec4(position, 1.0)).xyz, dv = w0 - uPoke.xyz, wn = normalize(mm * objectNormal); vPokeW = w0;
          float k = max(0.0, 1.0 - dot(dv, dv) / (uPokeR * uPokeR)); pokeMove = inverse(mm) * (-wn * uPoke.w * k * k); }`)
      .replace('#include <project_vertex>', 'transformed += pokeMove;\n#include <project_vertex>');
    // folds finer than a pixel: the normal leans to the broad one (VELVET_BROAD), by how wide a pixel is on the surface there
    // (metres along it: the step from one pixel to the next over how squarely it faces the eye); the folds' shade (the vertex
    // colour) stays. Smooth in the view, so nothing jumps as it moves: the pile's glow, summed per triangle where the
    // triangles were under a pixel, flickered on the pouf's far slopes
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n#ifdef VELVET_BROAD\nattribute vec3 aBroadN; varying vec3 vBroadN;\n#endif')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n#ifdef VELVET_BROAD\nvBroadN = normalMatrix * aBroadN;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      #ifdef VELVET_BROAD
      { vec3 nB = normalize(vBroadN) * faceDirection; float fp = length(fwidth(vPokeW)) / max(abs(dot(nB, normalize(vViewPosition))), 0.08);
        normal = normalize(mix(normal, nB, smoothstep(BROAD_LO, BROAD_HI, fp))); }
      #endif`).replace('#include <common>', '#include <common>\n#ifdef VELVET_BROAD\nvarying vec3 vBroadN;\n#define BROAD_LO 0.005\n#define BROAD_HI 0.016\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uMark, uPoke; uniform float uPokeR; varying vec3 vPokeW;');
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjP;\nvarying vec3 vObjN;\n#ifdef VELVET_NAP\nattribute vec4 aCB; attribute vec3 aCY; varying vec4 vCB; varying vec3 vCY;\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position;\nvObjN = objectNormal;\n#ifdef VELVET_NAP\nvCB = aCB; vCY = aCY;\n#endif');
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
        float top = mix(smoothstep(0.45, 0.9, n.y), 1.0, uAll), pleats = 0.0;
        #ifdef VELVET_PLEAT
        {   // (only for a velvet that has them, pleat > 0: none of the room's does now, and their two noises are a quarter of what this fabric costs)
          float side = smoothstep(0.06, 0.42, 1.0 - abs(n.y));
          // gathered pleats on the vertical faces: they run vertically, spaced along the dominant horizontal axis
          float u = mix(q.x, q.z, smoothstep(0.35, 0.65, abs(n.x)));
          float w = vfbm(q * vec3(3.0, 1.2, 3.0)) * 2.6;
          float ph = u * 34.0 + w * 2.0 + q.y * 2.0;
          // frequency clamp: once a pleat period shrinks towards a pixel (grazing view, distance) fade it out
          float aaP = 1.0 - smoothstep(0.5, 1.4, fwidth(ph));
          pleats = uPleat * side * 0.012 * -pow(0.5 + 0.5 * cos(ph), 3.0) * smoothstep(0.12, 0.6, vfbm(q * vec3(5.0, 1.6, 5.0) + 7.0)) * aaP;
        }
        #endif
        // soft creases where a warped noise field crosses zero, plus broad lumps of the filling
        float f = vfbm(q * 2.6 + vec3(vfbm(q * 1.3) * 1.4)) * 2.0 - 1.0;
        float aaC = 1.0 - smoothstep(0.03, 0.09, fwidth(f));
        float crease = -exp(-f * f * 30.0) * aaC, lump = vfbm(q * 1.8 + 3.0) - 0.5;
        // welt cord (piping) where the rounded edge turns from the top/bottom panel into the boxing strip
        float sn = (abs(n.y) - 0.74) / 0.05, cord = exp(-sn * sn) - 0.55 * exp(-pow((abs(n.y) - 0.62) / 0.05, 2.0));
        return pleats + uCrease * top * (crease * 0.003 + lump * 0.005) + uSeam * cord * 0.0025;
      }
      #ifdef VELVET_NAP
        varying vec4 vCB; varying vec3 vCY;   // its part's box (object space): centre x, z, half x, z; foot y, top y; the nap's lie
      #endif
      float vWorn;
      #ifdef VELVET_WEAR
      // a seat cushion as it is after use (Maverick Frame's furniture CGI notes; velvet makers' care guides): a shallow dish
      // where one sits, a little forward of the middle, its pile crushed (so its sheen changes); under the front welt a
      // soft roll where the front gives; and at the top corners, where the cover turns round them, a fan of small folds
      float wearH(vec3 p, vec3 n) {
        vec2 hs = max(vCB.zw, vec2(1e-3)), l = (p.xz - vCB.xy) / hs;   // -1..1 across it (y: toward its front)
        float H = max(vCY.y - vCY.x, 1e-3), ly = (p.y - vCY.x) / H, h = 0.0;
        float top = smoothstep(0.55, 0.85, n.y), front = smoothstep(0.55, 0.85, n.z), side = smoothstep(0.55, 0.85, abs(n.x));
        vec2 q = (l - vec2(0.0, 0.12)) / vec2(0.66, 0.6); float q2 = dot(q, q), k = max(0.0, 1.0 - q2);
        float wob = vn3(p * 7.0) - 0.5;
        h -= top * k * k * 0.011 * (1.0 + 0.3 * wob);
        vWorn = top * smoothstep(1.0, 0.25, sqrt(q2)) * (0.75 + 0.5 * vn3(p * 11.0 + 4.0));
        float ax = 1.0 - smoothstep(0.55, 0.92, abs(l.x));
        h += front * ax * (exp(-pow((ly - 0.84) / 0.035, 2.0)) - 0.6 * exp(-pow((ly - 0.75) / 0.03, 2.0))) * 0.0045 * (0.7 + 0.6 * vn3(p * 9.0));
        h += (front + side) * 0.0015 * (vfbm(p * vec3(3.0, 26.0, 3.0)) - 0.5) * smoothstep(0.1, 0.35, ly);   // (and a little slack: soft folds across it, uneven)
        // the fans: from each top corner of the front, on the front and on the sides, gone within ~11 cm
        vec2 cf = vec2(hs.x - abs(p.x - vCB.x), vCY.y - p.y), cs = vec2(hs.y - (p.z - vCB.y), vCY.y - p.y);
        float rf = length(cf), rs = length(cs), wf = 2.0 * vn3(p * 13.0);
        float fanF = cos(atan(cf.y, max(cf.x, 1e-4)) * 10.0 + wf) * exp(-rf * rf / 0.011) * smoothstep(0.004, 0.03, rf);
        float fanS = cos(atan(cs.y, max(cs.x, 1e-4)) * 10.0 + wf) * exp(-rs * rs / 0.011) * smoothstep(0.004, 0.03, rs);
        return h + (front * fanF + side * fanS) * 0.003;
      }
      #endif
      float vCav, vHt;
      float vCrush, vNap, vPile, vMot;
      // the strokes a hand leaves: one from most squares of a 30 cm grid over the face (q: metres on it), each a band a few
      // centimetres wide and a hand or two long, a little bowed, lying its own way; inside it the pile lies against the
      // rest (+) or flatter with it (-). Its long edges are clean (and not ruled), its two ends ease out. e: the width its
      // edge is drawn with (m). No branch in any of this (nor in the pile's grain below): a branch whose result reaches
      // the bump's dFdx costs ~2.5 ms a frame on the sofa here, the same sums done straight through ~0.4 ms.
      float velvetStroke(vec2 q, vec2 c, float e) {
        float r1 = vh31(vec3(c, 1.7)), r2 = vh31(vec3(c, 5.3)), r3 = vh31(vec3(c, 9.1)), r4 = vh31(vec3(c, 13.9)), a = r3 * 6.2832;
        vec2 d = q - (c + 0.5 + 0.7 * (vec2(r1, r2) - 0.5)) * 0.3, cs = vec2(cos(a), sin(a));
        float u = dot(d, cs), t = clamp(abs(u) / (0.09 + 0.12 * r1), 0.0, 1.0), w = (0.018 + 0.035 * r2) * (1.0 - 0.55 * t * t);
        float v = dot(d, vec2(-cs.y, cs.x)) + (r4 - 0.36) * 2.4 * u * u + 0.002 * sin(u * 63.0 + r1 * 40.0) + 0.0014 * sin(u * 151.0 + r2 * 30.0);
        return (1.0 - smoothstep(w - e, w + 3.0 * e, abs(v))) * (1.0 - smoothstep(0.5, 1.0, t)) * mix(-0.28, 0.34, step(0.45, r2)) * (0.6 + 0.4 * r3) * step(r4, 0.72);   // (r4 > 0.72: no hand has been here)
      }
      float velvetStrokes(vec2 q, float px) {   // px: a pixel's size there (m); past ~1 cm they are too far to tell: none
        vec2 c = floor(q / 0.3 - 0.5); float e = max(px * 1.2, 0.0015);
        return clamp(velvetStroke(q, c, e) + velvetStroke(q, c + vec2(1.0, 0.0), e) + velvetStroke(q, c + vec2(0.0, 1.0), e) + velvetStroke(q, c + 1.0, e), -0.5, 0.5) * (1.0 - smoothstep(0.004, 0.012, px));
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #if defined(VELVET_AO_SHARP) && defined(USE_COLOR)
        {   // the folds drawn crisp (folds and dark gaps not blurred): the shade, smooth across the triangles,
            // cut at a level into a clean-edged dark (its edge a pixel wide), a little of its depth kept inside and out
          vec3 vc = max(vColor.rgb, vec3(0.03)); diffuseColor.rgb /= vc;
          float a = vColor.g, k = vColor.r / max(vColor.g, 0.03), w = max(fwidth(a), 0.004);
          float edge = smoothstep(0.66 - w, 0.66 + w, a), a2 = mix(min(a, 0.66) * 0.82, 1.0 - (1.0 - a) * 0.45, edge);   // (only the deep part: thin lines)
          diffuseColor.rgb *= a2 * k;
        }
        #endif
        vCrush = smoothstep(0.28, 0.72, vfbm(vObjP * uFreq * 5.0 + 11.0));
        {
          vWorn = 0.0;
          float hF = fabricH(vObjP, normalize(vObjN) * (gl_FrontFacing ? 1.0 : -1.0));
          #ifdef VELVET_WEAR
            hF += wearH(vObjP, normalize(vObjN) * (gl_FrontFacing ? 1.0 : -1.0));
            vCrush = mix(vCrush, 0.82 + 0.18 * vfbm(vObjP * 16.0), 0.8 * vWorn);   // (the pile pressed flat where one sits)
          #endif
          // the pile itself, seen near (in metres on the thing): the fibres' tips as a fine grain, the tufts they stand in a
          // little coarser; each gone once it is finer than the picture's pixels
          float vS = length(modelMatrix[0].xyz); vec3 pm = vObjP * vS, nO = normalize(vObjN);
          float fwP = max(fwidth(pm.x), max(fwidth(pm.y), fwidth(pm.z))), a1 = 1.0 - smoothstep(0.3, 0.9, fwP * 1700.0), a2 = 1.0 - smoothstep(0.3, 0.9, fwP * 480.0);
          float g1 = mix(0.5, vn3(pm * 1700.0), a1), g2 = mix(0.5, vn3(pm * 480.0 + 7.0), a2);
          vPile = 0.55 * g1 + 0.45 * g2;
          float a3 = 1.0 - smoothstep(0.3, 0.9, fwP * 110.0); vMot = mix(0.5, 0.6 * vn3(pm * 110.0 + 3.0) + 0.4 * vn3(pm * 37.0 + 9.0), a3);   // (and never quite one way from tuft to tuft: a mottle of half a centimetre and more)
          // where a hand or a sleeve has gone over it the pile lies the other way: strokes a finger or two wide with clean
          // edges, running one way within a patch and another in the next, here and there (not all over)
          vec2 uvS = abs(nO.y) > 0.6 ? pm.xz : (abs(nO.x) > abs(nO.z) ? pm.zy : pm.xy);
          vNap = velvetStrokes(uvS, fwP) * uCrush + 0.8 * uMark.w * (1.0 - smoothstep(0.25, 1.0, length(vPokeW - uMark.xyz) / (1.2 * uPokeR)));   // (and where a finger has just pressed)
          // crushed pile: a gentle undulation whose slope tilts the fibres in patches
          float hC = (vfbm(vObjP * uFreq * 3.0 + 1.3) - 0.5) * 0.012 * uCrush * (0.4 + vCrush) + ((vPile - 0.5) * 0.0003 - vNap * 0.0005) / vS;
          vHt = (hF + hC) * length(modelMatrix[0].xyz);           // metres in world space
          vCav = clamp(1.0 + hF * 30.0, 0.55, 1.0);                // fold valleys hold shadow
          ${dent ? 'vHt += dentFolds(vDentW); vCav *= 1.0 - 0.16 * smoothstep(0.0, 0.035, vDentD);   // (the cover drawn in round the cat; the hollow\'s floor a little in shadow)' : ''}
        }
        diffuseColor.rgb *= mix(0.94, 1.05, vCrush * uCrush + (1.0 - uCrush) * 0.5) * vCav * (1.0 + 0.05 * vWorn) * (1.0 + 0.26 * (vPile - 0.5) + 0.2 * vNap + 0.11 * (vMot - 0.5));
        #ifdef VELVET_NAP
          diffuseColor.rgb *= mix(1.0, vCY.z, 0.3);   // (each module's pile lies its own way: a shade lighter or darker)
        #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { // the pointer's hollow shades as one: the normal tips into it by the hollow's own slope (per pixel, so a coarse
          // cushion shows it as well as the fine pouf), and its floor sits a little in shade
          vec3 dv = vPokeW - uPoke.xyz; float pk = max(0.0, 1.0 - dot(dv, dv) / (uPokeR * uPokeR));
          vec3 pg = (viewMatrix * vec4(-4.0 * uPoke.w * pk * dv / (uPokeR * uPokeR), 0.0)).xyz; pg -= normal * dot(normal, pg);
          normal = normalize(normal + pg); diffuseColor.rgb *= 1.0 - 9.0 * uPoke.w * pk * pk; }
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
          material.sheenColor *= mix(0.78, 1.16, vCrush * uCrush + (1.0 - uCrush) * 0.5) * vCav * vCav * (1.0 + 1.1 * vNap) * (0.7 + 0.6 * vPile) * (0.68 + 0.64 * vMot);   // (the strokes show most in the pile's glow; its grain glints; the mottle breaks the glow up, as no smooth cloth's is)
          #ifdef VELVET_NAP
            material.sheenColor *= vCY.z;
          #endif
          #ifdef USE_COLOR
            material.sheenColor *= vColor.r;
          #endif
        #endif`)
      .replace('#include <opaque_fragment>', `
        #ifdef VELVET_AO_SHARP
          // (the pouf's base, turned down to the floor in its own shade, keeps little of the pile's grazing glow, which is summed
          // in here: lit as if open to the room's sky and bounce, it showed as a pale yellow band all round below the seam, a faulty shadow)
          outgoingLight = mix(outgoingLight, totalDiffuse + totalSpecular + totalEmissiveRadiance, 0.8 * smoothstep(0.15, 0.6, -inverseTransformDirection(normal, viewMatrix).y));
        #endif
        #include <opaque_fragment>`);
  };
  if (edge) { const ob = m.onBeforeCompile; m.onBeforeCompile = (sh, r) => { ob(sh, r);
    // its outline (the arm's two upright edges, where it meets what lies behind it), over its lit colour (the sheen is
    // brightest just there): where its rounded surface turns away from the eye, a crisp dark line
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      { float tE = abs(dot(normalize(vNormal), normalize(vViewPosition))), wE = fwidth(tE) * 1.2 + 0.006;
        gl_FragColor.rgb *= 1.0 - 0.85 * (1.0 - smoothstep(0.24 - wE, 0.24 + wE, tE)); }`); }; }
  return m;
}
/* a sofa part's box (object space) and the lie of its pile, on every vertex: the velvet's nap (and a seat's wear) read
   them (aCB: centre x, z, half x, z; aCY: foot y, top y, nap ~0.9-1.1) */
function setNap(g, nap) {
  g.computeBoundingBox(); const b = g.boundingBox, n = g.attributes.position.count, cb = new Float32Array(n * 4), cy = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { cb.set([(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, (b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2], i * 4); cy.set([b.min.y, b.max.y, nap], i * 3); }
  g.setAttribute('aCB', new THREE.BufferAttribute(cb, 4)); g.setAttribute('aCY', new THREE.BufferAttribute(cy, 3));
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

/* ---- a fluffy pile over the sofa's velvet: shells of the part itself (FLUFF.n
   copies in one instanced draw, each pushed out along the skin's normal a little further, ~6 mm in all), keeping only where a
   tuft of strands reaches: strands ~2.5 mm apart in the part's own space (its 3D cells, so no texture seams), grouped in tufts
   of ~1 cm, each tuft of its own height, each strand leaning its own way; the roots in the pile's shade. Its colour and its
   picture are the velvet's own (the same Color: darkened with it). It casts no shadow. Blended over the velvet, not writing depth,
   its layers drawn inside out (as the cat's fur): cut out pixel by pixel (a dither) it crawled as the view moved
   (glitching on the sofa); where strands get under ~half a pixel it keeps its mean cover. */
// (not used since the pile was taken off the pouf and the sofa; kept for a pile again)
const FLUFF = { n: 6, len: 0.0042, cell: 0.0025 };   // (6 mm, then 30 % shorter; 8 layers, then 6: lighter to draw)
function sofaFluff(part) {
  const v = part.material, mat = new THREE.MeshLambertMaterial({ color: v.color, map: v.map, transparent: true, depthWrite: false });   // (matte: Lambert, cheaper than the standard shading over six layers)
  mat.customProgramCacheKey = () => 'sofa-fluff';
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vFl; varying vec3 vFb;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float os = length(modelMatrix[0].xyz); vFl = (float(gl_InstanceID) + 1.0) / ${FLUFF.n.toFixed(1)}; vFb = position * os;
        transformed += normalize(objectNormal) * vFl * ${FLUFF.len.toFixed(4)} / os;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying float vFl; varying vec3 vFb;
        float flH(vec3 p) { p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 c = vFb / ${FLUFF.cell.toFixed(4)}, id = floor(c), f = fract(c) - 0.5;
          float tuft = 0.4 + 0.6 * flH(floor(c / 4.0) + 3.1), h = (0.35 + 0.65 * flH(id)) * tuft;
          vec3 lean = (vec3(flH(id + 5.2), flH(id + 9.4), flH(id + 1.7)) - 0.5) * 0.8 * vFl;
          float r = 0.62 * (1.0 - vFl / h), d = length(f - (vec3(flH(id + 17.3), flH(id + 41.7), flH(id + 23.9)) - 0.5) * 0.3 - lean);
          float aw = fwidth(d) + 1e-4, exact = vFl < h ? 1.0 - smoothstep(r - aw, r + aw, d) : 0.0, sh = clamp(vFl / tuft, 0.0, 1.0), avg = clamp(1.1 * (1.0 - sh) * (1.0 - sh), 0.0, 1.0);
          float px = length(fwidth(c)), cover = mix(exact, avg, smoothstep(0.3, 0.9, px));
          if (cover < 0.01) discard;
          diffuseColor.rgb *= mix(0.55, 1.06, vFl); diffuseColor.a = cover;   // the roots in the pile's shade, the tips in the light
        }`);
  };
  const fl = new THREE.InstancedMesh(part.geometry, mat, FLUFF.n); fl.frustumCulled = false; fl.receiveShadow = true; fl.castShadow = false; fl.name = part.name + '_fluff'; fl.renderOrder = 1;
  for (let k = 0; k < FLUFF.n; k++) fl.setMatrixAt(k, new THREE.Matrix4());
  part.add(fl); return fl;
}

export { FLUFF, POKE, SOFT, bolsterGeometry, makeVelvet, setNap, softPress, softRelease, sofaFluff, stepSoftPress };
