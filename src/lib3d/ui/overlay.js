import './deck.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { CANVAS, body } from '../core/base.js';
import { camera } from '../core/renderer.js';
import { V3, goView, homeView } from '../core/views.js';
import { NIGHT } from '../fx/night.js';
import { UIS, booksView, esc, focusView, offMode, researchView } from './library.js';
import { setSpine } from './picking.js';
import { setNeeds } from '../core/loop.js';
import { bookInfo, byOf, isMapItem, isReadItem, opensFlat, titleIn } from './book-data.js';
import { readTurnTo } from './leaves.js';

/* ---- labels and the card (HTML over the canvas: crisp text in either language) */
const UIEL = {};
// the book under the pointer, named beside it: title, author · year and pages, in the page's language (a thin spine
// cannot hold its title legibly, and a long title is cut short on any spine)
let tipBook = null, tipKey = '';
function showTip(bk, x, y, map, say) {   // (map: the pointer is on an open atlas's map: the tip says a click opens its page; say: what a click does on an open book of notes, there)
  const t = UIEL.tip; if (!t) return;
  if (!bk) { if (tipBook) { t.classList.remove('is-on'); tipBook = null; tipKey = ''; } return; }
  const key = say ? 'say:' + say.join('|') : map ? 'map' : isMapItem(bk.it) ? 'atlas' : isReadItem(bk.it) ? 'read' + (bk.out ? 1 : 0) : bk === UIS.active && bk.out ? 'listen' : '';
  if (tipBook !== bk || tipKey !== key) {
    tipBook = bk; tipKey = key; const it = bk.it, info = bookInfo(it), by = byOf(it), n = info && info.pages;
    const line = pages => esc([by, pages].filter(Boolean).join(' · '));
    const hint = say ? say : key === 'map' ? ['Click the map to open the page ↗', 'Bấm vào bản đồ để mở trang ↗'] : key === 'atlas' ? [bk.out ? 'Click to put it back' : 'Click to open the atlas', bk.out ? 'Bấm để cất sách' : 'Bấm để mở tập bản đồ']
      : key.startsWith('read') ? [bk.out ? 'Click to put it back' : 'Click to open the book', bk.out ? 'Bấm để cất sách' : 'Bấm để mở sách']
      : key === 'listen' ? ['Click to open it on its summary · pause to put it back', 'Bấm để mở trang tóm tắt · pause để cất lên kệ'] : null;
    t.innerHTML = `<b><span class="en">${esc(titleIn(it, 'en'))}</span><span class="vi">${esc(it.title)}</span></b>`
      + (by || n ? `<small><span class="en">${line(n && n + ' pages')}</span><span class="vi">${line(n && n + ' trang')}</span></small>` : '')
      + (hint ? `<small><span class="en">${esc(hint[0])}</span><span class="vi">${esc(hint[1])}</span></small>` : '');
    t.classList.add('is-on');
  }
  t.style.left = Math.max(8, Math.min(x + 16, innerWidth - t.offsetWidth - 8)) + 'px';
  t.style.top = (y - t.offsetHeight - 14 > 8 ? y - t.offsetHeight - 14 : y + 22) + 'px';
}
function buildOverlay() {
  // (the two parts' names a little painted, as the room is: a brushed copy of the letters, their edges wandering, the
  // pigment thinner inside and denser at the edge, laid 30 % over the letters as they are: G, 18/10/2026)
  const ui = document.createElement('div'); ui.id = 'l3-ui'; ui.innerHTML = `<svg id="l3-lines" aria-hidden="true"></svg><div id="l3-labels"></div>
    <svg class="l3-defs" width="0" height="0" aria-hidden="true" focusable="false"><filter id="l3-wc" x="-15%" y="-70%" width="130%" height="240%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="11" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" result="w"/>
      <feGaussianBlur in="w" stdDeviation="0.6" result="s"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.11" numOctaves="2" seed="5" result="g"/>
      <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.45" result="ga"/>
      <feComposite in="s" in2="ga" operator="in" result="thin"/>
      <feMorphology in="s" operator="erode" radius="0.7" result="core"/>
      <feComposite in="s" in2="core" operator="out" result="edge"/>
      <feMerge result="wc"><feMergeNode in="thin"/><feMergeNode in="edge"/></feMerge>
      <feComposite in="SourceGraphic" in2="wc" operator="arithmetic" k1="0" k2="0.7" k3="0.3" k4="0"/></filter></svg>
    <section id="l3-card" class="l3-card" aria-labelledby="l3-card-h" hidden>
      <header class="l3-card-head"><h3 id="l3-card-h"></h3><span class="l3-count" id="l3-count"></span><button type="button" class="l3-close" id="l3-close" aria-label="Close / Đóng">&times;</button></header>
      <ul class="l3-items" id="l3-items"></ul></section>
    <div id="l3-tip" class="l3-tip" aria-hidden="true"></div>`;
  body.appendChild(ui); Object.assign(UIEL, { ui, svg: ui.querySelector('#l3-lines'), labels: ui.querySelector('#l3-labels'), card: ui.querySelector('#l3-card'), items: ui.querySelector('#l3-items'), tip: ui.querySelector('#l3-tip') });
  for (const sec of UIS.secs) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'l3-label l3-' + sec.group; b.dataset.sec = sec.id;
    b.innerHTML = `<span class="en">${esc(sec.en)}</span><span class="vi">${esc(sec.vi || sec.en)}</span><i>${sec.count}</i>`;
    b.addEventListener('click', () => openSection(sec)); b.addEventListener('pointerenter', () => setHover(sec)); b.addEventListener('pointerleave', () => setHover(null));
    UIEL.labels.appendChild(b); sec.label = b;
  }
  UIEL.caps = {};   // the two parts of the room, named like the sidebar groups
  for (const [g, en, vi] of [['books', 'Books', 'Sách'], ['research', 'Research', 'Nghiên cứu']]) {
    if (!UIS.secs.some(s => s.group === g)) continue;
    const h = document.querySelector(`.toc-group[data-group="${g}"] .toc-group-h`), txt = cls => { const n = h && h.querySelector('.' + cls); return n ? n.textContent.trim() : ''; };
    const c = document.createElement('button'); c.type = 'button'; c.className = 'l3-cap l3-cap-' + g;   // (a click: that part of the room, close: G, 17/10/2026)
    c.addEventListener('click', () => (g === 'research' ? showResearch() : showBooks()));
    c.innerHTML = `<span class="en">${esc(txt('en') || en)}</span><span class="vi">${esc(txt('vi') || vi)}</span>`; UIEL.labels.appendChild(c); UIEL.caps[g] = c;
  }
  UIEL.card.querySelector('#l3-close').addEventListener('click', () => closeCard());
  UIEL.items.addEventListener('click', e => {
    const row = e.target.closest('.l3-item'); if (!row) return; const it = UIS.open && UIS.open.items[+row.dataset.k]; if (!it) return;
    const chip = e.target.closest('[data-chip]');
    if (chip && isReadItem(it) && it.book) {   // a book of notes: a note's name turns the book to it (no dialog)
      e.preventDefault(); const c = it.chips[+chip.dataset.chip], k = it.chips.filter(x => x.el && x.el.dataset && x.el.dataset.dialog).indexOf(c);
      if (k >= 0) { setMapBook(it.book); readTurnTo(it.book, k + 1); } return;
    }
    if (chip) { const c = it.chips[+chip.dataset.chip]; if (c && !c.href) c.el.click(); return; }
    if (opensFlat(it) && it.book) { e.preventDefault(); setMapBook(UIS.mapBook === it.book ? null : it.book); return; }
    if (e.target.closest('.l3-play') || (it.src && !e.target.closest('a'))) { const p = it.li.querySelector('.play'); if (p) p.click(); }
  });
  UIEL.items.addEventListener('pointerover', e => { const row = e.target.closest('.l3-item'); const it = row && UIS.open && UIS.open.items[+row.dataset.k]; setPeek(it && it.book ? it.book : null); });
  UIEL.items.addEventListener('pointerleave', () => setPeek(null));
}
function setPeek(bk) { if (UIS.peek === bk) return; if (UIS.peek) UIS.touched.add(UIS.peek); UIS.peek = bk; if (bk) UIS.touched.add(bk); setNeeds(true); }
// the atlas taken out of its shelf and opened on its map (null: put back); its row in the card marked
function setMapBook(bk) {
  if (UIS.mapBook === bk) return; if (UIS.mapBook) UIS.touched.add(UIS.mapBook); UIS.mapBook = bk; if (bk) UIS.touched.add(bk);
  if (UIEL.items) for (const row of UIEL.items.querySelectorAll('.l3-item')) { const it = UIS.open && UIS.open.items[+row.dataset.k]; row.classList.toggle('is-current', !!(bk && it && it.book === bk)); }
  setNeeds(true);
}
function setHover(sec) {   // a section, or several (a group's title in the sidebar), or none
  const list = Array.isArray(sec) ? sec : sec ? [sec] : [], key = list.map(s => s.id).join('|');
  if (UIS.hoverKey === key) return; UIS.hoverKey = key; UIS.hover = list.length === 1 ? list[0] : null; UIS.hovers = new Set(list);
  for (const s of UIS.secs) s.label.classList.toggle('is-hover', UIS.hovers.has(s));
  CANVAS.style.cursor = list.length ? 'pointer' : ''; setNeeds(true);
}
function renderCard(sec) {
  UIEL.card.querySelector('#l3-card-h').innerHTML = `<span class="en">${esc(sec.en)}</span><span class="vi">${esc(sec.vi || sec.en)}</span>`;
  UIEL.card.querySelector('#l3-count').textContent = sec.count;
  UIEL.items.innerHTML = sec.items.map((it, k) => {
    if (it.head) return `<li class="l3-sub" data-cat="${esc(it.cat)}"><span class="en">${esc(it.en)}</span><span class="vi">${esc(it.vi)}</span><i>${it.count}</i></li>`;
    if (it.sep) return '<li class="l3-sep" role="separator"></li>';
    // the title in the page's language (English: the original title, its full form on hover), the author and the pages
    const info = bookInfo(it), en = titleIn(it, 'en'), name = en === it.title ? esc(it.title) : `<span class="en">${esc(en)}</span><span class="vi">${esc(it.title)}</span>`;
    const full = info && info.full ? ` title="${esc(info.full)}"` : '';
    const atlas = isMapItem(it), read = isReadItem(it), flat = atlas || read;   // (an atlas's row is no link: its page is reached through its map)
    const title = it.href && !atlas ? `<a href="${esc(it.href)}" target="_blank" rel="noopener noreferrer"${full}>${name}</a>` : full ? `<span${full}>${name}</span>` : name;
    const by = byOf(it), pages = info && info.pages ? `<span class="en">${info.pages} pages</span><span class="vi">${info.pages} trang</span>` : '';
    const chips = it.chips.map((c, ci) => c.href ? `<a class="l3-chip" href="${esc(c.href)}" target="_blank" rel="noopener noreferrer">${esc(c.label)} ↗</a>` : `<button type="button" class="l3-chip" data-chip="${ci}">${esc(c.label)}</button>`).join('');
    const play = it.src ? `<button type="button" class="l3-play" aria-label="Play / Phát: ${esc(it.title)}"><svg class="i ic-play" aria-hidden="true"><use href="#i-play"/></svg><svg class="i ic-pause" aria-hidden="true"><use href="#i-pause"/></svg></button>`
      : atlas ? '<span class="l3-map" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z M9 4.5v13 M15 6.5v13"/></svg></span>'
      : read ? '<span class="l3-map" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 6.6C9.6 5.1 6.6 4.7 3.5 5.3v13c3.1-.6 6.1-.2 8.5 1.3 2.4-1.5 5.4-1.9 8.5-1.3v-13c-3.1-.6-6.1-.2-8.5 1.3z M12 6.6v13"/></svg></span>' : '<span class="l3-noplay"></span>';   // (an atlas: a folded map; a book of notes: an open book)
    return `<li class="l3-item${it.src ? ' has-audio' : ''}${flat ? ' is-atlas' : ''}${flat && UIS.mapBook && UIS.mapBook.it === it ? ' is-current' : ''}" data-k="${k}">${play}<div class="l3-main"><span class="l3-t${it.bold ? ' is-bold' : ''}">${title}</span>${by || pages ? `<span class="l3-by">${esc(by)}${by && pages ? ' · ' : ''}${pages}</span>` : ''}${chips ? `<div class="l3-chips">${chips}</div>` : ''}</div><span class="l3-time"></span></li>`;
  }).join('');
  refreshCard();
}
function refreshCard() {   // mirror play state and time from the page's hidden rows
  if (!UIS.open) return;
  for (const row of UIEL.items.querySelectorAll('.l3-item')) {
    const it = UIS.open.items[+row.dataset.k]; if (!it || !it.li) continue; const cl = it.li.classList;
    row.classList.toggle('is-current', opensFlat(it) ? !!(UIS.mapBook && UIS.mapBook.it === it) : cl.contains('is-current')); row.classList.toggle('is-playing', cl.contains('is-playing')); row.classList.toggle('is-loading', cl.contains('is-loading'));
    const tm = it.li.querySelector('.time'); const txt = tm ? tm.textContent : ''; const el = row.querySelector('.l3-time'); if (el.textContent !== txt) el.textContent = txt;
  }
}
function openSection(sec, cat) {
  if (offMode()) return;
  if (UIS.mapBook && UIS.mapBook.sec !== sec) setMapBook(null);
  UIS.open = sec; UIS.mode = 'focus'; renderCard(sec); UIEL.card.hidden = false; UIEL.card.classList.remove('is-in'); requestAnimationFrame(() => UIEL.card.classList.add('is-in'));
  const sub = cat && UIEL.items.querySelector(`.l3-sub[data-cat="${CSS.escape(cat)}"]`);   // a research category: scroll its heading to the top
  UIEL.items.scrollTop = sub ? sub.offsetTop - UIEL.items.offsetTop - 4 : 0;
  for (const h of UIEL.items.querySelectorAll('.l3-sub')) h.classList.toggle('is-target', h === sub);
  for (const s of UIS.secs) s.glowT = s === sec ? 1 : 0;
  goView(focusView(sec)); if (UIS.active) UIS.touched.add(UIS.active); setNeeds(true);
}
function closeCard(home = true) {
  if (!UIS.open && !home) return;
  const was = UIS.open; UIS.open = null; UIEL.card.classList.remove('is-in'); setTimeout(() => { if (!UIS.open) UIEL.card.hidden = true; }, 260);
  for (const s of UIS.secs) s.glowT = 0; setSpine(null); setPeek(null); setMapBook(null);
  if (home) { UIS.mode = 'home'; goView(homeView()); }
  if (UIS.active) UIS.touched.add(UIS.active); setNeeds(true); return was;
}
function showResearch() { closeCard(false); UIS.mode = 'research'; goView(researchView()); }
function showBooks() { const v = booksView(); if (!v) return; closeCard(false); UIS.mode = 'books'; goView(v); }
function stepGlow(dt) {
  let moving = false;
  for (const s of UIS.secs) {
    const tgt = Math.max(s.glowT, UIS.hovers.has(s) ? 0.6 : 0);
    if (Math.abs(s.glow - tgt) > 1e-3) { s.glow += THREE.MathUtils.clamp(tgt - s.glow, -dt * 3, dt * 3); moving = true; }
    const showing = [UIS.active, UIS.mapBook].some(b => b && b.sec === s && b.goal === 'present');   // the book in front reads better on a calm shelf
    s.glowMesh.material.opacity = s.glow * (NIGHT.u.value > 0.5 ? 0.42 : 0.5) * (showing ? 0.6 : 1); s.glowMesh.visible = s.glow > 0.001;
  }
  return moving;
}
const _p = new V3(), _face = new THREE.Plane(), _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
function faceAnchor(b, sx, sy) {   // the point of a section's face seen at screen (sx, sy), kept inside the section (a row: on its board)
  _ndc.set(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1); _ray.setFromCamera(_ndc, camera);
  _face.setFromNormalAndCoplanarPoint(b.normal, b.face);
  return _ray.ray.intersectPlane(_face, _p) ? _p.clone().clamp(b.lo, b.hi) : null;
}
function project(v) { _p.copy(v).project(camera); return { x: (_p.x * 0.5 + 0.5) * innerWidth, y: (-_p.y * 0.5 + 0.5) * innerHeight, ok: _p.z > -1 && _p.z < 1 }; }
function layoutOverlay() {
  if (!UIEL.ui) return;
  const side = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 290;
  const show = !offMode(), home = UIS.mode === 'home';
  const boxes = [], lines = [];
  // a label hangs at `tag` (+dx, dy px; 'left' starts there, 'center' centres on it); it shows while `anchor` is in view
  const place = (el, anchor, tag, dx, dy, align, visible, sec) => {
    if (!visible) { el.classList.add('is-off'); return; }
    const a = project(anchor), t = tag === anchor ? a : project(tag);
    const inView = a.ok && a.x > side + 6 && a.x < innerWidth - 6 && a.y > 6 && a.y < innerHeight - 6;
    if (!inView) { el.classList.add('is-off'); return; }
    el.classList.remove('is-off'); const w = el.offsetWidth, h = el.offsetHeight;
    let x = t.x + dx - (align === 'right' ? w : align === 'left' ? 0 : w / 2), y = t.y + dy - h / 2;
    x = THREE.MathUtils.clamp(x, side + 10, innerWidth - w - 10); y = THREE.MathUtils.clamp(y, 10, innerHeight - h - 10);
    boxes.push({ el, a, x, y, w, h, sec });
  };
  for (const s of UIS.secs) {
    const vis = show && (home || UIS.mode === s.group);   // (in the close-up of its part of the room, its own labels)
    const lh = s.label.offsetHeight || 26;   // (the labels' size follows the window: build.py's CSS)
    if (s.group === 'books') place(s.label, s.box.plate, s.box.tag, 30 + lh * 0.4, 0, 'left', vis, s);   // on its row, just past the plate
    else place(s.label, s.box.plate, s.box.tag, 0, -31 - lh / 2, 'center', vis, s);                       // above its bay
  }
  // the shelf's labels in one column at the left edge of their rows (the frame of the four shelves: G, 15/10/2026), each
  // in its own row (centred on the row's middle line where the label is), all starting at the frame's edge. They keep the
  // size G asked for (twice the first) where the frame has room for the widest; on a narrower window they are made just
  // small enough to fit in it (--l3-k, not below 62 %), and only then would the column move left of the edge
  const shelfCol = boxes.filter(b => b.el.classList.contains('l3-books'));
  if (shelfCol.length) {
    const rowsAt = shelfCol.map(b => { const c = b.sec.box.corners, L0 = project(c[0]), L1 = project(c[3]), R0 = project(c[1]), R1 = project(c[2]);
      return { b, ok: L0.ok && L1.ok && R0.ok && R1.ok, xl: (L0.x + L1.x) / 2, yl: (L0.y + L1.y) / 2, xr: (R0.x + R1.x) / 2, yr: (R0.y + R1.y) / 2 }; });
    if (rowsAt.every(r => r.ok)) {
      const edge = Math.max(...rowsAt.map(r => r.xl)) + 14, room = innerWidth - 10 - edge, k0 = UIEL.booksK || 1, wNow = Math.max(...shelfCol.map(b => b.w)), w1 = wNow / k0;
      if (wNow > room + 1 || (k0 < 1 && room / w1 > k0 + 0.03)) {   // (a step at a time, with some slack: no flicker between two sizes)
        const k = THREE.MathUtils.clamp(Math.floor(room / w1 * 100) / 100, 0.62, 1);
        if (k !== k0) { UIEL.booksK = k; UIEL.labels.style.setProperty('--l3-k', k); for (const b of shelfCol) { b.w = b.el.offsetWidth; b.h = b.el.offsetHeight; } }
      }
      const wMax = Math.max(...shelfCol.map(b => b.w)), x = Math.max(side + 10, Math.min(edge, innerWidth - 10 - wMax));
      // each lies along its shelf (G, 15/10/2026): sheared to the slope of its row on the screen (its boards rise toward the
      // viewer above eye level and fall below it), its upright strokes kept upright, as if printed on the shelf's face
      for (const r of rowsAt) { const cx = x + r.b.w / 2, k = (cx - r.xl) / Math.max(1, r.xr - r.xl); r.b.x = x; r.b.y = THREE.MathUtils.clamp(r.yl + (r.yr - r.yl) * k - r.b.h / 2, 10, innerHeight - r.b.h - 10);
        r.b.skew = THREE.MathUtils.clamp(Math.atan((r.yr - r.yl) / Math.max(1, r.xr - r.xl)), -0.45, 0.45); }
    }
  }
  // the bays' labels in a row over them, left to right, each as near over its bay as the one before allows; kept clear of
  // the shelf's labels on the right (the row moves left, toward the panel, as far as it can), and a label that still
  // will not fit starts a second row under the first
  const row = boxes.filter(b => b.el.classList.contains('l3-research')).sort((p, q) => p.a.x - q.a.x);
  if (row.length > 1) {
    const books = boxes.filter(b => b.el.classList.contains('l3-books')), h = Math.max(...row.map(b => b.h)), x0 = side + 10;
    const limAt = y => Math.min(innerWidth - 10, ...books.filter(b => b.y < y + h + 8 && b.y + b.h > y - 8).map(b => b.x - 16));
    let y = Math.min(...row.map(b => b.y)), line = [];
    // (clear of the page's sky clock and its weather line above them)
    const clock = document.querySelector('.page.is-active .sky'), cq = clock && clock.getBoundingClientRect(), cr = cq && cq.height > 0 && cq.left < innerWidth && cq.right > side ? cq : null;
    if (cr) y = Math.max(y, cr.bottom + 10);
    const settle = () => { if (!line.length) return; const last = line[line.length - 1], over = last.x + last.w - limAt(y);
      if (over > 0) { const room = line[0].x - x0, d = Math.min(over, room); for (const b of line) b.x -= d; } };
    for (const b of row) {
      const prev = line[line.length - 1]; b.y = y; b.x = Math.max(b.a.x - b.w / 2, prev ? prev.x + prev.w + 12 : x0);
      line.push(b); settle();
      if (b.x + b.w > limAt(y) && line.length > 1) {   // no room left in this row: it goes down to the next
        line.pop(); y += h + 8; line = [b]; b.y = y; b.x = Math.max(x0, Math.min(b.a.x - b.w / 2, limAt(y) - b.w));
      }
    }
    // the group's name over the row: centred over it, or as far left (toward the panel, no further than the row's start)
    // as it must to keep clear of the clock; if it still meets the clock, the row goes down under it
    const cap = UIEL.caps && UIEL.caps.research; UIEL.capAt = null;
    if (cap) {
      const cw = cap.offsetWidth, ch = cap.offsetHeight, l = Math.min(...row.map(b => b.x)), r = Math.max(...row.map(b => b.x + b.w)), top = Math.min(...row.map(b => b.y));
      const meets = (x, yy) => cr && x < cr.right + 12 && x + cw > cr.left - 12 && yy < cr.bottom + 6 && yy + ch > cr.top;
      let cx = THREE.MathUtils.clamp((l + r - cw) / 2, side + 10, innerWidth - cw - 10), cy = top - ch - 10;
      if (meets(cx, cy)) cx = Math.max(side + 10, l, Math.min(cx, cr.left - 12 - cw));
      if (meets(cx, cy)) { const d = cr.bottom + 6 - cy; for (const b of row) b.y += d; cy += d; }
      UIEL.capAt = { research: [cx, cy] };
    }
  }
  boxes.sort((p, q) => p.y - q.y);
  for (let k = 1; k < boxes.length; k++) for (let j = 0; j < k; j++) {
    const p = boxes[j], q = boxes[k];
    if (q.x < p.x + p.w + 8 && q.x + q.w + 8 > p.x && q.y < p.y + p.h + 6) q.y = p.y + p.h + 6;
  }
  for (const b of boxes) {   // (no leader lines to the shelves: G, 16/10/2026; each label stands on its own row or bay)
    const sk = b.skew || 0;
    b.el.style.transform = `translate(${Math.round(b.x)}px, ${Math.round(b.y)}px)` + (sk ? ` skewY(${sk.toFixed(4)}rad)` : '');
  }
  // the group names sit over their labels: Books over the stack of rows, Research centred over the three bays
  for (const [g, cap] of Object.entries(UIEL.caps)) {
    const bs = boxes.filter(b => b.el.classList.contains('l3-' + g));
    if (!bs.length) { cap.classList.add('is-off'); continue; }
    cap.classList.remove('is-off'); const w = cap.offsetWidth, h = cap.offsetHeight, l = Math.min(...bs.map(b => b.x)), r = Math.max(...bs.map(b => b.x + b.w));
    const first = bs.reduce((p, q) => q.y < p.y ? q : p), sk = first.skew || 0;
    if (g === 'research' && UIEL.capAt && UIEL.capAt.research) {   // (placed with its row: clear of the clock)
      const [x, y] = UIEL.capAt.research; cap.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; continue;
    }
    // over a sheared label: along it, above its edge there; moved on along it (right) where it would meet the clock
    const clock = document.querySelector('.page.is-active .sky'), cr = clock && clock.getBoundingClientRect(), t = Math.tan(sk);
    const yAt = x => sk ? first.y + (x + w / 2 - first.x - first.w / 2) * t - h - 10 : first.y - h - 10;
    let x = g === 'books' ? l + 6 : (l + r - w) / 2, y = yAt(x);
    const ext = (x, y) => [y - Math.abs(t) * w / 2, y + h + Math.abs(t) * w / 2];   // (its height on the screen, sheared)
    const meets = (x, y) => { if (!cr || !cr.height) return false; const [a, b] = ext(x, y); return x < cr.right + 12 && x + w > cr.left - 12 && a < cr.bottom + 6 && b > cr.top; };
    if (meets(x, y)) { x = Math.min(cr.right + 12, first.x + first.w - w); y = yAt(x); }
    if (y < 8) { x = first.x - w - 12; y = first.y + (first.h - h) / 2; }   // no room above (a very wide window): beside the first label
    x = THREE.MathUtils.clamp(x, side + 10, innerWidth - w - 10);
    cap.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)` + (sk ? ` skewY(${sk.toFixed(4)}rad)` : '');
  }
  // a white outline around the section under the pointer (and, fainter, around the open one): the boards of a row, the posts of a bay;
  // not the open one's while a book lies open in front of it (its lines would cross the pages)
  const opened = bk => !!(bk && bk.out && bk.flapU && bk.flapU.uOpen.value > 0.5), bookOpen = opened(UIS.mapBook) || (!!(UIS.active && UIS.active.reading) && opened(UIS.active));   // (an atlas, a book of notes, or the one being listened to, lying open)
  for (const [sec, cls] of [[UIS.open, 'l3-outline is-open'], ...[...UIS.hovers].map(s => [s, 'l3-outline'])]) {
    if (!sec || !show || (cls === 'l3-outline is-open' && (UIS.hovers.has(sec) || bookOpen))) continue;
    const pts = sec.box.corners.map(project); if (pts.some(q => !q.ok)) continue;
    lines.push(`<polygon class="${cls}" points="${pts.map(q => q.x.toFixed(1) + ',' + q.y.toFixed(1)).join(' ')}"/>`);
  }
  if (UIS.open && !UIEL.card.hidden && !bookOpen) {   // the open card points down at its section: from the middle of its foot to the board its books stand on, under it
    // (G, 18/10/2026: his arrows, from the card's foot straight down to the shelf, not from its side to the far corner)
    // (where the vertical under the card's middle crosses the lowest edge of the section's outline, on the screen)
    const r = UIEL.card.getBoundingClientRect(), cx = (r.left + r.right) / 2, pts = UIS.open.box.corners.map(project);
    let ay = -Infinity;
    if (pts.every(q => q.ok)) for (let i = 0; i < pts.length; i++) {
      const q0 = pts[i], q1 = pts[(i + 1) % pts.length]; if ((q0.x - cx) * (q1.x - cx) > 0 || q0.x === q1.x) continue;
      ay = Math.max(ay, q0.y + (q1.y - q0.y) * (cx - q0.x) / (q1.x - q0.x));
    }
    ay = Math.min(ay, innerHeight - 24);
    if (ay > r.bottom + 12) lines.push(`<path class="l3-card-line" d="M${cx.toFixed(1)},${r.bottom.toFixed(1)} L${cx.toFixed(1)},${ay.toFixed(1)}"/><circle cx="${cx.toFixed(1)}" cy="${ay.toFixed(1)}" r="4"/>`);
  }
  UIEL.svg.innerHTML = lines.join('');
}

export { UIEL, buildOverlay, closeCard, layoutOverlay, openSection, refreshCard, setHover, setMapBook, setPeek, showBooks, showResearch, showTip, stepGlow };
