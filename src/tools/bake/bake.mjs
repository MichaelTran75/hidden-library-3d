// node bake.mjs DIR [voxel metres | again]: the room's light worked out by rays, once, for the page to look up (core/bake.js).
// (again: the last bake's figures, DIR/bake.raw, written out as a picture again: after a change to how they are kept)
// DIR holds scene.bin + scene.json (extract.cjs); written there: bake.webp (the light, four blocks of slices) and
// bake.json (its size, its box, its scales: what core/bake.js keeps between its BAKE-META marks).
// At the middle of each cell of a grid over the room:
//   - how much of the windows' light gets there past the furniture (0..1), and how much of the lamps';
//   - how open it is to what lies within 1.5 m (0..1);
//   - the light that comes back off everything the windows light, as a colour (the floor's warmth on what stands on
//     it), and off everything the lamps light: rays out every way, the windows' and lamps' light worked out where each
//     lands, then twice more for the light that had already bounced;
//   - what the lamps marked 'baked' give a face there looking each of the six ways along the axes (the page has no
//     lights of its own for those: fx/night.js).
// A cell inside a solid thing takes its neighbours' values. SHARP: the sharp module's path, for the picture.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { build, tracer } from './trace.mjs';
const NDIR = 128, RAO = 1.5, PI = Math.PI, ST = 14, EMAX = 45;   // (ST: figures a cell: counts, windows, lamps, open, back off the windows r g b, back off the lamps, the baked lamps on faces looking +x +y +z -x -y -z)   // (EMAX: a lamp's light on a face is counted up to this: a face a hand from a bulb would outshine all the rest and show as specks)
const fib = n => { const d = new Float32Array(n * 3), g = PI * (3 - Math.sqrt(5)); for (let i = 0; i < n; i++) { const y = 1 - (i + 0.5) * 2 / n, r = Math.sqrt(1 - y * y), a = g * i; d.set([Math.cos(a) * r + 1e-7, y + 1e-7, Math.sin(a) * r + 1e-7], i * 3); } return d; };
const rnd = seed => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

if (!isMainThread) {
  const W = workerData, T = { tri: new Float32Array(W.tri), nodes: new Float32Array(W.nodes), kids: new Int32Array(W.kids) }, order = new Uint32Array(W.order), ALB = new Float32Array(W.alb);
  const { hit, any } = tracer(T), tri = T.tri, { rects, lamps, grid } = W, [nx, ny, nz] = grid.n, s = grid.s, [bx, by, bz] = grid.min, DIRS = fib(NDIR), D14 = fib(14);
  const prev = W.prev ? new Float32Array(W.prev) : null;   // (the light that had bounced, a cell: r g b of the windows', then the lamps')
  for (const r of rects) { r.area = 4 * Math.hypot(...r.u) * Math.hypot(...r.v); }
  const lit = lamps.filter(L => L.role !== 'baked'), cast = lamps.filter(L => L.role === 'baked');   // (three's own lights; those whose light is all in the bake)
  const att = (L, d) => { let f = 1 / Math.max(d * d, 0.01); if (L.dist > 0) { const q = d / L.dist, k = Math.max(0, 1 - q * q * q * q); f *= k * k; } return f; };
  const spot = (L, cx) => { if (L.cosO === undefined) return 1; const t = Math.max(0, Math.min(1, (cx - L.cosO) / (L.cosI - L.cosO))); return t * t * (3 - 2 * t); };
  // the windows' light on a point with a normal (irradiance, the windows' radiance 1), with n rays to each
  const winAt = (px, py, pz, ax, ay, az, R, counts) => { let E = 0;
    for (let k = 0; k < rects.length; k++) { const r = rects[k], n = counts[k]; let e = 0;
      for (let i = 0; i < n; i++) { const a = R() * 2 - 1, b = R() * 2 - 1, sx = r.c[0] + r.u[0] * a + r.v[0] * b - px, sy = r.c[1] + r.u[1] * a + r.v[1] * b - py, sz = r.c[2] + r.u[2] * a + r.v[2] * b - pz;
        const d2 = sx * sx + sy * sy + sz * sz, d = Math.sqrt(d2), dx = sx / d, dy = sy / d, dz = sz / d, cl = -(r.n[0] * dx + r.n[1] * dy + r.n[2] * dz), cp = ax * dx + ay * dy + az * dz;
        if (cl <= 0 || cp <= 0) continue; if (!any(px, py, pz, dx + 1e-9, dy + 1e-9, dz + 1e-9, d - 0.02)) e += cl * cp / d2; }
      E += r.L * e * r.area / n; }
    return E; };
  const lampAt = (px, py, pz, ax, ay, az) => { let E = 0;
    for (const L of lamps) { const sx = L.p[0] - px, sy = L.p[1] - py, sz = L.p[2] - pz, d = Math.hypot(sx, sy, sz), dx = sx / d, dy = sy / d, dz = sz / d, cp = ax * dx + ay * dy + az * dz; if (cp <= 0) continue;
      const w = L.I * att(L, d) * (L.d ? spot(L, -(L.d[0] * dx + L.d[1] * dy + L.d[2] * dz)) : 1) * cp; if (w < 2e-3) continue;
      if (d < 0.27 || !any(px, py, pz, dx + 1e-9, dy + 1e-9, dz + 1e-9, d - 0.25)) E += w; }
    return Math.min(E, EMAX); };
  const look = (x, y, z, o) => {   // the bounced light at a point: the cells round it, weighed
    const fx = Math.max(0, Math.min(nx - 1.001, (x - bx) / s - 0.5)), fy = Math.max(0, Math.min(ny - 1.001, (y - by) / s - 0.5)), fz = Math.max(0, Math.min(nz - 1.001, (z - bz) / s - 0.5)), ix = fx | 0, iy = fy | 0, iz = fz | 0, tx = fx - ix, ty = fy - iy, tz = fz - iz;
    o[0] = o[1] = o[2] = o[3] = 0;
    for (let c = 0; c < 8; c++) { const w = (c & 1 ? tx : 1 - tx) * (c & 2 ? ty : 1 - ty) * (c & 4 ? tz : 1 - tz), q = ((ix + (c & 1)) + nx * ((iy + (c >> 1 & 1)) + ny * (iz + (c >> 2)))) * 4; o[0] += w * prev[q]; o[1] += w * prev[q + 1]; o[2] += w * prev[q + 2]; o[3] += w * prev[q + 3]; } };
  const LK = new Float32Array(4);
  parentPort.on('message', ({ from, to }) => {
    const out = new Float32Array((to - from) * ST);
    for (let v = from; v < to; v++) {
      const ix = v % nx, iy = ((v / nx) | 0) % ny, iz = (v / (nx * ny)) | 0, px = bx + (ix + 0.5) * s, py = by + (iy + 0.5) * s, pz = bz + (iz + 0.5) * s, o = (v - from) * ST, R = rnd(v * 2654435761);
      if (!prev) {
        let back = 0; for (let i = 0; i < 14; i++) { const t = hit(px, py, pz, D14[i * 3], D14[i * 3 + 1], D14[i * 3 + 2], 0.6); if (t < 0.6 && hit.back) back++; }
        if (back >= 6 || py < 0 || py > W.H) { out[o] = 0; continue; } out[o] = 1;
        // the windows, from everywhere on them (a grid of points, each moved about in its square)
        let sw = 0, sv = 0;
        for (const r of rects) { const nu = r.grid[0], nv = r.grid[1];
          for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = (i + R()) / nu * 2 - 1, b = (j + R()) / nv * 2 - 1, sx = r.c[0] + r.u[0] * a + r.v[0] * b - px, sy = r.c[1] + r.u[1] * a + r.v[1] * b - py, sz = r.c[2] + r.u[2] * a + r.v[2] * b - pz;
            const d2 = sx * sx + sy * sy + sz * sz, d = Math.sqrt(d2), dx = sx / d, dy = sy / d, dz = sz / d, cl = -(r.n[0] * dx + r.n[1] * dy + r.n[2] * dz); if (cl <= 0) continue;
            const w = r.L * cl / d2 * r.area / (nu * nv); sw += w; if (!any(px, py, pz, dx + 1e-9, dy + 1e-9, dz + 1e-9, d - 0.02)) sv += w; } }
        out[o + 1] = sw > 1e-6 ? sv / sw : 0;
        // the lamps: each by how much of its light would get here in an empty room
        sw = 0; sv = 0;
        for (const L of lit) { const sx = L.p[0] - px, sy = L.p[1] - py, sz = L.p[2] - pz, d = Math.hypot(sx, sy, sz), w = L.I * att(L, d) * (L.d ? spot(L, -(L.d[0] * sx + L.d[1] * sy + L.d[2] * sz) / d) : 1); if (w < 2e-3) continue;
          sw += w; for (let k = 0; k < 2; k++) { const jx = sx + (R() - 0.5) * 0.06, jy = sy + (R() - 0.5) * 0.06, jz = sz + (R() - 0.5) * 0.06, e = Math.hypot(jx, jy, jz); if (e < 0.27 || !any(px, py, pz, jx / e + 1e-9, jy / e + 1e-9, jz / e + 1e-9, e - 0.25)) sv += w / 2; } }
        out[o + 2] = sw > 1e-4 ? sv / sw : 1;
        // the baked lamps: what each gives a face here looking each of the six ways, past the furniture
        for (const L of cast) { const sx = L.p[0] - px, sy = L.p[1] - py, sz = L.p[2] - pz, d = Math.hypot(sx, sy, sz), w = L.I * att(L, d) * spot(L, -(L.d[0] * sx + L.d[1] * sy + L.d[2] * sz) / d); if (w < 2e-3) continue;
          let vis = 0; for (let k = 0; k < 2; k++) { const jx = sx + (R() - 0.5) * 0.06, jy = sy + (R() - 0.5) * 0.06, jz = sz + (R() - 0.5) * 0.06, e = Math.hypot(jx, jy, jz); if (e < 0.27 || !any(px, py, pz, jx / e + 1e-9, jy / e + 1e-9, jz / e + 1e-9, e - 0.25)) vis += 0.5; }
          if (!vis) continue; const lx = sx / d * w * vis, ly = sy / d * w * vis, lz = sz / d * w * vis;
          if (lx > 0) out[o + 8] += lx; else out[o + 11] -= lx; if (ly > 0) out[o + 9] += ly; else out[o + 12] -= ly; if (lz > 0) out[o + 10] += lz; else out[o + 13] -= lz; }
      }
      // rays out every way (the set turned for each cell): how open it is, and what comes back
      const th = R() * 2 * PI, cz = R() * 2 - 1, sz_ = Math.sqrt(1 - cz * cz), ux = sz_ * Math.cos(th), uy = sz_ * Math.sin(th), uz = cz, ang = R() * 2 * PI, ca = Math.cos(ang), sa = Math.sin(ang);
      let ao = 0, r_ = 0, g_ = 0, b_ = 0, l_ = 0;
      for (let i = 0; i < NDIR; i++) {
        let dx = DIRS[i * 3], dy = DIRS[i * 3 + 1], dz = DIRS[i * 3 + 2]; const dot = (ux * dx + uy * dy + uz * dz) * (1 - ca), cx = uy * dz - uz * dy, cy = uz * dx - ux * dz, cz2 = ux * dy - uy * dx;   // (turned about the axis u)
        dx = dx * ca + cx * sa + ux * dot; dy = dy * ca + cy * sa + uy * dot; dz = dz * ca + cz2 * sa + uz * dot;
        const t = hit(px, py, pz, dx, dy, dz); if (t === Infinity) continue;
        if (t < RAO) { const q = 1 - t / RAO; ao += q * q; }
        const k = hit.i * 12, f = hit.back ? -1 : 1, ax = f * tri[k + 9], ay = f * tri[k + 10], az = f * tri[k + 11], hx = px + dx * t + ax * 2e-3, hy = py + dy * t + ay * 2e-3, hz = pz + dz * t + az * 2e-3;   // (where it lands, a hair off the face, and the face's normal toward the cell)
        const a3 = order[hit.i] * 3, ar = ALB[a3], ag = ALB[a3 + 1], ab = ALB[a3 + 2], al = 0.3 * ar + 0.6 * ag + 0.1 * ab;
        if (!prev) { const Ew = winAt(hx, hy, hz, ax, ay, az, R, W.winN) / PI, El = lampAt(hx, hy, hz, ax, ay, az) / PI; r_ += ar * Ew; g_ += ag * Ew; b_ += ab * Ew; l_ += al * El; }
        else { look(hx + ax * s, hy + ay * s, hz + az * s, LK); r_ += ar * LK[0]; g_ += ag * LK[1]; b_ += ab * LK[2]; l_ += al * LK[3]; }
      }
      out[o + 3] = 1 - ao / NDIR; out[o + 4] = r_ / NDIR; out[o + 5] = g_ / NDIR; out[o + 6] = b_ / NDIR; out[o + 7] = l_ / NDIR;
    }
    parentPort.postMessage({ from, to, out }, [out.buffer]);
  });
} else {
  const [DIR, VOX = '0.1'] = process.argv.slice(2), t00 = Date.now();
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'scene.json'))), raw = fs.readFileSync(path.join(DIR, 'scene.bin')), N = meta.tris;
  const P = new Float32Array(raw.buffer, raw.byteOffset, N * 9), ALB0 = new Float32Array(raw.buffer, raw.byteOffset + N * 36, N * 3);
  const T = build(P); console.log(N, 'triangles,', T.nodes.length / 6, 'boxes,', Date.now() - t00, 'ms');
  const s = VOX === 'again' ? JSON.parse(fs.readFileSync(path.join(DIR, 'bake.json'))).s : +VOX, min = [meta.box.min[0], -s, meta.box.min[2]], n = [0, 1, 2].map(k => Math.ceil((meta.box.max[k] - min[k]) / s)), NV = n[0] * n[1] * n[2];
  meta.rects.forEach((r, i) => { r.grid = i ? [6, 5] : [16, 9]; });
  const share = a => { const sb = new SharedArrayBuffer(a.byteLength); new a.constructor(sb).set(a); return sb; };
  const base = { tri: share(T.tri), nodes: share(T.nodes), kids: share(T.kids), order: share(T.order), alb: share(new Float32Array(ALB0)), rects: meta.rects, lamps: meta.lamps, grid: { n, s, min }, H: meta.room.H, winN: [4, 1, 1] };
  const pass = prev => new Promise(done => {
    const nw = Math.max(1, os.cpus().length - 2), res = new Float32Array(NV * ST), step = n[0] * n[1]; let next = 0, left = 0, t0 = Date.now(), last = 0;
    for (let w = 0; w < nw; w++) { const wk = new Worker(new URL(import.meta.url), { workerData: { ...base, prev } });
      const give = () => { if (next >= NV) { wk.terminate(); if (!left) done(res); return; } const from = next, to = Math.min(NV, next + step); next = to; left++; wk.postMessage({ from, to }); };
      wk.on('message', m => { res.set(m.out, m.from * ST); left--; const pc = Math.floor(next / NV * 10); if (pc > last) { last = pc; process.stdout.write(` ${pc * 10}% ${((Date.now() - t0) / 1000).toFixed(0)}s`); } give(); });
      wk.on('error', e => { console.error(e); process.exit(1); }); give(); }
  });
  const at = (x, y, z) => x + n[0] * (y + n[1] * z);
  const spread = (res, ch) => {   // a cell inside a solid thing: the mean of its neighbours outside, and so on inward
    const ok = new Uint8Array(NV); for (let v = 0; v < NV; v++) ok[v] = res[v * ST] > 0.5 ? 1 : 0;
    for (let it = 0; it < 12; it++) { const got = [];
      for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) { const v = at(x, y, z); if (ok[v]) continue; let c = 0; const a = new Float32Array(ST);
        for (const [i, j, k] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const X = x + i, Y = y + j, Z = z + k; if (X < 0 || Y < 0 || Z < 0 || X >= n[0] || Y >= n[1] || Z >= n[2]) continue; const q = at(X, Y, Z); if (!ok[q]) continue; c++; for (const h of ch) a[h] += res[q * ST + h]; }
        if (c) got.push([v, a, c]); }
      for (const [v, a, c] of got) { ok[v] = 1; for (const h of ch) res[v * ST + h] = a[h] / c; } if (!got.length) break; }
  };
  const soften = (res, ch) => {   // what comes back, evened out a little among the cells that count (the rays are few)
    const src = res.slice();
    for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) { const v = at(x, y, z); if (src[v * ST] < 0.5) continue; let w = 0; const a = new Float32Array(ST);
      for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = x + i, Y = y + j, Z = z + k; if (X < 0 || Y < 0 || Z < 0 || X >= n[0] || Y >= n[1] || Z >= n[2]) continue; const q = at(X, Y, Z); if (src[q * ST] < 0.5) continue; const g = (i ? 0.5 : 1) * (j ? 0.5 : 1) * (k ? 0.5 : 1); w += g; for (const h of ch) a[h] += g * src[q * ST + h]; }
      for (const h of ch) res[v * ST + h] = a[h] / w; }
  };
  let total;
  if (VOX === 'again') total = new Float32Array(new Uint8Array(fs.readFileSync(path.join(DIR, 'bake.raw'))).buffer);   // (the figures of the last bake, written out again)
  else {
  const res = await pass(null); console.log('\nfirst light', ((Date.now() - t00) / 1000).toFixed(0), 's');
  const first = res.slice(); soften(first, [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]); soften(first, [4, 5, 6, 7]); total = first.slice();
  for (let b = 0; b < 2; b++) {   // the light that had bounced, bouncing again
    const tmp = total.slice(); spread(tmp, [4, 5, 6, 7]); const prev = new Float32Array(NV * 4); for (let v = 0; v < NV; v++) for (let k = 0; k < 4; k++) prev[v * 4 + k] = tmp[v * ST + 4 + k];
    const r2 = await pass(share(prev)); for (let v = 0; v < NV; v++) r2[v * ST] = res[v * ST]; soften(r2, [4, 5, 6, 7]); soften(r2, [4, 5, 6, 7]);
    total = first.slice(); for (let v = 0; v < NV; v++) for (let k = 4; k < 8; k++) total[v * ST + k] += r2[v * ST + k];
    console.log('\nbounce', b + 2, ((Date.now() - t00) / 1000).toFixed(0), 's');
  }
  for (let v = 0; v < NV; v++) total[v * ST] = res[v * ST];
  spread(total, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  }
  // the scales: what comes back, as its square root over the brightest one cell in two hundred holds
  // (the baked lamps' light runs from a tenth, far off, to hundreds by the ceiling: kept as its cube root, the others as square roots)
  const top = (ks, q = 0.995) => { const a = []; for (let v = 0; v < NV; v += 7) if (total[v * ST] > 0.5) a.push(Math.max(...ks.map(k => total[v * ST + k]))); a.sort((x, y) => x - y); return a[Math.floor(a.length * q)]; };
  const sky = top([4, 5, 6]) * 0.85, lamp = top([7]), down = Math.min(200, top([8, 9, 10, 11, 12, 13], 0.9995)), cols = 12, rows = Math.ceil(n[2] / cols), Wd = cols * n[0], Hb = rows * n[1], NB = 4, img = Buffer.alloc(Wd * Hb * NB * 3), lum = v => 0.3 * total[v + 4] + 0.6 * total[v + 5] + 0.1 * total[v + 6], enc = (x, m) => Math.round(255 * Math.sqrt(Math.max(0, Math.min(1, x / m))));
  let mean = new Float64Array(ST), cnt = 0;
  for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) { const v = at(x, y, z) * ST, X = (z % cols) * n[0] + x, Y = Math.floor(z / cols) * n[1] + y;
    const o = q => ((q * Hb + Y) * Wd + X) * 3; img[o(0)] = Math.round(255 * total[v + 1]); img[o(0) + 1] = Math.round(255 * total[v + 2]); img[o(0) + 2] = Math.round(255 * Math.max(0, Math.min(1, total[v + 3])));
    img[o(1)] = enc(lum(v), sky); img[o(1) + 1] = enc(total[v + 7], lamp);   // (what comes back off the windows' light: how bright; its colour is one for the room, `tint` below)
    for (let k = 0; k < 3; k++) { img[o(2) + k] = Math.round(255 * Math.cbrt(Math.max(0, Math.min(1, total[v + 8 + k] / down)))); img[o(3) + k] = Math.round(255 * Math.cbrt(Math.max(0, Math.min(1, total[v + 11 + k] / down)))); }
    if (total[v] > 0.5) { cnt++; for (let k = 1; k < ST; k++) mean[k] += total[v + k]; } }
  const ml = 0.3 * mean[4] + 0.6 * mean[5] + 0.1 * mean[6];
  const out = { n, cols, min: min.map(v => +v.toFixed(4)), s, sky: +sky.toPrecision(4), lamp: +lamp.toPrecision(4), down: +down.toPrecision(4), tint: [4, 5, 6].map(k => +(mean[k] / ml).toFixed(3)) };
  fs.writeFileSync(path.join(DIR, 'bake.json'), JSON.stringify(out)); fs.writeFileSync(path.join(DIR, 'bake.raw'), Buffer.from(total.buffer));
  const sharp = createRequire(import.meta.url)(process.env.SHARP || 'sharp');
  await sharp(img, { raw: { width: Wd, height: Hb * NB, channels: 3 } }).webp({ nearLossless: true, quality: 60, effort: 6 }).toFile(path.join(DIR, 'bake.webp'));   // (each value within 2 of 255: a quarter smaller than exact)
  await sharp(img, { raw: { width: Wd, height: Hb * NB, channels: 3 } }).png().toFile(path.join(DIR, 'bake.png'));
  const mm = k => (mean[k] / cnt).toFixed(4);
  console.log(JSON.stringify(out), '| cells that count', cnt, 'of', NV, '| means: windows', mm(1), 'lamps', mm(2), 'open', mm(3), 'back off the windows', mm(4), mm(5), mm(6), 'off the lamps', mm(7), 'baked lamps on faces looking up', mm(9), 'down', mm(12), 'sideways', mm(8), mm(11), mm(10), mm(13),
    '|', fs.statSync(path.join(DIR, 'bake.webp')).size, 'bytes,', ((Date.now() - t00) / 1000).toFixed(0), 's');
}
