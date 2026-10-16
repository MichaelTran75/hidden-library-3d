import './books.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R } from '../core/base.js';
import { boardGeo, place, rand } from '../core/utils.js';
import { MAT } from './materials.js';
import { room } from './room.js';
import { PAL, fillCell } from './books.js';
import { DECOR } from './decor/kit.js';

/* ---------------------------------------------------------------- shelves */
const SHELF = {};
function buildShelves() {
  const parts = [];
  // ---- tall bookshelf on the right wall: columns along z, rows along y
  const z0 = R.zB + 0.02, z1 = R.zF - 0.02, colW = 0.64, rowH = 0.37, dep = R.xW - R.xS, th = 0.028;
  const ncol = Math.round((z1 - z0) / colW), cw = (z1 - z0) / ncol; const nrow = Math.floor((R.H - 0.12) / rowH), rh = (R.H - 0.12) / nrow;
  const backPanel = new THREE.Mesh(boardGeo(0.02, R.H, z1 - z0, 1), MAT.shelfBack); backPanel.position.set(R.xW - 0.01, R.H / 2, (z0 + z1) / 2); backPanel.receiveShadow = true; room.add(backPanel);
  for (let i = 0; i <= ncol; i++) parts.push(place(boardGeo(dep, R.H, th, 1), R.xS + dep / 2, R.H / 2, z0 + i * cw));
  parts.push(place(boardGeo(dep + 0.01, 0.1, z1 - z0, 1), R.xS + dep / 2, 0.05, (z0 + z1) / 2)); // plinth
  for (let j = 1; j <= nrow; j++) parts.push(place(boardGeo(dep, th, z1 - z0, 1), R.xS + dep / 2, 0.1 + j * rh - (j === nrow ? 0.02 : 0), (z0 + z1) / 2));
  const along = new THREE.Vector3(0, 0, 1), out = new THREE.Vector3(-1, 0, 0);
  SHELF.R = { z0, cw, rh, th, dep, ncol, nrow };
  const decorRows = [6, 7, 8, 9];
  for (let i = 0; i < ncol; i++) for (let j = 0; j < nrow; j++) {
    const yb = 0.1 + j * rh + th / 2, len = cw - th, o = new THREE.Vector3(R.xS + 0.01, yb, z0 + i * cw + th / 2);
    const hgt = rh - th;
    if (decorRows.includes(j) && rand() < 0.42) { DECOR.push({ o, along, out, len, hgt, dep, kind: Math.floor(rand() * 6) }); continue; }
    if (j === nrow - 1 && rand() < .3) continue;
    fillCell(o, along, out, len, hgt, dep - 0.03, PAL.modern, { stack: j > 9 ? .08 : .05, cell: { shelf: 'R', i, j } });
  }
  // ---- low bookcases under back and front glass
  for (const [zf, s] of [[R.zB + R.caseD, 1], [R.zF - R.caseD, -1]]) {
    const zc = zf - s * R.caseD / 2; const X = [R.xL, 0.05, 1.15, R.xS];
    parts.push(place(boardGeo(R.xS - R.xL, 0.1, R.caseD, 1), (R.xL + R.xS) / 2, 0.05, zc));
    parts.push(place(boardGeo(R.xS - R.xL + 0.04, 0.045, R.caseD + 0.03, 1), (R.xL + R.xS) / 2, R.caseTop - 0.0225, zc + s * 0.015));
    for (const x of X) { const big = [R.xL, 0.05, 1.15, R.xS].includes(x); parts.push(place(boardGeo(big ? 0.05 : 0.028, R.caseTop, R.caseD, 1), x, R.caseTop / 2, zc)); }
    const rows = 7, rh2 = (R.caseTop - 0.145) / rows;
    if (s > 0) SHELF.B = { X, rh2, zf, th };
    for (let j = 1; j < rows; j++) parts.push(place(boardGeo(R.xS - R.xL, th, R.caseD, 1), (R.xL + R.xS) / 2, 0.1 + j * rh2, zc));
    const along2 = new THREE.Vector3(s, 0, 0), out2 = new THREE.Vector3(0, 0, s);
    for (let i = 0; i < X.length - 1; i++) for (let j = 0; j < rows; j++) {
      const xa = X[i] + 0.025, xb = X[i + 1] - 0.025; const len = xb - xa; const yb = 0.1 + j * rh2 + th / 2;
      const o = new THREE.Vector3(s > 0 ? xa : xb, yb, zf - s * 0.005);
      fillCell(o, along2, out2, len, rh2 - th, R.caseD - 0.03, PAL.old, { stack: .07, gaps: .04, cell: { shelf: s > 0 ? 'B' : 'F', i, j } });
    }
  }
  const shelves = new THREE.Mesh(mergeGeometries(parts), MAT.oak); shelves.castShadow = shelves.receiveShadow = true; room.add(shelves);
}

export { SHELF, buildShelves };
