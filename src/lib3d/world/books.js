import './room.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas, pick, rand, rng, rr } from '../core/utils.js';
import { room } from './room.js';

/* ---------------------------------------------------------------- books (instanced) */
const BOOK = { list: [], atlas: null };
const SPINES = 28, TILE = 64 / 2048, TITLED = 31;   // (spine variants in the atlas; one tile's width in its uv; the spine of a book of the page)
/* the books' atlas, laid out as 2048 x 1024 in 64-pixel tiles (stored at half, 1024 x 512): 28 spines, then the plain cloth (tile 28), the page block's edges
   (tiles 29-30) and the spine of a book of the page (tile 31: blind rules only, ui/words.js letters its own title). Its
   colour is the book's tint wherever its alpha is 1 (the cloth), and as drawn where it is 0 (the gilt, the inks, a
   paperback's strip). The spines are lettered as real spines are, top to bottom: a title, an author, a
   publisher's mark at the foot, stamped into the binding itself in gilt or in ink (nothing lies under the letters: no
   label, no panel), among bands, rules and raised leather bands; the cloth woven, its edges rubbed (the shelves' books made realistic) */
const SPINE_WORDS = ['ESSAYS', 'LETTERS', 'DIALOGUES', 'MEDITATIONS', 'THE REPUBLIC', 'ELEMENTS', 'PRINCIPIA', 'OPTICS', 'VOYAGES', 'CHRONICLES', 'MEMOIRS', 'LECTURES',
  'ODES', 'SONNETS', 'POEMS', 'NOTEBOOKS', 'A HISTORY', 'THE ATLAS', 'BOTANY', 'GEOMETRY', 'ANATOMY', 'THE ODYSSEY', 'TRAVELS', 'SERMONS', 'FABLES', 'ETHICS',
  'ON LIBERTY', 'THE PRINCE', 'WALDEN', 'LEVIATHAN', 'CANDIDE', 'EMMA', 'PERSUASION', 'MIDDLEMARCH', 'THE ILIAD', 'PENSÉES', 'CONFESSIONS', 'THE SEASONS'];
const SPINE_NAMES = ['PLATO', 'HUME', 'KANT', 'DARWIN', 'LOCKE', 'MILL', 'SMITH', 'HOMER', 'GOETHE', 'PASCAL', 'EULER', 'AUSTEN', 'ELIOT', 'TOLSTOY', 'DICKENS',
  'THOREAU', 'HOBBES', 'VOLTAIRE', 'MONTAIGNE', 'BACON', 'NEWTON', 'GIBBON', 'BURKE', 'RUSKIN', 'SENECA', 'OVID', 'DANTE', 'MILTON'];
// the drawing: its colours into g, into m where they are tinted (white) or kept as drawn (black); o: the atlas's size, its
// spines (n), the titled spine's tile and the words. A worker runs it from its source: it uses nothing of this module.
function drawSpines(g, m, o) {
  const { W, H, words, names } = o, cw = 64;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); m.fillStyle = '#fff'; m.fillRect(0, 0, W, H);
  const r = rng(77), pickR = a => a[Math.floor(r() * a.length)];
  const weave = (x0, w) => {   // book cloth: a fine woven grain, a little mottled, its edges rubbed lighter
    for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(0,0,0,${0.02 + r() * 0.03})`; g.fillRect(x0, y, w, 1); }
    for (let x = x0; x < x0 + w; x += 2) { g.fillStyle = `rgba(0,0,0,${0.015 + r() * 0.025})`; g.fillRect(x, 0, 1, H); }
    for (let k = 0; k < 260; k++) { g.fillStyle = `rgba(${r() < .5 ? '0,0,0' : '255,255,255'},${r() * .022})`; g.beginPath(); g.ellipse(x0 + r() * w, r() * H, 3 + r() * 10, 8 + r() * 40, 0, 0, 7); g.fill(); }   // (faint: from near it must not read as stains)
    const rub = g.createLinearGradient(x0, 0, x0 + w, 0); rub.addColorStop(0, 'rgba(255,255,255,.16)'); rub.addColorStop(.12, 'rgba(255,255,255,0)'); rub.addColorStop(.88, 'rgba(255,255,255,0)'); rub.addColorStop(1, 'rgba(255,255,255,.16)');
    g.fillStyle = rub; g.fillRect(x0, 0, w, H);
  };
  const rect = (x0, y, w, h, c, keep = true) => { g.fillStyle = c; g.fillRect(x0, y, w, h); if (keep) { m.fillStyle = '#000'; m.fillRect(x0, y, w, h); } };
  // lettering down the spine (rotated: read top to bottom), at most len pixels long
  const letter = (x0, yc, text, font, size, color, len, track = 0.06) => {
    g.save(); g.translate(x0 + cw / 2, yc); g.rotate(Math.PI / 2); g.font = `${font.replace('$', Math.round(size))}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    let s = size; while (g.measureText(text).width * (1 + track) > len && s > 10) { s -= 1; g.font = font.replace('$', Math.round(s)); }
    g.letterSpacing = `${(s * track).toFixed(1)}px`; g.fillStyle = color; g.fillText(text, 0, 1); const f = g.font; g.restore();   // (f: restore() puts the font back too)
    m.save(); m.translate(x0 + cw / 2, yc); m.rotate(Math.PI / 2); m.font = f; m.textAlign = 'center'; m.textBaseline = 'middle'; m.letterSpacing = `${(s * track).toFixed(1)}px`; m.fillStyle = '#000'; m.fillText(text, 0, 1); m.restore();
  };
  const INK = '#2a2622', gold = () => pickR(['#d9b66a', '#cfa957', '#e3c27e']), serif = '600 $px Georgia, "Times New Roman", serif', serifI = 'italic 500 $px Georgia, serif', sans = '700 $px "Helvetica Neue", Arial, sans-serif', cond = '600 $px "Avenir Next Condensed", "Arial Narrow", sans-serif';
  for (let i = 0; i < o.n; i++) {
    const x0 = i * cw, style = i % 7, title = pickR(words), name = pickR(names);
    weave(x0, cw);
    // (no label, panel or band under any lettering: it is stamped into the binding itself, in foil or in ink. An ink is
    // drawn dark or pale here only to be told from foil: the material gives it the tone that shows on each book's cloth)
    if (style === 0) {   // gilt on cloth: double rules at head and tail, title and author in gold
      const c = gold(); for (const y of [40, 52, H - 58, H - 46]) rect(x0 + 4, y, cw - 8, 3, c);
      letter(x0, 330, title, serif, 34, c, 520); letter(x0, 760, name, serif, 22, c, 220, 0.18); letter(x0, H - 110, 'PRESS', cond, 14, c, 70, 0.3);
    } else if (style === 1) {   // the title in ink between two fine rules, the author under it, a darker band of cloth at the foot
      rect(x0 + 9, 150, cw - 18, 2, INK); rect(x0 + 9, 478, cw - 18, 2, INK);
      letter(x0, 315, title, serif, 30, INK, 300); letter(x0, 640, name, serifI, 22, INK, 240, 0.08);
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x0, H - 120, cw, 70);
    } else if (style === 2) {   // raised leather bands, the title and the author in gilt between them
      for (let k = 0; k < 5; k++) { const y = 90 + k * 175; g.fillStyle = 'rgba(0,0,0,.32)'; g.fillRect(x0, y, cw, 14); g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x0, y, cw, 4); }
      const c = gold(); letter(x0, 360, title, serif, 26, c, 140); letter(x0, 535, name, serif, 18, c, 120, 0.15);
      for (const y of [120, 300, 418, 830]) rect(x0 + 14, y, cw - 28, 2, c);
    } else if (style === 3) {   // a modern binding: the author at the head, a bold title, the publisher's initial in a ring at the foot
      letter(x0, 105, name, cond, 26, INK, 130, 0.12); rect(x0 + 16, 186, cw - 32, 2, INK);
      letter(x0, 520, title, sans, 34, INK, 560, 0.04);
      for (const c of [g, m]) { c.strokeStyle = c === g ? INK : '#000'; c.lineWidth = 2.5; c.beginPath(); c.ellipse(x0 + cw / 2, H - 78, 13, 33, 0, 0, 7); c.stroke(); }   // (a ring on the book: a tile is 2.6 times as fine along a spine as across it)
      letter(x0, H - 78, name[0], serif, 20, INK, 22, 0);
    } else if (style === 4) {   // two narrow darker bands of cloth at head and tail, the title and the author between them
      g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x0, 34, cw, 30); g.fillRect(x0, H - 64, cw, 30);
      letter(x0, 430, title, serif, 32, INK, 520, 0.08); letter(x0, H - 150, name, cond, 18, INK, 110, 0.2);
    } else if (style === 5) {   // ink on plain cloth, a thin rule round the lettering
      rect(x0 + 10, 200, 2, 520, INK); rect(x0 + cw - 12, 200, 2, 520, INK);
      letter(x0, 460, title, serif, 30, INK, 480); letter(x0, 820, name, serifI, 20, INK, 160, 0.06);
    } else {   // a paperback: title and author run together, a coloured strip and a mark at the foot
      letter(x0, 380, `${title}  ·  ${name}`, sans, 26, INK, 700, 0.03); rect(x0, H - 150, cw, 22, pickR(['#c8452f', '#2f6db0', '#e0a526', '#2e7d59'])); letter(x0, H - 70, 'CLASSICS', cond, 12, INK, 90, 0.25);
    }
  }
  // the plain cloth (tinted), and the page block (as drawn, its rims tinted where the boards meet it)
  const px = o.n * cw; weave(px, cw);
  const tx = o.titled * cw; weave(tx, cw); for (const y of [22, 30, H - 34, H - 26]) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(tx + 3, y, cw - 6, 3); }   // (pressed in, no foil)
  const pg = (o.n + 1) * cw; g.fillStyle = '#e2d6c0'; g.fillRect(pg, 0, 2 * cw, H); m.fillStyle = '#000'; m.fillRect(pg, 0, 2 * cw, H);
  for (let k = 0; k < 360; k++) { g.fillStyle = `rgba(110,90,60,${.04 + r() * .12})`; g.fillRect(pg + 6 + r() * (2 * cw - 12), 0, 1, H); }
  const yel = g.createLinearGradient(pg, 0, pg + 2 * cw, 0); yel.addColorStop(0, 'rgba(170,140,80,.18)'); yel.addColorStop(.5, 'rgba(170,140,80,0)'); yel.addColorStop(1, 'rgba(170,140,80,.18)'); g.fillStyle = yel; g.fillRect(pg, 0, 2 * cw, H);
  g.fillStyle = '#fff'; g.fillRect(pg, 0, 6, H); g.fillRect(pg + 2 * cw - 6, 0, 6, H); m.fillStyle = '#fff'; m.fillRect(pg, 0, 6, H); m.fillRect(pg + 2 * cw - 6, 0, 6, H);
}
// the two pictures as the texture's pixels: the colours, the mask in the alpha, the bottom row first (a DataTexture's)
function spinePixels(g, m, W, H) {
  const a = new Uint32Array(g.getImageData(0, 0, W, H).data.buffer), b = m.getImageData(0, 0, W, H).data, out = new Uint32Array(W * H);
  for (let y = 0; y < H; y++) { const r = y * W, o = (H - 1 - y) * W; for (let x = 0; x < W; x++) out[o + x] = (a[r + x] & 0xffffff) | (b[(r + x) * 4] << 24); }
  return new Uint8Array(out.buffer);
}
function spinesHere(o) {   // (on the page's own thread)
  const w = o.W * o.SX, h = o.H * o.S, g = canvas(w, h).getContext('2d', { willReadFrequently: true }), m = canvas(w, h).getContext('2d', { willReadFrequently: true });
  g.scale(o.SX, o.S); m.scale(o.SX, o.S); drawSpines(g, m, o); return spinePixels(g, m, w, h);
}
/* the atlas, drawn in a worker on an OffscreenCanvas while the room is built (on the page's own thread it held the room
   up ~75 ms): a promise of its texture. Where no worker can draw it, it is drawn here. Until it comes the books wear
   plain cloth (plainCloth; core/build.js puts the atlas on them before the room's first picture). */
function spineAtlas() {
  const o = { W: 2048, H: 1024, S: 0.5, SX: 0.5, n: SPINES, titled: TITLED, words: SPINE_WORDS, names: SPINE_NAMES };   // (S, SX: drawn at half, 1024 x 512: a spine on the shelf is a few pixels wide)
  const texture = d => { const t = new THREE.DataTexture(d, o.W * o.SX, o.H * o.S, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true; return t; };
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.resolve().then(() => texture(spinesHere(o)));
  return new Promise(done => {
    let url = null, w = null, over = false;
    const end = d => { if (over) return; over = true; if (w) w.terminate(); if (url) URL.revokeObjectURL(url); done(texture(d || spinesHere(o))); };
    try {
      url = URL.createObjectURL(new Blob([[rng, drawSpines, spinePixels,
        "onmessage = e => { const o = e.data; let d = null; try { const w = o.W * o.SX, h = o.H * o.S, g = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true }), m = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true }); g.scale(o.SX, o.S); m.scale(o.SX, o.S); drawSpines(g, m, o); d = spinePixels(g, m, w, h); } catch (err) { d = null; } postMessage(d, d ? [d.buffer] : []); };"].join('\n')], { type: 'text/javascript' }));
      w = new Worker(url);
    } catch (e) { end(null); return; }
    w.onmessage = e => end(e.data); w.onerror = e => { e.preventDefault(); end(null); };
    w.postMessage(o);
  });
}
function plainCloth() { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; }
function setSpineAtlas(mesh, t) { const old = BOOK.atlas; BOOK.atlas = mesh.material.map = t; if (old && old !== t) old.dispose(); }
// a hardcover in the unit box (x across its thickness, y up, z from the fore-edge at -1 to the spine at 0; the instance
// scales it to the book's size): two boards, the page block between them set in by the squares of the boards at head,
// tail and fore-edge, and a rounded spine (the shelves' books made realistic, seen near). Its atlas: the
// boards and the spine's caps the plain cloth (tile 28), the page block's three edges the pages (tiles 29-30), the
// spine its own tile (a variant shifted in the shader)
function bookGeometry() {
  const cw = TILE, CU = [28 * cw + .002, 29 * cw - .002], PU = [29 * cw + 8 / 2048, 31 * cw - 8 / 2048], SU = [0.001, cw - .001];
  const b = 0.09, sq = 0.014, fe = 0.02, sp = 0.022, parts = [];
  const rect = (g, face, u, v) => { const uv = g.attributes.uv; for (let k = 0; k < 4; k++) { const i = face * 4 + k; uv.setXY(i, u[0] + (u[1] - u[0]) * uv.getX(i), v[0] + (v[1] - v[0]) * uv.getY(i)); } };
  const box = (x0, x1, y0, y1, z0, z1, uvs) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); for (let f = 0; f < 6; f++) rect(g, f, uvs[f][0], uvs[f][1]); parts.push(g); };
  const C = [CU, [0, 1]], Pg = [PU, [0, 1]];
  box(-0.5, -0.5 + b, 0, 1, -1, -sp, [C, C, C, C, C, C]);                // the back board
  box(0.5 - b, 0.5, 0, 1, -1, -sp, [C, C, C, C, C, C]);                  // the front board
  box(-0.5 + b, 0.5 - b, sq, 1 - sq, -1 + fe, -sp, [Pg, Pg, Pg, Pg, Pg, Pg]);   // the page block, set in
  // the spine: a strip bowed out by sp in the middle, across the whole thickness, and its two caps
  const n = 10, pos = [], nor = [], uv = [], idx = [], zOf = x => -sp + sp * (1 - 4 * x * x);
  for (let i = 0; i <= n; i++) {
    const x = -0.5 + i / n, z = zOf(x), dz = -8 * sp * x, l = Math.hypot(dz, 1);
    for (const y of [0, 1]) { pos.push(x, y, z); nor.push(-dz / l, 0, 1 / l); uv.push(SU[0] + (SU[1] - SU[0]) * i / n, y); }
  }
  for (let i = 0; i < n; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  for (const y of [0, 1]) {   // the caps: the bow closed against the boards' line
    const o = pos.length / 3, up = y ? 1 : -1; pos.push(0, y, -sp); nor.push(0, up, 0); uv.push((CU[0] + CU[1]) / 2, 0.5);
    for (let i = 0; i <= n; i++) { const x = -0.5 + i / n; pos.push(x, y, zOf(x)); nor.push(0, up, 0); uv.push(CU[0] + (CU[1] - CU[0]) * i / n, 0.5); }
    for (let i = 0; i < n; i++) y ? idx.push(o, o + 2 + i, o + 1 + i) : idx.push(o, o + 1 + i, o + 2 + i);
  }
  const sg = new THREE.BufferGeometry(); sg.setIndex(idx);
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  parts.push(sg);
  return mergeGeometries(parts);
}
/* The books' material. The atlas gives a spine its lettering and a cover its tint; what it cannot hold at its size is
   worked out from where a point lies on the book, in metres (the instance's own scale), and fades out as it nears a
   pixel's size on the screen:
   - a binding of one of three kinds (aBk, each book's own number): woven cloth (threads over and under, uneven along
     their length), a paper jacket (smooth, a little gloss), leather (a pebbled grain, a dull shine);
   - the cloth rubbed pale at the spine's head and tail and along its joints, more on some books than on others; the
     groove of the joint on a board, by the spine;
   - the page block: its leaves as fine lines across its thickness, the gatherings they are sewn in as faint bands,
     the paper of some books gone yellow and foxed, the head darker than the fore-edge (dust settles there);
   - the gilt (the atlas's gold, as drawn): metal foil, which shines where the light finds it and is dull elsewhere;
   - the lettering stamped in: whatever is drawn on the cloth (the atlas's alpha) lies a little below it, its edges
     catching the light as a die's impression does; an ink (a drawn colour with no hue) takes the tone that shows on
     this book's cloth, dark on a pale binding, pale on a dark one, and soaks into the weave rather than hiding it.
   The relief is worked out here from the one look-up of the atlas (no bump map: that took three more). */
const BOOK_GLSL = `
  varying vec3 vBk, vBkM, vBkN, vBkS; varying vec2 vBkR;
  float bkh(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float bkn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(bkh(i), bkh(i + vec2(1.0, 0.0)), f.x), mix(bkh(i + vec2(0.0, 1.0)), bkh(i + vec2(1.0, 1.0)), f.x), f.y); }
  vec3 bkBump(vec3 sp, vec3 sn, float hgt) {
    vec3 sx = dFdx(sp), sy = dFdy(sp), r1 = cross(sy, sn), r2 = cross(sn, sx); float det = dot(sx, r1);
    return normalize(abs(det) * sn - sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2));
  }
  // raw: the atlas's colour there; tint: the book's; a: the atlas's alpha (1: cloth); page: 1 on the page block. h: relief (m); rg: rougher by; foil: the gilt
  vec3 bookAt(vec3 raw, vec3 tint, float a, float page, out float h, out float rg, out float foil) {
    vec3 an = abs(vBkN); vec2 cq = an.x > max(an.y, an.z) ? vBkM.zy : (an.y > an.z ? vBkM.xz : vBkM.xy);   // metres on the face
    float fw = max(fwidth(cq.x), fwidth(cq.y)), cloth = a * (1.0 - page), age = vBkR.y * vBkR.y, drawn = (1.0 - a) * (1.0 - page); rg = 0.0;
    float gr = raw.g / max(raw.r, 1e-3), br = raw.b / max(raw.r, 1e-3), lum = dot(raw, vec3(0.3, 0.6, 0.1));
    foil = drawn * step(0.42, raw.r) * smoothstep(0.50, 0.58, gr) * (1.0 - smoothstep(0.76, 0.84, gr)) * smoothstep(0.07, 0.12, br) * (1.0 - smoothstep(0.34, 0.44, br));
    vec3 ground = tint * 0.93, col = mix(raw, raw * tint, a);                // (ground: the cloth the stamp is pressed into)
    float ink = drawn * (1.0 - foil) * (1.0 - smoothstep(0.25, 0.45, (max(raw.r, max(raw.g, raw.b)) - min(raw.r, min(raw.g, raw.b))) / max(raw.r, 1e-3)));   // (drawn with no hue: an ink)
    float pale = step(dot(ground, vec3(0.3, 0.6, 0.1)), 0.15);                               // (a dark binding: its ink is pale)
    col = mix(col, mix(mix(ground * 0.16, vec3(0.045, 0.04, 0.036), 0.5), mix(ground, vec3(0.80, 0.74, 0.62), 0.82), pale), ink * ink);
    h = (1.0 - page) * (a * (lum - 0.9) * 0.0005 - drawn * 0.00016); rg -= 0.10 * ink;                        // (the atlas's bands in relief; the stamp pressed in, and smoother there)
    if (cloth > 0.0) {
      if (vBkR.x < 0.5) {                                        // woven cloth
        float wa = 1.0 - smoothstep(0.22, 0.62, fw * 2200.0); rg += 0.06 * cloth;
        if (wa > 0.0) { vec2 t = cq * 2200.0; float u = abs(fract(t.x) - 0.5) * 2.0, v = abs(fract(t.y) - 0.5) * 2.0, ov = step(0.5, fract((floor(t.x) + floor(t.y)) * 0.5));
          float th = mix((1.0 - u * u) * (0.75 + 0.5 * bkn(vec2(floor(t.x) * 0.61, t.y * 0.045))), (1.0 - v * v) * (0.75 + 0.5 * bkn(vec2(t.x * 0.045, floor(t.y) * 0.61))), ov);
          float wk = wa * (cloth + 0.6 * ink); col *= 1.0 + wk * 0.30 * (th - 0.62); h += wk * th * 0.00010; }   // (the weave shows through an ink)
      } else if (vBkR.x < 0.78) {                                // a paper jacket
        float wa = 1.0 - smoothstep(0.22, 0.62, fw * 1400.0); rg -= 0.20 * cloth;
        if (wa > 0.0) col *= 1.0 + cloth * wa * 0.07 * (bkn(cq * vec2(1400.0, 420.0)) - 0.5);
      } else {                                                   // leather
        float wa = 1.0 - smoothstep(0.22, 0.62, fw * 800.0); rg -= 0.14 * cloth;
        if (wa > 0.0) { float pe = 0.65 * bkn(cq * 800.0) + 0.35 * bkn(cq * 1700.0 + 4.0); col *= 1.0 + cloth * wa * 0.24 * (pe - 0.5); h += cloth * wa * pe * 0.00016; }
      }
      float rag = fw < 0.002 ? 0.004 * (bkn(cq * 260.0) - 0.5) : 0.0, onSpine = step(-0.03, vBk.z) * step(an.y, 0.5);
      float rub = 1.0 - smoothstep(0.0, 0.004 + 0.012 * age, min(vBk.y, 1.0 - vBk.y) * vBkS.y + rag);                 // head and tail
      rub = max(rub, onSpine * (1.0 - smoothstep(0.0, 0.0015 + 0.004 * age, (0.5 - abs(vBk.x)) * vBkS.x + rag)));     // the joints
      col = mix(col, col * 1.16 + 0.045, cloth * rub * (0.25 + 0.75 * age));
      if (an.x > max(an.y, an.z)) { float gz = (-0.022 - vBk.z) * vBkS.z, gv = exp(-pow((gz - 0.007) / 0.0026, 2.0)); col *= 1.0 - 0.2 * gv * cloth; h -= gv * cloth * 0.0005; }   // the joint's groove
    }
    if (page > 0.0) {
      float along = an.y > an.z ? vBkM.z : vBkM.y, fx = fwidth(vBkM.x), pa = 1.0 - smoothstep(0.22, 0.62, fx * 5200.0), ga = 1.0 - smoothstep(0.22, 0.62, fx * 330.0);
      float lf = bkn(vec2(vBkM.x * 5200.0, along * 9.0)), sg = 0.5 + 0.5 * cos(6.2832 * (vBkM.x * 330.0 + 0.7 * bkn(vec2(vBkM.x * 40.0, along * 5.0))));
      col *= (1.0 - pa * 0.24 * (lf - 0.35)) * (1.0 - ga * 0.07 * sg); h += pa * (lf - 0.5) * 0.00012 + ga * (sg - 0.5) * 0.0001;
      col *= mix(vec3(1.0), vec3(0.90, 0.81, 0.64), age * 0.85);                                                       // old paper
      col = mix(col, col * vec3(0.74, 0.58, 0.40), age * 0.6 * smoothstep(0.80, 0.93, bkn(vec2(vBkM.x, along) * 380.0)) * (1.0 - smoothstep(0.2, 0.6, fw * 380.0)));   // foxed
      col *= 1.0 - 0.14 * step(0.5, vBkN.y); rg += 0.1;                                                                // dust on its head
    }
    return col;
  }`;
function bookMaterial(atlas) {
  const m = new THREE.MeshStandardMaterial({ map: atlas, roughness: .78, metalness: 0 });
  const PG = [(29 * TILE + 0.0005).toFixed(5), (31 * TILE - 0.002).toFixed(5)];
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aVar, aBk;\nvarying vec3 vBk, vBkM, vBkN, vBkS; varying vec2 vBkR;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n if (vMapUv.x < ' + TILE + ') vMapUv.x += aVar * ' + TILE + ';\n#endif\n vBk = position; vBkN = normal; vBkR = vec2(aBk, fract(aBk * 7.31 + 0.17));\n'
        + '#ifdef USE_INSTANCING\n vBkS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));\n#else\n vBkS = vec3(1.0);\n#endif\n vBkM = position * vBkS;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      vec4 bk = texture2D( map, vMapUv );
      vec3 tint = vec3(1.0);
      #if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
        tint = vColor.rgb;
      #endif
      float bkH, bkR, bkFoil;
      diffuseColor.rgb *= bookAt( bk.rgb, tint, bk.a, step(${PG[0]}, vMapUv.x) * step(vMapUv.x, ${PG[1]}), bkH, bkR, bkFoil );
      // (seen near: darker where it stands on the board and deep in among its neighbours, its head a little faded by light)
      float ao = mix(0.82, 1.0, smoothstep(0.0, 0.07, vBk.y)) * mix(0.8, 1.0, smoothstep(-0.75, -0.04, vBk.z));   // (lightly: the room's baked light keeps most of it already, core/bake.js)
      diffuseColor.rgb = mix(diffuseColor.rgb * ao, mix(diffuseColor.rgb, vec3(0.92, 0.89, 0.82), 0.12 * bk.a) * ao, smoothstep(0.82, 1.0, vBk.y));`).replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(mix(roughnessFactor + bkR, 0.36, bkFoil), 0.08, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 0.7, bkFoil);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = bkBump(-vViewPosition, normal, bkH);')
      .replace('#include <common>', '#include <common>' + BOOK_GLSL);
  };
  return m;
}
const PAL = {
  // (its whites all #E2D6C0, the page's paper colour)
  modern: ['#e2d6c0', '#e2d6c0', '#e2d6c0', '#e2d6c0', '#e2d6c0', '#4f8a8b', '#3c7377', '#2c3e5a', '#3b5578', '#7c90a4', '#b8bcbf', '#9aa4a8', '#2b2b2b', '#c49b4c', '#a6593d', '#8ba08a', '#e2d6c0', '#5f7c91', '#e2d6c0', '#6d8f8f'],
  old: ['#6b4a32', '#7c5a3c', '#4e3526', '#2e3b55', '#6e2f2f', '#3f5340', '#b8a487', '#6f6f6a', '#a8322d', '#8b6b48', '#3a2e28', '#556a7a', '#9b8a6a', '#c9b48e', '#5b4636', '#2f4a4a', '#7a3b2b', '#cfc2a2'],
};
/* fill one shelf cell; o = left-bottom-front corner, along = unit axis to the right, out = spine normal (into the room) */
function fillCell(o, along, out, len, hgt, dep, pal, opt = {}) {
  const up = new THREE.Vector3(0, 1, 0); const B = new THREE.Matrix4().makeBasis(along, up, out).setPosition(o);
  if (opt.cell) { opt.cell.B = B; opt.cell.len = len; }   // for refitCell
  const maxH = Math.min(hgt - 0.02, 0.34); const gapChance = opt.gaps ?? 0.05, stackChance = opt.stack ?? 0.05;
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  const push = (M, col, v, up = false) => BOOK.list.push({ m: B.clone().multiply(M), c: new THREE.Color(col).offsetHSL(0, rr(-.04, .04), rr(-.05, .04)), v, up, cell: opt.cell || null });
  let x = rr(0, 0.02), lastUp = null;
  while (x < len - 0.02) {
    const roll = rand();
    if (roll < stackChance && len - x > 0.3) {                       // horizontal stack, spines to the room
      const n = 2 + Math.floor(rand() * 4), w = rr(0.19, 0.26), d0 = Math.min(dep - 0.02, rr(0.15, 0.21)); let y = 0;
      for (let k = 0; k < n && y < hgt - 0.07; k++) {
        const t = rr(0.022, 0.05), h = w + rr(-.02, .02), d = d0 + rr(-.015, .01), yaw = rr(-.07, .07);
        const cx = x + w / 2, cy = y + t / 2, cz = -d / 2 - 0.004;
        const M = T(cx, cy, cz).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(T(h / 2, 0, d / 2)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(t, h, d));
        push(M, pick(pal), Math.floor(rand() * SPINES)); y += t;
      }
      x += w + rr(0.01, 0.03); lastUp = null; continue;
    }
    if (roll < stackChance + gapChance) { x += rr(0.04, 0.12); lastUp = null; continue; }
    const t = rr(0.017, 0.05) * (rand() < .12 ? 1.5 : 1), h = Math.min(maxH, rr(0.2, 0.34)), d = Math.min(dep - 0.015, rr(0.13, 0.17) + h * 0.25);
    const b = { x: x + t / 2, t, h, d, inset: rr(0, 0.025), col: pick(pal), v: Math.floor(rand() * SPINES), lean: 0 };
    lastUp = b; b.idx = BOOK.list.length; push(T(b.x, 0, -b.inset).multiply(new THREE.Matrix4().makeScale(t, h, d)), b.col, b.v, true);
    x += t + (rand() < .25 ? rr(0.001, 0.006) : 0.0008);
  }
  // the last upright book leans on its left neighbour when there is space after it
  if (lastUp) {
    const xn = lastUp.x - lastUp.t / 2, avail = len - xn - 0.004;
    if (avail - lastUp.t > 0.03) {
      const phi = Math.min(0.38, Math.asin(Math.min(1, (avail - lastUp.t) / lastUp.h))) * rr(0.55, 1);
      const px = xn + lastUp.t * Math.cos(phi) + lastUp.h * Math.sin(phi);
      const M = T(px, 0, -lastUp.inset).multiply(new THREE.Matrix4().makeRotationZ(phi)).multiply(T(-lastUp.t / 2, 0, 0)).multiply(new THREE.Matrix4().makeScale(lastUp.t, lastUp.h, lastUp.d));
      BOOK.list[lastUp.idx].m = B.clone().multiply(M); BOOK.list[lastUp.idx].lean = true;
    }
  }
}
/* a cell packed again after some of its books changed size (a book of the page takes the thickness of its pages): the
   books keep their order and the gaps between them; what no longer fits at the right end is put away (only books that
   play nothing). sizes: Map of BOOK.list index -> { t, h }; keep: indices never put away. Returns the indices it moved. */
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
function refitCell(cell, sizes, keep = new Set()) {
  const inv = cell.B.clone().invert(), L = new THREE.Matrix4(), v = new THREE.Vector3(), ents = [];
  BOOK.list.forEach((b, idx) => {
    if (b.cell !== cell || b.hidden) return;
    L.multiplyMatrices(inv, b.m); let x0 = Infinity, x1 = -Infinity;
    for (let k = 0; k < 8; k++) { const x = v.set(k & 1 ? 0.5 : -0.5, k & 2 ? 1 : 0, k & 4 ? -1 : 0).applyMatrix4(L).x; x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    ents.push({ idx, b, x0, x1 });
  });
  ents.sort((a, b) => a.x0 - b.x0);
  const slots = [];   // runs of books side by side; a stack lying flat is one run
  for (const e of ents) { const s = slots[slots.length - 1]; if (s && e.x0 < s.x1 - 1e-4) { s.ents.push(e); s.x1 = Math.max(s.x1, e.x1); } else slots.push({ ents: [e], x0: e.x0, x1: e.x1 }); }
  slots.forEach((s, k) => { s.gap = k ? Math.max(0, s.x0 - slots[k - 1].x1) : 0; const e = s.ents.find(e => sizes.has(e.idx)); s.item = e || null; s.keep = s.ents.some(e => keep.has(e.idx) || sizes.has(e.idx));
    s.grow = e ? sizes.get(e.idx).t - (e.x1 - e.x0) : 0; s.w = s.x1 - s.x0 + s.grow; });
  const lay = () => { let x = slots.length ? slots[0].x0 : 0; for (const s of slots) { if (s.out) continue; s.nx0 = x + (s === slots[0] ? 0 : s.gap); x = s.nx0 + s.w; } return x; };
  while (lay() > cell.len - 0.002) { const s = [...slots].reverse().find(s => !s.out && !s.keep); if (!s) break; s.out = true; }
  const along = new THREE.Vector3().setFromMatrixColumn(cell.B, 0), moved = [];
  for (const s of slots) for (const e of s.ents) {
    if (s.out) { e.b.m.copy(ZERO_M); e.b.hidden = true; moved.push(e.idx); continue; }
    if (s.item === e) {   // an upright book: its frame in the cell is a translation and a scale
      const sz = sizes.get(e.idx); L.multiplyMatrices(inv, e.b.m); const z = L.elements[14], d = v.setFromMatrixColumn(L, 2).length();
      e.b.m.multiplyMatrices(cell.B, new THREE.Matrix4().makeTranslation(s.nx0 + (e.x0 - s.x0) + sz.t / 2, 0, z).multiply(new THREE.Matrix4().makeScale(sz.t, sz.h, sz.d || d)));   // (sz.d: a depth of its own, its spine where it was)
    } else {   // a book leaning on the resized one moves with its right side
      const dx = s.nx0 - s.x0 + (s.item && e.x0 > s.item.x0 ? s.grow : 0);
      e.b.m.premultiply(new THREE.Matrix4().makeTranslation(along.x * dx, along.y * dx, along.z * dx));
    }
    moved.push(e.idx);
  }
  return moved;
}
/* a row of upright books from a cell's left end, len metres of it, the last leaning left on the one before it (as a row's
   last book does in fillCell): the 747's cell (a few books at its left to fill the gap). Its own
   random draws, so the room's shared sequence, and every other cell, stay as they were. */
function rowOfBooks(cell, len, seed) {
  const r = rng(seed), between = (a, b) => a + (b - a) * r(), T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z), S = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
  let x = between(0.002, 0.01), last = null;
  for (;;) {
    const t = between(0.019, 0.046) * (r() < 0.12 ? 1.4 : 1), h = between(0.21, 0.3), d = Math.min(0.3, between(0.13, 0.17) + h * 0.25), inset = between(0, 0.02);
    if (x + t > len) break;
    const c = new THREE.Color(PAL.old[Math.floor(r() * PAL.old.length)]).offsetHSL(0, (r() - 0.5) * 0.08, (r() - 0.5) * 0.09);
    last = { idx: BOOK.list.length, x, t, h, d, inset };
    BOOK.list.push({ m: cell.B.clone().multiply(T(x + t / 2, 0, -inset)).multiply(S(t, h, d)), c, v: Math.floor(r() * SPINES), up: true, cell });
    x += t + (r() < 0.25 ? between(0.001, 0.005) : 0.0008);
  }
  if (last) {
    const { idx, t, h, d, inset } = last, phi = 0.22;
    BOOK.list[idx].m = cell.B.clone().multiply(T(last.x + t * Math.cos(phi) + h * Math.sin(phi), 0, -inset)).multiply(new THREE.Matrix4().makeRotationZ(phi)).multiply(T(-t / 2, 0, 0)).multiply(S(t, h, d));
    BOOK.list[idx].lean = true;
  }
}
function buildBookInstances() {
  const geo = bookGeometry(); const n = BOOK.list.length;
  const mesh = new THREE.InstancedMesh(geo, bookMaterial(BOOK.atlas || (BOOK.atlas = plainCloth())), n);
  const va = new Float32Array(n), vb = new Float32Array(n);
  BOOK.list.forEach((b, i) => { mesh.setMatrixAt(i, b.m); mesh.setColorAt(i, b.c); va[i] = b.v; vb[i] = (i * 0.6180339887 + 0.137) % 1; });   // (vb: each book's own number, for its binding and its age)
  geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(va, 1)); geo.setAttribute('aBk', new THREE.InstancedBufferAttribute(vb, 1));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; room.add(mesh); return mesh;
}

/* a book of the page keeps no made-up lettering under its own title */
function titledSpine(mesh, idx) { BOOK.list[idx].v = TITLED; const a = mesh.geometry.getAttribute('aVar'); a.setX(idx, TITLED); a.needsUpdate = true; }

export { BOOK, PAL, buildBookInstances, fillCell, refitCell, rowOfBooks, setSpineAtlas, spineAtlas, titledSpine };
