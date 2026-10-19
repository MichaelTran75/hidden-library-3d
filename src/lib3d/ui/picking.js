import './overlay.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { CANVAS } from '../core/base.js';
import { LIFT, setLift } from '../core/views.js';
import { camera } from '../core/renderer.js';
import { UIS, offMode } from './library.js';
import { buildSections } from './sections.js';
import { startReading, stopReading, syncActive } from './flight.js';
import { DECK, buildRecordPlayer, togglePlayer } from './deck.js';
import { UIEL, buildOverlay, closeCard, openSection, refreshCard, setHover, setMapBook, setPeek, showBooks, showResearch, showTip } from './overlay.js';
import { ready, setNeeds } from '../core/loop.js';
import { isMapItem, opensFlat } from './book-data.js';
import { readClick, readHint, readHit } from './leaves.js';
import { PLANE } from '../world/b747.js';
import { CLOCK, clockHit, closeClock, inspectPointer, openClock } from '../world/clock.js';
import { VCAM, camHit, camPointer, closeCamera, openCamera } from '../world/camera.js';
import { ISS, issHit } from '../world/iss.js';
import { GBOOK, gardenHit } from '../world/gardenbook.js';

/* ---- picking in the room */
const RAY = new THREE.Raycaster(), NDC = new THREE.Vector2(); RAY.layers.enable(3);   // (the book out of the shelf is on its own layer: hero-books.js)
// where the pointer's ray meets an open atlas: its map page, or its cover turned open (which the ray cannot find in the
// mesh: it turns in the shader); worked out in the book's own frame, in metres. Its distance along the ray, for the order
const _mi = new THREE.Matrix4(), _mo = new THREE.Vector3(), _md = new THREE.Vector3();
function bookRay(bk) {   // the pointer's ray in an open book's own frame, in metres
  const h = bk && bk.hero; if (!h || !h.visible || !bk.heroShape || !bk.flapU || bk.flapU.uOpen.value < 1.2) return null;
  _mi.copy(h.matrixWorld).invert();
  const o = _mo.copy(RAY.ray.origin).applyMatrix4(_mi), d = _md.copy(RAY.ray.origin).add(RAY.ray.direction).applyMatrix4(_mi).sub(o);
  o.multiply(h.scale); d.multiply(h.scale);   // (the unit box back into metres)
  return { o, d };
}
function mapHit(bk) {
  const r = bookRay(bk); if (!r) return null;
  const { o, d } = r, S = bk.heroShape, pg = S.page, hits = [];
  if (Math.abs(d.x) > 1e-9) { const t = (pg.x - o.x) / d.x, y = o.y + d.y * t, z = o.z + d.z * t; if (t > 0 && y > pg.y0 && y < pg.y1 && z < pg.z0 && z > pg.z1) hits.push({ at: 'page', t }); }
  const a = bk.flapU.uOpen.value, H = S.hinge, ax = Math.sin(a), az = -Math.cos(a), nx = Math.cos(a), nz = Math.sin(a), den = d.x * nx + d.z * nz;
  if (Math.abs(den) > 1e-9) {
    const t = ((H.x - o.x) * nx + (H.y - o.z) * nz) / den, x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, L = (x - H.x) * ax + (z - H.y) * az;
    if (t > 0 && L > 0 && L < bk.d && y > 0 && y < bk.h) hits.push({ at: 'cover', t });
  }
  return hits.sort((p, q) => p.t - q.t)[0] || null;
}
function pickAt(e) {
  const r = CANVAS.getBoundingClientRect(); NDC.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  RAY.setFromCamera(NDC, camera);
  const ob = UIS.mapBook && UIS.mapBook.out ? UIS.mapBook : UIS.active && UIS.active.out && UIS.active.reading ? UIS.active : null;   // (an open atlas or book of notes; the book being listened to, open)
  if (ob && ob.read) { const r = bookRay(ob), rh = r && readHit(ob, r.o, r.d); if (rh) return { book: ob, read: rh }; }   // (a book of notes: its pages)
  else { const mh = ob ? mapHit(ob) : null; if (mh) return { book: ob, map: mh.at === 'page' }; }
  // books first (they stand just behind their section's face): those of the open section, and the one out of the shelf
  const books = UIS.open ? UIS.open.books.map(b => b.hit) : [];
  for (const b of [UIS.active, UIS.peek]) if (b && b.hero && b.hero.visible) books.push(b.hero);
  const hb = books.length ? RAY.intersectObjects(books, false)[0] : null; if (hb) return { book: hb.object.userData.book };
  if (PLANE.ok && PLANE.hit && RAY.intersectObject(PLANE.hit, false).length) return { plane: true };   // (the 747 on the Research shelf: b747.js)
  if (clockHit(RAY.ray)) return { clock: true };   // (the medieval clock on the tall shelf: clock.js)
  if (camHit(RAY.ray)) return { vcam: true };   // (the vintage camera on the tall shelf: camera.js)
  if (issHit(RAY.ray)) return { iss: true };   // (the ISS over the Geography bay: iss.js)
  if (gardenHit(RAY.ray)) return { garden: true };   // (the 3D garden's book on the pouf: gardenbook.js)
  const hs = RAY.intersectObjects(UIS.secs.map(s => s.hit), false)[0], hd = DECK.ok ? RAY.intersectObject(DECK.hit, false)[0] : null;
  if (hd && (!hs || hd.distance < hs.distance)) return { deck: true };
  return hs ? { sec: hs.object.userData.sec } : null;
}
function activateItem(it) {   // what a click on its book does: play it, else (an atlas, a book of notes) take it out to open, else open its link, else its first extra (a note, a chart…)
  const pl = it.li && it.li.querySelector('.play'); if (pl) { pl.click(); return; }
  if (opensFlat(it) && it.book) { setMapBook(it.book); return; }
  if (it.href) { window.open(it.href, '_blank', 'noopener'); return; }
  const c = it.chips[0]; if (c) { if (c.href) window.open(c.href, '_blank', 'noopener'); else c.el.click(); }
}
function setSpine(bk) {   // a book of the open section under the pointer: it leans out and its row lights up in the card
  if (UIS.spine === bk) return; UIS.spine = bk;
  for (const row of UIEL.items.querySelectorAll('.l3-item.is-hot')) row.classList.remove('is-hot');
  const row = bk && UIS.open === bk.sec ? UIEL.items.querySelector(`.l3-item[data-k="${UIS.open.items.indexOf(bk.it)}"]`) : null;
  if (row) {
    row.classList.add('is-hot'); const L = UIEL.items, top = row.offsetTop - L.offsetTop;
    if (top < L.scrollTop || top + row.offsetHeight > L.scrollTop + L.clientHeight) L.scrollTop = top - (L.clientHeight - row.offsetHeight) / 2;
  }
  setPeek(bk);
}
function bindPicking() {
  let down = null;
  CANVAS.addEventListener('pointermove', e => {
    if (!ready || offMode()) return;
    if (inspectPointer('move', e) || camPointer('move', e)) { const dv = CLOCK.view.drag || VCAM.view.drag; CANVAS.style.cursor = dv && dv.moved ? 'grabbing' : 'grab'; return; }   // (the clock or the camera out of its shelf: the room is not picked)
    const p = pickAt(e), bk = p && p.book && p.book.sec === UIS.open ? p.book : null;
    setSpine(bk); showTip(p && p.book ? p.book : null, e.clientX, e.clientY, !!(p && p.map), p && p.read ? readHint(p.book, p.read) : null); setHover(!p || p.book || p.deck || p.plane || p.clock || p.vcam || p.iss || p.garden || UIS.open === p.sec ? null : p.sec);
    CANVAS.style.cursor = p && (p.book || p.deck || p.plane || p.clock || p.vcam || p.iss || p.garden || UIS.open !== p.sec) ? 'pointer' : '';
    const dh = !!(p && p.deck), ph = !!(p && p.plane), ch = !!(p && p.clock), vh = !!(p && p.vcam), ih = !!(p && p.iss), gh = !!(p && p.garden), vi = document.documentElement.lang === 'vi';
    if (dh !== DECK.hover || ph !== PLANE.hover || ch !== CLOCK.hover || vh !== VCAM.hover || ih !== ISS.hover || gh !== GBOOK.hover) {
      DECK.hover = dh; PLANE.hover = ph; CLOCK.hover = ch; VCAM.hover = vh; ISS.hover = ih; GBOOK.hover = gh;
      CANVAS.title = dh ? (vi ? 'Máy hát' : 'Record player') : ph ? 'Boeing 747-8' : ch ? (vi ? 'Đồng hồ trung cổ' : 'Medieval clock') : vh ? (vi ? 'Máy ảnh Asahi Pentax H2' : 'Asahi Pentax H2 camera') : ih ? (vi ? 'Trạm Vũ trụ Quốc tế (ISS)' : 'International Space Station') : gh ? (vi ? 'Khu vườn 3D' : '3D Garden') : ''; setNeeds(true);
    }
  });
  CANVAS.addEventListener('pointerleave', () => { setHover(null); setSpine(null); showTip(null); if (DECK.hover || PLANE.hover || CLOCK.hover || VCAM.hover || ISS.hover || GBOOK.hover) { DECK.hover = PLANE.hover = CLOCK.hover = VCAM.hover = ISS.hover = GBOOK.hover = false; CANVAS.title = ''; setNeeds(true); } });
  CANVAS.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; showTip(null); inspectPointer('down', e); camPointer('down', e); });
  CANVAS.addEventListener('pointerup', e => {
    if (inspectPointer('up', e) || camPointer('up', e)) { down = null; return; }   // (the clock or the camera out: its own clicks and drags)
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600 || offMode()) { down = null; return; }
    down = null; const p = pickAt(e);
    if (p && p.book && p.book === UIS.active && p.book.out && p.book !== UIS.mapBook) {   // the book being listened to: a click opens it on its summary, then turns its pages; its board closes it (pause puts it back)
      if (!p.book.reading) startReading(p.book); else if (p.read && !readClick(p.book, p.read)) stopReading(p.book);
    }
    else if (p && p.book && p.book === UIS.mapBook && p.book.out) {   // an open atlas: its map opens its page, the rest of it puts it back; a book of notes: its pages turn, its board puts it back
      if (p.read) { if (!readClick(p.book, p.read)) setMapBook(null); }
      else if (p.map) window.open(p.book.it.href, '_blank', 'noopener'); else setMapBook(null);
    }
    else if (p && p.book) activateItem(p.book.it);
    else if (p && p.deck) togglePlayer();   // the record player on the floor: the page's player comes out (or goes away)
    else if (p && p.plane) window.open(PLANE.url, '_blank', 'noopener');   // the 747: its page, in a new tab
    else if (p && p.iss) window.open(ISS.url, '_blank', 'noopener');
    else if (p && p.garden) window.open(GBOOK.url, '_blank', 'noopener');   // the garden's book: the 3D garden, in a new tab   // the ISS: the station's own page, in a new tab
    else if (p && p.clock) { CLOCK.hover = false; CANVAS.title = ''; openClock(); }   // the clock: out of its shelf, three times as large, apart
    else if (p && p.vcam) { VCAM.hover = false; CANVAS.title = ''; openCamera(); }   // the camera: the same, its parts named
    else if (p && p.sec) openSection(p.sec);
    else if (UIS.mode !== 'home') closeCard();
  });
  addEventListener('keydown', e => { if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return; if (UIS.mode !== 'home') closeCard(); else togglePlayer(false); });
  // the view up or down (core/views.js LIFT): the wheel or a trackpad over the room, the arrow keys and page keys
  CANVAS.addEventListener('wheel', e => { if (!ready || offMode() || e.ctrlKey || CLOCK.view.on || VCAM.view.on) return; e.preventDefault();
    setLift(LIFT.to + e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1) / innerHeight * 0.8); }, { passive: false });
  addEventListener('keydown', e => { if (!ready || offMode() || CLOCK.view.on || VCAM.view.on || (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]'))) return;
    const step = { ArrowDown: 0.08, ArrowUp: -0.08, PageDown: 0.3, PageUp: -0.3 }[e.key]; if (step === undefined) return; e.preventDefault(); setLift(LIFT.to + step); });
  // a title in the sidebar under the pointer: its section is shown chosen in the room, as when its label there is
  // hovered; a group's title (Books, Research) lights all of its sections (G, 15/10/2026)
  const toc = document.getElementById('toc-groups');
  if (toc) {
    const secsOf = el => {
      const lk = el && el.closest ? el.closest('.toc-link[href]') : null, bk = lk && toc.contains(lk) ? atlasOf(lk) : null; if (bk) return bk.sec;
      const a = el && el.closest ? el.closest('.toc-link[data-nav], [data-goto]') : null; if (!a || !toc.contains(a)) return null;
      if (a.dataset.nav) return UIS.byCat.get(a.dataset.nav) || null;
      const g = a.dataset.goto; return UIS.byId.get(g) || (g === 'books' || g === 'research' ? UIS.secs.filter(s => s.group === g) : null);
    };
    toc.addEventListener('pointerover', e => { if (ready && !offMode()) setHover(secsOf(e.target)); });
    toc.addEventListener('pointerleave', () => setHover(null));
  }
  // the sidebar and the now-playing bar steer the room (the page's own handlers still run on the hidden pages)
  document.addEventListener('click', e => {
    if (!ready) return;
    if (CLOCK.view.on && e.target.closest('.toc')) closeClock();   // (the sidebar steers the room again: the clock back on its shelf)
    if (VCAM.view.on && e.target.closest('.toc')) closeCamera();
    const lk = e.target.closest('.toc .toc-link[href]'), atlas = lk && !lk.dataset.nav && !offMode() ? atlasOf(lk) : null;
    if (atlas) { e.preventDefault(); openSection(atlas.sec); setMapBook(atlas); return; }   // (an atlas's page: through its map)
    const nav = e.target.closest('.toc-link[data-nav]');
    if (nav) { const s = UIS.byCat.get(nav.dataset.nav); if (s) { e.preventDefault(); openSection(s, s.group === 'research' ? nav.dataset.nav : null); } return; }
    const go = e.target.closest('.toc [data-goto]');   // Books: the whole room; Research: the back bookcase; a research topic: its bay
    if (go) { e.preventDefault(); const g = go.dataset.goto, s = UIS.byId.get(g); if (g === 'books') showBooks(); else if (s && s.group === 'research') openSection(s); else showResearch(); return; }
    if (e.target.closest('#np-info')) { const cur = document.querySelector('#pages .item.is-current') || null; const bk = cur && UIS.bySrc.get(cur.dataset.src); if (bk) openSection(bk.sec); }
  }, true);
}
function atlasOf(a) {   // the atlas whose page a link goes to
  const href = a.getAttribute('href'); if (!href) return null;
  for (const s of UIS.secs) for (const bk of s.books) if (bk.it.href === href && isMapItem(bk.it)) return bk;
  return null;
}
function buildInterface() {
  buildSections(); buildRecordPlayer(); buildOverlay(); bindPicking(); syncActive();
  const pages = document.getElementById('pages');
  let pend = 0; new MutationObserver(() => { if (pend) return; pend = setTimeout(() => { pend = 0; syncActive(); refreshCard(); }, 30); })
    .observe(pages, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true, characterData: true });
}

export { buildInterface, setSpine };
