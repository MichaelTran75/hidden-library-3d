import '../world/pets.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { reduceMotion } from '../core/base.js';
import { camera, setShadowsDirty } from '../core/renderer.js';
import { LIGHTS } from '../world/lights.js';
import { V3 } from '../core/views.js';
import { booksMesh } from '../core/build.js';
import { PEEK, PULL, UIS, focusView, offMode } from './library.js';
import { heroMesh } from './hero-books.js';
import { opensFlat } from './book-data.js';
import { readOpening, readRelease, stepRead } from './leaves.js';
import { setNeeds } from '../core/loop.js';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function setInst(bk, amount) {
  setShadowsDirty(true);
  booksMesh.setMatrixAt(bk.idx, amount === null ? ZERO : new THREE.Matrix4().makeTranslation(bk.normal.x * amount, 0, bk.normal.z * amount).multiply(bk.m0));
  booksMesh.instanceMatrix.needsUpdate = true;
}
function slidePose(bk, amount) {
  const p = new V3(), q = new THREE.Quaternion(), s = new V3();
  new THREE.Matrix4().makeTranslation(bk.normal.x * amount, 0, bk.normal.z * amount).multiply(bk.m0).decompose(p, q, s); return { p, q };
}
const pulledPose = bk => slidePose(bk, PULL);
// how far in front of the camera a book is shown: as far as `want`, but never back in among its shelves (a section's
// view may stand only ~1 m from them on a wide screen: the book shown 1.3 m off went in among the books there, cut by
// them: G, 17/10/2026); 35 cm clear of the shelves' face, its own depth turned toward the camera within that
function nearOf(v, want) { return Math.max(0.5, Math.min(want, v.tgt.distanceTo(v.pos) - 0.35)); }
function presentPose(bk) {
  const v = focusView(bk.sec), fwd = v.tgt.clone().sub(v.pos).normalize(), up = new V3(0, 1, 0), right = fwd.clone().cross(up).normalize();
  const D = nearOf(v, 1.3), k = D / 1.3;   // (the offsets in the view kept as they were, nearer or not)
  const p = v.pos.clone().addScaledVector(fwd, D).addScaledVector(right, -0.1 * k).addScaledVector(up, (-0.03 - bk.h / 2) * Math.max(k, 0.75));
  const x = fwd.clone().negate().applyAxisAngle(up, -0.52), z = x.clone().cross(up).normalize();   // front cover to the camera, fore-edge showing a little
  const th = 0.07, x2 = x.clone().multiplyScalar(Math.cos(th)).addScaledVector(up, Math.sin(th)), y2 = up.clone().multiplyScalar(Math.cos(th)).addScaledVector(x, -Math.sin(th));   // leaning back 4°, as on a stand
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x2, y2, z));
  return { p: p.addScaledVector(z, bk.d / 2), q };
}
// an atlas open in front of the camera (the Geography books: G, 16/10/2026): nearer than a closed book is shown, facing
// the camera, its spread's middle (the spine, a little toward the map) where the closed book's middle was. A book to
// read (ui/leaves.js) comes nearer still, square to the camera, its spine in the middle of the free side
function openPose(bk) {
  const v = focusView(bk.sec), fwd = v.tgt.clone().sub(v.pos).normalize(), up = new V3(0, 1, 0), right = fwd.clone().cross(up).normalize(), rd = !!bk.read;
  const D = nearOf(v, rd ? 0.66 : 0.8), p = v.pos.clone().addScaledVector(fwd, D).addScaledVector(right, rd ? 0 : -0.02).addScaledVector(up, -0.02 - bk.h / 2);
  const x = fwd.clone().negate().applyAxisAngle(up, rd ? 0 : -0.1), z = x.clone().cross(up).normalize();
  const th = rd ? 0.05 : 0.09, x2 = x.clone().multiplyScalar(Math.cos(th)).addScaledVector(up, Math.sin(th)), y2 = up.clone().multiplyScalar(Math.cos(th)).addScaledVector(x, -Math.sin(th));
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x2, y2, z));
  return { p: p.addScaledVector(z, rd ? 0 : bk.d * 0.16), q };
}
const OPEN_TURN = 2.7;   // (the cover turned 155°: open as far as a hardcover opens in the hand)
let SEAT = null;
function restPose(bk) {
  if (!SEAT) {   // the middle seat of the sofa, found by dropping a ray on it
    const rc = new THREE.Raycaster(new V3(0.62, 2, -7.15), new V3(0, -1, 0)); rc.camera = camera;
    const hit = LIGHTS.sofa ? rc.intersectObject(LIGHTS.sofa, true).find(h => h.object.isMesh) : null;
    SEAT = hit ? hit.point : new V3(0.62, 0.47, -7.15);
  }
  const x = new V3(0, 1, 0), y = new V3(Math.sin(2.5), 0, Math.cos(2.5)), z = x.clone().cross(y);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  const p = SEAT.clone().add(new V3(0, bk.t / 2 + 0.004, 0)).addScaledVector(y, -bk.h / 2).addScaledVector(z, bk.d / 2);
  return { p, q };
}
function startFlight(bk, goal) {
  bk.goal = goal; bk.fk = 0; bk.from = { p: bk.pose.p.clone(), q: bk.pose.q.clone() };
  bk.to = goal === 'present' ? presentPose(bk) : goal === 'rest' ? restPose(bk) : pulledPose(bk);
  bk.fdur = reduceMotion ? 0.001 : goal === 'pulled' ? 0.9 : 1.05;
}
function wantOf(bk) {
  if (bk === UIS.mapBook) return UIS.open === bk.sec && !offMode() ? 'present' : 'shelf';   // (an atlas goes back to its shelf)
  if (bk === UIS.active) return UIS.open === bk.sec && !offMode() ? 'present' : 'rest';
  return bk === UIS.peek ? 'peek' : 'shelf';
}
function stepBooks(dt, t) {
  let moving = false;
  for (const bk of [...UIS.touched]) {
    const want = wantOf(bk);
    if (!bk.out) {
      const target = want === 'shelf' ? 0 : want === 'peek' ? PEEK : PULL;
      if (Math.abs(bk.slide - target) > 1e-4) { bk.slide += THREE.MathUtils.clamp(target - bk.slide, -dt * 0.65, dt * 0.65); moving = true; } else bk.slide = target;
      // once a book leaves its place it shows its title: the hero (with its sharp words) stands in for the shelf instance
      const away = bk.slide > 1e-4, h = away ? heroMesh(bk) : bk.hero;
      if (away !== !!bk.away) { bk.away = away; setInst(bk, away ? null : 0); if (h) h.visible = away; }
      if (away) { const ps = slidePose(bk, bk.slide); h.position.copy(ps.p); h.quaternion.copy(ps.q); h.scale.set(bk.t, bk.h, bk.d); }
      if (bk.slide === PULL && (want === 'present' || want === 'rest')) { bk.out = true; bk.pose = pulledPose(bk); startFlight(bk, want); moving = true; }
      else if (target === 0 && !away) UIS.touched.delete(bk);
    } else {
      const goal = want === 'present' || want === 'rest' ? want : 'pulled';
      if (bk.goal !== goal) startFlight(bk, goal);
      if (bk.fk < 1) {
        bk.fk = Math.min(1, bk.fk + dt / bk.fdur); const k = bk.fk, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const lift = (bk.goal === 'present' ? 0.08 : 0.22) * Math.sin(Math.PI * e);
        bk.pose = { p: bk.from.p.clone().lerp(bk.to.p, e).add(new V3(0, lift, 0)), q: bk.from.q.clone().slerp(bk.to.q, e) }; moving = true;
        if (bk.fk >= 1 && bk.goal === 'pulled') { bk.out = false; bk.slide = PULL; if (bk.read) readRelease(bk); continue; }   // back at its place: it slides in on the shelf (a book of notes lets its pages go)
      }
      // an atlas, once in front of the camera, opens: it comes nearer and turns to face the camera as its cover turns
      // open (that a little later, so it clears the camera's way); it closes again as it goes back (a closing cover
      // flies back with it)
      let ok = 0;
      if (bk.flapU && opensFlat(bk.it)) {
        const want = bk.goal === 'present' && bk.fk >= 1 ? 1 : 0, k0 = bk.openK || 0;
        bk.openK = reduceMotion ? want : THREE.MathUtils.clamp(k0 + (want ? dt / 1.15 : -dt / 0.55), 0, 1); if (bk.openK !== k0) moving = true;
        if (bk.openK > 0 && bk.atlas && !bk.atlas.done) bk.atlas.paint();
        if (bk.openK > 0 && bk.read) readOpening(bk);
        const k = bk.openK; ok = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const kc = THREE.MathUtils.smoothstep(k, 0.12, 1); bk.flapU.uOpen.value = OPEN_TURN * kc;
        if (bk.read && stepRead(bk)) moving = true;   // (its leaves: turning, and closing with the board)
        if (bk.goal === 'present' && bk.fk >= 1) {
          if (!bk.openTo) bk.openTo = openPose(bk);
          bk.pose = { p: bk.to.p.clone().lerp(bk.openTo.p, ok), q: bk.to.q.clone().slerp(bk.openTo.q, ok) };
        } else bk.openTo = null;
      }
      const h = bk.hero; h.position.copy(bk.pose.p); h.quaternion.copy(bk.pose.q); h.scale.set(bk.t, bk.h, bk.d);
      if (bk.goal === 'present' && bk.fk >= 1 && !reduceMotion) { const b = 1 - (bk.read ? 1 : 0.85) * ok; h.position.y += Math.sin(t * 1.4) * 0.006 * b; h.rotateY(Math.sin(t * 0.9) * 0.04 * b); }   // (an open atlas held steadier: its map is to be clicked; an open book still: it is read)
    }
  }
  return moving;
}
function syncActive() {   // which book is "current" in the page's player
  const cur = document.querySelector('#pages .item.is-current');
  const bk = cur ? UIS.bySrc.get(cur.dataset.src) || null : null;
  if (bk !== UIS.active) { if (UIS.active) UIS.touched.add(UIS.active); UIS.active = bk; if (bk) UIS.touched.add(bk); setNeeds(true); }
}

export { stepBooks, syncActive };
