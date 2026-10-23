import './hour.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { R } from '../core/base.js';
import { renderer, scene } from '../core/renderer.js';
import { room } from '../world/room.js';
import { LIGHTS } from '../world/lights.js';
import { NIGHT } from './night.js';

/* ---------------------------------------------------------------- glass
   The panes of the glass walls (G, 15/10/2026: "tạo kính, improve glass effect"), as thin glass behaves:
   - it reflects the room: a cube map of the room taken from its middle, looked up where the reflected ray leaves the
     room's box (a parallax-corrected cubemap: Lagarde & Zanuttini, "Local Image-based Lighting with Parallax-corrected
     Cubemaps", SIGGRAPH 2012), so a lamp or the shelves show in the glass about where they would, slightly softened;
   - how much by Fresnel (Schlick): 4 % looking straight through, nearly all at a glancing angle. By day the bright
     garden outshines the 4 %; by night, the garden dark, the glass turns into a dim mirror of the lit room, as windows
     do (kept at 40 % of that, so the night sky shows through: G, 15/10/2026);
   - it takes from the view behind it what it reflects (blended premultiplied: the view keeps 1 − a), and a faint green
     of the glass's own;
   - its surface is not perfectly clean: dust and smudges, more toward the bottom, haze it a little and catch light;
   - and two soft diagonal sheens cross each pane, the way glass is drawn, sliding a little as the view moves;
   - by night all of it is let go nearly (the reflection kept at an eighth, the haze and sheens at a tenth), so the night
     sky through it is clear (G, 16/10/2026).
   The cube map is taken again whenever the light changes (the hour, day to night), at most once a second; the panes
   are hidden while it is taken. They write no depth: where the sky shows through them, the stars still show. */
const GLASS = { mat: null, cube: null, cam: null, live: false, at: new THREE.Vector3((R.xL + R.xS) / 2, 1.6, (R.zB + R.zF) / 2), last: { n: -1, s: -1, x: 0, t: -1e9 }, face: -1 };   // (face: the next of its six views to draw, -1 when none)
function glassMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uEnv: { value: GLASS.cube.texture }, uBoxMin: { value: new THREE.Vector3(R.xL, 0, R.zB) }, uBoxMax: { value: new THREE.Vector3(R.xW, R.H, R.zF) }, uCap: { value: GLASS.at }, uDay: { value: 1 } },
    vertexShader: `varying vec3 vW, vN;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform samplerCube uEnv; uniform vec3 uBoxMin, uBoxMax, uCap; uniform float uDay; varying vec3 vW, vN;
      float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec3 V = normalize(vW - cameraPosition), N = normalize(vN); if (dot(N, V) > 0.0) N = -N;
        float c = clamp(-dot(V, N), 0.0, 1.0), F = 0.04 + 0.96 * pow(1.0 - c, 5.0);
        // the room reflected: where the reflected ray leaves the room's box, seen from where the cube map was taken
        vec3 Rf = reflect(V, N), Rs = Rf + vec3(1e-5);
        vec3 tA = (uBoxMax - vW) / Rs, tB = (uBoxMin - vW) / Rs, tf = max(tA, tB); float t = max(0.0, min(min(tf.x, tf.y), tf.z));
        vec3 refl = textureCube(uEnv, vW + Rf * t - uCap, 0.8).rgb;
        // the pane's own coordinates (metres): dust and smudges, more low down
        vec2 q = abs(N.x) > 0.5 ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y);
        float sm = smoothstep(0.5, 0.95, 0.6 * gn(q * 3.1 + 7.0) + 0.4 * gn(q * 13.0)) * (0.45 + 0.55 * smoothstep(1.8, 0.25, vW.y));
        // two soft diagonal sheens across it, sliding a little with the view
        float s = fract((q.x * 0.75 + q.y) * 0.42 + dot(V, vec3(0.45, 0.2, -0.35)) * 0.45);
        float band = smoothstep(0.0, 0.04, s) * smoothstep(0.16, 0.08, s) + 0.6 * smoothstep(0.2, 0.22, s) * smoothstep(0.27, 0.25, s);
        band *= 0.6 + 0.4 * gn(q * 0.9 + 3.0);   // (not even along their length)
        // by night the glass is kept clear, so the stars and the Milky Way are seen through it as if it were not there (G,
        // 16/10/2026): its haze, smudges and sheens almost gone, the room's mirror image faint
        float clearK = mix(0.1, 1.0, uDay);
        float lit = 0.3 + 0.7 * uDay, haze = (0.012 + 0.05 * sm) * clearK, sheen = band * (0.05 + 0.07 * uDay) * clearK;
        vec3 col = refl * F * (1.0 + 0.3 * sm) * mix(0.12, 1.0, uDay) + vec3(0.93, 0.96, 0.94) * (haze + sheen) * lit + vec3(0.003, 0.007, 0.005) * clearK;   // (a smudge scatters a little more of what it reflects)
        gl_FragColor = vec4(col, clamp(F * mix(0.12, 1.0, uDay) + (haze + sheen) * 0.8 + 0.015 * clearK, 0.0, 0.7));   // (premultiplied: the view behind keeps 1 − alpha of itself)
      }`,
    transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide });
}
// once the room is built: the cube map and the panes given their glass. The room is first looked at once the garden and
// the sky are in (GLASS.live, set as the sky is let in: core/loop.js reveal), so that they are seen in it too; until then
// the panes reflect nothing (an unfilled map reads black), and the first picture waits for no extra six views
function buildGlass() {   // (its cube 256 -> 128: the room's faint mirror image, 4 MB -> 1 MB; G, 21/10/2026)
  GLASS.cube = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  GLASS.cam = new THREE.CubeCamera(0.05, 120, GLASS.cube); GLASS.cam.position.copy(GLASS.at); GLASS.cam.updateMatrixWorld(true);
  GLASS.mat = glassMaterial();
  const pane = room.userData.glass; if (pane) pane.material = GLASS.mat;
}
// before the room is drawn: the room looked at again if its light has changed since (the hour, day to night)
function stepGlass(force) {
  if (!GLASS.cam) return;
  const n = NIGHT.u.value, sun = LIGHTS.sun, si = sun ? sun.intensity : 0, sx = sun ? sun.position.x + sun.position.y * 0.37 + sun.position.z * 0.11 : 0, L = GLASS.last, now = performance.now();
  GLASS.mat.uniforms.uDay.value = 1 - n;
  if (!GLASS.live) return;
  const pane = room.userData.glass, vis = pane ? pane.visible : false;
  if (GLASS.face >= 0 && !force) {   // a view of the six, one a frame: each is a room's worth of drawing, and all six at once held
    // the page ~0.1 s, four times over in the day/night switch's time-lapse (G, 23/10/2026: "fix the lag transition")
    if (pane) pane.visible = false;
    const c = GLASS.cam, rt = GLASS.cube, i = GLASS.face, cur = renderer.getRenderTarget(), cf = renderer.getActiveCubeFace(), cm = renderer.getActiveMipmapLevel(), gm = rt.texture.generateMipmaps;
    rt.texture.generateMipmaps = gm && i === 5;   // (the map's mipmaps once its last view is in)
    renderer.setRenderTarget(rt, i); renderer.render(scene, c.children[i]); rt.texture.generateMipmaps = gm; renderer.setRenderTarget(cur, cf, cm);
    if (pane) pane.visible = vis;
    GLASS.face = i < 5 ? i + 1 : -1; return;
  }
  if (!force && (now - L.t < 1000 || (Math.abs(n - L.n) < 0.03 && Math.abs(si - L.s) < 0.06 * Math.max(0.3, L.s) && Math.abs(sx - L.x) < 0.3))) return;
  L.n = n; L.s = si; L.x = sx; L.t = now;
  if (!force) { GLASS.face = 0; return stepGlass(); }   // (begun now, the five others in the next frames)
  if (pane) pane.visible = false;
  GLASS.cam.update(renderer, scene); GLASS.face = -1;   // (all at once when asked: the first look, as the sky comes in)
  if (pane) pane.visible = vis;
}

export { GLASS, buildGlass, stepGlass };
