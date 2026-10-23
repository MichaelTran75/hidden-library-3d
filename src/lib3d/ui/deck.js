import './flight.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { crispSeen } from '../world/pets.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { body } from '../core/base.js';
import { canvas, ctex, shrinkTexture } from '../core/utils.js';
import { camera, renderer } from '../core/renderer.js';
import { room } from '../world/room.js';
import { LIGHTS } from '../world/lights.js';
import { PAINT_GLSL, QUAD_VS, paintUniforms, setPaint } from '../fx/post.js';
import { lerp } from '../fx/night.js';
import { HOUR, TMPV } from '../fx/hour.js';
import { OVER } from './words.js';
import { setNeeds } from '../core/loop.js';

/* ---- the record player on the floor, between the chaise and the tall shelf: the page's own packed model (paper-and-ink
   base, platter and tonearm), drawn in the sharp layer like the page's sidebar deck, so the watercolour pass leaves it
   alone. It is tested against the room's depth like the titles. Its record carries the label art of the song playing;
   the platter turns and the arm tracks the song. A click on it brings out the page's player in the left corner (or
   puts it away); the player stays hidden otherwise.
   The canvas has no depth buffer of its own, so the deck is drawn into a small multisampled target that just covers
   it on screen (the camera's projection narrowed to that rectangle), then laid over the picture, 60 % of it painted as
   the picture is (G, 14/10/2026: 10 %, then 30 % more, then 20 % more; the paint pass's own steps, post.js PAINT_GLSL, so the turning
   label is painted as it turns). */
const DECK = { ok: false, hidden: false, born: 0, angle: 0, speed: 0, playing: false, progress: 0, hover: false, out: 0, scene: new THREE.Scene() };   // (out: its selection outline under the pointer, 0..1)
const DECKR = { rt: null, cam: new THREE.Camera(), corners: [], u: { uDepth: OVER.u.uDepth, uFull: { value: new THREE.Vector2(1, 1) }, uOff: { value: new THREE.Vector2() } }, quad: null };
DECK.R = DECKR;   // (for tests)
function sharpDepth(mat) {   // fragments behind the room are dropped (the target's pixels map back to the whole picture)
  mat.onBeforeCompile = sh => {
    sh.uniforms.uDepth = DECKR.u.uDepth; sh.uniforms.uFull = DECKR.u.uFull; sh.uniforms.uOff = DECKR.u.uOff;
    sh.fragmentShader = 'uniform sampler2D uDepth; uniform vec2 uFull, uOff;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;');
  };
  return mat;
}
function drawDeck() {   // the deck over the finished picture
  if (!DECK.ok || DECK.hidden) return;   // (hidden: until the furniture is shown, core/loop.js start)
  const W = OVER.u.uRes.value.x, H = OVER.u.uRes.value.y, pr = renderer.getPixelRatio();
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const c of DECKR.corners) { const v = TMPV.copy(c).applyMatrix4(DECK.deck.matrixWorld).project(camera); if (v.z > 1) return;
    const px = (v.x + 1) / 2 * W, py = (v.y + 1) / 2 * H; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  x0 = Math.max(0, Math.floor(x0) - 12); y0 = Math.max(0, Math.floor(y0) - 12); x1 = Math.min(W, Math.ceil(x1) + 12); y1 = Math.min(H, Math.ceil(y1) + 12);   // (room for its outline)
  const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
  const k = Math.min(1, 0.75 / pr), tw = Math.max(2, Math.round(w * k)), th = Math.max(2, Math.round(h * k));   // (at 0.75 px a CSS px: G, 20/10/2026, "hạ độ phân giải của máy nghe nhạc", then "giảm độ phân giải máy nghe nhạc")
  if (!DECKR.rt || DECKR.rt.width < tw || DECKR.rt.height < th) {
    if (DECKR.rt) DECKR.rt.dispose();
    DECKR.rt = new THREE.WebGLRenderTarget(Math.ceil(tw * 1.25), Math.ceil(th * 1.25), { samples: 2, type: THREE.HalfFloatType });
    DECKR.quad.material.uniforms.t.value = DECKR.rt.texture;
  }
  // the camera's projection narrowed to the rectangle (x, y scaled in clip space; depth as in the picture)
  const cx = (x0 + x1) / W - 1, cy = (y0 + y1) / H - 1, sx = W / w, sy = H / h, C = DECKR.cam;
  C.projectionMatrix.set(sx, 0, 0, -sx * cx, 0, sy, 0, -sy * cy, 0, 0, 1, 0, 0, 0, 0, 1).multiply(camera.projectionMatrix);
  C.projectionMatrixInverse.copy(C.projectionMatrix).invert(); C.matrix.copy(camera.matrixWorld); C.updateMatrixWorld(true);
  DECKR.u.uFull.value.set(W * k, H * k); DECKR.u.uOff.value.set(x0 * k, y0 * k);
  DECK.body3.uniforms.uLight.value.set(-0.45, 0.85, 0.35).transformDirection(DECK.deck.matrixWorld).transformDirection(camera.matrixWorldInverse);
  const cc = renderer.getClearColor(TMPC), ca = renderer.getClearAlpha();
  DECKR.rt.viewport.set(0, 0, tw, th); DECKR.rt.scissor.set(0, 0, tw, th); DECKR.rt.scissorTest = true;
  renderer.setRenderTarget(DECKR.rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(DECK.scene, C);
  renderer.setRenderTarget(null); renderer.setClearColor(cc, ca);
  { const Q = DECKR.quad.material.uniforms; if (!DECK.born) DECK.born = performance.now(); const fb = Math.min(1, (performance.now() - DECK.born) / 700); Q.uBorn.value = fb * fb * (3 - 2 * fb); if (fb < 1) setNeeds(true); Q.uOut.value = DECK.out; Q.uOutW.value = 2 * pr * k; Q.uHalo.value = 1.6 * pr * k; }   // (its width on screen kept)
  DECKR.quad.material.uniforms.uScale.value.set(tw / DECKR.rt.width, th / DECKR.rt.height); setPaint(DECKR.quad.material.uniforms, DECKR.rt, W, H, k);   // (its strokes as wide on the screen as at full size: 2.7 times as many of its pixels, they had pulled the clear edge round it into the far side of the record, G 20/10/2026)
  renderer.autoClear = false; renderer.setViewport(x0 / pr, y0 / pr, w / pr, h / pr); DECKR.quad.render(renderer);   // over the picture: no clear
  renderer.setViewport(0, 0, W / pr, H / pr); renderer.autoClear = true; crispSeen(DECKR);   // (its target let go when it is off the screen: pets.js sweepCrisp)
}
const TMPC = new THREE.Color();
function buildRecordPlayer() {
  const txt = window.__lib3dTT; delete window.__lib3dTT; if (!txt) return;
  const J = JSON.parse(txt), M = J.meta, bin = Uint8Array.from(atob(J.bin), ch => ch.charCodeAt(0)).buffer;
  // the page's own paper-and-ink shading: its texture is a mask (1 paper, 0 ink), uploaded as is; paper lit softly
  // from the upper left of the deck, as in the sidebar
  const ink = new THREE.TextureLoader().load('data:image/png;base64,' + J.tex, tx => shrinkTexture(tx, 256)); ink.flipY = false; ink.anisotropy = 8;   // (512 kept at 256: G, 20/10/2026)
  const body3 = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { uTex: { value: ink }, uPaper: { value: new THREE.Color() }, uInk: { value: new THREE.Color() },
      uLight: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: 0 }, uDepth: DECKR.u.uDepth, uFull: DECKR.u.uFull, uOff: DECKR.u.uOff },
    vertexShader: 'varying vec3 vN; varying vec2 vUv; void main(){ vN = normalize(normalMatrix * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uTex, uDepth; uniform vec3 uPaper, uInk, uLight; uniform float uGlow; uniform vec2 uFull, uOff; varying vec3 vN; varying vec2 vUv;
      void main(){ if (gl_FragCoord.z > texture2D(uDepth, (gl_FragCoord.xy + uOff) / uFull).r + 2e-6) discard;
        float t = texture2D(uTex, vUv).r; vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        float shade = mix(0.8, 1.0, smoothstep(0.12, 0.32, dot(n, uLight)));
        gl_FragColor = vec4(mix(uInk, uPaper * shade, t) * (1.0 + uGlow), 1.0); }` });
  const line = sharpDepth(new THREE.MeshBasicMaterial({ color: 0x2a2219, side: THREE.BackSide }));
  const geo = e => { const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Int16Array(bin, e.pos, e.verts * 3), 3, true));
    if (e.nrm != null) g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, e.nrm, e.verts * 3), 3, true));
    if (e.uv != null) g.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(bin, e.uv, e.verts * 2), 2, true));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, e.idx, e.count), 1)); return g; };
  const part = (name, pivot) => { const grp = new THREE.Group(); grp.position.set(pivot[0], 0, pivot[1]);
    for (const [kind, mat] of [['main', body3], ['outline', line]]) { const m = new THREE.Mesh(geo(M.parts[name][kind]), mat);
      m.position.set(M.center[0] - pivot[0], M.center[1], M.center[2] - pivot[1]); m.scale.set(...M.half); grp.add(m); }
    return grp; };
  const deck = new THREE.Group(), base = part('base', [0, 0]), platter = part('platter', [M.platter.x, M.platter.z]), arm = part('arm', [M.pivot.x, M.pivot.z]);
  deck.add(base, platter, arm);
  const recMat = sharpDepth(new THREE.MeshBasicMaterial({ color: 0x1c1712 }));
  const rec = new THREE.Mesh(new THREE.CircleGeometry(M.platter.recordR, 64), recMat); rec.rotation.x = -Math.PI / 2; rec.position.y = M.platter.recordY + 0.01; platter.add(rec);
  // a deck (~52 cm, a console-size one) standing on the floor, turned toward the room
  const P = DECK_AT, s = 0.52 / (2 * M.half[2]); deck.scale.setScalar(s); deck.rotation.y = P.ry;
  const foot = new THREE.Vector3(M.center[0], M.center[1] - M.half[1], M.center[2]).multiplyScalar(s).applyAxisAngle(new THREE.Vector3(0, 1, 0), deck.rotation.y);
  deck.position.set(P.x, 0.004, P.z).sub(foot); DECK.scene.add(deck); deck.updateMatrixWorld(true);
  { const b = new THREE.Box3(); deck.traverse(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); } });
    const inv = deck.matrixWorld.clone().invert(); for (let i = 0; i < 8; i++) DECKR.corners.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(inv));
    // the sun's shadow of it: drawn in a scene of its own, it cast none; a box of its size in the room, unseen, casts it
    // (G, 24/10/2026: "tạo shadow ... đúng theo hướng sáng từ cửa sổ ... bao gồm máy nghe đĩa")
    const sz = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
    const caster = new THREE.Mesh(new THREE.BoxGeometry(sz.x * 0.94, sz.y * 0.9, sz.z * 0.94), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    caster.position.copy(ctr); caster.castShadow = true; caster.receiveShadow = false; room.add(caster); DECK.caster = caster;
    if (LIGHTS.winShadows && LIGHTS.winShadowOf) LIGHTS.winShadows.push(LIGHTS.winShadowOf(room, caster, 0.003, 0.62, 0.38)); }   // (and the daylight's shade behind it: world/furnish.js)
  DECKR.cam.matrixAutoUpdate = false;
  DECKR.quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { uBorn: { value: 1 }, t: { value: null }, uScale: { value: new THREE.Vector2(1, 1) }, uPaint: { value: 0.6 }, uOut: { value: 0 }, uOutW: { value: 4 }, uHalo: { value: 3 }, ...paintUniforms() },
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, vertexShader: QUAD_VS,
    fragmentShader: `uniform sampler2D t; uniform vec2 uScale; uniform float uPaint, uOut, uOutW, uHalo, uBorn; varying vec2 vUv;
      ${PAINT_GLSL}
      vec3 toS(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(0.0031308,c)); }
      float aAt(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > uScale.x || uv.y > uScale.y) ? 0.0 : texture2D(t, uv).a; }
      vec4 shadeAt(vec2 uv) { vec4 c = texture2D(t, clamp(uv, uTexel * 0.5, uScale - uTexel * 0.5)); return c.a < 0.002 ? vec4(0.0) : vec4(toS(c.rgb / c.a), c.a); }
      void main(){ vec2 uv = vUv * uScale; vec4 o = shadeAt(uv); if (uPaint > 0.001) { float det; vec4 pt = paintAt(uv, det); o = mix(o, pt, uPaint * (1.0 - 0.45 * smoothstep(0.004, 0.04, det))); }   // (busy detail kept crisper)
        vec4 res = vec4(o.rgb * o.a, o.a);
        if (uOut > 0.001) {   // under the pointer, outlined as the 747 and the clock are (pets.js sharpQuad): white just outside it, a soft dark edge beyond
          float near = 0.0, far = 0.0, here = aAt(uv);
          for (int i = 0; i < 24; i++) { float an = 6.2831853 * (float(i) + 0.5) / 24.0; vec2 d = vec2(cos(an), sin(an)) * uTexel;
            near = max(near, max(aAt(uv + d * uOutW), aAt(uv + d * uOutW * 0.5))); far = max(far, aAt(uv + d * (uOutW + uHalo))); }
          float w = smoothstep(0.2, 0.6, near) * (1.0 - smoothstep(0.3, 0.8, here)) * 0.95 * uOut, h = smoothstep(0.1, 0.6, far) * (1.0 - here) * 0.55 * uOut;
          vec4 ring = vec4(vec3(0.886, 0.839, 0.753) * w, w); ring += vec4(vec3(0.08, 0.055, 0.03) * h, h) * (1.0 - ring.a); res += ring * (1.0 - res.a);
        }
        res *= uBorn; if (res.a < 0.002) discard; gl_FragColor = res; }` }));
  // its contact shadow on the floor (in the room, so it is painted with it)
  { const c = canvas(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    gr.addColorStop(0, 'rgba(20,12,6,.92)'); gr.addColorStop(0.55, 'rgba(20,12,6,.62)'); gr.addColorStop(1, 'rgba(20,12,6,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);   // (darker and wider: G, 24/10/2026, "render shadow thêm cho máy nghe nhạc")
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.7), new THREE.MeshBasicMaterial({ map: ctex(c, { rep: false }), transparent: true, depthWrite: false, fog: false }));
    sh.rotation.set(-Math.PI / 2, 0, P.ry + Math.PI / 2); sh.position.set(P.x, 0.003, P.z); room.add(sh); }
  const hit = new THREE.Mesh(new THREE.BoxGeometry(2 * M.half[0], 2 * M.half[1] + 0.6, 2 * M.half[2]), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(M.center[0], M.center[1], M.center[2]); hit.userData.deck = true; deck.add(hit); hit.updateMatrixWorld(true);
  Object.assign(DECK, { ok: true, deck, platter, arm, rec, recMat, body3, line, hit, M });
  arm.rotation.y = M.arm.rest;
  const img = document.getElementById('disc-img');
  const loadDish = () => { if (!img || !img.src) return; const src = img.src.replace(/w_\d+,h_\d+/, 'w_128,h_128');
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(src, tx => { shrinkTexture(tx, 128); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; if (recMat.map) recMat.map.dispose(); recMat.map = tx; recMat.color.set(0xffffff); recMat.needsUpdate = true; setNeeds(true); }); };   // (the last song's label let go; no alpha test: the circle is the record's edge, and the picture's soft rim, compressed, came apart into specks under one)
  loadDish(); if (img) new MutationObserver(loadDish).observe(img, { attributes: true, attributeFilter: ['src'] });
}
const DECK_AT = { x: 1.86, z: -5.12, ry: -Math.PI / 2 - 0.36 };   // the floor in front of the chaise's end, by the shelf
function stepDeck(dt) {   // follows the sidebar deck: spins while the music plays, the arm tracks the song
  if (!DECK.ok) return false;
  const disc = document.getElementById('disc'), seek = document.getElementById('music-seek');
  DECK.playing = !!(disc && disc.classList.contains('is-spinning'));
  DECK.progress = seek && +seek.max ? +seek.value / +seek.max : 0;
  const M = DECK.M, target = DECK.playing ? M.arm.outer + (M.arm.inner - M.arm.outer) * DECK.progress : M.arm.rest;
  const omega = DECK.playing ? 33.333 / 60 * Math.PI * 2 * 0.25 : 0;
  DECK.speed += (omega - DECK.speed) * Math.min(1, dt * (omega > DECK.speed ? 1.3 : 0.55)); if (Math.abs(omega - DECK.speed) < 0.01) DECK.speed = omega;
  DECK.angle = (DECK.angle - DECK.speed * dt) % (Math.PI * 2); DECK.platter.rotation.y = DECK.angle;
  const armMoving = Math.abs(target - DECK.arm.rotation.y) > 0.001;
  DECK.arm.rotation.y += (target - DECK.arm.rotation.y) * Math.min(1, dt * 1.6);
  // the page's day and night paper and ink (its sidebar deck's theme), dimmed and warmed a little with the room's light
  const S = HOUR.S, n = S.n, U = DECK.body3.uniforms, k = lerp(lerp(0.8, 1, Math.min(1, S.amb)), 1, n);
  U.uPaper.value.setRGB(lerp(0.94, 0.74, n) * k, lerp(0.91, 0.70, n) * k * (1 - 0.06 * S.warm), lerp(0.84, 0.62, n) * k * (1 - 0.16 * S.warm), THREE.SRGBColorSpace);
  U.uInk.value.setRGB(lerp(0.17, 0.07, n), lerp(0.14, 0.06, n), lerp(0.11, 0.05, n), THREE.SRGBColorSpace); DECK.line.color.copy(U.uInk.value);
  if (DECK.recMat.map) DECK.recMat.color.setScalar(lerp(1, 0.64, n)); else DECK.recMat.color.copy(U.uInk.value);   // the label art, dimmed by night like the page's
  const hv = DECK.hover ? 0.12 : 0; U.uGlow.value += (hv - U.uGlow.value) * Math.min(1, dt * 10);
  const ot = DECK.hover ? 1 : 0, ow = DECK.out; DECK.out += Math.sign(ot - DECK.out) * Math.min(Math.abs(ot - DECK.out), dt / 0.14);   // (the outline in and out, as the 747's)
  return armMoving || (DECK.speed !== omega) || Math.abs(hv - U.uGlow.value) > 0.004 || DECK.out !== ow;   // a steady spin is drawn cheaply (loop)
}
function togglePlayer(open = !body.classList.contains('l3-player-open')) {   // the page's own player, in the left corner
  clearTimeout(togglePlayer.t);
  if (open) {
    body.classList.remove('l3-player-closing'); body.classList.add('l3-player-open');
    // the page redraws its deck only on its own events (it skips them while the tab is hidden): its visibility
    // handler resumes it, so it is shown drawn even if the page loaded in a background tab
    document.dispatchEvent(new Event('visibilitychange'));
  }
  else if (body.classList.contains('l3-player-open')) { body.classList.add('l3-player-closing'); togglePlayer.t = setTimeout(() => body.classList.remove('l3-player-open', 'l3-player-closing'), 280); }
}

export { DECK, DECKR, buildRecordPlayer, drawDeck, stepDeck, togglePlayer };
