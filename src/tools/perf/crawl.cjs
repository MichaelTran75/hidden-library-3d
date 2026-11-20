// node crawl.cjs URL OUT : frame time and edge crawl (temporal flicker under a slow pan) for scale x MSAA cases
const { chromium } = require(process.env.PLAYWRIGHT); const fs = require('fs');
const [URL, OUT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 })).newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL + '?at=13:00', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && performance.getEntriesByName('l3-precompiled').length, null, { timeout: 240000, polling: 200 });
  await p.addStyleTag({ content: '.toc, .page, #l3-lines, .l3-label, .l3-cap, .sky, .wx, .lang-switch, .theme-box { display: none !important; }' });
  await p.waitForTimeout(3000);
  for (const [name, scale, samples] of [['A 1.25 msaa2', 1.25, 2], ['B 1.25 none', 1.25, 0], ['C 1.0 msaa2', 1, 2], ['D 1.0 none', 1, 0], ['E 0.8 msaa2', 0.8, 2], ['F 0.8 none', 0.8, 0], ['G 1.25 msaa2', 1.25, 2], ['H 1.25 none', 1.25, 0]]) {
    const r = await p.evaluate(([scale, samples]) => { const L = __lib3d, gl = L.renderer.getContext(), px = new Uint8Array(4), cam = L.camera;
      L.setRtScale(scale); if (L.POST.rt.samples !== samples) { L.POST.rt.samples = samples; L.POST.rt.dispose(); } L.resize();
      const one = () => { L.draw(); L.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      for (let i = 0; i < 8; i++) one(); const ts = []; for (let i = 0; i < 30; i++) { const t = performance.now(); one(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b);
      // a slow pan: the camera a third of a millimetre sideways a frame; a patch of the bookshelf and one of the sofa read each frame
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, boxes = [[0.50, 0.42, 480, 360], [0.56, 0.74, 480, 300]], x0 = cam.position.x, N = 20, fr = boxes.map(() => []);
      for (let k = 0; k < N; k++) { cam.position.x = x0 + k * 0.00035; cam.updateMatrixWorld(true); L.draw(); L.renderer.setRenderTarget(null);
        boxes.forEach(([fx, fy, w, h], j) => { const a = new Uint8Array(w * h * 4); gl.readPixels(Math.round(W * fx - w / 2), Math.round(H * (1 - fy) - h / 2), w, h, gl.RGBA, gl.UNSIGNED_BYTE, a); const l = new Float32Array(w * h); for (let i = 0; i < w * h; i++) l[i] = 0.3 * a[4 * i] + 0.59 * a[4 * i + 1] + 0.11 * a[4 * i + 2]; fr[j].push(l); }); }
      cam.position.x = x0; cam.updateMatrixWorld(true);
      const crawl = fr.map(F => { let s = 0, hot = 0; const n = F[0].length; for (let k = 1; k < N - 1; k++) for (let i = 0; i < n; i++) { const d = Math.abs(F[k + 1][i] - 2 * F[k][i] + F[k - 1][i]); s += d; if (d > 12) hot++; } return [+(s / (n * (N - 2))).toFixed(3), +(1000 * hot / (n * (N - 2))).toFixed(2)]; });
      return { ms: +ts[15].toFixed(1), rt: L.POST.rt.width + 'x' + L.POST.rt.height, crawl }; }, [scale, samples]);
    console.log(name.padEnd(14), JSON.stringify(r));
    await p.screenshot({ path: OUT + name[0] + '.png', clip: { x: 500, y: 250, width: 520, height: 420 } });
  }
  console.log(errs.length ? errs.slice(0, 3) : 'no errors'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
