// node check.cjs URL_PLAIN URL_MINIFIED [OUT_DIR] : the two builds side by side (build.py --pages A --no-minify, and
// build.py --pages B), each served by you: the minified one must do all the plain one does.
// - errors on the page;
// - the workers: how many were made, answered, failed (a worker that fails falls back to the page's own thread without a
//   word: the room only stutters as it opens);
// - every book's summary laid out in both languages (ui/leaves.js readCheck), and the shelves' spine atlas;
// - for a look, not a verdict: the time to the room, and the shader programs once the other light states are compiled
//   and after the day/night switch is pressed both ways (the switch should make none). Both vary from run to run, the
//   programs too (367 or 391 on 05/11/2026, in either build): that no two shader functions come out the same, which
//   would make fewer, minify.mjs checks itself;
// - screenshots by day and by night in OUT_DIR (the room's animals and clocks move: compare them by eye).
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
const WATCH = () => {
  const W = window.Worker; window.__wk = { made: 0, said: 0, failed: [] };
  window.Worker = class extends W { constructor(u, o) { super(u, o); __wk.made++;
    this.addEventListener('message', () => __wk.said++); this.addEventListener('error', e => __wk.failed.push(e.message || 'error')); } };
};
async function run(browser, url, label, outDir) {
  const page = await (await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await page.addInitScript(WATCH);
  const t0 = Date.now(); await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__lib3d && window.__lib3d.state().ready, null, { timeout: 120000, polling: 50 });
  const ready = Date.now() - t0;
  // the spine atlas's pixels, read before the page lets them go once they are on the GPU (core/loop.js releaseSources)
  const atlas = await page.evaluate(() => { const d = __lib3d.BOOK.atlas && __lib3d.BOOK.atlas.image && __lib3d.BOOK.atlas.image.data; if (!d) return 'gone'; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0; return d.length + ':' + h; });
  await page.waitForFunction(() => !window.__lib3d.state().hold && document.body.classList.contains('lib3d-on'), null, { timeout: 120000, polling: 200 });
  await page.waitForFunction(() => performance.getEntriesByName('l3-precompiled').length, null, { timeout: 120000, polling: 200 });   // (the other light states, compiled in the background: ~9 s)
  await page.waitForTimeout(1000);
  const progs = () => page.evaluate(() => { const m = {}; for (const p of __lib3d.renderer.info.programs) m[p.name] = (m[p.name] || 0) + 1; return { n: __lib3d.renderer.info.programs.length, m }; });
  const r = { ready, atlas, settled: await progs() };
  for (const dark of [false, true]) {   // the page's day/night switch, as a visitor presses it (checked: night)
    await page.evaluate(d => { const b = document.getElementById('checkbox'); if (b.checked !== d) b.click(); }, dark); await page.waitForTimeout(3000);
    if (outDir) await page.screenshot({ path: `${outDir}/${label}-${dark ? 'night' : 'day'}.png` });
  }
  r.after = await progs();
  r.read = await page.evaluate(async () => JSON.stringify(await __lib3d.readCheck()));   // (it makes every book's open book: many programs more)
  r.workers = await page.evaluate(() => window.__wk);
  r.errors = errs;
  await page.close();
  return r;
}
(async () => {
  const [a, b, outDir] = process.argv.slice(2);
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const A = await run(browser, a, 'plain', outDir), B = await run(browser, b, 'minified', outDir);
  await browser.close();
  const row = (k, x, y, look) => console.log(k.padEnd(22), String(x).padEnd(28), String(y).padEnd(28), look ? '' : x === y ? 'same' : 'DIFFERENT');
  console.log(''.padEnd(22), 'plain'.padEnd(28), 'minified');
  row('workers made/answered', A.workers.made + '/' + A.workers.said, B.workers.made + '/' + B.workers.said);
  row('worker failures', A.workers.failed.join(' / ') || 'none', B.workers.failed.join(' / ') || 'none');
  row('spine atlas', A.atlas, B.atlas);
  row('summaries laid out', A.read.length + ' chars', B.read.length + ' chars'); row('  (the same)', A.read === B.read, A.read === B.read);
  row('page errors', A.errors.join(' / ') || 'none', B.errors.join(' / ') || 'none');
  row('room ready (ms)', A.ready, B.ready, true);
  row('programs, compiled', A.settled.n, B.settled.n, true);
  row('programs, day + night', A.after.n, B.after.n, true);   // (the switch pressed both ways: as many as compiled)
})();
