// node compare.cjs URL... : for each URL and hour, a hash of the whole scene (ids, types, materials, geometry, matrices) and
// of the picture drawn with the clock held at 10 s; identical builds give identical lines
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
const crypto = require('crypto'); const RUN = {};
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  for (const url of process.argv.slice(2)) for (const at of (process.env.AT || '15:00,17:40,20:00').split(',')) {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
    await page.goto(url + '?at=' + at, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__lib3d && __lib3d.state().ready && !__lib3d.state().hold && document.body.classList.contains('lib3d-on'), null, { timeout: 120000, polling: 100 });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const L = __lib3d; L.renderer.setAnimationLoop(null); L.clock.getElapsedTime = () => 10; L.applyRefCamera(); L.draw();
      const f = x => Math.round(x * 1e5) / 1e5, lines = [];
      const sig = (root, tag) => root.traverse(o => {
        const mats = [].concat(o.material || []).map(m => m.id + ':' + m.type + ':' + (m.visible !== false) + ':' + (m.transparent ? 1 : 0));
        const g = o.geometry, ga = g && g.attributes && g.attributes.position;
        let gs = ''; if (g) { gs = g.id + ':' + (ga ? ga.count : 0); if (ga) { let s = 0; const arr = ga.array; for (let i = 0; i < arr.length; i += 97) s += arr[i]; gs += ':' + f(s); } }
        lines.push([tag, o.id, o.type, o.name, o.visible, o.renderOrder, o.matrixWorld.elements.map(f).join(','), mats.join(';'), gs, o.isInstancedMesh ? o.count : ''].join('|'));
      });
      sig(L.scene, 'S'); if (L.DECK && L.DECK.scene) sig(L.DECK.scene, 'D');
      return { sig: lines.join('\n'), n: lines.length, img: L.renderer.domElement.toDataURL('image/png'), programs: L.renderer.info.programs.length };
    });
    const h = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
    const tag = `${new URL(url).port}_${at.replace(':', '')}_${RUN[url + at] = (RUN[url + at] || 0) + 1}`; require('fs').writeFileSync(`sig_${tag}.txt`, r.sig); require('fs').writeFileSync(`pic_${tag}.png`, Buffer.from(r.img.split(',')[1], 'base64'));
    console.log(new URL(url).port, at, 'objects', r.n, 'scene', h(r.sig), 'picture', h(r.img), 'programs', r.programs, errs.length ? 'ERRORS ' + errs.join(' / ') : '');
    await page.close();
  }
  await browser.close();
})();
