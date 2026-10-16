import './rug.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas, ctex, rng } from '../core/utils.js';
import { MAT } from './materials.js';

/* ---------------------------------------------------------------- small furniture */
function stumpTable() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.3, 0.05, 48), MAT.oak); top.position.y = 0.505; g.add(top);
  const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.24 + 0.012 * Math.sin(t * 9) + (t < .1 ? .02 * (1 - t / .1) : 0), t * 0.48)); }
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), MAT.oakDark); g.add(body);
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.24, 40), MAT.oakDark); cap.rotation.x = -Math.PI / 2; cap.position.y = 0.48; g.add(cap);
  g.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
  return g;
}
function leafGeometry() {
  // 0.1 m long leaf, slightly folded along the midrib, pointing +z
  const pts = []; const L = 1, segs = 8; const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) { const t = i / segs; const w = Math.sin(Math.PI * Math.pow(t, 0.75)) * 0.32 * (1 - 0.25 * t); const y = -0.18 * t * t; pos.push(-w, y - w * 0.18, t * L, 0, y, t * L, w, y - w * 0.18, t * L); }
  for (let i = 0; i < segs; i++) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function plant({ leaves = 90, spread = 0.55, height = 0.75, seed = 5, scale = 0.12 } = {}) {
  const r = rng(seed); const g = new THREE.Group(); const lg = leafGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(lg, mat, leaves); const stems = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < leaves; i++) {
    const a = r() * Math.PI * 2, rad = Math.pow(r(), 0.7) * spread, h = height * (0.25 + 0.75 * r()) * (1 - 0.45 * rad / spread);
    p.set(Math.cos(a) * rad, h, Math.sin(a) * rad);
    e.set(-0.3 - r() * 0.9 + rad * 0.6, a + Math.PI / 2 + (r() - .5) * 1.2, (r() - .5) * .8, 'YXZ'); q.setFromEuler(e);
    const sc = scale * (0.7 + r() * 0.6); s.set(sc, sc, sc * 1.2); m.compose(p, q, s); inst.setMatrixAt(i, m);
    inst.setColorAt(i, new THREE.Color().setHSL(0.24 + r() * 0.06, 0.45 + r() * .2, 0.3 + r() * 0.22));
    if (i % 3 === 0) stems.push(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(p.x * .3, p.y * .8, p.z * .3), p.clone()));
  }
  inst.castShadow = true; g.add(inst);
  const sg = stems.map(c => new THREE.TubeGeometry(c, 8, 0.004, 4)); g.add(new THREE.Mesh(mergeGeometries(sg), new THREE.MeshStandardMaterial({ color: 0x5a7a3a, roughness: .7 })));
  return g;
}
function tableLamp() {
  const g = new THREE.Group();
  const prof = [[.001, 0], [.06, 0], [.075, .02], [.085, .08], [.078, .16], [.05, .22], [.026, .25], [.022, .28]];
  const base = new THREE.Mesh(new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p[0], p[1])), 32), MAT.ceramic); base.castShadow = true; g.add(base);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.007, .007, .1, 8), MAT.brass); stem.position.y = .32; g.add(stem);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(.115, .16, .21, 48, 1, true), MAT.shade); shade.position.y = .4; g.add(shade);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.16, .004, 6, 48), MAT.brass); rim.rotation.x = Math.PI / 2; rim.position.y = .295; g.add(rim);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.03, 12, 8), MAT.bulb); bulb.position.y = .37; g.add(bulb);
  const light = new THREE.PointLight(0xffc27e, 3.2, 5, 2); light.position.y = .37; g.add(light);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc27e, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(.9); glow.position.y = .4; g.add(glow);
  g.userData.light = light; g.userData.glow = glow; return g;
}
let _glow;
function glowTex() { if (_glow) return _glow; const c = canvas(128, 128), g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); _glow = ctex(c, { rep: false }); return _glow; }
function floorLamp() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.15, .16, .025, 40), MAT.bronze); base.position.y = .0125; g.add(base);
  const poleH = 1.42; const pole = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, poleH, 10), MAT.brass); pole.position.y = poleH / 2; g.add(pole);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(.025, 14, 10), MAT.brass); joint.position.y = poleH; g.add(joint);
  // main arm towards the shade (local −x, up), counter arm behind
  const arm = new THREE.Group(); arm.position.y = poleH; arm.rotation.z = -0.62; g.add(arm);
  const aL = 1.0; const rod = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, aL + .32, 8), MAT.brass); rod.rotation.z = Math.PI / 2; rod.position.x = -(aL - .32) / 2; arm.add(rod);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.03, 14, 10), MAT.bronze); knob.position.x = .32; arm.add(knob);
  const head = new THREE.Group(); head.position.x = -aL; arm.add(head);
  const sh = new THREE.Mesh(new THREE.LatheGeometry([[.014, 0], [.035, .012], [.06, .05], [.1, .13], [.15, .23], [.165, .25]].map(p => new THREE.Vector2(p[0], -p[1])), 48), MAT.copper);
  sh.rotation.set(-0.25, 0, 0.62 - 0.4); head.add(sh);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(.155, 40), new THREE.MeshBasicMaterial({ color: 0xffe6b0, side: THREE.DoubleSide })); inner.rotation.x = Math.PI / 2; inner.position.y = -.235; sh.add(inner);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc98f, transparent: true, opacity: .6, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(.6); glow.position.y = -.25; sh.add(glow);
  const pt = new THREE.PointLight(0xffc98f, 2.5, 4, 2); pt.position.y = -.3; sh.add(pt);
  const spot = new THREE.SpotLight(0xffc98f, 18, 7, 0.75, 0.65, 2); spot.position.set(0, -.1, 0); sh.add(spot);
  const tgt = new THREE.Object3D(); tgt.position.set(0, -2, 0); sh.add(tgt); spot.target = tgt; spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0005; spot.shadow.camera.near = 0.1;
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  g.userData.light = spot; g.userData.pt = pt; g.userData.glow = glow; g.userData.inner = inner; return g;
}
function candleJar() {
  const g = new THREE.Group();
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .09, 24, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .1, transparent: true, opacity: .35, side: 2 })); jar.position.y = .045; g.add(jar);
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(.036, .036, .04, 24), new THREE.MeshStandardMaterial({ color: 0xf2e8d2, roughness: .6, emissive: 0xffb060, emissiveIntensity: .25 })); wax.position.y = .02; g.add(wax);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(.007, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a })); flame.scale.y = 2; flame.position.y = .052; g.add(flame); g.userData.flame = flame;
  return g;
}
/* A bare bulb on a cord from the ceiling (G, 17/10/2026: "em cho bóng đèn này thành downlight ... nhớ làm thêm chuôi
   đèn và dây từ ceiling xuống"). The bulb is rebuilt from the measurements of "Incandescent Light Bulb" by AleixoAlonso
   (CC BY 4.0; 3D Assets/interior/light-bulb-incandescent.glb, an A-shape bulb 15.2 cm tall, its glass 9.2 cm across).
   Measured in its own frame, from the tip of its base up:
   - its glass, the model's profile turned;
   - its screw base, the thread's last ridges showing under the socket, and the black insulator at its tip;
   - the flattened glass stem; the two lead-in wires and the two supports; the coiled filament across their tops.
   It hangs base up in a brass socket (a shell over the thread, a collar, a domed cap, a cord grip), on a cloth cord
   from a brass cup on the ceiling. Its light is a spot straight down (a downlight); by night the filament glows, and
   the glass a little with it. drop: from the ceiling to the middle of the socket and bulb (m).                        */
function pendantLamp(drop) {
  const g = new THREE.Group(), lathe = (pts, mat, seg = 32) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);
  const tipY = -drop + 0.047, gripY = tipY + 0.058, cord = -gripY - 0.032;   // (the bulb's frame: the base's tip at tipY, its glass 0.152 below)
  // the ceiling cup and the cord
  g.add(lathe([[.004, -.032], [.010, -.031], [.030, -.027], [.045, -.018], [.052, -.008], [.055, 0]], MAT.brass, 40));
  const cloth = new THREE.Mesh(new THREE.CylinderGeometry(.0035, .0035, cord, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: .85 }));
  cloth.position.y = -.032 - cord / 2; g.add(cloth);
  // the bulb, in its own frame (y up from the tip of the base), turned base up
  const b = new THREE.Group(); b.rotation.x = Math.PI; b.position.y = tipY; g.add(b);
  b.add(lathe([[.0001, 0], [.0022, .0003], [.0086, .0028], [.0086, .0037]], new THREE.MeshStandardMaterial({ color: 0x141414, roughness: .3 }), 24));   // the insulator
  b.add(lathe([[.0086, .0037], [.0187, .0095], [.0200, .024], [.0207, .0255], [.0189, .0272], [.0207, .0289], [.0198, .0301], [.0191, .031], [.0184, .0326], [.0176, .0332]],
    new THREE.MeshStandardMaterial({ color: 0xc9c9c4, metalness: 1, roughness: .3 }), 32));   // the screw base
  // its glass: clear, lit by the room, more of it seen toward its edges (as glass is: Fresnel), a little warm from inside
  // when on; it keeps its depth, so the night sky (drawn after the paint, where the room left no depth) stays behind it
  const glass = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: .05, metalness: 0, transparent: true, opacity: .04, envMapIntensity: 1.6, emissive: 0xffd2a0, emissiveIntensity: 0 });
  glass.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
    gl_FragColor.a = clamp(gl_FragColor.a + 0.45 * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5), 0.0, 0.7);`); };
  const env = [[.0176, .0315], [.0205, .0365], [.0227, .040], [.0236, .0432], [.0240, .0466], [.0248, .0533], [.0279, .0633], [.0325, .070], [.0382, .080], [.0424, .090],
    [.0450, .0968], [.0459, .1069], [.0450, .1136], [.0424, .1236], [.0382, .1303], [.0325, .137], [.0255, .1437], [.0176, .1471], [.0090, .1504], [.0001, .1521]];
  // (its far side first, as the profile turned the other way, so its faces look inward and it shares the near side's
  // shader; the stem between them)
  const back = lathe([...env].reverse(), glass, 40), front = lathe(env, glass, 40); back.renderOrder = 1; front.renderOrder = 3; b.add(back, front);
  const stemShape = new THREE.Shape(), sp = [[.0084, .030], [.0085, .048], [.0062, .0525], [.0069, .057], [.0079, .0615], [.0068, .066], [.0026, .0705], [.0021, .075], [.0021, .0795], [.0048, .084]];
  stemShape.moveTo(-sp[0][0], sp[0][1]); for (const [x, y] of sp) stemShape.lineTo(x, y); for (let i = sp.length - 1; i >= 0; i--) stemShape.lineTo(-sp[i][0], sp[i][1]);
  const stemG = new THREE.ExtrudeGeometry(stemShape, { depth: .0038, bevelEnabled: false }); stemG.translate(0, 0, -.0019);
  const stem = new THREE.Mesh(stemG, new THREE.MeshStandardMaterial({ color: 0xf4f6f2, roughness: .1, transparent: true, opacity: .32, depthWrite: false })); stem.renderOrder = 2; b.add(stem);
  // the wires: lead-ins from the stem to the filament's ends, supports from its top up over it and hooked down onto it
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z), rod = (a, c, r) => { const d = c.clone().sub(a), m = new THREE.CylinderGeometry(r, r, d.length(), 5, 1, true);
    m.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); m.translate((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2); return m; };
  const wires = [];
  for (const s of [-1, 1]) {
    wires.push(rod(V(s * .005, .034), V(s * .005, .0373), .0004), rod(V(s * .005, .0373), V(s * .0148, .1007), .0004));
    wires.push(rod(V(s * .0011, .0687), V(s * .0087, .1063), .00032), rod(V(s * .0087, .1063), V(s * .0087, .1013), .00032));
  }
  b.add(new THREE.Mesh(mergeGeometries(wires), new THREE.MeshStandardMaterial({ color: 0x5a5a58, metalness: .7, roughness: .35 })));
  const turns = 18, hp = []; for (let i = 0; i <= turns * 10; i++) { const t = i / (turns * 10), a = t * turns * 2 * Math.PI; hp.push(V(-.016 + .032 * t, .1008 + .0011 * Math.cos(a), -.0002 + .0011 * Math.sin(a))); }
  const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp), turns * 16, .00028, 4), new THREE.MeshStandardMaterial({ color: 0x6a6a66, metalness: .6, roughness: .4, emissive: 0xffcf90, emissiveIntensity: 0 }));
  b.add(coil);
  // the socket over the base, base up: cord grip, domed cap, collar, shell, lip, and in under the lip
  b.add(lathe([[.0036, -.058], [.0062, -.0575], [.0062, -.044], [.012, -.043], [.0175, -.040], [.0215, -.0355], [.024, -.029], [.0248, -.024], [.0258, -.0235], [.0258, -.0195], [.0247, -.019],
    [.0247, -.002], [.0241, -.001], [.0247, 0], [.0247, .0225], [.0253, .0235], [.0253, .025], [.0213, .0252], [.0211, .02]], MAT.brass, 40));
  // its light: a spot straight down, from just under the glass (from the filament it would light the glass itself, 5 cm
  // away, white), and a glow round the bulb
  const spotY = tipY - .162, light = new THREE.SpotLight(0xffc98f, 0, 9, 0.85, 0.8, 2); light.position.y = spotY; light.target.position.y = spotY - 2.5; light.visible = false; g.add(light, light.target);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc98f, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(.26); glow.position.y = tipY - .105; glow.renderOrder = 4; g.add(glow);
  const at = new THREE.Vector3(), toCam = new THREE.Vector3();   // (drawn 7 cm toward the eye, in front of the glass that hides what is behind it)
  glow.onBeforeRender = (r, s, cam) => { g.localToWorld(at.set(0, tipY - .105, 0)); toCam.setFromMatrixPosition(cam.matrixWorld).sub(at).normalize(); glow.matrixWorld.setPosition(at.addScaledVector(toCam, .07)); };
  g.userData.light = light; g.userData.glow = glow; g.userData.coil = coil; g.userData.glass = glass;
  return g;
}

export { candleJar, floorLamp, pendantLamp, plant, stumpTable, tableLamp };
