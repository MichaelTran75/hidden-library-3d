// clock.glb from "Ardavin's Medieval Clock. Model Completorium" (Miguel Garcia, CC BY 4.0): its moving parts as meshes
// of their own, in the clock's own frame (y up, its arbors along x, its dial facing −x); quantized and
// meshopt-compressed, its picture as WebP.
//   node make.mjs <source.glb> <groups.bin> <out.glb> [static simplify ratio] [ring.png]
// groups.bin: one byte a triangle (the source's mesh 0 first, then mesh 1), made by segment.py then segment3.py: the
// index of the part in GROUPS below. The pivots are measured by mech.py.
// Each part is a node at its pivot (a point on the axis it turns about) holding a node with its mesh: quantizing moves a
// mesh's own node to the middle of its box, so the pivot must be the node above it.
// The dial ring's face (the numerals) has a material and a picture of its own (ring.py: large and sharp; in the model's
// picture it is 147 px across), laid on by the face's own place: 6.4 units from the ring's middle to the picture's edge.
import { readFileSync } from 'fs';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { quantize, meshopt, reorder, prune, dedup, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [,, src, groupsPath, out, ratioArg, ringPath] = process.argv;
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const sdoc = await io.read(src);
// the clock's frame: the file's plates stand turned 8.6° about its z (up); turned back, then z up made y up
const TH = 8.6 * Math.PI / 180, C = Math.cos(TH), S = Math.sin(TH);
const frame = (x, y, z) => { const X = x * C + y * S, Y = -x * S + y * C; return [X, z, -Y]; };
// the parts: [name, pivot] (the pivot in that frame, y up; for a wheel the middle of its teeth, measured on the model)
const GROUPS = [['static', [0, 0, 0]],
  ['dial', [-3.25, 11.594, -0.341]],    // the hour wheel (56) and the pipe it sits on
  ['great', [0.69, 8.347, -0.414]],     // the great wheel (56), its arbor, the pinion (7) that drives the hour wheel
  ['second', [0.30, 11.526, -0.420]],   // the second wheel (56) and its pinion (7): the wheel sits 0.09 off its arbor in the model, the pivot is the wheel's
  ['crown', [-0.48, 14.707, -0.394]],   // the crown wheel (25) and its pinion (7)
  ['verge', [-1.582, 14.7, -0.378]],    // the verge with its two pallets, the foliot, its weights and three arms (its axis leans 1.1°: clock.js)
  ['hammer', [1.07, 29.40, 0.27]],      // the hammer: head, arm and tail, on its pin above the bell
  ['hand', [-5.05, 11.594, -0.341]],     // the hand, its nut and washer
  ['star', [-3.9, 11.594, -0.341]],      // the 12-tooth star that trips the hammer
  ['lever', [-4.1, 8.398, -1.236]],     // the trip lever, on its pin left of the star
  ['wire', [-3.010, 11.727, 7.841]],    // the wire from the lever's end (its lower hook: the pivot) to the hammer's tail
  ['bell', [0.22, 24.4, -0.198]],
  ['ring', [0, 11.594, -0.335]],        // the dial ring's face; the pivot: the ring's middle
  ['ringbody', [0, 11.594, -0.335]]];   // its back and rims, kept whole: thinned with the frame, their triangles come through the face
const RING_HALF = 6.4;
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
let ringMat = mat;
if (ringPath) {
  const rw = await sharp(readFileSync(ringPath)).webp({ quality: 90, smartSubsample: true }).toBuffer(); console.log('ring picture', rw.length, 'bytes');
  ringMat = doc.createMaterial('ring').setBaseColorTexture(doc.createTexture('ring').setImage(new Uint8Array(rw)).setMimeType('image/webp')).setDoubleSided(true).setMetallicFactor(0.2).setRoughnessFactor(0.6);
}
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
        P2.push(q[0] - pv[0], q[1] - pv[1], q[2] - pv[2]); N2.push(...m);
        if (name === 'ring' && ringPath) U2.push(0.5 + (q[2] - pv[2]) / (2 * RING_HALF), 0.5 - (q[1] - pv[1]) / (2 * RING_HALF));   // (the viewer's right across, up: XII at the picture's top)
        else U2.push(uvs[v * 2], uvs[v * 2 + 1]);
      }
      I2.push(w);
    }
  }
  const prim = doc.createPrimitive().setMaterial(name === 'ring' ? ringMat : mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P2)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(N2)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(U2)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(map.size > 65535 ? new Uint32Array(I2) : new Uint16Array(I2)).setBuffer(buf));
  const mesh = doc.createMesh(name).addPrimitive(prim), node = doc.createNode(name).setTranslation(pv);
  node.addChild(doc.createNode(name + '-mesh').setMesh(mesh)); root.addChild(node);
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
