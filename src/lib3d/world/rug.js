import './pouf.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { canvas, ctex, fbm, rng } from '../core/utils.js';

/* ---------------------------------------------------------------- rug
   Ivory hand-tufted wool rug: ~12 mm cut pile on a 4 mm cotton/latex backing, serged edge (yarn overcast round
   the border). Pile = shells (Lengyel, Praun, Finkelstein & Hoppe 2001; NVIDIA "Fur: Shells and Fins"): offset
   copies of the top surface, each one cut against a procedural tuft volume. Tufts sit on a jittered grid
   (≈3.6 mm), bloom open toward the tips, fibres thin out at the very top, so from above you see bright tips over
   dark gaps and at grazing angles more fibre side. One instanced draw, top layer first so early depth rejects
   hidden lower layers; alpha-to-coverage on the MSAA target softens tuft edges. Fibres lower in the pile get less
   light (self-shadow ramp), the pile lay drifts across the rug (shading patches), and the pile is crushed and
   shadowed under the pouf.                                                                                     */
const RUG = { W: 2.35, D: 2.2, pile: 0.012, back: 0.004, layers: 14, tile: 0.12, corner: 0.03, wool: new THREE.Color(0xf3e9d6) };
function tuftTexture(size = 512, seed = 41) {
  const r = rng(seed), n = Math.round(RUG.tile / 0.0042), cell = size / n, tufts = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
    tufts.push({ x: (i + 0.5 + (r() - .5) * 0.8) * cell, y: (j + 0.5 + (r() - .5) * 0.8) * cell, h: 0.8 + r() * 0.2, rad: cell * (0.62 + r() * 0.3), tint: r(), ph: r() * 6.283, ca: Math.cos(r() * 3.1416), sa: 0, asp: 1 + r() * 0.6 });
  for (const t of tufts) t.sa = Math.sqrt(1 - t.ca * t.ca);   // tufts splay unevenly: elliptical, random orientation
  // fibre bundles: tileable value noise at ~1 mm (16 cells across the tile → period-exact)
  const fb = (x, y) => fbm(x / size * 112, y / size * 112, 2, 112, 112);
  const data = new Uint8Array(size * size * 4), dirs = new Uint8Array(size * size * 4), half = size / 2;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const ci = Math.floor(px / cell), cj = Math.floor(py / cell); let hi = 0, lo = 1, tint = 0.5, best = 9, ang = 0, ox = 0, oy = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const t = tufts[((cj + dj + n) % n) * n + ((ci + di + n) % n)];
      let dx = px - t.x, dy = py - t.y; if (dx > half) dx -= size; else if (dx < -half) dx += size; if (dy > half) dy -= size; else if (dy < -half) dy += size;
      const ex = dx * t.ca + dy * t.sa, ey = (-dx * t.sa + dy * t.ca) * t.asp, d = Math.hypot(ex, ey) / t.rad; if (d >= 1.25) continue;
      // the tuft blooms: fibres reach radius d only above height (d − 0.5)/0.75 of the tuft; the crown is domed
      const a = Math.max(0, (d - 0.5) / 0.75) * t.h, b = t.h * (1 - 0.28 * d * d);
      if (b > a) { hi = Math.max(hi, b); lo = Math.min(lo, a); }
      if (b > a && b >= hi - 1e-6) { ox = dx / t.rad; oy = dy / t.rad; }      // crown that is on top here
      if (d < best) { best = d; tint = t.tint; ang = Math.atan2(dy, dx) + t.ph; }
    }
    // fibres radiate from the tuft centre: streaks along the radius, broken up by the bundle noise
    const streak = 0.5 + 0.5 * Math.sin(ang * 9 + fb(px, py) * 7);
    const o = (py * size + px) * 4; data[o] = hi * 255; data[o + 1] = (hi > 0 ? lo : 1) * 255; data[o + 2] = (0.35 * streak + 0.65 * fb(px * 2.3 + 17, py * 2.3 + 5)) * 255; data[o + 3] = tint * 255;
    dirs[o] = (0.5 + 0.4 * Math.max(-1.25, Math.min(1.25, ox))) * 255; dirs[o + 1] = (0.5 + 0.4 * Math.max(-1.25, Math.min(1.25, oy))) * 255; dirs[o + 2] = 0; dirs[o + 3] = 255;
  }
  const mk = (d) => { const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true; return t; };
  return { vol: mk(data), dir: mk(dirs) };
}
function rugUndulation(x, z) {   // a rug never lies quite flat: soft waves (±2 mm) and slightly lifted corners
  const w = (fbm(x * 1.4 + 3.1, z * 1.4 + 7.7, 3) - 0.5) * 0.004;
  const ex = Math.max(0, Math.abs(x) / (RUG.W / 2) - 0.86) / 0.14, ez = Math.max(0, Math.abs(z) / (RUG.D / 2) - 0.86) / 0.14;
  return w + 0.004 * Math.pow(Math.min(1, ex) * Math.min(1, ez), 1.5);
}
function buildRug(parent, pouf) {
  const g = new THREE.Group(); g.position.set(0.3, 0, -3.75); g.rotation.y = -0.07; parent.add(g); g.updateMatrixWorld(true); pouf.updateMatrixWorld(true);
  const W = RUG.W, D = RUG.D, rc = RUG.corner, nx = 120, nz = 112;
  // ---- top grid (rug-local metres), rounded corners, undulation, pile crush + contact shadow from the pouf
  const top = new THREE.PlaneGeometry(W, D, nx, nz); top.rotateX(-Math.PI / 2);
  const P = top.attributes.position, nv = P.count, crush = new Float32Array(nv), occl = new Float32Array(nv), shade = new Float32Array(nv);
  // pouf in its own frame: plan superellipse (half sizes 0.7 × 0.61, n 4.4), flat top 0.5 m, steep sides
  const poufR = (x, z) => Math.pow(Math.pow(Math.abs(x) / 0.7, 4.4) + Math.pow(Math.abs(z) / 0.61, 4.4), 1 / 4.4);
  const poufH = (x, z) => { const q = poufR(x, z); return q >= 1 ? 0 : 0.5 * Math.pow(1 - Math.pow(q, 6), 0.3); };
  // directions toward the glass, in the pouf's frame (rotate by −pouf yaw): left wall −x, back wall −z; tan(elevation), weight
  const pr = pouf.rotation.y, rot = (x, z) => [x * Math.cos(pr) - z * Math.sin(pr), x * Math.sin(pr) + z * Math.cos(pr)];   // inverse of three's Y rotation
  const WIN_DIRS = [[...rot(-0.97, -0.24), Math.tan(0.42), 0.55], [...rot(-0.3, -0.95), Math.tan(0.55), 0.35]];
  const toPouf = new THREE.Matrix4().copy(pouf.matrixWorld).invert().multiply(g.matrixWorld), v = new THREE.Vector3();
  for (let i = 0; i < nv; i++) {
    let x = P.getX(i), z = P.getZ(i);
    const cx = Math.sign(x) * (W / 2 - rc), cz = Math.sign(z) * (D / 2 - rc);
    if (Math.abs(x) > W / 2 - rc && Math.abs(z) > D / 2 - rc) { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz); if (l > rc) { x = cx + dx / l * rc; z = cz + dz / l * rc; } }
    P.setXYZ(i, x, rugUndulation(x, z), z);
    v.set(x, 0, z).applyMatrix4(toPouf);
    const rr = poufR(v.x, v.z);
    crush[i] = THREE.MathUtils.lerp(0.32, 1, THREE.MathUtils.smoothstep(rr, 0.5, 0.86));     // pile height scale
    occl[i] = THREE.MathUtils.lerp(0.32, 1, THREE.MathUtils.smoothstep(rr, 0.8, 1.2));      // under the bulge → dark
    // window light is a big area light (RectAreaLight casts no shadow): march toward the left and back glass and
    // test the pouf's silhouette; the penumbra widens with distance like a real area-light shadow
    let sh = 0;
    for (const [dx, dz, el, k] of WIN_DIRS) { let o = 0;
      for (let t = 0.02; t < 1.6; t += 0.025) { const qx = v.x + dx * t, qz = v.z + dz * t, h = poufH(qx, qz); if (h <= 0) continue;
        const w = 0.03 + 0.4 * t; o = Math.max(o, THREE.MathUtils.smoothstep(h - t * el, -w, w)); }
      sh = Math.max(sh, o * k); }
    shade[i] = sh;
  }
  top.setAttribute('aPile', new THREE.BufferAttribute(crush, 1)); top.setAttribute('aAO', new THREE.BufferAttribute(occl, 1)); top.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
  top.computeVertexNormals();
  // ---- backing / pile root: what you see down between the tufts
  const baseMat = new THREE.MeshStandardMaterial({ color: RUG.wool.clone().multiplyScalar(0.42), roughness: 1 });
  baseMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAO; attribute float aShade; varying float vAO;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO * (1.0 - 0.4 * aShade); transformed.y += ' + RUG.back.toFixed(4) + ';');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAO;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vAO;');
  };
  const base = new THREE.Mesh(top, baseMat); base.receiveShadow = true; g.add(base);
  // ---- shells
  const L = RUG.layers, shellGeo = top.clone(), layer = new Float32Array(L);
  for (let k = 0; k < L; k++) layer[k] = (L - k) / L;                  // instance 0 = top layer (drawn first)
  shellGeo.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layer, 1));
  const tuft = tuftTexture();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  shellMat.alphaToCoverage = true;
  shellMat.onBeforeCompile = sh => {
    sh.uniforms.uTuft = { value: tuft.vol }; sh.uniforms.uTuftN = { value: tuft.dir }; sh.uniforms.uWool = { value: RUG.wool };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float aLayer; attribute float aPile; attribute float aAO; attribute float aShade;
      varying float vL; varying float vAO; varying vec2 vRug; varying float vShade; varying vec2 vView;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vL = aLayer; vAO = aAO; vRug = position.xz; vShade = aShade;
      vView = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xz - position.xz;   // toward the eye, rug frame
      transformed.y += ${RUG.back.toFixed(4)} + aLayer * ${RUG.pile.toFixed(4)} * aPile;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uTuft, uTuftN; uniform vec3 uWool;
      varying float vL; varying float vAO; varying vec2 vRug; varying float vShade; varying vec2 vView; vec2 vLeanV, vCrown;
      float rh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float rn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(rh(i), rh(i + vec2(1, 0)), f.x), mix(rh(i + vec2(0, 1)), rh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `
        // pile lay drifts across the rug (broad patches) and tufts clump together (≈5 cm), leaning up to ~1 mm at the tips
        vec2 lean = (vec2(rn(vRug * 1.3 + 4.1), rn(vRug * 1.3 + 9.7)) - 0.5) + 0.7 * (vec2(rn(vRug * 19.0 + 2.3), rn(vRug * 19.0 + 6.1)) - 0.5);
        vec2 tuv = vRug / ${RUG.tile.toFixed(4)} - lean * vL * vL * 0.012;
        vec4 tf = texture2D(uTuft, tuv);
        float inside = min(vL - tf.g, tf.r - vL);
        float aa = 0.05 + 1.5 * fwidth(tf.r);
        float cov = smoothstep(-aa, aa, inside);
        // level of detail, judged by the size of a tuft (≈18 texels) on screen: fibre streaks fade first (< ~4 px per
        // tuft), then the cut-outs themselves (< ~2 px per tuft) so distant pile reads as a solid, slightly darker top
        vec2 tpx = fwidth(tuv) * 512.0; float tp = max(tpx.x, tpx.y);
        float tipLod = smoothstep(2.5, 5.0, tp), lod = smoothstep(6.0, 12.0, tp);
        float tip = smoothstep(tf.r - 0.3, tf.r, vL) * 0.75 * (1.0 - tipLod);  // fibres taper and thin out at the tips
        cov *= smoothstep(tip - 0.15, tip + 0.15, tf.b);
        cov = mix(cov, smoothstep(0.05, -0.05, vL - 0.84), lod);
        diffuseColor.a = cov;
        float shade = mix(0.38, 1.0, pow(vL, 1.1)) * mix(1.0, 0.9, lod);    // fibre self-shadow toward the backing
        vCrown = (texture2D(uTuftN, tuv).rg - 0.5) * 2.5 * (1.0 - lod);   // offset from the crown centre (crown normal)
        float heather = 0.975 + 0.05 * rn(vRug * 2.1 + 1.7) + 0.02 * (rn(vRug * 9.0) - 0.5);
        // pile reversal ('shading'): looking into the leaning tips shows cut ends and shadowed gaps (darker), looking
        // along the lay shows fibre sides (lighter) - patches that shift as you walk around the rug
        heather *= 1.0 - 0.2 * dot(lean, normalize(vView));
        vLeanV = lean;
        diffuseColor.rgb = uWool * (0.9 + 0.18 * tf.a) * shade * heather * vAO * mix(vec3(1.0), vec3(0.55, 0.62, 0.71), vShade) * mix(vec3(0.9, 0.95, 1.04), vec3(1.0), vAO);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(vLeanV.x * 0.45 + vCrown.x * 0.9, 0.0, vLeanV.y * 0.45 + vCrown.y * 0.9, 0.0)).xyz * vL);`);
  };
  const shells = new THREE.InstancedMesh(shellGeo, shellMat, L); shells.frustumCulled = false; shells.receiveShadow = true;
  for (let k = 0; k < L; k++) shells.setMatrixAt(k, new THREE.Matrix4()); g.add(shells);
  // ---- serged edge: yarn overcast round the border (diagonal wraps ≈ every 4.5 mm)
  const path = []; const seg = 10;
  for (const [sx, sz, a0] of [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI * 1.5]]) {
    const cx = sx * (W / 2 - rc), cz = sz * (D / 2 - rc);
    for (let k = 0; k <= seg; k++) { const a = a0 + k / seg * Math.PI / 2, x = cx + Math.cos(a) * rc, z = cz + Math.sin(a) * rc; path.push(new THREE.Vector3(x, 0, z)); }
  }
  // densify the straight runs so the tube follows the undulation
  const pts = []; for (let i = 0; i < path.length; i++) { const a = path[i], b = path[(i + 1) % path.length], n2 = Math.max(1, Math.ceil(a.distanceTo(b) / 0.04));
    for (let k = 0; k < n2; k++) { const q = a.clone().lerp(b, k / n2); q.y = 0.0082 + rugUndulation(q.x, q.z); pts.push(q); } }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal'), per = curve.getLength();
  const wc = canvas(64, 32), wg = wc.getContext('2d'), wd = wg.createImageData(64, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) { const s = (x / 64 + y / 32 * 0.35) % 1, ridge = Math.pow(Math.sin(Math.PI * s), 0.6), o = (y * 64 + x) * 4; const c = 150 + ridge * 105; wd.data[o] = wd.data[o + 1] = wd.data[o + 2] = c; wd.data[o + 3] = 255; }
  wg.putImageData(wd, 0, 0); const wrap = ctex(wc, { srgb: false }); wrap.repeat.set(per / 0.0045, 1);
  const bindMat = new THREE.MeshStandardMaterial({ color: RUG.wool.clone().multiplyScalar(0.93), roughness: 1, bumpMap: wrap, bumpScale: 1.2 });
  const bind = new THREE.Mesh(new THREE.TubeGeometry(curve, 900, 0.0084, 10, true), bindMat); bind.castShadow = bind.receiveShadow = true; g.add(bind);
  // ---- soft contact shadow on the floor along the border
  { const m = 0.07, cw = 256, ch = Math.round(256 * (D + 2 * m) / (W + 2 * m)), c2 = canvas(cw, ch), x2 = c2.getContext('2d'), id = x2.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const px = (x + 0.5) / cw * (W + 2 * m) - (W / 2 + m), pz = (y + 0.5) / ch * (D + 2 * m) - (D / 2 + m);
      const qx = Math.abs(px) - (W / 2 - rc), qz = Math.abs(pz) - (D / 2 - rc), sd = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rc;
      const a = sd < 0 ? 0.5 : 0.5 * Math.pow(1 - Math.min(1, sd / m), 2.2), o = (y * cw + x) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = 0; id.data[o + 3] = a * 255; }
    x2.putImageData(id, 0, 0); const st = ctex(c2, { rep: false });
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(W + 2 * m, D + 2 * m), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    dec.rotation.x = -Math.PI / 2; dec.position.y = 0.0006; dec.renderOrder = -1; g.add(dec); }
  g.userData = { shells, base, bind, tuft: tuft.vol };
  return g;
}

export { buildRug };
