import './lights.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { tick } from '../core/base.js';
import { canvas, halfCanvas, rng } from '../core/utils.js';

/* ---------------------------------------------------------------- trees, built in code
   The garden's three trees, rebuilt from measurements of the GLB models they replace (credits in the page): A and C
   on skeletons traced from those models, B on its twelve limbs; leaves placed by the old models' leaf densities (cells
   of 0.4-0.6 m), card sizes, facing and textures as measured there. Metres, scale 1.                             */
async function makeTrees() {
  const V3 = THREE.Vector3, tv = (x, y, z) => new V3(x, y, z), UP = tv(0, 1, 0), TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t, clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const tex = (c, srgb = true, rep = false) => { const t = new THREE.CanvasTexture(c.width >= 512 ? halfCanvas(halfCanvas(c)) : c.width >= 256 ? halfCanvas(c) : c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };   // (the large ones at a quarter, the small ones at half: utils.js halfCanvas; G, 19/10/2026: "tiếp tục giảm độ nét của toàn bộ cây")

  /* ---------- geometry */
  const anyPerp = d => new V3().crossVectors(d, Math.abs(d.y) < 0.9 ? UP : tv(1, 0, 0)).normalize();

  /* ---------- meshes */
  function tubes(branches, { vTile = 1.2 } = {}) {   // all branches of a tree in one indexed mesh: rings with parallel-transported frames
    const pos = [], nrm = [], uv = [], idx = [], T = new V3(), N = new V3(), B = new V3(), q = new V3();
    for (const b of branches) {
      const { pts, rad } = b, n = pts.length, segs = b.segs || 6, base = pos.length / 3;
      const uRep = Math.max(1, Math.round(TAU * rad[0] / vTile)); let len = 0;
      for (let i = 0; i < n; i++) {
        if (i === 0) T.subVectors(pts[1], pts[0]); else if (i === n - 1) T.subVectors(pts[n - 1], pts[n - 2]); else T.subVectors(pts[i + 1], pts[i - 1]);
        T.normalize();
        if (i === 0) N.copy(anyPerp(T)); else N.addScaledVector(T, -N.dot(T)).normalize();
        B.crossVectors(T, N); if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
        for (let j = 0; j <= segs; j++) {
          const a = j / segs * TAU, c = Math.cos(a), s = Math.sin(a);
          q.set(N.x * c + B.x * s, N.y * c + B.y * s, N.z * c + B.z * s);
          pos.push(pts[i].x + q.x * rad[i], pts[i].y + q.y * rad[i], pts[i].z + q.z * rad[i]); nrm.push(q.x, q.y, q.z); uv.push(j / segs * uRep, len / vTile);
        }
      }
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < segs; j++) { const a = base + i * (segs + 1) + j, c = a + segs + 1; idx.push(a, a + 1, c, a + 1, c + 1, c); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  // leaf cards: anchored at the top of the texture (the stem) or at their centre; a card in two halves can fold (bend)
  function cards(list) {
    const pos = [], uv = [], idx = [], col = [], v = new V3(), d = new V3(), shaded = list.some(c => c.shade != null);
    for (const c of list) {
      const rows = c.bend ? 2 : 1, base = pos.length / 3, [u0, v0, u1, v1] = c.cell;
      const o = c.o.clone(); d.copy(c.down); if (c.center) o.addScaledVector(d, -c.h / 2);
      for (let k = 0; k <= rows; k++) {
        if (k === 2) d.applyAxisAngle(c.side, c.bend);
        if (k > 0) o.addScaledVector(d, c.h / rows);
        for (const sgn of [-1, 1]) { v.copy(o).addScaledVector(c.side, sgn * c.w / 2); pos.push(v.x, v.y, v.z); uv.push(sgn < 0 ? u0 : u1, lerp(v1, v0, k / rows)); if (shaded) { const sh = c.shade ?? 1; col.push(sh, sh, sh); } }
      }
      for (let k = 0; k < rows; k++) { const a = base + 2 * k; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (shaded) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  const randDir = r => { const z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - z * z); return tv(s * Math.cos(a), z, s * Math.sin(a)); };
  // a card's facing, drawn from the |n.y| histogram measured on the old leaves (5 bins from vertical cards to flat ones)
  const facing = (r, hist) => { let w = r() * hist.reduce((a, b) => a + b, 0), b = 0; while (w > hist[b]) w -= hist[b++]; const ny = (b + r()) / hist.length * (r() < 0.5 ? 1 : -1), a = r() * TAU, sx = Math.sqrt(1 - ny * ny); return tv(sx * Math.cos(a), ny, sx * Math.sin(a)); };
  const inPlane = (n, pref) => { const d = pref.clone().addScaledVector(n, -pref.dot(n)); return d.lengthSq() < 1e-4 ? anyPerp(n) : d.normalize(); };
  const card = (o, n, pref, w, h, extra) => { const down = inPlane(n, pref); return { o, down, side: new V3().crossVectors(n, down).normalize(), w, h, ...extra }; };
  const perpTo = (d, r) => anyPerp(d).applyAxisAngle(d, r() * TAU);

  /* ---------- crowns grown into a measured volume */
  // leaf density measured on an old model, in cells of `res` m; 2 bits a cell (0 = no leaves), `wts` the mean count per level
  function crown(V) {
    const [nx, ny, nz] = V.dims, n = nx * ny * nz, bin = atob(V.data), w = new Float32Array(n), cdf = new Float32Array(n);
    let sum = 0; for (let i = 0; i < n; i++) { w[i] = V.wts[(bin.charCodeAt(i >> 2) >> ((i & 3) * 2)) & 3]; cdf[i] = sum += w[i]; }
    const cell = p => { const x = Math.floor((p.x - V.lo[0]) / V.res), y = Math.floor((p.y - V.lo[1]) / V.res), z = Math.floor((p.z - V.lo[2]) / V.res); return x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? -1 : (x * ny + y) * nz + z; };
    const wMax = Math.max(...V.wts);
    return {
      sample(r) { const u = r() * sum; let a = 0, b = n - 1; while (a < b) { const m = (a + b) >> 1; if (cdf[m] < u) a = m + 1; else b = m; }
        return tv(V.lo[0] + (Math.floor(a / (ny * nz)) + r()) * V.res, V.lo[1] + (Math.floor(a / nz) % ny + r()) * V.res, V.lo[2] + (a % nz + r()) * V.res); },
      at(p) { const i = cell(p); return i < 0 ? 0 : w[i] / wMax; },   // density there, 0..1
    };
  }
  // straight sticks, as on the old B model, in passes: each target (a point of the leaf volume) gets a stick from the
  // skeleton so far, nearest targets first. Pass 1 grows only from the limbs (long sticks, added once the pass is done);
  // later passes from anything, each stick at once. A stick leaves its parent at the angle measured there (10/50/90th
  // percentile 24/63/140 degrees), so it starts behind (or ahead of) the parent's nearest point. Returns the sticks and
  // a nearest() query
  function sticks(r, segs0, passes, { step = 0.15, cellS = 0.6, rTip = 0.003 } = {}) {
    const grid = new Map(), key = (x, y, z) => ((x + 64) * 128 + (y + 64)) * 128 + (z + 64);
    const addSeg = (a, b) => { const L = a.distanceTo(b), n = Math.max(1, Math.ceil(L / step)), dir = b.clone().sub(a).divideScalar(L || 1);
      for (let k = 0; k <= n; k++) { const p = a.clone().lerp(b, k / n), kk = key(Math.floor(p.x / cellS), Math.floor(p.y / cellS), Math.floor(p.z / cellS)); let l = grid.get(kk); if (!l) grid.set(kk, l = []); l.push({ p, a, dir, s: L * k / n, L }); } };
    const nearest = t => { const cx = Math.floor(t.x / cellS), cy = Math.floor(t.y / cellS), cz = Math.floor(t.z / cellS); let best = null, bd = Infinity;
      for (let sh = 0; sh < 40; sh++) {
        for (let dx = -sh; dx <= sh; dx++) for (let dy = -sh; dy <= sh; dy++) for (let dz = -sh; dz <= sh; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== sh) continue;
          const l = grid.get(key(cx + dx, cy + dy, cz + dz)); if (l) for (const q of l) { const d = q.p.distanceToSquared(t); if (d < bd) { bd = d; best = q; } }
        }
        if (best && bd <= sh * sh * cellS * cellS) break;
      }
      return best; };
    for (const [a, b] of segs0) addSeg(a, b);
    const out = [];
    for (const { targets, Lmax, rK, r0max, late } of passes) {
      const order = targets.map(t => ({ t, d: nearest(t).p.distanceTo(t) })).sort((x, y) => x.d - y.d), made = [];
      for (const { t } of order) {
        const q = nearest(t), d = q.p.distanceTo(t); if (d < 0.08) continue;
        const ang = 0.42 + 2.02 * Math.pow(r(), 1.57), a = q.a.clone().addScaledVector(q.dir, clamp(q.s - d / Math.tan(ang), 0, q.L));
        let L = a.distanceTo(t); const end = L > Lmax ? a.clone().lerp(t, Lmax / L) : t.clone(); L = a.distanceTo(end);
        out.push({ pts: [a, end], rad: [Math.min(0.005 + rK * L, r0max), rTip], segs: 3 });
        if (late) made.push([a, end]); else addSeg(a, end);
      }
      for (const [a, b] of made) addSeg(a, b);
    }
    return { sticks: out, nearest };
  }
  // light reaching a point through the foliage: density summed along a few rays out of the crown -> 0 (open) .. 1
  function occlusion(C, p, dirs = [[0, 1, 0], [1, 0.4, 0], [-1, 0.4, 0], [0, 0.4, 1], [0, 0.4, -1], [0.7, 0.3, 0.7], [-0.7, 0.3, -0.7]], len = 2.4, k = 1.6) {
    let s = 0; const q = new V3();
    for (const [x, y, z] of dirs) { let a = 0; const d = tv(x, y, z).normalize(); for (let t = 0.3; t < len; t += 0.3) a += C.at(q.copy(p).addScaledVector(d, t)); s += 1 - Math.exp(-k * a * 0.3); }
    return s / dirs.length;
  }

  /* ---------- skeletons traced from the old models */
  // traced along level sets of the distance over the bark from the root, then thinned: per node, how many nodes back
  // its parent is (varint, 0 = the root), its offset from the parent (int8 x3, in q m) and its radius (uint8, in rq m)
  function skeleton(S) {
    const b = atob(S.data), nodes = []; let i = 0;
    const u8 = () => b.charCodeAt(i++), i8 = () => { const v = u8(); return v > 127 ? v - 256 : v; };
    while (i < b.length) {
      let back = 0, sh = 0, c; do { c = u8(); back |= (c & 127) << sh; sh += 7; } while (c & 128);
      const dx = i8(), dy = i8(), dz = i8(), rr = u8() * S.rq, k = nodes.length, p = back ? k - back : -1;
      nodes.push({ p: p < 0 ? tv(S.o[0], S.o[1], S.o[2]) : nodes[p].p.clone().add(tv(dx * S.q, dy * S.q, dz * S.q)), r: rr, parent: p });
    }
    return nodes;
  }
  // nodes -> branches for tubes(): each follows its thickest child; the others start at their parent's node
  function skelBranches(nodes, segs = r => r > 0.1 ? 8 : r > 0.04 ? 6 : r > 0.015 ? 4 : 3) {
    const kids = nodes.map(() => []), out = [];
    nodes.forEach((n, i) => { if (n.parent >= 0) kids[n.parent].push(i); });
    const walk = (i0, from) => {
      const ch = from >= 0 ? [from, i0] : [i0]; let i = i0;
      for (;;) { const k = kids[i]; if (!k.length) break; let m = k[0]; for (const c of k) if (nodes[c].r > nodes[m].r) m = c; for (const c of k) if (c !== m) walk(c, i); ch.push(m); i = m; }
      if (ch.length > 1) out.push({ pts: ch.map(j => nodes[j].p), rad: ch.map((j, q) => q === 0 && from >= 0 ? Math.min(nodes[j].r, nodes[ch[1]].r) : nodes[j].r), segs: segs(nodes[ch[from >= 0 ? 1 : 0]].r) });
    };
    nodes.forEach((n, i) => { if (n.parent < 0) walk(i, -1); });
    return out;
  }
  const nodeSegs = nodes => nodes.filter(n => n.parent >= 0).map(n => [nodes[n.parent].p, n.p]);

  /* ---------- textures (canvas). The page recolours leaves by their luminance, so each is drawn at the tone measured
     on the old texture: A dark (ash sprigs), B white (brush strokes, shaded by the light), C mid (maple). */
  const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
  function leafShape(g, x, y, ang, w, h) { g.save(); g.translate(x, y); g.rotate(ang); g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(w, h * 0.25, w * 0.8, h * 0.8, 0, h); g.bezierCurveTo(-w * 0.8, h * 0.8, -w, h * 0.25, 0, 0); g.fill(); g.restore(); }
  function sprigTexture(r) {   // A: two ash sprigs as on the old texture (cells 320 x 512): a pale stem down from the top
    // centre; side shoots angled down and out, each with pairs of small dark leaflets and one at its end, some forking
    const W = 320, H = 512, c = canvas(W * 2, H), g = c.getContext('2d');
    const leaflet = (x, y, a, s) => { const sh = 0.8 + r() * 0.4; g.fillStyle = rgb(35 * sh, 64 * sh, 19 * sh); leafShape(g, x, y, a, W * 0.036 * s, W * 0.08 * s); };
    const shoot = (x0, y0, a, len, pairs, depth) => {   // a: angle from straight down
      const dx = Math.sin(a), dy = Math.cos(a), x1 = x0 + dx * len, y1 = y0 + dy * len;
      g.strokeStyle = rgb(170, 152, 124); g.lineWidth = W * (depth ? 0.005 : 0.007); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      for (let q = 0; q < pairs; q++) { const f = 0.3 + 0.7 * q / pairs, px = x0 + dx * len * f, py = y0 + dy * len * f; for (const sg of [-1, 1]) leaflet(px, py, -a + sg * (0.75 + r() * 0.35), 0.85 + r() * 0.3); }
      leaflet(x1, y1, -a + (r() - 0.5) * 0.4, 1);
      if (!depth && r() < 0.45) shoot(x0 + dx * len * 0.45, y0 + dy * len * 0.45, a + (r() < 0.5 ? -1 : 1) * 0.6, len * 0.55, 3, 1);
    };
    for (let v = 0; v < 2; v++) {
      const ox = v * W, stem = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24; stem.push([ox + W * 0.5 + Math.sin(t * 3.4 + v * 2) * W * 0.05, H * t * 0.92]); }
      g.strokeStyle = rgb(176, 158, 130); g.lineCap = 'round'; g.lineWidth = W * 0.012; g.beginPath(); stem.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
      const n = 8;
      for (let k = 0; k < n; k++) {
        const t = 0.14 + k * 0.78 / (n - 1), [bx, by] = stem[Math.round(t * 24)], side = k % 2 ? 1 : -1, last = k === n - 1;
        shoot(bx, by, last ? (r() - 0.5) * 0.3 : side * (0.65 + r() * 0.4), W * (last ? 0.2 : 0.28 + 0.1 * Math.sin(t * Math.PI)) * (0.85 + r() * 0.3), last ? 3 : 6, 0);
      }
    }
    return tex(c);
  }
  function brushTexture(r) {   // B: one round brush blob, white, ragged dry-brush edges (as on the old texture)
    const S = 256, c = canvas(S, S), g = c.getContext('2d'), cx = S * 0.5, cy = S * 0.49, R0 = S * 0.48;
    const ph = r() * TAU, rad = a => R0 * (1 + 0.05 * Math.sin(2 * a + ph) + 0.035 * Math.sin(5 * a + ph * 3));
    g.fillStyle = '#fff'; g.beginPath();
    for (let i = 0; i <= 96; i++) { const a = i / 96 * TAU, rr = rad(a) * (0.94 + 0.04 * r()); g.lineTo(cx + Math.cos(a) * rr * 0.93, cy + Math.sin(a) * rr); }
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineCap = 'round';   // dry-brush streaks along the rim, heavier at lower left
    for (let i = 0; i < 220; i++) {
      const a = r() * TAU, w = 0.5 + 0.5 * Math.max(0, Math.cos(a - 2.4)), rr = rad(a) * (0.86 + r() * (0.12 + 0.12 * w)), l = S * (0.03 + r() * 0.05);
      const x = cx + Math.cos(a) * rr * 0.93, y = cy + Math.sin(a) * rr, t = a + Math.PI / 2 + (r() - 0.5) * 0.6;
      g.lineWidth = 0.8 + r() * 1.6; g.beginPath(); g.moveTo(x - Math.cos(t) * l, y - Math.sin(t) * l); g.lineTo(x + Math.cos(t) * l, y + Math.sin(t) * l); g.stroke();
    }
    return tex(c);
  }
  function mapleOutline(g, cx, cy, R, rot) {   // five-lobed, serrated; the stem joins at the top
    g.beginPath();
    for (let i = 0; i <= 160; i++) {
      const a = i / 160 * TAU; let lobe = 0;
      for (const [la, lr] of [[0, 1], [1.05, 0.92], [-1.05, 0.92], [2.1, 0.62], [-2.1, 0.62]]) { const da = Math.atan2(Math.sin(a - la), Math.cos(a - la)); lobe = Math.max(lobe, lr * Math.pow(Math.max(0, Math.cos(da * 1.9)), 1.6)); }
      const rr = R * (0.42 + 0.58 * lobe) * (1 + 0.05 * Math.abs(Math.sin(a * 22)));
      const x = Math.sin(a) * rr, y = Math.cos(a) * rr;   // a = 0 points down (the main lobe)
      g.lineTo(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot));
    }
    g.fill();
  }
  function mapleTexture(r) {   // C: a maple leaf on a long stem (left third), and a spray of ~20 small leaves on twigs
    // radiating from the centre (right two thirds), as on the old textures
    const W = 512, H = 1024, c = canvas(W * 3, H), g = c.getContext('2d');
    g.strokeStyle = rgb(150, 120, 60); g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(W * 0.5, 0); g.quadraticCurveTo(W * 0.56, H * 0.12, W * 0.5, H * 0.24); g.stroke();
    g.fillStyle = rgb(186, 140, 50); mapleOutline(g, W * 0.5, H * 0.6, W * 0.56, 0);
    g.strokeStyle = rgb(160, 118, 44); g.lineWidth = 4;
    for (const a of [0, 1.05, -1.05, 2.1, -2.1]) { g.beginPath(); g.moveTo(W * 0.5, H * 0.26); g.lineTo(W * 0.5 + Math.sin(a) * W * 0.42, H * 0.26 + Math.cos(a) * W * 0.42); g.stroke(); }
    const cx = W * 2, cy = H * 0.5, S = H;
    const twig = (x0, y0, a, len, depth) => {
      const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
      g.strokeStyle = rgb(150, 132, 104); g.lineWidth = Math.max(2, 7 - depth * 2); g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + (r() - 0.5) * len * 0.2, (y0 + y1) / 2 + (r() - 0.5) * len * 0.2, x1, y1); g.stroke();
      if (depth < 2) { const k = depth === 0 ? 2 : 1 + (r() < 0.6 ? 1 : 0); for (let q = 0; q < k; q++) twig(x1, y1, a + (q - (k - 1) / 2) * 0.75 + (r() - 0.5) * 0.3, len * 0.62, depth + 1); if (depth === 1) twig(x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.5, a + (r() < 0.5 ? 1 : -1) * 0.9, len * 0.45, 2); }
      else { const sh = 0.85 + r() * 0.3; g.fillStyle = rgb(160 * sh, 134 * sh, 52 * sh); mapleOutline(g, x1 + Math.cos(a) * S * 0.035, y1 + Math.sin(a) * S * 0.035, S * 0.048 * (0.85 + r() * 0.35), Math.PI / 2 - a); }
    };
    const a0 = r() * TAU; for (let k = 0; k < 5; k++) twig(cx, cy, a0 + k * TAU / 5 + (r() - 0.5) * 0.4, S * 0.17, 0);
    return tex(c);
  }
  function barkTexture(r, kind) {   // A: brown with vertical fissures; C: plane-tree bark, grey-green patches
    const S = 256, c = canvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    const PERM = new Uint8Array(512); { const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
    const vn = (x, y, px, py) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const h = (i, j) => PERM[(PERM[((i % px) + px) % px] + ((j % py) + py) % py) & 511] / 255; return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v; };
    const fb = (x, y, px, py, o = 4) => { let s = 0, a = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { s += a * vn(x * f, y * f, px * f, py * f); n += a; a *= 0.5; f *= 2; } return s / n; };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = (y * S + x) * 4; let R, G, B;
      if (kind === 'A') { const f = fb(u * 14, v * 3, 14, 3), w = fb(u * 4, v * 8, 4, 8); const crack = Math.max(0, 1 - Math.abs(f - 0.5) * 9); const l = (0.8 + 0.3 * w) * (1 - 0.55 * crack); R = 122 * l; G = 98 * l; B = 76 * l; }
      else { const a = fb(u * 5, v * 5, 5, 5), b = fb(u * 9 + 3, v * 9, 9, 9); const patch = a > 0.55 ? 2 : a > 0.45 ? 1 : 0, s = 0.9 + 0.2 * b;
        [R, G, B] = patch === 2 ? [150 * s, 152 * s, 134 * s] : patch === 1 ? [104 * s, 106 * s, 82 * s] : [96 * s, 80 * s, 64 * s]; }
      d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0); return tex(c, true, true);
  }
  const leafMat = map => new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true });
  const barkMat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide, ...o });

  /* ---------- A: tall and slender, the skeleton traced from the old model (it kinks and forks at ~4.4 m into two
     leaders); 500 ash sprigs placed by its sprig density, each on a short twig, rising up and out from its stem */
  const A_SKEL = { o: [-0.2, -0.16, 0.16], q: 0.02, rq: 0.002, data: 'AAAAAF0BAgf6UwH/Ev9PAQU8/UIB/j4KQgH8DgFCAQccAUIBAh78QgEGDw5CAQMPBUIBBQ4CQgEHKgNCAfYOETAB/AwIKwH6LQsrAf4bDCsBAxH8KwH8EP4mAQcOACYBAhEAJgECDv4mAQAOBR0BBA//FwEILgIXAQMN+xcBAg4AFwEILAoXAQIO/xcBBB/5FgEHN/0FB/8LCRUB/iIeFQECOyoHDf8L9hcB9DDdEAH1KvMNAfwL+QoRBA4CGBb9CgMLAQMS/wsYAxD/HRn/FvwBG/4IDysB/gsJKwH4QCgjAf4kKA0jCw/zJAEUKPskAQYN+iMBDyr0IAH+DwMaAQEfAhYBACz7FgEBEv8WAQANAxYBAg38FgEGD/0WAREZ/xMBCQwBDwEiIvYIAzI69AUBBgv+BQj+Cg0RAfoSFw8B+yIUBxAEDfkUAQAO+xIB+w37EQHcQOoMAfgV+QwXBAsACED3C+wyAfoK9TAB+w36LwH5C/gtAf0SAS0B+hn2LQH4EQolAfwPAiIB+C38IgH8DPwiAQUSAh8BAQ7+HwEAHwUfAfsLAx8BDBP5HAEMKfYaARJZ/BUBAxn9CwXwCQoWAfUJBRYB+QsGEAHcQiMHDfYL9xkB7yXvFgH4H/wPAfcj9AsSBRH/ARYGBu0iAQ8X2xYBEBbjBhz+DvwiHfgQ/w0e9w37DmQIDgIvZQMRCQFoBRUHAQ==' };
  const A_STEMS = { lo: [-3.0, 5.4, -3.0], res: 0.6, dims: [10, 16, 11], wts: [0.0, 1.395, 4.595, 11.227], data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAQAgAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAEAAAFAAAJQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAMAAADAAAAgBAAAAgAAAMAAACAIAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAdAKAABAAAAgBAAwDgAwDEAEDAACgAJAIASABAAwAAAAAAAAAAAAAAAAAkAAAFEAAKAAADAMACACAAAAwAgAKA0AAAcAAAeAAANABAFAAAAAAAAAAAAAAAAAIAgAAAFAAAAAAAAAAEAAADAEAAAAAAAAACAAACAIAAACAAAAwAAAEAAAAAAABAAAAoAAAFAMACAGAAAAwAAAsAgAoAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAEAAAAAAAAAAAA=' };
  function treeA(r) {
    const nodes = skeleton(A_SKEL), br = skelBranches(nodes);
    // twigs out to points of the old model's sprig density; the sprigs sit along their ends (measured: the nearest other
    // stem ~8.5 cm away, a few to twenty on a twig)
    const C = crown(A_STEMS), tips = Array.from({ length: 110 }, () => C.sample(r));
    const st = sticks(r, nodeSegs(nodes), [{ targets: tips, Lmax: 1.6, rK: 0.01, r0max: 0.02 }], { rTip: 0.006 });
    br.push(...st.sticks);
    const stems = [], on = new Array(st.sticks.length).fill(0);
    while (stems.length < 500) {
      const k = Math.floor(Math.pow(r(), 1.6) * st.sticks.length), tw = st.sticks[k], L = tw.pts[0].distanceTo(tw.pts[1]);
      stems.push(tw.pts[0].clone().lerp(tw.pts[1], clamp(1 - (on[k]++ * 0.085 + r() * 0.03) / Math.max(L, 0.01), 0.1, 1)));
    }
    // measured: a sprig is 0.94 x 1.53 m, its stem at the twig, its axis up (y 0.6) and outward (0.3), bent ~0.4 rad
    const leaves = [];
    for (const s of stems) {
      const out = tv(s.x, 0, s.z); if (out.lengthSq() < 0.01) out.copy(randDir(r)).setY(0); out.normalize();
      const pref = out.multiplyScalar(0.45).add(tv(0, 0.85, 0)).addScaledVector(randDir(r), 0.55).normalize();
      leaves.push(card(s, facing(r, [0.21, 0.222, 0.202, 0.214, 0.152]), pref, 0.94, 1.53, { bend: (r() < 0.5 ? -1 : 1) * (0.2 + r() * 0.36), cell: r() < 0.5 ? [0, 0, 0.5, 1] : [0.5, 0, 1, 1] }));
    }
    return { scale: 1, parts: [{ geometry: tubes(br, { vTile: 1.6 }), material: barkMat({ map: barkTexture(r, 'A') }), leaf: false }, { geometry: cards(leaves), material: leafMat(sprigTexture(r)), leaf: true }] };
  }

  /* ---------- B: stylized; a thick tapering trunk, twelve limbs fanning out from 3-6 m (measured on the old model), and
     a crown grown into the old model's leaf volume: thousands of straight sticks toward it, small brush-stroke leaves */
  const B_VOX = { lo: [-4.4, 3.2, -4.8], res: 0.4, dims: [21, 24, 23], wts: [0, 1.812, 5.244, 11.321], data: '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' };
  const B_LIMBS = [[0.13, 5.81, -0.24, 0.39, 11.93, -1.34], [0.34, 6.26, -0.26, 1.47, 12.3, -0.4], [0.08, 5.94, 0.22, 0.72, 11.78, 1.73],
    [-0.49, 5.74, 0.16, -2.36, 11.46, 0.06], [0.26, 4.53, 0.35, 2.22, 9.8, 1.68], [-0.03, 4.08, 0.45, -0.48, 9.04, 2.57],
    [0.15, 4.1, -0.6, 0.49, 8.79, -2.99], [-0.49, 3.68, 0.25, -2.59, 8.28, 1.05], [0.48, 3.55, -0.2, 2.52, 7.65, -1.12],
    [-0.28, 3.46, 0.02, -2.66, 7.37, 0.56], [0.13, 3.11, 0.36, 0.95, 6.67, 2.86], [-0.16, 3.2, -0.15, -1.49, 6.69, -1.95]];
  function treeB(r) {
    const br = [], segs0 = [];
    const trunk = [tv(0.1, -0.15, 0), tv(0.08, 0.4, 0), tv(0.05, 3.6, 0.05), tv(0, 5.8, 0), tv(-0.02, 6.4, 0.02)];
    br.push({ pts: trunk, rad: [0.62, 0.44, 0.31, 0.2, 0.08], segs: 7 });
    for (let i = 2; i < trunk.length - 1; i++) segs0.push([trunk[i], trunk[i + 1]]);
    for (const [x0, y0, z0, x1, y1, z1] of B_LIMBS) {
      const a = tv(x0, y0, z0), b = tv(x1, y1, z1), L = a.distanceTo(b);
      const mid = a.clone().lerp(b, 0.45).addScaledVector(perpTo(b.clone().sub(a).normalize(), r), L * 0.035);
      br.push({ pts: [a, mid, b], rad: [0.04 + 0.02 * L, 0.03 + 0.01 * L, 0.015], segs: 5 });
      segs0.push([a.clone().lerp(mid, 0.3), mid], [mid, b]);
    }
    // the leaves' places first (by the measured density); the sticks grow to them: long ones straight off the limbs (about
    // a quarter, as measured), then shorter ones off everything, out to every other leaf, so each leaf sits on a stick
    const C = crown(B_VOX), N = 16440, spots = Array.from({ length: N }, () => C.sample(r)), pts = n => Array.from({ length: n }, () => C.sample(r));
    const every = (k, o) => spots.filter((_, i) => i % k === o);
    const st = sticks(r, segs0, [{ targets: pts(1800), Lmax: 2.2, rK: 0.012, r0max: 0.03, late: true },
      { targets: every(4, 0), Lmax: 1.0, rK: 0.008, r0max: 0.015 },
      { targets: every(8, 2), Lmax: 0.45, rK: 0.008, r0max: 0.009 }]);
    br.push(...st.sticks);
    // leaves sit on the sticks (measured: half within 9 cm) and those of one stick face alike, their long side up and
    // along the stick, so the crown shades in patches as on the old model
    const W = 0.125, H = 0.208, reach = 0.15, hist = [0.23, 0.26, 0.27, 0.19, 0.05], leaves = [], stickN = new Map();
    for (let i = 0; i < N; i++) {
      const o = spots[i], q = st.nearest(o), pref = UP.clone();
      let nrm;
      if (q) {
        const d = o.distanceTo(q.p); if (d > reach) o.sub(q.p).multiplyScalar(reach / d).add(q.p);
        let bn = stickN.get(q.a); if (!bn) stickN.set(q.a, bn = facing(r, hist));
        nrm = bn.clone().addScaledVector(randDir(r), 0.7).normalize(); pref.addScaledVector(q.dir, 0.6);
      } else nrm = facing(r, hist);
      pref.addScaledVector(randDir(r), 0.5);
      const shade = 1 - 0.15 * Math.pow(occlusion(C, o), 1.2);
      const s = 0.8 + r() * 0.4;
      leaves.push(card(o, nrm, pref.normalize(), W * s, H * s, { center: true, shade, cell: [0, 1, 1, 0] }));
    }
    const lm = leafMat(brushTexture(r)); lm.vertexColors = true;
    return { scale: 1, parts: [{ geometry: tubes(br), material: barkMat({ color: 0x5b4433, flatShading: true }), leaf: false }, { geometry: cards(leaves), material: lm, leaf: true }] };
  }

  /* ---------- C: plane tree, the skeleton traced from the old model (a slender trunk, an open ovoid crown of spreading
     branches); 2059 maple leaves and 71 flat leafy sprays placed by the old model's densities */
  const C_SKEL = { o: [0.0, -0.1, 0.0], q: 0.02, rq: 0.002, data: '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' };
  const C_LEAVES = { lo: [-4.0, 5.0, -4.0], res: 0.5, dims: [16, 21, 17], wts: [0.0, 1.0, 2.43, 5.146], data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAKgAAADAAwAAALQAAACgAAAAAAAAAADgAAAAsAcAAAACAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAQAEaAAAUCgIAALACAAAAAAAAAAAEAAAFLgAA6L0AAACoAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICKAAAABRsABPAWBDAAgBkQAAAAQAAAAFQGAAA0AACw6gMAAG/nAAAA5gAAAIAAAABABgAAAB4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAADsEAAQwHghgAEALiAAABQACgBoglMAABAQAICsCgEAfj0IAAAUCwCQAggAgMMZAAAKmAAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAEABAAABCwAAAAAAggAAABAiAAAAITQwAwAAQCgAAAEfAPkGuAAAAFAAABIQACBAnyQAAKAoABQIagBQXZ4AAHSSAgC4CQAAgAcAAAC4AAAAgAAAAAAAAAAAAAIAACgYAAAkAABQAQAAACoAwAZUAEAfAAAALgAAAKAAKAKgAxQFAAoAAIQNYAcgIAAIgLUAqQJVAIDq9QMA5AYIAOAbLgAADxYAAFAVAACQPwAAACgAAAAAAAAAAAAAAAAAAAABAAAAAACAXgAAAKgAAABAAAAAAAFwHoAwuBoALyAAAJaAAgC+APwCZQBoAAAAgO9BAQBUP1EAgLq4AQAs+AMAgEsCAICuAAAAKAAAAAAAAAAAAAAAAAAAAAABAAAAAAB8AAAAwAAAAAEAAAALQAi9YEChFwCkAEAlhQIBADQBlAwACECWAAAApREAAAB8AQIABqkDAADwDwAAaA4AALADAACAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAQAAAQQAgEf/AOABoEK4BxAAoQCAEvAAAChBAACwpgEAAPADBgAQdQ0AAK4fAADACQAAAAEAAAAAAAAAAQAAAAAAAAAAAQAAACAAAACAAAAAAAAAAAAAABA5AADALwAAAJsBAALABoALAABAAwA5gAMAAAYGAADgCwAAAA8AAACAFwAA/DoAAJAmAAAAMAAAAAAAAAAGAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAEYAAAC0AQAAdAwAAAACAA4AAIAvAAAAOgAAIBIAAMC/AAAA5gAAAFQSAACAfwAAAC0AAAAAAAAAAAAAAAAAAADQAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAApAUAAMAOAADQPwAAAAAAFQAAABsAAABgAADgaQAAAPkCAACkAgAAABEAAEAfAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAAQAAAAUAAAAAAAAAAAAEAAAABgAAAA6AAAA+gIAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEQAAAPQAAACQAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
  const C_SPRAYS = { lo: [-3.2, 5.6, -3.2], res: 0.8, dims: [9, 12, 9], wts: [0.0, 0.0, 1.0, 2.0], data: 'AAAAAgAIAAAAAAgACAAAAAAAAAAAAAAAAAAAAAAAIIAAAAAAAAAAAgAgAgAAAAgAAAAAAAAAACAIAAAACAAwAIAAAAAAAgAAICAAAgAAAAAAAAAgAAgAIAAAIIAAACAAAAIAiACAIAAoADAAAAAAAAAAgAACCAAAgAAACAIAgAAAgACAAAAAAAAAAAAAAwAIAAAgIACAACAAAAAAKAAoAAAAAAAIAAIAAAAACAAAAACAAAAAAAMAAAAAAAAAAAAACjCAAIIAAAAAAAAAACAAgAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
  function treeC(r) {
    const nodes = skeleton(C_SKEL), br = skelBranches(nodes), leaves = [];
    const CL = crown(C_LEAVES), CS = crown(C_SPRAYS);
    // leaves by the old model's density (measured: a leaf 0.37 x 0.42 m with its stem, 0.156 m2 of surface, facing
    // mostly up, stem-to-tip rising a little, cupped; drawn 5 % larger as flat cards cover less than cupped ones)
    for (let i = 0; i < 2059; i++) {
      const o = CL.sample(r), pref = randDir(r).add(tv(0, 0.45, 0)).normalize();
      leaves.push(card(o, facing(r, [0.124, 0.188, 0.2, 0.271, 0.218]), pref, 0.39, 0.44, { center: true, bend: (r() - 0.5) * 1.2, cell: [0, 0, 1 / 3, 1] }));
    }
    // the sprays: 2.29 m square of texture (2.9 m2 of surface each), lying flat, cupped
    for (let i = 0; i < 71; i++) {
      const o = CS.sample(r), n = tv((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3).normalize();
      leaves.push(card(o, n, randDir(r), 2.29, 2.29, { center: true, bend: (r() < 0.5 ? -1 : 1) * 0.5, cell: [1 / 3, 0, 1, 1] }));
    }
    return { scale: 1, parts: [{ geometry: tubes(br, { vTile: 1.4 }), material: barkMat({ map: barkTexture(r, 'C') }), leaf: false }, { geometry: cards(leaves), material: leafMat(mapleTexture(r)), leaf: true }] };
  }
  const trees = { A: treeA(rng(301)) }; await tick();
  trees.B = treeB(rng(302)); await tick();
  trees.C = treeC(rng(303));
  return trees;
}

export { makeTrees };
