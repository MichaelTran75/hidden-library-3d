import './night.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { body, reduceMotion } from '../core/base.js';
import { scene, setShadowsDirty } from '../core/renderer.js';
import { MAT } from '../world/materials.js';
import { LIGHTS } from '../world/lights.js';
import { POST } from './post.js';
import { NC, NIGHT, lerp } from './night.js';
import { FLY } from './fireflies.js';
import { on, setNeeds } from '../core/loop.js';
import { petsForHour } from '../world/pets.js';
import { WX } from './rain.js';

/* ---------------------------------------------------------------- the hour
   The room's light follows the visitor's clock through the day instead of switching at dusk. What it rests on:
   - Where the sun is: where the visitor's clock says they are, as the page works it out (src/sun: window.HL_SUN; G,
     17/10/2026: "cho mặt trời mọc và mặt trời lặn depend on local time"): NOAA's solar equations at their time zone's
     principal city, at Pleiku (13.98° N, 108.0° E) for a clock on Vietnam's time, the sun as it is seen (lifted by the
     air's refraction). So it rises and sets in the room when it does there, and the room's dark comes in the same
     minute as the page's. The room is turned so that its left glass looks west-south-west: an October afternoon sun (~15:15, 30° up) comes in as in the painting;
     in the morning the sun stands behind the shelf wall, at noon high over the front glass.
   - Sunlight crosses more air as the sun sinks (air mass, Kasten & Young 1989) and loses blue first: per air mass the
     optical depth is ~0.17 red, ~0.25 green, ~0.41 blue (Rayleigh scattering plus haze). So the light is white-gold
     high up, gold under ~10°, orange at 5°, red at the horizon, and weaker; it goes out as the sun reaches the trees.
   - Skylight falls with the sun (here as sin(elevation)^0.35); the window facing the sun is the brightest one.
   - Twilight: civil (0 to −6°) brings an orange band on the sun's side under a sky turning violet, then deep blue
     (the blue hour, around −4°); in nautical twilight (−6 to −12°) the stars come out and the night look takes over.
   - The lamps come on as the daylight goes (sun from 6° to −4°), as someone reading there would switch them on.
   - The weather (fx/rain.js WX.ov, from the live weather at Pleiku): under an overcast or in rain the sun goes behind
     the cloud (no direct light, no shadows, no golden hour), the skylight dims a little and turns grey, the sky dome is
     one grey layer and the rain's haze takes the far trees.
   The page's day/night switch still wins when it is used by hand: the room then goes to the painting's afternoon or
   to night (a 4 s time-lapse). `?at=17:40` in the address pins the room's clock (to preview an hour).            */
const DEG = Math.PI / 180, smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const SUN_REF = { e: 29.7, az: 245 };   // the painting's afternoon: the sun the room was lit by
const SKYU = { uSunDir: { value: new THREE.Vector3(-0.68, 0.5, 0.54) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uDay: { value: 1 }, uGlow: { value: 0 }, uWarm: { value: 0 }, uOv: { value: 0 } };
const OVC = { hemi: new THREE.Color(0xb7bdc4), win: new THREE.Color(0xc4cad0), fog: new THREE.Color(0x9da5ad) };   // an overcast's greys
const TINT = { warm: { hemi: new THREE.Color(0xffcb92), win: new THREE.Color(0xffc489), fog: new THREE.Color(0xe8c6a2), ring: new THREE.Color(0xd0ae7e) },
  blue: { hemi: new THREE.Color(0x6c74b4), win: new THREE.Color(0x7880c4), fog: new THREE.Color(0x3c4664), ring: new THREE.Color(0x2c3548) } };
const HOUR = { e: null, az: null, pin: null, moving: false, S: {}, dir: new THREE.Vector3(), refDots: null };
const sunPlace = d => window.HL_SUN.at(d);   // the sun's elevation (as seen) and azimuth (degrees; azimuth from north, clockwise) at the date d
// the direction toward the sun in the room (y up); its light leaves the scene under 2°, so it never comes from below
const sunDirAt = (e, az, v) => { const p = (az - 103.7) * DEG, el = Math.max(e, 2) * DEG; return v.set(Math.cos(el) * Math.cos(p), Math.sin(el), Math.cos(el) * Math.sin(p)); };
const airMass = e => { const z = 90 - Math.max(e, 0); return 1 / (Math.cos(z * DEG) + 0.50572 * Math.pow(96.07995 - z, -1.6364)); };
const M_REF = airMass(SUN_REF.e);
function hourState(e, S) {   // how the light stands for a sun e degrees up (0..1 weights, relative to the painting's afternoon)
  const dm = airMass(e) - M_REF;
  S.sun = Math.exp(-0.12 * dm) * smooth(-0.5, 3, e);                     // direct sunlight
  S.tg = Math.exp(-0.08 * dm); S.tb = Math.exp(-0.24 * dm);                // its green and blue, against its red
  S.amb = Math.min(1.12, Math.pow(Math.sin(Math.max(e, 2) * DEG) / Math.sin(SUN_REF.e * DEG), 0.35));   // skylight
  S.n = smooth(1, -11, e);                                                 // the night look
  S.lamps = smooth(6, -4, e);
  S.stars = smooth(-5, -12, e);
  S.warm = smooth(18, 4, e) * smooth(-3, 2, e);                            // golden hour
  S.blue = smooth(1, -4, e) * smooth(-12, -6, e);                          // blue hour
  S.skyDay = smooth(-6, 4, e); S.glow = smooth(14, 0, e) * smooth(-9, -2, e);
  return S;
}
const tint3 = (out, day, warm, blue, night, S) => out.copy(day).lerp(warm, S.warm).lerp(blue, S.blue).lerp(night, S.n);
function applyHour(e, az) {
  const L = LIGHTS, D = NIGHT.day, U = POST.mat.uniforms, S = hourState(e, HOUR.S), n = S.n, ov = WX.ov;
  if (ov > 0.001) { S.sun *= 1 - 0.95 * ov; S.amb *= 1 - 0.36 * ov; S.warm *= 1 - 0.9 * ov; S.glow *= 1 - 0.85 * ov; S.tg = S.tg + (1 - S.tg) * ov; S.tb = S.tb + (1 - S.tb) * ov;
    S.lamps = Math.max(S.lamps, 0.6 * ov); }   // (behind the cloud; on a dark rainy day the lamps are on)
  HOUR.e = e; HOUR.az = az; NIGHT.u.value = S.stars;
  FLY.u.value = smooth(3, -5, e);
  // the sun: where, what colour, how strong
  const dir = sunDirAt(e, az, TMPV.set(0, 0, 0)), moved = dir.distanceToSquared(HOUR.dir) > 1e-8; HOUR.dir.copy(dir);
  L.sun.position.copy(D.sunT).addScaledVector(dir, 12.5);
  L.sun.color.setRGB(D.sunC.r, Math.min(1, D.sunC.g * S.tg), Math.min(1, D.sunC.b * S.tb));
  const sunWas = L.sun.visible; L.sun.intensity = D.sun * S.sun; L.sun.visible = L.sun.intensity > 0.003;
  if (L.sun.visible && (!sunWas || moved)) setShadowsDirty(true);
  // skylight: the sky dome, the hemisphere and the windows (the one facing the sun brighter)
  SKYU.uSunDir.value.copy(dir); SKYU.uSunCol.value.setRGB(L.sun.color.r / D.sunC.r, L.sun.color.g / D.sunC.g, L.sun.color.b / D.sunC.b);
  SKYU.uDay.value = S.skyDay; SKYU.uGlow.value = S.glow; SKYU.uWarm.value = S.warm; SKYU.uOv.value = ov;
  const amb = S.amb, full = n >= 0.999;
  L.hemi.intensity = lerp(D.hemi * amb, 0.15, n); tint3(L.hemi.color, D.hemiC, TINT.warm.hemi, TINT.blue.hemi, NC.hemi, S); L.hemi.groundColor.lerpColors(D.hemiG, NC.hemiG, n);
  if (ov > 0.001) L.hemi.color.lerp(OVC.hemi, 0.6 * ov * (1 - n));
  const NRM = [[-1, 0], [0, -1], [0, 1]], side = (k, x, z) => Math.max(0, NRM[k][0] * x + NRM[k][1] * z);   // left, back, front glass
  if (!HOUR.refDots) { const r = sunDirAt(SUN_REF.e, SUN_REF.az, new THREE.Vector3()); HOUR.refDots = NRM.map((_, k) => 1 + 0.35 * side(k, r.x, r.z)); }
  L.rects.forEach((r, k) => {
    const face = (1 + 0.35 * side(k, dir.x, dir.z) * S.sun) / HOUR.refDots[k];
    r.intensity = D.rects[k][0] * lerp(amb * face, 0.22, n); tint3(r.color, D.rects[k][1], TINT.warm.win, TINT.blue.win, NC.win, S); r.visible = !full;
    if (ov > 0.001) r.color.lerp(OVC.win, 0.55 * ov * (1 - n));
  });
  scene.environmentIntensity = lerp(D.env * amb, 0.09, n) + (full ? 0.02 : 0);
  tint3(scene.fog.color, D.fog, TINT.warm.fog, TINT.blue.fog, NC.fog, S);
  if (ov > 0.001) scene.fog.color.lerp(_ovf.copy(OVC.fog).multiplyScalar(lerp(1, 0.18, n)), 0.5 * ov);
  scene.fog.density = 0.03 * (1 + 0.45 * WX.k);   // (the rain's haze)
  if (L.ring) { tint3(L.ring.material.color, D.ring, TINT.warm.ring, TINT.blue.ring, NC.ring, S); L.ring.material.color.multiplyScalar(lerp(0.55 + 0.45 * Math.min(amb, 1), 1, n)); }
  // the lamps
  const k = S.lamps;
  L.table.userData.light.intensity = lerp(D.table, 7, k); L.table.userData.glow.material.opacity = lerp(D.tableGlow, 0.9, k);
  L.floor.userData.light.intensity = lerp(D.floor, 32, k); L.floor.userData.pt.intensity = lerp(D.floorPt, 5, k); L.floor.userData.glow.material.opacity = lerp(D.floorGlow, 0.95, k);
  MAT.shade.emissiveIntensity = lerp(D.shade, 2.4, k);
  if (L.pendant) {   // the bulb over the sofa: off by day, on with the lamps (its spot shown and hidden with the downlights, so the shaders change once)
    const P = L.pendant.userData; P.light.intensity = 40 * k; P.light.visible = k > 0.001; P.glow.material.opacity = 0.6 * k;
    P.coil.material.emissiveIntensity = 9 * k; P.glass.emissiveIntensity = 0.35 * k;
  }
  for (const sp of NIGHT.spots) { sp.sp.intensity = 55 * sp.k * k; sp.sp.visible = k > 0.001; sp.disc.material.color.setRGB(0.1, 0.086, 0.07).lerp(NC.disc, k); }
  // the eye opens a little as the light goes
  petsForHour(S);
  U.exposure.value = lerp(D.exposure * (1 + 0.25 * (1 - Math.min(amb, 1))), 1.0, n); U.lift.value = lerp(D.lift, 0.96, n); U.veil.value = lerp(D.veil, 0.07, n);
}
const TMPV = new THREE.Vector3(), _ovf = new THREE.Color();
function hourTarget() {   // where the light should be: the sun of the clock, or the page's switch when it was used by hand
  if (HOUR.pin) return sunPlace(HOUR.pin);
  const d = new Date(), clockDark = !window.HL_SUN.isDay(d);   // the page's own rule (sunset to sunrise where the visitor is)
  const dark = body.classList.contains('dark-mode');
  if (dark === clockDark) return sunPlace(d);
  return dark ? { e: -20, az: 290 } : SUN_REF;
}
function stepHour(dt) {   // the light toward the hour: at once when it creeps, as a 4 s time-lapse when it jumps; true while moving
  const t = hourTarget();
  const de = t.e - HOUR.e, da = ((t.az - HOUR.az + 540) % 360) - 180;
  // the sun creeps ~0.25° a minute: the room is redrawn for it about once a minute (steps that small do not show),
  // so a still room stays a still picture
  if (Math.abs(de) < (HOUR.moving ? 0.01 : 0.2) && Math.abs(da) < (HOUR.moving ? 0.02 : 0.4)) return HOUR.moving = false;
  const big = Math.abs(de) > 1.5 || Math.abs(da) > 4, fast = big && on && !reduceMotion;
  const e = fast ? HOUR.e + THREE.MathUtils.clamp(de, -13 * dt, 13 * dt) : t.e;
  const az = fast ? HOUR.az + THREE.MathUtils.clamp(da, -35 * dt, 35 * dt) : t.az;
  applyHour(e, (az + 360) % 360); setNeeds(true);
  return HOUR.moving = fast;
}

export { HOUR, SKYU, TMPV, applyHour, hourTarget, stepHour, sunPlace };
