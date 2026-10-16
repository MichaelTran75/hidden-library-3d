import '../fx/glass.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { R, body } from '../core/base.js';
import { SHELF } from '../world/shelves.js';
import { V3 } from '../core/views.js';

/* ---------------------------------------------------------------- library interface
   Hidden Library keeps its data and its audio engine: its old cards stay in the DOM, hidden, and are driven by
   clicks. This layer reads the categories from them and makes the room the interface. Every book category and every
   research topic is a shelf section with a brass plate, a label and a leader line; a click flies the camera there and
   opens its card; the book that is playing comes off the shelf (in front of the camera while its card is open, on the
   sofa otherwise). The record player stays the page's own, in the sidebar.                                     */
const UIS = { secs: [], byId: new Map(), byCat: new Map(), hover: null, hovers: new Set(), hoverKey: '', open: null, mode: 'home', peek: null, active: null, mapBook: null, touched: new Set(), bySrc: new Map() };   // (mapBook: the atlas taken out and opened, flight.js)
/* The room is organised in two parts. Books: every category is one whole row of the tall shelf on the right wall,
   top to bottom from the row under the 2.8 m board (rows 6, 5, 4, 3 for four categories: around eye level, where the
   rows run nearly level across the screen and each label sits in its own row: G, 15/10/2026; more categories go
   above them, then below). Research: every topic
   (a sub-page of the Research group) is one bay of the low bookcase under the back glass, left to right; with more
   than three topics the bays are split into an upper and a lower half.                                          */
function bookSlot(k) { const row = [6, 5, 4, 3, 7, 8, 2][k]; return row === undefined ? null : { shelf: 'R', cols: [0, 6], rows: [row, row], pick: [3, 3], mid: 3, anchor: 2 }; }
// the books of a bay: the right two thirds of its two upper rows (the left end can sit behind the card), clear of the
// sofa and the plant; its view frames just them
function researchSlot(k, n) {
  if (n <= 3) return { shelf: 'B', cols: [k, k], rows: [2, 6], bookRows: [5, 6], bookCut: 1 / 3 };
  const bay = Math.floor(k / 2); return bay > 2 ? null : { shelf: 'B', cols: [bay, bay], rows: k % 2 ? [2, 3] : [4, 6], bookRows: k % 2 ? [2, 3] : [5, 6], bookCut: 1 / 3 };
}
const PULL = 0.27, PEEK = 0.045;               // how far a book slides out before it leaves the shelf / when its row is hovered
const offMode = () => body.classList.contains('off-mode');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function slotBox(slot) {
  if (slot.shelf === 'R') {   // a shelf row: the plate sits on the board under it, at the anchor column
    const S = SHELF.R, col = i => S.z0 + i * S.cw, za = col(slot.cols[0]), zb = col(slot.cols[1] + 1), ya = 0.1 + slot.rows[0] * S.rh, yb = 0.1 + (slot.rows[1] + 1) * S.rh;
    const zp = col(slot.anchor + 0.5), z0 = col(slot.pick[0]), z1 = col(slot.pick[1] + 1);
    return { ya, yb, w: zb - za, h: yb - ya, normal: new V3(-1, 0, 0), face: new V3(R.xS - 0.004, (ya + yb) / 2, (za + zb) / 2),
      lo: new V3(R.xS - 0.004, ya, za + 0.05), hi: new V3(R.xS - 0.004, ya, zb - 0.05),
      corners: [[ya, za], [ya, zb], [yb, zb], [yb, za]].map(([y, z]) => new V3(R.xS - 0.004, y, z)),
      back: new V3(R.xW - 0.026, (ya + yb) / 2, (za + zb) / 2), plate: new V3(R.xS - 0.004, ya, zp), tag: new V3(R.xS - 0.004, (ya + yb) / 2, zp), focus: new V3(R.xS, (ya + yb) / 2, (z0 + z1) / 2), focusW: z1 - z0, rotY: -Math.PI / 2 };
  }
  // a bay of the back bookcase: the plate sits on the top rail, above the middle of the bay
  const S = SHELF.B, xa = S.X[slot.cols[0]] + 0.03, xb = S.X[slot.cols[1] + 1] - 0.03, ya = 0.1 + slot.rows[0] * S.rh2, yb = 0.1 + (slot.rows[1] + 1) * S.rh2;
  const top = slot.rows[1] >= 6, plate = new V3((xa + xb) / 2, top ? R.caseTop - 0.0225 : yb, top ? S.zf + 0.03 : S.zf + 0.004);
  const br = slot.bookRows || slot.rows, bookY = 0.1 + (br[0] + br[1] + 1) / 2 * S.rh2;   // the middle of the rows its books stand in
  const bookX0 = xa + (xb - xa) * (slot.bookCut || 0) - 0.04, bookX1 = xb + 0.03;                    // and the stretch they take
  return { ya, yb, bookY, bookX0, bookX1, w: xb - xa, h: yb - ya, normal: new V3(0, 0, 1), face: new V3((xa + xb) / 2, (ya + yb) / 2, S.zf + 0.004),
    lo: new V3(Math.max(xa + 0.06, bookX0 + 0.06), ya + 0.06, S.zf + 0.004), hi: new V3(xb - 0.06, yb - 0.06, S.zf + 0.004),
    corners: [[0, ya - 0.012], [1, ya - 0.012], [1, yb + 0.012], [0, yb + 0.012]].map(([k, y]) => new V3(S.X[slot.cols[0] + k * (slot.cols[1] - slot.cols[0] + 1)], y, S.zf + 0.004)), back: new V3((xa + xb) / 2, (ya + yb) / 2, R.zB + 0.012), plate, tag: plate, rotY: 0 };
}
const ZOOM_OUT = 1.5;   // a shelf row is seen from 1.5x the distance that fills the free side (its spine titles still read)
function focusView(sec) {
  const b = sec.box, aspect = innerWidth / innerHeight, fov0 = 40;
  const hfov = 2 * Math.atan(Math.tan(fov0 / 2 * Math.PI / 180) * aspect), span = 2 * Math.tan(hfov / 2);
  // the free side of the screen: right of the card (sidebar + gap + card + gap) to a small margin
  const side = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 290;
  const l = Math.min(0.78, (side + 22 + Math.min(400, innerWidth - side - 44) + 34) / innerWidth), r = 1 - 30 / innerWidth, shift = (l + r) / 2 - 0.5;
  // from the distance at which the section would fill the free side; where the room is too narrow, the lens widens instead
  const back = (d0, dmax) => { const d = d0 * ZOOM_OUT; return d <= dmax ? { dist: d, fov: fov0 } : { dist: dmax, fov: 2 * Math.atan(Math.tan(fov0 / 2 * Math.PI / 180) * d / dmax) * 180 / Math.PI }; };
  if (b.focus) {   // a shelf row: stand back from the wall at the row's height, facing the cells that lend its books
    const { dist, fov } = back((b.focusW + 0.3) / ((r - l) * span), R.xS - R.xL - 0.35);
    return { pos: new V3(R.xS - dist, b.focus.y + 0.05, b.focus.z + 0.3), tgt: new V3(R.xS, b.focus.y, b.focus.z), fov, shift };
  }
  // a bay: close, the stretch of its books filling the free side, level with the rows they stand in
  const dist = THREE.MathUtils.clamp((b.bookX1 - b.bookX0 + 0.12) / ((r - l) * span), 1.3, 4.4), tgt = new V3((b.bookX0 + b.bookX1) / 2, b.bookY, b.face.z);
  const pos = tgt.clone().addScaledVector(b.normal, dist).add(new V3(0, 0.05, 0));
  pos.x = THREE.MathUtils.clamp(pos.x, R.xL + 0.3, R.xS - 0.3);
  return { pos, tgt, fov: fov0, shift };
}
function researchView() { return { pos: new V3(0.55, 1.95, -4.4), tgt: new V3(0.55, 1.8, -8.3), fov: 46, shift: 0 }; }

export { PEEK, PULL, UIS, bookSlot, esc, focusView, offMode, researchSlot, researchView, slotBox };
