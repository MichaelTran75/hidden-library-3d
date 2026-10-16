// node progs.cjs URL : shader programs by kind, before and after the light-state precompile; resources table
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await page.goto(process.argv[2], { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__lib3d && window.__lib3d.state().ready, null, { timeout: 120000, polling: 50 });
  const count = () => page.evaluate(() => { const m = {}; for (const p of __lib3d.renderer.info.programs) m[p.name] = (m[p.name] || 0) + 1; return { n: __lib3d.renderer.info.programs.length, m }; });
  console.log('at ready :', JSON.stringify(await count()));
  await page.waitForFunction(() => !window.__lib3d.state().hold && document.body.classList.contains('lib3d-on'), null, { timeout: 120000, polling: 200 });
  await page.waitForTimeout(4000);
  console.log('settled  :', JSON.stringify(await count()));
  const res = await page.evaluate(() => performance.getEntriesByType('resource').map(e => [e.name.replace(/^https?:\/\//, '').slice(0, 70), Math.round(e.startTime), Math.round(e.responseEnd), Math.round(e.transferSize / 1024), Math.round(e.decodedBodySize / 1024)]));
  const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return [Math.round(n.responseEnd), Math.round(n.transferSize / 1024), Math.round(n.decodedBodySize / 1024)]; });
  console.log('html: end', nav[0], 'ms', nav[1], 'KB over the wire,', nav[2], 'KB');
  let tw = nav[1], td = nav[2]; for (const r of res) { tw += r[3]; td += r[4]; console.log(String(r[1]).padStart(6), String(r[2]).padStart(6), String(r[3]).padStart(5) + ' KB', String(r[4]).padStart(5) + ' KB', r[0]); }
  console.log('total over the wire', tw, 'KB; decoded', td, 'KB');
  await browser.close();
})();
