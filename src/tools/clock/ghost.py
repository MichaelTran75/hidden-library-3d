# pieces left standing that lie on a moving part (its other faces): each static piece's share of points within 0.07 to
# 0.14 of a part. A face listed here turns with its part only once segment3.py names it (bushings in the plates are
# round and stay: no need).
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from base import *
CELL = 0.07
cells = lambda p: np.floor(p / CELL).astype(np.int64); key = lambda c: (c[:, 0] + 2000) * 16000000 + (c[:, 1] + 2000) * 4000 + (c[:, 2] + 2000)
st = np.where(G == 'static')[0]
for g in ('dial', 'hand', 'star', 'low', 'mid', 'top', 'verge', 'hammer', 'lever', 'wire'):
    pts = dense(Vt[part == g], 4); c = cells(pts); occ = set()
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1): occ.update(key(c + np.array([dx, dy, dz])).tolist())
    occ = np.array(sorted(occ)); lo, hi = pts.min(0) - 0.2, pts.max(0) + 0.2
    cand = st[(X1[st] > lo[0]) & (X0[st] < hi[0]) & (Y1[st] > lo[1]) & (Y0[st] < hi[1]) & (Z1[st] > lo[2]) & (Z0[st] < hi[2])]; out = []
    for i in cand:
        share = np.isin(key(cells(dense(Vt[inv == i], 3))), occ).mean()
        if share > 0.5 and cnt[i] >= 12: out.append((int(i), int(cnt[i]), round(float(share), 2), [round(float(v), 2) for v in (X0[i], X1[i], Y0[i], Y1[i], Z0[i], Z1[i])]))
    print(g, sorted(out, key=lambda r: -r[1]))
