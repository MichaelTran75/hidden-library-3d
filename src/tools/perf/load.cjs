// node load.cjs URL [--profile out.cpuprofile] : load timing, resources, long tasks, GPU, time to the room shown
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
(async () => {
  const url = process.argv[2], prof = process.argv.indexOf('--profile') > 0 ? process.argv[process.argv.indexOf('--profile') + 1] : null;
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  await page.addInitScript(() => {
    window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
    window.__marks = {};
    const mo = new MutationObserver(() => { if (document.body && document.body.classList.contains('lib3d-on') && !window.__marks.on) window.__marks.on = performance.now(); });
    document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { attributes: true, attributeFilter: ['class'] }));
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__marks.on, null, { timeout: 120000, polling: 100 });
  await page.waitForTimeout(3000);
  if (prof) { const { profile } = await cdp.send('Profiler.stop'); require('fs').writeFileSync(prof, JSON.stringify(profile)); }
  const r = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource').map(e => [e.name.replace(/^https?:\/\/[^/]+/, m => m.replace('https://', '')).slice(0, 110), Math.round(e.startTime), Math.round(e.responseEnd), e.transferSize, e.decodedBodySize]);
    let gpu = ''; try { const c = document.createElement('canvas').getContext('webgl2'); const x = c.getExtension('WEBGL_debug_renderer_info'); gpu = c.getParameter(x.UNMASKED_RENDERER_WEBGL); } catch (e) {}
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { gpu, dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), html: [nav.transferSize, nav.decodedBodySize], fcp: fcp && Math.round(fcp.startTime), on: Math.round(window.__marks.on), longtasks: window.__lt, res };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();
