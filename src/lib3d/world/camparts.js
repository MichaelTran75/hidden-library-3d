import './gardenbook.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas, ctex } from '../core/utils.js';

/* ---------------------------------------------------------------- what is inside the vintage camera
   The model on the shelf (world/camera.js) is a shell: a closed body, a closed lens barrel, the knobs. What a 35 mm
   single-lens reflex of 1959 holds inside is made here from its measures, in millimetres, in the camera's own frame:
   the origin on the lens's axis (z = 0 where the model's own z is 0, ~5 mm in front of the back's outer face), x toward
   the rewind side (to the right of one facing the lens), y up, z out along the lens. The shell's own measures at that
   scale (its body 143 mm wide): the lens flange at z 40.46, the back's outer face at −4.83, the body's front at 25.8,
   the bottom at y −34.2, the bottom cover's seam at −29.4, the top cover's at 26.9, the top plate at 36.2, the prism
   housing's peak at 61; the wind lever's shaft at x −62, z 10, the speed dial's at −36.5, 8.3, the release at −45.3,
   20.3, the rewind knob's at 50.4, 9.95.
   What is made, and from what:
   - the lens's six elements in five groups and its diaphragm. The Auto-Takumar 55 mm f/2 is of the Gauss kind with five
     air-spaced members (two single lenses, a negative meniscus, the stop, a cemented pair, a single lens); its makers'
     own radii are not published, so the glass here is the example of that kind's patent (US 2,683,396, f = 100 mm,
     1:2; its first radius, lost in the printed table, found again from the focal length) brought to f = 55 mm: back
     focus 39.9 mm, 34 mm from the first surface to the last. Ten blades, as its sister lens of the same years;
   - the mirror box with its instant-return mirror at 45°, the M42 × 1 throat, the plate that presses the lens's
     diaphragm pin; the focusing screen (a Fresnel lens with a microprism spot) as far above the axis as the film is
     behind the mirror, and on it the roof pentaprism, cut as such a prism is: its ridge rising 22.5° toward the front,
     its front face leaning 22.5° forward, the two at 45° to each other, so the light leaves level through the back face
     to the eyepiece;
   - the cloth focal-plane shutter: two curtains, each with a metal lath and two ribbons; their two winding rollers on
     the wind side (pinions at their feet), their two spring rollers on the rewind side; as it rests after a picture:
     the closing curtain across the gate, the opening one wound on its spring roller;
   - the film's way: the cassette under the rewind fork, the film across the 24 × 36 mm gate on its rails, the sprocket
     with eight teeth a turn (one frame: 8 perforations, 38 mm), the take-up spool under the wind lever; the pressure
     plate on the back;
   - under the top cover the wind ratchet, the speed cams, the release's shaft; under the body the wind train (lever
     shaft → sprocket → the curtains' pinions, and the lever that charges the mirror) and the slow-speed escapement with
     its two rods up to the speed cams; the tripod bush and the rewind button in the bottom cover.
   The model's body is ~3 mm shallower than the camera's (flange to back 45.3 mm; the camera's flange to film alone is
   45.46): the film plane is set 2 mm inside the back (z −2.8), the lens so that it focuses there, and the mirror box
   is that much shorter than the real one. Everything here is hidden while the camera is whole. */
const CP = { ZF: 40.46, zFilm: -2.8, ys: 20.5, back: -4.83, yTop: 26.9, yBot: -29.4, wind: [-62, 10], dial: [-36.5, 8.3], rel: [-45.3, 20.3], rew: [50.4, 9.95], sprocket: [-36.5, 3.25],
  // the lens (US 2,683,396 at f = 100): radii, then lens thickness / air space in turn; k: to f = 55; h: each lens's half diameter (mm, at 55)
  lens: { k: 0.55, R: [69.8, 222.62, 43.53, 158.6, 198.03, 28.98, -31.2, 133.8, -40.95, 221.94, -84.3], d: [6.61, 0.21, 8.81, 3.57, 3.84, 18.35, 2.28, 11.45, 0.21, 6.46], bfl: 39.88, h: [15.2, 13.6, 11.2, 11, 11, 12.3] },
  // the prism: a: half its base along the axis that the finder shows; e: the eyepiece's axis above its base; w: its width
  prism: { a: 10.8, e: 13.3, w: 38, rear: 12 } };
const CPm = new THREE.Matrix4(), CPe = new THREE.Euler();
function cpAt(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { if (rx || ry || rz) g.applyMatrix4(CPm.makeRotationFromEuler(CPe.set(rx, ry, rz))); return g.translate(x, y, z); }
const cpBox = (w, h, d, x, y, z, rx, ry, rz) => cpAt(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
// a rod or a disc: radius, length, its middle, its axis ('y', 'z' or 'x')
const cpCyl = (r, h, x, y, z, axis = 'y', seg = 20, r2 = r) => cpAt(new THREE.CylinderGeometry(r2, r, h, seg), x, y, z, axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0);
// turned about an axis: [radius, along the axis, smooth?] in turn, going up the axis on the outside (so its faces look
// outward); its corners sharp unless a point says smooth. axis 'y', or 'z'
function cpLathe(pts, axis = 'y', seg = 40) {
  const P = []; pts.forEach(([r, a, sm], i) => { P.push(new THREE.Vector2(r, a)); if (!sm && i && i < pts.length - 1) P.push(new THREE.Vector2(r, a)); });
  const g = new THREE.LatheGeometry(P, seg); return axis === 'z' ? g.rotateX(Math.PI / 2) : g;
}
// a flat outline ([x, z] in turn, holes too) made a plate from y0 to y1
function cpPlate(pts, y0, y1, holes = []) {
  const path = (o, ps) => { ps.forEach(([x, z], i) => i ? o.lineTo(x, -z) : o.moveTo(x, -z)); o.closePath(); return o; };
  const s = path(new THREE.Shape(), pts); for (const h of holes) s.holes.push(typeof h[0] === 'number' ? new THREE.Path().absarc(h[0], -h[1], h[2], 0, Math.PI * 2, true) : path(new THREE.Path(), h));
  return new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false, curveSegments: 16 }).rotateX(-Math.PI / 2).translate(0, y0, 0);
}
// a gear: n teeth on a pitch circle r, th thick, its axis y, a bore
function cpGear(n, r, th, x, y, z, bore = 0, tooth = 0.9) {
  const pts = []; for (let i = 0; i < n; i++) for (const [rr, f] of [[r - tooth * 0.55, 0], [r + tooth * 0.45, 0.3], [r + tooth * 0.45, 0.52], [r - tooth * 0.55, 0.82]]) { const a = (i + f) / n * Math.PI * 2; pts.push([rr * Math.cos(a), rr * Math.sin(a)]); }
  return cpPlate(pts, -th / 2, th / 2, bore ? [[0, 0, bore]] : []).translate(x, y, z);
}
// a solid bounded by flat faces: [nx, ny, nz, d] in turn, inside where n·p <= d; tag: which faces are of the second kind
function cpHull(planes, tag = []) {
  const V = [], n = planes.map(p => new THREE.Vector3(p[0], p[1], p[2])), N = planes.length, c = new THREE.Vector3(), t = new THREE.Vector3(), m = new THREE.Matrix3();
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) for (let k = j + 1; k < N; k++) {
    m.set(n[i].x, n[i].y, n[i].z, n[j].x, n[j].y, n[j].z, n[k].x, n[k].y, n[k].z); if (Math.abs(m.determinant()) < 1e-7) continue;
    const p = new THREE.Vector3(planes[i][3], planes[j][3], planes[k][3]).applyMatrix3(m.clone().invert());
    if (planes.every((q, l) => n[l].dot(p) <= q[3] + 1e-5) && !V.some(v => v.distanceToSquared(p) < 1e-8)) V.push(p);
  }
  const pos = [[], []], nor = [[], []];
  for (let i = 0; i < N; i++) {
    const on = V.filter(v => Math.abs(n[i].dot(v) - planes[i][3]) < 1e-4); if (on.length < 3) continue;
    c.set(0, 0, 0); for (const v of on) c.add(v); c.divideScalar(on.length);
    const u = t.copy(on[0]).sub(c).normalize().clone(), w = new THREE.Vector3().crossVectors(n[i], u);
    on.sort((a, b) => Math.atan2(t.copy(a).sub(c).dot(w), t.copy(a).sub(c).dot(u)) - Math.atan2(t.copy(b).sub(c).dot(w), t.copy(b).sub(c).dot(u)));
    const g = tag.includes(i) ? 1 : 0; for (let k = 1; k < on.length - 1; k++) for (const v of [on[0], on[k], on[k + 1]]) { pos[g].push(v.x, v.y, v.z); nor[g].push(n[i].x, n[i].y, n[i].z); }
  }
  const g = new THREE.BufferGeometry(), all = pos[0].concat(pos[1]); g.setAttribute('position', new THREE.Float32BufferAttribute(all, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor[0].concat(nor[1]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(all.length / 3 * 2), 2)); g.addGroup(0, pos[0].length / 3, 0); g.addGroup(pos[0].length / 3, pos[1].length / 3, 1); return g;
}
function cpJoin(list) {   // several shapes as one (none indexed, each with its points, its normals and its uv)
  return mergeGeometries(list.map(g => { const q = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k);
    if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); q.clearGroups(); return q; }));
}

// ---- its stuffs
function cpMats() {
  // one shader for all of it but the glass (each kind of shader is made again for every state of the room's lights): every
  // stuff has a picture (a white dot where it has none of its own), holes where the picture has them, and both its sides
  const wc = canvas(2, 2), wg = wc.getContext('2d'); wg.fillStyle = '#fff'; wg.fillRect(0, 0, 2, 2); const white = ctex(wc, { rep: false });
  const std = (color, metalness, roughness, o = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, map: white, alphaTest: 0.5, side: THREE.DoubleSide, ...o });
  // the film: one perforation's length of it (4.75 mm by its 35 mm), the holes cut out
  const fc = canvas(32, 256), fg = fc.getContext('2d'); fg.fillStyle = '#5b5048'; fg.fillRect(0, 0, 32, 256); fg.fillStyle = '#4a4039'; fg.fillRect(0, 36, 32, 184);
  const px = 256 / 35; for (const y of [2.01, 35 - 2.01 - 2.79]) fg.clearRect(16 - 1.98 / 4.75 * 16, y * px, 1.98 / 4.75 * 32, 2.79 * px);
  const film = ctex(fc); film.wrapT = THREE.ClampToEdgeWrapping;
  // the focusing screen from above (37 × 25 mm): the Fresnel lens's rings, the ground glass, the microprism spot
  const sc = canvas(296, 200), sg = sc.getContext('2d'); sg.fillStyle = '#d6d4c8'; sg.fillRect(0, 0, 296, 200);
  for (let r = 3; r < 190; r += 2.2) { sg.strokeStyle = `rgba(110,108,100,${0.2 + 0.1 * Math.sin(r)})`; sg.lineWidth = 0.7; sg.beginPath(); sg.arc(148, 100, r, 0, Math.PI * 2); sg.stroke(); }
  sg.fillStyle = '#bdbbb0'; sg.beginPath(); sg.arc(148, 100, 20, 0, Math.PI * 2); sg.fill(); sg.strokeStyle = 'rgba(70,70,66,.55)'; sg.lineWidth = 0.6;
  sg.save(); sg.beginPath(); sg.arc(148, 100, 20, 0, Math.PI * 2); sg.clip(); for (let i = -30; i <= 30; i += 2.5) { sg.beginPath(); sg.moveTo(148 + i - 30, 70); sg.lineTo(148 + i + 30, 130); sg.moveTo(148 + i + 30, 70); sg.lineTo(148 + i - 30, 130); sg.stroke(); } sg.restore();
  sg.strokeStyle = 'rgba(60,60,56,.7)'; sg.lineWidth = 1; sg.beginPath(); sg.arc(148, 100, 20, 0, Math.PI * 2); sg.stroke();
  return { steel: std(0xb4b7bb, 1, 0.34), chrome: std(0xd9dbde, 1, 0.2), brass: std(0xb08d45, 1, 0.4), alu: std(0x9c9ea1, 1, 0.55), black: std(0x0d0d0e, 0.25, 0.78), dark: std(0x1c1d21, 0.85, 0.42),
    blade: std(0x1d1e23, 0.85, 0.4), paint: std(0x19191b, 0.35, 0.42), mirror: std(0xf3f5f7, 1, 0.04), cloth: std(0x0c0c0d, 0, 0.96), felt: std(0x101011, 0, 1), can: std(0x8d8f92, 1, 0.5),
    glass: std(0x93a4d6, 0, 0.02, { transparent: true, opacity: 0.2, alphaTest: 0, envMapIntensity: 3 }), deep: std(0x2a3a36, 0.95, 0.05),   // (glass: coated, clear, a blue cast, bright where it mirrors the room; deep: looking into the prism's silvered glass)
    film: std(0xffffff, 0.1, 0.42, { map: film }), screen: std(0xffffff, 0, 0.7, { map: ctex(sc, { rep: false }) }) };
}

// ---- the lens's glass: a lens between two spherical faces (their radii as the lens's maker writes them: positive, its
// centre toward the film), t thick at its middle, half diameter h, its front vertex at z0; faces: its polished faces,
// rim: its ground edge
function cpGlass(faces, h, z0) {   // faces: [radius, how far behind the front vertex] in turn (two, or three for a cemented pair)
  const sag = (R, r) => R - Math.sign(R) * Math.sqrt(R * R - r * r), n = 14, out = [], edge = [];
  faces.forEach(([R, at], i) => { const pts = []; for (let k = 0; k <= n; k++) { const r = h * (i ? k / n : 1 - k / n); pts.push([r, z0 - at - sag(R, r), true]); }   // (the front face from its edge in, the others from the middle out: each looks away from the glass)
    out.push(cpLathe(pts, 'z', 48)); edge.push(z0 - at - sag(R, h)); });
  return { faces: cpJoin(out), rim: cpLathe([[h, Math.min(...edge)], [h, Math.max(...edge)]], 'z', 48) };
}

/* the parts: key → pieces, each { geo: stuff → shape, to: the way it goes apart (mm), lag: how late it starts }; a key the
   shell has too (world/camera.js VC_PARTS) goes with the shell's piece of that name. keep: seen while the camera is whole */
function buildCamParts() {
  const M = cpMats(), P = {}, L = CP.lens, zs = CP.zFilm + CP.ys, add = (key, geo, to = [0, 0, 0], o = {}) => (P[key] = P[key] || []).push({ geo, to, lag: 0.12, ...o });
  // ---- the lens's glass, its stop, the thread at its back
  const R = L.R.map(v => v * L.k), D = L.d.map(v => v * L.k), z1 = CP.zFilm + L.bfl + D.reduce((a, b) => a + b, 0), at = i => D.slice(0, i).reduce((a, b) => a + b, 0);   // z1: its first surface
  const lensAt = [[0, 1, 0, 0, 112.6], [2, 3, 2, 1, 106], [4, 5, 4, 2, 101]].map(([a, b, d0, hi, to]) => ({ g: cpGlass([[R[a], at(d0)], [R[b], at(d0 + 1)]], L.h[hi], z1), to }));
  for (const e of lensAt) add('front', { glass: e.g.faces, black: e.g.rim }, [0, 0, e.to]);
  const pair = cpGlass([[R[6], at(6)], [R[7], at(7)], [R[8], at(8)]], L.h[3], z1), last = cpGlass([[R[9], at(9)], [R[10], at(10)]], L.h[5], z1);
  add('rear', { glass: pair.faces, black: pair.rim }, [0, 0, 46.3]); add('rear', { glass: last.faces, black: last.rim }, [0, 0, 41]);
  {   // the diaphragm: ten blades between two rings, closed to about f/4; each blade a curved leaf turning on a pin at its end
    const zi = z1 - at(5) - D[5] * 0.45, n = 10, ri = 9.9, ro = 13.5, rp = 12.5, turn = 0.4, s = new THREE.Shape();
    s.absarc(0, 0, ro, -0.05, 1.85, false); s.absarc(0, 0, ri, 1.85, -0.05, true); s.closePath();
    const blades = []; for (let i = 0; i < n; i++) { const g = new THREE.ShapeGeometry(s, 14), px = rp * Math.cos(0.1), py = rp * Math.sin(0.1);
      g.translate(-px, -py, 0).rotateZ(turn).translate(px, py, 0).rotateZ(i / n * Math.PI * 2).translate(0, 0, zi + (i - n / 2) * 0.05); blades.push(g); }
    const ring = cpJoin([cpLathe([[13.6, zi - 1.6], [16, zi - 1.6], [16, zi - 0.5], [13.6, zi - 0.5], [13.6, zi - 1.6]], 'z'), cpLathe([[13.6, zi + 0.5], [16.4, zi + 0.5], [16.4, zi + 1.5], [13.6, zi + 1.5], [13.6, zi + 0.5]], 'z')]);
    add('iris', { blade: cpJoin(blades), brass: ring }, [0, 0, 49]);
  }
  {   // behind the barrel: the M42 × 1 thread, the baffle round the last lens, the pin that stops the lens down
    const th = [[18.6, 34.4]]; for (let z = 34.4; z < 38.3; z += 1) th.push([20.6, z], [21, z + 0.5]); th.push([20.6, 38.3], [18.6, 38.3], [18.6, 34.4]);
    add('lens', { alu: cpLathe(th, 'z', 56), black: cpLathe([[12.5, 35], [18.6, 35.6]], 'z', 48), steel: cpCyl(0.9, 3.2, 0, -16.6, 33.6, 'z', 10) }, [0, 0, 78], { lag: 0 });
  }
  // ---- the mirror box: its casting, the lens board with the M42 throat, the mirror, the pin plate, the mirror's lever and spring
  {
    const th = [[22.6, 35.4], [22.6, 40.4], [20.5, 40.4]]; for (let z = 40.4; z > 35.6; z -= 1) th.push([20.5, z], [20.9, z - 0.5]); th.push([20.5, 35.4], [22.6, 35.4]);   // (the throat: its thread inside)
    const s = new THREE.Shape(); s.moveTo(-25.2, -24.4); s.lineTo(25.2, -24.4); s.lineTo(25.2, 24.6); s.lineTo(-25.2, 24.6); s.closePath(); s.holes.push(new THREE.Path().absarc(0, 0, 21.4, 0, Math.PI * 2, true));
    const plate = new THREE.ExtrudeGeometry(s, { depth: 1.3, bevelEnabled: false, curveSegments: 28 }).translate(0, 0, 38.7);   // (the lens board behind the shell's front plate)
    const tilt = Math.PI / 4, c45 = Math.SQRT1_2, mz = zs;
    add('mbox', {
      black: cpJoin([cpBox(1.5, 43.5, 31.9, -22.25, -0.75, 22.55), cpBox(1.5, 43.5, 31.9, 22.25, -0.75, 22.55), cpBox(46, 1.5, 31.9, 0, -22.5, 22.55), cpBox(46, 1.5, 8, 0, 21.25, 34.5), plate,
        cpBox(34, 1.6, 2.2, 0, 19.4, 29.6), cpBox(36.4, 0.8, 32.2, 0, -0.75 * c45, mz - 0.75 * c45, tilt)]),
      mirror: cpBox(35, 1.1, 31, 0, 0.18, mz + 0.18, tilt),
      steel: cpJoin([cpCyl(0.8, 41, 0, 11.9, mz - 11.9, 'x', 10), cpBox(15, 5, 0.9, 0, -17.6, 34.4), cpBox(0.9, 3.4, 17, 23.5, -6, 17, 0.5), cpCyl(1.5, 9.5, 23.7, -14, 21, 'z', 10), cpBox(0.9, 12, 3, 23.5, -16.5, 30)]),
      alu: cpLathe(th, 'z', 56) }, [0, 0, 30]);
  }
  // ---- the finder: the screen, the pentaprism, the eyepiece's lens
  add('screen', { screen: cpBox(37, 1.2, 25, 0, CP.ys + 0.6, zs), brass: cpJoin([cpBox(40, 1.8, 1.4, 0, CP.ys + 0.6, zs - 13.2), cpBox(40, 1.8, 1.4, 0, CP.ys + 0.6, zs + 13.2), cpBox(1.4, 1.8, 25, -19.2, CP.ys + 0.6, zs), cpBox(1.4, 1.8, 25, 19.2, CP.ys + 0.6, zs)]) }, [0, 10, 0]);
  {
    const { a, e, w, rear } = CP.prism, yb = CP.ys + 1.7, t = a + Math.tan(Math.PI / 8) * e, yr = e + t, s = Math.sin(Math.PI / 8), c = Math.cos(Math.PI / 8), q = Math.SQRT1_2;
    // where the light uses the front face highest, and the ridge farthest forward: the corner between them is cut off
    const top = (a + t + (yr + Math.tan(Math.PI / 8) * a - e) * Math.tan(Math.PI / 8) - a) / (1 + Math.tan(Math.PI / 8)), p1 = [a + 0.6, yr + Math.tan(Math.PI / 8) * (a + 0.6)], p2 = [a + top + 0.5, yr + Math.tan(Math.PI / 8) * a - top + 1.4];
    const cn = new THREE.Vector2(p1[1] - p2[1], p2[0] - p1[0]).normalize();   // (the cut's outward normal in z, y)
    const planes = [[0, -1, 0, 0], [0, 0, -1, rear], [1, 0, 0, w / 2], [-1, 0, 0, w / 2], [0, -s, c, -s * e + c * t], [q, q * c, -q * s, q * c * yr], [-q, q * c, -q * s, q * c * yr], [0, cn.y, cn.x, cn.x * p1[0] + cn.y * p1[1]]];
    add('prism', { 'paint+deep': cpHull(planes, [0, 1]).translate(0, yb, zs) }, [0, 24, 0]);
    const ye = yb + e, lens = cpGlass([[60, 0], [-60, 2.6]], 7.2, zs - rear - 4.4).faces.translate(0, ye, 0);
    add('eye', { glass: lens, black: cpLathe([[7.2, zs - rear - 7.4], [8.6, zs - rear - 7.4], [8.6, zs - rear - 4], [7.2, zs - rear - 4], [7.2, zs - rear - 7.4]], 'z', 32).translate(0, ye, 0) }, [0, 24, -10]);
  }
  // ---- the shutter, as it rests: two winding rollers (wind side), two spring rollers (rewind side), the closing curtain
  // across the gate, the opening one wound up, their laths and ribbons, the plates their pivots turn in
  {
    const roll = (x, r) => cpLathe([[0, -18], [r + 0.7, -18], [r + 0.7, -17.2], [r, -17.2], [r, 17.2], [r + 0.7, 17.2], [r + 0.7, 18], [0, 18]], 'y', 20).translate(x, 0, 3.6);
    const wrap = (x, r) => cpCyl(r, 28.4, x, 0, 3.6, 'y', 20);
    add('shutter', {
      steel: cpJoin([roll(-21.5, 2.3), roll(-27.5, 2.3), roll(21.5, 2.1), roll(27, 2.1), cpBox(1.2, 30, 0.5, 19.7, 0, 0.75), cpBox(1.2, 30, 0.5, 18.3, 0, 1.6),
        cpCyl(3.1, 1, 21.5, 19.6, 3.6, 'y', 14), cpCyl(3.1, 1, 27, 19.6, 3.6, 'y', 14)]),
      brass: cpJoin([cpGear(10, 2.9, 1.5, -21.5, -19.6, 3.6), cpGear(10, 2.9, 1.5, -27.5, -19.6, 3.6), cpBox(62, 0.7, 7.6, -0.3, 18.6, 4.1), cpBox(62, 0.7, 7.6, -0.3, -18.6, 4.1)]),
      cloth: cpJoin([cpBox(45.2, 28, 0.25, -2.9, 0, 0.75), wrap(-27.5, 3), wrap(21.5, 2.9), cpBox(7.4, 2.4, 0.2, 23.3, 15.2, 0.8), cpBox(7.4, 2.4, 0.2, 23.3, -15.2, 0.8), cpBox(39.6, 2.4, 0.2, -1.6, 15.2, 1.6), cpBox(39.6, 2.4, 0.2, -1.6, -15.2, 1.6)]) }, [0, 0, 0], { lag: 0 });
  }
  // ---- the body's casting: floor and ceiling, the walls between the chambers, the film wall with its gate and rails,
  // the sprocket, the take-up spool, the shafts
  {
    const O = [[-62.5, -4.2], [-64.7, -3.9], [-66.5, -2.9], [-74.9, 3.5], [-75.2, 4.3], [-75.2, 16.7], [-74.9, 17.5], [-66.5, 23.9], [-64.7, 24.9], [-62.5, 25.2], [51.6, 25.2], [54.1, 24.9], [55.9, 23.9], [64.3, 17.5], [64.6, 16.7], [64.6, 4.3], [64.3, 3.5], [55.9, -2.9], [54.1, -3.9], [51.6, -4.2]];
    const well = O.slice(0, 10).concat([[-23.8, 25.2], [-23.8, 4.4], [23.8, 4.4], [23.8, 25.2]], O.slice(10));   // (the ceiling: open over the mirror box, for the screen and the prism)
    const [sx, sz] = CP.sprocket, teeth = []; for (const y of [-14.1, 14.1]) for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; teeth.push(cpBox(1.3, 1.9, 1.5, sx + 6.4 * Math.sin(a), y, sz + 6.4 * Math.cos(a), 0, a, 0)); }
    const [wx, wz] = CP.wind;
    add('body', {
      black: cpJoin([cpPlate(O, CP.yBot, CP.yBot + 1.5, [[wx, wz, 2.6], [sx, sz, 2.4]]), cpPlate(well, CP.yTop - 1.6, CP.yTop, [[wx, wz, 2.6], [CP.rew[0], CP.rew[1], 2.6], [CP.dial[0], CP.dial[1], 2.2]]),
        cpBox(1.2, 53.2, 26, 36.6, -1.25, 11.8), cpBox(1.2, 53.2, 24.2, -46.2, -1.25, 12.7),   // (the film passes behind their back edges)
        cpBox(12, 53.2, 1.25, -24, -1.25, -2.03), cpBox(18, 53.2, 1.25, 27, -1.25, -2.03), cpBox(36, 13.3, 1.25, 0, 18.65, -2.03), cpBox(36, 15.9, 1.25, 0, -19.95, -2.03)]),
      chrome: cpJoin([cpBox(62, 1.6, 0.15, 4, 14.6, -2.72), cpBox(62, 1.6, 0.15, 4, -14.6, -2.72), cpBox(62, 1, 0.35, 4, 18.7, -2.82), cpBox(62, 1, 0.35, 4, -18.7, -2.82)]),   // (the film's rails, and the plate's just outside them, 0.2 mm higher)
      steel: cpJoin([cpLathe([[0, -19], [5.3, -19], [5.3, -15.4], [6.05, -15.4], [6.05, -12.8], [5.3, -12.8], [5.3, 12.8], [6.05, 12.8], [6.05, 15.4], [5.3, 15.4], [5.3, 19], [0, 19]], 'y', 24).translate(sx, 0, sz), ...teeth,
        cpCyl(1.6, 64, wx, 5, wz, 'y', 12), cpCyl(1.2, 58, CP.rel[0], 8, CP.rel[1], 'y', 10), cpCyl(1.9, 12, CP.rew[0], 30, CP.rew[1], 'y', 12), cpBox(5.4, 3.4, 1.1, CP.rew[0], 23.2, CP.rew[1])]),
      can: cpLathe([[2.2, -19], [10.5, -19], [10.5, -18.2], [6.4, -18.2], [6.4, 18.2], [10.5, 18.2], [10.5, 19], [2.2, 19]], 'y', 28).translate(wx, 0, wz) }, [0, 0, 0], { lag: 0 });
  }
  // ---- under the top cover: the wind ratchet and its gear, the frame counter's gear, the speed cams, the lever that shows the shutter wound
  {
    const [wx, wz] = CP.wind, [dx, dz] = CP.dial, y0 = CP.yTop;
    add('body', { brass: cpJoin([cpGear(24, 7.4, 1.3, wx, y0 + 1.6, wz, 1.6), cpGear(14, 3.4, 1.2, wx + 10.4, y0 + 1.6, wz - 2.6, 0.8), cpCyl(6.6, 1.1, dx, y0 + 1.2, dz, 'y', 28), cpCyl(4.6, 1.1, dx, y0 + 4.2, dz, 'y', 24)]),
      steel: cpJoin([cpGear(16, 5.6, 1.4, wx, y0 + 3.4, wz, 1.6, 1.3), cpCyl(5.4, 1.2, dx, y0 + 2.7, dz, 'y', 5), cpCyl(1.5, 8.6, dx, y0 + 4.3, dz, 'y', 10), cpBox(13, 0.8, 2.2, -52.5, y0 + 1, -0.6, 0, 0.5, 0), cpBox(9, 0.8, 3, CP.rel[0] + 2, y0 + 1, CP.rel[1] - 3.5, 0, -0.7, 0)]) }, [0, 0, 0], { lag: 0 });
  }
  // ---- under the body: the wind train and the lever that charges the mirror; the slow-speed escapement and its two rods
  {
    const [wx, wz] = CP.wind, [sx, sz] = CP.sprocket, y = CP.yBot - 1.3;
    add('gears', { brass: cpJoin([cpGear(40, 9.5, 1.2, wx, y, wz, 1.6), cpGear(20, 4.6, 1.2, -48.4, y, 6.9, 0.9), cpGear(34, 8, 1.2, sx, y, sz, 1.4), cpGear(16, 3.9, 1.2, -24.6, y, 3.6, 0.8)]),
      dark: cpJoin([cpGear(30, 7.2, 1.3, 13.5, y - 0.2, 3.5, 1.4), cpBox(2.2, 1.4, 9, 2.5, y - 0.6, 20)]),
      steel: cpJoin([cpBox(52, 0.8, 2.4, -26, y - 0.9, 23.3), cpCyl(1.3, 2.2, -40, y - 0.5, 23.3, 'y', 10), cpBox(2.2, 0.9, 12, 22.6, y - 0.9, 12)]) }, [0, 0, 0], { lag: 0 });
    const gx = -21, gz = 15;
    add('gov', { brass: cpJoin([cpBox(21, 0.9, 13, gx, y + 0.3, gz), cpGear(22, 4.2, 1, gx - 5.4, y - 0.9, gz - 1.5, 0.7, 0.7), cpGear(16, 3, 1, gx + 1.6, y - 0.9, gz + 0.5, 0.6, 0.7), cpGear(12, 2.2, 1, gx + 6, y - 0.9, gz - 2.6, 0.5, 0.7)]),
      steel: cpJoin([cpGear(9, 1.9, 0.9, gx + 7.4, y - 0.9, gz + 2.6, 0.5, 1), cpBox(4.6, 0.8, 1.2, gx + 8.3, y - 1.9, gz + 4.6, 0, 0.5, 0), cpCyl(0.55, 60.5, -25, 0.5, 11.2, 'y', 8), cpCyl(0.55, 60.5, -25, 0.5, 14, 'y', 8)]) }, [0, 0, 0], { lag: 0 });
  }
  // ---- the film: its cassette, the film across the gate and round the sprocket to the take-up spool
  {
    const [rx, rz] = CP.rew, [wx, wz] = CP.wind, [sx] = CP.sprocket, zf = CP.zFilm, path = [[rx - 12.4, zf], [sx, zf]], rc = 8.3;
    for (let i = 0; i <= 26; i++) { const a = -1.4 - i / 26 * 4.6; path.push([wx + rc * Math.cos(a), wz + rc * Math.sin(a)]); }   // (from the sprocket onto the spool's back, wound most of a turn)
    const pos = [], uv = [], idx = []; let s = 0;
    path.forEach(([x, z], i) => { if (i) s += Math.hypot(x - path[i - 1][0], z - path[i - 1][1]); pos.push(x, -17.5, z, x, 17.5, z); uv.push(s / 4.75, 0, s / 4.75, 1); if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); } });
    const strip = new THREE.BufferGeometry(); strip.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); strip.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); strip.setIndex(idx); strip.computeVertexNormals();
    add('film', { film: strip,
      can: cpLathe([[0, -22.8], [12.5, -22.8], [12.5, 21.4], [0, 21.4]], 'y', 32).translate(rx, 0, rz),
      black: cpJoin([cpLathe([[0, -26.2], [5.4, -26.2], [5.4, -22.8], [12.3, -22.8], [12.3, -22.2]], 'y', 24).translate(rx, 0, rz), cpLathe([[12.3, 20.8], [12.3, 21.6], [4, 21.6], [4, 22.6], [0, 22.6]], 'y', 24).translate(rx, 0, rz), cpBox(13, 40, 2.2, rx - 6.5, -0.7, zf + 0.3)]) }, [0, 0, -24]);   // (its two ends, the long one down; the felt mouth the film leaves by)
  }
  // ---- the back: the pressure plate on its two springs; the hinge's pin
  {
    const s = new THREE.Shape(), w = 64, h = 33, r = 3; s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0); s.lineTo(w / 2, h / 2 - r); s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2);
    s.lineTo(-w / 2 + r, h / 2); s.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI); s.lineTo(-w / 2, -h / 2 + r); s.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5);
    add('plate', { paint: new THREE.ExtrudeGeometry(s, { depth: 0.7, bevelEnabled: false, curveSegments: 6 }).translate(3, 0, CP.zFilm - 0.85), steel: cpJoin([cpBox(30, 4.5, 0.25, 3, 8, CP.zFilm - 1.15, 0, 0, 0.1), cpBox(30, 4.5, 0.25, 3, -8, CP.zFilm - 1.15, 0, 0, -0.1)]) }, [0, 0, -38]);
    add('back', { steel: cpCyl(0.9, 53, -67.4, -1.2, -2.6, 'y', 10) }, [0, 0, -52], { lag: 0 });
  }
  // ---- in the bottom cover: the tripod bush (1/4 inch), the rewind button under the sprocket
  {
    const th = [[3.2, -34.2], [5, -34.2], [5, -31.4], [7, -31.4], [7, -30.4], [3.2, -30.4]]; for (let y = -30.6; y > -33.6; y -= 1.27) th.push([3.2, y], [2.75, y - 0.63]); th.push([3.2, -34.2]);   // (1/4 inch, 20 threads an inch)
    add('bottom', { brass: cpLathe(th, 'y', 28).translate(0, 0, 12), chrome: cpCyl(2, 1.8, CP.sprocket[0], -34, CP.sprocket[1], 'y', 16) }, [0, -22, 0], { lag: 0, keep: true });
  }
  return { P, M };
}

export { CP, buildCamParts };
