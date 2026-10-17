import './star-catalog.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CANVAS, REF } from '../core/base.js';
import { rng } from '../core/utils.js';
import { V3 } from '../core/views.js';
import { NIGHT } from './night.js';
import { OVER } from '../ui/words.js';
import { setNeeds } from '../core/loop.js';
import { renderer } from '../core/renderer.js';
import { HOUR } from './hour.js';
import { STAR_BSC5 } from './star-catalog.js';

/* ---- the night sky over the glass, drawn sharp after the watercolour pass (its filter wipes out points this small) and
   only where the room shows sky: every pixel is tested against the room's depth, which the sky dome and the glass leave
   empty. As the real sky over the visitor is (G, 15/10/2026: "make the night sky realistic"; the 3D garden's research,
   3d-garden: app/core/night-sky.js):
   - the stars of the Yale Bright Star Catalogue (2887, to magnitude 5.5) where they stand at this minute: their J2000
     places turned by the local sidereal time where the visitor's clock says they are (src/sun: Pleiku, 13.98° N,
     108° E, for a clock on Vietnam's time) and set in the room by its compass (the same
     one the sun is placed by, fx/hour.js: the left glass looks west, the back glass north), so they rise in the east,
     wheel round the pole star 14° up in the north and set in the west as the night goes on; and the fainter ones under
     the catalogue's limit, 5.5 to 7.5, made up as many as the sky has (about 21,000: some 2.5 times as many each
     magnitude fainter), crowding toward the Milky Way's plane and its centre, so the band is grainy with stars as it is;
   - each as bright as its magnitude (light ∝ 10^(−0.4 m), sized by its logarithm), the brightest with a halo; the
     colour of its temperature (B−V), seen only in the bright ones (night vision barely sees colour); dimmed and reddened
     low down by the air (0.2 magnitude per airmass, Kasten & Young 1989) and twinkling more and more slowly toward the
     horizon, the bright ones there flashing colours;
   - the faintest seen as dark a sky allows: magnitude 6.5 once the twilight is over (a country sky, Bortle 3, the
     garden's Pleiku), as the sun goes down: ~1.5 at the end of civil twilight (−6°), ~4.5 at −12°, all of them past
     astronomical twilight (−18°); less under the moon (up to 1.8 magnitudes lost at full moon, more close to it);
   - the Milky Way (G, 15/10/2026: "realistic night sky phải có cả dải ngân hà, và nhiều sao"), in galactic
     coordinates: a thin disk of light (±4° far out, ±7° toward the centre) in a faint wide glow, brightest toward the
     centre in Sagittarius (its bulge, warm in colour), with the Scutum and Cygnus star clouds and the Carina arm,
     faintest toward the anticentre in Auriga; mottled with star clouds and cut by dark nebulae, the Great Rift splitting
     it from Cygnus down to Ophiuchus; dimmed and lost low down by the air (airmass), coming out only as the twilight
     ends and washed out by moonlight; as bright, where it is brightest, as two to three times the dark sky round it
     (its surface brightness ~20.5 against ~21.8 magnitudes per square arcsecond); and the moon's light scattered round
     the moon.
   The sky is set as a painter would set it (G, 15/10/2026: "cho dải ngân hà nằm ngay góc"): the real sky, its
   constellations as they are, turned so that the Milky Way crosses the corner of the left glass that the room's first
   view shows (only some 12° of sky across, 3° to 16° up, round the moon), rising steeply through it from lower left to
   upper right past the moon: its stretch from Sagittarius's edge up to Scutum (longitude ~15° to ~31°), warm low down
   toward the centre, blue-white higher up, the Great Rift down one side of it, drawn narrower and brighter than the real
   one (so a band, not a glow, in so small a window), and held there; low as that corner is, the air there takes only a
   little of it. And it is drawn as a long exposure shows it (G, 16/10/2026: his photo of the Milky Way, "em reference
   sreenshot này"): the sky's own dark laid over the sky dome (a deep navy, a touch of teal in it), the whole sky crowded
   with faint stars (a field of them, made in the shader, as many as the photo shows: some 35 a 100 × 100 px patch), the
   band clumped into star clouds that sparkle with the stars they are made of, cut by ragged dust lanes, and the moon
   washing out less of it than it would the real one; then the band 20 % fainter, twice (G, 16/10/2026: "less bright
   20%", "bớt sáng lại 20%"), and with 30 % less light from it again (G, 17/10/2026: "cho dải ngân hà bớt sáng lại 30%"; its terms at 0.75 of what they were, as its fainter grain thins out too: measured 0.70 of the light it added), the field of stars and the dark of the sky as they were. ?sky=real shows the sky as it stands over the visitor at this minute
   instead (turning with the hours, dimmed low down by the full air).
   Drawn back to front: the Milky Way, the stars, the comet, then the moon over them (it hides what is behind it), and
   the shooting stars last (they burn in our own air, in front of the moon). The moon has the phase of the page's sky
   clock and hangs in the left glass. */
const SDEG = Math.PI / 180;
// the sky's own dark (the night's, times how clear the sky is: under thick cloud and rain no stars, no moon: fx/rain.js)
const SKYN = { value: 0 }, SKYCLEAR = { value: 1 };
// equatorial (J2000) → galactic
const GAL = new THREE.Matrix3().set(-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.4448296300, 0.7469822445, -0.8676661490, -0.1980763734, 0.4559837762);
const STARU = { uEq: { value: new THREE.Matrix3() }, uGal: { value: new THREE.Matrix3() }, uLim: { value: 6.3 }, uMW: { value: 1 }, uMoon: { value: new THREE.Vector3(0, 1, 0) }, uMoonK: { value: 0 }, uEye: { value: new THREE.Vector3() },
  uExtS: { value: 0.2 }, uExtM: { value: 0.32 }, uHz: { value: 0.12 },   // the air's toll low down: magnitudes per airmass (stars), its log (the Milky Way), the haze's height
  uBand: { value: 1 }, uMWK: { value: 0.38 }, uBandStars: { value: 0 }, uGrain: { value: 1 }, uBandMag: { value: 0 },   // (and its clouds finer, its stars brighter)   // (the painter's sky: the band drawn narrower and brighter, with its own grain of stars)
  uDeep: { value: 0 }, uField: { value: 0 }, uFaintMag: { value: 0 } };   // (the dark it lays over the sky dome; the painter's field of faint stars; the made-up stars a little brighter there)
// where the Milky Way is set (compass bearing from north and height, degrees): a point on it (on the horizon), and a
// point further along it toward Scutum and Aquila; lc: the galactic longitude midway between them (the centre lc back
// along it: below the horizon, its warm glow coming up into the corner); ?sky=real: the sky of this minute instead
const SKYSET = { real: (() => { try { return new URLSearchParams(location.search).get('sky') === 'real'; } catch (e) { return false; } })(), a: [351.9, 0], b: [7.3, 22], lc: 25, key: '' };   // (the band from a to b; galactic longitude lc between them)
const SKY_NOISE = `
  float sh3(vec3 p) { p = fract(p * 0.3183099 + 0.1) * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float sn3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(sh3(i), sh3(i + vec3(1, 0, 0)), f.x), mix(sh3(i + vec3(0, 1, 0)), sh3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(sh3(i + vec3(0, 0, 1)), sh3(i + vec3(1, 0, 1)), f.x), mix(sh3(i + vec3(0, 1, 1)), sh3(i + 1.0), f.x), f.y), f.z); }
  float sfbm(vec3 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * sn3(p); p = p * 2.03 + 7.1; a *= 0.5; } return s * 1.0667; }`;
const AIRMASS = 'float airmass(float el) { return 1.0 / (max(el, 0.0) + 0.50572 * pow(max(96.07995 - acos(clamp(el, -1.0, 1.0)) * 57.29578, 1.0), -1.6364)); }';   // (Kasten–Young)
function kelvinRGB(K, out) {   // a black body's colour (Tanner Helland's fit), linear, its largest channel 1
  const t = K / 100, r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332), g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * Math.pow(t - 60, -0.0755), b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305;
  const c = [r, g, b].map(v => Math.pow(Math.max(0, Math.min(255, v)) / 255, 2.2)), m = Math.max(...c); out.push(c[0] / m, c[1] / m, c[2] / m);
}
function buildStars(sky) {
  const dir = [], mag = [], col = [], seed = [], r = rng(90417), L0 = Math.log(2400), L1 = Math.log(42000);
  { const raw = atob(STAR_BSC5); let p = 0, q = 0;   // the catalogue
    while (p < raw.length) {
      let dl = 0, sh = 0, c; do { c = raw.charCodeAt(p++); dl |= (c & 127) << sh; sh += 7; } while (c & 128);
      q += dl; const y = raw.charCodeAt(p) | raw.charCodeAt(p + 1) << 8 | raw.charCodeAt(p + 2) << 16 | raw.charCodeAt(p + 3) << 24; p += 4;
      const ra = q / 16384 * 2 * Math.PI, de = ((y & 8191) / 8191 * 180 - 90) * SDEG;
      dir.push(Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)); mag.push((y >>> 13 & 255) * 0.05 - 1.5);
      kelvinRGB(Math.exp(L0 + (y >>> 21 & 31) / 31 * (L1 - L0)), col); seed.push(r());
    }
  }
  const iF = dir.length / 3;   // (the made-up ones from here: aBand 1; the band's own grain 2)
  { const v = new THREE.Vector3(), gv = new THREE.Vector3(), a = 0.4, A0 = Math.pow(10, a * 5.5), A1 = Math.pow(10, a * 7.5);   // fainter ones made up: ~2.5 times as many each magnitude, crowding to the galactic plane and its centre
    for (let n = 0; n < 21000;) {
      const z = r() * 2 - 1, f = r() * 2 * Math.PI, sq = Math.sqrt(1 - z * z); v.set(sq * Math.cos(f), sq * Math.sin(f), z);
      gv.copy(v).applyMatrix3(GAL); const gb = Math.abs(gv.z), gc = 0.5 + 0.5 * gv.x / Math.max(1e-6, Math.hypot(gv.x, gv.y));
      if (r() > 0.22 + 0.78 * Math.exp(-gb / 0.16) * (0.55 + 0.45 * gc * gc)) continue;
      dir.push(v.x, v.y, v.z); mag.push(Math.log10(A0 + r() * (A1 - A0)) / a);
      const u = r(); kelvinRGB(u < 0.55 ? 4200 + r() * 1800 : u < 0.88 ? 6000 + r() * 3500 : 9500 + r() * 12000, col); seed.push(r()); n++;
    }
  }
  // the band's own grain (the painter's sky only): 20,000 faint stars, 5.8 to 8, packed into a band ±1.2° wide along the plane,
  // thicker where the band is bright; set in galactic coordinates and turned back to equatorial ones (GAL is orthonormal)
  const band = new Float32Array(dir.length / 3 + 20000); band.fill(1, iF, dir.length / 3);
  { const v = new THREE.Vector3(), Gt = GAL.clone().transpose(), a = 0.4, A0 = Math.pow(10, a * 5.8), A1 = Math.pow(10, a * 8.0), i0 = dir.length / 3;
    for (let n = 0; n < 20000;) {
      const l = (r() * 2 - 1) * Math.PI, bright = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.cos(l), 1.6) + 0.4 * Math.exp(-Math.pow((l - 0.47) / 0.1, 2)) + 0.35 * Math.exp(-Math.pow((l - 1.33) / 0.17, 2));
      if (r() * 1.6 > bright) continue;
      const g1 = r(), g2 = r(), b = Math.sqrt(-2 * Math.log(g1 + 1e-9)) * Math.cos(2 * Math.PI * g2) * 0.021 * (1 + 0.8 * Math.exp(-l * l / 0.5));   // (wider toward the centre)
      v.set(Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)).applyMatrix3(Gt);
      dir.push(v.x, v.y, v.z); mag.push(Math.log10(A0 + r() * (A1 - A0)) / a);
      const u = r(); kelvinRGB(u < 0.6 ? 4300 + r() * 1700 : 6000 + r() * 4000, col); seed.push(r()); band[i0 + n] = 2; n++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(dir, 3)); g.setAttribute('aMag', new THREE.Float32BufferAttribute(mag, 1));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1)); g.setAttribute('aBand', new THREE.BufferAttribute(band, 1));
  const stars = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uTime: OVER.u.uTime, uNight: SKYN, uPR: OVER.u.uPR, ...STARU },
    vertexShader: `attribute float aMag, aSeed, aBand; attribute vec3 aCol; uniform mat3 uEq; uniform vec3 uEye, uMoon; uniform float uTime, uLim, uPR, uMoonK, uExtS, uBandStars, uBandMag, uFaintMag;
      varying vec3 vCol; varying float vHalo; ${AIRMASS}
      void main() {
        gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        float isB = step(1.5, aBand), isF = step(0.5, aBand) - isB;   // (the band's own grain; the made-up faint ones)
        if (isB > 0.5 && uBandStars < 0.5) return;
        vec3 d = uEq * position; float el = d.y;
        if (el < -0.005) return;
        float X = airmass(el), lo = smoothstep(1.3, 7.0, X), fq = mix(4.5, 1.8, lo), ph = aSeed * 50.0;
        float near = dot(d, uMoon), lost = uMoonK * (0.5 * smoothstep(0.7, 0.98, near) + 1.2 * smoothstep(0.985, 0.9995, near));   // (the moon's glare round it)
        float m = aMag + isB * uBandMag + isF * uFaintMag + uExtS * (X - 1.0) + (0.05 + 0.4 * lo) * (0.6 * sin(uTime * fq + ph) + 0.4 * sin(uTime * fq * 1.71 + ph * 1.3));   // the air: dimmer, twinkling
        float dm = uLim - lost - m;   // how many magnitudes above the faintest seen (a little under it still glimpsed)
        if (dm < -1.1) return;
        gl_Position = projectionMatrix * viewMatrix * vec4(uEye + d * 240.0, 1.0);
        float I = min(1.0, 0.15 * exp2(0.6645 * dm));   // its peak: the square root of its light (the eye's compressed response), 1 some 5.5 magnitudes up
        gl_PointSize = uPR * (2.2 + 0.5 * max(dm, 0.0) + 2.6 * smoothstep(4.5, 7.5, dm));
        vHalo = smoothstep(4.5, 7.5, dm);
        vec3 c = mix(vec3(1.0), aCol, 0.2 + 0.55 * smoothstep(1.5, 5.0, dm));   // (the eye sees colour only in the bright ones)
        c *= exp2(-(X - 1.0) * uExtS * vec3(0.0, 0.45, 1.17));   // reddened low down (as much as dimmed)
        c *= 1.0 + lo * smoothstep(3.0, 6.0, dm) * 0.3 * vec3(sin(uTime * 6.0 + ph), sin(uTime * 7.3 + ph * 2.0), sin(uTime * 8.9 + ph * 3.0));   // the bright ones low down flash colours
        vCol = c * I * smoothstep(-1.1, -0.5, dm);
      }`,
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNight; varying vec3 vCol; varying float vHalo;
      void main() { ${SKY_DEPTH}
        vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard;
        vec3 o = vCol * (exp(-r2 * 4.5 * mix(1.0, 3.5, vHalo)) + vHalo * 0.25 * exp(-r2 * 2.5) * (1.0 - r2)) * uNight;
        if (max(o.r, max(o.g, o.b)) < 0.003) discard; gl_FragColor = vec4(o, 0.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true, depthTest: false, depthWrite: false }));
  stars.frustumCulled = false; stars.renderOrder = 1; sky.add(stars);
  // the Milky Way and the moonlight in the air: a shell just inside the stars. It lays the night's own dark over the sky
  // dome too (blended premultiplied: the dome keeps 1 − uDeep of itself), a deep navy as a long exposure of a dark sky
  // shows it (G, 16/10/2026: his photo of the Milky Way), and over that the band and the field of faint stars
  const mw = new THREE.Mesh(new THREE.SphereGeometry(236, 64, 32), new THREE.ShaderMaterial({ side: THREE.BackSide,
    uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uNight: SKYN, ...STARU },
    vertexShader: 'uniform vec3 uEye; varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * viewMatrix * vec4(uEye + position, 1.0); }',
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNight, uMW, uMoonK, uExtM, uHz, uBand, uMWK, uGrain, uDeep, uField; uniform mat3 uGal; uniform vec3 uMoon; varying vec3 vD;
      ${SKY_NOISE} ${AIRMASS} ${SKY_COVER}
      float ridge(vec3 p) { return 1.0 - abs(2.0 * sfbm(p) - 1.0); }   // (1 along the noise's middle value: lines)
      void main() { float cov = skyCover(); if (cov < 0.01) discard;
        vec3 d = normalize(vD); float el = d.y; if (el < -0.02) discard;
        vec3 c = vec3(0.0);
        if (uMW > 0.003) {   // in galactic coordinates (x toward the centre, z toward the north galactic pole)
          vec3 g = uGal * d; float b = asin(clamp(g.z, -1.0, 1.0)) * uBand, l = atan(g.y, g.x), cl = cos(l);
          vec3 gn = vec3(g.xy, g.z * sqrt(uBand)) * mix(1.0, uGrain, 0.6);   // (its clouds a little drawn out along it as it is narrowed; a little finer in a small window)
          float sg = 0.07 + 0.05 * exp(-l * l / 0.5), disk = exp(-b * b / (2.0 * sg * sg));   // the thin disk: ±4° far out, ±7° toward the centre
          float glow = exp(-b * b / 0.16) * 0.12 / uBand;                                      // the faint wide glow round it
          float bul = exp(-l * l / 0.12 - b * b / 0.035);                                      // the bulge in Sagittarius
          float lon = 0.18 + 0.82 * pow(0.5 + 0.5 * cl, 1.6)                                   // brightest toward the centre, faintest toward Auriga
            + 0.35 * exp(-pow((l - 0.47) / 0.1, 2.0)) + 0.3 * exp(-pow((l - 1.33) / 0.17, 2.0)) + 0.22 * exp(-pow((l + 1.38) / 0.22, 2.0));   // Scutum, Cygnus, Carina
          float kw = clamp(1.6 * exp(-l * l / 0.09 - b * b / 0.08) + 0.12 * smoothstep(0.4, 1.0, 0.5 + 0.5 * cl), 0.0, 1.0);   // (warm along its stretch toward the centre, blue further out)
          // the cells of its three grains of stars, and how many pixels each spans (taken here, where every pixel takes it:
          // derivatives are not to be had in a branch some pixels skip)
          vec3 sd = d * 900.0 * uGrain, bd = d * 240.0 * uGrain, fd = d * 160.0 * uGrain;
          float cellPx = 1.0 / max(length(fwidth(sd)), 1e-5), bPx = 1.0 / max(length(fwidth(bd)), 1e-5), fPx = 1.0 / max(length(fwidth(fd)), 1e-5);
          float I = 0.0, dust = 0.0;
          if ((disk * lon + bul) * 3.0 + glow * lon > 0.004) {   // (its clouds and dust only where there is a band to have them)
            // star clouds, clumped as a long exposure shows them: broad clouds drawn out along the band, round knots in
            // them (~1°), mottled (~0.4°)
            vec3 gk = g * mix(1.0, uGrain, 0.6);
            float n1 = sfbm(gn * 6.0), n2 = sfbm(gk * 30.0 + 3.0), n4 = sfbm(gk * 72.0 + 11.0);
            float clouds = (0.35 + 1.3 * pow(smoothstep(0.22, 0.85, n1), 1.3)) * (0.5 + 0.9 * smoothstep(0.32, 0.8, n2)) * (0.65 + 0.7 * smoothstep(0.3, 0.72, n4));
            // the dust in front of them: dark clouds drawn out a little along the band, the Great Rift, and a few winding
            // lanes, broken (the ridges of a noise, where a second one lets them be)
            vec3 gf = vec3(g.xy, g.z * uBand * 0.5) * mix(1.0, uGrain, 0.6);
            float lanes = smoothstep(0.74, 0.95, ridge(gf * 4.5 + 5.0)) * smoothstep(0.42, 0.62, sfbm(gn * 3.0 + 21.0));
            float dark = smoothstep(0.5, 0.65, sfbm(gf * 9.0 + 7.0));
            float rb = b - 0.075 + 0.07 * (n1 - 0.5) + 0.08 * (n2 - 0.5), rift = exp(-rb * rb / ((0.0016 + 0.004 * exp(-l * l / 0.15)) * (0.45 + 1.1 * n4)));
            rift = smoothstep(0.22, 0.72, rift + 0.4 * (n4 - 0.5) + 0.25 * (n2 - 0.5)) * smoothstep(-0.25, 0.0, l) * smoothstep(1.5, 1.2, l);   // the Great Rift, Cygnus to Ophiuchus, down one side of the band: winding, now wide now narrow (wider toward the centre), its edges ragged
            dust = clamp(0.92 * rift + 0.6 * dark + 0.7 * lanes * smoothstep(0.04, 0.4, disk + bul), 0.0, 0.95);
            I = (disk * lon + 0.8 * bul) * clouds * (1.0 - dust) + glow * lon * (1.0 - 0.4 * dust);
            // its colour: blue-white star clouds (whiter where they are thickest), a cream core in a warm brown-orange glow,
            // the light reddened where the dust thins it
            vec3 tint = mix(mix(vec3(0.62, 0.72, 1.0), vec3(0.86, 0.9, 1.0), smoothstep(0.7, 1.8, clouds)), mix(vec3(1.0, 0.64, 0.42), vec3(1.0, 0.88, 0.72), smoothstep(0.3, 0.8, bul)), kw);
            tint *= mix(vec3(1.0), vec3(1.0, 0.7, 0.48), smoothstep(0.15, 0.75, dust));
            c += uMW * I * tint * uMWK * 0.48;   // (its glow: the rest of its light is in its stars, below)
            // the pink of the glowing hydrogen in the clouds round the centre (the Lagoon and Trifid nebulae, and others)
            float em = smoothstep(0.6, 0.8, sfbm(gn * 26.0 + 13.0)) * exp(-l * l / 0.07 - b * b / 0.03) * (1.0 - 0.8 * dust);
            c += uMW * em * vec3(1.0, 0.3, 0.45) * uMWK * 0.25;
          }
          // its finest grain: the faint stars it is made of, as thick as the band is bright (a cell of the sky ~0.03° across
          // holds one or none, where it falls in the cell, how bright), let go where cells come smaller than two pixels
          { vec3 ci = floor(sd), cf = fract(sd) - 0.5;
            float s1 = fract(sin(dot(ci, vec3(12.9898, 78.233, 37.719))) * 43758.5453), s2 = fract(s1 * 37.13 + 0.17), s3 = fract(s1 * 91.7 + 0.53), s4 = fract(s1 * 13.1 + 0.71);
            float sdd = length(cf - (vec3(s2, s3, s4) - 0.5) * 0.6);
            float grain = smoothstep(0.32, 0.0, sdd) * step(s1, clamp(I * 1.7, 0.0, 0.85)) * (0.3 + 0.7 * s3 * s3) * smoothstep(1.2, 2.4, cellPx);
            c += uMW * grain * mix(vec3(0.76, 0.85, 1.0), vec3(1.0, 0.92, 0.8), s2 * 0.7) * 0.719; }
          // its stars that a long exposure picks out one by one, as many and as bright as the band is there, so that it
          // sparkles (cells of ~0.1°; each a soft point a pixel or two across, its size in pixels whatever the view, kept
          // inside its cell)
          { vec3 bi = floor(bd), bf = fract(bd) - 0.5;
            float k1 = fract(sin(dot(bi, vec3(269.5, 183.3, 246.1))) * 43758.5453), k2 = fract(k1 * 29.71 + 0.43), k3 = fract(k1 * 67.13 + 0.29), k4 = fract(k1 * 11.37 + 0.77), k5 = fract(k1 * 83.91 + 0.59);
            float k53 = k5 * k5 * k5, rq = length(bf - (vec3(k2, k3, k4) - 0.5) * 0.3) * bPx, sq = 0.65 + 0.45 * k53;
            float sb = step(k1, clamp(I * 1.2, 0.0, 0.9)) * (0.1 + 0.8 * k53) * (0.5 + 0.7 * min(I, 1.5)) * exp(-rq * rq / (2.0 * sq * sq)) * smoothstep(2.5, 5.0, bPx);
            c += uMW * sb * mix(vec3(0.8, 0.87, 1.0), vec3(1.0, 0.86, 0.66), max(kw, step(0.8, k4))) * 0.719; }
          // the field: faint stars all over the sky, thicker toward the band and fewer behind its dust, as the photo is
          // crowded with them (cells of ~0.15°, a star in about a third of them, most faint, a few bright, the brighter the
          // wider; let go where the cells come under 3 pixels)
          if (uField > 0.0) {
            vec3 fi = floor(fd), ff = fract(fd) - 0.5;
            float h1 = fract(sin(dot(fi, vec3(127.1, 311.7, 74.7))) * 43758.5453), h2 = fract(h1 * 41.37 + 0.31), h3 = fract(h1 * 73.11 + 0.61), h4 = fract(h1 * 19.73 + 0.87), h5 = fract(h1 * 57.29 + 0.13);
            float rp = length(ff - (vec3(h2, h3, h4) - 0.5) * 0.3) * fPx, hide = dust * smoothstep(0.05, 0.4, disk + bul);
            float p = (0.42 + 0.25 * smoothstep(0.02, 0.6, I)) * (1.0 - 0.7 * hide), h54 = h5 * h5 * h5 * h5, sig = 0.7 + 0.9 * h54;
            float fs = step(h1, p * uField) * (0.08 + h54) * exp(-rp * rp / (2.0 * sig * sig)) * smoothstep(2.5, 5.0, fPx);
            c += uMW * fs * mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.86, 0.68), step(0.85, h4)) * 1.2;
          }
        }
        c *= exp(-uExtM * (airmass(el) - 1.0)) * smoothstep(-0.01, uHz, el);   // dimmed by the air and lost in the haze low down
        c += uMW * vec3(0.012, 0.022, 0.013) * smoothstep(0.0, 0.06, el) * exp(-el / 0.3);   // the airglow: the upper air's own faint green light, low in a dark sky
        float mn = max(dot(d, uMoon), 0.0);
        c += uMoonK * vec3(0.05, 0.065, 0.09) * (0.35 * pow(mn, 6.0) + 0.65 * pow(mn, 60.0));   // the moon's light in the air round it
        float a = uDeep * smoothstep(-0.02, 0.04, el);   // the dark over the dome, a hint of teal in it
        c += a * vec3(0.0, 0.028, 0.046);
        c *= uNight * cov; a *= uNight * cov; if (max(c.r, max(c.g, c.b)) < 0.002 && a < 0.004) discard;
        gl_FragColor = vec4(c, a); }`,
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false }));   // (normal blending, premultiplied: ONE, ONE − alpha)
  mw.frustumCulled = false; mw.renderOrder = 0; sky.add(mw);
}
// the sky turned to this minute: equatorial → the room, by the local sidereal time and the room's compass
const _E = new THREE.Vector3(), _N = new THREE.Vector3(), _Z = new THREE.Vector3(), _gt = new THREE.Matrix3();
const _sX = new THREE.Vector3(), _sP = new THREE.Vector3(), _sY = new THREE.Vector3(), _sZ = new THREE.Vector3(), _sM = new THREE.Matrix3();
function skyDir(az, el, v) { const p = (az - 103.7) * SDEG, e = el * SDEG; return v.set(Math.cos(e) * Math.cos(p), Math.sin(e), Math.cos(e) * Math.sin(p)); }   // (the room's compass: fx/hour.js sunDirAt)
function stepStars() {
  SKYN.value = NIGHT.u.value * SKYCLEAR.value;
  if (!SKYSET.real) {   // the painter's sky: the galactic centre and the plane through it, set where SKYSET says
    const key = SKYSET.a.join() + '|' + SKYSET.b.join() + '|' + SKYSET.lc;
    if (key !== SKYSET.key) {
      SKYSET.key = key; skyDir(SKYSET.a[0], SKYSET.a[1], _sX); skyDir(SKYSET.b[0], SKYSET.b[1], _sP);
      _sZ.crossVectors(_sX, _sP).normalize();                      // the plane through a and b: its north pole
      _sP.add(_sX).normalize(); _sY.crossVectors(_sZ, _sP);        // the middle of the two, and the way along the plane toward b there
      const t = SKYSET.lc * SDEG; _sX.copy(_sP).multiplyScalar(Math.cos(t)).addScaledVector(_sY, -Math.sin(t));   // the centre: lc back along it
      _sY.crossVectors(_sZ, _sX);                                   // (longitude 90° along it toward b)
      _sM.set(_sX.x, _sY.x, _sZ.x, _sX.y, _sY.y, _sZ.y, _sX.z, _sY.z, _sZ.z);   // galactic → the room
      STARU.uEq.value.multiplyMatrices(_sM, GAL); STARU.uGal.value.copy(_sM).transpose();
      STARU.uExtS.value = 0.07; STARU.uExtM.value = 0.07; STARU.uHz.value = 0.035; STARU.uBand.value = 3.4; STARU.uMWK.value = 1.483; STARU.uBandStars.value = 1; STARU.uGrain.value = 2.4; STARU.uBandMag.value = -1.59;   // (10 % brighter and clearer again: G, 16/10/2026; then 30 % less light from it, measured: G, 17/10/2026)
      STARU.uField.value = 1; STARU.uFaintMag.value = -1.0;   // (the sky crowded with faint stars, as G's photo of it is: 16/10/2026)
    }
  } else stepRealSky();
  skyLight();
}
function stepRealSky() {
  STARU.uExtS.value = 0.2; STARU.uExtM.value = 0.32; STARU.uHz.value = 0.12; STARU.uBand.value = 1; STARU.uMWK.value = 0.42; STARU.uBandStars.value = 0; STARU.uGrain.value = 1; STARU.uBandMag.value = 0; STARU.uField.value = 0; STARU.uFaintMag.value = 0;
  const d = HOUR.pin || new Date(), P = window.HL_SUN.place, lat = P.lat * SDEG, lon = P.lon;
  const jd = d.getTime() / 864e5 + 2440587.5, th = ((280.46061837 + 360.98564736629 * (jd - 2451545.0) + lon) % 360) * SDEG;   // local sidereal time
  const sf = Math.sin(lat), cf = Math.cos(lat), st = Math.sin(th), ct = Math.cos(th), p0 = 103.7 * SDEG, sp = Math.sin(p0), cp = Math.cos(p0);
  _Z.set(cf * ct, cf * st, sf); _N.set(-sf * ct, -sf * st, cf); _E.set(-st, ct, 0);   // the zenith, north and east, in equatorial terms
  const X = _E.clone().multiplyScalar(sp).addScaledVector(_N, cp), Z = _E.clone().multiplyScalar(cp).addScaledVector(_N, -sp);   // the room's x and z (as the sun is placed: fx/hour.js sunDirAt)
  STARU.uEq.value.set(X.x, X.y, X.z, _Z.x, _Z.y, _Z.z, Z.x, Z.y, Z.z);
  STARU.uGal.value.copy(GAL).multiply(_gt.copy(STARU.uEq.value).transpose());   // the room → galactic
}
function skyLight() {   // how faint a star is still seen, and how bright the Milky Way: the dark of the night, the moon's light
  const e = HOUR.e === null ? -20 : HOUR.e, lit = 0.5 - 0.5 * Math.cos(moonAge() * 2 * Math.PI), up = OVER.moon && OVER.moon.visible ? 1 : 0;
  STARU.uMoonK.value = up * Math.pow(lit, 0.8);
  const mk = STARU.uMoonK.value * (SKYSET.real ? 1 : 0.4);   // (the painter's sky is set for its look: the moon takes less of it)
  STARU.uLim.value = 6.5 - 5.0 * THREE.MathUtils.smoothstep(e, -18, -4) - 1.8 * mk;   // (the twilight's glow, then the moon's)
  STARU.uMW.value = (1 - THREE.MathUtils.smoothstep(e, -17, -10)) * (1 - 0.88 * mk) * (STARU.boost || 1);   // (out as the twilight ends; boost: for tests)
  STARU.uDeep.value = 0.65 * (1 - THREE.MathUtils.smoothstep(e, -16, -9)) * (1 - 0.5 * mk);   // the dark of the sky itself, deep once the twilight is over (less under the moon)
  if (OVER.moon) STARU.uMoon.value.copy(OVER.moon.position).sub(REF.eye).normalize();
  STARU.uEye.value.copy(REF.eye);
}

const LUNAR = 29.530588853, NEW_MOON = Date.UTC(2025, 6, 25, 18, 2);   // the page's own reference new moon
const moonAge = (t = Date.now()) => ((((t - NEW_MOON) / 864e5) % LUNAR) + LUNAR) % LUNAR / LUNAR;   // 0 new, 0.5 full
const SKY_DEPTH = 'if (gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 1e-7) discard;';
// how much of a pixel shows sky, softly: the room's depth is a coarser grid than the screen (80 % of CSS pixels against
// the screen's two a pixel), so a test of its one nearest texel left the leaves' edges against a lit sky in steps (G,
// 16/10/2026: the trees by night jagged where by day they were not); 3 × 3 taps across a texel and a third, averaged
const SKY_COVER = `float skyCover() {
  vec2 uv = gl_FragCoord.xy / uRes, tx = 0.66 / vec2(textureSize(uDepth, 0)); float s = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) s += step(gl_FragCoord.z, texture2D(uDepth, uv + vec2(float(i), float(j)) * tx).r + 1e-7);
  return s / 9.0; }`;
function buildNightSky() {
  const eye = REF.eye, far = 240, sky = new THREE.Group(); sky.visible = false; OVER.sky = sky;
  OVER.skyScene = new THREE.Scene(); OVER.skyScene.add(sky);   // (a scene of its own, drawn before the rest of the sharp layer: its dark is laid over the dome, so all else goes in front of it)
  OVER.moonAge = { value: moonAge() };
  buildStars(sky);
  // the moon: the page's own moon picture for tonight's phase (the one its sky clock shows), 1.6° across (the real one is
  // 0.5°), with a soft halo
  const rad = far * Math.tan(0.8 * Math.PI / 180);
  OVER.moonImg = { value: null };
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(6 * rad, 6 * rad), new THREE.ShaderMaterial({
    uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uNight: SKYN, uAge: OVER.moonAge, uImg: OVER.moonImg },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uDepth, uImg; uniform vec2 uRes; uniform float uNight, uAge; varying vec2 vUv; ${SKY_COVER}
      void main(){ float cov = skyCover(); if (cov < 0.01) discard;
        vec2 p = (vUv - 0.5) * 6.0; float r = length(p), lit = 0.5 - 0.5 * cos(uAge * 6.2831853);
        vec4 c = vec4(0.0);
        if (r < 1.02) { vec4 m = texture2D(uImg, p * 0.5 + 0.5); c = vec4(m.rgb * m.a, m.a); }   // straight-alpha picture, made premultiplied
        float halo = 0.3 * exp(-max(r - 1.0, 0.0) * 1.7) * (0.45 + 0.55 * lit) * smoothstep(3.0, 2.2, r) * (1.0 - c.a);
        c += vec4(vec3(0.82, 0.86, 1.0) * halo, halo);
        if (c.a < 0.004) discard; gl_FragColor = c * uNight * cov; }`,
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false }));
  moon.visible = false;   // until its picture has loaded
  moon.renderOrder = 3;   // (over the Milky Way, the stars and the comet: it hides them)
  sky.add(moon); OVER.moon = moon; placeMoon();
  buildMeteors(sky);
}
/* ---- shooting stars, now and then, as the garden's night sky draws them (3d-garden: app/core/night-sky.js): about one
   in 16 s at full night, at most three at once, each a streak across the sky in about a second (the faster the
   shorter; half the speed they first had, G 15/10/2026), its tail thinning out behind a bright round head, now and then a brighter, slower fireball; and only
   where the room shows sky (they pass 230 m off, inside the stars' sphere, under the same depth test). Each is a strip
   on the screen, rebuilt every frame from its two ends on the sky. Where one flies is chosen so that it is seen: when
   one is due, 32 paths are tried against the room's depth on the GPU (two points of each, a third and two thirds of
   the way, where it burns brightest; one row of pixels, read back without stalling the frame) and the first whose
   two points both show sky, with none of the page's panels over them, is sent; if none does, it is tried again 1.5 s later, up to five times (a view with little
   sky still gets its share; one with none, none). */
const METEOR = { list: [], mesh: null, on: false, last: 0 };
const _m0 = new THREE.Vector3(), _m1 = new THREE.Vector3(), _mh = new THREE.Vector3(), _mt = new THREE.Vector3();
function buildMeteors(sky) {
  const MQ = 3, idx = []; for (let k = 0; k < MQ; k++) idx.push(4 * k, 4 * k + 1, 4 * k + 2, 4 * k + 2, 4 * k + 1, 4 * k + 3);
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MQ * 12), 3)); g.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(MQ * 16), 4)); g.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(MQ * 12), 3));
  METEOR.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uNight: SKYN },
    vertexShader: 'attribute vec4 aC; attribute vec3 aT; varying vec4 vC; varying vec3 vT; void main(){ vC = aC; vT = aT; gl_Position = vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNight; varying vec4 vC; varying vec3 vT; ${SKY_COVER}
      void main(){ float cov = skyCover(); if (cov < 0.01) discard;
        float u = clamp(vT.x, 0.0, 1.0), w = vT.y * vT.y;
        float k = pow(u, 2.6) * exp(-w * 5.0) + 1.6 * exp(-pow((1.0 - u) / 0.05, 2.0) - w * 1.5);   // the tail thinning out, the head bright
        float a = vC.a * k * smoothstep(1.04, 0.995, vT.x) * uNight * cov * 0.8; if (a < 0.003) discard;      // (a round tip, not a square end; 20 % fainter: G, 16/10/2026)
        gl_FragColor = vec4(vC.rgb * a, 0.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true, depthTest: false, depthWrite: false }));   // (added as it is: ONE, ONE)
  METEOR.mesh.frustumCulled = false; METEOR.mesh.visible = false; METEOR.mesh.renderOrder = 4; sky.add(METEOR.mesh);   // (in our air: in front of the moon)
  METEOR.spawn = spawnMeteor; METEOR.probe = PROBE;   // (for tests)
  METEOR.moonPos = () => { const p = OVER.moon.position.clone().project(OVER.cam || window.__lib3d.camera); return [(p.x + 1) * innerWidth / 2, (1 - p.y) * innerHeight / 2]; };   // (for tests)
  buildComet(sky);
}
function meteorPath(camera) {   // a start somewhere in the upper part of the view, 6° or more up; a path down and across
  _m0.set(Math.random() * 1.9 - 0.95, 0.15 + Math.random() * 0.8, 0.5).unproject(camera).sub(camera.position).normalize();
  if (_m0.y < 0.1) return null;   // (6° up or more)
  const side = _mh.set(0, 1, 0).cross(_m0).normalize(), down = _mt.crossVectors(_m0, side), th = Math.random() * Math.PI * 2;
  const tn = side.multiplyScalar(Math.cos(th)).addScaledVector(down, Math.sin(th) - 0.35); tn.addScaledVector(_m0, -tn.dot(_m0)).normalize();   // (leaning a little downward)
  const fire = Math.random() < 0.05, v = fire ? 18 + Math.random() * 14 : 20 + Math.random() * 50, ang = (fire ? 14 + Math.random() * 12 : 5 + Math.random() * 15) * Math.PI / 180;
  return { d0: _m0.clone(), d1: _m0.clone().multiplyScalar(Math.cos(ang)).addScaledVector(tn, Math.sin(ang)).normalize(), t: 0,
    dur: 2 * Math.min(fire ? 2.2 : 1.4, Math.max(0.3, ang * 180 / Math.PI / (v * 0.45 * (0.8 + 0.4 * Math.random())))), b: fire ? 2.2 : 0.9 + Math.random() * 0.8,   // (half the speed: G 15/10/2026)
    w: fire ? 1.7 : 1, fast: Math.min(1, Math.max(0, (v - 35) / 30)) };
}
const PROBE = { n: 32, rt: null, quad: null, cand: [], busy: false, buf: new Uint8Array(256), left: 0, at: 0, tries: 0, sent: 0 };   // (tries, sent: for tests)
// n paths from make() tried against the room's depth on the GPU: the first whose two points (f0 and f1 of the way along
// it) show sky, with none of the page's panels over them, goes to hit(); miss() if none does. false if a probe is
// already out (it is read back without stalling the frame)
function probeSky(camera, make, f0, f1, hit, miss) {
  if (PROBE.busy || !OVER.u.uDepth.value) return false;
  if (!PROBE.rt) {
    PROBE.rt = new THREE.WebGLRenderTarget(2 * PROBE.n, 1, { depthBuffer: false });
    PROBE.quad = new FullScreenQuad(new THREE.ShaderMaterial({ depthTest: false, depthWrite: false,
      uniforms: { uDepth: OVER.u.uDepth, uP: { value: Array.from({ length: 2 * PROBE.n }, () => new THREE.Vector3()) } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D uDepth; uniform vec3 uP[${2 * PROBE.n}];
        void main() { vec3 p = uP[int(gl_FragCoord.x)]; vec2 uv = p.xy * 0.5 + 0.5;   // one pixel per point: 1 where it shows sky
          bool on = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && p.z < 1.0 && p.z * 0.5 + 0.5 <= texture2D(uDepth, uv).r + 1e-7;
          gl_FragColor = vec4(on ? 1.0 : 0.0, 0.0, 0.0, 1.0); }` }));
  }
  const C = PROBE.cand, U = PROBE.quad.material.uniforms.uP.value; C.length = 0; PROBE.tries++;
  for (let i = 0; i < PROBE.n; i++) {
    const e = make(); C.push(e);
    if (!e) { U[2 * i].set(9, 9, 9); U[2 * i + 1].set(9, 9, 9); continue; }
    for (let j = 0; j < 2; j++) U[2 * i + j].copy(e.d0).lerp(e.d1, j ? f1 : f0).normalize().multiplyScalar(230).add(camera.position).project(camera);
  }
  const prev = renderer.getRenderTarget(); renderer.setRenderTarget(PROBE.rt); PROBE.quad.render(renderer);
  const done = () => {
    PROBE.busy = false;
    const r = CANVAS.getBoundingClientRect(), bare = q => document.elementFromPoint(r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height) === CANVAS;
    let found = null;
    for (let i = 0; i < PROBE.n && !found; i++) if (C[i] && PROBE.buf[8 * i] > 127 && PROBE.buf[8 * i + 4] > 127 && bare(U[2 * i]) && bare(U[2 * i + 1])) found = C[i];
    C.length = 0; if (found) { hit(found); setNeeds(true); } else if (miss) miss();
  };
  if (renderer.readRenderTargetPixelsAsync) {   // (it leaves its target bound until it resolves: the frame's own put back at once)
    PROBE.busy = true; renderer.readRenderTargetPixelsAsync(PROBE.rt, 0, 0, 2 * PROBE.n, 1, PROBE.buf).then(done, () => { PROBE.busy = false; });
  } else { renderer.readRenderTargetPixels(PROBE.rt, 0, 0, 2 * PROBE.n, 1, PROBE.buf); done(); }
  renderer.setRenderTarget(prev);
  return true;
}
function spawnMeteor(camera) {   // 32 paths tried: the first whose bright middle (a third and two thirds of the way) shows sky is sent
  if (METEOR.list.length >= 3) return;
  probeSky(camera, () => meteorPath(camera), 0.3, 0.7,
    e => { if (METEOR.list.length < 3) { METEOR.list.push(e); PROBE.sent++; } PROBE.left = 0; },
    () => { PROBE.left = Math.max(0, PROBE.left - 1); });
}
function stepMeteors(t, camera) {
  stepStars();
  const dt = Math.min(0.1, Math.max(0, t - METEOR.last)); METEOR.last = t;
  const night = NIGHT.u.value, M = METEOR.list, mesh = METEOR.mesh; if (!mesh) return;
  if (night > 0.6 && SKYCLEAR.value > 0.5 && Math.random() < dt / 16) PROBE.left = 5;   // one due (tried until it finds sky, five times at most)
  if (PROBE.left && M.length < 3 && t - PROBE.at > 1.5) { PROBE.at = t; spawnMeteor(camera); }
  const g = mesh.geometry, P = g.attributes.position.array, C = g.attributes.aC.array, T = g.attributes.aT.array, W = OVER.u.uRes.value.x / 2, H = OVER.u.uRes.value.y / 2;
  let nq = 0;
  for (let i = M.length - 1; i >= 0; i--) {
    const e = M[i]; e.t += dt; const k = e.t / e.dur; if (k >= 1) { M.splice(i, 1); continue; }
    const at = Math.max(0, k - 0.35 - 0.25 * e.fast), fl = Math.sin(Math.PI * Math.pow(k, 1.4));
    const head = _mh.copy(e.d0).lerp(e.d1, k).normalize().multiplyScalar(230).add(camera.position).project(camera);
    const tail = _mt.copy(e.d0).lerp(e.d1, at).normalize().multiplyScalar(230).add(camera.position).project(camera);
    if (head.z > 1 || tail.z > 1) continue;
    let dx = (head.x - tail.x) * W, dy = (head.y - tail.y) * H; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const wpx = 1.3 * e.w * (OVER.u.uPR ? OVER.u.uPR.value : 1), nx = -dy * wpx / W, ny = dx * wpx / H, ex = dx * wpx * 1.5 / W, ey = dy * wpx * 1.5 / H, o = nq * 12, oc = nq * 16;
    const Q = [tail.x + nx, tail.y + ny, tail.z, tail.x - nx, tail.y - ny, tail.z, head.x + nx + ex, head.y + ny + ey, head.z, head.x - nx + ex, head.y - ny + ey, head.z];
    for (let j = 0; j < 4; j++) { P[o + 3 * j] = Q[3 * j]; P[o + 3 * j + 1] = Q[3 * j + 1]; P[o + 3 * j + 2] = Q[3 * j + 2];
      C[oc + 4 * j] = 0.95 - 0.25 * e.fast; C[oc + 4 * j + 1] = 0.9 + 0.08 * e.fast; C[oc + 4 * j + 2] = 0.7 + 0.25 * e.fast; C[oc + 4 * j + 3] = e.b * fl;
      T[o + 3 * j] = j < 2 ? 0 : 1.04; T[o + 3 * j + 1] = j % 2 ? -1 : 1; T[o + 3 * j + 2] = 0; }
    nq++;
  }
  g.setDrawRange(0, nq * 6); mesh.visible = nq > 0; METEOR.on = M.length > 0;
  if (nq) { g.attributes.position.needsUpdate = g.attributes.aC.needsUpdate = g.attributes.aT.needsUpdate = true; }
  stepComet(t, dt, camera);
}
/* ---- a comet gliding by now and then (G, 15/10/2026: "sao chổi lướt qua nhẹ nhàng"): a little while after night falls,
   then every three or four minutes, one drifts across the sky in about forty seconds, fading in and out. Drawn as a
   comet looks: a soft greenish coma round a bright point (its gas glows green: diatomic carbon), a dust tail behind it,
   widening and fading, curving a little away from its path and finely streaked, and a narrower, straight blue ion tail
   leaning up and away (the two tails of a comet like Hale-Bopp). Sizes are angles on the sky (a tail of 2.3 to 3.3°:
   a quarter of the first size, G 15/10/2026, halved twice), so it looks the same however far the view is zoomed; its
   thinnest parts are kept about a pixel wide. The tails move as they do in
   a comet's time-lapse, slowed down to a few seconds: matter streams away from the head (the striae of the dust tail
   and the knots of the ion tail drift outward along them), the ion tail's rays brighten and fade and it waves like a
   flag in the solar wind (a kink running down it), and the dust tail's bend breathes a little. Its path is chosen as a shooting star's is (probeSky: its middle
   half where the room shows sky), and it is drawn under the same depth test, added to the sky. */
const COMET = { mesh: null, e: null, next: 0, on: false, spawn: null };
METEOR.comet = COMET;
const NS = 24, NI = 16, _cv = new THREE.Vector3(), _cm = new THREE.Vector3(), _cn = new THREE.Vector3(), _cu = new THREE.Vector3(), _ci = new THREE.Vector3(), _cs = new THREE.Vector3(), _cp = [];
function buildComet(sky) {
  const nv = (NS + 1) * 2 + (NI + 1) * 2 + 4, idx = [], strip = (o, n) => { for (let i = 0; i < n; i++) { const a = o + 2 * i; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); } };
  strip(0, NS); strip((NS + 1) * 2, NI); const c0 = (NS + 1) * 2 + (NI + 1) * 2; idx.push(c0, c0 + 1, c0 + 2, c0 + 2, c0 + 1, c0 + 3);
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  for (const [k, n] of [['position', 3], ['aT', 3], ['aC', 4]]) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(nv * n), n));
  COMET.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { uDepth: OVER.u.uDepth, uRes: OVER.u.uRes, uNight: SKYN, uTime: OVER.u.uTime },
    vertexShader: 'attribute vec4 aC; attribute vec3 aT; varying vec4 vC; varying vec3 vT; void main(){ vC = aC; vT = aT; gl_Position = vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNight, uTime; varying vec4 vC; varying vec3 vT; ${SKY_COVER}
      void main(){ float cov = skyCover(); if (cov < 0.01) discard;
        float u = clamp(vT.x, 0.0, 1.0), v = vT.y, k; vec3 col = vC.rgb;
        if (vT.z < 0.5) {   // the dust tail: striae fanning out and drifting away from the head, the density breathing as it flows
          float fl = u * 7.0 - uTime * 0.32;
          float st = 0.78 + 0.22 * sin(v * 6.5 + u * 4.0 + 0.7 * sin(fl)) * sin(v * 11.0 - u * 2.5 + uTime * 0.06);
          k = exp(-v * v * 2.4) * pow(1.0 - u, 1.6) * st * (0.84 + 0.16 * sin(fl * 1.7 + v * 1.3));
        } else if (vT.z < 1.5) {   // the ion tail: a few thin rays, each brightening and fading, knots streaming out along them
          float r = 0.0;
          for (int i = 0; i < 3; i++) { float fi = float(i), c = (fi - 1.0) * 0.45 + 0.12 * sin(uTime * 0.21 + fi * 2.3 + u * 3.0);
            float kn = 0.55 + 0.45 * sin(u * 15.0 - uTime * (1.5 + 0.3 * fi) + fi * 2.1);
            r += exp(-pow((v - c) / (0.16 + 0.1 * u), 2.0)) * kn * (0.6 + 0.4 * sin(uTime * (0.35 + 0.13 * fi) + fi * 1.7)); }
          k = (0.45 * exp(-v * v * 5.0) + 0.55 * r) * pow(1.0 - u, 1.25);
        }
        else { float r2 = dot(vT.xy, vT.xy); k = 0.42 * exp(-r2 * 3.0) + 0.62 * exp(-r2 * 18.0) * (0.95 + 0.05 * sin(uTime * 1.3)); col = mix(col, vec3(1.0, 1.0, 0.97), exp(-r2 * 14.0)); }   // the coma, a white point at its heart
        float a = vC.a * k * uNight * cov * 0.8; if (a < 0.002) discard;   // (20 % more see-through: G, 16/10/2026)
        gl_FragColor = vec4(col * a, 0.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true, depthTest: false, depthWrite: false }));
  COMET.mesh.frustumCulled = false; COMET.mesh.visible = false; COMET.mesh.renderOrder = 2; sky.add(COMET.mesh);   // (far beyond the moon: behind it)
  for (let i = 0; i <= Math.max(NS, NI); i++) _cp.push(new THREE.Vector3());
  COMET.spawn = camera => probeSky(camera, () => cometPath(camera), 0.25, 0.75, e => { COMET.e = e; });   // (for tests)
}
function cometPath(camera) {   // somewhere in the upper part of the view, 12° or more up; across the sky, drifting a little down
  _m0.set(Math.random() * 1.6 - 0.8, 0.2 + Math.random() * 0.7, 0.5).unproject(camera).sub(camera.position).normalize();
  if (_m0.y < 0.2) return null;
  const side = _mh.set(0, 1, 0).cross(_m0).normalize(), up = _mt.crossVectors(_m0, side), dir = Math.random() < 0.5 ? 1 : -1;
  const tn = side.multiplyScalar(dir).addScaledVector(up, -0.12 + (Math.random() - 0.5) * 0.3); tn.addScaledVector(_m0, -tn.dot(_m0)).normalize();
  const ang = (12 + Math.random() * 8) * Math.PI / 180;
  return { d0: _m0.clone(), d1: _m0.clone().multiplyScalar(Math.cos(ang)).addScaledVector(tn, Math.sin(ang)).normalize(), t: 0, dur: 36 + Math.random() * 10,
    L: (9 + Math.random() * 4) * Math.PI / 180, curl: (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.12), b: 0.85 + Math.random() * 0.25 };
}
function stepComet(t, dt, camera) {
  const C = COMET, mesh = C.mesh; if (!mesh) return;
  if (!C.e) {
    C.on = false; mesh.visible = false;
    if (NIGHT.u.value <= 0.6 || SKYCLEAR.value < 0.5) { C.next = Math.max(C.next, t + 15 + Math.random() * 20); return; }   // (the first a little after night falls)
    if (t > C.next && probeSky(camera, () => cometPath(camera), 0.25, 0.75, e => { C.e = e; })) C.next = t + 4;   // (no sky in view: tried again in a while)
    return;
  }
  const e = C.e; e.t += dt; const k = e.t / e.dur;
  if (k >= 1) { C.e = null; C.next = t + 150 + Math.random() * 120; C.on = false; mesh.visible = false; return; }
  const fade = THREE.MathUtils.smoothstep(k, 0, 0.13) * (1 - THREE.MathUtils.smoothstep(k, 0.8, 1)) * e.b;
  const H = _cv.copy(e.d0).lerp(e.d1, k).normalize(), m = _cm.copy(e.d1).sub(e.d0); m.addScaledVector(H, -m.dot(H)).normalize();   // where it is, and which way it goes
  const n = _cn.crossVectors(H, m).normalize(), up = _cu.set(0, 1, 0); up.addScaledVector(H, -up.dot(H)).normalize();
  const ion = _ci.copy(m).multiplyScalar(-0.85).addScaledVector(up, 0.53).normalize(), side = _cu.crossVectors(H, ion).normalize();   // (up is done with)
  const g = mesh.geometry, P = g.attributes.position.array, T = g.attributes.aT.array, A = g.attributes.aC.array;
  const W = OVER.u.uRes.value.x / 2, Hh = OVER.u.uRes.value.y / 2, ppr = Hh / Math.tan(camera.fov * Math.PI / 360);   // pixels a radian, near the middle
  const at = d => d.multiplyScalar(230).add(camera.position).project(camera), minPx = 1.1 * (OVER.u.uPR ? OVER.u.uPR.value : 1);
  let o = 0;
  const tail = (N, pt, w0, w1, kind, col, alpha) => {   // a strip along points pt(s), s from the head (0) to the end (1)
    for (let i = 0; i <= N; i++) { _cp[i].copy(pt(i / N)); if (at(_cp[i]).z > 1) return false; }
    for (let i = 0; i <= N; i++) {
      const a = _cp[Math.max(0, i - 1)], b = _cp[Math.min(N, i + 1)]; let tx = (b.x - a.x) * W, ty = (b.y - a.y) * Hh; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const s = i / N, wpx = Math.max(minPx, (w0 + (w1 - w0) * s) * ppr), nx = -ty * wpx / W, ny = tx * wpx / Hh;
      for (let j = 0; j < 2; j++) { const sg = j ? -1 : 1, v = o + 2 * i + j;
        P[v * 3] = _cp[i].x + nx * sg; P[v * 3 + 1] = _cp[i].y + ny * sg; P[v * 3 + 2] = _cp[i].z;
        T[v * 3] = s; T[v * 3 + 1] = sg; T[v * 3 + 2] = kind; A[v * 4] = col[0]; A[v * 4 + 1] = col[1]; A[v * 4 + 2] = col[2]; A[v * 4 + 3] = alpha; }
    }
    o += 2 * (N + 1); return true;
  };
  const D = Math.PI / 180, L = e.L * 0.25, Li = L * 0.85, curl = e.curl * (1 + 0.18 * Math.sin(t * 0.27 + e.b * 9));   // (half the first size; the bend breathing)
  const wave = s => Li * s * Math.pow(s, 0.3) * (0.05 * Math.sin(Math.PI * 2 * (1.1 * s - 0.2 * t)) + 0.02 * Math.sin(Math.PI * 2 * (2.3 * s - 0.37 * t) + 1.3));   // (a kink running down the ion tail)
  const ok = tail(NS, s => _cs.copy(H).addScaledVector(m, -s * L).addScaledVector(n, curl * L * s * s).normalize(), 0.075 * D, 0.55 * D, 0, [1.0, 0.95, 0.82], 0.5 * fade)   // (bending away from its path)
    && tail(NI, s => _cs.copy(H).addScaledVector(ion, s * Li).addScaledVector(side, wave(s)).normalize(), 0.065 * D, 0.28 * D, 1, [0.55, 0.75, 1.0], 0.2 * fade);
  if (!ok) { mesh.visible = false; C.on = true; return; }
  const h = at(_cs.copy(H)), r = Math.max(4 * minPx, 0.25 * D * ppr);   // the coma: a square round the head (a soft dot at least)
  for (let j = 0; j < 4; j++) { const sx = j & 1 ? 1 : -1, sy = j & 2 ? 1 : -1, v = o + j;
    P[v * 3] = h.x + sx * r / W; P[v * 3 + 1] = h.y + sy * r / Hh; P[v * 3 + 2] = h.z; T[v * 3] = sx; T[v * 3 + 1] = sy; T[v * 3 + 2] = 2;
    A[v * 4] = 0.75; A[v * 4 + 1] = 1.0; A[v * 4 + 2] = 0.82; A[v * 4 + 3] = 0.95 * fade; }
  g.attributes.position.needsUpdate = g.attributes.aT.needsUpdate = g.attributes.aC.needsUpdate = true;
  mesh.visible = true; C.on = true;
}
// the page's moon pictures (its MOON_IMGS: 8 phase buckets, new moon first), used when its sky clock has not shown one yet
const MOON_IDS = ['35cea205e90443258d2aeaa54414881a', '60161204787446faa5348897ff9578ef', '60161204787446faa5348897ff9578ef', 'f2c8bd9a09d54d75b97bd8ef98842611',
  'b61c8002bffd4d34818b968a0e34aeb9', '5d2bbcc638ca492dbe5f16998fe651a7', 'cb81a46d1ed145098b0f4e9c55197c90', '35cea205e90443258d2aeaa54414881a'];
function moonUrl() {
  const img = document.querySelector('.sky .moon img[src]'), src = img && img.getAttribute('src');
  if (src) return src.replace(/w_\d+,h_\d+/, 'w_256,h_256');
  const id = '1ded0e_' + MOON_IDS[Math.floor(((moonAge() + 0.0625) % 1) / 0.125)];
  return `https://static.wixstatic.com/media/${id}~mv2.png/v1/fill/w_256,h_256,al_c,q_90,enc_auto/${id}.png`;
}
function loadMoon() {
  const url = moonUrl(); if (url === OVER.moonUrl) return; OVER.moonUrl = url;
  new THREE.TextureLoader().setCrossOrigin('anonymous').load(url, t => {
    if (OVER.moonUrl !== url) { t.dispose(); return; }
    t.anisotropy = 4; if (OVER.moonImg.value) OVER.moonImg.value.dispose(); OVER.moonImg.value = t; OVER.moon.visible = true; setNeeds(true);
  });
}
function placeMoon() {   // in the left glass, between the posts at z −6.6 and −4.55: over the transom if the frame shows it, else under it
  if (!OVER.moon) return;
  const az = 13.7 * Math.PI / 180, top = REF.h / 2 - Math.min(REF.h, REF.w * innerHeight / innerWidth) / 2;   // painting row at the frame's top
  const upper = 12.3 * Math.PI / 180, yUp = REF.py - REF.f * Math.tan(upper) / Math.cos(az);   // its lower edge clears the transom's inner top
  const el = yUp - 21 - 5 >= top ? upper : 7.4 * Math.PI / 180, dir = new V3(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  OVER.moon.position.copy(REF.eye).addScaledVector(dir, 240); OVER.moon.lookAt(REF.eye);
}

export { METEOR, SKYCLEAR, SKYSET, STARU, buildNightSky, loadMoon, moonAge, placeMoon, stepMeteors };
