import '../shelves.js';   // build order: the module before this one runs first
import * as THREE from 'three';

/* ---------------------------------------------------------------- decor on shelves
   Every decorated cell of the tall shelf holds a piece of its own, no two alike: a catalogue of vessels, pictures,
   figures, instruments, plants and small things is shuffled and dealt one per cell. Each piece is built in its own
   frame (x along the shelf, y up, +z toward the room; a cell leaves it about ±0.28 wide, 0.32 high, −0.2..+0.14 deep)
   from turned, box and sphere parts coloured per vertex. All the pieces are then merged by finish into five meshes
   (matte, glazed, metal, glass, pictures): the whole shelf of them costs five draw calls, and a new piece costs none.
   The pictures, the globe's map, the clock's dial, the plate's pattern and the radio's cloth share one canvas.  */
const DECOR = [];
const DK_Y = new THREE.Vector3(0, 1, 0), PAGES = 0xeee4cc;
function decorItem() {   // gathers a piece's parts: geometry (moved into the piece's frame), colour(s) and finish
  const parts = [], M = new THREE.Matrix4(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const add = (geo, col, fin = 'matte', o = {}) => {
    M.compose(P.set(...(o.p || [0, 0, 0])), o.q || new THREE.Quaternion().setFromEuler(E.set(...(o.r || [0, 0, 0]))), S.set(...(o.s || [1, 1, 1])));
    if (o.m) M.premultiply(o.m);
    geo.applyMatrix4(M); parts.push({ geo, col, fin, slot: o.slot || null }); return geo;
  };
  // a rod from a to b, radius r0 at a and r1 at b
  const rod = (a, b, r0, col, fin = 'matte', r1 = r0, seg = 8, m = null) => {
    const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A), L = d.length();
    return add(new THREE.CylinderGeometry(r1, r0, L, seg), col, fin, { p: A.addScaledVector(d, 0.5).toArray(), q: new THREE.Quaternion().setFromUnitVectors(DK_Y, d.normalize()), m });
  };
  // a book: standing with its spine to the room, or lying flat (spine to the room as well)
  const book = (w, h, d, cover, o = {}) => add(new THREE.BoxGeometry(w, h, d), o.lying ? [PAGES, PAGES, cover, cover, cover, PAGES] : [cover, cover, PAGES, PAGES, cover, PAGES], 'matte', o);
  // a picture in a frame, standing on its lower edge and leaning back against the shelf
  const frame = (w, h, col, slot, { fin = 'matte', b = 0.02, depth = 0.018, lean = 0.12, x = 0, z = 0, ry = 0, mount = 0 } = {}) => {
    const m = new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(ry)).multiply(new THREE.Matrix4().makeRotationX(-lean)).multiply(new THREE.Matrix4().makeTranslation(0, h / 2, 0));
    for (const s of [1, -1]) {
      add(new THREE.BoxGeometry(w, b, depth), col, fin, { p: [0, s * (h - b) / 2, 0], m });
      add(new THREE.BoxGeometry(b, h - 2 * b, depth), col, fin, { p: [s * (w - b) / 2, 0, 0], m });
    }
    add(new THREE.BoxGeometry(w - 2 * b + 0.002, h - 2 * b + 0.002, 0.004), 0x2a2420, 'matte', { p: [0, 0, -depth / 2 + 0.002], m });
    if (mount) add(new THREE.PlaneGeometry(w - 2 * b, h - 2 * b), 0xf3efe4, 'matte', { p: [0, 0, depth / 2 - 0.007], m });
    add(new THREE.PlaneGeometry(w - 2 * b - 2 * mount, h - 2 * b - 2 * mount), 0xffffff, 'art', { p: [0, 0, depth / 2 - 0.006], m, slot });
  };
  return { parts, add, rod, book, frame };
}
function dkLathe(pts, seg = 28) {   // a turned piece: profile [r, y] from the foot up, smoothed, closed at the foot
  const p = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(pts.length * 4).map(v => new THREE.Vector2(Math.max(0.0008, v.x), v.y));
  p.unshift(new THREE.Vector2(0.0008, pts[0][1]));
  return new THREE.LatheGeometry(p, seg);
}
const dkBall = (r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
const dkRing = (r, t, arc = Math.PI * 2, seg = 32) => new THREE.TorusGeometry(r, t, 6, seg, arc);

export { DECOR, DK_Y, decorItem, dkBall, dkLathe, dkRing };
