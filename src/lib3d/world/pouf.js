import './decor/build.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { fbm, rng } from '../core/utils.js';

/* ---------------------------------------------------------------- pouf */
/* Floor cushion (bean bag) with folds. Physics notes behind the design: wrinkles appear where the cover is
   compressed in-plane and buckles (bending stiffness sets the fold width); a seat dent compresses the fabric
   circumferentially, so most folds fan out radially from it; folds are lens-shaped (pointed ends) with a ridge
   and a shadowed crease on one side; the bead weight bulges the lower sides and gathers the cover at the base. */
function poufGeometry(W = 1.4, D = 1.22, H = 0.52, seed = 31) {
  const seg = 380, rings = 190, n = 4.4, ye = 0.36 * H, m1 = 3.8, m2 = 3.4;
  const sup = a => Math.pow(Math.pow(Math.abs(Math.cos(a)), n) + Math.pow(Math.abs(Math.sin(a)), n), -1 / n);
  const tSeam = 0.6;
  const prof = t => {   // t: 0 top pole → 1 bottom pole ; returns [radial factor, height]
    if (t <= tSeam) { const phi = (1 - t / tSeam) * Math.PI / 2; return [Math.pow(Math.cos(phi), 2 / m1), ye + (H - ye) * Math.pow(Math.sin(phi), 2 / m1)]; }
    const psi = (t - tSeam) / (1 - tSeam) * Math.PI / 2; return [Math.pow(Math.cos(psi), 2 / m2) * (1 - 0.05 * Math.sin(psi)), ye * (1 - Math.sin(psi)) + 0.004];
  };
  const r = rng(seed), dent = { x: 0.05, z: 0.02, depth: 0.03, w: 0.36 };
  // ---- fold field (plan coordinates, metres): radial folds from the dent, edge folds, random crumples
  const folds = [];
  const addFold = (p0, p2, bend, w, A) => { const mx = (p0[0] + p2[0]) / 2, mz = (p0[1] + p2[1]) / 2, dx = p2[0] - p0[0], dz = p2[1] - p0[1], L = Math.hypot(dx, dz);
    const c = [mx - dz / L * bend, mz + dx / L * bend]; const pts = []; for (let k = 0; k <= 12; k++) { const u = k / 12; pts.push([(1 - u) * (1 - u) * p0[0] + 2 * u * (1 - u) * c[0] + u * u * p2[0], (1 - u) * (1 - u) * p0[1] + 2 * u * (1 - u) * c[1] + u * u * p2[1]]); }
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9; for (const q of pts) { minx = Math.min(minx, q[0]); maxx = Math.max(maxx, q[0]); minz = Math.min(minz, q[1]); maxz = Math.max(maxz, q[1]); }
    folds.push({ pts, w, A, side: r() < 0.5 ? 1 : -1, box: [minx - 4 * w, maxx + 4 * w, minz - 4 * w, maxz + 4 * w] }); };
  // a few long folds fanning out from the seat dent (they start well away from it: no "button" starburst)
  for (let i = 0; i < 7; i++) { const a = (i + r() * 0.8) / 7 * Math.PI * 2, r0 = 0.16 + r() * 0.16, r1 = 0.4 + r() * 0.3, da = (r() - .5) * 0.9;
    addFold([dent.x + Math.cos(a) * r0 * W / 1.4, dent.z + Math.sin(a) * r0 * D / 1.4], [dent.x + Math.cos(a + da) * r1 * W / 1.4, dent.z + Math.sin(a + da) * r1 * D / 1.4], (r() - .5) * 0.22, 0.024 + r() * 0.022, 0.012 + r() * 0.018); }
  // folds where the cover rolls over the rim, roughly perpendicular to the edge
  for (let i = 0; i < 18; i++) { const a = r() * Math.PI * 2, s = sup(a), ex = Math.cos(a) * s * W / 2 * 0.98, ez = Math.sin(a) * s * D / 2 * 0.98, l = 0.12 + r() * 0.2, ang = a + Math.PI + (r() - .5) * 1.1;
    addFold([ex + Math.cos(a) * 0.05, ez + Math.sin(a) * 0.05], [ex + Math.cos(ang) * l, ez + Math.sin(ang) * l], (r() - .5) * 0.1, 0.02 + r() * 0.018, 0.009 + r() * 0.015); }
  // crumples of every size and direction (crushed velvet that has been sat on)
  for (let i = 0; i < 30; i++) { const rr2 = Math.sqrt(r()) * 0.9, aa = r() * Math.PI * 2, cx = Math.cos(aa) * rr2 * W / 2, cz = Math.sin(aa) * rr2 * D / 2, a = r() * Math.PI, l = 0.08 + r() * 0.24;
    addFold([cx - Math.cos(a) * l / 2, cz - Math.sin(a) * l / 2], [cx + Math.cos(a) * l / 2, cz + Math.sin(a) * l / 2], (r() - .5) * 0.14, 0.018 + r() * 0.016, 0.007 + r() * 0.013); }
  // side band: curved lens folds in (perimeter arc, profile) metres, any direction within ±70° of vertical
  const Rp = 0.62, Lt = 1.15, sideFolds = [];
  for (let i = 0; i < 34; i++) { const ac = r() * Math.PI * 2, tc = 0.44 + r() * 0.36, th = Math.PI / 2 + (r() - .5) * 2.4, l = 0.1 + r() * 0.24, bend = (r() - .5) * 0.1;
    const hx = Math.cos(th) * l / 2, hy = Math.sin(th) * l / 2, cx = -hy / (l / 2) * bend, cy = hx / (l / 2) * bend, pts = [];
    for (let k = 0; k <= 10; k++) { const u = k / 10; pts.push([(1 - u) * (1 - u) * -hx + 2 * u * (1 - u) * cx + u * u * hx, (1 - u) * (1 - u) * -hy + 2 * u * (1 - u) * cy + u * u * hy]); }
    sideFolds.push({ ac, tc, pts, w: 0.02 + r() * 0.016, A: 0.007 + r() * 0.012, side: r() < 0.5 ? 1 : -1, ext: l / 2 + 0.12 }); }
  const lensAt = (f, x, z) => {   // distance to the fold's polyline → ridge with a shadowed crease on one side, tapered ends
    let best = 1e9, bu = 0, bs = 0; const P = f.pts;
    for (let k = 0; k < P.length - 1; k++) { const ax = P[k][0], az = P[k][1], bx = P[k + 1][0] - ax, bz = P[k + 1][1] - az; const L2 = bx * bx + bz * bz || 1e-12;
      let u = ((x - ax) * bx + (z - az) * bz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u; const dx = x - ax - bx * u, dz = z - az - bz * u, d = dx * dx + dz * dz;
      if (d < best) { best = d; bu = (k + u) / (P.length - 1); bs = Math.sign(bx * (z - az) - bz * (x - ax)); } }
    const d = Math.sqrt(best), env = Math.pow(Math.sin(Math.PI * bu), 0.8); if (env <= 0) return 0;
    const cw = Math.max(0.6 * f.w, 0.013); return f.A * env * (Math.exp(-((d / f.w) ** 2)) - (bs === f.side ? 0.75 * Math.exp(-(((d - 1.1 * f.w - 0.5 * cw) / cw) ** 2)) : 0)); };
  const sideH = (ang, t) => { let hs = 0;
    for (const f of sideFolds) { let da = ang - f.ac; da = Math.atan2(Math.sin(da), Math.cos(da)); const px = da * Rp, py = (t - f.tc) * Lt; if (Math.abs(px) > f.ext || Math.abs(py) > f.ext) continue; hs += lensAt(f, px, py); }
    return 0.026 * Math.tanh(hs / 0.026); };
  const foldH = (x, z) => {
    let hsum = 0;
    for (const f of folds) { if (x < f.box[0] || x > f.box[1] || z < f.box[2] || z > f.box[3]) continue; hsum += lensAt(f, x, z); }
    return 0.034 * Math.tanh(hsum / 0.034);
  };
  // ---- vertices: top pole, rings (no duplicated seam column), bottom pole
  const pos = [], base = []; const ringStart = [];
  const push = (x, y, z) => { pos.push(x, y, z); };
  push(0, H, 0); base.push([0, H, 0, 0]);
  for (let j = 1; j < rings; j++) { const t = j / rings, [rf, y] = prof(t); ringStart.push(pos.length / 3);
    for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2, s = sup(a); push(Math.cos(a) * s * rf * W / 2, y, Math.sin(a) * s * rf * D / 2); base.push([0, 0, 0, t]); } }
  push(0, 0.004, 0); base.push([0, 0, 0, 1]);
  const nv = pos.length / 3, idx = [];
  const ring = (j, i) => j === 0 ? 0 : j === rings ? nv - 1 : ringStart[j - 1] + ((i % seg) + seg) % seg;
  for (let i = 0; i < seg; i++) idx.push(0, ring(1, i + 1), ring(1, i));
  for (let j = 1; j < rings - 1; j++) for (let i = 0; i < seg; i++) { const a = ring(j, i), b = ring(j + 1, i), c = ring(j, i + 1), d = ring(j + 1, i + 1); idx.push(a, c, b, b, c, d); }
  for (let i = 0; i < seg; i++) idx.push(ring(rings - 1, i), ring(rings - 1, i + 1), nv - 1);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  // ---- displace: seat dent, folds (fading over the rim), base gathers, lumpy fill
  const P = g.attributes.position, N = g.attributes.normal;
  for (let v = 0; v < nv; v++) {
    const t = base[v][3]; let x = P.getX(v), y = P.getY(v), z = P.getZ(v);
    const nx = N.getX(v), ny = N.getY(v), nz = N.getZ(v);
    const topW = t < tSeam ? 1 : Math.max(0, 1 - (t - tSeam) / 0.12);
    const dd = Math.exp(-((x - dent.x) ** 2 + (z - dent.z) ** 2) / (dent.w * dent.w)) * Math.max(0, (y - ye) / (H - ye));
    const lump = (fbm(x * 2.2 + 4, z * 2.2 + 9, 3) - 0.5) * 0.03 * topW;
    let disp = foldH(x, z) * Math.pow(topW, 1.5) + lump;
    { const sw = Math.min(1, Math.max(0, (t - 0.4) / 0.12)) * (1 - Math.min(1, Math.max(0, (t - 0.84) / 0.08))); if (sw > 0) disp += sw * sideH(Math.atan2(z / D, x / W), t); }
    // gathers along the base: short vertical pleats just above the bottom seam
    const ang = Math.atan2(z / D, x / W); const gw = Math.exp(-(((t - 0.8) / 0.09) ** 2));
    disp += gw * (-Math.pow(0.5 + 0.5 * Math.cos(ang * 22 + fbm(ang * 2, 3.3, 2) * 9), 3) * 0.006 * (0.4 + fbm(ang * 3 + 1.7, 0.5, 2)) + 0.002);
    x += nx * disp; y += ny * disp - dd * dent.depth; z += nz * disp;
    P.setXYZ(v, x, Math.max(0.003, y), z);
  }
  g.computeVertexNormals();
  { // concavity occlusion from the ring neighbours: how far a vertex sits below its neighbours along the normal
    const col = new Float32Array(nv * 3).fill(1), Nn = g.attributes.normal;
    for (let j = 2; j < rings - 1; j++) for (let i = 0; i < seg; i++) {
      const v = ring(j, i), nb = [ring(j - 1, i), ring(j + 1, i), ring(j, i - 1), ring(j, i + 1), ring(j - 2, i), ring(j + 2 < rings ? j + 2 : j + 1, i), ring(j, i - 2), ring(j, i + 2)];
      let ax = 0, ay = 0, az = 0; for (const k of nb) { ax += P.getX(k); ay += P.getY(k); az += P.getZ(k); } ax = ax / nb.length - P.getX(v); ay = ay / nb.length - P.getY(v); az = az / nb.length - P.getZ(v);
      const conc = ax * Nn.getX(v) + ay * Nn.getY(v) + az * Nn.getZ(v);      // > 0: neighbours stand above → valley
      let o = Math.min(1, Math.max(0.24, 1 - conc * 185)) * (conc < 0 ? Math.min(1.25, 1 - conc * 50) : 1);
      if (o < 1) o *= 1 - 0.45 * Math.min(1, (1 - o) / 0.25);   // (the folds' valleys 45 % darker, the shallow ones less: G, 24/10/2026)
      col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = o;
    }
    // smoothed over its neighbours, twice (per vertex, a deep fold read as a dotted line along the triangles' edges: G, 24/10/2026,
    // "remove răng cưa trên pouf"), then deepened a little so the folds keep their dark
    for (let pass = 0; pass < 2; pass++) { const src = col.slice();
      for (let j = 2; j < rings - 1; j++) for (let i = 0; i < seg; i++) { const v = ring(j, i); let sum = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj; if (jj < 1 || jj > rings - 1) continue; sum += src[ring(jj, i + di) * 3] * (di === 0 && dj === 0 ? 2 : 1); n += di === 0 && dj === 0 ? 2 : 1; }
        const o = Math.pow(sum / n, 1.25); col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = o; } }
    // soft contact shadow towards the floor (in red and blue only: green keeps the folds' own shade, for the shader to draw
    // them crisp: velvet.js aoSharp)
    for (let v = 0; v < nv; v++) { const y = P.getY(v), k = 0.55 + 0.45 * Math.min(1, y / 0.12); col[v * 3] *= k; col[v * 3 + 2] *= k; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  // bottom seam loop (welt cord) on the ring nearest 7 cm height
  let js = 1, best = 1e9; for (let j = 1; j < rings; j++) { const yy = prof(j / rings)[1]; if (j / rings > tSeam && Math.abs(yy - 0.07) < best) { best = Math.abs(yy - 0.07); js = j; } }
  const seam = []; for (let i = 0; i < seg; i += 2) { const k = ring(js, i); seam.push(new THREE.Vector3(P.getX(k) + N.getX(k) * 0.004, P.getY(k) + N.getY(k) * 0.004, P.getZ(k) + N.getZ(k) * 0.004)); }
  g.userData.seam = seam; g.computeBoundingSphere();
  return g;
}

export { poufGeometry };
