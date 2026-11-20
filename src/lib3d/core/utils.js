import './base.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ---------------------------------------------------------------- utils */
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(20261012);
const rr = (a, b) => a + (b - a) * rand();
const pick = arr => arr[Math.floor(rand() * arr.length)];
// value noise (tileable over period p); the wood's painters run these in workers too, as their source (world/textures.js)
const PERM = new Uint8Array(512); { const r = rng(7); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
const fade = t => t * t * (3 - 2 * t);
function vnoise(x, y, px = 256, py = 256) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (i, j) => PERM[(PERM[((i % px) + px) % px & 255] + (((j % py) + py) % py & 255)) & 511] / 255;
  const u = fade(xf), v = fade(yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
function fbm(x, y, oct = 4, px = 256, py = 256) { let s = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, y * f, px * f, py * f); n += a; a *= 0.5; f *= 2; } return s / n; }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctex(c, { srgb = true, rep = true } = {}) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
/* A glow's texture (white, fading out): drawn by paint(ctx) on a canvas (gradients), except in WebKit (Safari), whose
   canvas gradients are dithered with coloured noise that an additive glow over the room shows as red and green specks.
   There it is written as numbers instead: alpha fn(x, y) (0..1, at pixel centres), the colour times the alpha, as WebKit
   took those gradient canvases (premultiplied: as bright as they were there; written white, far brighter). */
const WEBKIT = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium|Edg\//.test(navigator.userAgent);
function alphaTex(w, h, fn, paint) {
  const c = canvas(w, h), g = c.getContext('2d');
  if (!WEBKIT) { paint(g); return ctex(c, { rep: false }); }
  const im = g.createImageData(w, h), d = im.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, a = Math.round(255 * Math.max(0, Math.min(1, fn(x + 0.5, y + 0.5)))); d[i] = d[i + 1] = d[i + 2] = d[i + 3] = a; }
  g.putImageData(im, 0, 0); return ctex(c, { rep: false });
}
const radialPaint = (g, cx, cy, r0, r1, stops) => { const gr = g.createRadialGradient(cx, cy, r0, cx, cy, r1); for (const [t, a] of stops) gr.addColorStop(t, `rgba(255,255,255,${a})`); g.fillStyle = gr; g.fillRect(0, 0, g.canvas.width, g.canvas.height); };
const stopsAt = (stops, t) => {   // a gradient's stops [[t, a], …] (t rising) at t, as a canvas gradient has them
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [t0, a0] = stops[i - 1], [t1, a1] = stops[i]; return a0 + (a1 - a0) * (t - t0) / (t1 - t0 || 1); }
  return stops[stops.length - 1][1];
};
const hsl = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l);
// a picture at half its size, drawn at full size first so its strokes keep their weight: the trees' (sharpness lowered a step;
// they are seen in the picture at ~0.8 px a CSS px, so their full-size textures held twice the detail anyone sees)
// a texture's picture drawn down to at most n px on its longer side (its bitmap let go), the page's memory
function shrinkTexture(t, n) {
  const im = t && t.image; if (!im || !im.width || Math.max(im.width, im.height) <= n) return;
  const s = n / Math.max(im.width, im.height), c = canvas(Math.max(1, Math.round(im.width * s)), Math.max(1, Math.round(im.height * s))), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height); if (im.close) im.close(); t.image = c; t.needsUpdate = true;
}
function halfCanvas(c) { const h = canvas(Math.max(1, c.width >> 1), Math.max(1, c.height >> 1)), g = h.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, h.width, h.height); return h; }

/* Box with world-scaled UVs: v runs along the longest in-plane side, 1 UV = `tile` metres */
function boardGeo(w, h, d, tile = 1, round = 0) {   // (round: its edges rounded off by that radius, so they catch the light)
  const g = round ? new RoundedBoxGeometry(w, h, d, 1, round) : new THREE.BoxGeometry(w, h, d); const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    // (a rounded box's faces come in the order +x -x +y -y +z -z: its rounded edges keep their face's grain)
    const ax = round ? Math.floor(i / (p.count / 6) / 2) : Math.abs(n.getX(i)) > 0.5 ? 0 : Math.abs(n.getY(i)) > 0.5 ? 1 : 2;
    const c = [p.getX(i), p.getY(i), p.getZ(i)], sz = [w, h, d];
    const axes = [0, 1, 2].filter(k => k !== ax).sort((a, b) => sz[a] - sz[b]);
    uv.setXY(i, (c[axes[0]] + 7.31 * ax) / tile, (c[axes[1]] + 3.7 * ax) / tile);
  }
  return g;
}
function place(geo, x, y, z, ry = 0) { const g = geo.clone(); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; }

export { PERM, alphaTex, boardGeo, canvas, ctex, fade, fbm, halfCanvas, hsl, pick, place, rand, rng, radialPaint, rr, shrinkTexture, stopsAt, vnoise };
