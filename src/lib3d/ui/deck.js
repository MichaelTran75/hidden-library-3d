import './flight.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { body } from '../core/base.js';
import { canvas, ctex, shrinkTexture } from '../core/utils.js';
import { camera } from '../core/renderer.js';
import { lerp } from '../fx/night.js';
import { HOUR } from '../fx/hour.js';
import { room } from '../world/room.js';
import { LIGHTS } from '../world/lights.js';
import { OVER } from './words.js';
import { setNeeds } from '../core/loop.js';

/* ---- the record player on the floor, between the chaise and the tall shelf: the page's own packed model (paper-and-ink
   base, platter and tonearm), standing in the room like the rest of the furniture: lit by the room's lights, casting and
   taking shadows, painted by the watercolour pass and blurred by the depth of field with everything else. Its record
   carries the label art of the song playing; the platter turns and the arm tracks the song. A click on it brings out the
   page's player in the left corner (or puts it away); the player stays hidden otherwise. */
const DECK = { ok: false, hidden: false, angle: 0, speed: 0, playing: false, progress: 0, hover: false, out: 0, scene: new THREE.Scene() };   // (out: its outline under the pointer, 0..1)
const DECKR = { u: { uDepth: OVER.u.uDepth, uFull: { value: new THREE.Vector2(1, 1) }, uOff: { value: new THREE.Vector2() } } };   // (the sharp layers' depth test: pets.js, clock.js, camera.js …)
DECK.R = DECKR;   // (for tests)
const SEL = new THREE.Color(0.886, 0.839, 0.753);   // the selection colour (pets.js)
function drawDeck() {}   // (drawn with the room now)
function buildRecordPlayer() {
  const txt = window.__lib3dTT; delete window.__lib3dTT; if (!txt) return;
  const J = JSON.parse(txt), M = J.meta, bin = Uint8Array.from(atob(J.bin), ch => ch.charCodeAt(0)).buffer;
  // the page's own paper-and-ink shading: its texture is a mask (1 paper, 0 ink), uploaded as is; paper lit softly
  // from the upper left of the deck, as in the sidebar, dimmed and warmed with the room's light (stepDeck)
  const ink = new THREE.TextureLoader().load('data:image/png;base64,' + J.tex, tx => shrinkTexture(tx, 256)); ink.flipY = false; ink.anisotropy = 8;
  const body3 = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { uTex: { value: ink }, uPaper: { value: new THREE.Color() }, uInk: { value: new THREE.Color() },
      uLight: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec2 vUv; void main(){ vN = normalize(normalMatrix * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uTex; uniform vec3 uPaper, uInk, uLight; uniform float uGlow; varying vec3 vN; varying vec2 vUv;
      void main(){ float t = texture2D(uTex, vUv).r; vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        float shade = mix(0.8, 1.0, smoothstep(0.12, 0.32, dot(n, uLight)));
        gl_FragColor = vec4(mix(uInk, uPaper * shade, t) * (1.0 + uGlow), 1.0); }` });
  // (three's lit material read this model's uv at the wrong places, its plate came out ink: the page's own shader kept)
  const line = new THREE.MeshBasicMaterial({ color: 0x2a2219, side: THREE.BackSide });   // (its ink outline: the model's own inflated hull)
  const geo = e => { const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Int16Array(bin, e.pos, e.verts * 3), 3, true));
    if (e.nrm != null) g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, e.nrm, e.verts * 3), 3, true));
    if (e.uv != null) g.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(bin, e.uv, e.verts * 2), 2, true));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, e.idx, e.count), 1)); return g; };
  const part = (name, pivot) => { const grp = new THREE.Group(); grp.position.set(pivot[0], 0, pivot[1]);
    for (const [kind, mat] of [['main', body3], ['outline', line]]) { const m = new THREE.Mesh(geo(M.parts[name][kind]), mat);
      m.position.set(M.center[0] - pivot[0], M.center[1], M.center[2] - pivot[1]); m.scale.set(...M.half); m.castShadow = kind === 'main'; grp.add(m); }
    return grp; };
  const deck = new THREE.Group(), base = part('base', [0, 0]), platter = part('platter', [M.platter.x, M.platter.z]), arm = part('arm', [M.pivot.x, M.pivot.z]);
  deck.add(base, platter, arm);
  // (a white pixel where the label will be: the label coming in later changes no shader)
  const recMat = new THREE.MeshBasicMaterial({ color: 0x1c1712, map: new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) }); recMat.map.colorSpace = THREE.SRGBColorSpace; recMat.map.needsUpdate = true;
  const rec = new THREE.Mesh(new THREE.CircleGeometry(M.platter.recordR, 64), recMat); rec.rotation.x = -Math.PI / 2; rec.position.y = M.platter.recordY + 0.01; platter.add(rec);
  // a deck (~52 cm, a console-size one) standing on the floor, turned toward the room
  const P = DECK_AT, s = 0.52 / (2 * M.half[2]); deck.scale.setScalar(s); deck.rotation.y = P.ry;
  const foot = new THREE.Vector3(M.center[0], M.center[1] - M.half[1], M.center[2]).multiplyScalar(s).applyAxisAngle(new THREE.Vector3(0, 1, 0), deck.rotation.y);
  deck.position.set(P.x, 0.004, P.z).sub(foot); deck.visible = false; room.add(deck); deck.updateMatrixWorld(true);
  { const b = new THREE.Box3(); deck.traverse(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); } });
    // the daylight's shade behind it (world/furnish.js), measured on a box of its size
    const sz = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
    const box = new THREE.Mesh(new THREE.BoxGeometry(sz.x * 0.94, sz.y * 0.9, sz.z * 0.94)); box.position.copy(ctr);
    if (LIGHTS.winShadows && LIGHTS.winShadowOf) LIGHTS.winShadows.push(LIGHTS.winShadowOf(room, box, 0.003, 0.62, 0.38));
    box.geometry.dispose(); }
  // its contact shadow on the floor
  { const c = canvas(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    gr.addColorStop(0, 'rgba(20,12,6,.92)'); gr.addColorStop(0.55, 'rgba(20,12,6,.62)'); gr.addColorStop(1, 'rgba(20,12,6,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.7), new THREE.MeshBasicMaterial({ map: ctex(c, { rep: false }), transparent: true, depthWrite: false, fog: false }));
    sh.rotation.set(-Math.PI / 2, 0, P.ry + Math.PI / 2); sh.position.set(P.x, 0.003, P.z); room.add(sh); }
  const hit = new THREE.Mesh(new THREE.BoxGeometry(2 * M.half[0], 2 * M.half[1] + 0.6, 2 * M.half[2]), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(M.center[0], M.center[1], M.center[2]); hit.userData.deck = true; deck.add(hit); hit.updateMatrixWorld(true);
  Object.assign(DECK, { ok: true, deck, platter, arm, rec, recMat, body3, line, hit, M });
  arm.rotation.y = M.arm.rest;
  const img = document.getElementById('disc-img');
  const loadDish = () => { if (!img || !img.src) return; const src = img.src.replace(/w_\d+,h_\d+/, 'w_128,h_128');
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(src, tx => { shrinkTexture(tx, 128); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; if (recMat.map) recMat.map.dispose(); recMat.map = tx; recMat.color.set(0xffffff); setNeeds(true); }); };   // (the last song's label let go; no alpha test: the circle is the record's edge, and the picture's soft rim, compressed, came apart into specks under one)
  loadDish(); if (img) new MutationObserver(loadDish).observe(img, { attributes: true, attributeFilter: ['src'] });
}
const DECK_AT = { x: 1.86, z: -5.12, ry: -Math.PI / 2 };   // the floor in front of the chaise's end, by the shelf, its edges parallel to the sofa's
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
  DECK.deck.visible = !DECK.hidden;   // (hidden: until the furniture is shown, core/loop.js start)
  // the page's day and night paper and ink (its sidebar deck's theme), dimmed and warmed a little with the room's light
  const S = HOUR.S, n = S.n, U = DECK.body3.uniforms, k = lerp(lerp(0.8, 1, Math.min(1, S.amb)), 1, n);
  U.uPaper.value.setRGB(lerp(0.94, 0.74, n) * k, lerp(0.91, 0.70, n) * k * (1 - 0.06 * S.warm), lerp(0.84, 0.62, n) * k * (1 - 0.16 * S.warm), THREE.SRGBColorSpace);
  U.uInk.value.setRGB(lerp(0.17, 0.07, n), lerp(0.14, 0.06, n), lerp(0.11, 0.05, n), THREE.SRGBColorSpace);
  U.uLight.value.set(-0.45, 0.85, 0.35).transformDirection(DECK.deck.matrixWorld).transformDirection(camera.matrixWorldInverse);
  if (DECK.recMat.map) DECK.recMat.color.setScalar(lerp(1, 0.64, n)); else DECK.recMat.color.copy(U.uInk.value);   // the label art, dimmed by night like the page's
  const hv = DECK.hover ? 0.12 : 0; U.uGlow.value += (hv - U.uGlow.value) * Math.min(1, dt * 10);
  const ot = DECK.hover ? 1 : 0, ow = DECK.out; DECK.out += Math.sign(ot - DECK.out) * Math.min(Math.abs(ot - DECK.out), dt / 0.14);   // (the outline in and out, as the 747's)
  DECK.line.color.copy(U.uInk.value).lerp(SEL, DECK.out);   // (its ink outline turns the selection colour)
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
