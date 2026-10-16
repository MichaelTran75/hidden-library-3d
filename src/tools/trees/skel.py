import json, numpy as np, heapq, sys, warnings, pickle
warnings.filterwarnings('ignore')
# level-set skeleton of a tree mesh: geodesic distance from the lowest vertex, sliced into bands; each connected piece
# of a band -> a node at its centroid (radius = mean distance of its ring vertices from it); nodes linked band to band
K, name, band = sys.argv[1], sys.argv[2], float(sys.argv[3])
d = json.load(open(f'shots/dump_{K}.json')); bk = d[name]
B = np.array(bk['pos']).reshape(-1, 3); BI = np.array(bk['idx']).reshape(-1, 3)
key = np.round(B / float(sys.argv[4] if len(sys.argv) > 4 else 0.0005)).astype(np.int64)
_, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True); inv = inv.ravel(); W = B[first]; T = inv[BI]
def subdivide(W, T):   # 1-to-4 split, midpoints shared per edge
    W = list(map(tuple, W)); mid = {}; out = []
    def m(a, b):
        k = (a, b) if a < b else (b, a)
        if k not in mid: mid[k] = len(W); W.append(tuple((np.array(W[a]) + np.array(W[b])) / 2))
        return mid[k]
    for a, b, c in T:
        ab, bc, ca = m(a, b), m(b, c), m(c, a); out += [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]
    return np.array(W), np.array(out)
for _ in range(int(sys.argv[5]) if len(sys.argv) > 5 else 0): W, T = subdivide(W, T)
n = len(W)
adj = [dict() for _ in range(n)]
for a, b, c in T:
    for x, y in ((a, b), (b, c), (c, a)):
        if x != y:
            w = float(np.linalg.norm(W[x] - W[y])); adj[x][y] = w; adj[y][x] = w
# components; one source per component: its lowest vertex (C has separate branch meshes)
comp = -np.ones(n, int); cid = 0
for s in range(n):
    if comp[s] >= 0: continue
    st = [s]; comp[s] = cid
    while st:
        x = st.pop()
        for y in adj[x]:
            if comp[y] < 0: comp[y] = cid; st.append(y)
    cid += 1
dist = np.full(n, np.inf); pq = []
main = np.bincount(comp).argmax(); MV = W[comp == main]
for c in range(cid):
    vs = np.where(comp == c)[0]
    if c == main: s = vs[np.argmin(W[vs, 1])]; d0 = 0.0
    else:   # a separate branch: start at its vertex nearest the main mesh, at that distance along the main mesh
        dm = np.array([np.linalg.norm(MV - W[v], axis=1).min() for v in vs]); s = vs[np.argmin(dm)]; d0 = 0.0
    dist[s] = d0; heapq.heappush(pq, (d0, s))
while pq:
    dd, x = heapq.heappop(pq)
    if dd > dist[x]: continue
    for y, w in adj[x].items():
        nd = dd + w
        if nd < dist[y]: dist[y] = nd; heapq.heappush(pq, (nd, y))
bandi = np.floor(dist / band).astype(int)
# connected pieces within each band
piece = -np.ones(n, int); pid = 0; pieces = []
for s in range(n):
    if piece[s] >= 0: continue
    st = [s]; piece[s] = pid; mem = [s]
    while st:
        x = st.pop()
        for y in adj[x]:
            if piece[y] < 0 and bandi[y] == bandi[s]: piece[y] = pid; st.append(y); mem.append(y)
    pieces.append(mem); pid += 1
ctr = np.array([W[m].mean(0) for m in pieces])
rad = None   # set once the links are known: the mean distance from the branch axis (parent -> node)
pb = np.array([bandi[m[0]] for m in pieces]); pc = np.array([comp[m[0]] for m in pieces])
# parent: the piece in band-1 that shares an edge
parent = -np.ones(pid, int); pband = -np.ones(pid, int)
for x in range(n):
    for y in adj[x]:
        a, b = piece[x], piece[y]
        if pb[b] < pb[a] and pb[b] > pband[a]: parent[a] = b; pband[a] = pb[b]
kids = [[] for _ in range(pid)]
for i, p in enumerate(parent):
    if p >= 0: kids[p].append(i)
def radius(i):
    X = W[pieces[i]] - ctr[i]
    if parent[i] >= 0: a = ctr[i] - ctr[parent[i]]
    elif kids[i]: a = ctr[kids[i][0]] - ctr[i]
    else: return np.linalg.norm(X, axis=1).mean()
    a = a / (np.linalg.norm(a) + 1e-12)
    return np.linalg.norm(X - np.outer(X @ a, a), axis=1).mean()
rad = np.array([radius(i) for i in range(pid)])
print(K, 'verts', n, 'components', cid, 'nodes', pid, 'roots', (parent < 0).sum(), 'max geodesic', dist[np.isfinite(dist)].max().round(2))
pickle.dump(dict(ctr=ctr, rad=rad, parent=parent, band=pb, comp=pc, size=np.array([len(m) for m in pieces])), open(f'shots/{K}_skel.pkl', 'wb'))
