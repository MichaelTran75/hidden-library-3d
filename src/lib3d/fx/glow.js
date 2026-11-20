import './fireflies.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { OVER } from '../ui/words.js';
import { rng } from '../core/utils.js';
import { camera } from '../core/renderer.js';
import { LIGHTS } from '../world/lights.js';
import { CELLS } from '../world/shelves.js';

/* ---- the bulb over the sofa, glowing. Drawn sharp over the
   picture like the fireflies: the room is painted only when something in it changes, and this goes with the sharp
   layer, 30 times a second. A quad facing the eye at the bulb's glass, pulled 7 cm toward the eye so the glass does not
   hide it, and hidden behind whatever the room puts in front of it. Its light breathes slowly (two slow waves, 3.8 s
   and 6.1 s, so it never quite repeats) and shimmers a very little: a warm core in an amber halo, in a wider bloom that
   swells more with the breath; just enough of it: the ring round the bulb
   about a quarter brighter than the painting has it, give or take a tenth with the breath, its glass not blown white.
   On only while the bulb is (fx/hour.js: the pendant's glow). */
const BULB = { mesh: null, on: { value: 0 }, t: { value: 0 }, at: { value: new THREE.Vector3() }, size: { value: 0.508 } };   // (10 % larger with the bulb, twice)
function buildBulbGlow(at) {
  BULB.at.value.copy(at);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uAt: BULB.at, uSize: BULB.size, uOn: BULB.on, uTime: BULB.t },
    vertexShader: `uniform vec3 uAt; uniform float uSize; varying vec2 vQ;
      void main(){ vec4 c = viewMatrix * vec4(uAt, 1.0); c.xyz += normalize(-c.xyz) * 0.07; vQ = position.xy;
        gl_Position = projectionMatrix * vec4(c.xy + position.xy * uSize, c.z, 1.0); }`,
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uOn, uTime; varying vec2 vQ;
      void main(){ if (gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 4e-6) discard;
        float t = uTime, b = 0.5 + 0.5 * (0.62 * sin(t * 1.653) + 0.38 * sin(t * 1.03 + 1.3));              // the breath, 0..1
        float s = 1.0 + 0.03 * sin(t * 23.0) * sin(t * 7.1 + 0.4) + 0.015 * sin(t * 41.3);                     // the shimmer
        float q = length(vQ), r = q / (0.92 + 0.08 * b);
        float core = exp(-r * r / 0.010), halo = 0.2 * exp(-r * r / 0.07), bloom = 0.07 * exp(-r * r / 0.35) * (0.6 + 0.8 * b);
        vec3 col = vec3(1.0, 0.93, 0.8) * core * 0.18 + vec3(1.0, 0.74, 0.42) * halo * (0.75 + 0.4 * b) + vec3(1.0, 0.62, 0.3) * bloom;
        col *= s * uOn * smoothstep(1.0, 0.85, q); if (max(col.r, max(col.g, col.b)) < 0.002) discard;
        gl_FragColor = vec4(col, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
  m.frustumCulled = false; m.visible = false; OVER.scene.add(m); BULB.mesh = m;
}

/* ---- under the pointer the bulb over the sofa glows half as bright again
   (then its glow over twice the area): its glow, its filament and its
   glass, eased in and out (~0.25 s); the light it casts on the room stays as it is.
   The hour sets their strength (fx/hour.js: the pendant's light, 40 at full); this goes over it, every frame */
const BHOV = { k: 0, px: -1e4, py: -1e4, v: new THREE.Vector3(), on: false };
function stepBulb(dt) {
  const P = LIGHTS.pendant; if (!P) return false;
  if (!BHOV.on) { BHOV.on = true; addEventListener('pointermove', e => { BHOV.px = e.clientX; BHOV.py = e.clientY; }, { passive: true }); document.addEventListener('pointerleave', () => { BHOV.px = BHOV.py = -1e4; }); }
  const U = P.userData, lit = U.light.intensity / 40; let over = 0;
  if (lit > 0.01) {
    U.glow.getWorldPosition(BHOV.v); const d = camera.position.distanceTo(BHOV.v), v = BHOV.v.project(camera), x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
    const r = Math.max(12, 0.08 / d * innerHeight / 2 / Math.tan(camera.fov * Math.PI / 360));   // (the glass's size on the screen, a little more)
    over = v.z < 1 && Math.hypot(BHOV.px - x, BHOV.py - y) < r ? 1 : 0;
  }
  const k0 = BHOV.k; BHOV.k += (over - BHOV.k) * Math.min(1, dt / 0.08); if (Math.abs(over - BHOV.k) < 0.005) BHOV.k = over;
  const m = 1 + 0.5 * BHOV.k; if (!U.glow.userData.s0) U.glow.userData.s0 = U.glow.scale.x;
  U.glow.scale.setScalar(U.glow.userData.s0 * (1 + (Math.SQRT2 - 1) * BHOV.k));   // (its glow spread over twice the area)
  U.glow.material.opacity = 0.45 * lit * m; if (U.fil) U.fil.material.opacity = 0.8 * lit * m; U.coil.material.emissiveIntensity = 9 * lit * m; U.glass.emissiveIntensity = 0.35 * lit * m;
  return BHOV.k !== k0;   // (moving: the room is drawn again)
}

/* ---- the floor lamp's beam: the light under its cone of a shade shown in the air, and dust drifting in it
   Drawn sharp over the picture, as the bulb's glow, and only while the lamp is lit (its glow's strength, fx/hour.js).
   - The beam: an open cone from the shade's mouth down along the spot's axis (1.25 m, its half-angle 0.42 rad, narrower
     than the spot's falloff: the bright core of it), a faint warm haze, strongest at the mouth and gone by its end, soft
     at its sides (by how square to the eye its surface is: a volume's edge is thin) and where it meets the room (by the
     room's depth there: no hard line where it enters a shelf).
   - The dust: 44 motes in the cone, each drifting on three slow sways of its own and sinking and rising a little; lit as
     it is in the beam (bright near the mouth, at the core), glinting now and then as a flake turns. All in the shaders. */
const BEAM = { cone: null, dust: null, on: { value: 0 }, t: { value: 0 }, len: 1.25, half: 0.42, mouth: 0.15, y0: -0.235 };
const BEAM_GLSL = `uniform sampler2D uDepth; uniform vec2 uRes; uniform mat4 uPInv;
  float roomGap(float vz) { vec2 uv = gl_FragCoord.xy / uRes; float z = texture2D(uDepth, uv).r; if (z >= 1.0) return 9.0;
    vec4 v = uPInv * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); return vz - v.z / v.w; }`;   // (how far in front of the room this point is, m)
// a beam's haze: an open cone from its mouth (radius mouth, at y0 of the frame m) down its −y (len, widening by half), k its
// strength; strongest at the mouth and gone by its end, soft at its sides and where it meets the room (its depth there)
function beamCone(m, { mouth, y0, len, half }, k, on) {
  const geo = new THREE.CylinderGeometry(mouth, mouth + Math.tan(half) * len, len, 48, 12, true); geo.translate(0, y0 - len / 2, 0);
  const cone = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uPInv: { value: camera.projectionMatrixInverse }, uOn: on },
    vertexShader: `varying float vT; varying vec3 vV, vN; void main(){ vT = (${y0.toFixed(4)} - position.y) / ${len.toFixed(4)};
      vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${BEAM_GLSL} uniform float uOn; varying float vT; varying vec3 vV, vN;
      void main(){ float gap = roomGap(vV.z); if (gap < 0.0) discard;
        float face = abs(dot(normalize(vN), normalize(-vV)));                      // square to the eye: looking through the beam's depth
        float along = pow(1.0 - clamp(vT, 0.0, 1.0), 1.2) * smoothstep(0.0, 0.06, vT + 0.02);
        float a = ${k.toFixed(3)} * uOn * along * (0.45 + 0.55 * face) * smoothstep(0.0, 0.12 * ${Math.min(1, len / 1.25).toFixed(3)}, gap);   // (its sides kept: from the side it reads as a triangle of light)
        if (a < 0.0015) discard; gl_FragColor = vec4(vec3(1.0, 0.8, 0.56) * a, 1.0); }`,
    side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
  cone.matrixAutoUpdate = false; cone.matrix.copy(m); cone.matrixWorld.copy(m); cone.frustumCulled = false; cone.visible = false; return cone;
}
function buildLampBeam(shade) {
  shade.updateMatrixWorld(true);
  const B = BEAM;
  const U = { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uPInv: { value: camera.projectionMatrixInverse }, uOn: B.on, uTime: B.t };
  const cone = beamCone(shade.matrixWorld, B, 0.1, B.on);
  // the dust: where each mote is in the cone (along it, round it, out from its axis), its sways, its glint
  const n = 44, home = new Float32Array(n * 3), sway = new Float32Array(n * 4), r = rng(41);
  for (let i = 0; i < n; i++) { home.set([0.04 + 0.9 * Math.pow(r(), 1.3), r() * Math.PI * 2, Math.sqrt(r()) * 0.92], i * 3); sway.set([0.02 + r() * 0.035, 0.6 + r() * 0.8, r() * 100, 0.5 + r()], i * 4); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(home, 3)); g.setAttribute('aSway', new THREE.BufferAttribute(sway, 4));
  const dust = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { ...U, uPR: OVER.u.uPR },
    vertexShader: `attribute vec4 aSway; uniform float uTime, uOn, uPR; uniform vec2 uRes; varying float vB; varying float vZ;
      void main(){ float t = uTime * 0.25 * aSway.y + aSway.z, s = position.x + 0.05 * sin(t * 0.7) + 0.03 * sin(t * 1.9 + 1.0);
        float rad = (${B.mouth.toFixed(3)} + ${Math.tan(B.half).toFixed(3)} * s * ${B.len.toFixed(3)}) * position.z;
        vec3 p = vec3(cos(position.y) * rad, ${B.y0.toFixed(3)} - s * ${B.len.toFixed(3)}, sin(position.y) * rad)
          + aSway.x * vec3(sin(t) + 0.5 * sin(t * 2.3 + 1.7), 0.6 * sin(t * 0.8 + 3.0), cos(t * 1.1) + 0.5 * sin(t * 1.7 + 0.4));
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vZ = mv.z; gl_Position = projectionMatrix * mv;
        float lit = pow(1.0 - clamp(s, 0.0, 1.0), 1.4) * (1.0 - 0.6 * position.z * position.z);
        float glint = pow(0.5 + 0.5 * sin(uTime * (1.3 + aSway.w) + aSway.z * 5.0), 12.0);   // (a flake turning to the light)
        vB = uOn * lit * (0.35 + 0.9 * glint);
        gl_PointSize = clamp(0.0035 * aSway.w * projectionMatrix[1][1] * 0.5 * uRes.y / -mv.z, 1.6 * uPR, 4.0 * uPR); }`,
    fragmentShader: `${BEAM_GLSL} varying float vB; varying float vZ;
      void main(){ if (roomGap(vZ) < 0.0) discard; float d = length(gl_PointCoord - 0.5) * 2.0, a = smoothstep(1.0, 0.2, d) * vB * 2.2;
        if (a < 0.004) discard; gl_FragColor = vec4(vec3(1.0, 0.9, 0.74) * a, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
  dust.matrixAutoUpdate = false; dust.matrix.copy(shade.matrixWorld); dust.matrixWorld.copy(shade.matrixWorld); dust.frustumCulled = false; dust.visible = false;
  OVER.scene.add(cone, dust); B.cone = cone; B.dust = dust;
}
function cellBeams() {   // the clock's and the camera's cells' downlights (world/shelves.js cellLight): each a beam down from its lamp to the board
  for (const c of CELLS) { if (c.beam) continue;
    const P = c.light.position, d = c.light.target.position.clone().sub(P), len = d.length() * 0.96, mouth = 0.02, half = Math.atan(Math.max(0.02, c.wide * 0.4 - mouth) / len);
    const m = new THREE.Matrix4().compose(P, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.normalize()), new THREE.Vector3(1, 1, 1));
    c.on = { value: 0 }; c.beam = beamCone(m, { mouth, y0: 0, len, half }, 0.1, c.on); OVER.scene.add(c.beam); }
  let any = false;
  for (const c of CELLS) { c.on.value = c.light.intensity / c.base; c.beam.visible = c.on.value > 0.01; any = any || c.beam.visible; }
  return any;
}
function stepLampBeam(t) {   // true while it shows (the sharp layer drawn)
  const cells = cellBeams(), B = BEAM, F = LIGHTS.floor; if (!B.cone || !F) return cells;
  B.on.value = Math.min(1, F.userData.glow.material.opacity / 0.95); const on = B.on.value > 0.01;
  B.cone.visible = B.dust.visible = on; if (on) B.t.value = t; return on || cells;
}

export { BEAM, BHOV, BULB, buildBulbGlow, buildLampBeam, stepBulb, stepLampBeam };
