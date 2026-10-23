// memory, A against B: each build folder served here on its own port, opened in a fresh browser, and only that
// browser's processes counted (other sessions' Playwright browsers left out); GL allocations from the WebGL hook
// usage: node memab.cjs DIR_A DIR_B [runs] (1512 x 945, DPR 2, 13:00)
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
const { execSync } = require('child_process'), http = require('http'), fs = require('fs'), path = require('path');
const DIRS = process.argv.slice(2).filter(a => !/^\d+$/.test(a)), RUNS = +(process.argv.slice(2).find(a => /^\d+$/.test(a)) || 2);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const serve = dir => new Promise(ok => { const s = http.createServer((q, r) => { const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); }); s.listen(0, '127.0.0.1', () => ok(s)); });
const pwPids = () => { try { return execSync("ps -axo pid,command | grep -i 'ms-playwright' | grep -v grep").toString().split('\n').filter(Boolean).map(l => { const m = l.trim().match(/^(\d+)\s+(.*)$/); return [m[1], (m[2].match(/--type=([a-z-]+)/) || [, 'browser'])[1]]; }); } catch (e) { return []; } };
const HOOK = () => {
  const BPP = { 0x8058: 4, 0x8C43: 4, 0x1908: 4, 0x8051: 3, 0x1907: 3, 0x881A: 8, 0x8814: 16, 0x822F: 4, 0x8230: 8, 0x822D: 2, 0x822E: 4, 0x8229: 1, 0x822B: 2, 0x1909: 1, 0x190A: 2, 0x81A5: 2, 0x81A6: 3, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x8C3A: 4, 0x8D62: 2, 0x8D7C: 4, 0x881B: 6, 0x8815: 12, 0x8C40: 3, 0x8C41: 3 };
  const T = window.__glmem = { tex: new Map(), buf: new Map(), rb: new Map(), cur: new WeakMap() };
  const who = () => (new Error().stack || '').split('\n').filter(l => /lib3d|index|three\.module/.test(l)).map(l => (l.match(/at (\S+)/) || [, '?'])[1]).filter(n => !/^(Object\.|P\.|HTMLCanvas|WebGL2|setTexture|uploadTexture|texStorage|texImage|bufferData|renderbufferStorage)/.test(n)).slice(0, 4).join(' < ');
  const P = WebGL2RenderingContext.prototype, bound = new WeakMap(); let id = 0;
  const key = o => { if (!o.__mid) o.__mid = ++id; return o.__mid; };
  const wrap = (n, f) => { const o = P[n]; P[n] = function (...a) { f.call(this, ...a); return o.apply(this, a); }; };
  const st = (gl) => { let s = bound.get(gl); if (!s) bound.set(gl, s = {}); return s; };
  wrap('bindTexture', function (t, x) { st(this)['t' + t] = x; });
  wrap('bindBuffer', function (t, x) { st(this)['b' + t] = x; });
  wrap('bindRenderbuffer', function (t, x) { st(this).rb = x; });
  const texOf = (gl, target) => st(gl)['t' + (target >= 0x8515 && target <= 0x851A ? 0x8513 : target)];
  wrap('texStorage2D', function (target, levels, fmt, w, h) { const t = texOf(this, target); if (!t) return; let b = 0; for (let l = 0, a = w, c = h; l < levels; l++) { b += a * c * (BPP[fmt] || 4); a = Math.max(1, a >> 1); c = Math.max(1, c >> 1); } T.tex.set(key(t), { w, h, d: 1, fmt, levels, bytes: b * (target === 0x8513 ? 6 : 1), by: b > 2e6 ? who() : '' }); });
  wrap('texStorage3D', function (target, levels, fmt, w, h, d) { const t = texOf(this, target); if (!t) return; let b = 0; for (let l = 0, a = w, c = h; l < levels; l++) { b += a * c * d * (BPP[fmt] || 4); a = Math.max(1, a >> 1); c = Math.max(1, c >> 1); } T.tex.set(key(t), { w, h, d, fmt, levels, bytes: b }); });
  wrap('texImage2D', function (target, level, fmt, ...r) { if (level !== 0) return; const t = texOf(this, target); if (!t) return; let w, h; if (typeof r[0] === 'number' && r.length >= 5) { w = r[0]; h = r[1]; } else { const src = r[r.length - 1]; w = src.videoWidth || src.naturalWidth || src.width || src.displayWidth; h = src.videoHeight || src.naturalHeight || src.height || src.displayHeight; }
    const k = key(t), cube = target >= 0x8515 && target <= 0x851A, prev = T.tex.get(k); const bytes = w * h * (BPP[fmt] || 4) * 1.33 * (cube ? 6 : 1); if (!prev || prev.w !== w || !cube) T.tex.set(k, { w, h, d: 1, fmt, levels: 'img', bytes, by: bytes > 2e6 ? who() : '' }); });
  wrap('deleteTexture', function (t) { if (t) T.tex.delete(key(t)); });
  wrap('bufferData', function (target, a) { const b = st(this)['b' + target]; if (!b) return; T.buf.set(key(b), typeof a === 'number' ? a : a.byteLength); });
  wrap('deleteBuffer', function (b) { if (b) T.buf.delete(key(b)); });
  wrap('renderbufferStorage', function (t, fmt, w, h) { const r = st(this).rb; if (r) T.rb.set(key(r), { w, h, s: 1, fmt, bytes: w * h * (BPP[fmt] || 4), by: who() }); });
  wrap('renderbufferStorageMultisample', function (t, s, fmt, w, h) { const r = st(this).rb; if (r) T.rb.set(key(r), { w, h, s, fmt, bytes: w * h * s * (BPP[fmt] || 4), by: who() }); });
  wrap('deleteRenderbuffer', function (r) { if (r) T.rb.delete(key(r)); });
};

async function measure(dir) {
  const srv = await serve(dir), url = 'http://127.0.0.1:' + srv.address().port + '/', before = new Set(pwPids().map(p => p[0]));
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2, timezoneId: 'Australia/Sydney' }); await ctx.addInitScript(HOOK);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(url + '?at=13:00', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__lib3d && performance.getEntriesByName('l3-precompiled').length, null, { timeout: 120000, polling: 200 });
  await page.waitForTimeout(9000); await page.evaluate(() => { if (window.gc) { gc(); gc(); } }); await page.waitForTimeout(2000);
  const r = await page.evaluate(() => { const T = window.__glmem, MB = b => +(b / 1048576).toFixed(1), sum = m => [...m.values()].reduce((s, v) => s + (typeof v === 'number' ? v : v.bytes), 0);
    return { texMB: MB(sum(T.tex)), rbMB: MB(sum(T.rb)), bufMB: MB(sum(T.buf)), heapMB: MB(performance.memory.usedJSHeapSize) }; });
  const fp = {}; for (const [pid, t] of pwPids().filter(p => !before.has(p[0]))) { try { const o = execSync('footprint ' + pid + ' 2>/dev/null').toString(); const m = o.match(/Footprint:\s+([\d.]+)\s+(MB|GB|KB)/); if (m) fp[t] = (fp[t] || 0) + (+m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1); } catch (e) {} }
  await browser.close(); srv.close();
  return { ...r, gpu: Math.round(fp['gpu-process'] || 0), renderer: Math.round(fp.renderer || 0), errs: errs.length };
}
(async () => {
  const res = {}; for (let k = 0; k < RUNS; k++) for (const d of DIRS) { const m = await measure(d); (res[d] ||= []).push(m); console.log(path.basename(d), JSON.stringify(m)); }
  for (const d of DIRS) { const a = res[d], avg = f => Math.round(a.reduce((s, m) => s + m[f], 0) / a.length * 10) / 10; console.log('mean', path.basename(d), 'tex', avg('texMB'), 'rb', avg('rbMB'), 'gpu', avg('gpu'), 'renderer', avg('renderer')); }
})();
