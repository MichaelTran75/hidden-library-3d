"""The map of Vietnam in the Geography books -> src/lib3d/ui/vn-geo.js

    python3 tools/vnmap/make.py [path/to/Single VN map.html]

Its data is G's own map's (HTML MAP/Single VN map.html, its GEO: the OpenStreetMap coastline, natural=coastline, and
Vietnam's border, relation 49915; the sea's depths and the land's heights as bands traced from AWS Terrain Tiles,
terrarium), cut down to what a book's page shows (some 900 px across for 16 degrees of longitude):

- the land of Vietnam: the mainland as G's map closes it (the longest open stretch of coast, then the border back to
  where it began) and its islands, each simplified (Douglas-Peucker) to 0.008 degrees (half a pixel of the page); islands too small to draw
  dropped, but those of the archipelagos kept as dots (their middles);
- Hoang Sa's islands, which the coastline data lacks, placed by hand (their positions to a few hundred metres: dots on
  the page);
- the neighbours' land, the sea's depth bands (200, 1000 and 3000 m of the 8) and the land's (200, 500, 1000 and 1500 m
  of the 7), simplified to a pixel or two of the page, pieces under ten pixels dropped;
- the border on land, simplified as the coast is, for its dash-dot line; Phu Quoc on its own, finer (0.0012 degrees),
  for the Phu Quoc book's inset;
- the major rivers, those over 90 km;
- and Phu Quoc's own map (`pqmap`, at 1/10000 degree): the island and its islets, its height bands, lakes and streams.

Each ring is an encoded polyline (lng, lat; deltas in 1/1000 degree as 5-bit groups + 63, as Google's polylines), the
rings of a layer joined by spaces. Drawn on the page's canvas by ui/atlas.js (the rings of a layer in one path, filled
even-odd, so holes need no marking).
"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..'))
DEFAULT = os.path.expanduser('~/Desktop/B. Ebook & Audio Book/HTML MAP/Single VN map.html')
OUT = os.path.join(SRC, 'lib3d', 'ui', 'vn-geo.js')
F = 1000.0      # the grid: 1/1000 degree (~110 m)
KX = math.cos(math.radians(15))   # (distances measured with longitude shrunk as at 15 degrees north)


def dec(s, f):
    pts, i, x, y = [], 0, 0, 0
    while i < len(s):
        for k in (0, 1):
            sh = res = 0
            while True:
                b = ord(s[i]) - 63; i += 1; res |= (b & 0x1f) << sh; sh += 5
                if b < 0x20: break
            v = ~(res >> 1) if res & 1 else res >> 1
            if k == 0: x += v
            else: y += v
        pts.append((x / f, y / f))
    return pts


def enc(pts, F=F):
    out, px, py = [], 0, 0
    for x, y in pts:
        ix, iy = round(x * F), round(y * F)
        for v in (ix - px, iy - py):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20: out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        px, py = ix, iy
    return ''.join(out)


def dp(pts, eps):   # Douglas-Peucker, iterative, in the shrunk-longitude plane
    if len(pts) < 3: return pts[:]
    keep = [False] * len(pts); keep[0] = keep[-1] = True; stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop(); ax, ay = pts[a][0] * KX, pts[a][1]; bx, by = pts[b][0] * KX, pts[b][1]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy); best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i][0] * KX - ax, pts[i][1] - ay
            d = abs(dx * py - dy * px) / L if L > 1e-12 else math.hypot(px, py)
            if d > best: best, bi = d, i
        if best > eps: keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def ring_dp(r, eps):   # a closed ring: split at its farthest point from the first, so both halves simplify well
    if len(r) < 8: return r[:]
    x0, y0 = r[0]; far = max(range(len(r)), key=lambda i: ((r[i][0] - x0) * KX) ** 2 + (r[i][1] - y0) ** 2)
    a, b = dp(r[:far + 1], eps), dp(r[far:], eps)
    return a + b[1:]


def bbox(r):
    xs = [p[0] for p in r]; ys = [p[1] for p in r]; return min(xs), min(ys), max(xs), max(ys)


def span(r):
    x0, y0, x1, y1 = bbox(r); return max((x1 - x0) * KX, y1 - y0)


def snap(r, F=F):   # onto the grid, repeats dropped, and closed
    out = []
    for x, y in r:
        p = (round(x * F) / F, round(y * F) / F)
        if not out or p != out[-1]: out.append(p)
    if len(out) > 2 and out[0] != out[-1]: out.append(out[0])
    return out


def layer(rings, eps, min_span, F=F):
    out = []
    for r in rings:
        if len(r) < 4 or span(r) < min_span: continue
        s = snap(ring_dp(r, eps), F)
        if len(s) >= 4: out.append(s)
    return out



def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    html = open(path, encoding='utf-8').read()
    i = html.index('const GEO = ') + len('const GEO = '); j = html.index(';\n', i)
    G = json.loads(html[i:j]); f = G['f']
    coast = [dec(s, f) for s in G['coast']]; border = dec(G['land'][0], f)
    km = lambda a, b: math.hypot((a[0] - b[0]) * 111 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 111)
    main_i = max((k for k, r in enumerate(coast) if km(r[0], r[-1]) > 1), key=lambda k: len(coast[k]))
    mainland = coast[main_i] + border[::-1]   # (as G's map closes it: the border reversed)
    isles = [r for k, r in enumerate(coast) if k != main_i and len(r) >= 4]
    # the land of Vietnam; islands under ~1.5 km dropped, except the archipelagos', kept as dots
    vn = layer([mainland], 0.008, 0) + layer(isles, 0.008, 0.014)
    arch = lambda x, y: x > 110.5   # (Hoang Sa and Truong Sa: everything far out at sea)
    dots = []
    for r in isles:
        if span(r) >= 0.014: continue
        x0, y0, x1, y1 = bbox(r)
        if arch((x0 + x1) / 2, (y0 + y1) / 2): dots.append(((x0 + x1) / 2, (y0 + y1) / 2))
    # Hoang Sa (the Paracels), which the coastline data does not hold: the larger islands and reefs, by hand
    hoang_sa = [(112.335, 16.835), (112.732, 16.668), (112.265, 16.982), (112.315, 16.965), (112.338, 16.958), (112.348, 16.952),
                (112.20, 16.95), (111.607, 16.532), (111.585, 16.523), (111.510, 16.452), (111.712, 16.452), (111.742, 16.463),
                (111.200, 15.783), (111.770, 16.050), (111.667, 16.233), (111.500, 17.083), (112.520, 16.040)]
    dots += hoang_sa
    dots = sorted(set((round(x, 3), round(y, 3)) for x, y in dots))
    # the neighbours' land, the depth bands of the sea and of the land
    mask = [r for p in G['mask'] for r in [dec(q, f) for q in p]]
    foreign = layer(mask, 0.03, 0.1)
    sea = {b['d']: layer([dec(q, f) for p in b['p'] for q in p], 0.045, 0.25) for b in G['bands'] if b['d'] in (200, 1000, 3000)}
    relief = {b['d']: layer([dec(q, f) for p in b['p'] for q in p], 0.035, 0.18) for b in G['landbands'] if b['d'] in (200, 500, 1000, 1500)}
    rivers = []
    for s in G['riverMajor']:
        r = dec(s, f)
        if sum(km(r[k], r[k + 1]) for k in range(len(r) - 1)) < 90: continue
        r = dp(r, 0.025); rivers.append([(round(x * F) / F, round(y * F) / F) for x, y in r])
    # Phu Quoc's own map (the Phu Quoc book opens on it: G, 16/10/2026): within a box round the island, everything at
    # 1/10000 degree (~11 m) and simplified to ~30 m: the island and its islets (the An Thoi archipelago), its heights (50
    # and 200 m), its lakes and its streams (the neighbours' land of G's map is too coarse at this scale: left out)
    PF, PB = 10000.0, (103.66, 9.86, 104.26, 10.56)
    inb = lambda r: any(PB[0] <= x <= PB[2] and PB[1] <= y <= PB[3] for x, y in r)
    pring = lambda r, e: snap(ring_dp(r, e), PF)
    pq_isles = [pring(r, 0.0003) for r in coast if inb(r) and len(r) >= 4 and span(r) >= 0.0015]
    pq_isles = [r for r in pq_isles if len(r) >= 4]
    pq_rel = [[b['d'], [pring(r, 0.0005) for p in b['p'] for r in [dec(q, f) for q in p] if inb(r)]] for b in G['landbands'] if b['d'] in (50, 200)]
    pq_wat = [pring(r, 0.0002) for p in G['waterArea'] for r in [dec(q, f) for q in p] if inb(r)]
    pq_str = [[(round(x * PF) / PF, round(y * PF) / PF) for x, y in dp(r, 0.0002)] for k in ('riverMinor', 'riverSouth') for r in (dec(s_, f) for s_ in G[k]) if inb(r)]
    pjoin = lambda rs: ' '.join(enc(r, PF) for r in rs)
    pqmap = {'f': PF, 'isles': pjoin(pq_isles), 'relief': [[d, pjoin(rs)] for d, rs in pq_rel], 'water': pjoin(pq_wat), 'streams': pjoin(pq_str)}
    joined = lambda rs: ' '.join(enc(r) for r in rs)
    line = [(round(x * F) / F, round(y * F) / F) for x, y in dp(border, 0.008)]   # the border on land, for its dash-dot line
    # Phu Quoc alone, finer (the Phu Quoc book shows it again, some 18 times larger, in an inset)
    pq = max((r for r in isles if bbox(r)[0] < 103.97 < bbox(r)[2] and bbox(r)[1] < 10.23 < bbox(r)[3]), key=len)
    pq = snap(ring_dp(pq, 0.0012))
    data = {'f': F, 'vn': joined(vn), 'border': enc(line), 'pq': enc(pq), 'dots': enc(dots), 'foreign': joined(foreign),
            'sea': [[d, joined(rs)] for d, rs in sorted(sea.items())], 'relief': [[d, joined(rs)] for d, rs in sorted(relief.items())],
            'rivers': joined(rivers), 'pqmap': pqmap}
    n = lambda rs: sum(len(r) for r in rs)
    stats = (f"vn {len(vn)} rings / {n(vn)} pts, border {len(line)}, pq {len(pq)}, dots {len(dots)}, foreign {len(foreign)} / {n(foreign)}, "
             + ', '.join(f"sea {d} {len(rs)} / {n(rs)}" for d, rs in sorted(sea.items())) + ', '
             + ', '.join(f"relief {d} {len(rs)} / {n(rs)}" for d, rs in sorted(relief.items())) + f", rivers {len(rivers)} / {n(rivers)}"
             + f"; Phu Quoc's map: isles {len(pq_isles)} / {n(pq_isles)}, relief " + ', '.join(f"{d} {len(rs)} / {n(rs)}" for d, rs in pq_rel)
             + f", water {len(pq_wat)} / {n(pq_wat)}, streams {len(pq_str)} / {n(pq_str)}")
    body = json.dumps(data, ensure_ascii=True, separators=(',', ':'))
    js = ("import './hero-books.js';   // build order: the module before this one runs first\n\n"
          "/* The map of Vietnam in the Geography books, drawn by ui/atlas.js. Made by src/tools/vnmap/make.py (do not edit by hand)\n"
          "   from G's own map of Vietnam (HTML MAP/Single VN map.html): the coastline and the border from OpenStreetMap\n"
          "   (© OpenStreetMap contributors, ODbL: openstreetmap.org/copyright), the depth and height bands from AWS Terrain Tiles\n"
          "   (terrarium); Hoang Sa's islands placed by hand. Rings as encoded polylines (lng, lat in 1/1000 degree), a layer's\n"
          "   rings joined by spaces; `dots`: the archipelagos' islands too small to draw, as points.\n"
          f"   {stats} */\n"
          f"const VN_GEO = {body};\n\nexport {{ VN_GEO }};\n")
    open(OUT, 'w', encoding='utf-8').write(js)
    print(stats); print('wrote', OUT, round(len(js) / 1024, 1), 'KB')


if __name__ == '__main__':
    main()
