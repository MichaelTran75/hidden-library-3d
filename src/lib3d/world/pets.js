import './fur.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CANVAS, reduceMotion } from '../core/base.js';
import { canvas, ctex } from '../core/utils.js';
import { camera, renderer, scene, setShadowsDirty } from '../core/renderer.js';
import { room } from './room.js';
import { outside } from './outside.js';
import { PAINT_GLSL, POST, QUAD_VS, paintUniforms, setPaint } from '../fx/post.js';
import { HOUR } from '../fx/hour.js';
import { OVER } from '../ui/words.js';
import { HERO, heroKey } from '../ui/hero-books.js';
import { DECKR } from '../ui/deck.js';
import { REVEAL, clock, on, setNeeds } from '../core/loop.js';
import { CATR, CGAIT, catAxis, catGait, catKeep, catLook, catReach, catSnap, catStride, catTail, catToward, catTurn, rigCat } from './cat.js';
import { FUR, furComb, furCoat, furLight } from './fur.js';
import { SOFT } from './velvet.js';

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
const CAT_SPOT = { day: { x: -0.82, z: -5.02, yaw: -Math.PI / 2 - 0.12, sink: 0 }, night: { x: 1.62, z: -6.1, yaw: -1.83, sink: 0.026 } };   // (night: into the ~3 cm hollow it makes)   // (asleep on its side, its face and paws toward the room)
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
  const out = !!P.outline;   // (the 747 on the shelf: its selection outline when the pointer is on it, and its fade in: b747.js)
  P.quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { t: { value: null }, uScale: { value: new THREE.Vector2(1, 1) }, uPaint: { value: P.paint }, uWash: { value: P.wash || 0 }, uToneK: { value: P.toneK }, ...SHARP.u, ...paintUniforms(),
      ...(out ? { uOut: { value: 0 }, uOutW: { value: 4 }, uHalo: { value: 3 }, uFade: { value: 1 } } : {}) },
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, vertexShader: QUAD_VS,
    fragmentShader: `uniform sampler2D t; uniform vec2 uScale; uniform float uExp, uLift, uVeil, uPaint, uWash, uToneK; varying vec2 vUv;${out ? ' uniform float uOut, uOutW, uHalo, uFade;' : ''}
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
      ${out ? `float aAt(vec2 p){ return (p.x < 0.0 || p.y < 0.0 || p.x > uScale.x || p.y > uScale.y) ? 0.0 : texture2D(t, p).a; }` : ''}
      void main(){ vec2 uv = vUv * uScale; vec4 o = shadeAt(uv); if (uWash > 0.001) o = mix(o, washAt(uv, o), uWash); if (uPaint > 0.001) { float det; vec4 pt = paintAt(uv, det); o = mix(o, pt, uPaint * (1.0 - 0.45 * smoothstep(0.004, 0.04, det))); }   // (busy detail kept crisper)
        ${out ? `vec4 res = vec4(o.rgb * o.a, o.a);
        if (uOut > 0.001) {   // the outline: where the picture is near (within uOutW pixels) but not here, white; just beyond that a soft dark edge
          float near = 0.0, far = 0.0, here = aAt(uv);
          for (int i = 0; i < 24; i++) { float an = 6.2831853 * (float(i) + 0.5) / 24.0; vec2 d = vec2(cos(an), sin(an)) * uTexel;
            near = max(near, max(aAt(uv + d * uOutW), aAt(uv + d * uOutW * 0.5))); far = max(far, aAt(uv + d * (uOutW + uHalo))); }
          float w = smoothstep(0.2, 0.6, near) * (1.0 - smoothstep(0.3, 0.8, here)) * 0.95 * uOut, h = smoothstep(0.1, 0.6, far) * (1.0 - here) * 0.55 * uOut;
          vec4 ring = vec4(vec3(w), w); ring += vec4(vec3(0.08, 0.055, 0.03) * h, h) * (1.0 - ring.a); res += ring * (1.0 - res.a);
        }
        res *= uFade; if (res.a < 0.002) discard; gl_FragColor = res; }` : `if (o.a < 0.002) discard; gl_FragColor = vec4(o.rgb * o.a, o.a); }`}` }));
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
    if (lying) { goal = 0.03; if (/curl|nest/.test(pose)) ra = rb = 0.206; else if (pose === 'side') { ra = len / 2 + 0.154; rb = 0.157; } else { ra = len / 2 + 0.121; rb = 0.145; } }   // (the cat 10 % larger, twice: G, 17/10/2026)
    else if (sitting) { goal = 0.026; x = _dh.x; z = _dh.z; ra = rb = 0.145; }
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
  const pad = P.pad || 8;
  x0 = Math.max(0, Math.floor(x0) - pad); y0 = Math.max(0, Math.floor(y0) - pad); x1 = Math.min(W_, Math.ceil(x1) + pad); y1 = Math.min(H, Math.ceil(y1) + pad);   // (room for the paint's strokes, and an outline's)
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

export { PETS, SHARP, crispPass, crispPatch, drawPets, drawSharpBooks, loadPets, petsForHour, setHenAway, sharpQuad };
