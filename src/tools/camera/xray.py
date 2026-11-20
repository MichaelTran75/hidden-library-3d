# the camera seen straight from its side, flat: each part's shadow on the plane through the lens's axis as an outline
# (python3 xray.py meshes.json -> xray.json next to it; needs numpy and Pillow, what lib3d/world/camxray.js draws as an X-ray plate beside the
# camera; meshes.json from xray_dump.cjs). Seen from the rewind side, so the lens points left and the eyepiece right, as
# such a camera is drawn. Every part is filled on a grid (K px a millimetre) from its own triangles, the filled grid
# traced round its edges, the loops thinned (the clock's way: tools/clock/xray.py). Plates that face the viewer flat
# (the walls between the chambers, the mirror box's sides) are left out: on an X-ray they hardly show, here they would
# only veil what lies between them.
import os, sys, math, json
import numpy as np
from PIL import Image, ImageDraw
SRC = sys.argv[1]; HERE = os.path.dirname(os.path.abspath(SRC)); K = 8.0
RAW = {k: np.array(v, float).reshape(-1, 3, 3) for k, v in json.load(open(SRC)).items()}   # (name#n: the n-th mesh of that name)
M = {}
for k, v in RAW.items(): n = k.split('#')[0]; M[n] = np.concatenate([M[n], v]) if n in M else v
Z0, Z1, Y0, Y1 = -13.0, 80.0, -37.0, 64.0   # the plate's edges (mm): z from the eyepiece's rim to the lens's front, y from the bottom to the prism's peak
W, H = int(round((Z1 - Z0) * K)), int(round((Y1 - Y0) * K))
px = lambda z, y: ((Z1 - z) * K, (Y1 - y) * K)
def raster(T):
    im = Image.new('L', (W, H), 0); d = ImageDraw.Draw(im)
    for t in T: d.polygon([px(t[i, 2], t[i, 1]) for i in range(3)], fill=255, outline=255)
    return np.asarray(im) > 0
def trace(m):   # the loops round the filled cells, along the cells' edges (the filled side on the right hand)
    P = np.pad(m, 1); out = {}; Hh, Ww = m.shape
    def add(a, b): out.setdefault(a, []).append(b)
    for y, x in zip(*[v.tolist() for v in np.nonzero(m & ~P[0:Hh, 1:Ww + 1])]): add((x, y), (x + 1, y))
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
    rec(a, b); rec(b, a)
    return [loop[i] for i in range(n) if keep[i]]
def area(loop): x = np.array([q[0] for q in loop]); y = np.array([q[1] for q in loop]); return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
out = {'W': W, 'H': H, 'K': K, 'parts': {}}; total = 0; masks = {}
def part(name, T, tol=1.0, small=6.0):
    global total; m = raster(T); masks[name] = m; d = ''; n = 0
    for loop in trace(m):
        if area(loop) < small: continue
        q = thin(loop, tol)
        if len(q) < 3: continue
        d += 'M%d %dl' % q[0] + ' '.join('%d %d' % (b[0] - a[0], b[1] - a[1]) for a, b in zip(q[:-1], q[1:])) + 'z'; n += len(q)
    out['parts'][name] = d; total += len(d); print('%-9s %6d triangles -> %5d points, %6d bytes' % (name, len(T), n, len(d)))
get = lambda *names: np.concatenate([M[n] for n in names if n in M])
cy = lambda T: T[:, :, 1].mean(1); cx = lambda T: T[:, :, 0].mean(1)
flat = lambda T, x, w=0.9: (np.abs(T[:, :, 0] - x) < w).all(1)   # a plate that faces the viewer flat, at x
# ---- the shell: its body, its two covers; the knobs and the eyepiece's rim; the lens's barrel
S = M['shell']; part('body', S[(cy(S) <= 26.9) & (cy(S) >= -29.4)], 1.2); part('top', S[cy(S) > 26.9], 1.2); part('bottom', S[cy(S) < -29.4], 1.2)
part('knobs', get(*[k for k in M if k.startswith('Knop') or k.startswith('ViewPort')]), 1.0)
part('barrel', get('Lence_LP_Bag_0', 'lens:alu'), 1.0)
# ---- the glass, the stop, the finder
for i, (a, b) in enumerate([('front', 0), ('front', 1), ('front', 2), ('rear', 0), ('rear', 1)]):   # (each lens its own outline: two of them all but touch)
    part('glass%d' % i, np.concatenate([RAW['%s:glass#%d' % (a, b)], RAW['%s:black#%d' % (a, b)]]), 0.7)
part('iris', get('iris:blade', 'iris:brass'), 0.8)
B = M['mbox:black']; part('mbox', B[~flat(B, 22.25) & ~flat(B, -22.25)], 0.9); part('throat', M['mbox:alu'], 0.9); part('mirror', M['mbox:mirror'], 0.9, 2); part('link', M['mbox:steel'], 0.8)
part('screen', get('screen:screen', 'screen:brass'), 0.7, 2); part('prism', M['prism:paint+deep'], 0.9);   # (slanted edges: a looser fit, or every step of the grid stays) part('eye', get('eye:glass', 'eye:black'), 0.7)
# ---- the shutter, the film's way, the casting, the gears
part('rollers', get('shutter:steel', 'shutter:brass'), 0.8); part('cloth', M['shutter:cloth'], 0.7, 2)
C = M['body:black']; part('casting', C[~flat(C, 36.6) & ~flat(C, -46.2)], 0.9)
part('shafts', M['body:steel'], 0.9); part('spool', M['body:can'], 0.9); part('wind', M['body:brass'], 0.8)
part('gears', get('gears:brass', 'gears:dark', 'gears:steel'), 0.8, 2); part('gov', M['gov:brass'], 0.8, 2); part('rods', M['gov:steel'], 0.7, 2)
F = M['film:film']; part('film', F[(F[:, :, 2] < -2.5).all(1)], 0.6, 2); part('coil', F[~(F[:, :, 2] < -2.5).all(1)], 0.9)   # (the film across the gate, edge on; what is wound on the spool apart)
part('cassette', get('film:can', 'film:black'), 0.9); part('plate', get('plate:paint', 'plate:steel'), 0.6, 2); part('bush', M['bottom:brass'], 0.8)
# ---- the way of the light (millimetres from camparts.js CP: the film, the screen, the prism), as points on the plate
ZF, YS, A, E = -2.8, 20.5, 10.8, 13.3; ZS = ZF + YS; YB = YS + 1.7; T = A + math.tan(math.pi / 8) * E
P = lambda z, y: [round(v, 1) for v in px(z, y)]
out['ray'] = [P(Z1 - 1.5, 0), P(ZS, 0), P(ZS, YB + E + T), P(ZS + T, YB + E), P(Z0 + 1.5, YB + E)]; out['film'] = [P(ZS, 0), P(ZF, 0)]
out['mm10'] = K * 10
json.dump(out, open(os.path.join(HERE, 'xray.json'), 'w'), separators=(',', ':'))
print('plate %d x %d px; paths %d bytes; file %d bytes' % (W, H, total, os.path.getsize(os.path.join(HERE, 'xray.json'))))
# a picture of it all, to look at
im = np.zeros((H, W, 3), int) + np.array([230, 219, 194])
for nm, m in masks.items(): im = im - (m[..., None] * np.array([26, 30, 34]))
Image.fromarray(im.clip(0, 255).astype(np.uint8)).save(os.path.join(HERE, 'xray-check.png'))
