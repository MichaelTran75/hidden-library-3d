import './views.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { setLoad, tick } from './base.js';
import { camera, renderer, scene, setShadowsDirty } from './renderer.js';
import { buildMaterials, buildTextures } from '../world/materials.js';
import { buildRoom, room } from '../world/room.js';
import { buildBookInstances, setSpineAtlas, spineAtlas } from '../world/books.js';
import { buildShelves } from '../world/shelves.js';
import { buildDecor, planDecor } from '../world/decor/build.js';
import { buildOutside } from '../world/outside.js';
import { buildLights } from '../world/lights.js';
import { makeTrees } from '../world/trees.js';
import { loadAssets } from '../world/assets.js';
import { windify } from '../world/wind.js';
import { buildFurniture } from '../world/furnish.js';
import { dust } from '../fx/dust.js';
import { POST, buildPost, paintLightly } from '../fx/post.js';
import { buildGlass } from '../fx/glass.js';

/* ---------------------------------------------------------------- main
   The room first: all its first picture shows (G, 17/10/2026: "phòng trước, sau đó mới đến cây, rồi mới đến trời"). The
   wood is painted in workers meanwhile and the models download; the garden and the sky's dome are built after that
   picture (buildGarden, called from loop.js), each part let in when it is ready.                                    */
let A = null, booksMesh, motes;
// the shelves' pieces, once the room, its models and the animals are in (core/loop.js start): their shaders made in
// the background, the shadows drawn again
async function buildDisplays() {   // (built hidden, its shaders made while it is seen only by the compiler; shown by core/loop.js)
  if (!A) return null; const g = buildDecor(A);
  if (renderer.compileAsync) { renderer.setRenderTarget(POST.rt); let p = null; try { p = renderer.compileAsync(g, camera, scene); } catch (e) { /* compiled on first use */ } renderer.setRenderTarget(null); g.visible = false; if (p) await p.catch(() => {}); }
  g.visible = false; return g;
}
async function main() {
  const bufP = getLibBuffer(); bufP.catch(() => {});   // the models download while the room is built
  const texP = buildTextures();   // (the wood, painted in workers: materials.js)
  const spinesP = spineAtlas();   // (the books' spines, drawn in a worker: books.js)
  buildMaterials(); pmark('materials');
  buildRoom(); pmark('frame');
  buildShelves(); pmark('shelves'); booksMesh = buildBookInstances(); pmark('books'); paintLightly(booksMesh, 0.9965, 0.99978); await tick();   // (the shelves' books: 10 % less watercolour, G, 17/10/2026, and 10 % less again, G, 18/10/2026: "kệ sách và toàn bộ sách 10% less water color"; seen near 95 % less: 80 %, then 75 % of what was left, G, 18/10/2026; then half of what was left, far and near, three times, then 30 % less, then half, then 90 % less (G, 24/10/2026): G, 23/10/2026, "toàn bộ sách less watercolor 50%", "cho sách less water color 50%")
  buildLights(); buildPost();
  const buf = await bufP; pmark('downloaded'); A = await loadAssets(buf); pmark('assets'); await tick();
  await buildFurniture(A); pmark('furniture'); await tick(); planDecor(); motes = dust(); await tick();   // (the shelves' pieces themselves last: buildDisplays)
  // interior materials ignore fog
  scene.fog = new THREE.FogExp2(0xd6e2e6, 0.03);   // a light blue haze over the far trees, matching the sky
  room.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.fog = false); });
  buildGlass();   // (the panes' glass: the room is first seen in it once the garden and the sky are in, loop.js)
  await texP; pmark('wood'); setSpineAtlas(booksMesh, await spinesP); pmark('spines');
}
// each step marked (tools/perf) and counted on the loader's bar (core/base.js setLoad)
const STEP_PCT = { materials: 5, frame: 9, shelves: 12, books: 15, downloaded: 32, assets: 38, furniture: 48, wood: 52, spines: 55 };
const pmark = n => { try { performance.mark('l3m-' + n); } catch (e) { /* no User Timing */ } setLoad(STEP_PCT[n] || 0); };
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
  if (el && el.dataset.src) {   // (read as it comes, counted on the loader's bar from 15 to 32 %)
    const r = await fetch(el.dataset.src); if (!r.ok) throw new Error('lib.glb ' + r.status);
    const n = +r.headers.get('content-length') || 0; if (!n || !r.body || !r.body.getReader) return r.arrayBuffer();
    const rd = r.body.getReader(), chunks = []; let got = 0;   // (a compressed transfer's length is less than what comes: capped at 1)
    for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); got += value.length; setLoad(15 + 17 * Math.min(1, got / n)); }
    const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out.buffer;
  }
  if (el && el.textContent.trim().length > 100) return (await fetch('data:application/octet-stream;base64,' + el.textContent.trim())).arrayBuffer();
  throw new Error('missing #lib-glb data');
}

export { booksMesh, buildDisplays, buildGarden, main, motes };
