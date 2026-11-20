# the clock seen straight from its front, flat: each part's shadow on the front plane as an outline (python3 -I xray.py
# -> xray.json, what lib3d/world/clockxray.js draws as an X-ray plate beside the clock). Every part is filled on a grid
# (K px to one of the model's units) from its own triangles, the filled grid traced round its edges, the loops thinned.
# The frame is cut in slabs from front to back and the base apart, so that, laid over one another and each a little
# see-through, they add up as on an X-ray plate. Parts that turn about an arbor are taken as the model has them, and
# turned on the page; the verge's parts, which turn about an upright axis, are given apart with the way each points.
import os, sys, math, json; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from base import *
K = 44.0
V = Vt.astype(np.float64); U = -V[:, :, 1]; Z = V[:, :, 2]; X = V[:, :, 0]
u0, u1 = U.min() - 0.6, U.max() + 0.6; z0, z1 = Z.min() - 0.5, Z.max() + 0.6
W, H = int(math.ceil((u1 - u0) * K)), int(math.ceil((z1 - z0) * K))
px = lambda u, z: ((u - u0) * K, (z1 - z) * K)
def raster(mask):
    im = Image.new('L', (W, H), 0); d = ImageDraw.Draw(im)
    for t in np.where(mask)[0]: d.polygon([px(U[t, i], Z[t, i]) for i in range(3)], fill=255, outline=255)
    return np.asarray(im) > 0
def trace(m):   # the loops round the filled cells, along the cells' edges (the filled side on the right hand)
    P = np.pad(m, 1); out = {}; Hh, Ww = m.shape
    def add(a, b): out.setdefault(a, []).append(b)
    for y, x in zip(*[v.tolist() for v in np.nonzero(m & ~P[0:Hh, 1:Ww + 1])]): add((x, y), (x + 1, y))                 # (only the cells on an edge are walked)
    for y, x in zip(*[v.tolist() for v in np.nonzero(m & ~P[1:Hh + 1, 2:Ww + 2])]): add((x + 1, y), (x + 1, y + 1))
    for y, x in zip(*[v.tolist() for v in np.nonzero(m & ~P[2:Hh + 2, 1:Ww + 1])]): add((x + 1, y + 1), (x, y + 1))
    for y, x in zip(*[v.tolist() for v in np.nonzero(m & ~P[1:Hh + 1, 0:Ww])]): add((x, y + 1), (x, y))
    loops = []
    while out:
        s = next(iter(out)); cur = s; d = (0, 0); loop = [s]
        while True:
            c = out[cur]
            if len(c) == 1: nx = c.pop()
            else:   # two ways on (cells touching by a corner): the right turn keeps to this cell's own edge
                r = (-d[1], d[0]); i = next((k for k, e in enumerate(c) if (e[0] - cur[0], e[1] - cur[1]) == r), 0); nx = c.pop(i)
            if not c: del out[cur]
            d = (nx[0] - cur[0], nx[1] - cur[1]); cur = nx
            if cur == s: break
            loop.append(cur)
        loops.append(loop)
    return loops
def thin(loop, tol):   # Douglas and Peucker's, on a closed loop
    p = np.array(loop, float); n = len(p)
    if n < 8: return loop
    a = 0; b = int(np.argmax(((p - p[0]) ** 2).sum(1))); keep = np.zeros(n, bool); keep[[a, b]] = True
    def rec(i, j):
        stack = [(i, j)]
        while stack:
            i, j = stack.pop(); idx = np.arange(i + 1, j) if j > i else np.r_[np.arange(i + 1, n), np.arange(0, j)]
            if len(idx) == 0: continue
            A, B = p[i], p[j % n]; ab = B - A; L = math.hypot(*ab) or 1.0; dist = np.abs((p[idx, 0] - A[0]) * ab[1] - (p[idx, 1] - A[1]) * ab[0]) / L
            k = int(np.argmax(dist))
            if dist[k] > tol: m = int(idx[k]); keep[m] = True; stack.append((i, m)); stack.append((m, j))
    rec(a, b); rec(b, a + n if False else a)
    return [loop[i] for i in range(n) if keep[i]]
def area(loop): x = np.array([q[0] for q in loop]); y = np.array([q[1] for q in loop]); return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
def path(mask, tol=1.5, small=20.0):
    d = ''; n = 0
    for loop in trace(raster(mask)):
        if area(loop) < small: continue
        q = thin(loop, tol)
        if len(q) < 3: continue
        d += 'M%d %dl' % q[0] + ' '.join('%d %d' % (b[0] - a[0], b[1] - a[1]) for a, b in zip(q[:-1], q[1:])) + 'z'; n += len(q)
    return d, n
tc = V.mean(1); TX, TZ = tc[:, 0], tc[:, 2]; out = {'W': W, 'H': H, 'K': K, 'parts': {}}; total = 0
def part_path(name, mask, **kw):
    global total; d, n = path(mask, **kw); out['parts'][name] = d; total += len(d); print('%-10s %6d triangles -> %5d points, %6d bytes' % (name, mask.sum(), n, len(d)))
st = np.isin(part, ['static', 'ringbody'])
part_path('base', st & (Z.max(1) < 3.6), tol=2.2)
part_path('front', st & (Z.max(1) >= 3.6) & (TX < -2.3), tol=1.7)
part_path('mid', st & (Z.max(1) >= 3.6) & (TX >= -2.3) & (TX < 2.2), tol=1.7)
part_path('back', st & (Z.max(1) >= 3.6) & (TX >= 2.2), tol=1.7)
for nm in ('bell', 'hand', 'star', 'dial', 'low', 'mid2', 'top', 'lever', 'hammer'):
    part_path(nm, part == {'mid2': 'mid'}.get(nm, nm), tol=1.2 if nm in ('hand', 'star', 'lever', 'hammer') else 1.3)
# ---- the verge: its rod and the block the foliot sits on (they do not change as it turns); the foliot's bar; its two
# weights; its three arms; the two pallets are drawn by the page (flags seen edge on: a width from their angle)
vg = part == 'verge'; AXU, AXY = -0.378, 0.378; AX_X = -1.582
rx = V[:, :, 0] - AX_X; ry = V[:, :, 1] - AXY; rho = np.hypot(rx, ry); rmax = rho.max(1); az = np.degrees(np.arctan2(ry.mean(1), rx.mean(1)))
UP = [2118, 2121, 2142, 2123, 2141, 2122, 1750]; LO = [2669, 2688, 2932, 2967, 2969]; pal = np.isin(inv, UP + LO)
zc = Z.mean(1); rod = vg & ~pal & (rmax < 0.8)
wt = vg & ~pal & ~rod & (rmax > 4.9) & (zc < 21.95) & (Z.max(1) < 22.05); bar = vg & ~pal & ~rod & ~wt & ((zc > 21.3) | (rmax > 4.9))
arms = vg & ~pal & ~rod & ~wt & ~bar
part_path('rod', rod, tol=1.2); part_path('bar', bar, tol=1.2)
part_path('wtL', wt & (ry.mean(1) > 0), tol=1.2); part_path('wtR', wt & (ry.mean(1) < 0), tol=1.2)
ARM = [66.6, -46.0, 96.6]; which = np.argmin(np.abs(((az[:, None] - np.array(ARM)[None, :] + 180) % 360) - 180), axis=1); arm_az = []
for i in range(3):
    m = arms & (which == i); a = float(np.degrees(np.arctan2((ry[m] * rho[m]).sum(), (rx[m] * rho[m]).sum()))) if m.any() else ARM[i]; arm_az.append(round(a, 1)); part_path('arm%d' % i, m, tol=1.2)
bm = bar; w, v = np.linalg.eigh(np.cov(np.c_[rx[bm].ravel(), ry[bm].ravel()].T)); bar_az = float(np.degrees(np.arctan2(v[1, 1], v[0, 1]))); bar_az = bar_az if bar_az > 0 else bar_az + 180
def cu(m): return float(-(V[m][:, :, 1].mean()))
P = lambda u, z: [round((u - u0) * K, 1), round((z1 - z) * K, 1)]
pz = lambda ids: [float(V[np.isin(inv, ids)][:, :, 2].min()), float(V[np.isin(inv, ids)][:, :, 2].max())]
out['verge'] = {'x': P(AXU, 0)[0], 'bar': round(bar_az, 2), 'arms': arm_az, 'wtL': P(cu(wt & (ry.mean(1) > 0)), 0)[0], 'wtR': P(cu(wt & (ry.mean(1) < 0)), 0)[0],
  'pal': [{'az': 15.1, 'y0': P(0, pz(UP)[1])[1], 'y1': P(0, pz(UP)[0])[1], 'reach': round(0.55 * K, 1)}, {'az': -7.3, 'y0': P(0, pz(LO)[1])[1], 'y1': P(0, pz(LO)[0])[1], 'reach': round(0.53 * K, 1)}]}
# ---- the pivots, the wire's two hooks, the dial ring and its numerals
out['pivot'] = {'dial': P(-0.341, 11.594), 'low': P(-0.414, 8.347), 'mid2': P(-0.420, 11.526), 'top': P(-0.394, 14.707), 'lever': P(-1.236, 8.398), 'hammer': P(0.27, 29.40)}
out['wire'] = {'B': P(7.841, 11.727), 'T': P(6.943, 33.138)}
RC = P(-0.335, 11.594); RIN, ROUT = 4.707, 6.239; out['ring'] = {'c': RC, 'rin': round(RIN * K, 1), 'rout': round(ROUT * K, 1)}
RMID = (RIN + ROUT) / 2 * K; HG = (ROUT - RIN) * 0.60 * K; TH = HG * 0.185; TN = HG * 0.085; SE = HG * 0.085; nd = ''
def place(th):
    c, s = math.cos(th), math.sin(th)
    return lambda x, y: '%.1f %.1f' % (RC[0] + (RMID + y) * s + x * c, RC[1] - (RMID + y) * c + x * s)
def poly(f, pts): return 'M' + 'L'.join(f(*p) for p in pts) + 'Z'
def gI(f, x): h = HG / 2; e = SE * 1.25; w = TH; return poly(f, [(x - w / 2 - e, -h), (x + w / 2 + e, -h), (x + w / 2 + e, -h + SE * 0.5), (x + w / 2, -h + SE * 1.3), (x + w / 2, h - SE * 1.3), (x + w / 2 + e, h - SE * 0.5), (x + w / 2 + e, h), (x - w / 2 - e, h), (x - w / 2 - e, h - SE * 0.5), (x - w / 2, h - SE * 1.3), (x - w / 2, -h + SE * 1.3), (x - w / 2 - e, -h + SE * 0.5)])
def gV(f, x, wd): h = HG / 2; a = wd / 2; return poly(f, [(x - a - TH * 0.6, h), (x - a + TH * 0.6, h), (x + TH * 0.1, -h + TH * 1.6), (x + a - TN * 0.7, h), (x + a + TN * 0.7, h), (x + TH * 0.45, -h), (x - TH * 0.45, -h)])
def gX(f, x, wd): h = HG / 2; a = wd / 2; return poly(f, [(x - a - TH * 0.55, h), (x - a + TH * 0.55, h), (x + a + TH * 0.55, -h), (x + a - TH * 0.55, -h)]) + poly(f, [(x + a - TN * 0.7, h), (x + a + TN * 0.7, h), (x - a + TN * 0.7, -h), (x - a - TN * 0.7, -h)])
WI = TH + SE * 2.5; WV = HG * 0.74; WX = HG * 0.72; GAP = HG * 0.13
for k, word in enumerate(['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']):
    f = place(k * math.pi / 6); ws = [WI if ch == 'I' else WV if ch == 'V' else WX for ch in word]; x = -(sum(ws) + GAP * (len(word) - 1)) / 2
    for ch, w in zip(word, ws):
        cx = x + w / 2; nd += gI(f, cx) if ch == 'I' else gV(f, cx, w - TH * 1.1 - SE) if ch == 'V' else gX(f, cx, w - TH * 1.1 - SE); x += w + GAP
out['numerals'] = nd; out['dots'] = [[round(RC[0] + RMID * math.sin((k + 0.5) * math.pi / 6), 1), round(RC[1] - RMID * math.cos((k + 0.5) * math.pi / 6), 1)] for k in range(12)]
json.dump(out, open(os.path.join(HERE, 'xray.json'), 'w'), separators=(',', ':'))
print('canvas %d x %d px; paths %d bytes, numerals %d; bar points %.1f deg from the depth; arms %s; file %d bytes' % (W, H, total, len(nd), bar_az, arm_az, os.path.getsize(os.path.join(HERE, 'xray.json'))))
# a picture of it all, to look at
im = Image.new('RGB', (W, H), (6, 11, 18)); ov = Image.new('RGB', (W, H), (0, 0, 0))
for nm, mk in (('base', st & (Z.max(1) < 3.6)), ('front', st & (Z.max(1) >= 3.6) & (TX < -2.3)), ('mid', st & (Z.max(1) >= 3.6) & (TX >= -2.3) & (TX < 2.2)), ('back', st & (Z.max(1) >= 3.6) & (TX >= 2.2)), ('wheels', np.isin(part, ['dial', 'low', 'mid', 'top', 'star', 'hand', 'verge', 'bell', 'hammer', 'lever']))):
    a = np.asarray(im).astype(int) + (raster(mk)[..., None] * np.array([34, 48, 60])).astype(int); im = Image.fromarray(a.clip(0, 255).astype(np.uint8))
im.save(os.path.join(HERE, 'xray-check.png'))
