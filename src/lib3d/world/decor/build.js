import './items.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, rng } from '../../core/utils.js';
import { room } from '../room.js';
import { DECOR, DK_Y, decorItem } from './kit.js';
import { decorAtlas } from './atlas.js';
import { DECOR_ITEMS } from './items.js';
import { paintLightly } from '../../fx/post.js';

/* the pieces are built last, after the room, its models on display and the animals (G, 20/10/2026: "cho máy bay, iss, đồng hồ,
   máy ảnh ... load sau khi căn phòng load xong, mới tới gà mèo, rồi mới tới các vật trưng bày"); what the room needs of them
   before that is planned here, with the room: which cell the camera takes (the mantel clock's), and the room's random
   draws the old pieces took, so everything built after (the garden) stays where it was. */
function planDecor() {
  const r = rng(4242), deck = DECOR_ITEMS.map(f => [r(), f]).sort((a, b) => a[0] - b[0]).map(x => x[1]);   // (the same shuffle as buildDecor's)
  DECOR.forEach((d, k) => { if (k >= deck.length || d.skip || deck[k].name !== 'mantelClock') return;
    const c = d.o.clone().addScaledVector(d.along, d.len / 2).addScaledVector(d.out, -d.dep / 2 + 0.05);
    DECOR.camera = { at: c, yaw: Math.atan2(d.out.x, d.out.z), o: d.o.clone(), along: d.along.clone(), out: d.out.clone(), len: d.len, hgt: d.hgt, dep: d.dep }; });
  let pics = 0, n = 0;
  for (const d of DECOR) n += d.kind === 0 ? 2 + (pics++ < 5 ? 64 : 1) : [0, 0, 4, 1, 0, 2][d.kind];
  for (let i = 0; i < n; i++) rand();
  DECOR.used = Math.min(DECOR.length, deck.length);
}
function buildDecor(assets) {
  const g = new THREE.Group(); room.add(g);
  const r = rng(4242), rnd = (a, b) => a + (b - a) * r(), atlas = decorAtlas(), C = new THREE.Color();
  const deck = DECOR_ITEMS.map(f => [r(), f]).sort((a, b) => a[0] - b[0]).map(x => x[1]);   // shuffled: one piece per cell
  const bins = { matte: [], gloss: [], metal: [], glass: [], art: [], book: [] }, W = new THREE.Matrix4(), Q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  DECOR.forEach((d, k) => {
    if (k >= deck.length) return;
    const c = d.o.clone().addScaledVector(d.along, d.len / 2).addScaledVector(d.out, -d.dep / 2 + 0.05);
    const yaw = Math.atan2(d.out.x, d.out.z), it = decorItem();
    const model = deck[k](it, rnd, { assets, len: d.len, hgt: d.hgt });
    if (d.skip) return;   // (a cell given to something else, the clock: its piece made all the same, so the random draws after it stay as they were)
    const turn = yaw + rnd(-0.12, 0.12);
    if (deck[k].name === 'mantelClock') { DECOR.camera = { at: c.clone(), yaw, o: d.o.clone(), along: d.along.clone(), out: d.out.clone(), len: d.len, hgt: d.hgt, dep: d.dep }; return; }   // (its cell the vintage camera's: world/camera.js; G, 19/10/2026)
    if (c.x > 2 && c.z > -1.4) return;   // (the tall shelves' cells nearest the front are behind every view: their pieces left out, after their random draws: G, 23/10/2026)
    W.compose(c, Q.setFromAxisAngle(DK_Y, turn), one);
    for (const p of it.parts) {
      const geo = p.geo; geo.applyMatrix4(W);
      const n = geo.attributes.position.count, col = new Float32Array(n * 3);
      if (Array.isArray(p.col)) for (let i = 0; i < n; i++) C.setHex(p.col[Math.min(5, i >> 2)]).toArray(col, i * 3);   // a box: four vertices a face
      else { C.setHex(p.col); for (let i = 0; i < n; i++) C.toArray(col, i * 3); }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (p.slot) { const [u0, v0, u1, v1] = atlas.slots[p.slot], uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); }
      bins[p.fin].push(geo);
    }
    if (model) { model.position.copy(c); model.rotation.y += yaw; model.traverse(m => { if (m.isMesh) m.castShadow = m.receiveShadow = true; }); g.add(model); if (deck[k].name === 'bookPile') paintLightly(model, 0.9965); }
  });
  const std = o => new THREE.MeshStandardMaterial(o);
  const mats = { matte: std({ vertexColors: true, roughness: 0.85 }), gloss: std({ vertexColors: true, roughness: 0.3 }), metal: std({ vertexColors: true, metalness: 0.9, roughness: 0.38 }),
    glass: std({ vertexColors: true, roughness: 0.08, transparent: true, opacity: 0.3, depthWrite: false }), art: std({ map: atlas.tex, roughness: 0.75 }) }; mats.book = mats.matte;
  for (const [fin, list] of Object.entries(bins)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list), mats[fin]); m.castShadow = fin !== 'glass'; m.receiveShadow = true; if (fin === 'glass') m.renderOrder = 1; g.add(m);
    if (fin === 'book') paintLightly(m, 0.9965);   // (the books among the pieces: as every book, 20 % less watercolour, then half of what was left, three times: G, 23/10/2026; 30 % less, then half, then 90 % less: G, 24/10/2026)
  }
  g.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.fog = false; }); });   // (inside: no haze)
  return g;   // (the room's draws were taken by planDecor)
}

export { buildDecor, planDecor };
