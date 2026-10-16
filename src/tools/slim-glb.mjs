// lib.glb -> lib.slim.glb: drop the meshes the page never uses and re-pack as before (meshopt, quantized, webp kept).
//   node slim-glb.mjs backup/lib.v3-before-slim.glb lib.glb            (needs @gltf-transform 4.2 + meshoptimizer, as optimize.mjs)
// The garden's trees (treeA_, treeB_, treeC_ nodes) are built in code now (makeTrees in lib3d/world/trees.js), so they go too,
// with their materials and textures.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, quantize, dequantize, meshopt, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
const [,, inp, outp] = process.argv;
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inp);
const root = doc.getRoot();
const UNUSED = new Set(['iso_bookTas1', 'iso_bookPile3', 'iso_bookPile4', 'iso_bookOpen2', 'mags', 'book_magaz1', 'book_book003', 'book_book004']);
const drop = name => UNUSED.has(name) || /^tree[ABC]_/.test(name);
for (const node of root.listNodes()) if (drop(node.getName())) { console.log('drop', node.getName()); node.dispose(); }
await doc.transform(dequantize());
await doc.transform(prune(), dedup(), reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
doc.createExtension(EXTTextureWebP).setRequired(true);
await io.write(outp, doc);
