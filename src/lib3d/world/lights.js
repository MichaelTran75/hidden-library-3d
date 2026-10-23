import './outside.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { R } from '../core/base.js';
import { renderer, scene } from '../core/renderer.js';

/* ---------------------------------------------------------------- lights */
const LIGHTS = {};
function buildLights() {
  const hemi = new THREE.HemisphereLight(0xeef3e4, 0x8a6a48, 0.5); scene.add(hemi); LIGHTS.hemi = hemi;
  const sun = new THREE.DirectionalLight(0xfff0d6, 3.6); sun.position.set(-8, 6.2, 3.2); sun.target.position.set(0.5, 0, -3.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);   /* (2048, then 1536: G, 19/10/2026; 1024: G, 21/10/2026, the page's memory; 2048 again: G, 24/10/2026, "shadow ... rõ hơn") */ const sc = sun.shadow.camera; sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 40; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  scene.add(sun, sun.target); LIGHTS.sun = sun;
  const left = new THREE.RectAreaLight(0xf3f6ea, 1.15, R.zF - R.zB, R.H); left.position.set(R.xL - 0.05, R.H / 2, (R.zB + R.zF) / 2); left.lookAt(R.xL + 5, R.H / 2, (R.zB + R.zF) / 2); scene.add(left);
  const back = new THREE.RectAreaLight(0xf3f6ea, 1.2, R.xS - R.xL, R.H - R.caseTop); back.position.set((R.xL + R.xS) / 2, (R.caseTop + R.H) / 2, R.zB - 0.05); back.lookAt((R.xL + R.xS) / 2, (R.caseTop + R.H) / 2, 0); scene.add(back);
  const front = new THREE.RectAreaLight(0xf3f6ea, 1.2, R.xS - R.xL, R.H - R.caseTop); front.position.set((R.xL + R.xS) / 2, (R.caseTop + R.H) / 2, R.zF + 0.05); front.lookAt((R.xL + R.xS) / 2, (R.caseTop + R.H) / 2, -5); scene.add(front);
  LIGHTS.rects = [left, back, front];
  // environment for reflections / sheen
  const env = new THREE.Scene(); const s = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec3 p; void main(){ vec3 c = p.y>0.0 ? mix(vec3(0.55,0.62,0.48), vec3(0.9,0.93,0.9), smoothstep(0.0,0.6,p.y)) : mix(vec3(0.55,0.42,0.28), vec3(0.35,0.26,0.18), -p.y); if (p.x < -0.2) c *= 1.25; gl_FragColor = vec4(c,1.0);}' }));
  // drawn into a 64 px cube first: fromScene makes a 256 one (its result 768 x 1024 at half float, ~6 MB) for a sky that is only a gradient (G, 21/10/2026, "ánh sáng môi trường 8 MB")
  env.add(s); const pm = new THREE.PMREMGenerator(renderer), cube = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType }); new THREE.CubeCamera(0.1, 100, cube).update(renderer, env);
  scene.environment = pm.fromCubemap(cube.texture).texture; scene.environmentIntensity = 0.55;
  pm.dispose(); cube.dispose(); s.geometry.dispose(); s.material.dispose();   // (its working targets let go: ~6 MB on the GPU, G, 19/10/2026)
}

export { LIGHTS, buildLights };
