import '../core/utils.js';   // build order: the module before this one runs first
import { tick } from '../core/base.js';
import { PERM, fade, fbm, rng, vnoise } from '../core/utils.js';

/* ---------------------------------------------------------------- textures
   The room's wood (floor, ceiling, oak, frames) is painted pixel by pixel, 1.6 million of them: in workers while the
   room is built (the room shows sooner; on the page's own thread they held it up about 0.35 s). Where a
   worker cannot be started, or fails, what is left is painted here as before. Both run the same painters (the workers
   are given this file's functions as their source), so the pictures come out the same to the byte. */
function hue2rgb(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t); return p; }
function hslRgb(h, s, l, o) {   // HSL (hue in degrees) to RGB 0..1, into o: three's Color.setHSL in the working space (no transfer), without three
  h = (h / 360 % 1 + 1) % 1; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  if (s === 0) { o[0] = o[1] = o[2] = l; return o; }
  const p = l <= 0.5 ? l * (1 + s) : l + s - l * s, q = 2 * l - p;
  o[0] = hue2rgb(q, p, h + 1 / 3); o[1] = hue2rgb(q, p, h); o[2] = hue2rgb(q, p, h - 1 / 3); return o;
}
// the painter: RGBA into d, the rows y0 to y1 of a w × h picture (a band of it: the floor is shared out among the workers).
// Boards side by side across the picture (mw metres of them, mh along), each sawn from its own place in a log: the pith
// lies px across and py under its face, so the growth rings (ring: a year's, m) come up through the face as long stripes
// where the face cuts them steeply, and as cathedral arches over the pith, the trunk tapering along the board (t). Flat
// sawn boards and quarter sawn ones (the pith far to one side: straight, close lines; rays: an oak's pale flecks there).
// joint 'gap': a floor's boards, ends butted at random lengths (len, of the picture's), a dark line between them; the
// alpha is then how far a point is from the nearest joint (0..12 mm as 0..1: the seams fall on pixels' middles, so it
// reads true between them), from which the material draws the joint sharp at any distance (world/timber.js); in the
// colours the joint is only a soft shade (seam: how wide, m), what is left of it from far off.
// joint 'glue': staves glued up into one panel, no ends: the wood comes round along the picture, which repeats there.
function paintBoards(d, { w = 1024, h = 1024, mw = 1.08, mh = 4.32, planks = 6, hue = 28, sat = .55, light = .5, vary = .06, seed = 3, joint = 'gap', ring = 0.0042, depth = 1, rays = 0, len = [0.22, 0.57], seam = 0.0017, y0 = 0, y1 = h } = {}) {
  const r = rng(seed), mx = mw / w, my = mh / h, pw = mw / planks, loop = joint !== 'gap', col = [0, 0, 0], sx = [], segs = [];
  const sm = (a, b, x) => { x = Math.max(0, Math.min(1, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
  const per = f => Math.max(1, Math.round(f * mh)), nW = per(0.45), nD = per(0.7), nR = per(2), nS = per(3.5), nL = per(5), nB = per(0.9);   // (how many times a thing varies along the picture: so many a metre, a whole number of them)
  for (let i = 0; i <= planks; i++) sx.push(Math.round(i * w / planks - 0.5) + 0.5);
  const board = (a, b) => {
    const flat = r() < 0.5, rw = ring * (0.7 + 0.7 * r()); let t = (0.002 + 0.006 * r()) * (r() < .5 ? -1 : 1);
    if (loop) t = Math.max(1, Math.round(Math.abs(t) * mh / rw)) * rw / mh * Math.sign(t);   // (a whole number of rings along the picture)
    return { a, b, l: light + (r() - .5) * 2 * vary, hu: hue + (r() - .5) * 6, s: sat + (r() - .5) * .12, k: Math.floor(r() * 200), flat, rw, t, n: Math.max(1, Math.round(Math.abs(t) * mh / rw)),
      px: flat ? pw * (0.1 + 0.8 * r()) : pw * (r() < .5 ? -(0.5 + 2 * r()) : 1.5 + 2 * r()), py: flat ? 0.010 + 0.045 * r() : 0.03 + 0.12 * r() };
  };
  for (let i = 0; i < planks; i++) {
    const list = [];
    if (loop) list.push(board(0, h + 1));
    else {
      const ls = []; let sum = 0; while (sum < 1) { const q = len[0] + r() * (len[1] - len[0]); ls.push(q); sum += q; }
      let v = Math.round(r() * h) + 0.5; const start = v;
      ls.forEach((q, j) => { const e = j === ls.length - 1 ? start + h : Math.round(v + q / sum * h - 0.5) + 0.5; list.push(board(v, e)); v = e; });
    }
    segs.push(list);
  }
  for (let y = y0; y < y1; y++) for (let i = 0; i < planks; i++) {
    // (what holds all along a row of one board: which board, how far along it, where its pith lies there)
    let s = segs[i][0], yy = y + 0.5;
    if (!loop) for (const q of segs[i]) { let t = y + 0.5; if (t < q.a) t += h; if (t >= q.a && t < q.b) { s = q; yy = t; break; } }
    const Y = yy * my, v1 = yy / h, px = s.px + (fbm(s.k + 0.5, v1 * nW, 2, 256, nW) - .5) * 0.03, dz = Math.max(0.004, s.py + (fbm(s.k + 9.5, v1 * nD, 2, 256, nD) - .5) * 0.035);   // (a trunk is never straight: the arches come and go along the board)
    const wob = 0.003 * (fbm(s.k + 3.5, v1 * nR, 2, 256, nR) - .5), endD = loop ? 1 : Math.min(yy - s.a, s.b - yy) * my;
    for (let x = sx[i] - 0.5, xe = sx[i + 1] - 0.5; x < xe; x++) {
    const cx = x + 0.5, X = (cx - sx[i]) * mx, dx = X - px;
    let rad = Math.hypot(dx, dz); const sl = Math.abs(dx) / Math.max(rad, 1e-4);
    rad += wob + 0.0007 * (vnoise(X * 14 + s.k, v1 * nR, 256, nR) - .5);                                                                 // (nor its rings round)
    const rg = (rad + s.t * Y) / s.rw + 1.5 * vnoise(rad / (s.rw * 4) + s.k, 0.5) + 1.2 * vnoise(rad / (s.rw * 13) + s.k, 3.5), yr = Math.floor(rg), f = rg - yr;   // (years of wide rings, years of narrow)
    const fine = 1 - sm(0.07, 0.22, Math.max(sl * mx, Math.abs(s.t) * my) / s.rw);                                                      // (rings closer than the pixels: their mean)
    const year = vnoise((loop ? ((yr % s.n) + s.n) % s.n : yr & 255) + s.k, 7.5);
    const late = 0.3 + (sm(0.30, 0.88, f) * (1 - sm(0.88, 1, f)) * (0.35 + 0.9 * year) * (0.7 + 0.6 * vnoise(X * 55 + s.k, v1 * nL, 256, nL)) - 0.3) * fine;   // (a good year, a lean one; a line never even along its length)
    const broad = fbm(X * 5 + s.k, v1 * nB, 3, 256, nB) - .5, streak = fbm(X * 300 + s.k, v1 * nS, 2, 256, nS) - .5;
    let l = s.l * (1 - 0.30 * depth * (late - 0.3)) * (1 + 0.20 * broad + 0.12 * streak), a = 255;
    if (rays && !s.flat) l *= 1 + 0.035 * rays * sm(0.55, 0.85, vnoise(X * 45 + s.k, v1 * per(130), 256, per(130))) * sm(0.4, 0.65, vnoise(X * 7 + s.k, v1 * nB, 256, nB));
    const ex = Math.min(cx - sx[i], sx[i + 1] - cx) * mx;
    if (loop) { if (ex < mx * 0.5) l *= 0.94; }
    else { const dist = Math.min(ex, endD); a = Math.min(1, dist / 0.012) * 255; l *= (1 - 0.30 * Math.exp(-((dist / seam) ** 2))) * (0.96 + 0.04 * Math.min(1, dist / 0.006)); }
    hslRgb(s.hu + streak * 4 - (late - 0.3) * 2.5, s.s + 0.05 * (late - 0.3), Math.min(.92, l), col);
    const o = ((y - y0) * w + x) * 4; d[o] = col[0] * 255; d[o + 1] = col[1] * 255; d[o + 2] = col[2] * 255; d[o + 3] = a;
    }
  }
  return d;
}
const PAINTERS = { boards: paintBoards };
function painterSource() {   // a worker's script: the painters and the noise they draw on, as written here
  return [`const PERM = new Uint8Array([${PERM}]), fade = ${fade};`, rng, vnoise, fbm, hue2rgb, hslRgb, paintBoards,
    'const PAINTERS = { boards: paintBoards };',
    'onmessage = e => { const { kind, o } = e.data, d = PAINTERS[kind](new Uint8ClampedArray(o.w * (o.y1 - o.y0) * 4), o); postMessage(d, [d.buffer]); };'].join('\n');
}
// pictures [{ kind, o: { w, h, …painter's options }, bands }] → a promise of their pixels (RGBA, top row first), each
// painted in `bands` bands of rows, shared out among up to three workers as they come free
function paintPictures(list) {
  const jobs = [], out = list.map(p => p.bands > 1 ? new Uint8ClampedArray(p.o.w * p.o.h * 4) : null);
  list.forEach((p, k) => { const n = p.bands || 1; for (let b = 0; b < n; b++) jobs.push({ k, kind: p.kind, o: { ...p.o, y0: Math.round(p.o.h * b / n), y1: Math.round(p.o.h * (b + 1) / n) } }); });
  return new Promise(done => {
    let next = 0, left = jobs.length, url = null, alive = 0, here = false;
    const finish = (j, d) => { if (out[j.k]) out[j.k].set(d, j.o.y0 * j.o.w * 4); else out[j.k] = d; if (--left === 0) { if (url) URL.revokeObjectURL(url); done(out); } };
    const paintHere = async () => {   // (no worker: the rest on this thread, a pause between pictures)
      if (here) return; here = true;
      while (next < jobs.length) { const j = jobs[next++]; finish(j, PAINTERS[j.kind](new Uint8ClampedArray(j.o.w * (j.o.y1 - j.o.y0) * 4), j.o)); await tick(); }
    };
    const n = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)), workers = [];
    try { url = URL.createObjectURL(new Blob([painterSource()], { type: 'text/javascript' })); for (let i = 0; i < n; i++) workers.push(new Worker(url)); }
    catch (e) { for (const w of workers) w.terminate(); workers.length = 0; }
    alive = workers.length; if (!alive) { paintHere(); return; }
    for (const w of workers) {
      let cur = null;
      const give = () => { cur = next < jobs.length ? jobs[next++] : null; if (cur) w.postMessage({ kind: cur.kind, o: cur.o }); else { w.terminate(); alive--; } };
      w.onmessage = e => { const j = cur; give(); finish(j, e.data); };
      w.onerror = e => { e.preventDefault(); w.terminate(); if (cur) jobs.push(cur); cur = null; if (--alive === 0 && left) paintHere(); };   // (its picture to another, or here)
      give();
    }
  });
}

export { paintPictures };
