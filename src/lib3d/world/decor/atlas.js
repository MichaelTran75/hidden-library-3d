import './kit.js';   // build order: the module before this one runs first
import { canvas, ctex, halfCanvas, rng } from '../../core/utils.js';

// the canvas for everything painted: 256 px slots on a 1024 px sheet
function decorAtlas() {
  const S = 256, N = 1024, c = canvas(N, N), g = c.getContext('2d'), r = rng(808), slots = {};
  const at = (name, i, j, w, h, paint) => {
    const x = i * S, y = j * S, W = w * S, H = h * S;
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, W, H); g.clip(); paint(W, H); g.restore();
    const e = 3 / N; slots[name] = [x / N + e, 1 - (y + H) / N + e, (x + W) / N - e, 1 - y / N - e];   // u0 v0 u1 v1 (the canvas is flipped)
  };
  const grad = (H, stops) => { const l = g.createLinearGradient(0, 0, 0, H); stops.forEach(([k, col]) => l.addColorStop(k, col)); return l; };
  const fill = (col, f) => { g.fillStyle = col; g.beginPath(); f(); g.fill(); };
  const ridge = (W, H, y0, amp, f, col) => fill(col, () => { g.moveTo(0, H); for (let x = 0; x <= W; x += 4) g.lineTo(x, y0 + Math.sin(x / W * f + y0) * amp + Math.sin(x / W * f * 2.7) * amp * 0.35); g.lineTo(W, H); });
  at('landscape', 0, 0, 1, 1, (W, H) => {   // summer hills under a low sun
    g.fillStyle = grad(H, [[0, '#9cc0d6'], [0.55, '#f1dcb0'], [1, '#f1dcb0']]); g.fillRect(0, 0, W, H);
    fill('#f5c060', () => g.arc(W * 0.7, H * 0.4, W * 0.07, 0, 7));
    ridge(W, H, H * 0.55, H * 0.05, 5, '#94ab7c'); ridge(W, H, H * 0.67, H * 0.05, 8, '#6d8d5a'); ridge(W, H, H * 0.82, H * 0.035, 3, '#c7a25a');
    g.fillStyle = '#4b3a28'; g.fillRect(W * 0.25, H * 0.6, W * 0.018, H * 0.12); fill('#3d6a3a', () => g.arc(W * 0.26, H * 0.57, W * 0.07, 0, 7));
  });
  at('sea', 1, 0, 1, 1, (W, H) => {   // a sail on a grey-blue sea
    g.fillStyle = grad(H, [[0, '#c9d5dc'], [0.5, '#eef0ea'], [0.52, '#5d86a0'], [1, '#2f5672']]); g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; for (let k = 0; k < 14; k++) { const y = H * (0.56 + k * 0.03), x = r() * W; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20 + r() * 40, y); g.stroke(); }
    fill('#3a2c22', () => { g.moveTo(W * 0.38, H * 0.6); g.lineTo(W * 0.62, H * 0.6); g.lineTo(W * 0.58, H * 0.64); g.lineTo(W * 0.42, H * 0.64); });
    fill('#f7f3ea', () => { g.moveTo(W * 0.5, H * 0.24); g.lineTo(W * 0.5, H * 0.58); g.lineTo(W * 0.66, H * 0.58); });
    fill('#e6ddca', () => { g.moveTo(W * 0.48, H * 0.3); g.lineTo(W * 0.48, H * 0.58); g.lineTo(W * 0.38, H * 0.58); });
  });
  at('abstract', 2, 0, 1, 1, (W, H) => {   // circles and a bar, after the Bauhaus prints
    g.fillStyle = '#efe5d0'; g.fillRect(0, 0, W, H);
    fill('#c4493a', () => g.arc(W * 0.42, H * 0.42, W * 0.26, 0, 7)); g.fillStyle = '#2d5a88'; g.fillRect(W * 0.52, H * 0.5, W * 0.3, H * 0.34);
    fill('#e5b43e', () => g.arc(W * 0.72, H * 0.28, W * 0.1, 0, 7)); g.fillStyle = '#1f1d1b'; g.fillRect(W * 0.12, H * 0.78, W * 0.62, H * 0.03);
  });
  at('fern', 3, 0, 1, 1, (W, H) => {   // a pressed fern on cream paper
    g.fillStyle = '#f3ecd9'; g.fillRect(0, 0, W, H); g.strokeStyle = '#4c6a3a'; g.fillStyle = '#5f8247'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(W * 0.5, H * 0.9); g.quadraticCurveTo(W * 0.42, H * 0.5, W * 0.56, H * 0.1); g.stroke();
    for (let k = 1; k < 15; k++) { const t = k / 15, x = W * (0.5 - 0.06 * Math.sin(t * 3)), y = H * (0.9 - 0.8 * t), l = W * 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      for (const s of [-1, 1]) { g.save(); g.translate(x, y); g.rotate(s * 1.0 - 0.15); g.beginPath(); g.ellipse(s * l / 2, 0, l / 2, l / 7, 0, 0, 7); g.fill(); g.restore(); } }
    g.fillStyle = '#6b5a44'; g.font = 'italic 16px Georgia'; g.fillText('Polypodium', W * 0.33, H * 0.97);
  });
  at('portrait', 0, 1, 1, 1, (W, H) => {   // a sepia portrait
    g.fillStyle = grad(H, [[0, '#cfae80'], [1, '#86653f']]); g.fillRect(0, 0, W, H);
    fill('#3a2a1c', () => { g.ellipse(W * 0.5, H * 0.4, W * 0.15, H * 0.19, 0, 0, 7); });
    fill('#3a2a1c', () => { g.moveTo(W * 0.12, H); g.quadraticCurveTo(W * 0.15, H * 0.62, W * 0.5, H * 0.6); g.quadraticCurveTo(W * 0.85, H * 0.62, W * 0.88, H); });
    fill('#e9dcc2', () => { g.moveTo(W * 0.45, H * 0.62); g.lineTo(W * 0.55, H * 0.62); g.lineTo(W * 0.5, H * 0.8); });
  });
  at('peaks', 1, 1, 1, 1, (W, H) => {   // a photograph of snowy peaks over a lake
    g.fillStyle = grad(H, [[0, '#b7c3cb'], [0.6, '#e2e6e6'], [0.61, '#8aa0ad'], [1, '#55707f']]); g.fillRect(0, 0, W, H);
    const peak = (x, y, w, col) => { fill(col, () => { g.moveTo(x - w, H * 0.6); g.lineTo(x, y); g.lineTo(x + w, H * 0.6); }); fill('#f4f4f1', () => { g.moveTo(x - w * 0.25, y + (H * 0.6 - y) * 0.25); g.lineTo(x, y); g.lineTo(x + w * 0.25, y + (H * 0.6 - y) * 0.25); }); };
    peak(W * 0.3, H * 0.22, W * 0.32, '#5b6875'); peak(W * 0.68, H * 0.3, W * 0.36, '#46525e');
    g.globalAlpha = 0.35; g.scale(1, -1); g.translate(0, -1.2 * H); peak(W * 0.3, H * 0.22, W * 0.32, '#5b6875'); peak(W * 0.68, H * 0.3, W * 0.36, '#46525e');
  });
  at('map', 2, 1, 1, 1, (W, H) => {   // an old chart: a coast, a grid and a compass rose
    g.fillStyle = '#e6d6ab'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(150,110,60,.12)'; g.beginPath(); g.arc(r() * W, r() * H, 20 + r() * 50, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(110,80,45,.35)'; g.lineWidth = 1; for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(k * W / 6, 0); g.lineTo(k * W / 6, H); g.moveTo(0, k * H / 6); g.lineTo(W, k * H / 6); g.stroke(); }
    g.fillStyle = '#cdb27a'; g.strokeStyle = '#6b4f2e'; g.lineWidth = 2; g.beginPath();
    for (let k = 0; k <= 40; k++) { const a = k / 40 * Math.PI * 2, d = 0.28 + 0.08 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 7); g.lineTo(W * (0.42 + d * Math.cos(a)), H * (0.48 + d * 0.8 * Math.sin(a))); }
    g.closePath(); g.fill(); g.stroke();
    g.translate(W * 0.82, H * 0.8); fill('#7a2e22', () => { g.moveTo(0, -24); g.lineTo(5, 0); g.lineTo(0, 24); g.lineTo(-5, 0); }); fill('#3a2a1c', () => { g.moveTo(-24, 0); g.lineTo(0, 5); g.lineTo(24, 0); g.lineTo(0, -5); });
  });
  at('earth', 0, 2, 2, 1, (W, H) => {   // the globe's map: an old-style world, sea and lands
    g.fillStyle = '#d9c9a0'; g.fillRect(0, 0, W, H); g.fillStyle = '#4e7a96'; g.fillRect(0, H * 0.04, W, H * 0.92);
    const land = (x, y, s, col) => { g.fillStyle = col; g.beginPath(); for (let k = 0; k <= 24; k++) { const a = k / 24 * Math.PI * 2, d = s * (0.7 + 0.3 * Math.sin(a * 3 + x) + 0.15 * Math.sin(a * 5 + y)); g.lineTo(W * x + Math.cos(a) * d * 1.2, H * y + Math.sin(a) * d); } g.fill(); };
    [[0.2, 0.32, 38], [0.27, 0.62, 30], [0.5, 0.3, 34], [0.53, 0.58, 40], [0.72, 0.36, 48], [0.84, 0.7, 22]].forEach(([x, y, s], k) => land(x, y, s, k % 2 ? '#a9b47a' : '#c6b27a'));
    g.strokeStyle = 'rgba(40,30,20,.3)'; g.lineWidth = 1; for (let k = 1; k < 8; k++) { g.beginPath(); g.moveTo(k * W / 8, 0); g.lineTo(k * W / 8, H); g.stroke(); }
  });
  at('dial', 2, 2, 1, 1, (W, H) => {   // a clock face at ten past ten
    g.fillStyle = '#7a5a34'; g.fillRect(0, 0, W, H); fill('#f5efe0', () => g.arc(W / 2, H / 2, W * 0.48, 0, 7));
    g.fillStyle = '#2a2018'; g.font = 'bold 26px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 1; k <= 12; k++) { const a = k / 12 * Math.PI * 2; g.fillText(['I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][k - 1], W / 2 + Math.sin(a) * W * 0.36, H / 2 - Math.cos(a) * H * 0.36); }
    g.strokeStyle = '#2a2018'; g.lineCap = 'round';
    for (const [a, l, w] of [[10 / 12 + 10 / 720, 0.22, 7], [10 / 60, 0.33, 4]]) { g.lineWidth = w; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.sin(a * Math.PI * 2) * W * l, H / 2 - Math.cos(a * Math.PI * 2) * H * l); g.stroke(); }
  });
  at('plate', 3, 2, 1, 1, (W, H) => {   // blue and white: rings and a flower
    g.fillStyle = '#f3f1ec'; g.fillRect(0, 0, W, H); g.strokeStyle = '#2d4f90'; g.fillStyle = '#2d4f90';
    for (const [k, w] of [[0.47, 6], [0.42, 2], [0.28, 3]]) { g.lineWidth = w; g.beginPath(); g.arc(W / 2, H / 2, W * k, 0, 7); g.stroke(); }
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; g.beginPath(); g.arc(W / 2 + Math.cos(a) * W * 0.35, H / 2 + Math.sin(a) * H * 0.35, 6, 0, 7); g.fill(); }
    for (let k = 0; k < 8; k++) { g.save(); g.translate(W / 2, H / 2); g.rotate(k / 8 * Math.PI * 2); g.beginPath(); g.ellipse(0, -W * 0.13, W * 0.05, W * 0.11, 0, 0, 7); g.fill(); g.restore(); }
    g.fillStyle = '#f3f1ec'; g.beginPath(); g.arc(W / 2, H / 2, W * 0.04, 0, 7); g.fill();
  });
  at('cloth', 3, 1, 1, 1, (W, H) => {   // a radio's speaker cloth behind a sunburst fret
    g.fillStyle = '#c9b48a'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(90,70,40,.25)'; g.lineWidth = 1;
    for (let k = 0; k < W; k += 4) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, H); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(W, k); g.stroke(); }
    g.strokeStyle = '#4a321f'; g.lineWidth = 9; for (let k = 0; k <= 8; k++) { const a = Math.PI * (1 + k / 8); g.beginPath(); g.moveTo(W / 2, H * 0.95); g.lineTo(W / 2 + Math.cos(a) * W, H * 0.95 + Math.sin(a) * H); g.stroke(); }
  });
  at('still', 0, 3, 1, 1, (W, H) => {   // a still life: a jug and oranges on a dark table
    g.fillStyle = grad(H, [[0, '#3b3229'], [0.68, '#2c251f'], [0.69, '#6a4a2e'], [1, '#4d3420']]); g.fillRect(0, 0, W, H);
    fill('#e9dfc8', () => g.ellipse(W * 0.4, H * 0.55, W * 0.14, H * 0.2, 0, 0, 7)); g.fillStyle = '#e9dfc8'; g.fillRect(W * 0.34, H * 0.3, W * 0.1, H * 0.12);
    for (const [x, y, s] of [[0.62, 0.66, 0.07], [0.75, 0.68, 0.06], [0.68, 0.6, 0.055]]) fill('#e08a2e', () => g.arc(W * x, H * y, W * s, 0, 7));
    fill('rgba(255,255,255,.35)', () => g.ellipse(W * 0.35, H * 0.5, W * 0.03, H * 0.08, 0, 0, 7));
  });
  return { tex: ctex(halfCanvas(c), { rep: false }), slots };   // (painted at 1024, kept at 512: G, 21/10/2026, the page's memory)
}

export { decorAtlas };
