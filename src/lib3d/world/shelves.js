import './books.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R } from '../core/base.js';
import { boardGeo, place, rand } from '../core/utils.js';
import { MAT } from './materials.js';
import { room } from './room.js';
import { BOOK, PAL, fillCell, rowOfBooks } from './books.js';
import { DECOR } from './decor/kit.js';
import { paintLightly } from '../fx/post.js';

/* ---------------------------------------------------------------- shelves */
const SHELF = {};
function buildShelves() {
  const parts = [];
  // ---- tall bookshelf on the right wall: columns along z, rows along y
  const z0 = R.zB + 0.02, z1 = R.zF - 0.02, colW = 0.64, rowH = 0.37, dep = R.xW - R.xS, th = 0.028;
  const ncol = Math.round((z1 - z0) / colW), cw = (z1 - z0) / ncol; const nrow = Math.floor((R.H - 0.12) / rowH), rh = (R.H - 0.12) / nrow;
  const backPanel = new THREE.Mesh(boardGeo(0.02, R.H, z1 - z0, 1), MAT.shelfBack); backPanel.position.set(R.xW - 0.01, R.H / 2, (z0 + z1) / 2); backPanel.receiveShadow = true; room.add(backPanel); paintLightly(backPanel, 0.1);   // (G, 18/10/2026: "kệ sách và toàn bộ sách 10% less water color")
  for (let i = 0; i <= ncol; i++) parts.push(place(boardGeo(dep, R.H, th, 1, RND), R.xS + dep / 2, R.H / 2, z0 + i * cw));
  parts.push(place(boardGeo(dep + 0.01, 0.1, z1 - z0, 1, RND), R.xS + dep / 2, 0.05, (z0 + z1) / 2)); // plinth
  for (let j = 1; j <= nrow; j++) {
    const y = 0.1 + j * rh - (j === nrow ? 0.02 : 0);
    if (j === CLOCK_CELL.j + 1) {   // (the board over the clock's lower cell: out of its column, the two cells one: clock.js)
      const za = z0 + CLOCK_CELL.i * cw, zb = z0 + (CLOCK_CELL.i + 1) * cw;
      parts.push(place(boardGeo(dep, th, za - z0, 1, RND), R.xS + dep / 2, y, (z0 + za) / 2), place(boardGeo(dep, th, z1 - zb, 1, RND), R.xS + dep / 2, y, (zb + z1) / 2));
    } else parts.push(place(boardGeo(dep, th, z1 - z0, 1, RND), R.xS + dep / 2, y, (z0 + z1) / 2));
  }
  const along = new THREE.Vector3(0, 0, 1), out = new THREE.Vector3(-1, 0, 0);
  SHELF.R = { z0, cw, rh, th, dep, ncol, nrow };
  const decorRows = [6, 7, 8, 9];
  for (let i = 0; i < ncol; i++) for (let j = 0; j < nrow; j++) {
    const yb = 0.1 + j * rh + th / 2, len = cw - th, o = new THREE.Vector3(R.xS + 0.01, yb, z0 + i * cw + th / 2);
    const hgt = rh - th;
    if (decorRows.includes(j) && rand() < 0.42) { DECOR.push({ o, along, out, len, hgt, dep, kind: Math.floor(rand() * 6), skip: i === CLOCK_CELL.i && (j === CLOCK_CELL.j || j === CLOCK_CELL.j + 1) }); continue; }   // (skip: the clock's cells, clock.js)
    if (j === nrow - 1 && rand() < .3) continue;
    fillCell(o, along, out, len, hgt, dep - 0.03, PAL.modern, { stack: j > 9 ? .08 : .05, cell: { shelf: 'R', i, j } });
  }
  const nTall = parts.length;   // (the parts after these are the low bookcases')
  // ---- low bookcases under back and front glass
  for (const [zf, s] of [[R.zB + R.caseD, 1], [R.zF - R.caseD, -1]]) {
    const zc = zf - s * R.caseD / 2; const X = [R.xL, 0.05, 1.15, R.xS];
    parts.push(place(boardGeo(R.xS - R.xL, 0.1, R.caseD, 1, RND), (R.xL + R.xS) / 2, 0.05, zc));
    parts.push(place(boardGeo(R.xS - R.xL + 0.04, 0.045, R.caseD + 0.03, 1, RND), (R.xL + R.xS) / 2, R.caseTop - 0.0225, zc + s * 0.015));
    for (const x of X) { const big = [R.xL, 0.05, 1.15, R.xS].includes(x); parts.push(place(boardGeo(big ? 0.05 : 0.028, R.caseTop, R.caseD, 1, RND), x, R.caseTop / 2, zc)); }
    const rows = 7, rh2 = (R.caseTop - 0.145) / rows;
    if (s > 0) SHELF.B = { X, rh2, zf, th };
    for (let j = 1; j < rows; j++) parts.push(place(boardGeo(R.xS - R.xL, th, R.caseD, 1, RND), (R.xL + R.xS) / 2, 0.1 + j * rh2, zc));
    const along2 = new THREE.Vector3(s, 0, 0), out2 = new THREE.Vector3(0, 0, s);
    for (let i = 0; i < X.length - 1; i++) for (let j = 0; j < rows; j++) {
      const xa = X[i] + 0.025, xb = X[i + 1] - 0.025; const len = xb - xa; const yb = 0.1 + j * rh2 + th / 2;
      const o = new THREE.Vector3(s > 0 ? xa : xb, yb, zf - s * 0.005), n0 = BOOK.list.length, cell = { shelf: s > 0 ? 'B' : 'F', i, j };
      fillCell(o, along2, out2, len, rh2 - th, R.caseD - 0.03, PAL.old, { stack: .07, gaps: .04, cell });
      if (s > 0 && i === B7_CELL.i && j === B7_CELL.j) {   // (the 747 stands there: its books put away, a row of others at its left end: b747.js)
        for (let k = n0; k < BOOK.list.length; k++) { BOOK.list[k].m.makeScale(0, 0, 0); BOOK.list[k].hidden = true; }
        rowOfBooks(cell, B7_CELL.books, 747);
      }
    }
  }
  // the cells darker toward their backs, as little of the room's light reaches in there; the boards' undersides darker
  // still (vertex colours: 1 at a cell's front, CAVE at its back). The tall shelf's front is x = R.xS, a low case's z = zf.
  parts.forEach((g, j) => {
    const p = g.attributes.position, n = g.attributes.normal, c = new Float32Array(p.count * 3);
    g.computeBoundingBox(); const back = (g.boundingBox.min.z + g.boundingBox.max.z) / 2 < (R.zB + R.zF) / 2, zf = back ? R.zB + R.caseD : R.zF - R.caseD;
    for (let i = 0; i < p.count; i++) {
      const t = j < nTall ? (p.getX(i) - R.xS) / dep : (back ? zf - p.getZ(i) : p.getZ(i) - zf) / R.caseD;
      const k = (1 - (1 - CAVE) * Math.pow(THREE.MathUtils.clamp(t, 0, 1), 0.8)) * (n.getY(i) < -0.6 ? 0.8 : 1);
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  });
  MAT.shelfOak.vertexColors = true;
  const shelves = new THREE.Mesh(mergeGeometries(parts), MAT.shelfOak); paintLightly(shelves, 0.1, 0.85);   // (10 % less watercolour, near 75 %, then each 10 % less again: G, 18/10/2026: "kệ sách và toàn bộ sách 10% less water color")
  shelves.castShadow = shelves.receiveShadow = true; room.add(shelves);
}

const RND = 0.004, CAVE = 0.5;   // the boards' edges rounded off 4 mm; the light left at the back of a cell (G, 18/10/2026: the shelves made realistic)
const B7_CELL = { i: 0, j: 4, books: 0.4 };
const CLOCK_CELL = { i: 3, j: 6 };   // the medieval clock's place: the tall shelf's 4th column, rows 6 and 7 made one cell (clock.js)   // the cell the 747 stands in (the back bookcase's left bay, its middle row: b747.js), and the books kept at its left end (m)

export { B7_CELL, CLOCK_CELL, SHELF, buildShelves };
