// PLAYWRIGHT=<its folder> CHROME=<a full Chrome for Testing binary> node cold.cjs URL [runs]
// A first visit: start-up marks, long tasks, the shaders first made while a picture was drawn (WARM.late), the pictures
// that held the page's thread (WARM.slow) and each shader's first use that waited on the GPU. A first visit is forced two
// ways: the test browser's Metal shader cache folder emptied (macOS; a full Chrome keeps one of its own, the headless shell
// shares the system's), and every fragment shader made a little different from any compiled before. WARM=1: neither.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { execSync } = require('child_process'), fs = require('fs');
const [URL, RUNS = 2] = process.argv.slice(2);
const C = execSync('getconf DARWIN_USER_CACHE_DIR').toString().trim() + 'com.google.chrome.for.testing.helper/com.apple.metal';
(async () => {
  for (let run = 0; run < +RUNS; run++) {
    if (!process.env.WARM) fs.rmSync(C, { recursive: true, force: true });
    const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
    const page = await (await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2, timezoneId: 'Australia/Sydney' })).newPage();
    // every fragment shader a little different from any made before (a constant no eye sees added to its colour): the system
    // keeps compiled shaders beyond the cache folder emptied above, and a run after another was not a first visit
    if (!process.env.WARM) await page.addInitScript(salt => { const P = WebGL2RenderingContext.prototype, ss = P.shaderSource;
      P.shaderSource = function (sh, src) { const i = src.lastIndexOf('}'); if (i > 0 && /void\s+main/.test(src) && /(pc_fragColor|gl_FragColor)/.test(src) && !/gl_Position/.test(src)) src = src.slice(0, i) + ' ' + (/pc_fragColor/.test(src) ? 'pc_fragColor' : 'gl_FragColor') + '.x += ' + salt + '; }' + src.slice(i + 1); return ss.call(this, sh, src); }; }, (1e-9 * (1 + Math.floor(Math.random() * 1e6))).toExponential(8));
    await page.addInitScript(() => { window.__sync = []; const P = WebGL2RenderingContext.prototype, g = P.getProgramParameter;
      P.getProgramParameter = function (p, n) { if (n !== 0x8B86) return g.call(this, p, n); const t = performance.now(), out = g.call(this, p, n), d = performance.now() - t;
        if (d > 25) window.__sync.push(Math.round(t) + '+' + Math.round(d) + ' ' + new Error().stack.split('\n').slice(2, 30).map(x => (/at (?:async )?([\w.$<>]+)/.exec(x) || [0, '?'])[1]).filter(x => !/^(WebGL|new|on|render|set|project|\?|r$|Object|FullScreenQuad)/.test(x) || /^(draw|prime|know|precompile|start|show)/.test(x)).slice(0, 4).join('<')); return out; }; });
    await page.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); });
    await page.addInitScript(() => { window.__gaps = []; let last = 0; const f = t => { if (last && t - last > 60) window.__gaps.push([Math.round(last), Math.round(t - last)]); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => performance.getEntriesByName('l3-reveal3').length, null, { timeout: 180000, polling: 100 });
    // a hand on the mouse from the moment the words are in: a small move every 250 ms (MOVE=0: none)
    let moving = process.env.MOVE !== '0', mk = 0; const mT = Date.now() + 1000 * +(process.env.MOVE_S || 25); (async () => { while (moving && Date.now() < mT) { await page.mouse.move(500 + 200 * Math.sin(mk / 5), 420 + 80 * Math.cos(mk / 7)).catch(() => {}); mk++; await new Promise(r => setTimeout(r, 250)); } })();
    await page.waitForFunction(() => performance.getEntriesByName('l3-precompiled').length, null, { timeout: 400000, polling: 100 }); moving = false;
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => { const m = {}; for (const e of performance.getEntriesByType('mark')) if (/^l3-/.test(e.name)) m[e.name.slice(3)] = Math.round(e.startTime);
      const fd = m['first-draw']; return { m, fd, lt: window.__lt.filter(x => x[1] > 120), after: window.__lt.filter(x => x[0] + x[1] > fd).reduce((s, x) => s + Math.max(0, x[1] - 50), 0), worst: Math.max(0, ...window.__lt.filter(x => x[0] + x[1] > fd).map(x => x[1])), progs: window.__lib3d ? __lib3d.renderer.info.programs.length : 0, late: window.__lib3d && __lib3d.WARM ? __lib3d.WARM.late : null, slow: window.__lib3d && __lib3d.WARM ? __lib3d.WARM.slow : null, sync: window.__sync, err: window.__lib3d && __lib3d.WARM && __lib3d.WARM.err }; });
    const k = ['room', 'compiled', 'first-draw', 'show-shelves', 'show-furniture', 'show-books', 'show-garden', 'show-sky', 'models', 'pets', 'displays', 'reveal3', 'precompiled'];
    console.log(`run ${run}: ` + k.map(n => n + ' ' + r.m[n]).join(' | '));
    console.log(`  long tasks >120 ms: ${r.lt.map(x => x.join('+')).join(' ')}\n  after first draw: worst ${r.worst} ms, blocked ${r.after} ms; programs ${r.progs}`); if (r.late) console.log("  late:", r.late.length, r.late.slice(0, 60).join(" "), "\n  slow pictures [at, all, room, steps, sharp]:", JSON.stringify(r.slow), "\n  first uses that waited >25 ms:\n   ", r.sync.join("\n    "), r.err ? "\n  ERR " + r.err : "");
    const g = await page.evaluate(MS => { const r3 = performance.getEntriesByName('l3-reveal3')[0].startTime; const mv = r3 + 1000 * MS; return { r3: Math.round(r3), inMove: window.__gaps.filter(x => x[0] > r3 && x[0] < mv).reduce((q, x) => [q[0] + 1, q[1] + x[1], Math.max(q[2], x[1])], [0, 0, 0]), gaps: window.__gaps.filter(x => x[0] > r3), ls: performance.getEntriesByType('mark').filter(e => /^l3-lit/.test(e.name)).map(e => e.name.slice(3) + ' ' + Math.round(e.startTime)) }; }, +(process.env.MOVE_S || 25));
    console.log('  while the pointer moved (' + (process.env.MOVE_S || 25) + ' s after the words) [gaps, sum, worst]:', JSON.stringify(g.inMove)); console.log('  gaps > 60 ms after the words:', g.gaps.length, 'sum', g.gaps.reduce((s, x) => s + x[1], 0), 'worst', Math.max(0, ...g.gaps.map(x => x[1])), '|', g.gaps.map(x => x.join('+')).join(' '), '\n  states:', g.ls.join(' | '));
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
