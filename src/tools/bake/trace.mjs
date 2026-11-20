// The room's triangles in a tree of boxes, and rays through it (bake.mjs and its workers share the arrays).
// build(P): P = 9 numbers a triangle. Returns { tri (v0, edge 1, edge 2, normal: 12 a triangle, in the tree's order),
// order (the tree's order → the triangle's own number), nodes (min, max: 6 a node), kids (2 a node: the right child and
// minus the left one, or the first triangle and how many) }.
export function build(P) {
  const n = P.length / 9, cen = new Float32Array(n * 3), idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) { idx[i] = i; for (let k = 0; k < 3; k++) cen[i * 3 + k] = (P[i * 9 + k] + P[i * 9 + 3 + k] + P[i * 9 + 6 + k]) / 3; }
  const nodes = new Float32Array(n * 2 * 6), kids = new Int32Array(n * 2 * 2); let nn = 0;
  const box = (a, b, o) => { let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = a; i < b; i++) { const t = idx[i] * 9; for (let k = 0; k < 9; k += 3) { const x = P[t + k], y = P[t + k + 1], z = P[t + k + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; } }
    nodes[o] = x0; nodes[o + 1] = y0; nodes[o + 2] = z0; nodes[o + 3] = x1; nodes[o + 4] = y1; nodes[o + 5] = z1; };
  const select = (a, b, k, ax) => { while (b - a > 1) { const pv = cen[idx[(a + b) >> 1] * 3 + ax]; let i = a, j = b - 1;   // idx[a..b) parted about its k-th by centre along ax
      while (i <= j) { while (cen[idx[i] * 3 + ax] < pv) i++; while (cen[idx[j] * 3 + ax] > pv) j--; if (i <= j) { const t = idx[i]; idx[i] = idx[j]; idx[j] = t; i++; j--; } }
      if (k <= j) b = j + 1; else if (k >= i) a = i; else return; } };
  const stack = [[0, n, 0]]; nn = 1;
  while (stack.length) {
    const [a, b, me] = stack.pop(); box(a, b, me * 6);
    if (b - a <= 4) { kids[me * 2] = a; kids[me * 2 + 1] = b - a; continue; }
    let c0 = [1e9, 1e9, 1e9], c1 = [-1e9, -1e9, -1e9]; for (let i = a; i < b; i++) for (let k = 0; k < 3; k++) { const v = cen[idx[i] * 3 + k]; if (v < c0[k]) c0[k] = v; if (v > c1[k]) c1[k] = v; }
    const ax = c1[0] - c0[0] > c1[1] - c0[1] ? (c1[0] - c0[0] > c1[2] - c0[2] ? 0 : 2) : (c1[1] - c0[1] > c1[2] - c0[2] ? 1 : 2), mid = (a + b) >> 1;
    select(a, b, mid, ax);
    const l = nn++, r = nn++; kids[me * 2] = r; kids[me * 2 + 1] = -l;   // (inner: the right child, and minus the left)
    stack.push([mid, b, r], [a, mid, l]);
  }
  const tri = new Float32Array(n * 12);
  for (let i = 0; i < n; i++) { const t = idx[i] * 9, o = i * 12, ax = P[t + 3] - P[t], ay = P[t + 4] - P[t + 1], az = P[t + 5] - P[t + 2], bx = P[t + 6] - P[t], by = P[t + 7] - P[t + 1], bz = P[t + 8] - P[t + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1;
    tri.set([P[t], P[t + 1], P[t + 2], ax, ay, az, bx, by, bz, nx / l, ny / l, nz / l], o); }
  return { tri, order: idx, nodes: nodes.slice(0, nn * 6), kids: kids.slice(0, nn * 2) };
}
// rays through the tree T: hit(o, d, tmax) → the distance to the nearest triangle (Infinity: none), its number in the
// tree's order in hit.i, which side in hit.back; any(o, d, tmax) → true if anything lies within tmax
export function tracer(T) {
  const { tri, nodes, kids } = T, st = new Int32Array(96);
  const one = (i, ox, oy, oz, dx, dy, dz) => { const o = i * 12, e1x = tri[o + 3], e1y = tri[o + 4], e1z = tri[o + 5], e2x = tri[o + 6], e2y = tri[o + 7], e2z = tri[o + 8];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz; if (det > -1e-12 && det < 1e-12) return -1;
    const inv = 1 / det, tx = ox - tri[o], ty = oy - tri[o + 1], tz = oz - tri[o + 2], u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) return -1;
    return (e2x * qx + e2y * qy + e2z * qz) * inv; };
  const run = (ox, oy, oz, dx, dy, dz, tmax, first) => {
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz; let sp = 0, best = tmax, bi = -1; st[sp++] = 0;
    while (sp) { const nd = st[--sp], o = nd * 6;
      let t0 = (nodes[o] - ox) * ix, t1 = (nodes[o + 3] - ox) * ix, lo = t0 < t1 ? t0 : t1, hi = t0 < t1 ? t1 : t0;
      t0 = (nodes[o + 1] - oy) * iy; t1 = (nodes[o + 4] - oy) * iy; if (t0 > t1) { const t = t0; t0 = t1; t1 = t; } if (t0 > lo) lo = t0; if (t1 < hi) hi = t1;
      t0 = (nodes[o + 2] - oz) * iz; t1 = (nodes[o + 5] - oz) * iz; if (t0 > t1) { const t = t0; t0 = t1; t1 = t; } if (t0 > lo) lo = t0; if (t1 < hi) hi = t1;
      if (hi < 0 || lo > hi || lo > best) continue;
      const k = kids[nd * 2 + 1];
      if (k > 0) { const a = kids[nd * 2]; for (let i = a; i < a + k; i++) { const t = one(i, ox, oy, oz, dx, dy, dz); if (t > 1e-5 && t < best) { best = t; bi = i; if (first) return 0; } } }
      else { st[sp++] = kids[nd * 2]; st[sp++] = -k; }
    }
    hit.i = bi; return bi < 0 ? Infinity : best;
  };
  const hit = (ox, oy, oz, dx, dy, dz, tmax = 1e9) => { const t = run(ox, oy, oz, dx, dy, dz, tmax, false); if (hit.i >= 0) { const o = hit.i * 12; hit.back = dx * tri[o + 9] + dy * tri[o + 10] + dz * tri[o + 11] > 0; } return t; };
  hit.i = -1; hit.back = false;
  const any = (ox, oy, oz, dx, dy, dz, tmax) => run(ox, oy, oz, dx, dy, dz, tmax, true) === 0;
  return { hit, any };
}
