// node paint.cjs [out dir] [fit]: the room's painted woods (world/textures.js) run as their workers run them, with the
// options of pics.json. Prints each picture's mean colour (sRGB bytes, then linear) beside the mean it is to keep, and
// writes <name>.png (its colours) and <name>-a.png (its alpha: the joints). With "fit": finds the light and sat that
// give each picture its mean, to copy into PICS (world/materials.js). SHARP: the sharp module's path, for the PNGs.
const fs = require('fs'), path = require('path');
const [OUT, FIT] = process.argv.slice(2), SRC = path.join(__dirname, '../../lib3d');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return s.slice(i, j); };
const mod = {}; new Function('mod', cut(fs.readFileSync(path.join(SRC, 'core/utils.js'), 'utf8'), 'function rng', 'function canvas') + '\n'
  + cut(fs.readFileSync(path.join(SRC, 'world/textures.js'), 'utf8'), 'function hue2rgb', 'function painterSource') + '\nmod.PAINTERS = PAINTERS;')(mod);
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const paint = (kind, o) => mod.PAINTERS[kind](new Uint8ClampedArray(o.w * o.h * 4), { ...o, y0: 0, y1: o.h });
const mean = d => { const L = [0, 0, 0], B = [0, 0, 0], n = d.length / 4; for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { B[c] += d[i * 4 + c]; L[c] += lin(d[i * 4 + c]); } return [B.map(v => v / n), L.map(v => v / n)]; };
(async () => {
  for (const [k, kind, o, keep] of JSON.parse(fs.readFileSync(path.join(__dirname, 'pics.json'), 'utf8'))) {
    if (FIT) for (let it = 0; it < 6; it++) { const M = mean(paint(kind, o))[1]; o.light *= Math.pow(keep[1] / M[1], 1 / 2.4); o.sat *= Math.pow((keep[0] / keep[2]) / (M[0] / M[2]), 0.35); }
    const t0 = Date.now(), d = paint(kind, o), [B, L] = mean(d);
    console.log(k, o.w + 'x' + o.h, FIT ? `light ${o.light.toFixed(4)} sat ${o.sat.toFixed(4)}` : '', '| bytes', B.map(v => v.toFixed(1)).join(' '), '| linear', L.map(v => v.toFixed(4)).join(' '), '| to keep', keep.join(' '), '|', Date.now() - t0, 'ms');
    if (!OUT) continue;
    const sharp = require(process.env.SHARP || 'sharp'), n = o.w * o.h, rgb = Buffer.alloc(n * 3), al = Buffer.alloc(n);
    for (let i = 0; i < n; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; al[i] = d[i * 4 + 3]; }
    await sharp(rgb, { raw: { width: o.w, height: o.h, channels: 3 } }).png().toFile(path.join(OUT, k + '.png'));
    await sharp(al, { raw: { width: o.w, height: o.h, channels: 1 } }).png().toFile(path.join(OUT, k + '-a.png'));
  }
})();
