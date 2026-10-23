// the sphinx's hind legs searched: thigh (x, z), shin x and foot x over a grid; each pose scored on where its joints come
// (cat frame, cm): the hock and the pad on the floor beside the belly, the foot pointing forward, the knee out at its side
// usage: node legsearch.cjs   (the build served at 127.0.0.1:8799; prints the twelve best; the grid and the score are in the page code below)
const { chromium } = require('/Users/michaeltran/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 800, height: 600 }, timezoneId: 'Australia/Sydney' })).newPage();
  await page.goto('http://127.0.0.1:8799/?at=13:00', { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('l3-loaded') && __lib3d.PETS && __lib3d.PETS.ok, null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => { const C = __lib3d.PETS.CAT; C.actT = C.huntT = C.twitchT = C.glanceT = 1e9; });
  await page.waitForTimeout(2000);
  const res = await page.evaluate(async () => {
    const T = await import('three'), P = __lib3d.PETS; let skin = null; P.cat.traverse(o => { if (o.isSkinnedMesh && !skin) skin = o; });
    const bone = n => skin.skeleton.bones.find(b => b.name === n), J = ['thigh_R', 'shin_R', 'foot_R', 'toe_R'].map(bone);
    const front = [['arm', 'x', 10], ['fore', 'x', -75], ['paw', 'x', 5]], rest = [['neck', 'x', -8]];
    const inv = new T.Matrix4(), v = new T.Vector3(), out = [];
    for (let tx = -50; tx <= 20; tx += 10) for (let tz = 10; tz <= 50; tz += 10) for (let sx = 30; sx <= 150; sx += 10) for (let fx = -130; fx <= 10; fx += 10) {
      const ops = [...front, ['thigh', 'x', tx], ['thigh', 'z', tz], ['shin', 'x', sx], ['foot', 'x', fx], ...rest];
      P.tryPose('probe', ops); P.holder.updateMatrixWorld(true); inv.copy(P.holder.matrixWorld).invert();
      const p = J.map(b => { b.getWorldPosition(v); v.applyMatrix4(inv); return [v.z * 100, v.y * 100, -v.x * 100]; });   // fwd, up, out (its right side out)
      const [H, K, A, B] = p;   // hip, knee, hock (ankle), ball of the foot
      const s = (A[1] - 1.5) ** 2 + (B[1] - 0.8) ** 2 + 0.5 * Math.max(0, 4 - (B[0] - A[0])) ** 2 + 0.5 * Math.max(0, (A[0] - B[0]) - 0) ** 2
        + 0.3 * Math.max(0, (H[0] + 3) - K[0]) ** 2 + 0.3 * Math.max(0, 8 - K[2]) ** 2 + 0.2 * Math.max(0, 7 - A[2]) ** 2 + 0.2 * Math.max(0, K[1] - 7) ** 2;
      out.push([s, tx, tz, sx, fx, p.map(q => q.map(x => Math.round(x * 10) / 10))]);
    }
    out.sort((a, b) => a[0] - b[0]); return out.slice(0, 12);
  });
  for (const r of res) console.log(r[0].toFixed(2), 'thigh x', r[1], 'z', r[2], 'shin', r[3], 'foot', r[4], JSON.stringify(r[5]));
  await browser.close();
})();
