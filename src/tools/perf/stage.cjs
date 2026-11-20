// gaps between the stages of a first visit: node stage.cjs URL
const { chromium } = require(process.env.PLAYWRIGHT); const { execSync } = require('child_process'), fs = require('fs');
const C = execSync('getconf DARWIN_USER_CACHE_DIR').toString().trim() + 'com.google.chrome.for.testing.helper/com.apple.metal';
(async () => {
  fs.rmSync(C, { recursive: true, force: true });
  const b = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await p.addInitScript(salt => { const P = WebGL2RenderingContext.prototype, ss = P.shaderSource;
    P.shaderSource = function (sh, src) { const i = src.lastIndexOf('}'); if (i > 0 && /void\s+main/.test(src) && /(pc_fragColor|gl_FragColor)/.test(src) && !/gl_Position/.test(src)) src = src.slice(0, i) + ' ' + (/pc_fragColor/.test(src) ? 'pc_fragColor' : 'gl_FragColor') + '.x += ' + salt + '; }' + src.slice(i + 1); return ss.call(this, sh, src); }; }, (1e-7 * (1 + Math.random())).toExponential(6));
  await p.addInitScript(() => { window.__sync = []; const P = WebGL2RenderingContext.prototype, g = P.getProgramParameter;
    P.getProgramParameter = function (pr, n) { if (n !== 0x8B86) return g.call(this, pr, n); const t = performance.now(), out = g.call(this, pr, n), d = performance.now() - t; if (d > 25) window.__sync.push([Math.round(t), '      wait ' + Math.round(d) + ' ' + new Error().stack.split('\n').slice(2, 40).map(x => (/at (?:async )?([\w.$<>]+)/.exec(x) || [0, '?'])[1]).filter(x => /^(draw|prime|know|precompile|start|show|warm|loop|step|compile|build|ahead|crisp)/i.test(x)).join('<')]); return out; }; });
  await p.addInitScript(() => { window.__gaps = []; let last = 0; const f = t => { if (last && t - last > 60) window.__gaps.push([Math.round(last), Math.round(t - last)]); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await p.addInitScript(() => { window.__pn = []; let n = -1; let sigWas = ''; setInterval(() => { const L = window.__lib3d; if (!L) return; let sig = ''; L.scene.traverse(o => { if (!o.isLight) return; let v = o.visible; for (let q = o.parent; v && q; q = q.parent) v = q.visible; sig += o.type.replace('Light', '').slice(0, 4) + (v ? '+' : '-') + (o.castShadow ? 's' : '') + (o.layers.isEnabled(0) ? '' : '!0') + ' '; }); if (sig !== sigWas) { window.__pn.push([Math.round(performance.now()), 'LIGHTS ' + sig]); sigWas = sig; } const k = L.renderer.info.programs.length; if (k !== n) { const P = L.renderer.info.programs; window.__pn.push([Math.round(performance.now()), 'programs ' + k + ': ' + P.slice(Math.max(0, n)).map(p => (p.name || p.type || '?') + '/' + (p.cacheKey || '').length).join(' ').slice(0, 400)]); n = k; } }, 40); });
  if (process.env.HAND) { let k = 0; const iv = setInterval(() => { p.mouse.move(500 + 200 * Math.sin(k / 5), 420 + 80 * Math.cos(k / 7)).catch(() => {}); k++; }, 200); p.on('close', () => clearInterval(iv)); }
  await p.goto(process.argv[2], { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => performance.getEntriesByName('l3-reveal3').length, null, { timeout: 180000, polling: 100 }); await p.waitForTimeout(+(process.env.AFTER || 2200));
  const r = await p.evaluate(() => ({ marks: performance.getEntriesByType('mark').filter(e => /^l3-(show|reveal|models|pets|displays|TEST|first)/.test(e.name)).map(e => [e.name.slice(3), Math.round(e.startTime)]), gaps: window.__gaps, pn: [...window.__pn, ...window.__sync], slow: __lib3d.WARM.slow, late: __lib3d.WARM.late.length }));
  const ev = [...r.marks.map(m => [m[1], m[0]]), ...r.gaps.filter(g => g[1] >= 100).map(g => [g[0], '   gap ' + g[1]]), ...r.pn.map(x => [x[0], '      ' + x[1]])].sort((a, b) => a[0] - b[0]);
  console.log(ev.map(e => String(e[0]).padStart(6) + ' ' + e[1]).join('\n')); console.log('slow', JSON.stringify(r.slow), 'late', r.late);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
