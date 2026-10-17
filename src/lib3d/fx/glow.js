import './fireflies.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { OVER } from '../ui/words.js';

/* ---- the bulb over the sofa, glowing (G, 18/10/2026: "em cho glowing animation vào bóng này"). Drawn sharp over the
   picture like the fireflies: the room is painted only when something in it changes, and this goes with the sharp
   layer, 30 times a second. A quad facing the eye at the bulb's glass, pulled 7 cm toward the eye so the glass does not
   hide it, and hidden behind whatever the room puts in front of it. Its light breathes slowly (two slow waves, 3.8 s
   and 6.1 s, so it never quite repeats) and shimmers a very little: a warm core in an amber halo, in a wider bloom that
   swells more with the breath; just enough of it (G, 18/10/2026: "glowing ở mức vừa đủ"): the ring round the bulb
   about a quarter brighter than the painting has it, give or take a tenth with the breath, its glass not blown white.
   On only while the bulb is (fx/hour.js: the pendant's glow). */
const BULB = { mesh: null, on: { value: 0 }, t: { value: 0 }, at: { value: new THREE.Vector3() }, size: { value: 0.42 } };
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

export { BULB, buildBulbGlow };
