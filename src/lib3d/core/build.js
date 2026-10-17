import './views.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { tick } from './base.js';
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

/* ---------------------------------------------------------------- main
   The room first: all its first picture shows (G, 17/10/2026: "phòng trước, sau đó mới đến cây, rồi mới đến trời"). The
   wood is painted in workers meanwhile and the models download; the garden and the sky's dome are built after that
   picture (buildGarden, called from loop.js), each part let in when it is ready.                                    */
let A = null, booksMesh, motes;
async function main() {
  const bufP = getLibBuffer(); bufP.catch(() => {});   // the models download while the room is built
  const texP = buildTextures();   // (the wood, painted in workers: materials.js)
  buildMaterials();
  buildRoom();
  BOOK.atlas = buildSpineAtlas(); buildShelves(); booksMesh = buildBookInstances(); paintLightly(booksMesh, 0.1); await tick();   // (the shelves' books: 10 % less watercolour, G, 17/10/2026)
  buildLights(); buildPost();
  A = await loadAssets(await bufP); await tick();
  await buildFurniture(A); await tick(); buildDecor(A); motes = dust(); await tick();
  // interior materials ignore fog
  scene.fog = new THREE.FogExp2(0xd6e2e6, 0.03);   // a light blue haze over the far trees, matching the sky
  room.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.fog = false); });
  buildGlass();   // (the panes' glass: the room is first seen in it once the garden and the sky are in, loop.js)
  await texP;
}
// after the room's first picture: the garden (its trees built in code, the lawn, the shrubs, the far woods) and the
// sky's dome, hidden until they are let in (loop.js: reveal). Of all that is built only the shelves, their books and
// the decor draw from the room's random sequence before the garden does (utils.js rand), and they are built in main:
// so the garden still stands where it always has.
async function buildGarden() {
  const trees = await makeTrees(); await tick();
  // they sway as the GLB trees did: the sway grows with the square of the height in model units, and those models were
  // drawn at scales 0.82, 23 and 0.024, so the same motion in metres takes the inverse
  for (const [k, t] of Object.entries(trees)) for (const p of t.parts) { windify(p.material, p.leaf, { windScale: 1 / { A: 0.82, B: 23, C: 0.024 }[k] }); p.material.fog = true; }
  A.trees = trees; buildOutside(A);
}
async function getLibBuffer() {   // the models: inline (base64) in the one-file build, a file next to the page on GitHub Pages
  const el = document.getElementById('lib-glb');
  if (el && el.dataset.src) { const r = await fetch(el.dataset.src); if (!r.ok) throw new Error('lib.glb ' + r.status); return r.arrayBuffer(); }
  if (el && el.textContent.trim().length > 100) return (await fetch('data:application/octet-stream;base64,' + el.textContent.trim())).arrayBuffer();
  throw new Error('missing #lib-glb data');
}

export { booksMesh, buildGarden, main, motes };
