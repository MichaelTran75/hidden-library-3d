import os, site, sys; sys.path.append(site.getusersitepackages()); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # (numpy under -I; the modules beside this one)
import glb, numpy as np, json
g, M, imgs = glb.load(sys.argv[1])
ALL = []   # every part: mesh, triangles, bbox
for m in M:
    r = glb.components(m['P'], m['T'])
    for u in np.unique(r):
        T = m['T'][r == u]; p = m['P'][np.unique(T)]; ALL.append({'m': m, 'T': T, 'lo': p.min(0), 'hi': p.max(0), 'n': len(T)})
def segs(m, T, axis, v):
    P = m['P']; out = []
    for tri in T:
        a = P[tri][:, axis] - v
        if (a > 0).all() or (a < 0).all(): continue
        q = []
        for i in range(3):
            j = (i + 1) % 3
            if a[i] == 0: q.append(P[tri[i]])
            elif a[i] * a[j] < 0: t = a[i] / (a[i] - a[j]); q.append(P[tri[i]] + (P[tri[j]] - P[tri[i]]) * t)
        out += q
    return np.array(out) if out else np.zeros((0, 3))
def sel(cond): return [p for p in ALL if cond(p['lo'], p['hi'], p['n'])]
