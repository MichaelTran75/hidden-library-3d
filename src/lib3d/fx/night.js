import '../core/build.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { R } from '../core/base.js';
import { scene } from '../core/renderer.js';
import { MAT } from '../world/materials.js';
import { LIGHTS } from '../world/lights.js';
import { POST } from './post.js';

/* ---------------------------------------------------------------- night
   By night the sun is gone, the sky and the forest turn deep blue (stars), window light turns to moonlight, and the
   reading lamps plus the ceiling downlights (as in the night painting) carry the room. When it falls and how is the
   hour's business (below).                                                                                      */
const NIGHT = { u: { value: 0 }, day: null, spots: [] };
const NC = { hemi: new THREE.Color(0x2b3a5e), hemiG: new THREE.Color(0x2a1e14), win: new THREE.Color(0x56699a), fog: new THREE.Color(0x0e1522), ring: new THREE.Color(0x172129) };
const lerp = (a, b, k) => a + (b - a) * k;
function buildNightLights() {
  // recessed ceiling downlights, on by night. Kept away from the glass and fairly narrow: without shadows their light would
  // otherwise spill onto the shrubs outside. Over the sofa and the floor they shine straight down; along the tall shelf
  // they lean onto the books (wall-washers), so its rows still read in the dark.
  const DL = [[0.25, -7.0, 0, 0.58, 1.25], [1.65, -7.0, 0, 0.58, 1.25], [0.7, -3.9, 0, 0.58, 1.25], [0.45, -1.5, 0, 0.55, 1.1],
    ...[-7.5, -5.4, -3.3, -1.2].map(z => [R.xS - 0.62, z, 1, 0.5, 0.95])];
  for (const [x, z, wash, angle, k] of DL) {
    const sp = new THREE.SpotLight(0xffd6a0, 0, 9, angle, 0.85, 2); sp.position.set(x, R.H - 0.03, z);
    if (wash) sp.target.position.set(R.xS, 2.4, z + 0.2); else sp.target.position.set(x + 0.05, 0, z + 0.25);
    scene.add(sp, sp.target);
    // (their cups in the ceiling, a dark disc in a brass ring, left out: no view sees that part of the ceiling: G, 23/10/2026)
    NIGHT.spots.push({ sp, k });
  }
  const L = LIGHTS;
  NIGHT.day = { sun: L.sun.intensity, sunC: L.sun.color.clone(), sunT: L.sun.target.position.clone(), hemi: L.hemi.intensity, hemiC: L.hemi.color.clone(), hemiG: L.hemi.groundColor.clone(), rects: L.rects.map(r => [r.intensity, r.color.clone()]),
    env: scene.environmentIntensity, fog: scene.fog.color.clone(), ring: L.ring ? L.ring.material.color.clone() : null,
    table: L.table.userData.light.intensity, tableGlow: L.table.userData.glow.material.opacity, floor: L.floor.userData.light.intensity, floorPt: L.floor.userData.pt.intensity,
    floorGlow: L.floor.userData.glow.material.opacity, shade: MAT.shade.emissiveIntensity, exposure: POST.mat.uniforms.exposure.value, lift: POST.mat.uniforms.lift.value, veil: POST.mat.uniforms.veil.value };
}

export { NC, NIGHT, buildNightLights, lerp };
