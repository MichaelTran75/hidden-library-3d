import './book-data.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { canvas, ctex } from '../core/utils.js';
import { setShadowsDirty } from '../core/renderer.js';
import { room } from '../world/room.js';
import { BOOK, refitCell } from '../world/books.js';
import { SHELF } from '../world/shelves.js';
import { V3 } from '../core/views.js';
import { booksMesh } from '../core/build.js';
import { UIS, bookSlot, researchSlot, slotBox } from './library.js';
import { bookInfo, coverAr, spineOf } from './book-data.js';

/* ---- categories and items, read from the page's own (hidden) cards */
function readCategories() {
  return [...document.querySelectorAll('#pages .page .cat')].map(el => {
    const page = el.closest('.page'), head = el.querySelector('.cat-head .swap');
    return { id: el.dataset.cat, el, page: page ? page.dataset.page : '', group: page && page.dataset.page === 'books' ? 'books' : 'research',
      en: (head && head.querySelector('.en') ? head.querySelector('.en').textContent : el.dataset.cat).trim(),
      vi: (head && head.querySelector('.vi') ? head.querySelector('.vi').textContent : '').trim(),
      count: +((el.querySelector('.count') || {}).textContent || 0) };
  });
}
/* a book category is a section on its own; a research topic gathers the categories of its sub-page */
function readSections() {
  const cats = readCategories(), secs = cats.filter(c => c.group === 'books').map(c => ({ id: c.id, group: 'books', en: c.en, vi: c.vi, count: c.count, cats: [c] }));
  const pages = [];
  for (const c of cats.filter(c => c.group === 'research')) { let p = pages.find(q => q.id === c.page); if (!p) pages.push(p = { id: c.page, cats: [] }); p.cats.push(c); }
  for (const p of pages) {
    const h = document.querySelector(`.toc-sub[data-sub="${CSS.escape(p.id)}"] .toc-sub-h`) || document.querySelector(`.subtab[data-goto="${CSS.escape(p.id)}"]`);
    const txt = cls => { const n = h && h.querySelector('.' + cls); return n ? n.textContent.trim() : ''; };
    const pg = document.querySelector(`#pages .page[data-page="${CSS.escape(p.id)}"]`), en = txt('en') || (pg && pg.getAttribute('aria-label')) || p.id;
    secs.push({ id: p.id, group: 'research', en, vi: txt('vi') || en, count: p.cats.reduce((n, c) => n + c.count, 0), cats: p.cats });
  }
  return secs;
}
function readItems(sec) {
  const out = [];
  for (const c of sec.cats) {
    if (sec.group === 'research') out.push({ head: true, cat: c.id, en: c.en, vi: c.vi || c.en, count: c.count });
    for (const li of c.el.querySelectorAll('.items > li')) {
      if (li.classList.contains('sep')) { out.push({ sep: true }); continue; }
      const t = li.querySelector('.t'), a = t && t.querySelector('a[href]'), byEl = t && t.querySelector('.by');
      const tc = t ? t.cloneNode(true) : null; if (tc) tc.querySelectorAll('.by, svg').forEach(n => n.remove());
      out.push({ li, src: li.dataset.src || '', title: li.dataset.title || (tc ? tc.textContent.trim() : ''), href: a ? a.getAttribute('href') : '',
        by: byEl ? byEl.textContent.trim() : '', bold: !!(t && t.classList.contains('t-bold')),
        chips: [...li.querySelectorAll('.extras .chip')].map(ch => ({ el: ch, label: ch.textContent.trim(), href: ch.getAttribute('href') || '' })) });
    }
  }
  return out;
}

/* ---- the 3D side of a section: hit area, glow, brass plate, and the books its items will take off the shelf */
function gatherBooks(slot, cols) {
  const cand = [], rows = slot.bookRows || slot.rows;
  BOOK.list.forEach((b, idx) => {
    const cl = b.cell; if (!cl || !b.up || b.lean || cl.shelf !== slot.shelf) return;
    if (cl.i < cols[0] || cl.i > cols[1] || cl.j < rows[0] || cl.j > rows[1]) return;
    const t = new V3().setFromMatrixColumn(b.m, 0).length(), h = new V3().setFromMatrixColumn(b.m, 1).length(), d = new V3().setFromMatrixColumn(b.m, 2).length();
    // the tall shelf's books take the thickness of their pages anyway, so any upright book will do there: more of them in
    // a cell, fewer cells to a section, a closer view and wider spines
    if (t < (slot.shelf === 'R' ? 0.012 : 0.022) || h < 0.2) return;
    const p = new V3().setFromMatrixPosition(b.m);
    if (slot.bookCut) { const xa = SHELF.B.X[cols[0]], xb = SHELF.B.X[cols[1] + 1]; if (p.x < xa + (xb - xa) * slot.bookCut) return; }
    cand.push({ idx, t, h, d, key: -cl.j * 100 + (slot.shelf === 'R' ? p.z : p.x) });
  });
  return cand.sort((a, b) => a.key - b.key);
}
function glowTexture(w, h) {   // the light on a chosen section: soft edges, a little stronger under the board above
  const W = w > h ? 512 : 128, H = Math.max(24, Math.round(W * h / w)), c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H);
  const fx = Math.min(W * 0.08, H * 0.6), fy = Math.min(H * 0.18, 18), ss = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = ss(Math.min(x + 0.5, W - x - 0.5) / fx) * ss(Math.min(y + 0.5, H - y - 0.5) / fy), a = e * (0.7 + 0.3 * (1 - y / H)), i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0); return ctex(c, { rep: false });
}
const BOOK_BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, -0.5), HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
function buildSections() {
  const all = readSections(), nRes = all.filter(s => s.group === 'research').length, used = { books: 0, research: 0 };
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xb38b4c, metalness: 0.85, roughness: 0.35, fog: false });
  for (const s0 of all) {
    const k = used[s0.group]++, slot = s0.group === 'books' ? bookSlot(k) : researchSlot(k, nRes); if (!slot) continue;
    const sec = { ...s0, slot, glow: 0, glowT: 0, books: [] }; sec.items = readItems(sec);
    // books of this section, one per item (its title on the spine): upright, not leaning, thick enough to read a spine,
    // spread evenly. A row lends the books of the narrowest run of cells that holds enough of them (ornament cells hold
    // none), the run nearest its middle column; the camera frames that run.
    const items = sec.items.filter(it => !it.sep && !it.head);
    let cand = gatherBooks(slot, slot.cols);
    if (slot.pick) {
      const per = []; for (let c = slot.cols[0]; c <= slot.cols[1]; c++) per[c] = gatherBooks(slot, [c, c]);
      const need = Math.max(items.length + 1, 3); let best = null;
      for (let w = 1; w <= slot.cols[1] - slot.cols[0] + 1 && !best; w++) for (let a = slot.cols[0]; a + w - 1 <= slot.cols[1]; a++) {
        const b = a + w - 1; if (!per[a].length || !per[b].length) continue;
        let n = 0; for (let c = a; c <= b; c++) n += per[c].length;
        const off = Math.abs((a + b) / 2 - slot.mid); if (n >= need && (!best || off < best.off)) best = { a, b, off };
      }
      if (best) { slot.pick = [best.a, best.b]; cand = gatherBooks(slot, slot.pick); }
    }
    const box = slotBox(slot); sec.box = box;
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(box.w, box.h), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(box.face); hit.rotation.y = box.rotY; hit.userData.sec = sec; room.add(hit); sec.hit = hit;
    const gm = new THREE.MeshBasicMaterial({ color: 0xffe3ad, map: glowTexture(box.w, box.h), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    // the chosen section lights up at the back of its cells, so the books in front keep their colours
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(box.w - 0.02, box.h - 0.02), gm); glow.position.copy(box.back); glow.rotation.y = box.rotY; glow.renderOrder = 3; room.add(glow); sec.glowMesh = glow;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.024, 0.006), plateMat); plate.position.copy(box.plate).addScaledVector(box.normal, 0.004); plate.rotation.y = box.rotY; room.add(plate);
    // the widest spines read best: of the books on offer take the thickest ones, keeping their order on the shelf
    // (on the tall shelf a category's books stand together, the run of books in the middle of its cells: they take the
    // thickness of their pages, and the camera comes as close as that run allows)
    const together = slot.shelf === 'R', first = Math.max(0, Math.floor((cand.length - items.length) / 2));
    if (!together && cand.length > items.length) { const keep = new Set([...cand].sort((a, b) => b.t - a.t).slice(0, items.length)); cand = cand.filter(c => keep.has(c)); }
    items.forEach((it, k) => {
      const c0 = together ? cand[first + k] : cand[Math.floor((k + 0.5) * cand.length / items.length)]; if (!c0) return;
      const bl = BOOK.list[c0.idx], hsl = {}; bl.c.getHSL(hsl, THREE.SRGBColorSpace);
      if (hsl.l < 0.45) {   // a book that will be read in front of the camera is never a very dark one (lifted on the shelf too)
        bl.c.setHSL(hsl.h, Math.min(hsl.s, 0.5), 0.45, THREE.SRGBColorSpace); booksMesh.setColorAt(c0.idx, bl.c); booksMesh.instanceColor.needsUpdate = true;
      }
      const bk = { sec, it, idx: c0.idx, m0: bl.m.clone(), color: bl.c.clone(), t: c0.t, h: c0.h, d: c0.d, out: false, slide: 0, hero: null, pose: null, goal: null, fk: 1 };
      bk.normal = box.normal.clone(); it.book = bk; sec.books.push(bk); if (it.src) UIS.bySrc.set(it.src, bk);
      // an invisible box over the shelf book: the pointer finds it to select its row in the card, a click plays it
      const hit = new THREE.Mesh(BOOK_BOX, HIDDEN); hit.matrixAutoUpdate = false; hit.matrix.copy(bk.m0); hit.userData.book = bk; booksMesh.parent.add(hit); bk.hit = hit;
    });
    // each book of the page takes the thickness of its pages (and a book's height): its cells are packed again
    const byCell = new Map(), keep = new Set(sec.books.map(bk => bk.idx));
    for (const bk of sec.books) {
      const info = bookInfo(bk.it), cl = BOOK.list[bk.idx].cell; if (!info || !(info.pages || info.t) || !cl || !cl.B) continue;
      // heights of trade books, 20.5 to 24.5 cm, in the order the shelf's random ones had (0.2 to 0.34 m)
      const h = info.h || 0.205 + Math.min(1, Math.max(0, (bk.h - 0.2) / 0.14)) * 0.04, t = info.pages ? spineOf(info.pages) : info.t;
      // a book with a cover: as wide (deep on the shelf) as its cover is for its height, the board's width being the
      // book's less its rounded spine (hero-books.js: bz), within what its shelf holds
      const ar = coverAr(bk.it), d = ar ? THREE.MathUtils.clamp(ar * h + Math.min(0.006, t * 0.2), 0.12, 0.26) : info.d || 0;   // (or the table's own)
      (byCell.get(cl) || byCell.set(cl, new Map()).get(cl)).set(bk.idx, d ? { t, h, d } : { t, h });
    }
    for (const [cl, sizes] of byCell) {
      for (const i of refitCell(cl, sizes, keep)) booksMesh.setMatrixAt(i, BOOK.list[i].m);
      for (const [i, sz] of sizes) { const bk = sec.books.find(b => b.idx === i); bk.t = sz.t; bk.h = sz.h; if (sz.d) bk.d = sz.d; }
    }
    if (byCell.size) {
      booksMesh.instanceMatrix.needsUpdate = true; setShadowsDirty(true);
      for (const bk of sec.books) { bk.m0.copy(BOOK.list[bk.idx].m); bk.hit.matrix.copy(bk.m0); }
    }
    if (together && box.focus && sec.books.length) {   // the view frames the books themselves
      let z0 = Infinity, z1 = -Infinity; for (const bk of sec.books) { const z = bk.m0.elements[14]; z0 = Math.min(z0, z - bk.t / 2); z1 = Math.max(z1, z + bk.t / 2); }
      box.focus.z = (z0 + z1) / 2; box.focusW = z1 - z0 + 0.12;
    }
    UIS.secs.push(sec); UIS.byId.set(sec.id, sec); for (const c of sec.cats) UIS.byCat.set(c.id, sec);
  }
}

export { buildSections };
