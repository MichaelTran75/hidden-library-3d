import '../core/renderer.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { ctex } from '../core/utils.js';
import { paintPictures } from './textures.js';

/* ---------------------------------------------------------------- materials */
// the wood is painted in workers (textures.js) while the room is built: the textures are made at once, for the
// materials, and their pixels come in later (the promise returned, awaited before the room is first drawn)
const TEX = {};
function buildTextures() {
  const PICS = [
    ['floor', 'planks', { w: 512, h: 2048, hue: 28, sat: .55, light: .5, vary: .06, seed: 3 }, 4],   // (in four bands: the largest)
    ['ceil', 'planks', { w: 256, h: 1024, planks: 8, hue: 27, sat: .5, light: .42, vary: .035, seed: 11, gap: .6, grain: 1.4 }],   // mostly out of view: half size
    ['oak', 'grain', { w: 256, h: 1024, hue: 29, sat: .5, light: .5 }],
    ['frame', 'grain', { w: 256, h: 1024, hue: 25, sat: .52, light: .42, seed: 4 }],
  ];
  for (const [k] of PICS) TEX[k] = ctex();
  TEX.floor.repeat.set(1 / 1.08, 1 / 4.32); TEX.ceil.repeat.set(1 / 1.08, 1 / 4.32);
  return paintPictures(PICS.map(([, kind, o, bands]) => ({ kind, o, bands })))
    .then(px => PICS.forEach(([k, , o], i) => { TEX[k].image = new ImageData(px[i], o.w, o.h); TEX[k].needsUpdate = true; }));
}
const MAT = {};
function buildMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: .8, metalness: 0, ...o });
  MAT.floor = std({ map: TEX.floor, bumpMap: TEX.floor, bumpScale: 0.6, roughness: .55 });
  MAT.ceil = std({ map: TEX.ceil, roughness: .8 });
  MAT.oak = std({ map: TEX.oak, roughness: .62 });
  MAT.oakDark = std({ map: TEX.oak, color: 0xb98d62, roughness: .7 });
  MAT.shelfBack = std({ map: TEX.oak, color: 0x5e4430, roughness: .85 }); MAT.shelfBack.color.multiplyScalar(new THREE.Color().setRGB(0.75, 0.75, 0.75, THREE.SRGBColorSpace).r);
  MAT.shelfOak = MAT.oak.clone(); MAT.shelfOak.color.setRGB(0.75, 0.75, 0.75, THREE.SRGBColorSpace);   // (the bookshelves' boards and backs 25 % darker, as the frames: G, 18/10/2026; the tables keep MAT.oak)
  MAT.frame = std({ map: TEX.frame, roughness: .55 }); MAT.frame.color.setRGB(0.75, 0.75, 0.75, THREE.SRGBColorSpace);   // (the glass walls' wooden frames 25 % darker: G, 18/10/2026)
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
