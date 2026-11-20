import './timber.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { ctex } from '../core/utils.js';
import { paintPictures } from './textures.js';
import { fineTimber } from './timber.js';

/* ---------------------------------------------------------------- materials */
// the wood is painted in workers (textures.js) while the room is built: the textures are made at once, for the
// materials, and their pixels come in later (the promise returned, awaited before the room is first drawn)
const TEX = {};
function boxDown(px, w, h, f) {   // a picture's pixels averaged f x f: a smaller copy that keeps its tones (no speckle)
  const W = w / f, H = h / f, out = new Uint8ClampedArray(W * H * 4), n = f * f;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += px[((y * f + j) * w + x * f + i) * 4 + c];
    out[(y * W + x) * 4 + c] = s / n;
  }
  return out;
}
function buildTextures() {
  // (each as wide as it is long in pixels, however long its boards: the grain's detail lies across it. mw, mh: the metres it covers)
  const PICS = [
    ['floor', 'boards', { w: 1024, h: 1024, mw: 1.08, mh: 4.32, planks: 6, hue: 28, sat: .573, light: .486, vary: .06, seed: 3 }, 4],   // (in four bands: the largest)
    ['ceil', 'boards', { w: 512, h: 512, mw: 1.08, mh: 4.32, planks: 8, hue: 27, sat: .505, light: .385, vary: .035, seed: 11, depth: .8, seam: 0.004 }],   // mostly out of view: half size
    ['oak', 'boards', { w: 512, h: 512, mw: 1, mh: 1, planks: 8, hue: 29, sat: .49, light: .465, vary: .03, seed: 9, joint: 'glue', rays: 1 }],
    ['frame', 'boards', { w: 256, h: 256, mw: 1, mh: 1, planks: 5, hue: 25, sat: .529, light: .387, vary: .03, seed: 4, joint: 'glue', down: 2 }],   // (the room's frame kept small, 128 x 128: its grain is the material's, timber.js)
  ];
  for (const [k] of PICS) TEX[k] = ctex();
  TEX.floor.repeat.set(1 / 1.08, 1 / 4.32); TEX.ceil.repeat.set(1 / 1.08, 1 / 4.32);
  return paintPictures(PICS.map(([, kind, o, bands]) => ({ kind, o, bands })))
    .then(px => { PICS.forEach(([k, , o], i) => { const f = o.down || 1; TEX[k].image = new ImageData(f > 1 ? boxDown(px[i], o.w, o.h, f) : px[i], o.w / f, o.h / f); TEX[k].needsUpdate = true; }); });
}
const MAT = {};
function buildMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: .8, metalness: 0, ...o });
  MAT.floor = fineTimber(std({ map: TEX.floor, roughness: .55 }), { joint: 1, wear: 1, mirror: 1 }); MAT.floor.color.setRGB(0.52, 0.52, 0.52, THREE.SRGBColorSpace); MAT.floor.defines = { ...MAT.floor.defines, PET_SHADE: '' };   // (30 % darker on the screen; the paper's lift takes back part of a darker wood, so 0.52 for 0.7)
  MAT.ceil = fineTimber(std({ map: TEX.ceil, roughness: .8 }), { joint: 0.75, gap: 0.005, pore: 0.6, rows: 512 })   // (boards with a V between them: a wider joint than the floor's);
  MAT.oak = std({ map: TEX.oak, roughness: .62 });
  MAT.oakDark = std({ map: TEX.oak, color: 0xb98d62, roughness: .7 });
  MAT.shelfBack = fineTimber(std({ map: TEX.oak, color: 0x5e4430, roughness: .85 }), { wear: 0.4 }); MAT.shelfBack.color.multiplyScalar(new THREE.Color().setRGB(0.675, 0.675, 0.675, THREE.SRGBColorSpace).r);   // (and the shelves' boards and backs 10 % darker again)
  MAT.shelfOak = fineTimber(MAT.oak.clone(), { wear: 0.6, relief: 1.4 }); MAT.shelfOak.color.setRGB(0.675, 0.675, 0.675, THREE.SRGBColorSpace); MAT.shelfOak.roughness = 0.58;   // (its grain in relief, seen near: timber.js)   // (the bookshelves' boards and backs 25 % darker, as the frames; the tables keep MAT.oak)
  MAT.frame = fineTimber(std({ map: TEX.frame, roughness: .55 }), { lines: 1, wear: 0.5 }); MAT.frame.color.setRGB(0.375, 0.375, 0.375, THREE.SRGBColorSpace);   // (the glass walls' wooden frames 25 % darker; then half as bright again)
  MAT.glass = new THREE.MeshPhysicalMaterial({ color: 0xf2f7ee, roughness: .04, metalness: 0, transparent: true, opacity: .1, envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide });
  MAT.glass.defines = { RECT_SPEC: '' };   // the panes keep the windows' reflections
  MAT.velvet = new THREE.MeshPhysicalMaterial({ color: 0x3d5638, roughness: .8, sheen: 1, sheenRoughness: .42, sheenColor: new THREE.Color(0x98ad85), side: THREE.DoubleSide });
  MAT.velvetDark = new THREE.MeshPhysicalMaterial({ color: 0x2b432b, roughness: .8, sheen: 1, sheenRoughness: .5, sheenColor: new THREE.Color(0x87a877), side: THREE.DoubleSide });
  MAT.mustard = new THREE.MeshPhysicalMaterial({ color: 0xb07a38, roughness: .75, sheen: .8, sheenRoughness: .5, sheenColor: new THREE.Color(0xf3d9a0), side: THREE.DoubleSide });
  MAT.copper = new THREE.MeshPhysicalMaterial({ color: 0xa8603a, metalness: .75, roughness: .38, envMapIntensity: .8, side: THREE.DoubleSide });
  MAT.brass = std({ color: 0xb48a4a, metalness: 1, roughness: .35 });
  MAT.bronze = std({ color: 0x6d5236, metalness: .8, roughness: .45 });
  MAT.shade = new THREE.MeshStandardMaterial({ color: 0xf0d9a8, roughness: .9, emissive: 0xffaa55, emissiveIntensity: 1.25, side: THREE.DoubleSide });
  MAT.bulb = new THREE.MeshBasicMaterial({ color: 0xfff1d0 });
  MAT.white = std({ color: 0xeee9df, roughness: .7 });
  MAT.plaster = std({ color: 0xe9e3d6, roughness: .85 });
  MAT.ceramic = std({ color: 0xe8e2d4, roughness: .35 });
  MAT.stone = std({ color: 0x8c8a84, roughness: .9 });
  MAT.terracotta = std({ color: 0xa9643f, roughness: .85 });
}

export { MAT, buildMaterials, buildTextures };
