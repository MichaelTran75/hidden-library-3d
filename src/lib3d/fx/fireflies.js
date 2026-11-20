import './sky.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { R } from '../core/base.js';
import { rng } from '../core/utils.js';
import { lerp } from './night.js';
import { OVER } from '../ui/words.js';
import { DOF, DOF_GLSL } from './post.js';
import { camera } from '../core/renderer.js';

/* ---- fireflies: from dusk on, three drift through the room and seven through the garden outside, and flash, drawn sharp over the picture like the stars
   (the paint pass would smear points this small) and hidden behind whatever the room puts in front of them. Each one
   wanders slowly around its own spot (three unrelated sways, so no two paths repeat together) and flashes on its own
   beat: a ~0.7 s yellow-green pulse every 3 to 7 s, with a dimmer glow in between. They come out as the sun goes under
   the trees (3° to −5°). All the motion is in the vertex shader: nothing on the CPU per frame. The three in the room light what is near them (FLY.glow):
   a camera-facing square round each, 1.2 m its reach, which reads the room's depth under it, finds the point of the
   room seen there (its view-space place, through the camera's inverse projection) and its facing (from the depth's slope),
   and adds the firefly's yellow-green there, by the inverse square of the distance and fading to nothing at its reach:
   a cushion or the floor under one brightens as it flashes, as a lamp's light would. */
// where a firefly is (it wanders round its spot) and how bright it is (its flash): shared by the points and their glow
const FLY_GLSL = `
  vec3 flyAt(vec3 home, vec4 sw, float time) { float t = time + sw.w, k = 0.6 + 0.4 * fract(sw.w * 7.13);
    return home + vec3(sin(t * 0.23 * k) + 0.45 * sin(t * 0.61 + 1.3), sin(t * 0.37 * k + 2.0) + 0.35 * sin(t * 1.7), sin(t * 0.17 * k + 4.0) + 0.4 * cos(t * 0.53)) * sw.xyz; }
  float flyFlash(vec3 bt, float time) { float ph = fract((time + bt.y) / bt.x); return smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.05, 0.05 + 0.7 / bt.x, ph)); }`;
const FLY = { u: { value: 0 }, t: { value: 0 }, rain: { value: 0 }, pts: null, glow: null, on: false };   // (rain: how hard it rains; those outside keep in: fx/rain.js)
function buildFireflies() {
  const n = 22, inside = 3, home = new Float32Array(n * 3), sway = new Float32Array(n * 4), beat = new Float32Array(n * 3), r = rng(77);
  for (let i = 0; i < n; i++) {
    if (i < inside) {   // three in the room: over the sofa, the rug and the floor by the deck, under eye height
      home.set([[0.2, 1.1, 0.95][i], [1.1, 0.7, 1.3][i], [-6.9, -3.6, -5.0][i]], i * 3);
      sway.set([0.6 + r() * 0.3, 0.2 + r() * 0.15, 0.8 + r() * 0.4, r() * 100], i * 4);   // reach x, y, z (m), phase (wide, toward and away from the eye too)
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
  // fewer than were placed (30 % fewer, then 30 % fewer again): the room's three, four of the eleven
  // by the glass, three of the eight in the trees; the ones kept stay where they were
  const kept = [...Array(n).keys()].filter(i => i < inside || (i < inside + 11 ? i < inside + 4 : i < inside + 11 + 3));
  const pick = (a, k) => Float32Array.from(kept.flatMap(i => Array.from(a.subarray(i * k, i * k + k))));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pick(home, 3), 3)); g.setAttribute('aSway', new THREE.BufferAttribute(pick(sway, 4), 4)); g.setAttribute('aBeat', new THREE.BufferAttribute(pick(beat, 3), 3));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uPR: OVER.u.uPR, uTime: FLY.t, uOn: FLY.u, uRain: FLY.rain, uFocus: DOF.focus },
    vertexShader: `attribute vec4 aSway; attribute vec3 aBeat; uniform float uTime, uOn, uRain, uPR; uniform vec2 uRes; varying float vB, vBl, vIn; ${DOF_GLSL} ${FLY_GLSL}
      void main(){ vec3 p = flyAt(position, aSway, uTime);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float flash = flyFlash(aBeat, uTime);
        vB = (0.3 + 0.9 * flash) * uOn * (1.0 - uRain * (1.0 - step(-1.25, position.x) * step(-8.6, position.z)));   // (out in the rain: none)
        vIn = step(-1.25, position.x) * step(-8.6, position.z); vB *= 1.0 - 0.5 * vIn;   // (in the room: half as bright, its halo half again)
        float s = clamp(0.22 * aBeat.z * projectionMatrix[1][1] * 0.5 * uRes.y / -mv.z, 6.0, 90.0), b = 2.0 * dofCoc(-mv.z) * uPR, S = min(s + b, 160.0);
        // out of focus (fx/post.js DOF): a disc as wide as the lens's circle, its light spread over it (a little kept: a bright point's disc stays in sight)
        vBl = smoothstep(0.0, 1.0, b / s); vB *= mix(1.0, 0.75 * s / S, vBl); gl_PointSize = S; }`,
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; varying float vB, vBl, vIn;
      void main(){ if (gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 4e-6) discard;
        float d = length(gl_PointCoord - 0.5) * 2.0, core = smoothstep(0.16, 0.03, d), halo = pow(max(1.0 - d, 0.0), 3.0);
        float disc = smoothstep(1.0, 0.84, d) * (0.8 + 0.2 * smoothstep(0.5, 0.95, d));   // (a soft disc, a touch brighter at its rim, as a lens draws one)
        float a = mix(core + (0.7 - 0.35 * vIn) * halo, disc, vBl) * vB; if (a < 0.004) discard;
        gl_FragColor = vec4(mix(mix(vec3(0.62, 0.95, 0.22), vec3(1.0, 1.0, 0.78), core), vec3(0.78, 0.97, 0.45), vBl) * a, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
  pts.frustumCulled = false; pts.visible = false; OVER.scene.add(pts); FLY.pts = pts;
  // the light the room's three throw on what is near them
  const RG = 1.2, gg = new THREE.InstancedBufferGeometry(), sq = new THREE.PlaneGeometry(2, 2);
  gg.setIndex(sq.index); gg.setAttribute('position', sq.attributes.position); gg.instanceCount = inside;
  gg.setAttribute('iHome', new THREE.InstancedBufferAttribute(home.slice(0, inside * 3), 3)); gg.setAttribute('iSway', new THREE.InstancedBufferAttribute(sway.slice(0, inside * 4), 4));
  gg.setAttribute('iBeat', new THREE.InstancedBufferAttribute(beat.slice(0, inside * 3), 3));
  const glow = new THREE.Mesh(gg, new THREE.ShaderMaterial({
    uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uTime: FLY.t, uOn: FLY.u, uPInv: { value: camera.projectionMatrixInverse } },
    vertexShader: `attribute vec3 iHome, iBeat; attribute vec4 iSway; uniform float uTime, uOn; varying vec3 vC; varying float vB; ${FLY_GLSL}
      void main(){ vec4 c = modelViewMatrix * vec4(flyAt(iHome, iSway, uTime), 1.0); vC = c.xyz;
        vB = 0.25 * (0.3 + 0.9 * flyFlash(iBeat, uTime)) * uOn;   // (the room's three: their light on the room a quarter of what it was)
        gl_Position = projectionMatrix * vec4(c.xy + position.xy * ${RG.toFixed(2)}, c.z, 1.0); }`,
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; uniform mat4 uPInv; varying vec3 vC; varying float vB;
      void main(){ vec2 uv = gl_FragCoord.xy / uRes; float z = texture2D(uDepth, uv).r; if (z >= 1.0) discard;
        vec4 v = uPInv * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); vec3 P = v.xyz / v.w, L = vC - P;
        float d2 = dot(L, L), reach = 1.0 - d2 / ${(RG * RG).toFixed(3)}; if (reach <= 0.0) discard;
        vec3 N = normalize(cross(dFdx(P), dFdy(P))); if (dot(N, P) > 0.0) N = -N;   // (the surface's facing, toward the eye)
        float lam = 0.25 + 0.75 * max(dot(N, L * inversesqrt(d2 + 1e-6)), 0.0);
        float a = min(0.45, vB * reach * reach * lam * 0.25 / (d2 + 0.01)); if (a < 0.002) discard;
        gl_FragColor = vec4(vec3(0.62, 0.95, 0.22) * a, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
  glow.frustumCulled = false; glow.visible = false; OVER.scene.add(glow); FLY.glow = glow;
}

export { FLY, buildFireflies };
