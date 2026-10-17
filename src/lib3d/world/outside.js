import './bush.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { R, REF } from '../core/base.js';
import { canvas, ctex, fbm, hsl, pick, rand, rng } from '../core/utils.js';
import { scene } from '../core/renderer.js';
import { LIGHTS } from './lights.js';
import { WIND } from './wind.js';
import { buildBushes } from './bush.js';
import { NIGHT } from '../fx/night.js';
import { SKYU } from '../fx/hour.js';

/* ---------------------------------------------------------------- outside */
const outside = new THREE.Group(); scene.add(outside);
const LEFT_KEEP = 0.65 * 0.7;   // the share of their leaves the trees past the left glass keep (G, 14/10/2026: 35 % fewer, then 30 % fewer again)
function buildOutside(assets) {
  // ground: lawn + patio
  const gc = canvas(512, 512), gg = gc.getContext('2d'); const id = gg.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const n = fbm(x / 512 * 16, y / 512 * 16, 5, 16, 16); const c = hsl(88 + n * 20, .35, .28 + n * .2); const o = (y * 512 + x) * 4; id.data[o] = c.r * 255; id.data[o + 1] = c.g * 255; id.data[o + 2] = c.b * 255; id.data[o + 3] = 255; }
  gg.putImageData(id, 0, 0); const grassT = ctex(gc); grassT.repeat.set(40, 40);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ map: grassT, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; ground.receiveShadow = true; outside.add(ground);
  const pc = canvas(512, 512), pg = pc.getContext('2d'); pg.fillStyle = '#9a968c'; pg.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) { const ox = (y % 2) * 40; pg.fillStyle = hsl(40, .06, .62 + rand() * .12).getStyle(); pg.fillRect(x * 86 + ox + 2 - 43, y * 64 + 2, 82, 60); pg.fillRect(x * 86 + ox + 2 + 473, y * 64 + 2, 82, 60); }
  const patT = ctex(pc); patT.repeat.set(2, 3.5);
  const patio = new THREE.Mesh(new THREE.PlaneGeometry(4, 11), new THREE.MeshStandardMaterial({ map: patT, roughness: .95 })); patio.rotation.x = -Math.PI / 2; patio.position.set(R.xL - 2.2, -0.1, -3.1); patio.receiveShadow = true; outside.add(patio);
  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uNight: NIGHT.u, uTime: WIND.t, ...SKYU },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uNight, uTime, uDay, uGlow, uWarm, uOv; uniform vec3 uSunDir, uSunCol; varying vec3 vP;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      float fb(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
      void main(){ float h = clamp(vP.y, 0.0, 1.0);   // the stars and the moon are drawn sharp after the watercolour pass (buildNightSky)
        // a clear blue day: deep at the zenith, paler toward the horizon (linear values, before the tone curve)
        vec3 day = mix(vec3(0.3, 0.55, 0.95), vec3(0.04, 0.2, 0.82), pow(h, 0.5));
        // fair-weather clouds on a high layer, drifting slowly; soft lit tops, faintly grey bellies, thinning near the horizon
        vec2 q = vP.xz / max(vP.y + 0.08, 0.08) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
        float n = fb(q), cl = smoothstep(0.47, 0.66, n) * smoothstep(0.02, 0.16, h);
        float lit = smoothstep(0.45, 0.8, fb(q + vec2(0.05, 0.08)));
        // a low sun: the horizon pales to gold and the clouds take the sun's colour
        vec3 dirH = normalize(vec3(vP.x, 0.0, vP.z) + 1e-5), sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
        float toward = 0.5 + 0.5 * dot(dirH, sunH);
        day = mix(day, vec3(0.95, 0.74, 0.48), uWarm * exp(-h * 4.0) * (0.45 + 0.4 * toward));
        vec3 cloud = mix(vec3(0.75, 0.8, 0.92) * (1.0 - 0.25 * uWarm), vec3(1.4, 1.4, 1.36) * uSunCol, lit);
        day = mix(day, cloud, cl);
        // an overcast (fx/rain.js): one grey layer, darker where it is thicker, paler toward the horizon, drifting
        float ovn = fb(vP.xz / max(vP.y + 0.08, 0.08) * 0.5 + vec2(uTime * 0.012, uTime * 0.004));
        vec3 ovc = mix(vec3(0.34, 0.37, 0.41), vec3(0.6, 0.63, 0.67), smoothstep(0.3, 0.72, ovn)) * mix(1.1, 0.9, h);
        day = mix(day, ovc, uOv);
        // twilight: violet low down to deep blue overhead, an orange band on the sun's side, the clouds lit from below
        vec3 twi = mix(vec3(0.34, 0.24, 0.4), vec3(0.05, 0.09, 0.28), pow(h, 0.45));
        twi = mix(twi, mix(vec3(0.1, 0.1, 0.17), vec3(0.95, 0.45, 0.32), pow(toward, 2.0) * 0.8), cl * 0.8);
        vec3 band = mix(vec3(1.0, 0.36, 0.12), vec3(1.0, 0.7, 0.35), smoothstep(0.0, 0.25, h)) * exp(-h * 5.0) * pow(toward, 2.5);
        twi = mix(twi, mix(vec3(0.12, 0.115, 0.15), vec3(0.2, 0.19, 0.23), smoothstep(0.3, 0.72, ovn)), uOv * 0.85);
        vec3 col = mix(twi, day, uDay) + band * uGlow * 1.15 * (1.0 - 0.9 * uOv);
        vec3 night = mix(vec3(0.04, 0.06, 0.11), vec3(0.005, 0.011, 0.032), pow(h, 0.45));   // (a dark country sky overhead, the glow of the air low down)
        night = mix(night, vec3(0.03, 0.033, 0.04) * (0.75 + 0.5 * smoothstep(0.3, 0.72, ovn)), uOv * 0.75);   // (under cloud: a dull dark grey)
        gl_FragColor = vec4(mix(col, night, uNight), 1.0); }` }));
  outside.add(sky); LIGHTS.sky = sky;
  if (!assets) return;
  // trees: instanced (built in code, see makeTrees) — dense ring around the glass pavilion
  const T = assets.trees; const spots = { A: [], B: [], C: [] };
  const inHouse = (x, z) => x > R.xL - 2.2 && x < R.xW + 1.5 && z > R.zB - 1.6 && z < R.zF + 1.6;
  const onPatio = (x, z) => x > R.xL - 4.4 && x < R.xL && z > -7.6 && z < 1.6;
  const r = rng(99); const all = [];
  // the sky stays open through the left glass, from the top of the frame down to the horizon (stars and the moon by night):
  // no tree, near or far, may rise into that part of the home view. A tree is a cylinder the size of its model, projected
  // with the painting's camera; the trees behind the back glass frame the painting and stay.
  const dims = {}; for (const k of ['A', 'B', 'C']) { const b = new THREE.Box3(); for (const pt of T[k].parts) b.union(pt.geometry.boundingBox); dims[k] = { top: b.max.y, rad: Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z) }; }
  const SKYWIN = [-80, 545, 360, 985];   // painting pixels: x from beyond the left edge to the back-left corner, y from above the frame to the horizon
  const inSkyWindow = (x, z, rad, top) => {   // does a cylinder (centre x, z) rise into that part of the view?
    if (x > R.xL - 0.6) return false;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let i = 0; i < 16; i++) { const a = i / 8 * Math.PI, px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad; if (pz > -0.3) continue;
      for (const py of [-0.12, top]) { const u = REF.px + REF.f * px / -pz, v = REF.py - REF.f * (py - REF.eye.y) / -pz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } }
    return u1 > SKYWIN[0] && u0 < SKYWIN[1] && v1 > SKYWIN[2] && v0 < SKYWIN[3];
  };
  const blocksSky = (k, x, z, s) => { const S = T[k].scale * s; return inSkyWindow(x, z, dims[k].rad * S, -0.12 + dims[k].top * S); };
  const ok = (x, z, d) => !inHouse(x, z) && !onPatio(x, z) && all.every(p => Math.hypot(p.x - x, p.z - z) > d);
  const add = (k, x, z, s, minD = 2.2) => { if (!ok(x, z, minD)) return false; const p = { x, z, s, ry: r() * 6.28 }; spots[k].push(p); all.push(p); return true; };
  // hand-placed trees that frame the back window and the left glass
  for (const [k, x, z, sc] of [['A', -0.4, -11.2, 1.0], ['C', 1.9, -12.6, 1.0], ['A', -2.9, -10.4, .95], ['B', 3.9, -10.6, .9], ['A', 0.9, -14.6, 1.1], ['C', -4.6, -13.4, 1.05],
    ['A', -5.6, -2.2, 1.0], ['C', -7.2, -6.2, 1.1], ['A', -6.0, -9.0, .95], ['B', -8.6, 0.6, 1.0], ['A', -5.4, 2.6, .9], ['C', -9.8, -3.0, 1.0], ['A', -10.5, -9.8, 1.05], ['B', -7.4, -12.4, 1.0],
    ['A', 0.2, 5.2, 1.0], ['C', -2.8, 6.2, 1.0], ['B', 3.4, 6.0, .95]]) add(k, x, z, sc, 1.8);
  let tries = 0;
  while (tries++ < 2000 && all.length < 52) {
    const a = r() * Math.PI * 2, d = 7 + Math.pow(r(), 0.8) * 45; const x = Math.cos(a) * d - 1.5, z = Math.sin(a) * d - 3.5; if (x > R.xW + 5) continue;
    const near = d < 16; add(pick(near ? ['A', 'A', 'C', 'B'] : ['A', 'A', 'A', 'C']), x, z, 0.85 + r() * 0.45, near ? 2.8 : 4.5);
  }
  for (const k of ['A', 'B', 'C']) spots[k] = spots[k].filter(p => !blocksSky(k, p.x, p.z, p.s));   // placed as before, then cleared (the rest keep their places)
  // trees no view can see are not drawn at all: the whole crown stands behind the solid shelf wall and the roof (the room's
  // x and z ranges: only the front glass, behind every view, looks at it), or behind the viewer's plane
  const unseen = (x, z, rad) => (x - rad > R.xL && z - rad > R.zB + 0.2) || z - rad > -0.3;
  for (const k of ['A', 'B', 'C']) spots[k] = spots[k].filter(p => !unseen(p.x, p.z, dims[k].rad * T[k].scale * p.s * 1.05));
  // a few young trees in that garden, far enough and small enough that their crowns stop below the moon (~9° up)
  for (const [k, az, d, top, ry] of [['A', 9, 30, 8.5, 1.1], ['C', 19, 24, 8.8, 4.0], ['B', 24.5, 17, 9.0, 2.3]]) {
    const a = az * Math.PI / 180, h = REF.eye.y + 0.12 + d * Math.tan(top * Math.PI / 180);
    spots[k].push({ x: -Math.sin(a) * d, z: -Math.cos(a) * d, s: h / (dims[k].top * T[k].scale), ry, near: true });
  }
  // far trees get a thinned leaf LOD (fewer, larger leaf cards); past the left glass every tree keeps LEFT_KEEP of its
  // leaves (the same cards, fewer: the garden there had crowded the view out)
  const cx = (R.xL + R.xW) / 2, cz = (R.zB + R.zF) / 2;
  for (const k of ['A', 'B', 'C']) for (const p of spots[k]) { p.far = !p.near && Math.hypot(p.x - cx, (p.z - cz) * 0.8) > 17; p.thin = p.x < R.xL; }
  for (const k of ['A', 'B', 'C']) {
    for (const far of [false, true]) for (const thin of [false, true]) {
      const list = spots[k].filter(p => p.far === far && p.thin === thin); if (!list.length) continue;
      for (const part of T[k].parts) {
        const lods = part.lods ||= {}, key = (far ? 'far' : 'near') + (thin ? '-thin' : '');
        const geo = part.leaf && (far || thin) ? (lods[key] ||= lodLeaves(part.geometry, (far ? (k === 'A' ? 0.55 : 0.4) : 1) * (thin ? LEFT_KEEP : 1), far ? (k === 'A' ? 1.2 : 1.32) : 1)) : part.geometry;
        const im = new THREE.InstancedMesh(geo, part.material, list.length);
        list.forEach((p, i) => { const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, -0.12, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.ry, 0)), new THREE.Vector3().setScalar(T[k].scale * p.s)); im.setMatrixAt(i, m); });
        im.frustumCulled = false; outside.add(im);
      }
    }
  }
  // far forest wall (painted canopy band) to close the gaps
  { const c = canvas(2048, 256), g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 2048, 256);
    for (let i = 0; i < 900; i++) { const x = r() * 2048, y = 40 + Math.pow(r(), 0.7) * 216, rad = 8 + r() * 26; g.fillStyle = hsl(85 + r() * 25, .28 + r() * .15, .32 + r() * .25).getStyle(); g.globalAlpha = .9; for (const ox of [-2048, 0, 2048]) { g.beginPath(); g.arc(x + ox, y, rad, 0, 7); g.fill(); } }
    g.globalAlpha = 1; g.fillStyle = hsl(90, .3, .3).getStyle(); g.fillRect(0, 200, 2048, 56);
    // where it meets the open sky seen through the left glass it drops to a low line of trees on the horizon
    const theta = az => { const dx = -Math.sin(az), dz = -Math.cos(az), ox = 2, oz = 3, b = ox * dx + oz * dz, t = -b + Math.sqrt(b * b - (ox * ox + oz * oz - 4900));
      return (Math.atan2(ox + t * dx, oz + t * dz) + Math.PI * 2) % (Math.PI * 2); };   // cylinder angle (x = r sin θ, z = r cos θ) seen at azimuth az
    const g0 = theta(5 * Math.PI / 180), g1 = theta(31 * Math.PI / 180), gap = g1 - g0, rest = Math.PI * 2 - gap;
    const t = ctex(c); t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(3 * rest / (Math.PI * 2), 1);
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.BackSide, fog: true, color: 0xb8c4a8 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 26, 64, 1, true, g1, rest), mat);
    ring.position.set(-2, 11, -3); outside.add(ring); LIGHTS.ring = ring;
    const lc = canvas(512, 96), lg = lc.getContext('2d');
    for (let i = 0; i < 420; i++) { const x = r() * 512, y = 34 + Math.pow(r(), 0.6) * 62, rad = 6 + r() * 16; lg.fillStyle = hsl(85 + r() * 25, .28 + r() * .15, .3 + r() * .22).getStyle(); lg.beginPath(); lg.arc(x, y, rad, 0, 7); lg.fill(); }
    lg.fillStyle = hsl(90, .3, .3).getStyle(); lg.fillRect(0, 74, 512, 22);
    const lt = ctex(lc, { rep: false });
    const low = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 9, 16, 1, true, g0 - 0.01, gap + 0.02), new THREE.MeshBasicMaterial({ map: lt, transparent: true, alphaTest: 0.3, side: THREE.BackSide, fog: true }));
    low.material.color = mat.color;   // shares the night tint
    low.position.set(-2, 2.5, -3); outside.add(low); }
  // shrubs right outside the glass (bush.js); past the left glass half of them taken out (G, 15/10/2026: the big one in
  // front of it at x −2.2, z −6 among them), the rest spread along it
  const bushes = [[-2.5, -8.3, 1.4], [-1.9, 1.3, 1.0], [-5.0, -7.4, 1.3], [-4.6, -0.6, 1.0], [-0.4, -9.9, 1.3], [1.3, -9.8, 1.1], [2.8, -10.1, 1.2], [-1.9, -10.2, 1.3],
    [-0.8, 3.6, 1.1], [1.8, 3.9, 1.0], [-6.6, -3.2, 1.3], [4.2, -12.4, 1.4]].filter(([x, z, sc]) => !unseen(x, z, 1.6 * sc));
  outside.add(buildBushes(bushes));
}
function lodLeaves(geo, keep, grow, seed = 5) {
  // drop whole leaf cards (connected by index) and enlarge the survivors around their own centre. A card is kept or
  // dropped by a hash of where it stands (to a thousandth of the model's size), not by its order in the file, so the
  // same leaves survive however the model is re-encoded.
  const idx = geo.index.array, pos = geo.attributes.position, n = pos.count; const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < idx.length; t += 3) { const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]); if (a !== b) par[b] = a; if (find(c) !== a) par[find(c)] = a; }
  const used = new Uint8Array(n); for (let t = 0; t < idx.length; t++) used[idx[t]] = 1;
  const sum = new Map(); for (let i = 0; i < n; i++) { if (!used[i]) continue; const root = find(i), s = sum.get(root) || [0, 0, 0, 0]; s[0] += pos.getX(i); s[1] += pos.getY(i); s[2] += pos.getZ(i); s[3]++; sum.set(root, s); }
  if (!geo.boundingBox) geo.computeBoundingBox(); const sz = geo.boundingBox.getSize(new THREE.Vector3()), q = 1000 / Math.max(sz.x, sz.y, sz.z, 1e-6);
  const hash = (a, b, c) => { let h = Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791) ^ Math.imul(seed, 2654435761); h = Math.imul(h ^ (h >>> 15), 2246822519); h = Math.imul(h ^ (h >>> 13), 3266489917); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const kept = new Map(); for (const [root, s] of sum) kept.set(root, hash(Math.round(s[0] / s[3] * q), Math.round(s[1] / s[3] * q), Math.round(s[2] / s[3] * q)) < keep);
  const out = []; for (let t = 0; t < idx.length; t += 3) if (kept.get(find(idx[t]))) out.push(idx[t], idx[t + 1], idx[t + 2]);
  const g = geo.clone(); const p2 = g.attributes.position;
  for (let i = 0; i < n; i++) { const root = find(i); if (!kept.get(root)) continue; const s = sum.get(root), cx = s[0] / s[3], cy = s[1] / s[3], cz = s[2] / s[3]; p2.setXYZ(i, cx + (p2.getX(i) - cx) * grow, cy + (p2.getY(i) - cy) * grow, cz + (p2.getZ(i) - cz) * grow); }
  g.setIndex(out); return g;
}
export { buildOutside, outside };
