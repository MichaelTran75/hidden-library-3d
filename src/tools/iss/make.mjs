// iss.glb from "ISS" by uperesito (Sketchfab, CC BY 4.0): the whole station as one mesh with one material, so it is
// drawn in one call. Its 36 small textures (and the colours of its untextured materials) packed into one atlas; each
// vertex carries where its texture is in the atlas (_CELL: x, y, w, h) and its texture coordinates' own range (_UVT:
// u0, v0, du, dv; TEXCOORD_0 is the coordinate within that range, 0..1), so the page repeats each texture as the
// model did (fract) inside its cell (lib3d/world/iss.js). Positions in the model's own frame (y up, as the file),
// metres not applied; quantized and meshopt-compressed, the atlas as WebP.
//   node make.mjs <source.glb> <out.glb> [atlas.png]
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { quantize, meshopt, reorder, prune, dedup, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
const [,, src, out, atlasOut] = process.argv.filter(a => !a.startsWith('--')), FLAT = process.argv.includes('--flat');   // --flat: no normals (the page shades it flat)
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const sdoc = await io.read(src), sroot = sdoc.getRoot();

// ---- the atlas: each texture with a border of its own opposite edges (it repeats), the plain colours as small patches
const PAD = 8, AW = 1024;   // (the page clamps its mip level to the border: lib3d/world/iss.js ISS_PAD)
const cells = new Map();   // texture or colour key -> { w, h, rgba (Buffer), x, y }
const lin2srgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
async function cellOf(mat) {
  const tex = mat.getBaseColorTexture(), f = mat.getBaseColorFactor();
  const key = tex ? tex : 'c' + f.map(v => v.toFixed(3)).join(',');
  if (cells.has(key)) return cells.get(key);
  let w, h, px;
  if (tex) {
    const im = sharp(Buffer.from(tex.getImage())).ensureAlpha(); const { data, info } = await im.raw().toBuffer({ resolveWithObject: true });
    w = info.width; h = info.height; px = Buffer.from(data);
    if (f.some(v => v !== 1)) for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.round(px[i * 4 + c] * lin2srgb(f[c]));
  } else {
    w = h = 4; px = Buffer.alloc(w * h * 4); const s = f.slice(0, 3).map(v => Math.round(lin2srgb(v) * 255));
    for (let i = 0; i < w * h; i++) { px[i * 4] = s[0]; px[i * 4 + 1] = s[1]; px[i * 4 + 2] = s[2]; px[i * 4 + 3] = 255; }
  }
  const c = { w, h, px, x: 0, y: 0 }; cells.set(key, c); return c;
}
// gather the primitives (their vertices in the file's world frame) and their cells
const prims = [];
const world = new Map();
for (const scene of sroot.listScenes()) scene.traverse(node => { world.set(node, node.getWorldMatrix()); });
for (const node of sroot.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue; const M = world.get(node);
  for (const p of mesh.listPrimitives()) prims.push({ p, M, cell: await cellOf(p.getMaterial()) });
}
// shelf packing, tallest first
const list = [...cells.values()].sort((a, b) => (b.h + 2 * PAD) - (a.h + 2 * PAD) || b.w - a.w);
let x = 0, y = 0, rowH = 0;
for (const c of list) { const W = c.w + 2 * PAD, H = c.h + 2 * PAD; if (x + W > AW) { x = 0; y += rowH; rowH = 0; } c.x = x + PAD; c.y = y + PAD; x += W; rowH = Math.max(rowH, H); }
const AH = 1 << Math.ceil(Math.log2(y + rowH));
const atlas = Buffer.alloc(AW * AH * 4);
for (const c of list) for (let j = -PAD; j < c.h + PAD; j++) for (let i = -PAD; i < c.w + PAD; i++) {
  const si = ((i % c.w) + c.w) % c.w, sj = ((j % c.h) + c.h) % c.h, s = (sj * c.w + si) * 4, d = ((c.y + j) * AW + (c.x + i)) * 4;
  atlas[d] = c.px[s]; atlas[d + 1] = c.px[s + 1]; atlas[d + 2] = c.px[s + 2]; atlas[d + 3] = 255;
}
console.log('atlas', AW, 'x', AH, 'cells', list.length);
if (atlasOut) await sharp(atlas, { raw: { width: AW, height: AH, channels: 4 } }).png().toFile(atlasOut);

// ---- one mesh: positions and normals in the file's frame, texture coordinates per primitive's range
const P = [], N = [], UV = [], CELL = [], UVT = [], I = []; let base = 0;
const tmp = [0, 0, 0];
for (const { p, M, cell } of prims) {
  const pos = p.getAttribute('POSITION'), nrm = p.getAttribute('NORMAL'), uv = p.getAttribute('TEXCOORD_0'), ix = p.getIndices(), n = pos.getCount();
  const tex = !!p.getMaterial().getBaseColorTexture();
  let u0 = 0, v0 = 0, du = 1, dv = 1;
  if (uv && tex) { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (let i = 0; i < n; i++) { uv.getElement(i, tmp); a = Math.min(a, tmp[0]); b = Math.max(b, tmp[0]); c = Math.min(c, tmp[1]); d = Math.max(d, tmp[1]); } u0 = a; v0 = c; du = Math.max(b - a, 1e-6); dv = Math.max(d - c, 1e-6); }
  // the normal matrix: the inverse transpose of the upper 3x3
  const m = M, a00 = m[0], a01 = m[1], a02 = m[2], a10 = m[4], a11 = m[5], a12 = m[6], a20 = m[8], a21 = m[9], a22 = m[10];
  const b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20, det = a00 * b01 + a01 * b11 + a02 * b21;
  const inv = [b01, -a22 * a01 + a02 * a21, a12 * a01 - a02 * a11, b11, a22 * a00 - a02 * a20, -a12 * a00 + a02 * a10, b21, -a21 * a00 + a01 * a20, a11 * a00 - a01 * a10].map(v => v / det);
  const cx = cell.x / AW, cy = cell.y / AH, cw = cell.w / AW, ch = cell.h / AH;
  for (let i = 0; i < n; i++) {
    pos.getElement(i, tmp); const X = tmp[0], Y = tmp[1], Z = tmp[2];
    P.push(m[0] * X + m[4] * Y + m[8] * Z + m[12], m[1] * X + m[5] * Y + m[9] * Z + m[13], m[2] * X + m[6] * Y + m[10] * Z + m[14]);
    if (nrm) { nrm.getElement(i, tmp); const nx = inv[0] * tmp[0] + inv[1] * tmp[1] + inv[2] * tmp[2], ny = inv[3] * tmp[0] + inv[4] * tmp[1] + inv[5] * tmp[2], nz = inv[6] * tmp[0] + inv[7] * tmp[1] + inv[8] * tmp[2], l = Math.hypot(nx, ny, nz) || 1; N.push(nx / l, ny / l, nz / l); } else N.push(0, 1, 0);
    if (uv && tex) { uv.getElement(i, tmp); UV.push((tmp[0] - u0) / du, (tmp[1] - v0) / dv); } else UV.push(0.5, 0.5);
    CELL.push(cx, cy, cw, ch); UVT.push(tex ? u0 : 0, tex ? v0 : 0, tex ? du : 0, tex ? dv : 0);
  }
  if (ix) { const a = ix.getArray(); for (let i = 0; i < a.length; i++) I.push(a[i] + base); } else for (let i = 0; i < n; i++) I.push(i + base);
  base += n;
}
console.log('vertices', base, 'triangles', I.length / 3);
const doc = new Document(), buf = doc.createBuffer();
const webp = await sharp(atlas, { raw: { width: AW, height: AH, channels: 4 } }).removeAlpha().webp({ quality: 92 }).toBuffer();
const tex = doc.createTexture('iss').setImage(new Uint8Array(webp)).setMimeType('image/webp');
const mat = doc.createMaterial('iss').setBaseColorTexture(tex).setDoubleSided(true).setMetallicFactor(0.1).setRoughnessFactor(0.55);
const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
const prim = doc.createPrimitive().setMaterial(mat)
  .setAttribute('POSITION', acc('VEC3', new Float32Array(P))).setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(UV)))
  .setAttribute('_CELL', acc('VEC4', new Float32Array(CELL))).setAttribute('_UVT', acc('VEC4', new Float32Array(UVT)))
  .setIndices(acc('SCALAR', base > 65535 ? new Uint32Array(I) : new Uint16Array(I)));
if (!FLAT) prim.setAttribute('NORMAL', acc('VEC3', new Float32Array(N)));
const mesh = doc.createMesh('iss').addPrimitive(prim), node = doc.createNode('iss').setMesh(mesh);
doc.createScene('iss').addChild(node);
doc.getRoot().getAsset().extras = { title: 'ISS', author: 'uperesito (https://sketchfab.com/uperesito)', license: 'CC-BY-4.0', source: 'https://sketchfab.com/3d-models/iss-813f5b296e584c26bf386ca39de6c3d4', modified: 'one mesh, atlas, quantized' };
await doc.transform(weld({ tolerance: 0.00001 }), prune(), dedup(), reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
doc.createExtension(EXTTextureWebP).setRequired(true);
await io.write(out, doc);
const pr = doc.getRoot().listMeshes()[0].listPrimitives()[0];
console.log('wrote', out, 'vertices', pr.getAttribute('POSITION').getCount(), 'triangles', pr.getIndices().getCount() / 3, 'webp', webp.length);
