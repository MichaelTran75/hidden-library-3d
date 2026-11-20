import './atlas.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { MAT } from '../materials.js';
import { dkBall, dkLathe, dkRing } from './kit.js';

const DECOR_ITEMS = [
  function celadonBottle(it) {   // a tall celadon bottle (meiping) and a small cup
    it.add(dkLathe([[0.045, 0], [0.05, 0.012], [0.066, 0.07], [0.088, 0.16], [0.07, 0.225], [0.032, 0.255], [0.024, 0.27], [0.031, 0.285], [0.026, 0.287]]), 0x9dbba0, 'gloss', { p: [-0.04, 0, 0] });
    it.add(dkLathe([[0.018, 0], [0.024, 0.01], [0.032, 0.04], [0.034, 0.045]]), 0xe9e4d6, 'gloss', { p: [0.12, 0, 0.04] });
  },
  function gingerJar(it) {   // a cobalt ginger jar with its lid, a white band at the shoulder
    it.add(dkLathe([[0.05, 0], [0.056, 0.01], [0.085, 0.07], [0.09, 0.11], [0.075, 0.15], [0.052, 0.165], [0.05, 0.175]]), 0x2c4a8a, 'gloss');
    it.add(dkLathe([[0.056, 0], [0.056, 0.012], [0.045, 0.03], [0.02, 0.042], [0.012, 0.05], [0.017, 0.06], [0.001, 0.066]]), 0x2c4a8a, 'gloss', { p: [0, 0.172, 0] });
    it.add(dkRing(0.087, 0.004), 0xf1ede2, 'gloss', { p: [0, 0.095, 0], r: [Math.PI / 2, 0, 0] });
  },
  function amphora(it) {   // a terracotta amphora with two handles and black bands
    it.add(dkLathe([[0.035, 0], [0.04, 0.015], [0.06, 0.05], [0.075, 0.11], [0.07, 0.16], [0.04, 0.2], [0.028, 0.225], [0.034, 0.25], [0.03, 0.252]]), 0xb5643d, 'matte');
    for (const s of [1, -1]) it.add(dkRing(0.034, 0.006, Math.PI, 12), 0xb5643d, 'matte', { p: [s * 0.05, 0.195, 0], r: [0, 0, -s * Math.PI / 2] });
    for (const [y, rr0] of [[0.12, 0.074], [0.135, 0.073]]) it.add(dkRing(rr0, 0.003), 0x2a1d16, 'matte', { p: [0, y, 0], r: [Math.PI / 2, 0, 0] });
  },
  function driedFlowers(it, r) {   // a white bud vase with dried stems and seed heads
    it.add(dkLathe([[0.03, 0], [0.04, 0.04], [0.042, 0.08], [0.02, 0.12], [0.016, 0.14], [0.02, 0.15]]), 0xf2efe8, 'matte');
    for (let k = 0; k < 5; k++) {
      const a = -0.5 + k * 0.25 + r(-0.08, 0.08), L = r(0.12, 0.17), top = [Math.sin(a) * L, 0.13 + Math.cos(a) * L, r(-0.03, 0.03)];
      it.rod([0, 0.13, 0], top, 0.0018, 0x8a6e4b, 'matte', 0.0012, 5);
      it.add(k % 2 ? dkBall(0.013, 8, 6) : new THREE.ConeGeometry(0.01, 0.04, 6), k % 2 ? 0x6b5136 : 0xd9c08a, 'matte', { p: top, r: [0, 0, -a] });
    }
  },
  function blackGourd(it) {   // a black double gourd tied with a red cord
    it.add(dkLathe([[0.04, 0], [0.05, 0.01], [0.07, 0.05], [0.068, 0.09], [0.035, 0.125], [0.045, 0.16], [0.044, 0.19], [0.022, 0.215], [0.016, 0.235], [0.02, 0.245]]), 0x1d1c1a, 'gloss');
    it.add(dkRing(0.036, 0.004), 0x9a2b25, 'matte', { p: [0, 0.125, 0], r: [Math.PI / 2, 0, 0] });
    it.rod([0.03, 0.125, 0.02], [0.05, 0.06, 0.04], 0.0025, 0x9a2b25);
  },
  function stoneBowl(it) {   // a wide sand-glazed bowl with river stones
    it.add(dkLathe([[0.04, 0], [0.06, 0.008], [0.1, 0.04], [0.115, 0.068], [0.11, 0.07]]), 0xd8c6a2, 'matte');
    [[-0.03, 0.05, 0, 0x8d8a84], [0.03, 0.052, 0.02, 0xb7b2a8], [0.01, 0.06, -0.03, 0x5e5b57]].forEach(([x, y, z, c]) => it.add(dkBall(0.026, 10, 8), c, 'gloss', { p: [x, y, z], s: [1, 0.55, 0.8] }));
  },
  function bottleTrio(it) {   // three slim bottles in greens
    [[-0.09, 0, 1, 0x4f7a5a], [0, -0.03, 0.78, 0x7d9a6c], [0.085, 0.02, 0.58, 0x3a5a6a]].forEach(([x, z, s, c]) =>
      it.add(dkLathe([[0.03, 0], [0.032, 0.11], [0.028, 0.14], [0.012, 0.18], [0.01, 0.23], [0.013, 0.236]]), c, 'gloss', { p: [x, 0, z], s: [1, s * 1.25, 1] }));
  },
  function vasePair(it) {   // a white cylinder and an ochre round vase
    it.add(dkLathe([[0.04, 0], [0.042, 0.18], [0.038, 0.2], [0.041, 0.206]]), 0xefe9dc, 'matte', { p: [-0.07, 0, -0.02] });
    it.add(dkLathe([[0.03, 0], [0.06, 0.05], [0.058, 0.09], [0.03, 0.12], [0.028, 0.13], [0.032, 0.135]]), 0xc9963e, 'gloss', { p: [0.08, 0, 0.02] });
  },
  function jug(it) {   // a cream jug with blue bands
    it.add(dkLathe([[0.04, 0], [0.05, 0.03], [0.06, 0.1], [0.05, 0.15], [0.045, 0.19], [0.05, 0.21]]), 0xece3cf, 'gloss');
    it.add(dkRing(0.042, 0.007, Math.PI, 12), 0xece3cf, 'gloss', { p: [0.055, 0.13, 0], r: [0, 0, -Math.PI / 2] });
    for (const [y, rr0] of [[0.1, 0.061], [0.165, 0.049]]) it.add(dkRing(rr0, 0.004), 0x35589a, 'gloss', { p: [0, y, 0], r: [Math.PI / 2, 0, 0] });
  },
  function landscape(it) { it.frame(0.27, 0.3, 0xb8924a, 'landscape', { fin: 'metal', b: 0.024 }); },   // in a gilt frame
  function seascape(it) {   // a wide sea picture in black, a shell before it
    it.frame(0.32, 0.23, 0x1e1c1a, 'sea', { b: 0.016 });
    it.add(new THREE.ConeGeometry(0.03, 0.035, 12), 0xf0dcc8, 'gloss', { p: [0.1, 0.015, 0.08], r: [Math.PI / 2 - 0.3, 0, 0], s: [1, 1, 0.6] });
  },
  function abstractPrint(it) {   // a Bauhaus-style print in oak, a brass ball beside it
    it.frame(0.22, 0.28, 0x9a6b3e, 'abstract', { x: -0.04, ry: 0.15 });
    it.add(dkBall(0.035, 16, 12), 0xb48a4a, 'metal', { p: [0.15, 0.035, 0.05] });
  },
  function fernPrint(it) {   // a pressed fern, white frame and mount, a small succulent in front
    it.frame(0.22, 0.29, 0xf2eee6, 'fern', { mount: 0.025, x: 0.03 });
    it.add(dkLathe([[0.025, 0], [0.03, 0.04], [0.032, 0.045]]), 0xa9643f, 'matte', { p: [-0.13, 0, 0.07] });
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; it.add(dkBall(0.012, 6, 5), 0x7f9f86, 'matte', { p: [-0.13 + Math.cos(a) * 0.015, 0.05, 0.07 + Math.sin(a) * 0.015], r: [0, -a, 0.6], s: [1.8, 0.7, 1] }); }
  },
  function photoPair(it) {   // two small framed photographs on their stands
    it.frame(0.12, 0.155, 0x23201d, 'portrait', { b: 0.012, lean: 0.2, x: -0.08, ry: 0.25 });
    it.frame(0.16, 0.115, 0xb9b7b2, 'peaks', { fin: 'metal', b: 0.01, lean: 0.2, x: 0.09, z: 0.04, ry: -0.2 });
  },
  function oldMap(it) { it.frame(0.31, 0.24, 0x4a3222, 'map', { b: 0.02, fin: 'gloss' }); },   // an old chart in dark wood
  function stillLife(it) {   // a small still life in green, a candle beside it
    it.frame(0.2, 0.24, 0x2f4a3a, 'still', { b: 0.022, x: -0.05 });
    it.add(dkLathe([[0.03, 0], [0.03, 0.006], [0.012, 0.015], [0.01, 0.04], [0.02, 0.05]]), 0xb48a4a, 'metal', { p: [0.14, 0, 0.05] });
    it.add(new THREE.CylinderGeometry(0.011, 0.011, 0.08, 12), 0xf4ecd8, 'matte', { p: [0.14, 0.09, 0.05] });
  },
  function plasterBust(it) {   // a plaster bust on a turned base
    const P = 0xe9e3d6;
    it.add(dkLathe([[0.07, 0], [0.072, 0.02], [0.055, 0.035], [0.05, 0.05]]), P);
    it.add(new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), P, 'matte', { p: [0, 0.05, 0], s: [1.25, 0.9, 0.65] });
    it.add(new THREE.CylinderGeometry(0.03, 0.036, 0.07, 14), P, 'matte', { p: [0, 0.16, 0] });
    it.add(dkBall(0.058, 20, 14), P, 'matte', { p: [0, 0.23, 0.008], s: [0.9, 1.15, 1] });
    it.add(dkBall(0.06, 16, 10), 0xd8d0c0, 'matte', { p: [0, 0.255, -0.006], s: [0.95, 0.8, 1] });   // hair
    it.add(new THREE.ConeGeometry(0.012, 0.03, 8), P, 'matte', { p: [0, 0.23, 0.066], r: [Math.PI / 2, 0, 0] });
  },
  function bronzeHead(it) {   // a modernist bronze head on a black block
    it.add(new THREE.BoxGeometry(0.09, 0.07, 0.09), 0x1c1b1a, 'gloss', { p: [0, 0.035, 0] });
    it.add(new THREE.CylinderGeometry(0.018, 0.024, 0.05, 12), 0x7a5a36, 'metal', { p: [0, 0.095, 0] });
    it.add(dkBall(0.05, 20, 14), 0x7a5a36, 'metal', { p: [0, 0.18, 0], s: [0.85, 1.45, 1], r: [0.2, 0.3, 0] });
  },
  function globe(it) {   // a globe on a turned stand with a brass meridian
    it.add(dkLathe([[0.06, 0], [0.06, 0.012], [0.03, 0.02], [0.012, 0.04], [0.01, 0.06]]), 0x4a3222, 'gloss');
    it.add(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8), 0xb48a4a, 'metal', { p: [0, 0.065, 0] });
    it.add(new THREE.SphereGeometry(0.085, 32, 20), 0xffffff, 'art', { p: [0, 0.175, 0], r: [0, 0, 0.41], slot: 'earth' });
    it.add(dkRing(0.093, 0.004, Math.PI * 1.3, 40), 0xb48a4a, 'metal', { p: [0, 0.175, 0], r: [0, 0, 0.41 - 0.15 * Math.PI] });
  },
  function hourglass(it) {   // an hourglass in walnut, the sand half run
    const W = 0x5a3a22;
    for (const y of [0.006, 0.204]) it.add(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 20), W, 'gloss', { p: [0, y, 0] });
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; it.add(new THREE.CylinderGeometry(0.005, 0.005, 0.19, 8), W, 'gloss', { p: [Math.cos(a) * 0.042, 0.105, Math.sin(a) * 0.042] }); }
    it.add(dkLathe([[0.03, 0.012], [0.034, 0.04], [0.03, 0.07], [0.005, 0.105], [0.03, 0.14], [0.034, 0.17], [0.03, 0.198]], 20), 0xeef3f0, 'glass');
    it.add(new THREE.ConeGeometry(0.03, 0.04, 16), 0xd9b77a, 'matte', { p: [0, 0.032, 0] });
    it.add(new THREE.ConeGeometry(0.022, 0.026, 16), 0xd9b77a, 'matte', { p: [0, 0.135, 0], r: [Math.PI, 0, 0] });
  },
  function mantelClock(it) {   // an arched mantel clock with a brass bezel
    const W = 0x5a3a22;
    it.add(new THREE.BoxGeometry(0.2, 0.13, 0.08), W, 'gloss', { p: [0, 0.075, 0] });
    it.add(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 24, 1, false, Math.PI / 2, Math.PI), W, 'gloss', { p: [0, 0.14, 0], r: [Math.PI / 2, 0, 0] });
    it.add(new THREE.CircleGeometry(0.058, 32), 0xffffff, 'art', { p: [0, 0.14, 0.041], slot: 'dial' });
    it.add(dkRing(0.06, 0.005), 0xb48a4a, 'metal', { p: [0, 0.14, 0.042] });
    for (const x of [-0.085, 0.085]) it.add(dkBall(0.012, 8, 6), 0xb48a4a, 'metal', { p: [x, 0.008, 0.025] });
  },
  function candlesticks(it) {   // a pair of brass candlesticks
    [[-0.06, 1], [0.06, 0.78]].forEach(([x, s]) => {
      it.add(dkLathe([[0.038, 0], [0.036, 0.008], [0.012, 0.022], [0.01, 0.09], [0.016, 0.1], [0.008, 0.12], [0.018, 0.13], [0.021, 0.136]]), 0xb48a4a, 'metal', { p: [x, 0, 0], s: [1, s, 1] });
      it.add(new THREE.CylinderGeometry(0.011, 0.011, 0.1, 12), 0xf4ecd8, 'matte', { p: [x, 0.136 * s + 0.05, 0] });
    });
  },
  function lantern(it) {   // a black iron lantern with a candle
    const I = 0x222120;
    it.add(new THREE.BoxGeometry(0.11, 0.015, 0.11), I, 'matte', { p: [0, 0.008, 0] });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) it.add(new THREE.BoxGeometry(0.008, 0.15, 0.008), I, 'matte', { p: [x * 0.05, 0.09, z * 0.05] });
    it.add(new THREE.ConeGeometry(0.08, 0.05, 4), I, 'matte', { p: [0, 0.19, 0], r: [0, Math.PI / 4, 0] });
    it.add(dkRing(0.02, 0.003), I, 'matte', { p: [0, 0.23, 0] });
    it.add(new THREE.BoxGeometry(0.094, 0.15, 0.094), 0xf3f0e6, 'glass', { p: [0, 0.09, 0] });
    it.add(new THREE.CylinderGeometry(0.015, 0.015, 0.07, 12), 0xf4ecd8, 'matte', { p: [0, 0.05, 0] });
  },
  function succulent(it, r) {   // a rosette succulent in a terracotta pot
    it.add(dkLathe([[0.045, 0], [0.055, 0.075], [0.06, 0.08], [0.06, 0.09], [0.054, 0.09]]), 0xa9643f, 'matte');
    it.add(new THREE.CircleGeometry(0.052, 20), 0x3b2a1e, 'matte', { p: [0, 0.084, 0], r: [-Math.PI / 2, 0, 0] });
    for (let k = 0; k < 22; k++) { const a = k * 2.4, ring = k / 22, t = 0.25 + ring * 0.9;
      it.add(dkBall(0.02, 8, 6), ring < 0.4 ? 0x9cb59c : 0x7a9a86, 'matte', { p: [Math.cos(a) * 0.03 * ring, 0.1 + 0.02 * (1 - ring), Math.sin(a) * 0.03 * ring], r: [0, -a, t], s: [1.6, 0.45, 0.8] }); }
  },
  function ivy(it, r) {   // ivy in a white pot, trailing over the shelf's edge
    it.add(dkLathe([[0.04, 0], [0.05, 0.08], [0.052, 0.09], [0.048, 0.09]]), 0xf0ece4, 'gloss', { p: [0, 0, 0.06] });
    for (let s = 0; s < 4; s++) {
      const x0 = -0.03 + s * 0.02, side = s % 2 ? 1 : -1;
      for (let k = 0; k < 13; k++) {
        const t = k / 12, p = [x0 + side * t * 0.12 + r(-0.01, 0.01), 0.09 + 0.04 * Math.sin(Math.PI * Math.min(t * 2, 1)) - Math.max(0, t - 0.4) * 0.3, 0.06 + Math.min(t, 0.5) * 0.26 + r(-0.01, 0.01)];
        it.add(dkBall(0.014, 6, 5), k % 3 ? 0x4f7a3f : 0x6a9450, 'matte', { p, r: [r(-1, 1), r(0, 3), r(-1, 1)], s: [1, 0.35, 0.8] });
      }
    }
  },
  function cactus(it) {   // a column cactus in a teal pot, a pink flower on top
    it.add(dkLathe([[0.04, 0], [0.045, 0.07], [0.05, 0.075], [0.046, 0.075]]), 0x3f7f7a, 'gloss');
    it.add(new THREE.CapsuleGeometry(0.026, 0.13, 4, 12), 0x5f8a4f, 'matte', { p: [0, 0.15, 0] });
    it.add(new THREE.CapsuleGeometry(0.014, 0.04, 4, 10), 0x5f8a4f, 'matte', { p: [0.035, 0.15, 0], r: [0, 0, -0.9] });
    it.add(new THREE.CapsuleGeometry(0.013, 0.04, 4, 10), 0x5f8a4f, 'matte', { p: [0.055, 0.18, 0] });
    it.add(dkBall(0.012, 8, 6), 0xd77a9a, 'gloss', { p: [0, 0.24, 0], s: [1, 0.6, 1] });
  },
  function bookPile(it, r, ctx) {   // the Isometric Library's pile with a brass ball (a model, added as is)
    const o = ctx.assets.isoPile.clone(); o.rotation.y = r(-0.3, 0.3);
    const s = new THREE.Mesh(dkBall(0.05, 16, 12), MAT.brass); s.position.y = ctx.assets.isoPileH + 0.05; o.add(s);
    return o;
  },
  function keepsakeBox(it, r) {   // a walnut box with a brass hasp, four books standing beside it
    it.add(new THREE.BoxGeometry(0.16, 0.08, 0.11), 0x6b4a2e, 'gloss', { p: [0.12, 0.04, 0] });
    it.add(new THREE.BoxGeometry(0.166, 0.016, 0.116), 0x5a3c24, 'gloss', { p: [0.12, 0.088, 0] });
    it.add(new THREE.BoxGeometry(0.02, 0.03, 0.004), 0xb48a4a, 'metal', { p: [0.12, 0.075, 0.058] });
    let x = -0.22; for (const c of [0x6e2f2f, 0x2e3b55, 0x3f5340, 0xb8a487]) { const w = r(0.026, 0.04), h = r(0.2, 0.26); it.book(w, h, 0.16, c, { p: [x + w / 2, h / 2, -0.01] }); x += w + 0.002; }
  },
  function marbleBookends(it, r) {   // marble bookends holding six books, the last one leaning
    for (const s of [-1, 1]) {
      it.add(new THREE.BoxGeometry(0.03, 0.15, 0.1), 0xdcd8d0, 'gloss', { p: [s * 0.2, 0.075, 0] });
      it.add(new THREE.BoxGeometry(0.07, 0.02, 0.1), 0xdcd8d0, 'gloss', { p: [s * 0.17, 0.01, 0] });
    }
    let x = -0.185; [0x7c5a3c, 0x4e3526, 0x2e3b55, 0xa8322d, 0x556a7a].forEach(c => { const w = r(0.03, 0.045), h = r(0.19, 0.25); it.book(w, h, 0.15, c, { p: [x + w / 2, h / 2, 0] }); x += w + 0.002; });
    it.book(0.035, 0.22, 0.15, 0x3a2e28, { p: [x + 0.055, 0.106, 0], r: [0, 0, 0.42] });
  },
  function plate(it) {   // a blue and white plate on a stand
    it.add(new THREE.CircleGeometry(0.12, 40), 0xffffff, 'art', { p: [0, 0.135, 0.004], r: [-0.22, 0, 0], slot: 'plate' });
    it.add(new THREE.CylinderGeometry(0.122, 0.11, 0.012, 40), 0xf3f1ec, 'gloss', { p: [0, 0.135, -0.004], r: [Math.PI / 2 - 0.22, 0, 0] });
    it.add(new THREE.BoxGeometry(0.1, 0.012, 0.05), 0x4a3222, 'gloss', { p: [0, 0.006, 0.02] });
    it.add(new THREE.BoxGeometry(0.012, 0.11, 0.012), 0x4a3222, 'gloss', { p: [0, 0.06, -0.04], r: [-0.22, 0, 0] });
  },
  function geode(it) {   // an amethyst geode on a brass ring
    it.add(dkRing(0.045, 0.006), 0xb48a4a, 'metal', { p: [0, 0.006, 0], r: [Math.PI / 2, 0, 0] });
    it.add(new THREE.SphereGeometry(0.075, 14, 10, Math.PI, Math.PI), 0x4b4743, 'matte', { p: [0, 0.075, -0.01], s: [1, 0.9, 0.7] });
    it.add(new THREE.CircleGeometry(0.068, 16), 0xe6e1d8, 'gloss', { p: [0, 0.075, -0.008], s: [1, 0.9, 1] });
    it.add(new THREE.CircleGeometry(0.055, 16), 0x6e4592, 'gloss', { p: [0, 0.075, -0.006], s: [1, 0.9, 1] });
    for (let k = 0; k < 9; k++) { const a = k * 2.4, d = 0.012 + (k % 3) * 0.015; it.add(new THREE.ConeGeometry(0.008, 0.02, 5), 0x9a72b8, 'gloss', { p: [Math.cos(a) * d, 0.075 + Math.sin(a) * d * 0.9, 0.002], r: [Math.PI / 2, 0, a] }); }
  },
  function crystalBall(it) {   // a crystal ball on a brass stand
    it.add(dkLathe([[0.045, 0], [0.045, 0.01], [0.03, 0.02], [0.02, 0.04], [0.035, 0.05], [0.038, 0.052]]), 0xb48a4a, 'metal');
    it.add(dkBall(0.065, 24, 18), 0xe9f1f4, 'glass', { p: [0, 0.11, 0] });
    it.add(dkBall(0.02, 10, 8), 0xbcd6e8, 'gloss', { p: [0.01, 0.11, 0.01] });
  },
  function cairn(it) {   // river stones stacked into a cairn
    let y = 0; [[0.07, 0x8d8a84], [0.058, 0x6e6b66], [0.047, 0xb2ada4], [0.036, 0x56534f], [0.026, 0x9c978e]].forEach(([s, c], k) => {
      const h = s * 0.38; it.add(dkBall(s, 14, 10), c, 'matte', { p: [k % 2 ? 0.006 : -0.006, y + h, 0], s: [1, 0.38, 0.85], r: [0, k, 0.05 * (k % 2 ? 1 : -1)] }); y += h * 2 - 0.004;
    });
  },
  function ringSculpture(it) {   // a black ring on a white plinth
    it.add(new THREE.BoxGeometry(0.08, 0.08, 0.08), 0xf0ece4, 'matte', { p: [0, 0.04, 0] });
    it.add(dkRing(0.075, 0.012, Math.PI * 2, 40), 0x1d1c1a, 'gloss', { p: [0, 0.165, 0], r: [0, 0.4, 0] });
  },
  function camera(it) {   // a folding camera on two books
    it.book(0.2, 0.03, 0.15, 0x2f4a4a, { lying: true, p: [0, 0.015, 0] });
    it.book(0.18, 0.025, 0.13, 0x9b8a6a, { lying: true, p: [0.01, 0.0425, 0], r: [0, 0.1, 0] });
    const y = 0.055;
    it.add(new THREE.BoxGeometry(0.13, 0.075, 0.055), 0x1c1c1c, 'matte', { p: [0, y + 0.0375, 0] });
    it.add(new THREE.BoxGeometry(0.135, 0.012, 0.058), 0xb9b7b2, 'metal', { p: [0, y + 0.081, 0] });
    it.add(new THREE.CylinderGeometry(0.028, 0.03, 0.045, 20), 0x151515, 'gloss', { p: [0.015, y + 0.036, 0.05], r: [Math.PI / 2, 0, 0] });
    it.add(dkRing(0.028, 0.003), 0xb9b7b2, 'metal', { p: [0.015, y + 0.036, 0.073] });
    it.add(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 8), 0xb9b7b2, 'metal', { p: [-0.045, y + 0.092, 0] });
  },
  function telescope(it) {   // a brass telescope on a small wooden tripod
    const apex = [0, 0.13, 0];
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + 0.3; it.rod([Math.cos(a) * 0.08, 0, Math.sin(a) * 0.07], apex, 0.005, 0x6b4a2e, 'gloss', 0.004); }
    const tilt = new THREE.Matrix4().makeTranslation(...apex).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 + 0.42));
    it.add(new THREE.CylinderGeometry(0.022, 0.016, 0.3, 20), 0xb48a4a, 'metal', { p: [0, 0.02, 0], m: tilt });
    it.add(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 20), 0x3a2a1c, 'gloss', { p: [0, 0.17, 0], m: tilt });
    it.add(new THREE.CylinderGeometry(0.008, 0.01, 0.05, 12), 0xb48a4a, 'metal', { p: [0, -0.14, 0], m: tilt });
  },
  function trophy(it) {   // a brass cup with two handles on a black base
    it.add(new THREE.BoxGeometry(0.08, 0.045, 0.08), 0x1c1b1a, 'gloss', { p: [0, 0.0225, 0] });
    it.add(new THREE.BoxGeometry(0.05, 0.02, 0.002), 0xb48a4a, 'metal', { p: [0, 0.0225, 0.041] });
    it.add(dkLathe([[0.03, 0], [0.012, 0.012], [0.01, 0.04], [0.025, 0.055], [0.045, 0.09], [0.05, 0.13], [0.048, 0.133]]), 0xb48a4a, 'metal', { p: [0, 0.045, 0] });
    for (const s of [1, -1]) it.add(dkRing(0.026, 0.004, Math.PI, 12), 0xb48a4a, 'metal', { p: [s * 0.05, 0.15, 0], r: [0, 0, -s * Math.PI / 2] });
  },
  function radio(it) {   // a cathedral radio in walnut, its cloth behind a sunburst fret
    const W = 0x6b4a2e;
    it.add(new THREE.BoxGeometry(0.2, 0.16, 0.1), W, 'gloss', { p: [0, 0.08, 0] });
    it.add(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 24, 1, false, Math.PI / 2, Math.PI), W, 'gloss', { p: [0, 0.16, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.8] });
    it.add(new THREE.PlaneGeometry(0.13, 0.12), 0xffffff, 'art', { p: [0, 0.15, 0.051], slot: 'cloth' });
    it.add(new THREE.PlaneGeometry(0.07, 0.022), 0xf1e6c8, 'gloss', { p: [0, 0.055, 0.051] });
    for (const x of [-0.06, 0.06]) it.add(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 14), 0xb48a4a, 'metal', { p: [x, 0.03, 0.056], r: [Math.PI / 2, 0, 0] });
  },
  function appleBooks(it, r) {   // three books lying flat, an apple on top
    let y = 0; [[0.24, 0.035, 0x7a3b2b], [0.21, 0.03, 0x2f4a4a], [0.19, 0.028, 0xcfc2a2]].forEach(([w, h, c], k) => { it.book(w, h, 0.16, c, { lying: true, p: [r(-0.01, 0.01), y + h / 2, 0], r: [0, r(-0.12, 0.12), 0] }); y += h; });
    it.add(dkBall(0.035, 16, 12), 0xa62c22, 'gloss', { p: [0.02, y + 0.032, 0], s: [1.05, 0.9, 1] });
    it.rod([0.02, y + 0.06, 0], [0.024, y + 0.078, 0], 0.002, 0x4a3420);
    it.add(dkBall(0.012, 6, 5), 0x5f8a3f, 'matte', { p: [0.034, y + 0.074, 0], s: [1.4, 0.3, 0.7], r: [0, 0, -0.4] });
  },
  function fruitBowl(it) {   // a turned wooden bowl of oranges and lemons
    it.add(dkLathe([[0.035, 0], [0.05, 0.005], [0.1, 0.045], [0.106, 0.06]]), 0x7a5232, 'gloss');
    [[-0.04, 0.05, 0, 0xe0872a, 1], [0.035, 0.052, 0.01, 0xe0872a, 1], [0, 0.058, -0.04, 0xe0872a, 1], [-0.005, 0.085, 0.01, 0xe8c84a, 0.85], [0.05, 0.075, -0.03, 0xe8c84a, 0.85]]
      .forEach(([x, y, z, c, s]) => it.add(dkBall(0.032 * s, 14, 10), c, 'gloss', { p: [x, y, z], s: c === 0xe8c84a ? [1.3, 1, 1] : [1, 1, 1] }));
  },
  function penCup(it, r) {   // a green pen cup with pencils, two notebooks beside it
    it.add(dkLathe([[0.034, 0], [0.036, 0.09], [0.033, 0.09]]), 0x2e5a4a, 'gloss', { p: [-0.08, 0, 0] });
    [0xc0483a, 0xe5b43e, 0x2d5a88, 0x3f7f4a, 0x1f1d1b, 0x8a5a9a].forEach((c, k) => {
      const a = k / 6 * Math.PI * 2, top = [-0.08 + Math.cos(a) * 0.03, 0.17 + r(0, 0.02), Math.sin(a) * 0.03];
      it.rod([-0.08 + Math.cos(a) * 0.012, 0.01, Math.sin(a) * 0.012], top, 0.0035, c, 'gloss', 0.0035, 6);
    });
    it.book(0.12, 0.016, 0.16, 0x8e2f2a, { lying: true, p: [0.09, 0.008, 0], r: [0, 0.15, 0] });
    it.book(0.1, 0.012, 0.14, 0x2c3e5a, { lying: true, p: [0.095, 0.022, 0.005], r: [0, -0.1, 0] });
  },
  function inkAndQuill(it) {   // an ink bottle with a quill, letters tied under a wax seal
    it.add(dkLathe([[0.03, 0], [0.032, 0.04], [0.02, 0.05], [0.012, 0.06], [0.014, 0.065]]), 0x1b2330, 'gloss', { p: [-0.07, 0, 0] });
    it.add(dkLathe([[0.006, 0], [0.008, 0.01], [0.01, 0.06], [0.004, 0.2]], 8), 0xf2efe6, 'matte', { p: [-0.07, 0.05, 0], r: [0.1, 0, -0.35], s: [1, 1, 0.3] });
    for (let k = 0; k < 3; k++) it.add(new THREE.BoxGeometry(0.15, 0.006, 0.1), 0xece2c8, 'matte', { p: [0.08, 0.003 + k * 0.006, 0], r: [0, (k - 1) * 0.12, 0] });
    it.add(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 14), 0x9a2b25, 'gloss', { p: [0.08, 0.02, 0.01] });
  },
  function bird(it) {   // a white ceramic bird on two books
    it.book(0.22, 0.032, 0.16, 0x5b4636, { lying: true, p: [0, 0.016, 0] });
    it.book(0.19, 0.028, 0.14, 0x9b8a6a, { lying: true, p: [0, 0.046, 0], r: [0, 0.12, 0] });
    const m = new THREE.Matrix4().makeTranslation(0, 0.06, 0).multiply(new THREE.Matrix4().makeRotationY(0.6));
    it.add(dkBall(0.04, 16, 12), 0xf3f0ea, 'gloss', { p: [0, 0.035, 0], s: [1.3, 0.9, 0.85], m });
    it.add(dkBall(0.022, 12, 10), 0xf3f0ea, 'gloss', { p: [0.045, 0.07, 0], m });
    it.add(new THREE.ConeGeometry(0.007, 0.02, 8), 0xc98a3a, 'gloss', { p: [0.072, 0.07, 0], r: [0, 0, -Math.PI / 2], m });
    it.add(new THREE.BoxGeometry(0.05, 0.006, 0.03), 0xf3f0ea, 'gloss', { p: [-0.065, 0.05, 0], r: [0, 0, 0.45], m });
    for (const z of [-0.012, 0.012]) it.add(dkBall(0.004, 6, 4), 0x1d1c1a, 'gloss', { p: [0.058, 0.076, z], m });
  },
  function coral(it, r) {   // a white coral branch on a black stand
    it.add(new THREE.CylinderGeometry(0.04, 0.045, 0.025, 20), 0x1d1c1a, 'gloss', { p: [0, 0.0125, 0] });
    const grow = (a, d, L, rad, n) => {
      const b = [a[0] + d[0] * L, a[1] + d[1] * L, a[2] + d[2] * L]; it.rod(a, b, rad, 0xeee6da, 'matte', rad * 0.7, 6);
      if (n) for (const s of [-1, 1]) { const t = s * r(0.35, 0.6), d2 = new THREE.Vector3(...d).applyAxisAngle(new THREE.Vector3(r(-0.3, 0.3), 0, 1).normalize(), t).normalize(); grow(b, d2.toArray(), L * 0.72, rad * 0.7, n - 1); }
    };
    grow([0, 0.025, 0], [0, 1, 0], 0.08, 0.009, 3);
  },
];

export { DECOR_ITEMS };
