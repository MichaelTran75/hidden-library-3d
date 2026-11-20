# the clock's connected parts (welded by position), each with its box, size and principal axes
import os, site, sys; sys.path.append(site.getusersitepackages()); sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'b747'))
import glb, numpy as np, json, pickle
g, M, imgs = glb.load(sys.argv[1])
open(os.path.join(os.path.dirname(sys.argv[2]), 'clock-tex.jpg'), 'wb').write(imgs[0])
P = np.vstack([m['P'] for m in M]); UV = np.vstack([m['UV'] for m in M]); N = np.vstack([m['N'] for m in M])
T = np.vstack([M[0]['T'], M[1]['T'] + len(M[0]['P'])])
# Z up in the file (node 0 turns it to Y up): keep the file's frame for the analysis, z up
roots = glb.components(P, T, tol=1e-4)
parts = []
for u in np.unique(roots):
    tri = T[roots == u]; vi = np.unique(tri); p = P[vi]
    c = p.mean(0); q = p - c; w, v = np.linalg.eigh(q.T @ q / len(q))
    parts.append({'tri': tri, 'vi': vi, 'lo': p.min(0), 'hi': p.max(0), 'c': c, 'ev': w, 'evec': v, 'n': len(tri)})
parts.sort(key=lambda d: -d['n'])
pickle.dump({'P': P, 'UV': UV, 'N': N, 'T': T, 'parts': parts}, open(sys.argv[2], 'wb'))
print(len(parts), 'parts;', len(T), 'triangles')
for i, d in enumerate(parts[:80]):
    s = d['hi'] - d['lo']; ax = d['evec'][:, 0]   # smallest-variance direction (a disc's axis)
    flat = np.sqrt(d['ev'][0] / max(1e-9, d['ev'][1]))
    print('%3d n %6d  c [%6.2f %6.2f %6.2f] size [%5.2f %5.2f %5.2f] axis [%5.2f %5.2f %5.2f] flat %.2f' % (i, d['n'], *d['c'], *s, *ax, flat))
