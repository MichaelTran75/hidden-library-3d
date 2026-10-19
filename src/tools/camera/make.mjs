// camera.glb from "Vintage Camera ~ Asahi Pentax H2" by Robin Vandenberghe (Sketchfab, CC BY 4.0): the camera in its
// leather case with its strap, as the model has them; its maps at most `size` px, as WebP; the lens glass a plain
// see-through surface (no transmission, which would cost the page a second picture of the room); welded, quantized and
// meshopt-compressed. Positions as the file has them: the page measures it and sets its size (lib3d/world/camera.js).
//   node make.mjs <source.glb> <out.glb> [size = 1024]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
const [,, src, out, size = '1024'] = process.argv;
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src), root = doc.getRoot();
for (const m of root.listMaterials()) if (m.getExtension('KHR_materials_transmission')) m.setExtension('KHR_materials_transmission', null);
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_materials_transmission') e.dispose();
for (const t of root.listTextures()) { const s = t.getSize(); console.log('texture', t.getName() || '-', s && s.join('x'), t.getMimeType(), Math.round(t.getImage().byteLength / 1024) + ' KB'); }
await doc.transform(dedup(), prune(), weld(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+size, +size], quality: 88 }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
for (const t of root.listTextures()) { const s = t.getSize(); console.log('  ->', s && s.join('x'), Math.round(t.getImage().byteLength / 1024) + ' KB'); }
await io.write(out, doc);
