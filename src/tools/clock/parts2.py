# connected parts by shared vertex index only (no welding): the objects the model was made of, split at UV seams
import os, site, sys; sys.path.append(site.getusersitepackages())
import numpy as np, pickle
D = pickle.load(open(sys.argv[1], 'rb')); P, T = D['P'], D['T']
parent = np.arange(len(P))
def find(x):
    r = x
    while parent[r] != r: r = parent[r]
    while parent[x] != r: parent[x], x = r, parent[x]
    return r
for a, b, c in T:
    ra, rb = find(a), find(b)
    if ra != rb: parent[rb] = ra
    ra, rc = find(a), find(c)
    if ra != rc: parent[rc] = ra
root = np.array([find(v) for v in range(len(P))]); troot = root[T[:, 0]]
u, cnt = np.unique(troot, return_counts=True)
print(len(u), 'index-connected pieces; sizes:', np.sort(cnt)[::-1][:30], '... smallest', np.sort(cnt)[:10])
D['troot'] = troot; pickle.dump(D, open(sys.argv[1], 'wb'))
