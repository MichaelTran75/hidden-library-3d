import '../core/utils.js';   // build order: the module before this one runs first
import { tick } from '../core/base.js';
import { PERM, fade, fbm, rng, vnoise } from '../core/utils.js';

/* ---------------------------------------------------------------- textures
   The room's wood (floor, ceiling, oak, frames) is painted pixel by pixel, 1.6 million of them: in workers while the
   room is built (G, 17/10/2026: the room shows sooner; on the page's own thread they held it up about 0.35 s). Where a
   worker cannot be started, or fails, what is left is painted here as before. Both run the same painters (the workers
   are given this file's functions as their source), so the pictures come out the same to the byte. */
function hue2rgb(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t); return p; }
function hslRgb(h, s, l, o) {   // HSL (hue in degrees) to RGB 0..1, into o: three's Color.setHSL in the working space (no transfer), without three
  h = (h / 360 % 1 + 1) % 1; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  if (s === 0) { o[0] = o[1] = o[2] = l; return o; }
  const p = l <= 0.5 ? l * (1 + s) : l + s - l * s, q = 2 * l - p;
  o[0] = hue2rgb(q, p, h + 1 / 3); o[1] = hue2rgb(q, p, h); o[2] = hue2rgb(q, p, h - 1 / 3); return o;
}
// the painters: RGBA into d, the rows y0 to y1 of a w × h picture (a band of it: the floor is shared out among the workers)
function paintPlanks(d, { w = 512, h = 2048, planks = 6, hue = 33, sat = .52, light = .60, vary = .07, seed = 3, gap = 0.42, grain = 1, y0 = 0, y1 = h } = {}) {
  const r = rng(seed), pw = w / planks, segs = [], col = [0, 0, 0];
  for (let i = 0; i < planks; i++) { const list = []; let v = r() * h; const start = v; while (v < start + h) { const len = (0.22 + r() * 0.35) * h; list.push({ a: v, b: v + len, l: light + (r() - .5) * 2 * vary, hu: hue + (r() - .5) * 6, s: sat + (r() - .5) * .12, k: r() * 100 }); v += len; } segs.push(list); }
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    const i = Math.floor(x / pw), lx = x - i * pw; let seg = null, yy = y;
    for (const s of segs[i]) { let t = yy; if (t < s.a) t += h; if (t >= s.a && t < s.b) { seg = s; yy = t; break; } }
    if (!seg) seg = segs[i][0];
    const ux = lx / pw;
    const wob = fbm(ux * 2 + seg.k, yy / h * 3, 3) * 3.0;
    const streak = fbm((ux * 26 + wob) * grain + seg.k, yy / h * 2.5, 4, 1024, 1024);
    const ring = 0.5 + 0.5 * Math.sin((ux * 9 + wob * 2.2 + fbm(yy / h * 4, seg.k) * 4) * 3.1);
    let l = seg.l * (0.86 + 0.22 * streak) * (0.93 + 0.08 * ring);
    const edge = Math.min(lx, pw - lx), endD = Math.min(Math.abs(yy - seg.a), Math.abs(seg.b - yy));
    if (edge < 1.2 || endD < 1.2) l *= gap; else if (edge < 4) l *= 0.94 + 0.015 * edge;
    hslRgb(seg.hu + (streak - .5) * 4, seg.s, Math.min(.92, l), col);
    const o = ((y - y0) * w + x) * 4; d[o] = col[0] * 255; d[o + 1] = col[1] * 255; d[o + 2] = col[2] * 255; d[o + 3] = 255;
  }
  return d;
}
function paintGrain(d, { w = 256, h = 1024, hue = 32, sat = .55, light = .58, seed = 9, y0 = 0, y1 = h } = {}) {
  const col = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h; const wob = fbm(u * 3 + seed, v * 2, 3, 3, 2) * 2.2;
    const s = fbm(u * 18 + wob, v * 3, 4, 18, 3); const ring = 0.5 + 0.5 * Math.sin((u * 7 + wob * 1.6) * 6.283);
    hslRgb(hue + (s - .5) * 5, sat, light * (0.84 + 0.24 * s) * (0.94 + 0.07 * ring), col);
    const o = ((y - y0) * w + x) * 4; d[o] = col[0] * 255; d[o + 1] = col[1] * 255; d[o + 2] = col[2] * 255; d[o + 3] = 255;
  }
  return d;
}
const PAINTERS = { planks: paintPlanks, grain: paintGrain };
function painterSource() {   // a worker's script: the painters and the noise they draw on, as written here
  return [`const PERM = new Uint8Array([${PERM}]), fade = ${fade};`, rng, vnoise, fbm, hue2rgb, hslRgb, paintPlanks, paintGrain,
    'const PAINTERS = { planks: paintPlanks, grain: paintGrain };',
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
