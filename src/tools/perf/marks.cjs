const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  for (let run = 0; run < 2; run++) {
    const page = await (await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 })).newPage();
    await page.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); });
    await page.goto(process.argv[2], { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => performance.getEntriesByName('l3-precompiled').length, null, { timeout: 120000, polling: 100 });
    const r = await page.evaluate(() => ({ marks: performance.getEntriesByType('mark').map(m => m.name + ' ' + Math.round(m.startTime)).join(' | '), dcl: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd), lt: window.__lt.filter(x => x[1] > 200).map(x => x.join('+')).join(' ') }));
    console.log('run', run, 'DCL', r.dcl, '\n ', r.marks, '\n  long tasks >200ms:', r.lt);
    await page.close();
  }
  await browser.close();
})();
