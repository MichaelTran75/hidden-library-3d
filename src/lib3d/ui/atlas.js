import './vn-geo.js';   // build order: the module before this one runs first
import { canvas, rng } from '../core/utils.js';
import { VN_GEO } from './vn-geo.js';

/* ---- the atlas page of the Geography books (G, 16/10/2026: "khi select sách, thì sách mở ra có hình bản đồ việt nam,
   khi click vào bản đồ ViệtNam thì mới vào page"): the first leaf of the book, printed as a page of a school atlas is.
   Vietnam whole, its mainland and its islands, Hoàng Sa and Trường Sa among them, with the East Sea round them: the land
   in the relief colours of G's own map (deltas green, hills cream, uplands ochre, mountains brown), the sea deepening in
   blue bands, the neighbours' land pale, the border dash-dotted, the great rivers, the capital and the large cities, the
   seas, the gulfs, the archipelagos and the neighbours named in the page's language; a graticule every 5°, a compass rose
   and a scale; the title over it and the sources under it, on a cream paper a little darker toward the gutter. The
   Phú Quốc book opens on the island alone (drawIsland, below). Drawn once a book opens (and again in the other language
   when the page's language is switched), from the outlines in vn-geo.js (OpenStreetMap). */
const ATLAS = { geo: null };
const KX = Math.cos(15 * Math.PI / 180);   // (longitude shrunk as at 15° N: a plain equirectangular map)
function decodeRings(s, f = VN_GEO.f) {   // a layer's rings: encoded polylines (lng, lat in 1/f degree) joined by spaces
  const out = [];
  for (const str of s.split(' ')) {
    if (!str) continue;
    const pts = []; let i = 0, x = 0, y = 0;
    while (i < str.length) {
      for (let k = 0; k < 2; k++) {
        let sh = 0, res = 0, b;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
        const v = res & 1 ? ~(res >> 1) : res >> 1; if (k) y += v; else x += v;
      }
      pts.push(x / f, y / f);
    }
    out.push(pts);
  }
  return out;
}
function atlasGeo() {
  if (!ATLAS.geo) ATLAS.geo = { vn: decodeRings(VN_GEO.vn), border: decodeRings(VN_GEO.border)[0] || [], dots: decodeRings(VN_GEO.dots)[0] || [], foreign: decodeRings(VN_GEO.foreign),
    sea: VN_GEO.sea.map(([d, s]) => [d, decodeRings(s)]), relief: VN_GEO.relief.map(([d, s]) => [d, decodeRings(s)]), rivers: decodeRings(VN_GEO.rivers) };
  return ATLAS.geo;
}
// names on the map: [lng, lat, Vietnamese, English, kind, where the name goes: l(eft), r(ight), t(op), b(elow)]
const PLACES = [
  [105.854, 21.028, 'Hà Nội', 'Hà Nội', 'capital', 'l'], [106.688, 20.845, 'Hải Phòng', 'Hải Phòng', 'city', 'r'], [107.59, 16.463, 'Huế', 'Huế', 'city', 'l'],
  [108.202, 16.054, 'Đà Nẵng', 'Đà Nẵng', 'city', 'l'], [109.196, 12.238, 'Nha Trang', 'Nha Trang', 'city', 'l'],
  [106.701, 10.776, 'TP. Hồ Chí Minh', 'Ho Chi Minh City', 'city', 'r'], [105.747, 10.045, 'Cần Thơ', 'Cần Thơ', 'city', 'b']];
const SEAS = [   // (a gulf's name in two lines where it has little room)
  [112.6, 13.2, 'BIỂN ĐÔNG', 'EAST SEA', 1], [107.35, 19.75, 'Vịnh Bắc Bộ', 'Gulf of Tonkin', 0], [103.05, 7.75, 'Vịnh\nThái Lan', 'Gulf of\nThailand', 0]];
const LANDS = [[106.0, 23.9, 'TRUNG QUỐC', 'CHINA'], [103.25, 19.0, 'LÀO', 'LAOS'], [103.35, 15.6, 'THÁI LAN', 'THAILAND'], [104.6, 12.75, 'CAMPUCHIA', 'CAMBODIA']];
const ISLES = [[112.05, 16.15, 'QĐ. Hoàng Sa', 'Hoàng Sa Is.'], [114.45, 9.35, 'QĐ. Trường Sa', 'Trường Sa Is.'], [103.97, 10.23, 'Phú Quốc', 'Phú Quốc'], [106.61, 8.69, 'Côn Đảo', 'Côn Đảo']];
const RELIEF = { base: '#a7cf98', 200: '#d8d3a4', 500: '#d9bd88', 1000: '#c59a62', 1500: '#ac7b48' };   // (G's map's colours: its LAND_COLORS)
const SEA = { base: '#d3e5e6', 200: '#bcd7dd', 1000: '#a3c6d3', 3000: '#8cb5c7' };
const serif = `Georgia, 'Times New Roman', serif`, sans = `Inter, 'Helvetica Neue', Arial, sans-serif`;
// a projection onto the frame: the box [lng0, lat0, lng1, lat1] fitted to it, centred
function frameProj(x0, y0, x1, y1, box, kx = KX) {   // (kx: longitude's shrink: cos 15° for the country, the island's own latitude for it)
  const [l0, b0, l1, b1] = box, s = Math.min((x1 - x0) / ((l1 - l0) * kx), (y1 - y0) / (b1 - b0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, lc = (l0 + l1) / 2, bc = (b0 + b1) / 2;
  return { s, x: lng => cx + (lng - lc) * kx * s, y: lat => cy - (lat - bc) * s, lng: px => lc + (px - cx) / (kx * s), lat: py => bc - (py - cy) / s };
}
function pathRings(g, rings, P) {
  g.beginPath();
  for (const r of rings) { g.moveTo(P.x(r[0]), P.y(r[1])); for (let i = 2; i < r.length; i += 2) g.lineTo(P.x(r[i]), P.y(r[i + 1])); g.closePath(); }
}
function strokeLines(g, lines, P) {
  g.beginPath();
  for (const r of lines) { g.moveTo(P.x(r[0]), P.y(r[1])); for (let i = 2; i < r.length; i += 2) g.lineTo(P.x(r[i]), P.y(r[i + 1])); }
  g.stroke();
}
function spaced(g, text, x, y, sp) {   // a line of capitals with space between the letters, centred on x
  const w = [...text].reduce((s, ch) => s + g.measureText(ch).width, 0) + sp * (text.length - 1); let cx = x - w / 2;
  g.textAlign = 'left'; for (const ch of text) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + sp; } g.textAlign = 'center';
}
function haloText(g, text, x, y, halo, ink, lw) { g.lineJoin = 'round'; g.strokeStyle = halo; g.lineWidth = lw; g.strokeText(text, x, y); g.fillStyle = ink; g.fillText(text, x, y); }
// the whole map in a frame: the sea, the neighbours, Vietnam in relief, rivers, coasts, the border, the archipelagos
function drawMap(g, P, k, lang, opts = {}) {
  const G = atlasGeo(), vi = lang === 'vi', free = opts.free || (() => true);   // (free: whether a name may go there: not under an inset)
  g.fillStyle = SEA.base; g.fillRect(-1e4, -1e4, 2e4, 2e4);
  for (const [d, rings] of G.sea) { g.fillStyle = SEA[d] || SEA[3000]; pathRings(g, rings, P); g.fill('evenodd'); }
  g.fillStyle = '#ebe2cb'; pathRings(g, G.foreign, P); g.fill('evenodd');
  g.strokeStyle = 'rgba(120, 104, 78, 0.55)'; g.lineWidth = 0.9 * k; g.stroke();
  // Vietnam: its land, the relief over it (inside it only), its rivers, its coast
  g.save(); pathRings(g, G.vn, P); g.fillStyle = RELIEF.base; g.fill('evenodd'); g.clip('evenodd');
  for (const [d, rings] of G.relief) { g.fillStyle = RELIEF[d] || RELIEF[1500]; pathRings(g, rings, P); g.fill('evenodd'); }
  g.strokeStyle = 'rgba(48, 102, 150, 0.85)'; g.lineWidth = 1.15 * k; g.lineJoin = 'round'; g.lineCap = 'round'; strokeLines(g, G.rivers, P);
  g.restore();
  pathRings(g, G.vn, P); g.strokeStyle = '#3c5a66'; g.lineWidth = 1.1 * k; g.lineJoin = 'round'; g.stroke();
  // the archipelagos' islands too small to draw: dots
  g.fillStyle = '#a7cf98'; g.strokeStyle = '#3c5a66'; g.lineWidth = 0.8 * k;
  for (let i = 0; i < G.dots.length; i += 2) { g.beginPath(); g.arc(P.x(G.dots[i]), P.y(G.dots[i + 1]), Math.max(1.6, 2.1 * k), 0, Math.PI * 2); g.fill(); g.stroke(); }
  // the border on land, dash-dotted in red over a pale band (as an atlas draws a national border)
  g.lineJoin = 'round'; g.lineCap = 'butt'; g.strokeStyle = 'rgba(214, 120, 96, 0.35)'; g.lineWidth = 5 * k; strokeLines(g, [G.border], P);
  g.setLineDash([10 * k, 4 * k, 2.4 * k, 4 * k]); g.strokeStyle = 'rgba(160, 44, 34, 0.95)'; g.lineWidth = 2.2 * k; strokeLines(g, [G.border], P); g.setLineDash([]);
  if (opts.after) opts.after(g, P);
  // the graticule, every 5°
  g.strokeStyle = 'rgba(70, 92, 104, 0.32)'; g.lineWidth = 0.9 * k;
  for (let lng = 100; lng <= 120; lng += 5) { g.beginPath(); g.moveTo(P.x(lng), P.y(0)); g.lineTo(P.x(lng), P.y(30)); g.stroke(); }
  for (let lat = 0; lat <= 30; lat += 5) { g.beginPath(); g.moveTo(P.x(95), P.y(lat)); g.lineTo(P.x(125), P.y(lat)); g.stroke(); }
  // names: the neighbours, the seas, the archipelagos and islands, the cities
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(96, 84, 66, 0.72)'; g.font = `600 ${Math.round(24 * k)}px ${sans}`;
  for (const [lng, lat, v, e] of LANDS) if (free(P.x(lng), P.y(lat))) spaced(g, vi ? v : e, P.x(lng), P.y(lat), 4.5 * k);
  for (const [lng, lat, v, e, big] of SEAS) {
    g.fillStyle = 'rgba(38, 86, 120, 0.85)'; if (!free(P.x(lng), P.y(lat))) continue;
    if (big) { g.font = `italic 600 ${Math.round(40 * k)}px ${serif}`; spaced(g, vi ? v : e, P.x(lng), P.y(lat), 7 * k); }
    else { g.font = `italic ${Math.round(23 * k)}px ${serif}`; const ls = (vi ? v : e).split('\n'); ls.forEach((l, i) => g.fillText(l, P.x(lng), P.y(lat) + (i - (ls.length - 1) / 2) * 26 * k)); }
  }
  const halo = 'rgba(246, 240, 224, 0.92)';
  for (const [lng, lat, v, e] of ISLES) {
    if (!free(P.x(lng), P.y(lat))) continue;
    const arch = v.startsWith('QĐ'); g.font = `italic ${arch ? 600 : 500} ${Math.round((arch ? 26 : 21) * k)}px ${serif}`;
    haloText(g, vi ? v : e, P.x(lng) + (arch ? 0 : (lng < 105 ? -12 : 12) * k), P.y(lat) + (arch ? 0 : 20 * k), halo, arch ? '#7a2c22' : '#3c4a40', 5 * k);
  }
  for (const [lng, lat, v, e, kind, at] of PLACES) {
    const x = P.x(lng), y = P.y(lat), cap = kind === 'capital'; if (!free(x, y)) continue;
    if (cap) star(g, x, y, 11 * k, '#b0302a'); else { g.beginPath(); g.arc(x, y, 5 * k, 0, Math.PI * 2); g.fillStyle = '#fbf6ea'; g.fill(); g.lineWidth = 2.4 * k; g.strokeStyle = '#3a2f26'; g.stroke(); }
    g.font = `${cap ? 700 : 600} ${Math.round((cap ? 29 : 23) * k)}px ${sans}`;
    const off = (cap ? 15 : 11) * k, [tx, ty, al] = at === 'l' ? [x - off, y, 'right'] : at === 'r' ? [x + off, y, 'left'] : at === 't' ? [x, y - 22 * k, 'center'] : [x, y + 22 * k, 'center'];
    g.textAlign = al; haloText(g, vi ? v : e, tx, ty, halo, '#2b231c', 6 * k); g.textAlign = 'center';
  }
}
function star(g, x, y, r, col) {
  g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); }
  g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = r * 0.16; g.strokeStyle = 'rgba(255, 248, 230, 0.9)'; g.stroke();
}
function compass(g, x, y, r, lang, k) {   // an eight-point rose, its north point dark
  g.save(); g.translate(x, y);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, long = i % 2 === 0, L = long ? r : r * 0.55, w = long ? r * 0.17 : r * 0.12;
    g.save(); g.rotate(a);
    g.beginPath(); g.moveTo(0, -L); g.lineTo(w, 0); g.lineTo(0, 0); g.closePath(); g.fillStyle = i === 0 ? '#3a2f26' : '#6b5c49'; g.fill();
    g.beginPath(); g.moveTo(0, -L); g.lineTo(-w, 0); g.lineTo(0, 0); g.closePath(); g.fillStyle = i === 0 ? '#9a3326' : '#efe5cd'; g.fill();
    g.lineWidth = 0.8 * k; g.strokeStyle = '#3a2f26'; g.beginPath(); g.moveTo(0, -L); g.lineTo(w, 0); g.lineTo(-w, 0); g.closePath(); g.stroke();
    g.restore();
  }
  g.beginPath(); g.arc(0, 0, r * 0.62, 0, Math.PI * 2); g.lineWidth = 1 * k; g.strokeStyle = 'rgba(58, 47, 38, 0.6)'; g.stroke();
  g.fillStyle = '#3a2f26'; g.font = `700 ${Math.round(r * 0.42)}px ${serif}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(lang === 'vi' ? 'B' : 'N', 0, -r - 6 * k);
  g.restore();
}
function scaleBar(g, x, y, P, lang, k) {   // 0 to 300 km, in hundreds
  const kmPx = P.s / 111.2, w = 300 * kmPx, h = 7 * k;
  g.textBaseline = 'alphabetic'; g.textAlign = 'center';
  for (let i = 0; i < 3; i++) { g.fillStyle = i % 2 ? '#fbf6ea' : '#3a2f26'; g.fillRect(x + i * w / 3, y, w / 3, h); }
  g.lineWidth = 1.2 * k; g.strokeStyle = '#3a2f26'; g.strokeRect(x, y, w, h);
  g.fillStyle = '#3a2f26'; g.font = `500 ${Math.round(17 * k)}px ${sans}`;
  for (let i = 0; i <= 3; i++) g.fillText(String(i * 100), x + i * w / 3, y - 7 * k);
  g.textAlign = 'left'; g.fillText('km', x + w + 26 * k, y - 7 * k);
}
function paper(g, W, H, seed) {   // cream paper: a little uneven, flecked, darker toward the gutter (the left: the spine)
  g.fillStyle = '#f1e8d2'; g.fillRect(0, 0, W, H);
  const r = rng(seed);
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = r() * H, rr = W * (0.1 + 0.25 * r()), m = g.createRadialGradient(x, y, 0, x, y, rr);
    m.addColorStop(0, r() < 0.5 ? 'rgba(255, 252, 240, 0.18)' : 'rgba(170, 140, 90, 0.07)'); m.addColorStop(1, 'rgba(0, 0, 0, 0)'); g.fillStyle = m; g.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
  }
  for (let i = 0; i < W * H / 700; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '120, 96, 60' : '255, 255, 250'}, ${r() * 0.06})`; g.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r()); }
  const gut = g.createLinearGradient(0, 0, W * 0.12, 0);
  gut.addColorStop(0, 'rgba(92, 70, 40, 0.22)'); gut.addColorStop(0.35, 'rgba(92, 70, 40, 0.07)'); gut.addColorStop(1, 'rgba(92, 70, 40, 0)'); g.fillStyle = gut; g.fillRect(0, 0, W * 0.12, H);
}
// the page, W × H (portrait): `which` is 'vn' (Việt Nam: the country and the East Sea) or 'phuquoc' (the island alone:
// drawIsland); returns the frame of the map on the page, as fractions of the page
function drawAtlas(c, which, lang) {
  if (which === 'phuquoc') return drawIsland(c, lang);
  const W = c.width, H = c.height, g = c.getContext('2d'), k = W / 1024, vi = lang === 'vi', m = 58 * k;
  paper(g, W, H, 11);
  // the title
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#2f261d';
  g.font = `700 ${Math.round(70 * k)}px ${serif}`; spaced(g, vi ? 'VIỆT NAM' : 'VIETNAM', W / 2, m + 70 * k, 9 * k);
  g.font = `italic ${Math.round(26 * k)}px ${serif}`; g.fillStyle = '#5a4a38';
  g.fillText(vi ? 'Địa hình · Biển Đông · Hoàng Sa · Trường Sa' : 'Relief · the East Sea · Hoàng Sa · Trường Sa', W / 2, m + 104 * k);
  // the map
  const x0 = m, x1 = W - m, y0 = m + 138 * k, y1 = H - m - 44 * k, P = frameProj(x0, y0, x1, y1, [101.8, 5.4, 118.2, 24.2]);
  g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
  drawMap(g, P, k, lang);
  compass(g, x1 - 92 * k, y0 + 120 * k, 54 * k, lang, k);
  scaleBar(g, P.x(111.2), P.y(6.25), P, lang, k);
  g.restore();
  frameAround(g, x0, y0, x1, y1, k, [[105, '105°E'], [110, '110°E'], [115, '115°E']].map(([v, t]) => [P.x(v), t]), [[10, '10°N'], [15, '15°N'], [20, '20°N']].map(([v, t]) => [P.y(v), t]));
  sources(g, W, H, m, k, vi, true);
  return { x0: x0 / W, y0: y0 / H, x1: x1 / W, y1: y1 / H };
}
// a map's frame: a heavy rule and a fine one, the degrees along it (xs: [x, label] along the top and the foot; ys: [y,
// label] up the left side), and the sources under it
function frameAround(g, x0, y0, x1, y1, k, xs, ys) {
  g.lineWidth = 3.2 * k; g.strokeStyle = '#3a2f26'; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
  g.lineWidth = 1 * k; g.strokeRect(x0 - 7 * k, y0 - 7 * k, x1 - x0 + 14 * k, y1 - y0 + 14 * k);
  g.fillStyle = '#5a4a38'; g.font = `500 ${Math.round(15 * k)}px ${sans}`; g.textBaseline = 'alphabetic'; g.textAlign = 'center';
  for (const [x, t] of xs) if (x > x0 + 30 * k && x < x1 - 30 * k) { g.fillText(t, x, y0 - 12 * k); g.fillText(t, x, y1 + 24 * k); }
  for (const [y, t] of ys) if (y > y0 + 30 * k && y < y1 - 30 * k) { g.save(); g.translate(x0 - 12 * k, y); g.rotate(-Math.PI / 2); g.fillText(t, 0, 0); g.restore(); }
}
function sources(g, W, H, m, k, vi, depths) {
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#6b5a45'; g.font = `italic ${Math.round(16 * k)}px ${serif}`;
  g.fillText(vi ? `Dữ liệu: © OpenStreetMap contributors · độ cao${depths ? ', độ sâu' : ''}: AWS Terrain Tiles` : `Data: © OpenStreetMap contributors · heights${depths ? ', depths' : ''}: AWS Terrain Tiles`, W / 2, H - m + 6 * k);
}

/* ---- Phú Quốc alone (the Phú Quốc book: G, 16/10/2026: "cho sách Phú Quốc mở ra bản đồ riêng đảo Phú Quốc"): the
   island and its islets at some 50 m to the pixel, from the same OpenStreetMap coast at its own detail (pqmap); the sea
   lighter where it is shallow along the coast; its heights (50 and 200 m) softened, as the bands were traced at 200 m;
   its lakes and streams; its towns, the airport, the highest peak (Núi Chúa, 603 m, where the 200 m band is largest),
   the national park, the beaches, the An Thới islands, which way Cambodia lies, how far the mainland's ports are; and a
   small map of Vietnam in a corner with the island boxed in it. */
const ISLAND = { geo: null, box: [103.72, 9.93, 104.2, 10.49], kx: Math.cos(10.2 * Math.PI / 180) };
function islandGeo() {
  if (!ISLAND.geo) {
    const M = VN_GEO.pqmap, f = M.f, isles = decodeRings(M.isles, f);
    ISLAND.geo = { isles, main: isles.reduce((a, r) => r.length > a.length ? r : a, []),
      relief: M.relief.map(([d, s]) => [d, decodeRings(s, f)]), water: decodeRings(M.water, f), streams: decodeRings(M.streams, f) };
    // the peak: the middle of the largest piece of the 200 m band (Núi Chúa, 603 m, stands in its north-east range)
    const hi = (ISLAND.geo.relief.find(([d]) => d === 200) || [0, []])[1].reduce((a, r) => r.length > a.length ? r : a, []);
    let sx = 0, sy = 0; for (let i = 0; i < hi.length; i += 2) { sx += hi[i]; sy += hi[i + 1]; } ISLAND.geo.peak = hi.length ? [sx / (hi.length / 2), sy / (hi.length / 2)] : null;
  }
  return ISLAND.geo;
}
// a place on the coast: where given, moved onto the island's coast (the nearest point of its outline) and a little
// inland, so a town's dot sits on its shore whatever the outline's detail
function onCoast(main, lng, lat, inland = 0.004) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < main.length; i += 2) { const dx = (main[i] - lng) * ISLAND.kx, dy = main[i + 1] - lat, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
  const cx = 103.96, cy = 10.22, x = main[best], y = main[best + 1], dx = (cx - x) * ISLAND.kx, dy = cy - y, l = Math.hypot(dx, dy) || 1;
  return [x + dx / l * inland / ISLAND.kx, y + dy / l * inland];
}
function drawIsland(c, lang) {
  const W = c.width, H = c.height, g = c.getContext('2d'), k = W / 1024, vi = lang === 'vi', m = 58 * k, I = islandGeo(), V = atlasGeo();
  paper(g, W, H, 23);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#2f261d';
  g.font = `700 ${Math.round(70 * k)}px ${serif}`; spaced(g, 'PHÚ QUỐC', W / 2, m + 70 * k, 9 * k);
  g.font = `italic ${Math.round(26 * k)}px ${serif}`; g.fillStyle = '#5a4a38';
  g.fillText(vi ? 'Đảo Ngọc · Vịnh Thái Lan' : 'The pearl island · the Gulf of Thailand', W / 2, m + 104 * k);
  const x0 = m, x1 = W - m, y0 = m + 138 * k, y1 = H - m - 44 * k, P = frameProj(x0, y0, x1, y1, ISLAND.box, ISLAND.kx);
  g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
  // the sea, paler in the shallows along the coasts
  g.fillStyle = '#c9dfe3'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.lineJoin = 'round';
  for (const [w, a] of [[46, 0.16], [26, 0.2], [12, 0.26]]) { pathRings(g, I.isles, P); g.strokeStyle = `rgba(240, 248, 246, ${a})`; g.lineWidth = w * k; g.stroke(); }
  // the island: its lowland, its heights (softened: the bands were traced at 200 m), its lakes and streams
  g.save(); pathRings(g, I.isles, P); g.fillStyle = '#a7cf98'; g.fill('evenodd'); g.clip('evenodd');
  g.filter = `blur(${Math.round(7 * k)}px)`;
  for (const [d, rings] of I.relief) { g.fillStyle = d >= 200 ? '#d6c38f' : '#c9d79e'; pathRings(g, rings, P); g.fill('evenodd'); }
  g.filter = 'none';
  pathRings(g, I.water, P); g.fillStyle = '#9fc6d6'; g.fill('evenodd'); g.strokeStyle = '#4c7f99'; g.lineWidth = 1 * k; g.stroke();
  g.strokeStyle = 'rgba(48, 102, 150, 0.85)'; g.lineWidth = 1.6 * k; g.lineCap = 'round'; strokeLines(g, I.streams, P);
  g.restore();
  pathRings(g, I.isles, P); g.strokeStyle = '#3c5a66'; g.lineWidth = 1.6 * k; g.stroke();
  // the graticule, every 10′
  g.strokeStyle = 'rgba(70, 92, 104, 0.3)'; g.lineWidth = 0.9 * k;
  const ticks = (a, b) => { const out = []; for (let v = Math.ceil(a * 6) / 6; v <= b; v += 1 / 6) out.push(+v.toFixed(4)); return out; };
  const LX = ticks(ISLAND.box[0] - 0.2, ISLAND.box[2] + 0.2), LY = ticks(ISLAND.box[1] - 0.2, ISLAND.box[3] + 0.2);
  for (const v of LX) { g.beginPath(); g.moveTo(P.x(v), y0); g.lineTo(P.x(v), y1); g.stroke(); }
  for (const v of LY) { g.beginPath(); g.moveTo(x0, P.y(v)); g.lineTo(x1, P.y(v)); g.stroke(); }
  // names
  const halo = 'rgba(246, 240, 224, 0.92)';
  const place = (lng, lat, name, at, o = {}) => {   // a dot (or a mark) and its name beside it
    const x = P.x(lng), y = P.y(lat);
    if (o.mark) o.mark(x, y); else { g.beginPath(); g.arc(x, y, (o.big ? 6 : 4.8) * k, 0, Math.PI * 2); g.fillStyle = '#fbf6ea'; g.fill(); g.lineWidth = 2.4 * k; g.strokeStyle = '#3a2f26'; g.stroke(); }
    g.font = o.font || `${o.big ? 700 : 600} ${Math.round((o.big ? 27 : 21) * k)}px ${sans}`; g.textBaseline = 'middle';
    const off = (o.off || 12) * k, [tx, ty, al] = at === 'l' ? [x - off, y, 'right'] : at === 'r' ? [x + off, y, 'left'] : at === 't' ? [x, y - 20 * k, 'center'] : [x, y + 21 * k, 'center'];
    g.textAlign = al; haloText(g, name, tx, ty, halo, o.ink || '#2b231c', 6 * k); g.textAlign = 'center';
  };
  g.fillStyle = 'rgba(38, 86, 120, 0.85)'; g.font = `italic 600 ${Math.round(30 * k)}px ${serif}`; g.textBaseline = 'middle';
  (vi ? ['VỊNH', 'THÁI LAN'] : ['GULF OF', 'THAILAND']).forEach((l, i) => spaced(g, l, P.x(103.785), P.y(10.13) + (i - 0.5) * 38 * k, 5 * k));
  g.fillStyle = 'rgba(96, 84, 66, 0.75)'; g.font = `600 ${Math.round(21 * k)}px ${sans}`; spaced(g, vi ? '↑ CAMPUCHIA' : '↑ CAMBODIA', P.x(103.83), P.y(10.472), 4 * k);   // (its coast lies just north of the frame; the outline G's map has of it is too coarse for this scale)
  g.fillStyle = 'rgba(46, 108, 60, 0.9)'; g.font = `italic 600 ${Math.round(22 * k)}px ${serif}`;
  (vi ? ['Vườn quốc gia', 'Phú Quốc'] : ['Phú Quốc', 'National Park']).forEach((l, i) => g.fillText(l, P.x(103.935), P.y(10.355) + (i - 0.5) * 27 * k));
  if (I.peak) place(I.peak[0], I.peak[1], vi ? 'Núi Chúa 603 m' : 'Mt Chúa 603 m', 'r', { font: `italic 600 ${Math.round(19 * k)}px ${serif}`, ink: '#5a3a1e', off: 13,
    mark: (x, y) => { g.beginPath(); g.moveTo(x, y - 9 * k); g.lineTo(x + 8 * k, y + 6 * k); g.lineTo(x - 8 * k, y + 6 * k); g.closePath(); g.fillStyle = '#6b4a2a'; g.fill(); } });
  const M = I.main;
  for (const [lng, lat, name, at, big] of [[103.957, 10.215, 'Dương Đông', 'l', 1], [104.008, 10.02, 'An Thới', 'l', 1], [104.052, 10.178, 'Hàm Ninh', 'r'], [103.845, 10.37, 'Gành Dầu', 'l'],
    [104.0, 10.405, 'Bãi Thơm', 'r'], [103.885, 10.282, 'Cửa Cạn', 'l']]) { const [x, y] = onCoast(M, lng, lat); place(x, y, name, at, { big }); }
  place(103.993, 10.17, vi ? 'Sân bay' : 'Airport', 'r', { font: `600 ${Math.round(18 * k)}px ${sans}`, off: 16, mark: (x, y) => plane(g, x, y, 12 * k) });
  g.font = `italic ${Math.round(19 * k)}px ${serif}`; g.textBaseline = 'middle';
  for (const [lng, lat, name, at] of [[103.858, 10.335, 'Bãi Dài', 'l'], [103.963, 10.13, 'Bãi Trường', 'l'], [104.045, 10.055, 'Bãi Sao', 'r']]) {
    const [x, y] = onCoast(M, lng, lat, -0.006); g.textAlign = at === 'l' ? 'right' : 'left'; haloText(g, name, P.x(x), P.y(y), halo, '#6b4a2a', 5 * k);
  }
  g.textAlign = 'left'; haloText(g, 'Hòn Thơm', P.x(104.031), P.y(9.955), halo, '#3c4a40', 5 * k);
  g.textAlign = 'right'; g.font = `italic 600 ${Math.round(19 * k)}px ${serif}`; haloText(g, vi ? 'Quần đảo An Thới' : 'An Thới Islands', P.x(103.975), P.y(9.948), halo, '#3c4a40', 5 * k);
  // how far the mainland's ports are, along the right edge
  g.font = `italic 600 ${Math.round(20 * k)}px ${serif}`; g.textAlign = 'right'; g.fillStyle = '#5a4a38';
  g.fillText('Hà Tiên ~45 km →', x1 - 16 * k, P.y(10.262)); g.fillText('Rạch Giá ~115 km →', x1 - 16 * k, P.y(10.1));   // (below the corner map and the peak's name)
  // the compass, the scale (0 to 10 km), and Vietnam in a corner, the island boxed in it
  compass(g, P.x(104.14), P.y(10.0), 50 * k, lang, k);
  { const kmPx = P.s / 111.2, w = 10 * kmPx, h = 7 * k, x = P.x(103.745), y = P.y(9.955); g.textBaseline = 'alphabetic'; g.textAlign = 'center';
    for (let i = 0; i < 2; i++) { g.fillStyle = i % 2 ? '#fbf6ea' : '#3a2f26'; g.fillRect(x + i * w / 2, y, w / 2, h); }
    g.lineWidth = 1.2 * k; g.strokeStyle = '#3a2f26'; g.strokeRect(x, y, w, h); g.fillStyle = '#3a2f26'; g.font = `500 ${Math.round(17 * k)}px ${sans}`;
    for (let i = 0; i <= 2; i++) g.fillText(String(i * 5), x + i * w / 2, y - 7 * k); g.textAlign = 'left'; g.fillText('km', x + w + 14 * k, y - 7 * k); }
  { const bw = 150 * k, bh = 262 * k, bx = x1 - 14 * k - bw, by = y0 + 14 * k;   // (the locator)
    g.fillStyle = 'rgba(247, 242, 228, 0.97)'; g.fillRect(bx, by, bw, bh); g.lineWidth = 2.2 * k; g.strokeStyle = '#3a2f26'; g.strokeRect(bx, by, bw, bh);
    const Q = frameProj(bx + 8 * k, by + 8 * k, bx + bw - 8 * k, by + bh - 8 * k, [101.9, 8.3, 109.7, 23.6]);
    g.save(); g.beginPath(); g.rect(bx + 2 * k, by + 2 * k, bw - 4 * k, bh - 4 * k); g.clip();
    g.fillStyle = SEA.base; g.fillRect(bx, by, bw, bh); pathRings(g, V.foreign, Q); g.fillStyle = '#ebe2cb'; g.fill('evenodd');
    pathRings(g, V.vn, Q); g.fillStyle = '#a7cf98'; g.fill('evenodd'); g.strokeStyle = '#3c5a66'; g.lineWidth = 0.7 * k; g.stroke();
    g.restore();
    const [l0, b0, l1, b1] = ISLAND.box; g.strokeStyle = '#b0302a'; g.lineWidth = 2.4 * k; g.strokeRect(Q.x(l0) - 3 * k, Q.y(b1) - 3 * k, Q.x(l1) - Q.x(l0) + 6 * k, Q.y(b0) - Q.y(b1) + 6 * k);
    star(g, Q.x(105.854), Q.y(21.028), 6 * k, '#b0302a'); }
  g.restore();
  const dm = v => { const d = Math.floor(v + 1e-6), mm = Math.round((v - d) * 60); return `${d}°${String(mm).padStart(2, '0')}′`; };
  frameAround(g, x0, y0, x1, y1, k, LX.map(v => [P.x(v), dm(v) + 'E']), LY.map(v => [P.y(v), dm(v) + 'N']));
  sources(g, W, H, m, k, vi, false);
  return { x0: x0 / W, y0: y0 / H, x1: x1 / W, y1: y1 / H };
}
function plane(g, x, y, r) {   // an airport: a small aeroplane, nose to the north-east
  g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillStyle = '#3a2f26';
  g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.16, -r * 0.6); g.lineTo(r * 0.16, -r * 0.2); g.lineTo(r, r * 0.25); g.lineTo(r, r * 0.42); g.lineTo(r * 0.16, r * 0.2);
  g.lineTo(r * 0.16, r * 0.66); g.lineTo(r * 0.42, r * 0.86); g.lineTo(r * 0.42, r); g.lineTo(0, r * 0.88); g.lineTo(-r * 0.42, r); g.lineTo(-r * 0.42, r * 0.86); g.lineTo(-r * 0.16, r * 0.66);
  g.lineTo(-r * 0.16, r * 0.2); g.lineTo(-r, r * 0.42); g.lineTo(-r, r * 0.25); g.lineTo(-r * 0.16, -r * 0.2); g.lineTo(-r * 0.16, -r * 0.6); g.closePath(); g.fill();
  g.restore();
}

// the endpaper pasted inside the front board (what an open atlas shows on its left): a printed pattern of small compass
// stars in rows, a bookplate with the book's name, and under it a word on what the map beside it does; darker toward the
// joint (the right, by the spine)
function drawEndpaper(c, which, lang, title) {
  const W = c.width, H = c.height, g = c.getContext('2d'), k = W / 768, vi = lang === 'vi';
  g.fillStyle = '#ebe2cc'; g.fillRect(0, 0, W, H);
  const r = rng(which === 'vn' ? 5 : 9), st = 64 * k;
  for (let row = 0, y = st / 2; y < H + st; row++, y += st * 0.86) for (let x = (row % 2 ? st / 2 : 0); x < W + st; x += st) {
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4 * (row % 2)); g.fillStyle = 'rgba(92, 118, 128, 0.3)';
    g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? 2.6 * k : 10 * k; g.lineTo(rr * Math.sin(a), -rr * Math.cos(a)); } g.closePath(); g.fill();
    g.restore();
    g.fillStyle = 'rgba(92, 118, 128, 0.22)'; g.beginPath(); g.arc(x + st / 2, y + st * 0.43, 1.8 * k, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < W * H / 900; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '120, 96, 60' : '255, 255, 250'}, ${r() * 0.05})`; g.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r()); }
  // the bookplate
  const bw = 400 * k, bh = 330 * k, bx = (W - bw) / 2, by = H * 0.36 - bh / 2;
  g.fillStyle = '#f6f0e0'; g.fillRect(bx, by, bw, bh); g.strokeStyle = '#4a3b2a'; g.lineWidth = 3 * k; g.strokeRect(bx + 10 * k, by + 10 * k, bw - 20 * k, bh - 20 * k);
  g.lineWidth = 1.2 * k; g.strokeRect(bx + 18 * k, by + 18 * k, bw - 36 * k, bh - 36 * k);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#4a3b2a';
  g.font = `600 ${Math.round(22 * k)}px ${serif}`; spaced(g, 'EX LIBRIS', W / 2, by + 66 * k, 6 * k);
  compass(g, W / 2, by + 150 * k, 44 * k, lang, k * 0.8);
  g.font = `italic ${Math.round(30 * k)}px ${serif}`; g.fillStyle = '#2f261d'; g.fillText('Hidden Library', W / 2, by + 238 * k);
  g.fillRect(W / 2 - 50 * k, by + 256 * k, 100 * k, 1.6 * k);
  g.font = `600 ${Math.round(24 * k)}px ${serif}`; g.fillText((vi ? 'Tập bản đồ · ' : 'Atlas · ') + title, W / 2, by + 292 * k);
  // the word on the map
  g.fillStyle = '#7a2c22'; g.font = `italic ${Math.round(29 * k)}px ${serif}`;
  const lines = vi ? ['Bấm vào bản đồ bên cạnh', 'để mở trang →'] : ['Click the map beside it', 'to open its page →'];
  lines.forEach((l, i) => g.fillText(l, W / 2, by + bh + 78 * k + i * 40 * k));
  const gut = g.createLinearGradient(W, 0, W * 0.88, 0);
  gut.addColorStop(0, 'rgba(92, 70, 40, 0.22)'); gut.addColorStop(0.4, 'rgba(92, 70, 40, 0.06)'); gut.addColorStop(1, 'rgba(92, 70, 40, 0)'); g.fillStyle = gut; g.fillRect(W * 0.88, 0, W * 0.12, H);
}

export { ATLAS, drawAtlas, drawEndpaper };
