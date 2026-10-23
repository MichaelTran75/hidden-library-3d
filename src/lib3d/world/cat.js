import '../fx/rain.js';   // build order: the module before this one runs first
import * as THREE from 'three';

/* ---------------------------------------------------------------- the cat's body
   "cat" by artofaria (Sketchfab, Free Standard licence): a black cat with a white bib, blaze and toes, modelled standing
   and without a skeleton. tools/pets/rig_cat.py gives it one (hips, spine, chest, neck, head; two ears; seven tail
   bones; each foreleg a shoulder blade, upper arm, forearm and paw; each hind leg a thigh, shin, foot and toes) and skin
   weights. This module is its body: its poses, the springs that carry it from pose to pose, its legs' reach and its
   gait. Its life (what it does, and when) is in pets.js.
   A pose is a list of turns of its bones about the axes of its own frame (forward +z, up +y, left +x), each through the
   bone's joint, the right side mirroring the left; the cat is then set down so its lowest point touches the ground.
   From pose to pose it is carried by springs, as games do it (D. Holden, "Spring-It-On", theorangeduck.com): each
   bone's turn away from where it should be decays as a critically damped spring, so a change of pose starts and ends
   at rest, keeps the speed a bone already had, and needs no blend time fixed in advance.
   Its gait follows measurements of walking cats: a lateral sequence (left hind, left fore, right hind, right fore, a
   quarter of a stride apart), each paw down about 60 % of the stride (Zubair et al. 2016); a swing that lasts about
   as long at every speed, a faster cat shortening the stance instead (Halbertsma 1983); a body carried a little lower
   as it walks (cats walk crouched: Bishop et al. 2008). How far a paw sweeps under the body is what its leg can reach:
   measured on the skeleton (each paw's sweep centred under its shoulder or hip, the shortest leg, the forearm, setting
   it), so no leg is ever pulled straight (a leg stretched past its reach drags its skin into a thin stick). For this
   short-legged cat that is a stride of ~0.16 m in 0.6 s. Walking, its head is
   held steady and a little nose-down while the trunk rises and falls twice a stride and sways once (Zubair et al.);
   its shoulder blades ride up over each forepaw in stance; its tail, carried up, follows the body as a damped chain. */
const CATR = { bones: {}, rest: null, body: null, mesh: null, ground: null, gaze: null, poses: {}, legs: null, S: null, scale: 1.5125, tail: null };   // (10 % larger twice: G, 17/10/2026)
const C_SIDED = /^(scap|arm|fore|paw|ftoe|thigh|shin|foot|toe|ear)$/;   // (a pose op ['tailArc', from, step, dip] lays the tail on an arc)
const C_AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const C_TAIL = [];   // its tail's bones, root to tip (rigCat: twelve since 22/10/2026; the poses below were written for seven)
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c3 = new THREE.Vector3(), _c4 = new THREE.Vector3(), _c5 = new THREE.Vector3();
const _cq1 = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _cq3 = new THREE.Quaternion(), _cq4 = new THREE.Quaternion();
const cwp = (o, v = new THREE.Vector3()) => v.setFromMatrixPosition(o.matrixWorld);
const _cE = new THREE.Euler(), _cS = new THREE.Vector3(), _cU = new THREE.Vector3(), _cL1 = new THREE.Quaternion(), _cL2 = new THREE.Quaternion();   // (per-frame scratch)
function catTurn(b, q) {   // a turn given in world space, through the bone's own joint
  b.parent.updateWorldMatrix(true, false); b.parent.getWorldQuaternion(_cq1);
  b.quaternion.premultiply(_cq2.copy(_cq1).invert().multiply(q).multiply(_cq1)); b.updateWorldMatrix(false, true);
}
function catAim(b, dir) {   // the bone turned the shortest way so its length (its own +y) points along dir (world space)
  b.updateWorldMatrix(true, false); _c1.set(0, 1, 0).applyQuaternion(b.getWorldQuaternion(_cq3)).normalize();
  catTurn(b, _cq3.setFromUnitVectors(_c1, _c2.copy(dir).normalize()));
}
const catAxis = (ax, v) => v.copy(C_AX[ax]).applyQuaternion(CATR.body.getWorldQuaternion(_cq4));   // an axis of its frame, in the world
function catRest() {   // every bone as modelled, the body at the origin
  for (const [b, t] of CATR.rest) { b.position.copy(t.p); b.quaternion.copy(t.q); b.scale.copy(t.s); }
  CATR.body.position.set(0, 0, 0); CATR.body.quaternion.identity(); CATR.body.updateMatrixWorld(true);
}
function catPose(spec) {   // a pose worked out on the cat at the origin: its bones' turns and where its body sits
  const B = CATR.bones; catRest();
  const NT = C_TAIL.length, k7 = 7 / NT;   // (the poses' tail turns were written for seven bones: shared out along the same stretch)
  for (const [n, ax, deg, dip = 0] of spec.ops) {
    if (n === 'tailArc') {   // the tail laid along an arc: from straight back turned by ax degrees, each bone deg more; its root
      // dipping down to the ground (dip, less each bone, flat from three sevenths of the way)
      C_TAIL.forEach((t, i) => { const a = (ax + deg * k7 * i) * Math.PI / 180; catAim(B[t], _c5.set(Math.sin(a), -dip * Math.max(0, 1 - i * k7 / 3), -Math.cos(a))); }); continue;
    }
    const tm = NT !== 7 && /^tail([1-7])$/.exec(n);
    if (tm) {   // a turn of the seven-bone tail's bone k: each of the bones along its seventh of the tail takes its share
      const a0 = (tm[1] - 1) / 7, a1 = tm[1] / 7;
      for (let j = 0; j < NT; j++) { const o = Math.max(0, Math.min(a1, (j + 1) / NT) - Math.max(a0, j / NT)) * 7; if (o > 1e-6) catTurn(B[C_TAIL[j]], _cq4.setFromAxisAngle(C_AX[ax], deg * o * Math.PI / 180)); }
      continue;
    }
    for (const [nn, share] of n === 'spine' && B.spine2 ? [['spine', 0.5], ['spine2', 0.5]] : [[n, 1]])   // (the back below the chest is two bones: a bend of it shared)
    for (const s of C_SIDED.test(nn) ? ['_L', '_R'] : ['']) {
    const b = B[nn + s]; if (!b) continue;
    catTurn(b, _cq4.setFromAxisAngle(C_AX[ax], (s === '_R' && ax !== 'x' ? -deg : deg) * share * Math.PI / 180));
  } }
  const body = CATR.body, m = CATR.mesh; body.updateMatrixWorld(true);
  let low = Infinity; for (const i of CATR.ground) low = Math.min(low, m.getVertexPosition(i, _c1).applyMatrix4(m.matrixWorld).y);   // (the tail may lie on the floor)
  body.position.y = (spec.y || 0) - low; body.updateMatrixWorld(true);
  return { q: new Map([...CATR.rest.keys()].map(b => [b, b.quaternion.clone()])), pos: body.position.clone(), quat: body.quaternion.clone() };
}
/* ---- its poses (degrees; x: + tips forward parts down and lower parts back, y: + turns forward parts to its left,
   z: + lifts its left side). Read top to bottom: each turn is made on the pose as the turns above it left it. */
const CAT_POSES = {
  stand: { ops: [] },   // as modelled: standing square, tail up in a hook (a friendly carriage), head level
  // lying like a sphinx, alert: belly down, forearms flat ahead, hind legs folded at its sides, head up, tail along the floor.
  // Its hips stand ~12 cm up and its thigh is 7 cm, so the hind leg goes down to the floor: the knee forward and out, the
  // hock and the pad on the floor under the haunch, the foot pointing forward (G, 23/10/2026, a photo of the haunch: the
  // knee folded up to the hip's height left the hock above it and the foot stuck out of its side, its belly creased;
  // searched over thigh, shin and foot for the hock and pad on the floor, tools/pets/legsearch.cjs, seen with tools/pets/catview.cjs)
  sphinx: { ops: [['arm', 'x', 10], ['fore', 'x', -75], ['paw', 'x', 5], ['thigh', 'x', -30], ['thigh', 'z', 10], ['shin', 'x', 30], ['foot', 'x', -70],
    ['neck', 'x', -8], ['tail1', 'x', -42], ['tail2', 'x', -30], ['tail3', 'y', -18], ['tail4', 'y', -22], ['tail5', 'y', -26], ['tail6', 'y', -26], ['tail7', 'y', -20]] },
  // asleep, curled up on its side (as cats sleep when they curl up): the legs folded, then rolled onto its right side,
  // the back bent round toward the belly so the head comes down by the hind paws, chin tucked, the tail wrapped
  // round in front of its face
  curl: { ops: [['arm', 'x', 10], ['fore', 'x', -75], ['paw', 'x', 5], ['thigh', 'x', -55], ['shin', 'x', 115], ['foot', 'x', -65],
    ['hips', 'z', 80],
    ['spine', 'y', 24], ['chest', 'y', 30], ['neck', 'y', 36], ['head', 'y', 34], ['neck', 'z', -18], ['head', 'z', -12],
    ['tailArc', 10, 25, 1.2]] },
  // asleep lightly, curled up in a ball (as cats first fall asleep, before they roll onto their side and sleep deeply: G,
  // 17/10/2026, after his photo of a tabby curled up so): belly down, its forelegs tucked under its chest and its hind
  // legs folded under it; the head lowered first, its face kept forward, then the back curved round to its left into a
  // ring, so the head rests low at the front, chin by the cushion and cheek a little down; rolled a touch onto its
  // right side; the tail wrapped round its left side to the front
  nest: { ops: [['arm', 'x', 45], ['fore', 'x', 105], ['paw', 'x', 50], ['thigh', 'x', -48], ['thigh', 'z', -14], ['shin', 'x', 125], ['foot', 'x', -72],
    ['neck', 'x', 38], ['head', 'x', -18], ['hips', 'z', 22],
    ['spine', 'y', 28], ['chest', 'y', 32], ['neck', 'y', 28], ['head', 'y', 14], ['head', 'z', -14],
    ['tailArc', 55, 28, 1.1]] },
  // sitting: haunches down (the trunk only ~26° up, as far as its short forelegs reach), forelegs straight, head level,
  // tail round its side on the floor
  sit: { ops: [['hips', 'x', -26], ['thigh', 'x', -62], ['thigh', 'z', 10], ['shin', 'x', 118], ['foot', 'x', -58], ['arm', 'x', 22], ['fore', 'x', 6],
    ['neck', 'x', 14], ['head', 'x', 12], ['tail1', 'x', -20], ['tail2', 'x', -25], ['tail3', 'y', -25], ['tail4', 'y', -30], ['tail5', 'y', -32], ['tail6', 'y', -30], ['tail7', 'y', -24]] },
  // stalking: head low and level, tail held low behind it
  stalk: { ops: [['neck', 'x', 14], ['head', 'x', -10], ['tail1', 'x', -62], ['tail2', 'x', -14], ['tail3', 'x', 6], ['tail5', 'x', 8]] },
  // in the air: forelegs reaching ahead, hind legs stretched back, tail out behind
  air: { ops: [['arm', 'x', -55], ['fore', 'x', -25], ['thigh', 'x', 45], ['shin', 'x', 25], ['foot', 'x', 20], ['tail1', 'x', -40], ['tail2', 'x', -15], ['tail3', 'x', -10]] },
  // the stretch on waking ("bow"): forelegs reaching flat ahead, chest low, haunches up, tail raised
  bow: { ops: [['hips', 'x', 22], ['thigh', 'x', -22], ['arm', 'x', -62], ['fore', 'x', -18], ['paw', 'x', 25], ['neck', 'x', -30], ['head', 'x', -6]] },
  // after the bow, a hind leg stretched out behind it, its toes spread back, the other three legs as they stand
  stretch: { ops: [['hips', 'x', -4], ['thigh_L', 'x', 52], ['shin_L', 'x', -38], ['foot_L', 'x', -24], ['toe_L', 'x', 18], ['neck', 'x', -6], ['tail1', 'x', -12]] },
  // a loaf: lying with its forepaws tucked under its chest and its hind legs under it, back level, head up, the tail along its side
  loaf: { ops: [['arm', 'x', 45], ['fore', 'x', 105], ['paw', 'x', 50], ['thigh', 'x', -30], ['thigh', 'z', 10], ['shin', 'x', 30], ['foot', 'x', -70],   // (the hind legs as the sphinx's)
    ['neck', 'x', -2], ['head', 'x', 6], ['tailArc', 62, 24, 1.1]] },
};
// grooming, from sitting: a forepaw licked, then drawn over the face
CAT_POSES.lick = { ops: [...CAT_POSES.sit.ops, ['arm_L', 'x', -62], ['fore_L', 'x', -75], ['paw_L', 'x', -20], ['neck', 'x', 18], ['head', 'x', 18], ['head', 'y', 12]] };
CAT_POSES.wipe = { ops: [...CAT_POSES.sit.ops, ['arm_L', 'x', -95], ['fore_L', 'x', -70], ['paw_L', 'x', -30], ['arm_L', 'y', -18], ['head', 'x', 12], ['head', 'z', 16], ['head', 'y', 10]] };
/* ---- the springs */
const cqlog = (q, v) => { const s = Math.hypot(q.x, q.y, q.z); if (s < 1e-9) return v.set(2 * q.x, 2 * q.y, 2 * q.z); const a = 2 * Math.atan2(s, q.w) / s; return v.set(q.x * a, q.y * a, q.z * a); };
const cqexp = (v, q) => { const a = v.length(); if (a < 1e-9) return q.set(v.x / 2, v.y / 2, v.z / 2, 1).normalize(); const s = Math.sin(a / 2) / a; return q.set(v.x * s, v.y * s, v.z * s, Math.cos(a / 2)); };
function cspringQ(q, w, qt, y, ey, dt) {   // q (turning at w) toward qt: the turn left to go decays, critically damped
  _cq3.copy(qt).invert().multiply(q); if (_cq3.w < 0) _cq3.set(-_cq3.x, -_cq3.y, -_cq3.z, -_cq3.w);
  cqlog(_cq3, _c3); _c4.copy(w).addScaledVector(_c3, y);
  w.addScaledVector(_c4, -y * dt).multiplyScalar(ey); _c3.addScaledVector(_c4, dt).multiplyScalar(ey);
  q.copy(qt).multiply(cqexp(_c3, _cq3));
}
function catSprings() {   // the springs' state: each bone as shown and its rate; the body's place likewise
  CATR.S = { bones: new Map([...CATR.rest.keys()].map(b => [b, { q: b.quaternion.clone(), w: new THREE.Vector3() }])),
    pos: CATR.body.position.clone(), vel: new THREE.Vector3(), quat: CATR.body.quaternion.clone(), w: new THREE.Vector3() };
}
function catToward(P, dt, half) {   // everything toward pose P (half: the time to go half the way, s)
  const S = CATR.S, y = 1.3862944 / Math.max(half, 0.01), ey = Math.exp(-y * dt);
  for (const [b, st] of S.bones) { cspringQ(st.q, st.w, P.q.get(b), y, ey, dt); b.quaternion.copy(st.q); }
  _c3.copy(S.pos).sub(P.pos); _c4.copy(S.vel).addScaledVector(_c3, y);
  S.vel.addScaledVector(_c4, -y * dt).multiplyScalar(ey); _c3.addScaledVector(_c4, dt).multiplyScalar(ey); S.pos.copy(P.pos).add(_c3);
  cspringQ(S.quat, S.w, P.quat, y, ey, dt);
  CATR.body.position.copy(S.pos); CATR.body.quaternion.copy(S.quat);
}
function catSnap(P) {   // at pose P at once, at rest
  for (const [b, st] of CATR.S.bones) { st.q.copy(P.q.get(b)); st.w.set(0, 0, 0); b.quaternion.copy(st.q); }
  CATR.S.pos.copy(P.pos); CATR.S.vel.set(0, 0, 0); CATR.S.quat.copy(P.quat); CATR.S.w.set(0, 0, 0);
  CATR.body.position.copy(P.pos); CATR.body.quaternion.copy(P.quat);
}
function catKeep(bones, dt) {   // bones placed by other means (the legs' reach): the springs go on from where they are
  for (const b of bones) { const st = CATR.S.bones.get(b); if (!st) continue;
    _cq3.copy(st.q).invert().multiply(b.quaternion); if (_cq3.w < 0) _cq3.set(-_cq3.x, -_cq3.y, -_cq3.z, -_cq3.w);
    cqlog(_cq3, st.w).multiplyScalar(dt > 0 ? 0.5 / dt : 0); st.q.copy(b.quaternion); }
}
/* ---- set up: the bones, their rest, the poses, the legs */
function rigCat(node) {
  node.removeFromParent();
  const inner = new THREE.Group(); inner.add(node); inner.rotation.y = -Math.PI / 2; inner.scale.setScalar(CATR.scale);   // the model faces +x: turned to +z
  const body = new THREE.Group(); body.add(inner); CATR.body = body;
  node.traverse(o => { if (o.isBone) CATR.bones[o.name] = o; if (o.isSkinnedMesh) CATR.mesh = o; });
  C_TAIL.length = 0; C_TAIL.push(...Object.keys(CATR.bones).filter(n => /^tail\d+$/.test(n)).sort((a, b) => a.slice(4) - b.slice(4)));
  { const m = CATR.mesh, J = m.geometry.attributes.skinIndex, W = m.geometry.attributes.skinWeight, tail = m.skeleton.bones.map(b => /^tail/.test(b.name));
    CATR.ground = []; for (let i = 0; i < J.count; i++) { let w = 0; for (let c = 0; c < 4; c++) if (tail[J.getComponent(i, c)]) w += W.getComponent(i, c); if (w < 0.5) CATR.ground.push(i); } }   // what it stands on: all but its tail
  CATR.rest = new Map(Object.values(CATR.bones).map(b => [b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }]));
  catRest(); CATR.gaze = new THREE.Vector3(0, 0, 1).applyQuaternion(CATR.bones.head.getWorldQuaternion(new THREE.Quaternion()).invert());   // its eyes' line, in the head's frame
  for (const [k, P] of Object.entries(CAT_POSES)) CATR.poses[k] = catPose(P);
  catRest(); catLegs(); catSprings(); catSnap(CATR.poses.stand);
  CATR.tail = C_TAIL.map(() => ({ e: new THREE.Vector2(), w: new THREE.Vector2() }));
  return body;
}
// each leg, standing: its joints, its two lengths to reach with, and where its paw meets the ground under the body
function catLegs() {
  const B = CATR.bones, k = CATR.scale; CATR.legs = {}; catRest();
  for (const [f, s, hind] of [['lh', 'L', 1], ['rh', 'R', 1], ['lf', 'L', 0], ['rf', 'R', 0]]) {
    const up = B[(hind ? 'thigh_' : 'arm_') + s], mid = B[(hind ? 'shin_' : 'fore_') + s], end = B[(hind ? 'foot_' : 'paw_') + s], toe = B[(hind ? 'toe_' : 'ftoe_') + s] || null;   // (the forepaw's toes their own bone since 22/10/2026)
    const A = cwp(up), K = cwp(mid), J = cwp(end), tipOf = b => cwp(b).add(new THREE.Vector3(0, 1, 0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(b.userData.len * k));
    const tip = tipOf(toe || end), ball = toe ? cwp(toe) : J.clone().lerp(tip, 0.6);   // the pad it stands on
    const contact = new THREE.Vector3(ball.x, 0, ball.z);
    CATR.legs[f] = { up, mid, end, toe, hind: !!hind, l1: A.distanceTo(K), l2: K.distanceTo(J), home: contact.clone(), jo: J.clone().sub(contact),
      dEnd: (toe ? ball.clone().sub(J) : tip.clone().sub(J)).normalize(), dToe: toe ? tip.clone().sub(ball).normalize() : null, scap: hind ? null : B['scap_' + s] };
  }
  // the stride its legs can make: each paw's sweep centred under its shoulder or hip, as far either way as the leg reaches
  // (93 % of it, never straight) with the body lowered by the walk's crouch; the shortest sets it
  let half = Infinity;
  for (const L of Object.values(CATR.legs)) {
    const A = cwp(L.up), J = L.home.clone().add(L.jo), c = J.z - A.z;
    L.home.z -= c;   // (the paw's home moved under the joint above it)
    const h = A.y - J.y - CGAIT.crouch, R = 0.93 * (L.l1 + L.l2);
    half = Math.min(half, Math.sqrt(Math.max(0, R * R - h * h)));
  }
  CGAIT.sst = 2 * 0.9 * half; CGAIT.sref = CGAIT.sst / (1 - CGAIT.tsw / CGAIT.Tref); CGAIT.vref = CGAIT.sref / CGAIT.Tref;
}
/* ---- reach: a leg to a paw on the ground, by two-bone inverse kinematics (thigh and shin to the hock, upper arm and
   forearm to the wrist; the knee bending forward, the elbow back), the foot down to the pad and the toes ahead; a paw in
   the air curls under (a cat's forepaw folds at the wrist as it swings) */
const _r = { J: new THREE.Vector3(), A: new THREE.Vector3(), u: new THREE.Vector3(), n: new THREE.Vector3(), K: new THREE.Vector3(), d: new THREE.Vector3(), side: new THREE.Vector3(), fwd: new THREE.Vector3() };
function catReach(f, P, curl, yawQ) {   // (no new objects: it runs for four legs every frame)
  const L = CATR.legs[f], R = _r, fwd = R.fwd.set(0, 0, 1).applyQuaternion(yawQ), up = C_AX.y, side = R.side.set(1, 0, 0).applyQuaternion(yawQ);
  const J = R.J.copy(L.jo).applyQuaternion(yawQ);
  if (curl > 0) J.applyAxisAngle(side, (L.hind ? -0.25 : -0.3) * curl);   // the joint above swings back as the paw lifts
  J.add(P);
  L.up.updateWorldMatrix(true, false); const A = cwp(L.up, R.A), u = R.u.copy(J).sub(A);
  const d = Math.min(Math.max(u.length(), Math.abs(L.l1 - L.l2) + 1e-4), L.l1 + L.l2 - 1e-4); u.normalize();
  const ca = (L.l1 * L.l1 - L.l2 * L.l2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, L.l1 * L.l1 - ca * ca));
  const n = R.n.copy(fwd).multiplyScalar(L.hind ? 1 : -1).addScaledVector(up, -0.05); n.addScaledVector(u, -n.dot(u)).normalize();
  const K = R.K.copy(A).addScaledVector(u, ca).addScaledVector(n, hh);
  catAim(L.up, R.d.copy(K).sub(A)); catAim(L.mid, R.d.copy(J).sub(K));
  const dEnd = R.d.copy(L.dEnd).applyQuaternion(yawQ);
  if (curl > 0) dEnd.applyAxisAngle(side, (L.hind ? 0.35 : 0.7) * curl);   // the paw folds under
  catAim(L.end, dEnd);
  if (L.toe) { const dt = R.d.copy(L.dToe).applyQuaternion(yawQ); if (curl > 0) dt.applyAxisAngle(side, 0.5 * curl); catAim(L.toe, dt); }
}
/* ---- the gait: where each paw is. A paw in stance stays where it came down; a paw in swing lifts, clears the ground and
   comes down where its home under the body will be when it lands, half a stance ahead of it. */
const CGAIT = { Tref: 0.6, tsw: 0.24, off: { lh: 0, lf: 0.25, rh: 0.5, rf: 0.75 }, lift: 0.022, crouch: 0.02, sref: 0.16, vref: 0.27, sst: 0.1 };
function catGait(G, dt, v, w) {   // G: { x, z, yaw, y (the ground), phase, feet }; v its speed (m/s), w its turning (rad/s)
  const L = CATR.legs, moving = Math.abs(v) > 0.004 || Math.abs(w) > 0.05;
  const ve = Math.max(Math.abs(v), Math.abs(w) * 0.1, 0.1);   // the pace its steps keep (turning on the spot too)
  const sst = CGAIT.sst * (0.75 + 0.25 * Math.min(1.6, ve / CGAIT.vref)), T = sst / ve + CGAIT.tsw, beta = 1 - CGAIT.tsw / T;
  const home = (f, s) => {   // where a paw's home is, s seconds on (going on as now)
    const h = L[f].home, yw = G.yaw + w * s, c = Math.cos(yw), n = Math.sin(yw), dx = Math.sin(G.yaw + w * s / 2) * v * s, dz = Math.cos(G.yaw + w * s / 2) * v * s;
    return new THREE.Vector3(G.x + dx + h.x * c + h.z * n, G.y, G.z + dz - h.x * n + h.z * c);
  };
  if (!G.feet) G.feet = Object.fromEntries(Object.keys(L).map(f => [f, { planted: home(f, 0), lift: null, land: null, swing: false, target: null, curl: 0 }]));
  const swinging = Object.values(G.feet).some(F => F.swing);
  if (moving || swinging) G.phase += dt / T;
  G.T = T; G.beta = beta; G.moving = moving;
  for (const f of Object.keys(L)) {
    const F = G.feet[f], p = (((G.phase + CGAIT.off[f]) % 1) + 1) % 1, inSwing = p >= beta;
    if (inSwing && !F.swing && (moving || F.planted.distanceTo(home(f, 0)) > 0.025) && !F.stay) { F.swing = true; F.lift = F.planted.clone(); }
    if (!inSwing) F.stay = false; else if (!F.swing) F.stay = true;   // a paw that did not lift this stride waits for the next
    if (F.swing) {
      const s = inSwing ? (p - beta) / (1 - beta) : 1, left = (1 - s) * CGAIT.tsw;
      F.land = home(f, left); if (moving) F.land.add(new THREE.Vector3(Math.sin(G.yaw), 0, Math.cos(G.yaw)).multiplyScalar(Math.sign(v) * sst / 2));
      if (s >= 1) { F.swing = false; F.planted.copy(F.land); F.target = F.planted; F.curl = 0; }
      else { const e = s * s * s * (s * (6 * s - 15) + 10); F.target = F.lift.clone().lerp(F.land, e); F.target.y += CGAIT.lift * Math.pow(Math.sin(Math.PI * s), 0.8); F.curl = Math.sin(Math.PI * Math.min(1, s * 1.15)); }
    } else { F.target = F.planted; F.curl = 0; }
  }
}
// the trunk over the stepping legs (k: how much it is walking, 0..1): down twice a stride (just after each hind paw
// lands), haunches and chest dipping in turn, a sway and a roll once a stride, the shoulder blades riding over the forepaws
function catStride(G, k) {
  if (k <= 0) return;
  const p = G.phase, B = CATR.bones, body = CATR.body;
  body.position.y += (-CGAIT.crouch - 0.003 * Math.cos(4 * Math.PI * (p - 0.08))) * k;   // a little crouched, rising and falling
  body.position.x += 0.003 * Math.sin(2 * Math.PI * (p - 0.15)) * k;
  body.quaternion.multiply(_cq4.setFromEuler(_cE.set(0.018 * Math.sin(4 * Math.PI * (p - 0.2)) * k, 0, 0.028 * Math.sin(2 * Math.PI * (p - 0.15)) * k)));
  body.updateMatrixWorld(true);
  const side = catAxis('x', _cS), upw = catAxis('y', _cU);
  catTurn(B.chest, _cq4.setFromAxisAngle(upw, 0.045 * Math.sin(2 * Math.PI * (p - 0.3)) * k));   // the trunk bends a little toward the reaching forepaw
  for (const [f, s] of [['lf', '_L'], ['rf', '_R']]) {   // a shoulder blade: forward as its paw swings, back and up over it in stance
    const q = (((p + CGAIT.off[f]) % 1) + 1) % 1, a = q < G.beta ? -0.06 + 0.12 * q / G.beta : 0.06 - 0.12 * (q - G.beta) / (1 - G.beta);
    catTurn(B['scap' + s], _cq4.setFromAxisAngle(side, a * k));
  }
}
// the head toward a direction (world), the neck taking part of the turn, within a limit; k: how much
function catLook(dir, k, lim = 1.2) {
  const head = CATR.bones.head; head.updateWorldMatrix(true, false);
  const nose = _c1.copy(CATR.gaze).applyQuaternion(head.getWorldQuaternion(_cq4)).normalize();
  _cq4.setFromUnitVectors(nose, _c2.copy(dir).normalize()); const a = 2 * Math.acos(Math.min(1, Math.abs(_cq4.w)));
  if (a > lim) _cq4.slerp(_cq3.identity(), 1 - lim / a);
  const part = _cL1.identity().slerp(_cq4, 0.45 * k), rest = _cL2.identity().slerp(_cq4, 0.55 * k);
  catTurn(CATR.bones.neck, part); catTurn(head, rest);
}
/* ---- the tail (G, 22/10/2026: "add behavior vào đuôi mèo để cho nó tự nhiên khi vận động"). Each joint's bend away
   from its pose is a damped spring (stiffer at the root than at the tip, a little under-damped), pushed by:
   - the body's own moves: it swings out behind on a turn, drops as the cat speeds up, lifts as it lands;
   - its mood (C_TMOOD, set each frame by pets.js): a bend that travels from the root to the tip, wider toward the tip
     (the way a cat's tail sweeps: the base leads, the tip follows a beat later), slow and small at ease, quick when it
     is intent or cross; the tip's hook (held up and curled over, a friendly greeting carriage); flat: lying, it sweeps
     along the floor, turned about the world's up, not the body's;
   - the flicks and the stride's swing pets.js adds (sway).
   Nothing of it goes into what the cat lies or stands on: a joint the floor would take in turns its bone up to rest on it
   (floor: the surface's height; the tube's radius kept above it). */
const C_TMOOD = { wave: 0, f: 0.3, curl: 0, flat: false, floor: -Infinity };
const CTAIL = { t: 0 };
const _ct1 = new THREE.Vector3(), _ct2 = new THREE.Vector3(), _ctq = new THREE.Quaternion();
function catTail(dt, acc, yawAcc, sway, mood = C_TMOOD) {
  const T = CATR.tail, B = CATR.bones, N = C_TAIL.length; if (!T || N < 2) return;
  CTAIL.t += dt; const m = mood, k6 = 6 / (N - 1);   // (its pushes were set for six springing joints: each of these takes its share)
  const side = m.flat ? C_AX.y : catAxis('y', _cS), pitch = catAxis('x', _cU);
  for (let i = 1; i < N; i++) {
    const u = i / (N - 1), st = T[i], kk = 120 - 84 * u, c = 2 * Math.sqrt(kk) * 0.55;   // natural frequency falling toward the tip, under-damped
    const wave = m.wave * Math.pow(0.3 + 0.7 * u, 1.4) * Math.sin(2 * Math.PI * m.f * CTAIL.t - 2.4 * u);   // the travelling sweep
    const hook = m.curl * 0.55 * THREE.MathUtils.smoothstep(u, 0.5, 1);   // the tip curled over
    const fx = k6 * (-yawAcc * 0.004 * 6 * u + sway * (u > 0.34 ? 1 : 0.3) + wave), fy = k6 * (-(acc.z * 0.03 + acc.y * 0.02) + hook);   // a turn swings it out behind, a start or a landing drops it
    for (let n = 0; n < 2; n++) { const h = dt / 2;
      st.w.x += (-kk * st.e.x - c * st.w.x + fx * kk) * h; st.w.y += (-kk * st.e.y - c * st.w.y + fy * kk) * h;
      st.e.x += st.w.x * h; st.e.y += st.w.y * h; }
    st.e.clampScalar(-0.5 * k6, 0.5 * k6);
    catTurn(B[C_TAIL[i]], _cq4.setFromAxisAngle(side, st.e.x)); catTurn(B[C_TAIL[i]], _cq4.setFromAxisAngle(pitch, st.e.y));
  }
  if (m.floor > -Infinity) catTailFloor(m.floor);
}
function catTailFloor(floor) {   // root to tip: a joint below the floor (its radius kept) turns its bone up to lie on it
  const B = CATR.bones, N = C_TAIL.length, k = CATR.scale;
  for (let i = 0; i < N; i++) {
    const b = B[C_TAIL[i]], next = B[C_TAIL[i + 1]]; b.updateWorldMatrix(true, false);
    const J = cwp(b, _ct1), C = next ? (next.updateWorldMatrix(true, false), cwp(next, _ct2)) : _ct2.set(0, 1, 0).applyQuaternion(b.getWorldQuaternion(_ctq)).multiplyScalar(b.userData.len * k).add(J);
    const r = (0.011 - 0.005 * (i + 1) / N) * k, v = C.sub(J), L = v.length(), want = floor + r - J.y;
    if (L < 1e-6 || v.y >= want || J.y < floor + r * 0.5) continue;   // (above it already; or the joint itself is down there: left)
    const e = Math.asin(THREE.MathUtils.clamp(want / L, -1, 1)), hl = Math.hypot(v.x, v.z) || 1e-6, to = _c5.set(v.x / hl * Math.cos(e), Math.sin(e), v.z / hl * Math.cos(e));
    catTurn(b, _ctq.setFromUnitVectors(v.normalize(), to));
  }
}

export { CATR, CAT_POSES, CGAIT, C_TMOOD, catAim, catAxis, catGait, catKeep, catLook, catPose, catReach, catSnap, catStride, catTail, catToward, catTurn, rigCat };
