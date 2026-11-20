import './trees.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/* ---------------------------------------------------------------- assets (GLB) */
async function loadAssets(buf) {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buf, '');
  // quantized meshes carry a node transform: bake it into plain Float32 geometry
  const bake = (m) => { m.updateWorldMatrix(true, false); const src = m.geometry, g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(src.attributes)) { const n = a.count, s = a.itemSize, f = new Float32Array(n * s); const get = ['getX', 'getY', 'getZ', 'getW'];
      for (let i = 0; i < n; i++) for (let c = 0; c < s; c++) f[i * s + c] = a[get[c]](i); g.setAttribute(k, new THREE.BufferAttribute(f, s)); }
    if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1)); g.applyMatrix4(m.matrixWorld); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
  const byName = {}; gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(o => { if (o.isMesh) { const m = new THREE.Mesh(bake(o), o.material); m.name = o.name; byName[o.name] = m; } });
  const A = { byName };
  const fix = (m) => { m.material.side = THREE.DoubleSide; return m; };
  A.isoPile = new THREE.Group(); { const m = byName.iso_bookPile1.clone(); m.material = m.material.clone(); m.castShadow = true; A.isoPile.add(m); m.geometry.computeBoundingBox(); A.isoPileH = m.geometry.boundingBox.max.y; }
  return A;
}

export { loadAssets };
