import '../world/furnish.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { R } from '../core/base.js';
import { rng } from '../core/utils.js';
import { scene } from '../core/renderer.js';

/* ---------------------------------------------------------------- dust motes */
function dust() {
  const n = 600; const g = new THREE.BufferGeometry(); const p = new Float32Array(n * 3); const r = rng(3);
  for (let i = 0; i < n; i++) { p[i * 3] = R.xL + r() * (R.xS - R.xL); p[i * 3 + 1] = r() * R.H; p[i * 3 + 2] = R.zB + r() * (R.zF - R.zB); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color: 0xfff3d6, size: 0.012, transparent: true, opacity: .55, depthWrite: false, fog: false });
  const pts = new THREE.Points(g, m); scene.add(pts); return pts;
}

export { dust };
