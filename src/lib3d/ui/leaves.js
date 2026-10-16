import './atlas.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { reduceMotion } from '../core/base.js';
import { canvas } from '../core/utils.js';
import { setNeeds } from '../core/loop.js';
import { DECKR } from './deck.js';
import { HERO_LAYER, heroCanvasTex } from './hero-books.js';
import { pageLang, printTitle } from './book-data.js';

/* ---- a book read in the room (G, 17/10/2026: "[Economic models] book: add animation book open và list of các nước,
   thay vì popup thì đưa vào từng trang sách, click vào thì animation lật tới trang đó"). An item whose notes are the
   page's dialogs (its chips: the economic models of Korea, Japan, Singapore, China and Taiwan) becomes a book of them.
   - Taken out, it opens as the atlases do: on its title page (inside the front board) and its contents (on the right).
     Each note is a chapter on a spread of its own: its title, its picture and its words, set as a book is (a serif at
     the largest size that lets the chapter fill its two pages, ~25 to 35 px on a page 1024 px across).
   - The pages are leaves. Each turns on the front board's hinge, so a turned leaf lies on the endpaper and closes with
     the board. Its fore-edge lifts first and the leaf bows as it goes over (~0.75 s); several in a row are riffled one
     after another.
   - A click on a chapter in the contents, or on its name in the card (which no longer opens the dialog), turns to it.
     A click on the right page turns to the next spread, on the left page to the one before, on a page's "Contents"
     back to the contents.
   - Its pictures are the page's (Wix's, which allows them to be drawn here). Its pages are painted while the book is
     out (in the browser's idle time, the title page and the contents first) and let go when it is back on the shelf. */
const READ = { stagger: 0.12, dur: 0.75, gap: 0.00003, turn: 2.7 };   // (turn: as far as the board opens: flight.js OPEN_TURN)
const SERIF = `Georgia, 'Times New Roman', serif`, INK = '#2c241b', MUTED = '#7d6c56', ACCENT = '#8a3b2a';
const NAMES_EN = { 'Hàn Quốc': 'South Korea', 'Nhật Bản': 'Japan', 'Singapore': 'Singapore', 'Trung Quốc': 'China', 'Đài Loan': 'Taiwan' };
const WORDS = { contents: ['Contents', 'Mục lục'], hint: ['Click a country to turn to its pages', 'Bấm tên một nước để lật tới trang'], end: ['The end', 'Hết'],
  back: ['‹ Contents', '‹ Mục lục'], from: ['From the notes of Hidden Library', 'Từ các ghi chép của Hidden Library'] };
const say = (k, lang) => WORDS[k][lang === 'vi' ? 1 : 0];
const fontOf = (fs, b, i) => `${i ? 'italic ' : ''}${b ? 700 : 400} ${Math.round(fs)}px ${SERIF}`;

/* ---- the chapters: the page's dialogs, read into blocks (a title, a picture, paragraphs of runs of plain or bold
   words, bulleted lists, boxes of them) */
function runsOf(el, bold = false, out = [], href = '') {   // (a link's words keep where it goes, and end in an arrow)
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out.push({ t: n.textContent, b: bold, h: href });
    else if (n.nodeType === 1) {
      if (n.tagName === 'BR') { out.push({ br: true }); continue; }
      const a = n.tagName === 'A' && n.getAttribute('href'); runsOf(n, bold || n.tagName === 'STRONG' || n.tagName === 'B', out, a || href);
      if (a) out.push({ t: ' ↗', b: bold, h: a });
    }
  }
  return out;
}
function blocksOf(root) {
  const out = [];
  for (const el of root.children) {
    const tg = el.tagName;
    if (/^H[1-6]$/.test(tg)) out.push({ k: 'h', text: el.textContent.replace(/\s+/g, ' ').trim() });
    else if (tg === 'IMG') out.push({ k: 'img', src: el.getAttribute('src'), ar: (+el.getAttribute('width') || 16) / (+el.getAttribute('height') || 9) });
    else if (tg === 'UL' || tg === 'OL') out.push({ k: 'ul', items: [...el.children].map(li => runsOf(li)) });
    else if (el.classList.contains('info-box')) out.push({ k: 'box', blocks: blocksOf(el) });
    else if (tg === 'DIV') out.push(...blocksOf(el));
    else if (tg !== 'BUTTON') out.push({ k: 'p', runs: runsOf(el) });
  }
  return out;
}
function chaptersOf(it) {
  const out = [];
  for (const c of it.chips || []) {
    const id = c.el && c.el.dataset ? c.el.dataset.dialog : '', dlg = id ? document.getElementById(id) : null; if (!dlg) continue;
    const blocks = blocksOf(dlg.querySelector('.sheet-body') || dlg), h = blocks.find(b => b.k === 'h');
    out.push({ name: c.label, en: NAMES_EN[c.label] || c.label, title: h ? h.text : c.label, blocks: blocks.filter(b => b !== h) });
  }
  return out;
}
const isReadable = it => chaptersOf(it).length > 0;

/* ---- setting type: runs broken into lines (justified, the last line of a paragraph left as it is), a chapter's
   blocks flowed down its pages */
function wordsOf(runs) {   // words with their weight, and whether a space follows (a word with none before it is kept with the one before)
  const ws = [];
  for (const r of runs) {
    if (r.br) { ws.push({ br: true }); continue; }
    for (const part of r.t.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { if (ws.length) ws[ws.length - 1].sp = true; continue; }
      const prev = ws[ws.length - 1]; ws.push({ t: part, b: r.b, h: r.h, glue: !!(prev && !prev.br && !prev.sp) });
    }
  }
  return ws;
}
function setLines(g, runs, width, fs) {
  const ws = wordsOf(runs), lines = []; let line = [], x = 0;
  const space = b => { g.font = fontOf(fs, b); return g.measureText(' ').width; };
  const end = last => { if (line.length) lines.push({ words: line, w: x, last }); line = []; x = 0; };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]; if (w.br) { end(true); continue; }
    // a word and those glued to it go together
    let j = i, gw = 0; const grp = [];
    do { const v = ws[j]; g.font = fontOf(fs, v.b); const vw = g.measureText(v.t).width; grp.push({ ...v, w: vw }); gw += vw; j++; } while (j < ws.length && ws[j].glue);
    const sp = line.length ? space(line[line.length - 1].b) : 0;
    if (line.length && x + sp + gw > width) end(false);
    for (const v of grp) { v.x = x + (line.length && v === grp[0] ? space(line[line.length - 1].b) : 0); line.push(v); x = v.x + v.w; }
    i = j - 1;
  }
  end(true);
  return lines;
}
function drawLine(g, ln, x0, y, width, fs, color, lk) {   // (lk: where a link's words are, so a click there opens it)
  let gaps = 0; for (let k = 1; k < ln.words.length; k++) if (!ln.words[k].glue) gaps++;
  const extra = !ln.last && gaps ? Math.min((width - ln.w) / gaps, fs * 0.6) : 0;   // (justified; a line far too short is left ragged)
  let add = 0; g.textBaseline = 'alphabetic';
  ln.words.forEach((w, k) => {
    if (k && !w.glue) add += extra; const x = x0 + w.x + add; g.font = fontOf(fs, w.b); g.fillStyle = w.h ? ACCENT : color || INK; g.fillText(w.t, x, y);
    if (w.h) { g.fillRect(x, y + fs * 0.14, w.w + (k < ln.words.length - 1 && ln.words[k + 1].h === w.h ? extra + fs * 0.25 : 0), Math.max(1.5, fs * 0.05)); if (lk) lk(x - 2, y - fs * 0.85, x + w.w + 2, y + fs * 0.3, w.h); }
  });
}
// a chapter flowed down pages: items of a height, drawn at their place; those of a box carry its number
function flowChapter(g, ch, P, fs) {
  const items = [], LH = fs * 1.42, TW = P.tw, PAD = fs * 0.7;
  const gap = (h, box = null) => items.push({ h, box, gap: true });
  const text = (runs, x0, w, box, f = fs, lh = LH, color) => { for (const ln of setLines(g, runs, w, f)) items.push({ h: lh, box, draw: (g, x, y, lang, pic, lk) => drawLine(g, ln, x + x0, y + lh * 0.74, w, f, color, lk) }); };
  // the chapter's country, small and spaced in the accent, over its title
  items.push({ h: fs * 1.5, head: true, draw: (g, x, y, lang) => { g.font = `600 ${Math.round(fs * 0.62)}px ${SERIF}`; g.fillStyle = ACCENT; g.letterSpacing = `${(fs * 0.18).toFixed(1)}px`; g.fillText((lang === 'vi' ? ch.name : ch.en).toUpperCase(), x, y + fs * 0.75); g.letterSpacing = '0px'; } });
  const TF = fs * 1.48; g.font = fontOf(TF, true);
  for (const ln of setLines(g, [{ t: ch.title, b: true }], TW, TF)) items.push({ h: TF * 1.2, draw: (g, x, y) => drawLine(g, { ...ln, last: true }, x, y + TF * 0.92, TW, TF) });
  items.push({ h: fs * 0.55, draw: (g, x, y) => { g.fillStyle = ACCENT; g.fillRect(x, y + fs * 0.2, fs * 2.2, Math.max(2, fs * 0.08)); } });
  gap(fs * 0.5);
  const flow = (blocks, x0, w, box) => {
    for (const b of blocks) {
      if (b.k === 'img') { const h = w / b.ar; items.push({ h: h + fs * 0.8, img: b, draw: (g, x, y, lang, pic) => drawPicture(g, pic, x + x0, y, w, h) }); }
      else if (b.k === 'p') { text(b.runs, x0, w, box); gap(fs * 0.45, box); }
      else if (b.k === 'ul') {
        for (const li of b.items) {
          const lines = setLines(g, li, w - fs * 1.25, fs);
          lines.forEach((ln, k) => items.push({ h: LH, box, draw: (g, x, y, lang, pic, lk) => { if (!k) { g.fillStyle = ACCENT; g.beginPath(); g.arc(x + x0 + fs * 0.42, y + LH * 0.74 - fs * 0.3, fs * 0.13, 0, 7); g.fill(); } drawLine(g, ln, x + x0 + fs * 1.25, y + LH * 0.74, w - fs * 1.25, fs, null, lk); } }));
        }
        gap(fs * 0.35, box);
      } else if (b.k === 'box') {
        const id = items.length + 1; gap(PAD * 0.8, id); flow(b.blocks, x0 + PAD, w - 2 * PAD, id);
        while (items.length && items[items.length - 1].gap && items[items.length - 1].box === id) items.pop();   // (the box ends at its last line)
        gap(PAD * 0.8, id); gap(fs * 0.5);
      }
    }
  };
  flow(ch.blocks, 0, TW, null);
  // onto the pages: an item that does not fit goes over to the next (a gap at the top of a page is dropped)
  const pages = [[]], room = P.y1 - P.y0; let y = 0;
  for (const it of items) {
    if (y + it.h > room && y > 0) { pages.push([]); y = 0; if (it.gap && it.box === null) continue; }
    pages[pages.length - 1].push({ it, y }); y += it.h;
  }
  return pages;
}
function drawPicture(g, pic, x, y, w, h) {
  g.save(); const r = Math.min(12, w * 0.012);
  g.beginPath(); g.roundRect(x, y, w, h, r); g.clip();
  if (pic && pic.complete && pic.naturalWidth) g.drawImage(pic, x, y, w, h);
  else { g.fillStyle = 'rgba(120, 96, 60, 0.12)'; g.fillRect(x, y, w, h); }
  g.restore(); g.strokeStyle = 'rgba(60, 44, 24, 0.18)'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(x, y, w, h, r); g.stroke();
}

/* ---- the pages. A page's picture is drawn as it is read: the gutter (the spine side) toward the middle of the open book,
   its edge shaded; the turned leaf's back is shown mirrored in the shader so it reads the right way round */
function pagePaper(g, W, H, gutterLeft) {
  g.fillStyle = '#f4ecd8'; g.fillRect(0, 0, W, H);
  const gx = gutterLeft ? 0 : W, gr = g.createLinearGradient(gx, 0, gutterLeft ? W * 0.12 : W * 0.88, 0);
  gr.addColorStop(0, 'rgba(96, 70, 36, 0.20)'); gr.addColorStop(0.35, 'rgba(96, 70, 36, 0.06)'); gr.addColorStop(1, 'rgba(96, 70, 36, 0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const ex = gutterLeft ? W : 0, er = g.createLinearGradient(ex, 0, gutterLeft ? W * 0.96 : W * 0.04, 0);
  er.addColorStop(0, 'rgba(96, 70, 36, 0.07)'); er.addColorStop(1, 'rgba(96, 70, 36, 0)'); g.fillStyle = er; g.fillRect(0, 0, W, H);
}
function frameOf(W, H, gutterLeft) {   // a page's text block
  const inner = W * 0.1, outer = W * 0.075, x0 = gutterLeft ? inner : outer;
  return { x0, tw: W - inner - outer, y0: H * 0.088, y1: H - H * 0.082, head: H * 0.05, foot: H - H * 0.04 };
}
function runningHead(g, P, W, left, right, fs, leftColor) {
  g.font = `500 ${Math.round(fs * 0.6)}px ${SERIF}`; g.fillStyle = leftColor || MUTED; g.letterSpacing = `${(fs * 0.12).toFixed(1)}px`;
  if (left) { g.textAlign = 'left'; g.fillText(left.toUpperCase(), P.x0, P.head); } g.fillStyle = MUTED;
  if (right) { g.textAlign = 'right'; g.fillText(right.toUpperCase(), P.x0 + P.tw, P.head); }
  g.letterSpacing = '0px'; g.textAlign = 'left';
  g.fillStyle = 'rgba(125, 108, 86, 0.45)'; g.fillRect(P.x0, P.head + fs * 0.42, P.tw, 1.5);
}
function folio(g, P, n, rightPage, fs) {
  g.font = `400 ${Math.round(fs * 0.68)}px ${SERIF}`; g.fillStyle = MUTED; g.textAlign = rightPage ? 'right' : 'left';
  g.fillText(String(n), rightPage ? P.x0 + P.tw : P.x0, P.foot); g.textAlign = 'left';
}
// a link on a page: where (in the page's pixels) and where it leads
const linkAt = (face, x0, y0, x1, y1, go) => face.links.push({ x0, y0, x1, y1, go });

function paintContents(face, R, lang) {
  const { c, W, H } = face, g = c.getContext('2d'), P = frameOf(W, H, true), fs = W * 0.034; face.links = [];
  pagePaper(g, W, H, true);
  g.textAlign = 'center'; g.fillStyle = ACCENT; g.font = `600 ${Math.round(fs * 0.7)}px ${SERIF}`; g.letterSpacing = `${(fs * 0.3).toFixed(1)}px`;
  g.fillText(say('contents', lang).toUpperCase(), P.x0 + P.tw / 2, P.y0 + fs * 0.6); g.letterSpacing = '0px';
  g.fillStyle = 'rgba(138, 59, 42, 0.5)'; g.fillRect(P.x0 + P.tw / 2 - fs * 1.4, P.y0 + fs * 1.15, fs * 2.8, 2);
  g.font = `italic 400 ${Math.round(fs * 1.25)}px ${SERIF}`; g.fillStyle = INK; g.fillText(R.title, P.x0 + P.tw / 2, P.y0 + fs * 3.0);
  g.textAlign = 'left';
  // the chapters: number, country, its title in italics under it, a leader of dots to its first page
  let y = P.y0 + fs * 5.2; const step = Math.min(fs * 3.5, (P.y1 - fs * 3 - y) / Math.max(1, R.ch.length));
  R.ch.forEach((ch, k) => {
    const name = lang === 'vi' ? ch.name : ch.en, pg = String(2 * (k + 1)), top = y;
    g.font = `400 ${Math.round(fs * 0.9)}px ${SERIF}`; g.fillStyle = ACCENT; g.fillText(String(k + 1).padStart(2, '0'), P.x0, y + fs);
    g.font = fontOf(fs * 1.12, true); g.fillStyle = INK; const nx = P.x0 + fs * 1.9; g.fillText(name, nx, y + fs);
    const nw = g.measureText(name).width; g.font = fontOf(fs, false); g.textAlign = 'right'; g.fillText(pg, P.x0 + P.tw, y + fs); const pw = g.measureText(pg).width; g.textAlign = 'left';
    g.fillStyle = 'rgba(125, 108, 86, 0.65)'; for (let x = nx + nw + fs * 0.5; x < P.x0 + P.tw - pw - fs * 0.5; x += fs * 0.45) { g.beginPath(); g.arc(x, y + fs * 0.92, fs * 0.05, 0, 7); g.fill(); }
    g.font = fontOf(fs * 0.78, false, true); g.fillStyle = MUTED; let t = ch.title; while (g.measureText(t).width > P.tw - fs * 1.9 && t.length > 8) t = t.slice(0, -2).trimEnd() + '…';
    g.fillText(t, nx, y + fs * 2.05);
    linkAt(face, P.x0 - fs * 0.4, top - fs * 0.25, P.x0 + P.tw + fs * 0.4, top + step - fs * 0.3, k + 1);
    y += step;
  });
  g.font = fontOf(fs * 0.72, false, true); g.fillStyle = MUTED; g.textAlign = 'center'; g.fillText(say('hint', lang) + ' →', P.x0 + P.tw / 2, P.y1 - fs * 0.4); g.textAlign = 'left';
  folio(g, P, 1, true, fs);
}
function paintChapter(face, R, lang) {
  const { c, W, H, ch, part } = face, g = c.getContext('2d'), right = part === 1, P = frameOf(W, H, right), k = R.ch.indexOf(ch);
  const lay = layoutOf(R, ch, P, g), pics = R.pics, fs = lay.fs; face.links = [];
  pagePaper(g, W, H, right);
  const name = lang === 'vi' ? ch.name : ch.en, fsH = W * 0.03;
  if (right) runningHead(g, P, W, '', R.title, fsH); else runningHead(g, P, W, say('back', lang), name, fsH, ACCENT);   // (the way back to the contents, in the accent)
  if (!right) { g.font = `500 ${Math.round(fsH * 0.6)}px ${SERIF}`; g.letterSpacing = `${(fsH * 0.12).toFixed(1)}px`; linkAt(face, P.x0 - fsH * 0.5, P.head - fsH * 1.2, P.x0 + g.measureText(say('back', lang).toUpperCase()).width + fsH * 0.6, P.head + fsH * 0.6, 0); g.letterSpacing = '0px'; }
  // the boxes behind their lines, then the lines
  const placed = lay.pages[part] || [];
  for (let i = 0; i < placed.length;) {
    const b = placed[i].it.box; if (!b) { i++; continue; }
    let j = i; while (j + 1 < placed.length && placed[j + 1].it.box === b) j++;
    const y0 = P.y0 + placed[i].y, y1 = P.y0 + placed[j].y + placed[j].it.h;
    g.fillStyle = 'rgba(150, 112, 58, 0.085)'; g.beginPath(); g.roundRect(P.x0 - fs * 0.15, y0, P.tw + fs * 0.3, y1 - y0, fs * 0.35); g.fill();
    g.fillStyle = 'rgba(138, 59, 42, 0.55)'; g.fillRect(P.x0 - fs * 0.15, y0 + fs * 0.25, Math.max(3, fs * 0.1), y1 - y0 - fs * 0.5);
    i = j + 1;
  }
  const lk = (x0, y0, x1, y1, href) => face.links.push({ x0, y0, x1, y1, href });
  for (const { it, y } of placed) if (it.draw) it.draw(g, P.x0, P.y0 + y, lang, it.img ? pics.get(it.img.src) : null, lk);
  const n = 2 * (k + 1) + part; folio(g, P, n, right, fsH);
  // the corners turn the page: drawn as a quiet arrow by the folio
  g.font = `400 ${Math.round(fsH * 0.95)}px ${SERIF}`; g.fillStyle = MUTED; g.textAlign = right ? 'right' : 'left';
  if (right && k < R.ch.length - 1) g.fillText('›', P.x0 + P.tw - fsH * 1.6, P.foot);
  if (!right) g.fillText('‹', P.x0 + fsH * 1.6, P.foot);
  g.textAlign = 'left';
}
function paintEnd(face, R, lang) {
  const { c, W, H } = face, g = c.getContext('2d'), fs = W * 0.034; face.links = [];
  pagePaper(g, W, H, false);
  g.textAlign = 'center'; g.fillStyle = MUTED; g.font = fontOf(fs * 0.9, false, true); g.fillText('— ' + say('end', lang) + ' —', W * 0.46, H * 0.48); g.textAlign = 'left';
}
// the title page, printed on the endpaper inside the front board: a double rule, the book's name, its chapters
function paintTitlePage(R, lang) {
  const { c, W, H } = R.title_, g = c.getContext('2d'), fs = W * 0.042;
  g.fillStyle = '#efe5cf'; g.fillRect(0, 0, W, H);
  const gr = g.createLinearGradient(W, 0, W * 0.86, 0); gr.addColorStop(0, 'rgba(96, 70, 36, 0.22)'); gr.addColorStop(1, 'rgba(96, 70, 36, 0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const m = W * 0.09; g.strokeStyle = 'rgba(138, 59, 42, 0.6)'; g.lineWidth = 3; g.strokeRect(m, m, W - 2 * m - W * 0.03, H - 2 * m); g.lineWidth = 1.2; g.strokeRect(m + 12, m + 12, W - 2 * m - W * 0.03 - 24, H - 2 * m - 24);
  const cx = (W - W * 0.03) / 2; g.textAlign = 'center';
  g.fillStyle = MUTED; g.font = `600 ${Math.round(fs * 0.55)}px ${SERIF}`; g.letterSpacing = `${(fs * 0.3).toFixed(1)}px`; g.fillText('HIDDEN LIBRARY', cx, H * 0.2); g.letterSpacing = '0px';
  g.fillStyle = INK; let size = fs * 1.9; g.font = fontOf(size, true); while (g.measureText(R.title).width > W * 0.68 && size > fs) { size -= 2; g.font = fontOf(size, true); }
  g.fillText(R.title, cx, H * 0.36);
  g.fillStyle = ACCENT; g.beginPath(); for (const [dx, s] of [[-fs * 1.1, 0.5], [0, 1], [fs * 1.1, 0.5]]) { g.moveTo(cx + dx, H * 0.41 - fs * 0.22 * s); g.lineTo(cx + dx + fs * 0.22 * s, H * 0.41); g.lineTo(cx + dx, H * 0.41 + fs * 0.22 * s); g.lineTo(cx + dx - fs * 0.22 * s, H * 0.41); } g.fill();
  g.font = fontOf(fs * 0.82, false, true); g.fillStyle = INK;
  R.ch.forEach((ch, k) => g.fillText(lang === 'vi' ? ch.name : ch.en, cx, H * 0.5 + k * fs * 1.35));
  g.font = fontOf(fs * 0.55, false, true); g.fillStyle = MUTED; g.fillText(say('from', lang), cx, H * 0.86);
  g.textAlign = 'left';
}
// a chapter's type size: the largest (35 px to a page 1024 across, down to 20) at which it fills no more than its two pages
function layoutOf(R, ch, P, g) {
  const key = `${R.W}`; if (ch.lay && ch.lay.key === key) return ch.lay;
  let lay = null;
  for (let fs = R.W * 0.034; fs >= R.W * 0.0195; fs -= R.W * 0.001) { const pages = flowChapter(g, ch, P, fs); lay = { key, fs, pages }; if (pages.length <= 2) break; }
  ch.lay = lay; return lay;
}

/* ---- the leaves: a strip from the gutter to the fore-edge, turned in the shader about the board's hinge (in metres:
   uSize), by uPhi, the fore-edge ahead or behind by uBend (it bows), never past the board (uMax); their front shows
   the page on the right, their back (mirrored) the one on the left */
const LEAF_VS = `attribute float aU; uniform float uPhi, uBend, uMax; uniform vec2 uHinge; uniform vec3 uSize;
  vec2 leafTurn(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
  float leafAngle() { return clamp(uPhi + uBend * pow(aU, 1.5), 0.0, uMax); }\n`;
function leafMaterial(R, L, base) {
  const m = new THREE.MeshStandardMaterial({ ...base, map: R.blank, emissiveIntensity: 0.14, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  m.customProgramCacheKey = () => 'hero-leaf';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, L.u, { uHinge: R.flapU.uHinge, uSize: R.flapU.uSize, uDepth: DECKR.u.uDepth, uFull: DECKR.u.uFull, uOff: DECKR.u.uOff });
    sh.vertexShader = LEAF_VS + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  { vec3 fn = objectNormal / uSize; fn.xz = leafTurn(fn.xz, leafAngle()); objectNormal = normalize(fn * uSize); }')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  { vec3 fp = transformed * uSize; fp.xz = uHinge + leafTurn(fp.xz - uHinge, leafAngle()); transformed = fp / uSize; }');
    sh.fragmentShader = 'uniform sampler2D uDepth, uVerso; uniform vec2 uFull, uOff;\n' + sh.fragmentShader
      .replace('void main() {', 'void main() {\n  if (gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;')
      .replace('#include <map_fragment>', 'diffuseColor *= gl_FrontFacing ? texture2D(map, vMapUv) : texture2D(uVerso, vec2(1.0 - vMapUv.x, vMapUv.y));')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= diffuseColor.rgb;');
  };
  return m;
}
function leafStrip(bk, pg, x) {   // in the unit box (the hero is scaled by the book's size), facing +x (its front)
  const n = 30, pos = [], nor = [], uv = [], au = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, z = pg.z0 + (pg.z1 - pg.z0) * u;
    for (const [y, v] of [[pg.y0, 0], [pg.y1, 1]]) { pos.push(x / bk.t, y / bk.h, z / bk.d); nor.push(1, 0, 0); uv.push(u, v); au.push(u); }
  }
  for (let i = 0; i < n; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const geo = new THREE.BufferGeometry(); geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('aU', new THREE.Float32BufferAttribute(au, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0.5, -0.5), 2);   // (it turns out of its box in the shader)
  return geo;
}

/* ---- the book: its chapters, faces (0: the contents; 2k−1 and 2k: chapter k's two pages; the last: the end), leaves
   (leaf i shows face 2(i−1) on its front and 2i−1 on its back) and title page */
function buildRead(bk, shape, mesh, base) {
  const ch = chaptersOf(bk.it); if (!ch.length) return null;
  const pg = shape.page, W = 1024, H = Math.round(W * (pg.y1 - pg.y0) / (pg.z0 - pg.z1));
  const blank = canvas(8, 8), bg = blank.getContext('2d'); bg.fillStyle = '#f4ecd8'; bg.fillRect(0, 0, 8, 8);
  const R = { bk, ch, W, H, shape, spread: 0, pending: null, open: false, flapU: bk.flapU, title: printTitle(bk.it), faces: [], leaves: [], pics: new Map(), blank: heroCanvasTex(blank, true) };
  const nf = 2 * ch.length + 2;
  for (let f = 0; f < nf; f++) R.faces.push({ f, W, H, c: null, tex: null, links: [], done: '', ch: f && f < nf - 1 ? ch[Math.ceil(f / 2) - 1] : null, part: f && f < nf - 1 ? (f % 2 ? 0 : 1) : -1 });
  // the leaves, stacked on the page block (the first on top); turned, the same offsets put them on the endpaper in the
  // reverse order (the first underneath)
  const nl = ch.length + 1;
  for (let i = 0; i < nl; i++) {
    const L = { i, phi: 0, bend: 0, from: 0, to: 0, t0: null, dur: 1, dir: 1, u: { uPhi: { value: 0 }, uBend: { value: 0 }, uMax: { value: 0 }, uVerso: { value: R.blank } } };
    L.mat = leafMaterial(R, L, base);
    L.mesh = new THREE.Mesh(leafStrip(bk, pg, pg.x + (nl - i) * READ.gap), L.mat); L.mesh.layers.set(HERO_LAYER); L.mesh.frustumCulled = false;
    mesh.add(L.mesh); R.leaves.push(L);
  }
  // the title page on the endpaper (its picture from the fore-edge to the joint, up from the foot)
  const EW = 768, EH = Math.round(EW * bk.h / shape.endW); R.title_ = { c: canvas(EW, EH), W: EW, H: EH };
  R.endTex = heroCanvasTex(R.title_.c, true);
  R.endMat = new THREE.MeshStandardMaterial({ ...base, map: R.endTex, emissiveMap: R.endTex, emissiveIntensity: 0.1, roughness: 0.9, metalness: 0 });
  R.pending = bk.readWant !== undefined && bk.readWant !== null ? bk.readWant : null; bk.readWant = null;   // (a chapter asked for before the book was made)
  bk.read = R; return R;
}
function facePaint(R, f) {   // a face painted (again if the language changed), its texture given to its leaf
  const F = R.faces[f], lang = pageLang(); if (!F || F.done === lang) return;
  if (!F.c) { F.c = canvas(F.W, F.H); F.tex = heroCanvasTex(F.c, true); F.tex.generateMipmaps = false; F.tex.minFilter = THREE.LinearFilter; }
  if (f === 0) paintContents(F, R, lang); else if (F.ch) paintChapter(F, R, lang); else paintEnd(F, R, lang);
  F.done = lang; F.tex.needsUpdate = true;
  const L = R.leaves[f % 2 ? (f + 1) / 2 - 1 : f / 2];
  if (f % 2) L.u.uVerso.value = F.tex; else { L.mat.map = F.tex; L.mat.needsUpdate = true; }
  // its pictures, once loaded, paint it again
  if (F.ch) for (const b of F.ch.blocks) if (b.k === 'img' && !R.pics.has(b.src)) {
    const im = new Image(); im.crossOrigin = 'anonymous'; R.pics.set(b.src, im);
    im.onload = () => { for (const G of R.faces) if (G.ch === F.ch && G.done) { G.done = ''; facePaint(R, G.f); } setNeeds(true); };
    im.src = b.src.replace(/w_\d+,h_\d+/, `w_1000,h_${Math.round(1000 / b.ar)}`);
  }
  setNeeds(true);
}
function titlePaint(R) { const lang = pageLang(); if (R.titleDone === lang) return; paintTitlePage(R, lang); R.titleDone = lang; R.endTex.needsUpdate = true; setNeeds(true); }
// as the book starts to open: its title page and contents now, the rest in the browser's idle time
function readOpening(bk) {
  const R = bk.read; if (!R || R.painting) return; R.painting = true;
  titlePaint(R); facePaint(R, 0); facePaint(R, 1); facePaint(R, 2);
  const next = () => { if (!bk.read || !R.painting) return; const F = R.faces.find(F => F.done !== pageLang()); if (!F) return; facePaint(R, F.f); (window.requestIdleCallback || (f => setTimeout(f, 60)))(next, { timeout: 400 }); };
  next();
}
// back on its shelf: its pages let go (painted again when it next comes out), closed on its contents
function readRelease(bk) {
  const R = bk.read; if (!R) return; R.painting = false; R.open = false; R.pending = null; R.spread = 0;
  for (const F of R.faces) { if (F.tex) F.tex.dispose(); if (F.c) { F.c.width = F.c.height = 0; } F.c = F.tex = null; F.done = ''; }
  for (const L of R.leaves) { L.phi = L.from = L.to = L.bend = 0; L.t0 = null; L.u.uPhi.value = L.u.uBend.value = 0; L.u.uVerso.value = R.blank; L.mat.map = R.blank; L.mat.needsUpdate = true; }
  for (const im of R.pics.values()) im.onload = null; R.pics.clear();
}
function readDispose(bk) {
  const R = bk.read; if (!R) return; readRelease(bk);
  for (const L of R.leaves) { L.mesh.geometry.dispose(); L.mat.dispose(); }
  R.blank.dispose(); R.endTex.dispose(); R.endMat.dispose(); bk.read = null;
}
// turn to a spread (0: the contents; k: chapter k): the leaves between turn, one after another
function readTurnTo(bk, s) {
  const R = bk.read; if (!R) { bk.readWant = s; return; }
  s = THREE.MathUtils.clamp(s, 0, R.ch.length); if (!R.open) { R.pending = s; return; }
  for (const f of [2 * s - 1, 2 * s]) if (f >= 0) facePaint(R, f);
  const now = performance.now() / 1000, go = [];
  R.leaves.forEach((L, i) => { const want = i < s ? READ.turn : 0; if (L.to !== want) go.push([L, want]); });
  if (go.length && go[0][1] === 0) go.reverse();   // (turning back: the last turned goes first)
  go.forEach(([L, want], k) => {
    for (const f of [2 * L.i, 2 * L.i + 1]) facePaint(R, f);
    L.from = L.phi; L.to = want; L.dir = Math.sign(want - L.phi) || 1; L.t0 = now + k * READ.stagger * (reduceMotion ? 0 : 1);
    L.dur = reduceMotion ? 0.001 : READ.dur * Math.max(0.35, Math.abs(want - L.phi) / READ.turn);
  });
  R.spread = s; setNeeds(true);
}
// each frame: the leaves' turns; the board's angle (opening or closing) bounds them; true while any moves
function stepRead(bk) {
  const R = bk.read; if (!R) return false;
  const now = performance.now() / 1000, open = bk.flapU.uOpen.value; let moving = false;
  R.open = open >= READ.turn - 1e-3;
  if (R.open && R.pending !== null) { const s = R.pending; R.pending = null; readTurnTo(bk, s); }
  for (const L of R.leaves) {
    if (L.t0 !== null) {
      moving = true;
      if (now >= L.t0) {
        const p = Math.min(1, (now - L.t0) / L.dur), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        L.phi = L.from + (L.to - L.from) * e; L.bend = L.dir * 0.55 * Math.sin(Math.PI * p);
        if (p >= 1) { L.phi = L.to; L.bend = 0; L.t0 = null; }
      }
    }
    L.u.uPhi.value = L.phi; L.u.uBend.value = L.bend; L.u.uMax.value = open;
  }
  return moving;
}
const readTurning = bk => !!(bk.read && bk.read.leaves.some(L => L.t0 !== null));
// where a ray (in the book's frame, metres) meets the open book: the right page (the top leaf not turned, or the block
// under them), the left (the top leaf turned, or the title page on the board), or the board: and a link there
function readHit(bk, o, d) {
  const R = bk.read, S = R && R.shape; if (!S || bk.flapU.uOpen.value < 1.2) return null;
  const pg = S.page, a = bk.flapU.uOpen.value, H = S.hinge, hits = [];
  if (Math.abs(d.x) > 1e-9) {
    const t = (pg.x - o.x) / d.x, y = o.y + d.y * t, z = o.z + d.z * t;
    if (t > 0 && y > pg.y0 && y < pg.y1 && z < pg.z0 && z > pg.z1) hits.push({ side: 'right', t, u: (pg.z0 - z) / (pg.z0 - pg.z1), v: (y - pg.y0) / (pg.y1 - pg.y0) });
  }
  const nx = Math.cos(a), nz = Math.sin(a), den = d.x * nx + d.z * nz;
  if (Math.abs(den) > 1e-9) {   // the board turned open, and what lies on it: the point turned back to where it was says where on the leaf
    const t = ((H.x - o.x) * nx + (H.y - o.z) * nz + (pg.x - H.x)) / den, x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;   // (the plane the turned leaves lie in)
    const c = Math.cos(-a), s = Math.sin(-a), rx = c * (x - H.x) - s * (z - H.y), rz = s * (x - H.x) + c * (z - H.y), z0 = H.y + rz;
    if (t > 0 && y > 0 && y < bk.h && z0 < 0.002 && z0 > -bk.d) {
      const onLeaf = z0 < pg.z0 && z0 > pg.z1 && y > pg.y0 && y < pg.y1;
      hits.push({ side: onLeaf && R.spread > 0 ? 'left' : 'cover', t, u: (pg.z0 - z0) / (pg.z0 - pg.z1), v: (y - pg.y0) / (pg.y1 - pg.y0), rx });
    }
  }
  const h = hits.sort((p, q) => p.t - q.t)[0]; if (!h) return null;
  if (h.side === 'cover') return h;
  const f = h.side === 'right' ? 2 * R.spread : 2 * R.spread - 1, F = R.faces[f];
  const px = (h.side === 'right' ? h.u : 1 - h.u) * R.W, py = (1 - h.v) * R.H;
  h.face = f; h.link = F ? F.links.find(l => px >= l.x0 && px <= l.x1 && py >= l.y0 && py <= l.y1) || null : null;
  return h;
}
// what a click there does: a link turns to its spread; the right page to the next, the left to the one before; the
// board puts the book back (the caller)
function readClick(bk, h) {
  const R = bk.read; if (!R || readTurning(bk)) return true;
  if (h.link) { if (h.link.href) window.open(h.link.href, '_blank', 'noopener'); else readTurnTo(bk, h.link.go); }
  else if (h.side === 'right') { if (R.spread < R.ch.length) readTurnTo(bk, R.spread + 1); }
  else if (h.side === 'left') readTurnTo(bk, R.spread - 1);
  else return false;
  return true;
}
// the words for the pointer's tip there
function readHint(bk, h) {
  const R = bk.read; if (!R || !h) return null;
  if (h.link && h.link.href) return ['Open the link ↗', 'Mở liên kết ↗'];
  if (h.link) { const s = h.link.go, ch = R.ch[s - 1]; return s ? ['Turn to ' + ch.en, 'Lật tới ' + ch.name] : ['Back to the contents', 'Về mục lục']; }
  if (h.side === 'right') return R.spread < R.ch.length ? ['Click to turn the page', 'Bấm để lật trang'] : null;
  if (h.side === 'left') return ['Click to turn back', 'Bấm để lật lại'];
  return ['Click to put it back', 'Bấm để cất sách'];
}
function relabelRead(bk) { const R = bk.read; if (!R || !R.painting) return; titlePaint(R); for (const f of [2 * R.spread - 1, 2 * R.spread]) if (f >= 0) facePaint(R, f); R.painting = false; readOpening(bk); }

export { buildRead, isReadable, readClick, readDispose, readHint, readHit, readOpening, readRelease, readTurning, relabelRead, stepRead, readTurnTo };
