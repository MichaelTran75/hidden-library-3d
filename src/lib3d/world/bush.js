import './furniture.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { canvas, halfCanvas, rng } from '../core/utils.js';
import { WIND } from './wind.js';

/* ---------------------------------------------------------------- bushes
   The shrubs past the glass, drawn the way stylized games draw a bush ("fluffy" foliage, as in Breath of the Wild or
   Genshin Impact; Minions Art's write-ups of the technique): a cloud of cards around an ellipsoid, each a cluster of
   a few big leaves on a twig, turned to face the viewer (so none is seen edge on) with its twig pointing out from the
   bush's middle. The cards are not lit by their own facing but by the bush's roundness (each card's normal is the
   way out from the bush's centre), so a bush shades as one soft volume, lit on top and on the sun's side, in shade
   below, its inner cards darker: the way a watercolourist paints a bush as one wash with a few leaves at its edge.
   The leaves are big enough (~10–20 px on the screen) for the watercolour pass to paint them as leaves; the old cards
   (sprigs of tiny ash leaflets) came out of it as noise, outlined blocks and holes. Their edges: alpha to coverage
   (the scene is drawn with 4× MSAA), the alpha sharpened by its own screen derivative (three.js) and kept from thinning
   out in the smaller mip levels (Ben Golus, "Anti-aliased Alpha Test: The Esoteric Alpha To Coverage", 2017), and the
   empty texels given a green, not black, so the far leaves are not fringed dark. One draw for all the bushes, and
   one more for the soft shade each casts round its foot (a blob shadow, as games ground their foliage).          */
const BUSH = { N: 1024, mat: null };
// the leaf clusters: four kinds on one atlas (2 × 2 cells of 512 px), each a twig up from the bottom of its cell with
// eight to eleven leaves along it, the low ones out sideways, the top ones up; in the garden's greens (the trees'
// tones), each leaf darker at its foot, the pigment gathered at its rim, a pale midrib
function bushAtlas() {
  const S = BUSH.N / 2, c = canvas(BUSH.N, BUSH.N), g = c.getContext('2d'), r = rng(20261015);
  const TONES = [[58, 84, 40], [80, 112, 50], [104, 140, 62], [138, 166, 82], [166, 182, 96]];
  const rgb = (a, b, d) => `rgb(${Math.min(255, a) | 0},${Math.min(255, b) | 0},${Math.min(255, d) | 0})`;
  const leaf = (x, y, a, L, W, [R, G, B]) => {   // from (x, y) toward angle a (0 = up), L long, W half-wide
    g.save(); g.translate(x, y); g.rotate(a);
    const p = new Path2D(); p.moveTo(0, 0); p.bezierCurveTo(W * 1.15, -L * 0.18, W * 0.95, -L * 0.72, 0, -L); p.bezierCurveTo(-W * 0.95, -L * 0.72, -W * 1.15, -L * 0.18, 0, 0);
    const k = 0.9 + r() * 0.2, gr = g.createLinearGradient(0, 0, 0, -L);
    gr.addColorStop(0, rgb(R * k * 0.8, G * k * 0.8, B * k * 0.8)); gr.addColorStop(1, rgb(R * k * 1.12, G * k * 1.1, B * k * 1.04));
    g.fillStyle = gr; g.fill(p);
    g.lineWidth = 3.5; g.strokeStyle = `rgba(${R * 0.5 | 0},${G * 0.58 | 0},${B * 0.45 | 0},0.5)`; g.stroke(p);
    g.lineWidth = 2; g.strokeStyle = `rgba(${Math.min(255, R * 1.6) | 0},${Math.min(255, G * 1.45) | 0},${Math.min(255, B * 1.3) | 0},0.3)`;
    g.beginPath(); g.moveTo(0, -L * 0.04); g.quadraticCurveTo(W * 0.15, -L * 0.5, 0, -L * 0.86); g.stroke();
    g.restore();
  };
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * S, oy = Math.floor(v / 2) * S, bx = ox + S / 2, by = oy + S * 0.97, tx = bx + (r() - 0.5) * S * 0.12, ty = oy + S * 0.4;
    g.strokeStyle = 'rgb(98,106,64)'; g.lineWidth = 5; g.lineCap = 'round';   // (olive: a dark twig seen between the leaves came out of the paint as specks)
    g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + (r() - 0.5) * S * 0.08, (by + ty) / 2, tx, ty); g.stroke();
    const n = 8 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), px = bx + (tx - bx) * (0.2 + 0.8 * t), py = by + (ty - by) * (0.2 + 0.8 * t);
      const a = (i % 2 ? 1 : -1) * (1.3 - 1.0 * t) + (r() - 0.5) * 0.4, L = S * (0.25 + 0.1 * r()) * (1 - 0.3 * t);
      leaf(px, py, a, L, L * (0.27 + 0.07 * r()), TONES[Math.floor(r() * TONES.length)]);
    }
  }
  // as data (a canvas keeps no colour where it is clear): the empty texels made a mid green
  const hc = halfCanvas(halfCanvas(c)), n = hc.width, d = hc.getContext('2d').getImageData(0, 0, n, n).data;   // (at a quarter: utils.js halfCanvas; G, 19/10/2026: "tiếp tục giảm độ nét của toàn bộ cây")
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 0) { d[i] = 80; d[i + 1] = 112; d[i + 2] = 50; }
  const t = new THREE.DataTexture(d, n, n);   // (rows top first: the canvas's top is v = 0)
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
function bushMaterial() {
  const mat = new THREE.MeshStandardMaterial({ map: bushAtlas(), roughness: 0.85, metalness: 0, alphaTest: 0.5, alphaToCoverage: true });
  mat.customProgramCacheKey = () => 'bush';
  mat.onBeforeCompile = sh => {
    sh.uniforms.uWind = WIND.t;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBush; uniform float uWind;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        { float k = floor(aBush.w * 4.0); vec2 q = vec2(fract(aBush.w * 7.31) < 0.5 ? uv.x : 1.0 - uv.x, 1.0 - uv.y);   // its kind of cluster, now and then mirrored
          vMapUv = (q + vec2(mod(k, 2.0), floor(k * 0.5))) * 0.5; }`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        transformedNormal = normalize(normalMatrix * normalize(((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz - aBush.xyz) / vec3(1.0, 0.8, 1.0)));   // the bush's roundness`)
      .replace('#include <project_vertex>', `
        // the card faces the viewer, its twig pointing out from the bush's middle (and a little up), each its own way;
        // the wind rocks it a little about its foot
        vec3 ctr = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float sz = length(instanceMatrix[0].xyz), ph = aBush.w * 6.2832;
        vec4 mvPosition = modelViewMatrix * vec4(ctr, 1.0);
        vec2 o2 = mvPosition.xy - (modelViewMatrix * vec4(aBush.xyz, 1.0)).xy;
        vec2 up = normalize(vec2(0.0, 0.6) + o2 / (length(o2) + 1e-4) + 0.45 * vec2(sin(ph * 3.1), cos(ph * 2.3)));
        float sw = ${(0.4 * WIND.amp).toFixed(4)} * sin(uWind * 1.3 + ph * 5.0) + 0.5 * (fract(aBush.w * 13.7) - 0.5);
        up = vec2(up.x * cos(sw) - up.y * sin(sw), up.x * sin(sw) + up.y * cos(sw));
        mvPosition.xy += (vec2(up.y, -up.x) * position.x + up * (position.y + 0.25)) * sz;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
      { vec2 tc = vMapUv * ${BUSH.N.toFixed(1)}, dx = dFdx(tc), dy = dFdy(tc);   // (Golus: the leaves keep their cover in the smaller mip levels)
        diffuseColor.a *= 1.0 + max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy)))) * 0.25; }
      #include <alphatest_fragment>`);
  };
  return mat;
}
// the bushes ([x, z, size] each, standing on the lawn at y −0.12): their cards, inner and lower ones darker, each
// a touch warmer or cooler; each bush from its own seed, so a bush stays the same whatever else changes
function buildBushes(list) {
  const plan = [];
  for (const [x, z, s] of list) {
    const r = rng(Math.floor(x * 100 + z * 7 + 999)), cy = -0.12 + 0.62 * s, n = Math.round(Math.min(95, Math.max(40, 52 * s * s)));
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, h = Math.sqrt(1 - u * u), f = 0.55 + 0.45 * Math.sqrt(r());   // a direction, and how far out (mostly near the surface)
      const dx = h * Math.cos(a), dy = u, dz = h * Math.sin(a);
      const y = Math.max(-0.05 + r() * 0.1, cy + dy * 0.72 * s * f), shade = (0.62 + 0.38 * THREE.MathUtils.smoothstep(f, 0.55, 1.0)) * (0.78 + 0.22 * THREE.MathUtils.smoothstep(dy, -0.6, 0.6));
      const warm = r() - 0.5, lum = shade * (0.92 + 0.16 * r());
      plan.push([x + dx * 0.95 * s * f, y, z + dz * 0.95 * s * f, (0.39 + 0.18 * r()) * s, x, cy, z, r(), lum * (1 + 0.06 * warm), lum * (1 + 0.03 * warm), lum * (1 - 0.08 * warm)]);
    }
  }
  BUSH.mat ||= bushMaterial();
  const geo = new THREE.PlaneGeometry(1, 1), mesh = new THREE.InstancedMesh(geo, BUSH.mat, plan.length), aB = new Float32Array(plan.length * 4);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  plan.forEach(([px, py, pz, size, bx, by, bz, w, cr, cg, cb], i) => {
    mesh.setMatrixAt(i, m.compose(p.set(px, py, pz), q, sc.setScalar(size))); mesh.setColorAt(i, col.setRGB(cr, cg, cb));
    aB.set([bx, by, bz, w], i * 4);
  });
  geo.setAttribute('aBush', new THREE.InstancedBufferAttribute(aB, 4));
  mesh.frustumCulled = false;   // (the cards are placed in the shader)
  // the shade on the ground round each bush's foot, just above the patio and the lawn
  const sc2 = canvas(128, 128), sg = sc2.getContext('2d'), gr = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#b3b3b3'); gr.addColorStop(1, '#000');   // (an alpha map is read from its green)
  sg.fillStyle = '#000'; sg.fillRect(0, 0, 128, 128); sg.fillStyle = gr; sg.fillRect(0, 0, 128, 128);
  const blob = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x1c2410, alphaMap: new THREE.CanvasTexture(sc2), transparent: true, opacity: 0.42, depthWrite: false }), list.length);
  list.forEach(([x, z, s], i) => blob.setMatrixAt(i, m.compose(p.set(x, -0.092, z), q, sc.set(2.5 * s, 1, 2.5 * s))));
  blob.frustumCulled = false; blob.renderOrder = -1;
  mesh.add(blob);
  return mesh;
}

export { BUSH, buildBushes };
