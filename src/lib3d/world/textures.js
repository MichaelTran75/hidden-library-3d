import '../core/utils.js';   // build order: the module before this one runs first
import { canvas, fbm, hslPx, rng } from '../core/utils.js';

/* ---------------------------------------------------------------- textures */
function woodPlanks({ w = 512, h = 2048, planks = 6, hue = 33, sat = .52, light = .60, vary = .07, seed = 3, gap = 0.42, grain = 1 } = {}) {
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data; const r = rng(seed);
  const pw = w / planks, segs = [];
  for (let i = 0; i < planks; i++) { const list = []; let v = r() * h; const start = v; while (v < start + h) { const len = (0.22 + r() * 0.35) * h; list.push({ a: v, b: v + len, l: light + (r() - .5) * 2 * vary, hu: hue + (r() - .5) * 6, s: sat + (r() - .5) * .12, k: r() * 100 }); v += len; } segs.push(list); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
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
    const col = hslPx(seg.hu + (streak - .5) * 4, seg.s, Math.min(.92, l));
    const o = (y * w + x) * 4; d[o] = col.r * 255; d[o + 1] = col.g * 255; d[o + 2] = col.b * 255; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}
function grainTex({ w = 256, h = 1024, hue = 32, sat = .55, light = .58, seed = 9 } = {}) {
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h; const wob = fbm(u * 3 + seed, v * 2, 3, 3, 2) * 2.2;
    const s = fbm(u * 18 + wob, v * 3, 4, 18, 3); const ring = 0.5 + 0.5 * Math.sin((u * 7 + wob * 1.6) * 6.283);
    const col = hslPx(hue + (s - .5) * 5, sat, light * (0.84 + 0.24 * s) * (0.94 + 0.07 * ring));
    const o = (y * w + x) * 4; d[o] = col.r * 255; d[o + 1] = col.g * 255; d[o + 2] = col.b * 255; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}
function noiseTex(w, h, f, { base = [235, 228, 214], amp = 30, oct = 5, seed = 0 } = {}) {
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const n = fbm(x / w * f + seed, y / h * f, oct, f, f) - .5; const o = (y * w + x) * 4; d[o] = base[0] + n * amp; d[o + 1] = base[1] + n * amp; d[o + 2] = base[2] + n * amp * 1.1; d[o + 3] = 255; }
  g.putImageData(img, 0, 0); return c;
}

export { grainTex, noiseTex, woodPlanks };
