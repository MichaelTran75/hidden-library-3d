// cat_rigged.glb (rig_cat.py: "cat" by artofaria with a skeleton and skin weights) + chicken.glb (Sketchfab downloads)
// -> OUTDIR/cat.bin and OUTDIR/hen.glb. Textures go to WebP at a size the room needs (PIL does the resizing), geometry to
// meshopt.
//   NODE_PATH=<dir with @gltf-transform 4.2 + meshoptimizer> node pack.mjs cat_rigged.glb chicken.glb ../..
// The cat is under Sketchfab's Free Standard licence, which allows its use in a work like this page but not making the
// model available as a file of its own (licence 2.2b, 2.2h): cat.bin is its GLB with every byte XORed by a fixed
// xorshift stream, so what the site serves is no model file a viewer opens; pets.js undoes it (catBytes). The chicken
// (CC BY 4.0) stays a plain GLB: CC BY forbids putting measures on it that restrict what others may do with it.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, meshopt, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { execFileSync } from 'child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
const [,, catIn, chickenIn, outDir] = process.argv;
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const tmp = mkdtempSync(join(tmpdir(), 'pets-'));
const toWebp = (tex, size, q = 82) => {   // a texture resized (longest side) and re-encoded as WebP
  const src = join(tmp, 'in'), dst = join(tmp, 'out.webp'); writeFileSync(src, tex.getImage());
  execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${src}').convert('RGB'); im.thumbnail((${size},${size})); im.save('${dst}', 'WEBP', quality=${q}, method=6)`]);
  tex.setImage(new Uint8Array(readFileSync(dst))).setMimeType('image/webp');
};
const finish = doc => doc.transform(prune({ keepLeaves: true }), dedup(), reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
// the cat: drawn crisp (not painted): its coat (the face's eyes and whiskers are painted in it) keeps 1024 px; its
// occlusion and roughness (one map) and its normals are soft and go to 512
const cat = await io.read(catIn), cr = cat.getRoot();
for (const m of cr.listMaterials()) {
  const base = m.getBaseColorTexture(), orm = m.getMetallicRoughnessTexture(), nrm = m.getNormalTexture();
  if (base) toWebp(base, 1024, 86); if (orm) toWebp(orm, 512, 85); if (nrm) toWebp(nrm, 512, 90);
  m.setDoubleSided(false);   // a closed body
}
await finish(cat);
cat.createExtension(EXTTextureWebP).setRequired(true);
const glb = await io.writeBinary(cat);
let s = 0x2545F491;   // xorshift32: the same stream as catBytes in pets.js
for (let i = 0; i < glb.length; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; glb[i] ^= s & 255; }
writeFileSync(join(outDir, 'cat.bin'), glb);
console.log('cat.bin', Math.round(glb.length / 1024), 'KB');
// the chicken: specular-glossiness to plain colour (its diffuse map), one UV set, about a tenth of its triangles
const chicken = await io.read(chickenIn), hr = chicken.getRoot();
for (const m of hr.listMaterials()) {
  const sg = m.getExtension('KHR_materials_pbrSpecularGlossiness');
  if (sg) { m.setBaseColorTexture(sg.getDiffuseTexture()).setBaseColorFactor(sg.getDiffuseFactor()); m.setExtension('KHR_materials_pbrSpecularGlossiness', null); }
  m.setRoughnessFactor(0.9).setMetallicFactor(0);
}
for (const mesh of hr.listMeshes()) for (const p of mesh.listPrimitives()) for (const k of ['TEXCOORD_1', 'TEXCOORD_2']) if (p.getAttribute(k)) p.setAttribute(k, null);
for (const ext of hr.listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_pbrSpecularGlossiness') ext.dispose();
await chicken.transform(prune({ keepLeaves: true }), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.1, error: 0.002 }));
for (const t of hr.listTextures()) toWebp(t, 768);
hr.listScenes()[0].listChildren()[0].setName('chicken');
await finish(chicken);
chicken.createExtension(EXTTextureWebP).setRequired(true);
await io.write(join(outDir, 'hen.glb'), chicken);
console.log('hen.glb', Math.round(readFileSync(join(outDir, 'hen.glb')).length / 1024), 'KB');
