import './cat.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/* ---------------------------------------------------------------- fur
   The cat's coat drawn as shells, the way games draw short animal fur (Lengyel, Praun, Finkelstein & Hoppe, "Real-Time
   Fur over Arbitrary Surfaces", 2001; NVIDIA's "Fur: shells and fins"): its skin drawn again in FUR.shells layers, each
   pushed out along the skin's normal a little further (combed back along the body and drooping a touch toward the
   tips), keeping only where a strand reaches. The strands are cells of the coat's texture space (~1.3 mm apart on this
   cat), each of its own height, thinning toward its tip; the layers are 0.4 mm apart, about a thousandth of the cat
   (Lengyel's rule of thumb). So its outline turns soft and the coat takes depth: the roots in shadow, the tips catching
   the light. Each strand takes the colour of the coat where it grows (white on the bib, the blaze and the toes); none
   grow on the eyes or the nose (the wet parts of its roughness map). Where strands are smaller than a pixel a layer
   keeps its average cover instead of its pattern, so the coat does not shimmer as the cat moves. The layers are not
   lit one by one (twenty layers of the room's lights cost too much close up): each frame the skin is lit once, as the
   room lights it, into its own texture space (512 px, the empty texels filled from their neighbours so seams do not
   show), and every layer takes its colour from there ("texture-space lighting"). The layers are blended
   over the skin, depth-tested but not writing depth (as NVIDIA's sample does), in one draw whose triangles go layer by
   layer from the inside out, so each lies over the one beneath; blended, the crisp pass's target keeps premultiplied
   colour, which its composite expects. The fur is shorter on the head, ears and paws and longer on the tail. The layers
   are copies of the skin in one mesh, bound to the cat's skeleton, so they move with it.                          */
// (long and fluffy since G, 24/10/2026: "lông mèo là lông xù có độ dài": 8 mm -> 2 cm, 20 -> 28 layers so the longer strands
// stay whole, each strand curling and leaning its own way, the tips drooping more; then twice as long, 4 cm, 40 layers, its
// tufts larger (50 across): G, 24/10/2026, "em mèo lông xù dài thêm x2")
const FUR = { shells: 40, density: 440, layer: 2, size: 512, bake: null, rt: null, rt2: null, cam: new THREE.Camera(), dil: null,
  u: { uFurLen: { value: 0.04 }, uComb: { value: new THREE.Vector3(0, 0, -1) }, uFurMask: { value: null } } };
// how long the fur is on each part, as a share of the body's
const FUR_PART = [[/^head$/, 0.6], [/^ear/, 0.3], [/^(paw|toe|ftoe|foot)/, 0.45], [/^fore/, 0.8], [/^tail/, 1.5]];
function furCoat(skin, patch) {
  const src = skin.geometry, N = FUR.shells, n = src.attributes.position.count, g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) {   // each attribute copied N times (as stored: quantized, interleaved or not)
    const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array, out = new arr.constructor(n * a.itemSize * N);
    for (let i = 0; i < n; i++) for (let c = 0; c < a.itemSize; c++) {
      const v = a.isInterleavedBufferAttribute ? arr[i * a.data.stride + a.offset + c] : arr[i * a.itemSize + c];
      for (let s = 0; s < N; s++) out[(s * n + i) * a.itemSize + c] = v;
    }
    g.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize, a.normalized));
  }
  const shell = new Float32Array(n * N), len = new Float32Array(n * N);
  const J = src.attributes.skinIndex, W = src.attributes.skinWeight, part = skin.skeleton.bones.map(b => (FUR_PART.find(([re]) => re.test(b.name)) || [0, 1])[1]);
  for (let i = 0; i < n; i++) {
    let l = 0; for (let c = 0; c < 4; c++) l += W.getComponent(i, c) * part[J.getComponent(i, c)];
    for (let s = 0; s < N; s++) { shell[s * n + i] = (s + 1) / N; len[s * n + i] = l; }
  }
  g.setAttribute('aShell', new THREE.BufferAttribute(shell, 1)); g.setAttribute('aFur', new THREE.BufferAttribute(len, 1));
  const idx = src.index, I = new (n * N > 65535 ? Uint32Array : Uint16Array)(idx.count * N);
  for (let s = 0; s < N; s++) for (let i = 0; i < idx.count; i++) I[s * idx.count + i] = idx.getX(i) + s * n;
  g.setIndex(new THREE.BufferAttribute(I, 1));
  // the skin lit into texture space: the cat's own material, its vertices placed by their texture coordinates
  const lit = () => new THREE.WebGLRenderTarget(FUR.size, FUR.size, { type: THREE.HalfFloatType, depthBuffer: false });
  FUR.rt = lit(); FUR.rt2 = lit();
  const bm = skin.material.clone(); bm.side = THREE.DoubleSide; bm.customProgramCacheKey = () => 'fur-bake';
  bm.onBeforeCompile = sh => {   // (drawn both ways round in texture space, so no face is taken for a back face)
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position = vec4(vMapUv * 2.0 - 1.0, 0.0, 1.0);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
  };
  FUR.bake = new THREE.SkinnedMesh(skin.geometry, bm); FUR.bake.bind(skin.skeleton, skin.bindMatrix);
  FUR.bake.position.copy(skin.position); FUR.bake.quaternion.copy(skin.quaternion); FUR.bake.scale.copy(skin.scale);
  FUR.bake.frustumCulled = false; FUR.bake.layers.set(FUR.layer); skin.parent.add(FUR.bake); FUR.cam.layers.set(FUR.layer);
  FUR.dil = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { t: { value: null }, px: { value: 1 / FUR.size } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D t; uniform float px; varying vec2 vUv;
      void main() { vec4 c = texture2D(t, vUv); if (c.a > 0.5) { gl_FragColor = c; return; }   // an empty texel takes its filled neighbours' mean
        vec4 s = vec4(0.0); for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) { vec4 n = texture2D(t, vUv + vec2(i, j) * px); s += vec4(n.rgb, 1.0) * step(0.5, n.a); }
        gl_FragColor = s.a > 0.0 ? vec4(s.rgb / s.a, 1.0) : vec4(0.0); }` }));
  FUR.u.uFurMask.value = skin.material.roughnessMap;
  const mat = new THREE.MeshBasicMaterial({ map: FUR.rt.texture, transparent: true, depthWrite: false, side: THREE.FrontSide });
  mat.fog = false;
  mat.onBeforeCompile = sh => {
    patch(sh); Object.assign(sh.uniforms, FUR.u);
    sh.vertexShader = 'attribute float aShell, aFur; uniform float uFurLen; uniform vec3 uComb; varying float vShell, vFur;\n' + sh.vertexShader
      .replace('#include <project_vertex>', `#include <project_vertex>
        // out along the normal, combed back along the body and drooping as it goes (in view space: metres)
        vShell = aShell; vFur = aFur;
        vec3 nv = normalize(transformedNormal), cb = mat3(viewMatrix) * uComb, dn = mat3(viewMatrix) * vec3(0.0, -1.0, 0.0);
        cb -= nv * dot(cb, nv);
        mvPosition.xyz += (nv * aShell + cb * 0.6 * aShell * aShell + dn * 0.32 * aShell * aShell) * uFurLen * aFur;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = `uniform sampler2D uFurMask; varying float vShell, vFur;
      float furHash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }\n` + sh.fragmentShader
      .replace('#include <map_fragment>', `
        {
          // the strand this fragment would belong to: its cell, height, place in the cell; thinner toward the tip
          vec2 gc = vMapUv * ${FUR.density.toFixed(1)}, id = floor(gc), f = fract(gc) - 0.5;
          vec2 lean = vec2(furHash(id + 5.17), furHash(id + 9.41)) - 0.5;   // each strand leans its own way as it rises (no rows)
          // fluffy: the strands grow in tufts (~6 mm, 70 across the coat's texture), each tuft of its own height, its strands' tips
          // drawn together, so the outline is ragged; each strand curls as it rises
          vec2 cg = vMapUv * 50.0, cid = floor(cg); float hc = 0.45 + 0.55 * furHash(cid + 1.37);
          vec2 toC = ((cid + 0.5) / 50.0 - (id + 0.5) / ${FUR.density.toFixed(1)}) * ${FUR.density.toFixed(1)}; toC *= min(1.0, 0.35 / max(length(toC), 1e-3));
          float hgt = (0.3 + 0.7 * furHash(id)) * hc, ph = 6.2832 * furHash(id + 3.71);
          vec2 curl = vec2(cos(ph + vShell * 7.0), sin(ph + vShell * 7.0)) * 0.22 * vShell;
          float d = length(f - (vec2(furHash(id + 17.31), furHash(id + 41.73)) - 0.5) * 0.36 - lean * 1.1 * vShell - curl - toC * vShell * vShell);
          float r = 0.6 * (1.0 - vShell / hgt), aw = fwidth(d) + 1e-4;
          float exact = vShell < hgt ? 1.0 - smoothstep(r - aw, r + aw, d) : 0.0;
          float sh = clamp(vShell / hc, 0.0, 1.0), avg = clamp(1.15 * (1.0 - sh) * (1.0 - sh), 0.0, 1.0) * clamp((1.0 - sh) / 0.7, 0.0, 1.0);   // the same, on average (by its tuft)
          float px = length(fwidth(gc)), cover = mix(exact, avg, smoothstep(0.3, 1.1, px));
          vec2 e0 = (vMapUv - vec2(0.4019, 0.2964)) / vec2(0.0125, 0.0185), e1 = (vMapUv - vec2(0.4985, 0.2969)) / vec2(0.0125, 0.0185);   // the eyes (as in pets.js)
          cover *= smoothstep(0.35, 0.7, texture2D(uFurMask, vMapUv).g) * step(0.05, vFur) * smoothstep(0.9, 1.25, min(dot(e0, e0), dot(e1, e1)));   // none on the eyes or the nose
          if (cover < 0.02) discard;
          diffuseColor = vec4(texture2D(map, vMapUv).rgb * mix(0.4, 1.04, vShell), cover);   // the skin as lit; the roots in its shade, the tips in the light
        }`);
  };
  const fur = new THREE.SkinnedMesh(g, mat); fur.bind(skin.skeleton, skin.bindMatrix);
  fur.position.copy(skin.position); fur.quaternion.copy(skin.quaternion); fur.scale.copy(skin.scale);
  fur.frustumCulled = false; fur.layers.mask = skin.layers.mask; fur.renderOrder = skin.renderOrder + 1;
  skin.parent.add(fur);
  return fur;
}
// each frame: which way is back along the body (the fur is combed that way), in the world
function furComb(body) { FUR.u.uComb.value.set(0, 0, -1).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion())); }
// each frame, before the cat is drawn: its skin lit as the room lights it (seen from the camera), into texture space,
// then its empty texels filled twice from their neighbours
const _furC = new THREE.Color();
function furLight(renderer, scene, camera) {
  if (!FUR.bake) return;
  camera.matrixWorld.decompose(FUR.cam.position, FUR.cam.quaternion, FUR.cam.scale); FUR.cam.projectionMatrix.copy(camera.projectionMatrix); FUR.cam.updateMatrixWorld(true);
  const cc = renderer.getClearColor(_furC), ca = renderer.getClearAlpha(), ac = renderer.autoClear;
  renderer.autoClear = true; renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(FUR.rt); renderer.render(scene, FUR.cam);
  for (const [a, b] of [[FUR.rt, FUR.rt2], [FUR.rt2, FUR.rt]]) { FUR.dil.material.uniforms.t.value = a.texture; renderer.setRenderTarget(b); FUR.dil.render(renderer); }
  renderer.setRenderTarget(null); renderer.setClearColor(cc, ca); renderer.autoClear = ac;
}

export { FUR, furComb, furCoat, furLight };
