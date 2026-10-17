// clock.glb from "Ardavin's Medieval Clock. Model Completorium" (Miguel Garcia, CC BY 4.0): its moving parts as meshes
// of their own, each with its origin on its axis, in the clock's own frame (y up, its arbors along x, its dial facing −x);
// quantized and meshopt-compressed, its picture as WebP.
//   node make.mjs <source.glb> <groups.bin> <out.glb> [static simplify ratio]
// groups.bin: one byte a triangle (the source's mesh 0 first, then mesh 1), made by segment.py:
//   0 static, 1 the dial (hand, star, hour wheel), 2 the great wheel's arbor, 3 the second, 4 the crown wheel's, 5 the verge and foliot, 6 the hammer
import { readFileSync } from 'fs';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { quantize, meshopt, reorder, prune, dedup, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [,, src, groupsPath, out, ratioArg] = process.argv;
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const sdoc = await io.read(src);
// the clock's frame: the file's plates stand turned 8.6° about its z (up); turned back, then z up made y up
const TH = 8.6 * Math.PI / 180, C = Math.cos(TH), S = Math.sin(TH);
const frame = (x, y, z) => { const X = x * C + y * S, Y = -x * S + y * C; return [X, z, -Y]; };
// the axes (in that frame, then y up): [name, pivot]
const GROUPS = [['static', [0, 0, 0]], ['dial', [0, 11.59, -0.35]], ['great', [0, 8.343, -0.419]], ['second', [0, 11.575, -0.345]], ['crown', [0, 14.708, -0.398]],
  ['verge', [-1.59, 0, -0.40]], ['hammer', [0, 28.68, -0.30]]];
const P = [], N = [], UV = [], T = [];
let base = 0;
for (const mesh of sdoc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const p = prim.getAttribute('POSITION').getArray(), n = prim.getAttribute('NORMAL').getArray(), uv = prim.getAttribute('TEXCOORD_0').getArray(), ix = prim.getIndices().getArray();
  P.push(p); N.push(n); UV.push(uv); T.push([ix, base]); base += p.length / 3;
}
const pos = new Float32Array(base * 3), nrm = new Float32Array(base * 3), uvs = new Float32Array(base * 2); let o = 0;
P.forEach((p, k) => { pos.set(p, o * 3); nrm.set(N[k], o * 3); uvs.set(UV[k], o * 2); o += p.length / 3; });
const tris = []; for (const [ix, b] of T) for (let i = 0; i < ix.length; i++) tris.push(ix[i] + b);
const groups = readFileSync(groupsPath);
if (groups.length !== tris.length / 3) throw new Error('groups.bin has ' + groups.length + ' entries for ' + tris.length / 3 + ' triangles');
// the new document: one material (the source's picture, as WebP), a mesh and a node for each group
const doc = new Document(), buf = doc.createBuffer();
const img = sdoc.getRoot().listTextures()[0];
const webp = await sharp(Buffer.from(img.getImage())).resize(1024, 1024, { fit: 'inside' }).webp({ quality: 84 }).toBuffer();
const tex = doc.createTexture('clock').setImage(new Uint8Array(webp)).setMimeType('image/webp');
const mat = doc.createMaterial('clock').setBaseColorTexture(tex).setDoubleSided(true).setMetallicFactor(0.2).setRoughnessFactor(0.6);
const scene = doc.createScene('clock'), root = doc.createNode('clock'); scene.addChild(root);
for (let g = 0; g < GROUPS.length; g++) {
  const [name, pv] = GROUPS[g], map = new Map(), P2 = [], N2 = [], U2 = [], I2 = [];
  for (let t = 0; t < groups.length; t++) {
    if (groups[t] !== g) continue;
    for (let k = 0; k < 3; k++) {
      const v = tris[t * 3 + k]; let w = map.get(v);
      if (w === undefined) {
        w = map.size; map.set(v, w);
        const q = frame(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]), m = frame(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
        P2.push(q[0] - pv[0], q[1] - pv[1], q[2] - pv[2]); N2.push(...m); U2.push(uvs[v * 2], uvs[v * 2 + 1]);
      }
      I2.push(w);
    }
  }
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P2)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(N2)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(U2)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(map.size > 65535 ? new Uint32Array(I2) : new Uint16Array(I2)).setBuffer(buf));
  const mesh = doc.createMesh(name).addPrimitive(prim), node = doc.createNode(name).setMesh(mesh).setTranslation(pv);
  root.addChild(node);
  console.log(name, 'triangles', I2.length / 3, 'vertices', map.size);
}
const ratio = ratioArg ? +ratioArg : 1;
if (ratio < 1) {   // only the static part is simplified (the moving parts keep every tooth)
  const st = doc.getRoot().listMeshes().find(m => m.getName() === 'static');
  const keep = doc.getRoot().listMeshes().filter(m => m !== st);
  await doc.transform(weld({ tolerance: 0.0001 }));
  const { simplifyPrimitive } = await import('@gltf-transform/functions');
  for (const prim of st.listPrimitives()) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: 0.002 });
  console.log('static simplified to ratio', ratio, '->', st.listPrimitives()[0].getIndices().getCount() / 3, 'triangles');
}
await doc.transform(prune(), dedup(), reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
doc.createExtension(EXTTextureWebP).setRequired(true);
await io.write(out, doc);
console.log('wrote', out);
