import './fireflies.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { R, reduceMotion } from '../core/base.js';
import { rng } from '../core/utils.js';
import { camera, renderer } from '../core/renderer.js';
import { room } from '../world/room.js';
import { POST } from './post.js';
import { HOUR, applyHour } from './hour.js';
import { NIGHT } from './night.js';
import { OVER } from '../ui/words.js';
import { SKYCLEAR } from './sky.js';
import { FLY } from './fireflies.js';
import { REVEAL, clock, setNeeds } from '../core/loop.js';
import { setHenAway } from '../world/pets.js';

/* ---------------------------------------------------------------- rain
   Rain outside the glass when it rains at Pleiku now (G, 16/10/2026: "làm mưa ngoài kính khi (local time) có mưa"): the
   page's live weather (weather/sky-weather.js: Open-Meteo, the 3D garden's source and place; window.HL_WEATHER and its
   'hl-weather' event), how hard from its WMO code and the last quarter hour's rain, as the garden reads it.
   - The rain itself: thousands of drops falling past the glass at their terminal speed (6.5 to 9 m/s for 2 to 4 mm
     drops: Gunn & Kinzer 1949), slanting with the wind (blowing as it does at Pleiku, turned into the room's compass),
     each drawn as a camera sees a drop, a short streak (its fall in a 30th of a second) one or two pixels wide, nearer
     ones wider and brighter, thicker near the glass; light ones against the dark garden by day, and by night lit warm by
     the room's lamps where they pass close to the glass. Where one reaches the patio or the lawn it splashes, a small
     ring opening and gone in a tenth of a second. They are drawn sharp over the picture (the watercolour pass would wipe
     out lines this thin), before the deck and the animals, and only where the room shows what is out there (each pixel
     tested against the room's depth, as the stars are: hidden by the posts, the frames and the trees in front of them).
   - On the glass: drops beading on the panes and drops running down them in jerks (stick and slip), each leaving a trail
     of droplets, more on the side the wind drives the rain against. Each drop is a little lens: it shows the picture
     behind it bent and turned over (the painted view sampled through it, offset by its shape, as in the well-known
     shader drops on glass), darker at its rim where light leaves it sideways, with a glint of the sky by day or of the
     lamps by night. When the rain stops the running drops stop with it; the beaded ones stay a while, then dry.
   - The day goes grey: an overcast takes the sun (and its shadows) and its warm light, the skylight dims and turns grey,
     the sky becomes one grey layer, the far trees go into the haze of the rain (fx/hour.js applyHour reads WX.ov); a day
     under thick cloud without rain goes grey too. By night only the rain hides the stars, the moon, the Milky Way, the
     comet and the shooting stars (fx/sky.js SKYCLEAR): under mere cloud they stay out (G, 16/10/2026); the hen keeps in,
     the fireflies in the garden too.
   - A thunderstorm: now and then the lightning, the sky and the garden flashing twice (a stroke and its return).
   ?wx=rain (or drizzle, storm) shows it whatever the weather. */
const RAIN = { on: false, scene: new THREE.Scene(), built: false, streaks: null, drops: null, flash: null };
const WX = { k: 0, kT: 0, ov: 0, ovT: 0, ovRain: 0, ovCloud: 0, ovSet: 0, wet: 0, storm: false, cover: 0, clear: 1, first: true, wind: new THREE.Vector2(), windT: new THREE.Vector2(), last: 0, bolt: -1e9, nextBolt: 0, fl: 0 };
RAIN.wx = WX;   // (for tests)
const RAIN_K = { 51: 0.22, 53: 0.32, 55: 0.42, 56: 0.32, 57: 0.42, 61: 0.45, 63: 0.66, 65: 0.92, 66: 0.5, 67: 0.75, 80: 0.5, 81: 0.75, 82: 1, 95: 0.85, 96: 0.92, 99: 1 };
const RU = { uTime: { value: 0 }, uK: { value: 0 }, uWet: { value: 0 }, uWind: { value: new THREE.Vector2() }, uDay: { value: 1 }, uLamp: { value: 0 }, uFlash: { value: 0 },
  uPic: { value: null }, uRoom: { value: new THREE.Vector4(R.xL - 0.06, R.zB - 0.02, R.xW, R.zF) }, uInvVP: { value: new THREE.Matrix4() } };

// the weather now: how hard it rains (0 to 1), how overcast, the storm, the wind (m/s, the way it blows, in the room)
function readWeather() {
  const W = window.HL_WEATHER, c = W && W.cur; if (!c) return;
  const code = c.weather_code, mmh = (c.precipitation || 0) * 4;   // (a quarter hour's rain: weather/sky-weather.js)
  let k = RAIN_K[code] || 0; if (mmh > 0.05) k = Math.max(k, Math.min(1, 0.28 + mmh / 9));
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) k = 0;   // (snow: never at Pleiku)
  WX.kT = k; WX.storm = code >= 95; WX.cover = (c.cloud_cover ?? 0) / 100;
  WX.ovRain = k > 0 ? 0.82 + 0.18 * k : 0; WX.ovCloud = Math.max(THREE.MathUtils.smoothstep(WX.cover, 0.6, 1.0) * 0.6, code === 45 || code === 48 ? 0.7 : 0);
  WX.ovT = Math.max(WX.ovRain, WX.ovCloud * (1 - NIGHT.u.value));
  const to = ((c.wind_direction_10m || 0) + 180 - 103.7) * Math.PI / 180, v = (c.wind_speed_10m || 0) / 3.6;   // (the compass of fx/hour.js sunDirAt)
  WX.windT.set(Math.cos(to), Math.sin(to)).multiplyScalar(Math.min(8, v * 0.55));   // (near the ground the wind is less; the drops take up most of it)
  if (WX.first) { WX.first = false; WX.k = WX.kT; WX.ov = WX.ovT; WX.wind.copy(WX.windT); WX.wet = k > 0 ? 1 : 0; }   // (raining when the page opens: raining at once)
  setNeeds(true);
}
addEventListener('hl-weather', readWeather);

/* ---- the falling drops: one instance each (a quad: x across, y from its head to its tail), placed in the shader */
const STREAK_VS = `attribute vec4 aDrop; uniform float uTime, uK, uDay, uLamp, uPR; uniform vec2 uWind, uRes; uniform vec4 uRoom;
  varying vec2 vQ; varying float vA, vMode; varying vec3 vC;
  void main() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0;
    if (fract(aDrop.w * 31.7) > uK) return;   // (as many as the rain is heavy)
    float v = 6.5 + 2.6 * fract(aDrop.w * 7.3), G = -0.105, top = 6.6, sp = 0.11;   // its speed, the ground, where it comes into view, a splash's time
    float T = (top - G) / v + sp, tau = fract(aDrop.z + uTime / T) * T;
    vec3 p = vec3(aDrop.x + uWind.x * (tau - 0.5 * T), top - v * tau, aDrop.y + uWind.y * (tau - 0.5 * T));
    if (p.x > uRoom.x - 0.1 && p.z > uRoom.y - 0.1 && p.x < uRoom.z + 0.2 && p.z < uRoom.w + 0.2) return;   // (blown over the house: under its roof)
    float dist = length(p - cameraPosition);
    float dL = uRoom.x - p.x, dB = uRoom.y - p.z, dG = dL > 0.0 && dB > 0.0 ? min(dL, dB) : max(dL, dB);   // how far out from the glass
    vC = mix(vec3(0.3, 0.33, 0.38), vec3(0.93, 0.95, 0.98), uDay) + vec3(1.0, 0.8, 0.52) * uLamp * 0.85 * exp(-dG / 1.3);   // (by night lit by the lamps near the glass)
    if (p.y > G) {   // falling: a streak, its head below, its tail up the way it came
      vMode = 0.0;
      vec3 vel = vec3(uWind.x, -v, uWind.y);
      vec4 c0 = projectionMatrix * viewMatrix * vec4(p, 1.0), c1 = projectionMatrix * viewMatrix * vec4(p - vel * 0.03, 1.0);
      if (c0.w < 0.1 || c1.w < 0.1) return;
      vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uRes; float L = length(d); d = L > 1e-3 ? d / L : vec2(0.0, 1.0);
      float w = uPR * clamp(2.2 / dist, 0.55, 1.5);   // (half its width, device pixels: nearer, wider)
      vec4 c = mix(c0, c1, position.y); c.xy += vec2(-d.y, d.x) * position.x * w * 2.0 / uRes * c.w;
      gl_Position = c; vQ = position.xy;
      vA = (0.2 + 0.25 * uK) * clamp(2.8 / dist, 0.25, 1.0) * smoothstep(top, top - 0.8, p.y);
    } else {   // landed: a ring on the ground, opening, gone
      vMode = 1.0; float age = (G - p.y) / v, rr = 0.01 + 0.2 * age;
      gl_Position = projectionMatrix * viewMatrix * vec4(p.x + position.x * rr, G + 0.006, p.z + (position.y * 2.0 - 1.0) * rr, 1.0);
      vQ = vec2(position.x, position.y * 2.0 - 1.0);
      vA = (0.3 + 0.3 * uK) * (1.0 - age / sp) * clamp(3.0 / dist, 0.2, 1.0) * step(dist, 10.0);
    }
  }`;
const STREAK_FS = `uniform sampler2D uDepth; uniform vec2 uRes; varying vec2 vQ; varying float vA, vMode; varying vec3 vC;
  void main() {
    if (vA < 0.002 || gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 2e-6) discard;   // (behind a post, a frame, a tree)
    float a;
    if (vMode < 0.5) a = vA * (1.0 - vQ.x * vQ.x) * smoothstep(0.0, 0.2, vQ.y) * (1.0 - 0.6 * vQ.y);   // brightest at its head
    else { float r = length(vQ); a = vA * smoothstep(1.0, 0.8, r) * smoothstep(0.4, 0.8, r); }
    if (a < 0.003) discard;
    gl_FragColor = vec4(vC * a, a); }`;

/* ---- the drops on the glass: a lens each (see above); q is the place on the pane, in metres (across, up) */
const DROPS_FS = `uniform sampler2D uDepth, uPic; uniform vec2 uRes, uWind; uniform float uTime, uK, uWet, uDay, uLamp; uniform vec4 uRoom;
  varying vec3 vW;
  float hr(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 hr2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  void main() {
    if (gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 2e-6) discard;   // (a post, a frame, the shelves in front of the pane)
    vec2 out2 = vW.x < uRoom.x + 0.02 ? vec2(-1.0, 0.0) : vW.z < uRoom.y + 0.02 ? vec2(0.0, -1.0) : vec2(0.0, 1.0);   // which way the pane faces out
    vec2 q = vec2(abs(out2.x) > 0.5 ? vW.z : vW.x, vW.y);
    vec2 jx = dFdx(q), jy = dFdy(q);   // (the place on the pane against the screen: for the lens's offset)
    float ws = length(uWind), dens = clamp(0.55 + 0.45 * (ws > 0.01 ? dot(uWind / ws, -out2) * min(1.0, ws / 2.5) : 0.0), 0.3, 1.0);   // (more where the wind drives it)
    float m = 0.0, r = 1.0; vec2 dv = vec2(0.0);   // the drop here: how much, its size (m), where in it
    // beaded drops, one to a cell of 1.8 cm: each comes, stays a while, dries; another takes its place
    { vec2 g = q / 0.018, id = floor(g), f = fract(g) - 0.5, rn = hr2(id); float rz = hr(id + 17.3);
      vec2 c = (rn - 0.5) * 0.56; float rad = mix(0.07, 0.2, rz * rz), life = fract(uTime * 0.03 + rz * 13.0);
      float show = step(hr(id + 3.1), uWet * dens * 0.85) * smoothstep(0.0, 0.04, life) * smoothstep(1.0, 0.85, life);
      vec2 d = (f - c) / rad; float dd = dot(d, d), mm = show * smoothstep(1.0, 0.8, dd);
      if (mm > m) { m = mm; r = rad * 0.018; dv = d; } }
    // running drops, in columns 5.5 cm wide: sliding down in jerks, a trail of droplets above each
    { float ci = floor(q.x / 0.055); vec2 cr = hr2(vec2(ci, 7.7)); float P = 0.85, s = uTime * (0.05 + 0.08 * cr.y) + cr.x * 9.0;
      float st = 0.018, prog = (floor(s / st) + smoothstep(0.7, 1.0, fract(s / st))) * st;   // (stick, slip)
      float idx = floor((q.y + prog) / P), u = mod(q.y + prog, P) - 0.5 * P;   // (along the column: the drop at u = 0, going down)
      if (hr(vec2(ci, idx)) < uK * dens * 0.9) {
        float cx = (ci + 0.5 + (hr(vec2(ci, idx + 0.5)) - 0.5) * 0.5) * 0.055 + 0.004 * sin(q.y * 23.0 + ci), rr = 0.0024 + 0.0016 * hr(vec2(idx, ci));
        vec2 d = vec2((q.x - cx) / rr, u / (rr * 1.25)); float dd = dot(d, d), mm = smoothstep(1.0, 0.8, dd);
        if (mm > m) { m = mm; r = rr; dv = d; }
        if (u > 0.0 && u < 0.45 * P) {   // its trail: droplets left behind, every 1.1 cm, fewer further up
          float bi = floor(u / 0.011), bu = u - (bi + 0.5) * 0.011, br = rr * (0.22 + 0.25 * hr(vec2(ci * 3.0 + bi, idx)));
          vec2 bd = vec2((q.x - cx - 0.0015 * (hr(vec2(bi, ci)) - 0.5)) / br, bu / br);
          float bm = smoothstep(1.0, 0.75, dot(bd, bd)) * step(hr(vec2(bi, idx + ci)), 0.75 - u / (0.45 * P));
          if (bm > m) { m = bm; r = br; dv = bd; } }
      } }
    m *= smoothstep(0.7, 1.8, r / max(length(jx), length(jy)));   // (a drop smaller than a pixel or two, seen from across the room, is let go: not a speck)
    if (m < 0.01) discard;
    // the lens: the picture behind seen through the drop, turned over and drawn in
    vec2 o = -dv * r * 1.25, sp = vec2(jy.y * o.x - jy.x * o.y, -jx.y * o.x + jx.x * o.y) / (jx.x * jy.y - jy.x * jx.y);   // (that offset on the screen, px)
    vec3 pic = texture2D(uPic, clamp((gl_FragCoord.xy + sp) / uRes, 0.001, 0.999)).rgb;
    float e = sqrt(dot(dv, dv)), rim = smoothstep(0.5, 1.0, e);
    vec3 col = mix(pic * 1.06 + 0.035, pic * 0.42, rim * 0.65);
    vec2 h = dv - vec2(-0.32, 0.42); col += (vec3(0.55, 0.57, 0.6) * uDay + vec3(0.6, 0.45, 0.26) * uLamp) * exp(-dot(h, h) * 16.0);   // a glint: the sky by day, the lamps by night
    gl_FragColor = vec4(col * m, m); }`;

/* ---- lightning: the sky and the garden flash (the room a little), a full-screen pass over the picture */
const FLASH_FS = `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uFlash; uniform mat4 uInvVP; uniform vec4 uRoom;
  void main() {
    float z = texture2D(uDepth, gl_FragCoord.xy / uRes).r; vec4 w = uInvVP * vec4(gl_FragCoord.xy / uRes * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); w.xyz /= w.w;
    float outside = z > 0.99999 ? 1.0 : (w.x < uRoom.x || w.z < uRoom.y || w.z > uRoom.w) ? 0.5 : 0.09;
    gl_FragColor = vec4(vec3(0.8, 0.85, 1.0) * uFlash * outside * 0.55, 0.0); }`;

function buildRain() {
  RAIN.built = true;
  const N = 7000, a = new Float32Array(N * 4), r = rng(4417), xL = R.xL - 0.06, zB = R.zB - 0.02;
  for (let i = 0; i < N; i++) {   // out from the left glass (and the back glass), thicker near it
    const d = 0.22 + 9.0 * Math.pow(r(), 1.7);
    let x, z; if (r() < 0.74) { z = R.zB - 9 + r() * (R.zF + 2 - R.zB + 9); x = xL - d; } else { x = xL - 0.3 + r() * (R.xW + 3 - xL + 0.3); z = zB - d; }
    a.set([x, z, r(), r()], i * 4);
  }
  const g = new THREE.InstancedBufferGeometry(); g.setIndex([0, 1, 2, 2, 1, 3]);
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3)); g.setAttribute('aDrop', new THREE.InstancedBufferAttribute(a, 4)); g.instanceCount = N;
  const common = { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uPR: OVER.u.uPR, ...RU };
  RAIN.streaks = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: common, vertexShader: STREAK_VS, fragmentShader: STREAK_FS,
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));   // (built on the screen: either winding)
  RAIN.streaks.frustumCulled = false; RAIN.streaks.renderOrder = 0; RAIN.scene.add(RAIN.streaks);
  const pane = room.userData.glass;
  if (pane) {
    RAIN.drops = new THREE.Mesh(pane.geometry, new THREE.ShaderMaterial({ uniforms: common, fragmentShader: DROPS_FS,
      vertexShader: 'varying vec3 vW; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }',
      transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    RAIN.drops.matrixAutoUpdate = false; RAIN.drops.matrix.copy(pane.matrixWorld); RAIN.drops.frustumCulled = false; RAIN.drops.renderOrder = 1; RAIN.scene.add(RAIN.drops);
  }
  const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  RAIN.flash = new THREE.Mesh(tri, new THREE.ShaderMaterial({ uniforms: common, fragmentShader: FLASH_FS, vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    transparent: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true, depthTest: false, depthWrite: false }));
  RAIN.flash.frustumCulled = false; RAIN.flash.renderOrder = 2; RAIN.scene.add(RAIN.flash);
  readWeather();
}
function stepRain(t) {
  const dt = Math.min(0.25, Math.max(0, t - WX.last)); WX.last = t;
  WX.k += (WX.kT - WX.k) * Math.min(1, dt / 10); if (Math.abs(WX.k - WX.kT) < 0.002) WX.k = WX.kT;   // (rain comes on and eases off over some seconds)
  WX.ovT = Math.max(WX.ovRain, WX.ovCloud * (1 - NIGHT.u.value));   // (a cloudy day goes grey; a cloudy night keeps its stars: G, 16/10/2026)
  WX.ov += (WX.ovT - WX.ov) * Math.min(1, dt / 8); if (Math.abs(WX.ov - WX.ovT) < 0.002) WX.ov = WX.ovT;
  WX.wind.lerp(WX.windT, Math.min(1, dt / 4));
  WX.wet = WX.k > 0.02 ? Math.min(1, WX.wet + dt / 8) : Math.max(0, WX.wet - dt / 150);   // (the beaded drops dry over a few minutes)
  if (Math.abs(WX.ov - WX.ovSet) > 0.012 && HOUR.e !== null) { WX.ovSet = WX.ov; applyHour(HOUR.e, HOUR.az); setNeeds(true); }   // (the light of an overcast)
  WX.clear = 1 - 0.97 * THREE.MathUtils.smoothstep(WX.k, 0.04, 0.3);   // (the stars, the moon and the Milky Way always out, but when it rains: G, 16/10/2026)
  SKYCLEAR.value = WX.clear; FLY.rain.value = Math.min(1, WX.k * 3);
  setHenAway(WX.k > 0.08);
  // a storm's lightning: a stroke, then its return a fifth of a second later
  WX.fl = 0;
  if (WX.storm && WX.k > 0.2 && !reduceMotion) {
    if (!WX.nextBolt) WX.nextBolt = t + 4 + Math.random() * 6;
    if (t > WX.nextBolt) { WX.bolt = t; WX.nextBolt = t + 6 + Math.random() * 14; }
    const age = t - WX.bolt; if (age < 1) WX.fl = Math.exp(-age * 22) + (age > 0.18 ? 0.75 * Math.exp(-(age - 0.18) * 12) : 0);
  }
  if (WX.hold !== undefined) WX.fl = WX.hold;   // (for tests: a flash held)
  RAIN.on = WX.k > 0.003 || WX.wet > 0.003 || WX.fl > 0.01;
}
// before the deck and the animals: the rain, the drops on the glass, a flash
function drawRain() {
  if (!RAIN.built) buildRain();
  stepRain(clock.getElapsedTime());
  if (!RAIN.on || REVEAL.stage < 3) return;   // (the weather comes in last)
  const S = HOUR.S || {};
  RU.uTime.value = reduceMotion ? 0 : clock.getElapsedTime(); RU.uK.value = WX.k; RU.uWet.value = WX.wet; RU.uWind.value.copy(WX.wind);
  RU.uDay.value = (1 - NIGHT.u.value) * (1 - 0.35 * WX.ov); RU.uLamp.value = (S.lamps || 0) * 0.9; RU.uFlash.value = WX.fl; RU.uPic.value = POST.out.texture;
  RU.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
  RAIN.streaks.visible = WX.k > 0.003 && !reduceMotion; if (RAIN.drops) RAIN.drops.visible = WX.k > 0.003 || WX.wet > 0.003; RAIN.flash.visible = WX.fl > 0.01;
  renderer.autoClear = false; renderer.render(RAIN.scene, camera); renderer.autoClear = true;
}

export { RAIN, WX, drawRain };
