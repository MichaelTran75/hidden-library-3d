import './views.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { setLoad, tick } from './base.js';
import { scene } from './renderer.js';
import { buildMaterials, buildTextures } from '../world/materials.js';
import { buildRoom, room } from '../world/room.js';
import { BOOK, buildBookInstances, buildSpineAtlas } from '../world/books.js';
import { buildShelves } from '../world/shelves.js';
import { buildDecor } from '../world/decor/build.js';
import { buildOutside } from '../world/outside.js';
import { buildLights } from '../world/lights.js';
import { makeTrees } from '../world/trees.js';
import { loadAssets } from '../world/assets.js';
import { windify } from '../world/wind.js';
import { buildFurniture } from '../world/furnish.js';
import { dust } from '../fx/dust.js';
import { buildPost, paintLightly } from '../fx/post.js';
import { buildGlass } from '../fx/glass.js';

/* ---------------------------------------------------------------- main */
let A = null, booksMesh, motes;
async function main() {
  const bufP = getLibBuffer(); bufP.catch(() => {});   // the models download while the room is built
  setLoad(0.05); await tick();
  await buildTextures(); setLoad(0.25); buildMaterials();
  buildRoom(); setLoad(0.3);
  BOOK.atlas = buildSpineAtlas(); buildShelves(); booksMesh = buildBookInstances(); paintLightly(booksMesh, 0.1); setLoad(0.45); await tick();   // (the shelves' books: 10 % less watercolour, G, 17/10/2026)
  buildLights(); buildPost();
  const trees = await makeTrees(); await tick();   // built in code while the models download
  // they sway as the GLB trees did: the sway grows with the square of the height in model units, and those models were
  // drawn at scales 0.82, 23 and 0.024, so the same motion in metres takes the inverse
  for (const [k, t] of Object.entries(trees)) for (const p of t.parts) { windify(p.material, p.leaf, { windScale: 1 / { A: 0.82, B: 23, C: 0.024 }[k] }); p.material.fog = true; }
  const buf = await bufP; setLoad(0.7); await tick();
  A = await loadAssets(buf); A.trees = trees; setLoad(0.85);
  await buildFurniture(A); await tick(); buildDecor(A); buildOutside(A); motes = dust(); await tick();
  // interior materials ignore fog
  scene.fog = new THREE.FogExp2(0xd6e2e6, 0.03);   // a light blue haze over the far trees, matching the sky
  room.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.fog = false); });
  buildGlass();   // (the panes' glass: it looks at the finished room)
  setLoad(1);
}
async function getLibBuffer() {   // the models: inline (base64) in the one-file build, a file next to the page on GitHub Pages
  const el = document.getElementById('lib-glb');
  if (el && el.dataset.src) { const r = await fetch(el.dataset.src); if (!r.ok) throw new Error('lib.glb ' + r.status); return r.arrayBuffer(); }
  if (el && el.textContent.trim().length > 100) return (await fetch('data:application/octet-stream;base64,' + el.textContent.trim())).arrayBuffer();
  throw new Error('missing #lib-glb data');
}

export { booksMesh, main, motes };
