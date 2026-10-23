import './pets.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, tick } from '../core/base.js';
import { canvas, ctex, halfCanvas } from '../core/utils.js';
import { renderer, scene } from '../core/renderer.js';
import { room } from './room.js';
import { B7_CELL, SHELF } from './shelves.js';
import { POST } from '../fx/post.js';
import { SHARP, crispPass, crispPatch, sharpQuad } from './pets.js';
import { setNeeds } from '../core/loop.js';

/* ---------------------------------------------------------------- the 747 on the Research shelf
   A desk model of a Boeing 747-8 Intercontinental, 1:128 (58 cm long; 1:200 made 30 % larger, G 17/10/2026, then 20 % more
   with its stand, G 18/10/2026: "em cho máy bay 20% bigger"), on a walnut stand, in the middle row of the Economy bay, a few of its books left at the left end (G, 17/10/2026: "em thay sách ở ngăn màu xanh bằng model boing 747, learn vỏ máy bay 747
   from glb asset, khi hover vào máy bay thì tạo viền select, khi click vào thì open newtab tới …"). The pointer on it
   draws a selection outline round it (white, a soft dark edge outside, as the page's own outlines); a click brings it
   out to turn (showcase.js), and a click on it then opens PLANE.url in a new tab.
   - Built in code from measurements of "Boeing 747-8i" by OUTPISTON (CC BY-NC-SA 4.0; 3D Assets/aviation/
     boeing-747-8i.glb). Only numbers were taken from it: its fuselage's sections (superellipse halves fitted at 37
     stations, within 2 % of its size), the wing's, the tailplane's and the fin's planforms, heights and thickness
     (the wing's dihedral is 6° inboard of the inner engine, 2.8° outboard, as the model's), the nacelles' profile
     (GEnx-2B: the inner and the outer engine the same, 8.3 m apart along the body), the flap-track fairings and the
     wing-body fairing; from its paint (each texel mapped back onto the model) where the red belly ends along the
     body, where the tail's orange begins, the window rows (main deck at 1.65 m, upper deck at 4.29 m, a 20-inch pitch),
     the doors and the cockpit windows, and its colours. No mesh and no picture of it is shipped.
   - Its paint is the 747-8's rollout scheme in plain colours, without lettering or emblem.
   - Drawn sharp over the painted room like the animals (pets.js crispPass: lit by the room's lights, toned as the
     painting, hidden where the room is nearer), on a layer of its own. The pointer finds it through a coarse copy. */
const PLANE = { ok: false, layer: 4, url: 'https://www.investingforum.info/copy-of-piano?rc=test-site', hover: false, out: 0, fade: 0, holder: null, hit: null, box: null,
  P: { rt: null, quad: null, paint: 0, wash: 0.25, layer: 4, toneK: 1, outline: true, pad: 12, dpr: 0.75 } };   // (dpr: 1 px a CSS px: G, 20/10/2026; 0.75: G, 22/10/2026)
const B7_SCALE = 1.3 * 1.2 / 200, B7_STAND = 1.2;   // (the model 1:128; its stand grown with it)

// the aircraft in metres (the real one: nose toward +z, y up), as a group of meshes; bare: geometry only (the pointer's copy)
function shape747(q, bare) {
  const TAU = Math.PI * 2;
  // the fuselage: superellipse halves at each station [z, top, bottom, half width, height of the widest point, exponent above, below]
  const FUS = [[-37.9, 4.13, 3.17, 0.1, 3.73, 1.6, 2], [-37.4, 4.78, 2.59, 0.49, 3.68, 1.9, 1.9], [-36.9, 4.9, 2.35, 0.58, 3.62, 1.95, 1.95], [-36.4, 4.9, 2.23, 0.67, 3.55, 2.05, 2.05],
    [-34.4, 4.84, 1.79, 0.99, 3.26, 2.35, 2.1], [-30.4, 4.72, 0.92, 1.65, 2.68, 2.75, 2.2], [-29.9, 4.72, 0.82, 1.74, 2.61, 2.6, 2.1], [-28.9, 4.71, 0.61, 1.95, 2.47, 2.5, 1.9],
    [-27.4, 4.71, 0.3, 2.25, 2.25, 2.45, 1.95], [-25.9, 4.71, -0.01, 2.46, 2.12, 2.25, 1.9], [-22.4, 4.71, -0.76, 2.94, 1.83, 2.1, 1.95], [-20.9, 4.71, -1.05, 3.04, 1.71, 2.0, 1.95],
    [-18.4, 4.71, -1.54, 3.19, 1.51, 2.0, 2.0], [-17.9, 4.71, -1.61, 3.2, 1.48, 2.0, 2.0], [-15.4, 4.71, -1.93, 3.23, 1.35, 2.0, 2.0], [-12.4, 4.71, -2.08, 3.23, 1.32, 2.05, 2.05],
    [-2.9, 4.71, -2.08, 3.2, 1.32, 2.05, 2.05], [3.1, 4.88, -2.08, 3.2, 1.32, 1.9, 2.05], [5.1, 5.15, -2.08, 3.2, 1.32, 1.9, 2.05], [8.1, 5.46, -2.08, 3.2, 1.32, 1.85, 2.05],
    [10.6, 5.64, -2.08, 3.21, 1.32, 1.85, 2.05], [13.6, 5.75, -2.08, 3.21, 1.32, 1.85, 2.05], [20.6, 5.75, -2.08, 3.21, 1.32, 1.85, 2.05], [24.1, 5.75, -1.96, 3.08, 1.32, 1.85, 2.25],
    [27.6, 5.7, -1.72, 2.79, 1.32, 1.8, 2.6], [28.6, 5.63, -1.58, 2.65, 1.32, 1.75, 2.55], [29.1, 5.55, -1.51, 2.58, 1.32, 1.65, 2.55], [29.6, 5.46, -1.44, 2.5, 1.32, 1.6, 2.5],
    [30.1, 5.29, -1.33, 2.41, 1.32, 1.6, 2.5], [30.6, 5.04, -1.22, 2.31, 1.32, 1.6, 2.45], [31.6, 4.23, -1.0, 2.11, 1.32, 1.8, 2.45], [32.1, 3.94, -0.87, 1.98, 1.32, 1.85, 2.3],
    [33.1, 3.43, -0.53, 1.72, 1.32, 1.9, 2.25], [34.1, 2.91, -0.09, 1.38, 1.32, 1.9, 2.0], [34.6, 2.62, 0.16, 1.16, 1.32, 1.9, 1.95], [35.1, 2.29, 0.44, 0.91, 1.32, 2.0, 2.0],
    [35.6, 1.89, 0.78, 0.58, 1.32, 2.0, 2.0]];
  const Z0 = -38.0, Z1 = 35.93;   // the tail's and the nose's tips
  // the wing-body fairing under it [z, bottom, half width, height of the widest point]
  const FAIR = [[-9.4, -1.0, 1.2, -1.0], [-8.9, -1.53, 2.29, -1.08], [-7.9, -1.93, 2.79, -0.39], [-6.9, -2.11, 2.96, 0.03], [-5.9, -2.21, 3.13, 0.45], [-3.9, -2.29, 3.21, 0.48],
    [-1.9, -2.31, 3.23, 0.3], [2.1, -2.31, 3.23, -1.38], [6.1, -2.29, 3.31, -1.43], [10.1, -2.21, 3.07, -1.35], [13.1, -2.06, 2.6, -1.29], [14.6, -1.95, 2.2, -1.3], [15.4, -1.7, 1.4, -1.4]];
  // the wing (one side, x out from the centre line) [x, leading edge z, trailing edge z, mid-surface height, thickness / chord]:
  // the trailing edge kinks at the inner engine, the tip is raked; the tailplane the same; the fin [y, LE z, TE z, t/c]
  const WING = [[2.6, 11.84, -3.55, -0.59, 0.135], [5.6, 9.04, -3.9, -0.27, 0.13], [8.8, 6.05, -4.25, 0.09, 0.118], [12.5, 2.62, -4.6, 0.44, 0.105], [20.6, -4.74, -10.1, 0.9, 0.095],
    [29.6, -12.35, -16.2, 1.29, 0.085], [31.2, -13.71, -17.3, 1.36, 0.083], [32.6, -15.45, -18.27, 1.43, 0.082], [33.6, -16.95, -18.95, 1.52, 0.08], [34.37, -18.65, -19.6, 1.7, 0.08]];
  const STAB = [[0.6, -26.88, -36.44, 2.98, 0.085], [4.0, -30.11, -37.36, 3.39, 0.082], [8.0, -33.92, -38.44, 3.87, 0.078], [11.03, -36.8, -39.25, 4.24, 0.075]];
  const FIN = [[4.1, -23.15, -35.62, 0.11], [8.0, -27.89, -37.21, 0.105], [12.0, -32.75, -38.84, 0.095], [14.59, -35.92, -39.9, 0.085]];
  // the engines (GEnx-2B) [axis x, axis y, inlet lip z]; the nacelle's profiles [aft of the lip, radius]
  const ENG = [[11.923, -1.839, 8.52], [21.087, -1.264, 0.19]];
  const COWL = [[0, 1.4], [0.06, 1.47], [0.2, 1.53], [0.45, 1.6], [0.8, 1.66], [1.3, 1.705], [2.2, 1.725], [3.3, 1.72], [4.1, 1.69], [4.7, 1.63], [5.2, 1.55], [5.45, 1.47]];
  const INLET = [[0, 1.4], [0.05, 1.33], [0.18, 1.28], [0.5, 1.25], [1.18, 1.24]];
  const CORE = [[4.9, 1.1], [5.45, 1.02], [6.0, 0.95], [6.5, 0.86], [6.85, 0.77], [7.05, 0.7]];
  const PLUG = [[6.9, 0.5], [7.05, 0.5], [7.5, 0.41], [7.95, 0.28], [8.35, 0.12], [8.55, 0.0]];
  const SPIN = [[0.55, 0.0], [0.62, 0.12], [0.75, 0.24], [0.9, 0.33], [1.05, 0.39], [1.18, 0.42]];
  // the flap-track fairings under each wing [x, front z, rear z, depth, half width]
  const CANOE = [[6.0, 1.7, -5.4, 0.7, 0.4], [8.8, 1.2, -6.3, 0.68, 0.4], [14.8, -2.95, -9.1, 0.6, 0.32], [18.25, -5.7, -11.0, 0.55, 0.29]];
  // the paint: the red belly's top along the body (height), the tail's orange above the red aft of z −8 (to this height),
  // the window rows [first z, how many at 0.508 m], the doors [z, bottom, top]
  const RED_TOP = [[-38, 4.6], [-35, 4.22], [-30, 3.46], [-25, 2.82], [-20, 2.17], [-15, 1.47], [-10, 1.18], [-5, 1.06], [0, 1.05], [5, 1.35], [8, 1.5], [11, 1.94], [14, 2.23],
    [17, 2.58], [20, 2.76], [23, 2.82], [26, 2.62], [29, 2.3], [32, 1.82], [34, 1.5], [36, 1.25]];
  const ORANGE_TOP = [[-38, 6], [-26.5, 6], [-25, 4.11], [-24, 3.52], [-22, 2.52], [-20, 2.29], [-15, 1.76], [-10, 1.35], [-8, 1.2]];
  const WIN_MAIN = [[-27.73, 2], [-24.72, 1], [-22.72, 18], [-13.58, 7], [-10.38, 1], [-8.02, 8], [-3.99, 6], [-0.76, 1], [1.19, 1], [2.6, 8], [6.62, 11], [12.96, 1], [14.6, 11], [20.78, 1], [21.8, 9],
    [26.26, 1], [27.87, 8], [31.91, 5]];
  const WIN_UP = [[10.14, 4], [12.66, 4], [14.7, 10], [21.8, 9]];
  const DOORS = [[-24.72, 0.2, 2.15], [-10.38, 0.2, 2.15], [1.19, 0.2, 2.15], [12.96, 0.2, 2.15], [26.26, 0.2, 2.15], [20.8, 3.45, 4.95]];
  const C = { white: '#e9ece9', red0: '#8a1b0e', red1: '#b42b15', orange: '#d0762f', orange1: '#df9147', grey: '#b9bdbb', win: '#2a2d31', line: 'rgba(80,86,90,.55)' };

  function mono(xs, ys) {   // a monotone cubic through the points (no overshoot between stations)
    const n = xs.length, d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
    return x => {
      if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0; while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }
  const col = (T, k) => T.map(r => r[k]);
  const F = [1, 2, 3, 4, 5, 6].map(k => mono(col(FUS, 0), col(FUS, k)));
  function section(z) {   // the section at z (a rounded cap past the last station at the nose; closed to a point at the tail)
    const zz = Math.min(35.6, Math.max(-37.9, z)); let top = F[0](zz), bot = F[1](zz), hw = F[2](zz), yw = F[3](zz); const nT = F[4](zz), nB = F[5](zz);
    if (z > 35.6) { const k = Math.sqrt(Math.max(0, 1 - ((z - 35.6) / (Z1 - 35.6)) ** 2)), yc = 1.33; top = yc + (top - yc) * k; bot = yc + (bot - yc) * k; hw *= k; yw = yc + (yw - yc) * k; }
    if (z < -37.9) { const k = Math.max(0, (z - Z0) / (-37.9 - Z0)); hw *= k; top = yw + (top - yw) * k; bot = yw + (bot - yw) * k; }
    return { top, bot, hw, yw, nT, nB };
  }
  function ring(S, s, out) {   // a point of a section: s goes round from the top (0) by the side at x > 0 (0.25) to the bottom (0.5)
    const a = TAU * s, c = Math.cos(a), sn = Math.sin(a), up = c >= 0, n = up ? S.nT : S.nB, h = up ? S.top - S.yw : S.yw - S.bot;
    out[0] = S.hw * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n); out[1] = S.yw + (up ? 1 : -1) * h * Math.pow(Math.abs(c), 2 / n); return out;
  }
  function sAt(S, y) {   // where on a section's side (s) the surface is at height y
    if (y >= S.yw) { const r = Math.min(1, (y - S.yw) / Math.max(1e-6, S.top - S.yw)); return Math.acos(Math.pow(r, S.nT / 2)) / TAU; }
    const r = Math.min(1, (S.yw - y) / Math.max(1e-6, S.yw - S.bot)); return 0.5 - Math.acos(Math.pow(r, S.nB / 2)) / TAU;
  }
  const curve = T => mono(col(T, 0), col(T, 1)), redTop = curve(RED_TOP), orangeTop = curve(ORANGE_TOP);
  function gridGeo(rows, cols, at, uv) {   // rows × cols points from at(i, j, p); two triangles a quad
    const pos = new Float32Array(rows * cols * 3), uvs = uv ? new Float32Array(rows * cols * 2) : null, idx = [], p = [0, 0, 0];
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { at(i, j, p); pos.set(p, (i * cols + j) * 3); if (uv) uvs.set(uv(i, j), (i * cols + j) * 2); }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  const lathe = (prof, segs, at) => gridGeo(prof.length, segs + 1, (i, j, p) => at(prof[i][0], prof[i][1], TAU * j / segs, p));
  const lin = h => new THREE.Color(h).convertSRGBToLinear();
  const glossy = o => bare || new THREE.MeshPhysicalMaterial({ roughness: 0.38, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.22, envMapIntensity: 0.9, ...o });
  const paint = o => bare || new THREE.MeshPhysicalMaterial({ roughness: 0.42, metalness: 0.12, clearcoat: 0.3, clearcoatRoughness: 0.3, ...o });
  const std = o => bare || new THREE.MeshStandardMaterial(o);
  const group = new THREE.Group(), add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); group.add(m); return m; };

  // ---- the fuselage, and its paint (in its own u along the body, v round it)
  const NZ = Math.round(200 * q), NS = Math.round(72 * q), zs = [];
  for (let i = 0; i <= NZ; i++) { const t = i / NZ; zs.push(Z0 + (Z1 - Z0) * (t - 0.035 * Math.sin(TAU * t))); }   // (a little denser at both tips)
  const secs = zs.map(section), tmp = [0, 0];
  add(gridGeo(NZ + 1, NS + 1, (i, j, p) => { ring(secs[i], j / NS, tmp); p[0] = tmp[0]; p[1] = tmp[1]; p[2] = zs[i]; }, (i, j) => [(zs[i] - Z0) / (Z1 - Z0), j / NS]),
    bare || glossy({ map: livery() }));
  function livery() {
    const W = 2048, H = 512, cv = canvas(W, H), g = cv.getContext('2d'), U = z => (z - Z0) / (Z1 - Z0) * W, Vs = s => s * H;
    const cols = 512, at = [];   // per column: where the red and the orange end on the side (s; the other side mirrored)
    for (let i = 0; i <= cols; i++) { const z = Z0 + (Z1 - Z0) * i / cols, S = section(z); at.push({ z, S, r: sAt(S, redTop(z)), o: z < -8 ? sAt(S, orangeTop(z)) : null }); }
    g.fillStyle = C.white; g.fillRect(0, 0, W, H);
    for (let i = 0; i < cols; i++) {   // the orange, then the red belly, darker toward its bottom
      const a = at[i], x0 = U(a.z), w = U(at[i + 1].z) + 0.6 - x0;
      if (a.o !== null) { const o = Math.min(a.o, a.r); g.fillStyle = C.orange; g.fillRect(x0, Vs(o), w, Vs(a.r - o) + 0.5); g.fillRect(x0, Vs(1 - a.r), w, Vs(a.r - o) + 0.5); }
      for (const [y0, y1] of [[a.r, 0.5], [1 - a.r, 0.5]]) { const gr = g.createLinearGradient(0, Vs(y0), 0, Vs(y1)); gr.addColorStop(0, C.red1); gr.addColorStop(1, C.red0); g.fillStyle = gr; g.fillRect(x0, Vs(Math.min(y0, y1)), w, Math.abs(Vs(y1) - Vs(y0)) + 0.5); }
    }
    g.fillStyle = C.grey; g.fillRect(0, 0, U(-36.6), H);   // (the tail cone's end)
    for (let k = 1; k <= 5; k++) for (const side of [0, 1]) {   // fine orange lines in the red along its top, aft of the wing
      g.beginPath(); let first = true;
      for (const a of at) { if (a.z < -26 || a.z > 12) continue; const s = sAt(a.S, redTop(a.z) - k * 0.11), v = side ? 1 - s : s; if (first) { g.moveTo(U(a.z), Vs(v)); first = false; } else g.lineTo(U(a.z), Vs(v)); }
      g.strokeStyle = C.orange1; g.lineWidth = 0.9; g.globalAlpha = 0.55 - k * 0.07; g.stroke(); g.globalAlpha = 1;
    }
    const win = (z, y) => { const S = section(z), s = sAt(S, y), h = Math.abs(sAt(S, y - 0.15) - sAt(S, y + 0.15)) * H / 2; for (const v of [s, 1 - s]) { g.beginPath(); g.ellipse(U(z), Vs(v), 0.105 / (Z1 - Z0) * W, h, 0, 0, TAU); g.fill(); } };
    g.fillStyle = C.win;
    for (const [z0, n] of WIN_MAIN) for (let k = 0; k < n; k++) win(z0 + k * 0.508, 1.65);
    for (const [z0, n] of WIN_UP) for (let k = 0; k < n; k++) win(z0 + k * 0.508, 4.29);
    g.strokeStyle = C.line; g.lineWidth = 0.8;
    for (const [z, y0, y1] of DOORS) for (const side of [0, 1]) {   // the doors, a fine line round each
      const S = section(z), sv = y => Vs(side ? 1 - sAt(S, y) : sAt(S, y)), xa = U(z - 0.54), xb = U(z + 0.54);
      g.beginPath(); g.moveTo(xa, sv(y0)); g.lineTo(xa, sv(y1)); g.lineTo(xb, sv(y1)); g.lineTo(xb, sv(y0)); g.closePath(); g.stroke();
    }
    for (let i = 0; i < cols; i++) {   // the cockpit windows: a dark band across the top of the nose
      const a = at[i]; if (a.z < 29.55 || a.z > 31.45) continue;
      const sHi = sAt(a.S, 4.79 - Math.max(0, a.z - 31.0) * 0.6), sLo = sAt(a.S, 4.26 + (a.z - 29.5) * 0.06), x0 = U(a.z), w = U(at[i + 1].z) + 0.6 - x0;
      g.fillStyle = '#16191c'; g.fillRect(x0, Vs(sHi), w, Vs(sLo - sHi)); g.fillRect(x0, Vs(1 - sLo), w, Vs(sLo - sHi));
    }
    g.fillStyle = C.white;   // (and the posts between its panes)
    for (const z of [30.12, 30.78]) { const S = section(z), a = sAt(S, 4.85), b = sAt(S, 4.2), x = U(z); g.fillRect(x - 0.5, Vs(a), 1.4, Vs(b - a)); g.fillRect(x - 0.5, Vs(1 - b), 1.4, Vs(b - a)); }
    const t = new THREE.CanvasTexture(halfCanvas(cv)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;   // (painted at 2048, kept at 1024: G, 20/10/2026)
  }

  // ---- the wing-body fairing, painted as the belly round it
  {
    const Fz = col(FAIR, 0), fb = mono(Fz, col(FAIR, 1)), fh = mono(Fz, col(FAIR, 2)), fy = mono(Fz, col(FAIR, 3)), N = Math.round(60 * q), M = Math.round(40 * q);
    const geo = gridGeo(N + 1, M + 1, (i, j, p) => {
      const z = Fz[0] + (Fz[Fz.length - 1] - Fz[0]) * i / N, b = fb(z), yw = fy(z), a = TAU * j / M, c = Math.cos(a), sn = Math.sin(a), up = c >= 0;
      const n = up ? 2.0 : 2.6, y = yw + (up ? 1.6 : b - yw) * Math.pow(Math.abs(c), 2 / n);
      let x = fh(z) * Math.pow(Math.abs(sn), 2 / n);
      if (up || y > -1.0) {   // (no wider than the fuselage where it meets it)
        const S = section(z), above = y >= S.yw, e = above ? S.nT : S.nB, r = Math.min(1, Math.abs(y - S.yw) / Math.abs((above ? S.top : S.bot) - S.yw));
        x = Math.min(x, S.hw * Math.pow(Math.max(0, 1 - Math.pow(r, e)), 1 / e) - 0.03);
      }
      p[0] = Math.sign(sn) * x; p[1] = y; p[2] = z;
    });
    if (!bare) {
      const P = geo.attributes.position, cc = new Float32Array(P.count * 3), r0 = lin(C.red0), r1 = lin(C.red1), cl = new THREE.Color();
      for (let v = 0; v < P.count; v++) { cl.copy(r0).lerp(r1, Math.min(1, Math.max(0, (P.getY(v) + 2.3) / (redTop(P.getZ(v)) + 2.3)))); cc.set([cl.r, cl.g, cl.b], v * 3); }
      geo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    }
    add(geo, glossy({ vertexColors: true }));
  }

  // ---- the lifting surfaces: an airfoil (NACA four-digit thickness, 2 % camber) lofted along each planform
  const AF = [];
  for (let i = 0, n = Math.round(48 * q); i < n; i++) {   // [x along the chord, camber, ± half thickness per unit t/c] (cosine spacing)
    const th = TAU * i / n, x = 0.5 + 0.5 * Math.cos(th), yt = 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    AF.push([x, x < 0.4 ? 0.02 / 0.16 * (0.8 * x - x * x) : 0.02 / 0.36 * (0.2 + 0.8 * x - x * x), (th < Math.PI ? 1 : -1) * yt]);
  }
  const WS = col(WING, 0), wLE = mono(WS, col(WING, 1)), wTE = mono(WS, col(WING, 2)), wMid = mono(WS, col(WING, 3)), wTC = mono(WS, col(WING, 4));
  function wingLow(x, z) {   // the wing's lower surface at (x, z) (its chord place clamped to the wing)
    const L = wLE(x), ch = L - wTE(x), u = Math.min(1, Math.max(0, (L - z) / ch)), yt = 5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
    return wMid(x) + ((u < 0.4 ? 0.02 / 0.16 * (0.8 * u - u * u) : 0.02 / 0.36 * (0.2 + 0.8 * u - u * u)) - yt * wTC(x)) * ch;
  }
  function surface(T, rows, fin, colors) {   // T [s, LE z, TE z, mid, t/c] along the span s (x; for the fin y, no mid)
    const S = col(T, 0), le = mono(S, col(T, 1)), te = mono(S, col(T, 2)), mid = fin ? () => 0 : mono(S, col(T, 3)), tc = mono(S, col(T, fin ? 3 : 4)), n = AF.length;
    const geo = gridGeo(rows + 1, n + 1, (i, j, p) => {
      const s = S[0] + (S[S.length - 1] - S[0]) * i / rows, L = le(s), ch = L - te(s), [x, yc, yt] = AF[j % n], z = L - x * ch, off = (yc + yt * tc(s)) * ch;
      if (fin) { p[0] = off; p[1] = s; p[2] = z; } else { p[0] = s; p[1] = mid(s) + off; p[2] = z; }
    });
    if (colors) {
      const P = geo.attributes.position, nrm = geo.attributes.normal, c = new Float32Array(P.count * 3);
      for (let v = 0; v < P.count; v++) { const cl = colors(AF[(v % (n + 1)) % n][0], nrm.getY(v) >= 0); c.set([cl.r, cl.g, cl.b], v * 3); }
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    return geo;
  }
  const WUP = lin('#d3d7d8'), WLO = lin('#a3a7a8'), WLE = lin('#c3c7c9'), SUP = lin('#c0c4c5');
  for (const side of [1, -1]) {
    add(surface(WING, Math.round(60 * q), false, !bare && ((x, up) => x < 0.04 ? WLE : up ? WUP : WLO)), paint({ vertexColors: true, side: THREE.DoubleSide })).scale.x = side;
    add(surface(STAB, Math.round(24 * q), false, !bare && ((x, up) => x < 0.04 ? WLE : up ? SUP : WLO)), paint({ vertexColors: true, side: THREE.DoubleSide })).scale.x = side;
  }
  {   // the fin, in the sunrise's bands (orange, a lighter sweep, a light grey sweep), no lettering
    const geo = surface(FIN, Math.round(36 * q), true, null), P = geo.attributes.position, uv = new Float32Array(P.count * 2);
    for (let v = 0; v < P.count; v++) { uv[v * 2] = (P.getZ(v) + 40) / 18; uv[v * 2 + 1] = (P.getY(v) - 4) / 11; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    let map = null;
    if (!bare) {
      const cv = canvas(512, 512), g = cv.getContext('2d'), X = z => (z + 40) / 18 * 512, Y = y => 512 - (y - 4) / 11 * 512;
      const band = (pts, c) => { g.fillStyle = c; g.beginPath(); pts.forEach(([z, y], i) => i ? g.lineTo(X(z), Y(y)) : g.moveTo(X(z), Y(y))); g.closePath(); g.fill(); };
      g.fillStyle = '#c95f24'; g.fillRect(0, 0, 512, 512);
      band([[-40, 15], [-33, 15], [-26, 8.3], [-22, 4], [-40, 4]], '#de7a2a');
      band([[-40, 12.6], [-35.5, 15], [-33.5, 15], [-25.5, 7.1], [-24.2, 4], [-30, 4], [-40, 9.8]], '#e9973f');
      band([[-40, 8.4], [-30.5, 4], [-27.5, 4], [-40, 10.6]], '#b9bcbb');
      band([[-40, 4], [-36, 4], [-40, 6.2]], '#b8bcba');
      band([[-36.3, 15], [-35.6, 15], [-23.0, 4], [-23.9, 4]], '#e4e6e4');   // (its leading edge, pale)
      map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    }
    add(geo, glossy({ map, side: THREE.DoubleSide }));
  }

  // ---- the engines, their pylons, the flap-track fairings
  const NAC = { cowl: glossy({ color: lin('#e4e6e4') }), lip: std({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.28 }), inlet: std({ color: 0x3a3e42, roughness: 0.6, side: THREE.DoubleSide }),
    core: std({ color: lin('#9da1a0'), metalness: 0.3, roughness: 0.45 }), plug: std({ color: 0x55595d, metalness: 0.7, roughness: 0.35 }), fan: std({ color: 0x24272a, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }),
    spin: std({ color: 0x3c4044, metalness: 0.8, roughness: 0.3 }), canoe: paint({ color: lin('#c9cdce') }) };
  const ES = Math.round(40 * q);
  for (const [ex, ey, ez] of ENG) for (const side of [1, -1]) {
    const at = (d, r, a, p) => { p[0] = side * ex + r * Math.cos(a); p[1] = ey + r * Math.sin(a); p[2] = ez - d; };
    for (const [prof, mat] of [[COWL, NAC.cowl], [COWL.slice(0, 3), NAC.lip], [INLET, NAC.inlet], [[[1.18, 0.42], [1.2, 1.24]], NAC.fan], [SPIN, NAC.spin],
      [[[5.45, 1.47], [5.3, 1.4], [4.9, 1.38]], NAC.inlet], [CORE, NAC.core], [PLUG, NAC.plug]]) if (!bare || prof === COWL || prof === CORE) add(lathe(prof, ES, at), mat);
    // the pylon: a streamlined strut on the cowl's top, up to the wing's leading edge, on under the wing and out behind
    // its trailing edge in a tapering fairing
    const cowlTop = ey + 1.69, coreTop = ey + 0.98, zF = ez - 0.9, zLE = wLE(ex), zTE = wTE(ex), zR = zTE - 1.3, N = Math.round(48 * q), M = Math.round(18 * q);
    const topAt = z => z > zLE ? cowlTop + 0.12 + (wingLow(ex, zLE - 0.25) + 0.05 - cowlTop - 0.12) * Math.pow(Math.min(1, (zF - z) / (zF - zLE)), 0.75) : z > zTE ? wingLow(ex, z) + 0.05 : wingLow(ex, zTE) + 0.02;
    const botAt = z => z > ez - 5.3 ? cowlTop - 0.06 : z > ez - 6.9 ? coreTop - 0.04 + (cowlTop - coreTop) * Math.max(0, (z - (ez - 6.0)) / 0.7) : coreTop - 0.04 + (topAt(z) - coreTop) * Math.min(1, ((ez - 6.9) - z) / ((ez - 6.9) - zR)) ** 1.6;
    add(gridGeo(N + 1, M + 1, (i, j, p) => {
      const t = i / N, z = zF + (zR - zF) * t, a = TAU * j / M, yT = topAt(z), yB = Math.min(botAt(z), yT - 0.02), hw = 0.3 * Math.min(1, t / 0.06) ** 0.5 * Math.min(1, (1 - t) / 0.25) ** 0.7;
      p[0] = side * ex + hw * Math.sin(a); p[1] = (yB + yT) / 2 + (yT - yB) / 2 * Math.cos(a); p[2] = z;
    }), NAC.cowl);
  }
  if (!bare) for (const [cx, z0, z1r, dep, hw] of CANOE) for (const side of [1, -1]) {
    const zTE = wTE(cx), z1 = Math.max(z1r, zTE - 1.4), N = Math.round(28 * q), M = Math.round(14 * q);   // (out behind the trailing edge no further than the flaps would cover)
    add(gridGeo(N + 1, M + 1, (i, j, p) => {
      const t = i / N, z = z0 + (z1 - z0) * t, a = TAU * j / M, top = wingLow(cx, Math.max(z, zTE + 0.05)) + 0.06;
      const k = Math.sin(Math.PI / 2 * Math.min(1, t / 0.33)) ** 0.7 * (t > 0.45 ? 1 - 0.65 * Math.min(1, (t - 0.45) / 0.47) : 1) * (t > 0.92 ? Math.sqrt(Math.max(0, 1 - ((t - 0.92) / 0.08) ** 2)) : 1);
      const h = Math.max(0.005, dep * k / 2), w = Math.max(0.004, hw * k);
      p[0] = side * cx + w * Math.sin(a); p[1] = top - h + h * Math.cos(a); p[2] = z;
    }), NAC.canoe);
  }
  return group;
}

// the desk stand: a walnut base and a chrome rod up to the belly (in metres, the base's middle at the origin); k: its
// size (the ISS's is half as large again: iss.js)
function standParts(rodTop, k = 1) {
  const shp = new THREE.Shape(), w = 0.156 * k, d = 0.09 * k, r = 0.035 * k;
  shp.moveTo(-w / 2 + r, -d / 2); shp.lineTo(w / 2 - r, -d / 2); shp.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r); shp.lineTo(w / 2, d / 2 - r); shp.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  shp.lineTo(-w / 2 + r, d / 2); shp.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r); shp.lineTo(-w / 2, -d / 2 + r); shp.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  const base = new THREE.ExtrudeGeometry(shp, { depth: 0.008 * k, bevelEnabled: true, bevelThickness: 0.003 * k, bevelSize: 0.003 * k, bevelSegments: 4, curveSegments: 14 });   // (its corners round, not in facets, seen near)
  base.rotateX(-Math.PI / 2); base.rotateY(Math.PI / 2); base.translate(0, 0.003 * k, 0);   // (lying on the board along the fuselage, 14 mm thick with its bevels)
  // (shaded smooth round its corners, the bevel's steps and the top kept sharp: a lamp near it lit its corners' facets one
  // by one, a square of light on its edge)
  const baseS = toCreasedNormals(base, 20 * Math.PI / 180);
  const rod = new THREE.CylinderGeometry(0.004 * k, 0.0052 * k, rodTop.y - 0.012 * k, 16); rod.translate(0, (rodTop.y + 0.012 * k) / 2, 0);
  const cup = new THREE.CylinderGeometry(0.011 * k, 0.007 * k, 0.009 * k, 20); cup.translate(0, rodTop.y - 0.0045 * k, 0);   // (the cradle under the belly)
  return { base: baseS, rod: mergeGeometries([rod, cup]) };
}

const b7mark = name => { try { performance.mark('l3-' + name); } catch (e) { /* no User Timing */ } };   // (start-up marks: tools/perf/marks.cjs)
async function buildPlane() {
  b7mark('plane-start');
  // the model: nose up 6° as in a climb, turned 22° toward the room so it shows three quarters
  const S = SHELF.B, xa = S.X[B7_CELL.i] + 0.025, xb = S.X[B7_CELL.i + 1] - 0.025, y0 = 0.1 + B7_CELL.j * S.rh2 + S.th / 2, zBack = R.zB + 0.006;
  const holder = new THREE.Group(), model = shape747(1, null); b7mark('plane-model'); await tick();
  const pitch = 6 * Math.PI / 180, yaw = (90 - 22) * Math.PI / 180, attach = new THREE.Vector3(0, -2.31, 1.0).multiplyScalar(B7_SCALE), rodTop = new THREE.Vector3(0, 0.15 * B7_STAND, 0);
  model.scale.setScalar(B7_SCALE); model.rotation.x = -pitch;
  model.position.copy(rodTop).sub(attach.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), -pitch));
  const st = standParts(rodTop, B7_STAND);
  const walnut = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#6a4128').convertSRGBToLinear(), roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.5 });   // (a soft sheen: a sharp one showed a light as a square on its edge)
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, metalness: 1, roughness: 0.16 });
  const stand = new THREE.Group(); stand.add(new THREE.Mesh(st.base, walnut), new THREE.Mesh(st.rod, chrome));
  holder.add(model, stand); holder.rotation.y = yaw;
  // placed (by its box) in the middle of the shelf right of the books, its far side against the back: its span (54 cm)
  // is more than the shelf is deep (36 cm), so the near wing tip reaches past the shelf's front, as a model's would (its
  // fin's top 5 cm under the board above)
  holder.position.set(0, y0, 0); holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder, true), x0 = xa + B7_CELL.books + 0.05, x1 = xb - 0.02;   // (precise: a turned mesh's own box would be far larger)
  holder.position.x += (x0 + x1) / 2 - (box.min.x + box.max.x) / 2; holder.position.z += zBack - box.min.z;
  holder.updateMatrixWorld(true);
  holder.traverse(o => {
    if (!o.isMesh) return; o.layers.set(PLANE.layer); o.castShadow = false; o.receiveShadow = true;
    o.material.fog = false; o.material.onBeforeCompile = crispPatch;   // (hidden where the room is nearer, as the animals)
  });
  await tick();
  // its shadow on the board: a soft patch under the base, and a fainter one under the aircraft
  {
    const c2 = canvas(128, 128), g = c2.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(18,11,5,.6)'); gr.addColorStop(0.6, 'rgba(18,11,5,.25)'); gr.addColorStop(1, 'rgba(18,11,5,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = ctex(c2, { rep: false });
    for (const [w, d, k] of [[0.2, 0.13, 1], [0.47, 0.26, 0.35]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w * B7_STAND, d * B7_STAND), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: k, depthWrite: false, fog: false }));
      m.rotation.set(-Math.PI / 2, 0, yaw - Math.PI / 2); m.position.set(holder.position.x, y0 + 0.001, holder.position.z); m.renderOrder = 1; room.add(m); (PLANE.shadows ||= []).push(m);
    }
  }
  // the pointer's copy: coarse, invisible, where the model is
  {
    const hit = shape747(0.3, true), hidden = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }), geos = [];
    hit.scale.copy(model.scale); hit.rotation.copy(model.rotation); hit.position.copy(model.position);
    const hh = new THREE.Group(); hh.add(hit); hh.add(new THREE.Mesh(st.base), new THREE.Mesh(st.rod)); hh.rotation.copy(holder.rotation); hh.position.copy(holder.position); hh.scale.copy(holder.scale); hh.updateMatrixWorld(true);
    hh.traverse(o => { if (o.isMesh) geos.push(o.geometry.clone().applyMatrix4(o.matrixWorld).deleteAttribute('uv').deleteAttribute('normal')); });
    for (const g of geos) { for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k); if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]); }
    PLANE.hit = new THREE.Mesh(mergeGeometries(geos), hidden); PLANE.hit.matrixAutoUpdate = false; room.add(PLANE.hit);
  }
  // the box the crisp pass draws (its corners on screen), and the room's lights lighting it on its layer
  const bb = new THREE.Box3().setFromObject(holder, true), bc = bb.getCenter(new THREE.Vector3());
  PLANE.box = [bc.x, bb.min.y - 0.005, bc.z, (bb.max.x - bb.min.x) / 2 + 0.01, bb.max.y - bb.min.y + 0.01, (bb.max.z - bb.min.z) / 2 + 0.01];
  scene.traverse(o => { if (o.isLight) o.layers.enable(PLANE.layer); });
  scene.add(holder); PLANE.holder = holder; sharpQuad(PLANE.P); b7mark('plane-built');
  if (renderer.compileAsync) { SHARP.cam.layers.set(PLANE.layer); renderer.setRenderTarget(POST.rt); try { await renderer.compileAsync(holder, SHARP.cam, scene); } catch (e) { /* compiled on first use */ } renderer.setRenderTarget(null); }
  PLANE.ok = true; setNeeds(true); b7mark('plane');
}
function stepPlane(dt) {   // the outline in and out (0.14 s), the model faded in once (0.6 s): true while either moves
  if (!PLANE.ok) return false;
  const was = PLANE.out + PLANE.fade, to = PLANE.hover ? 1 : 0;
  PLANE.out += Math.sign(to - PLANE.out) * Math.min(Math.abs(to - PLANE.out), dt / 0.14); PLANE.fade = Math.min(1, PLANE.fade + dt / 0.6);
  return PLANE.out + PLANE.fade !== was;
}
function drawPlane() {   // over the picture, before the animals (the shelf is behind where they go)
  if (!PLANE.ok || PLANE.away > 0.001) return;   // (out of its shelf: showcase.js draws it)
  const U = PLANE.P.quad.material.uniforms, pr = renderer.getPixelRatio(), PU = POST.mat.uniforms;
  U.uOut.value = PLANE.out; U.uOutW.value = 2 * pr; U.uHalo.value = 1.6 * pr; U.uFade.value = PLANE.fade;
  SHARP.u.uExp.value = PU.exposure.value; SHARP.u.uLift.value = PU.lift.value; SHARP.u.uVeil.value = PU.veil.value;
  crispPass(PLANE.P, PLANE.box);
}

export { PLANE, buildPlane, drawPlane, standParts, stepPlane };
