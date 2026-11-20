// Side by side: the GLB tree (left) and the one built in code (right), same lights and the page's own leaf shader.
window.__compareTrees = async (P = {}, tag = 'cmp', kinds = 'ABC') => {
  const L = window.__lib3d, THREE = L.THREE;
  const rng = seed => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const t0 = performance.now(); const GEN = window.makeTrees(THREE, rng, P); const genMs = Math.round(performance.now() - t0);
  const outside = L.scene.children.find(o => o.isGroup && o.children.some(c => c.isMesh && c.geometry && c.geometry.parameters && c.geometry.parameters.radius === 300));
  const ims = outside.children.filter(c => c.isInstancedMesh && c.count < 60);
  const kind = n => /^Material\.002$|^ascht$/.test(n) ? 'A' : /trunk_Mat|leafes_Mat/.test(n) ? 'B' : 'C';
  const orig = { A: [], B: [], C: [] }, seen = new Set();
  for (const im of ims) { const key = im.material.name + ':' + im.geometry.attributes.position.count; if (seen.has(key)) continue; seen.add(key); const k = kind(im.material.name); orig[k].push(im); }
  // full-detail parts only (the far copies use lodLeaves geometry with fewer cards: keep the largest per material+size)
  const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 600;
  const R = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
  R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 0.9; R.setScissorTest(true);
  const stats = { genMs };
  for (const k of kinds) {
    const sc = new THREE.Scene(); sc.background = new THREE.Color(0xdfe6ea);
    sc.add(new THREE.HemisphereLight(0xeef3e4, 0x8a6a48, 1.4)); const sun = new THREE.DirectionalLight(0xfff0d6, 2.6); sun.position.set(-8, 10, 6); sc.add(sun);
    const left = new THREE.Group(), right = new THREE.Group(); sc.add(left, right);
    const m4 = new THREE.Matrix4(), s = new THREE.Vector3(), q = new THREE.Quaternion(), p = new THREE.Vector3();
    const parts = orig[k].filter((im, i, arr) => !arr.some(o => o !== im && o.material === im.material && o.geometry.index.count > im.geometry.index.count && o.geometry.attributes.position.count !== im.geometry.attributes.position.count && false));
    // keep the biggest geometry per (material, vertex count) and drop LOD copies (fewer cards than another with the same material)
    const byMat = new Map(); for (const im of orig[k]) { const arr = byMat.get(im.material.uuid) || []; arr.push(im); byMat.set(im.material.uuid, arr); }
    let leafOBC = null, barkOBC = null;
    for (const arr of byMat.values()) {
      const maxIdx = Math.max(...arr.map(im => im.geometry.index.count));
      for (const im of arr) {
        if (im.material.alphaTest > 0 && im.geometry.index.count < maxIdx && im.geometry.attributes.position.count === arr.find(a => a.geometry.index.count === maxIdx).geometry.attributes.position.count) continue;   // lod copy
        im.getMatrixAt(0, m4); m4.decompose(p, q, s);
        const mesh = new THREE.Mesh(im.geometry, im.material); mesh.scale.copy(s); left.add(mesh);
        if (im.material.alphaTest > 0) leafOBC = im.material.onBeforeCompile; else barkOBC = im.material.onBeforeCompile;
      }
    }
    // the generated tree at the same instance scale (p.s of instance 0 relative to the GLB's base scale)
    const baseScale = { A: 0.82, B: 20.7 / 0.9, C: 0.024 }[k];
    let inst = s.x / baseScale; if (k === 'B') inst = 0.9;
    for (const part of GEN[k].parts) {
      part.material.onBeforeCompile = part.leaf ? leafOBC : barkOBC; part.material.fog = false;
      const mesh = new THREE.Mesh(part.geometry, part.material); mesh.scale.setScalar(inst); right.add(mesh);
    }
    const bl = new THREE.Box3().setFromObject(left), br = new THREE.Box3().setFromObject(right);
    stats[k] = { genStats: GEN[k].stats, orig: bl.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)), gen: br.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)), genTris: GEN[k].parts.map(pp => (pp.leaf ? 'leaf ' : 'bark ') + pp.geometry.index.count / 3).join(', '), origTris: left.children.map(m => m.geometry.index.count / 3).reduce((a, b) => a + b, 0) };
    const size = bl.getSize(new THREE.Vector3()), ctr = bl.getCenter(new THREE.Vector3()), half = Math.max(size.x, size.y, size.z) * 0.58;
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 500);
    const shot = async (name, dir, persp = false) => {
      for (const [g, x0] of [[left, 0], [right, 600]]) {
        left.visible = g === left; right.visible = g === right;
        R.setViewport(x0, 0, 600, 600); R.setScissor(x0, 0, 600, 600);
        if (persp) { const pc = new THREE.PerspectiveCamera(40, 1, 0.1, 500); pc.position.copy(ctr).add(new THREE.Vector3(0, -size.y * 0.25, size.y * 1.15)); pc.lookAt(ctr); R.render(sc, pc); }
        else { cam.position.copy(ctr).add(new THREE.Vector3(...dir).multiplyScalar(100)); cam.up.set(0, 1, 0); if (dir[1] === 1) cam.up.set(0, 0, -1); cam.lookAt(ctr); R.render(sc, cam); }
      }
      left.visible = right.visible = true;
      await fetch('/upload', { method: 'POST', body: JSON.stringify({ name: tag + '_' + k + '_' + name + '.png', data: cv.toDataURL('image/png') }) });
    };
    await shot('front', [0, 0, 1]); await shot('side', [1, 0, 0]); await shot('top', [0, 1, 0]); await shot('persp', null, true);
    for (const g of [left, right]) g.children.forEach(m => { m.visible = m.material.alphaTest > 0; });
    await shot('leaves', [0, 0, 1]);
    for (const g of [left, right]) g.children.forEach(m => { m.visible = !(m.material.alphaTest > 0); });
    await shot('skeleton', [0, 0, 1]);
  }
  R.dispose();
  return stats;
};
// alpha coverage (alpha > 0.45) of the generated leaf textures, per atlas cell
window.__texCover = () => {
  const L = window.__lib3d, THREE = L.THREE;
  const rng = seed => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const G = window.makeTrees(THREE, rng), out = {};
  for (const k of 'ABC') { const img = G[k].parts.find(p => p.leaf).material.map.image, c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
    const cells = k === 'A' ? [[0, 0, .5, 1], [.5, 0, 1, 1]] : k === 'B' ? [[0, 0, .5, .5], [.5, 0, 1, .5], [0, .5, .5, 1], [.5, .5, 1, 1]] : [[0, 0, .5, 1], [.5, 0, 1, 1]];
    out[k] = cells.map(([x0, y0, x1, y1]) => { let n = 0, m = 0; for (let y = Math.floor(y0 * c.height); y < y1 * c.height; y++) for (let x = Math.floor(x0 * c.width); x < x1 * c.width; x++) { m++; if (d[(y * c.width + x) * 4 + 3] > 115) n++; } return +(n / m).toFixed(3); }); }
  return out;
};
