// PLAYWRIGHT=<its folder> node film.cjs URL OUT who [seconds] [js-first] [HH:MM]: a film strip of the hen or the cat, seen close through the page's
// own camera (the real picture), a frame every ~0.1 s; who: hen (side on; set its heading first: PETS.hen.yaw = 0; window.__yaw = 0) | catday | catside | catsofa | catfar | cat. SKIN=1: the cat without its fur. SKIPS: seconds to wait before filming. CELLS, COLS, CW, CH: the sheet. Frames in OUT-frames/, a sheet OUT.png
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs'), { execFileSync } = require('child_process');
const [URL, OUT, WHO = 'hen', SECS = '6', PRE = '', AT = '10:00'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 900, height: 640 }, deviceScaleFactor: 1, timezoneId: 'Australia/Sydney' })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.goto(URL + '?at=' + AT, { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__lib3d && __lib3d.PETS.ok && performance.getEntriesByName('l3-reveal3').length && document.documentElement.classList.contains('l3-loaded'), null, { timeout: 180000, polling: 200 });
  await p.addStyleTag({ content: '#l3-ui, .toc, .page, #l3-lines, .l3-label, .l3-cap, .sky, .fireflies { display: none !important; opacity: 0 !important; }' });
  await p.waitForTimeout(2500);
  const aim = () => p.evaluate(who => { const L = __lib3d, P = L.PETS, V = L.camera.position.constructor; let c, pos, fov;
    if (who === 'hen') { c = new V(P.hen.x, 0.1, P.hen.z); c.y = 0.14; const yw = window.__yaw === undefined ? P.hen.yaw : window.__yaw; let sx = Math.sin(yw), sz = Math.cos(yw); if (P.hen.x + sx * 1.3 > -1.75) { sx = -sx; sz = -sz; } const fx = Math.cos(yw), fz = -Math.sin(yw); pos = new V(P.hen.x + sx * 1.3 + fx * 0.35, 0.2, P.hen.z + sz * 1.3 + fz * 0.35); fov = 30; }
    else if (who === 'catsofa') { const h = P.holder.position; c = new V(h.x, h.y + 0.08, h.z); pos = new V(h.x - 0.75, h.y + 0.55, h.z + 1.0); fov = 30; }
    else if (who === 'catday') { const h = P.holder.position; c = new V(h.x - 0.08, h.y + 0.09, h.z); pos = new V(h.x - 0.35, h.y + 0.2, h.z + 1.15); fov = 30; }
    else if (who === 'catside') { const h = P.holder.position; c = new V(h.x, h.y + 0.1, h.z); pos = new V(h.x, h.y + 0.14, h.z + 1.25); fov = 26; }
    else { const h = P.holder.position; c = new V(h.x, h.y + 0.1, h.z); const far = who === 'catfar'; pos = far ? new V(h.x - 0.15, h.y + 0.5, h.z + 1.0) : new V(h.x + 0.55, h.y + 0.22, h.z + 0.7); fov = far ? 32 : 26; }
    L.goView({ pos, tgt: c, fov, shift: 0 }, 0.001); L.LIFT.to = 0; return [P.CAT.mode, P.CAT.seq ? P.CAT.seq.i : -1, P.hen.act ? P.hen.act.kind : '-'].join(' '); }, WHO);
  if (process.env.SKIN) await p.evaluate(() => { const P = __lib3d.PETS; if (P.fur) P.fur.visible = false; });
  await aim(); await p.waitForTimeout(600);
  if (PRE && PRE !== '-') { await p.evaluate(PRE); }
  if (process.env.SKIPS) { const e = Date.now() + +process.env.SKIPS * 1000; while (Date.now() < e) { await p.mouse.move(820 + Math.random() * 20, 30); await p.waitForTimeout(400); } }
  fs.rmSync(OUT + '-frames', { recursive: true, force: true }); fs.mkdirSync(OUT + '-frames', { recursive: true }); const t0 = Date.now(), log = []; let n = 0;
  while (Date.now() - t0 < +SECS * 1000) { const st = await aim(); await p.waitForTimeout(25); const f = `${OUT}-frames/${String(n).padStart(3, '0')}.png`; await p.screenshot({ path: f, clip: { x: 150, y: 70, width: 600, height: 500 } }); log.push(((Date.now() - t0) / 1000).toFixed(2) + ' ' + st); n++; }
  fs.writeFileSync(OUT + '-log.txt', log.join('\n'));
  console.log(n, 'frames in', ((Date.now() - t0) / 1000).toFixed(1), 's', errs.length ? errs : 'no errors'); await b.close();
  execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw
import glob, sys
fs=sorted(glob.glob('${OUT}-frames/*.png')); n=min(len(fs), ${process.env.CELLS || 40}); fs=[fs[round(i*(len(fs)-1)/max(1,n-1))] for i in range(n)]
cols=${process.env.COLS || 8}; w,h=${process.env.CW || 300},${process.env.CH || 250}; rows=(len(fs)+cols-1)//cols
S=Image.new('RGB',(cols*w,rows*h),'white')
for i,f in enumerate(fs):
    im=Image.open(f).convert('RGB').resize((w,h)); d=ImageDraw.Draw(im); d.text((6,4),f[-7:-4],fill=(255,255,0)); S.paste(im,((i%cols)*w,(i//cols)*h))
S.save('${OUT}.png'); print(S.size, len(fs))`], { stdio: 'inherit' });
})().catch(e => { console.error(e); process.exit(1); });
