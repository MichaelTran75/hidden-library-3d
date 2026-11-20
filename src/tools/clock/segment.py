# the moving parts of the clock, as groups of its pieces (index-connected patches), by where each piece's centre lies
import os, site, sys; sys.path.append(site.getusersitepackages()); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, frame, json, pickle
D = frame.load(); F, T, troot = D['F'], D['T'], D['troot']
AX = {'dial': (0.35, 11.59), 'low': (0.419, 8.343), 'mid': (0.345, 11.575), 'top': (0.398, 14.708)}
VERGE = (-1.59, 0.40); HAMMER = (0.30, 28.68)
def r_ax(p, k): y, z = AX[k]; return np.hypot(p[..., 1] - y, p[..., 2] - z)
# per piece: centroid, extents
u, inv = np.unique(troot, return_inverse=True); n = len(u)
tc = F[T].mean(1)                                           # triangle centroids
cnt = np.bincount(inv, minlength=n); C = np.c_[[np.bincount(inv, tc[:, k], n) for k in range(3)]].T / cnt[:, None]
lo = np.full((n, 3), np.inf); hi = np.full((n, 3), -np.inf)
for k in range(3):
    np.minimum.at(lo[:, k], inv, F[T][:, :, k].min(1)); np.maximum.at(hi[:, k], inv, F[T][:, :, k].max(1))
X, Y, Z = C[:, 0], C[:, 1], C[:, 2]
# per piece, over its vertices: the largest and smallest distance from each axis (a ring's centre is not where it is)
Vt = F[T]   # (triangles, 3, 3)
def piece_max(vals, fn):
    out = np.full(n, -np.inf if fn is np.maximum else np.inf); fn.at(out, inv, vals); return out
def rmax(k): y, z = AX[k]; return piece_max(np.hypot(Vt[:, :, 1] - y, Vt[:, :, 2] - z).max(1), np.maximum)
rd, rl, rm, rt = rmax('dial'), rmax('low'), rmax('mid'), rmax('top')
dv = piece_max(np.hypot(Vt[:, :, 0] - VERGE[0], Vt[:, :, 1] - VERGE[1]).max(1), np.maximum)
X0, X1 = lo[:, 0], hi[:, 0]
# (the X tests below: the piece's whole extent inside the slab)
# the foliot bar's line through the verge, about 7.6° from Y (its own pose), measured below
ang = np.radians(float(sys.argv[1]) if len(sys.argv) > 1 else -7.6); ux, uy = np.sin(ang), np.cos(ang)
along = (X - VERGE[0]) * ux + (Y - VERGE[1]) * uy; perp = -(X - VERGE[0]) * uy + (Y - VERGE[1]) * ux
G = np.full(n, '', dtype=object)
def put(mask, name): G[(G == '') & mask] = name
rdmin = piece_max(np.hypot(Vt[:, :, 1] - AX['dial'][0], Vt[:, :, 2] - AX['dial'][1]).min(1), np.minimum)
put((X0 > -6.4) & (X1 < -4.55) & (rd < 4.6) & (rdmin < 3.8), 'dial')   # (a piece of the hand reaches toward the ring, the ring's pieces lie wholly beyond 3.8)                                   # hand, nut, washer
put((X0 > -4.25) & (X1 < -3.45) & (rd < 2.15), 'dial')                                    # the star wheel
put((X0 > -4.9) & (X1 < -2.95) & (rd < 0.42), 'dial')                                    # its pipe
put((X0 > -3.62) & (X1 < -2.95) & (rd < 3.0) & (rl > 0.9), 'dial')                       # the hour wheel
put((X0 > -3.65) & (X1 < -2.9) & (rl < 0.9), 'low')                                     # the front pinion
put((X0 > 0.42) & (X1 < 0.98) & (rl < 2.98) & (rm > 0.62), 'low')                        # the great wheel
put((X0 > -2.95) & (X1 < 2.3) & (rl < 0.33), 'low')                                     # its arbor
put((X0 > -0.06) & (X1 < 0.5) & (rm < 3.0) & (rt > 0.6) & (rl > 0.62), 'mid')          # the second wheel
put((X0 > 0.42) & (X1 < 1.65) & (rm < 0.62), 'mid')                                     # its pinion
put((X0 > -2.95) & (X1 < 2.3) & (rm < 0.32), 'mid')                                     # its arbor
put((X0 > -1.45) & (X1 < -0.1) & (rt < 3.38) & (dv > 0.42), 'top')                     # the crown wheel
put((X0 > 0.42) & (X1 < 1.2) & (rt < 0.58), 'top')                                      # its pinion
put((X0 > -1.4) & (X1 < 2.3) & (rt < 0.32), 'top')                                      # its arbor
put((dv < 0.42) & (Z > 10.6) & (Z < 24.2), 'verge')                                   # the verge, its pallets
put((Z > 21.35) & (Z < 23.1) & (np.abs(perp) < 0.5) & (np.abs(along) < 7.3), 'verge') # the foliot
put((Z > 19.8) & (Z < 21.7) & (np.abs(along) > 4.3) & (np.abs(along) < 7.4) & (np.abs(perp) < 0.8), 'verge')   # its weights
# the hammer: its head and its arm, outside the bell (the bell turned about its vertical axis at X 0.22, Y 0.20)
BELL = (0.22, 0.20); bz = np.array([24.3, 24.6, 26.15, 27.75, 28.2, 28.4]); br = np.array([3.4, 3.3, 2.84, 2.19, 1.5, 0.0])
Vz = Vt[:, :, 2]; Vr = np.hypot(Vt[:, :, 0] - BELL[0], Vt[:, :, 1] - BELL[1]); out_of_bell = (Vr - np.interp(Vz, bz, br, left=3.4, right=0.0)).min(1)
zmin = piece_max(Vz.min(1), np.minimum); oob = piece_max(out_of_bell, np.minimum)
put((zmin > 24.6) & (oob > 0.12) & (Y > 1.1) & (X > -1.6) & (X < 2.6) & (Z < 30.5), 'hammer')
G[G == ''] = 'static'
rc = np.hypot(Y - AX['dial'][0], Z - AX['dial'][1]); hp = (X > -5.3) & (X < -4.85) & (rc < 3.9)
print('hand-slab pieces:', hp.sum(), 'triangles', int(cnt[hp].sum()), 'groups', dict(zip(*np.unique(G[hp], return_counts=True))))
bad = hp & (G != 'dial'); print('not in dial (X0, X1, rd, rdmin, tris):', [(round(float(X0[i]), 2), round(float(X1[i]), 2), round(float(rd[i]), 2), round(float(rdmin[i]), 2), int(cnt[i])) for i in np.where(bad)[0]][:25])
vz = (G == 'verge') & (lo[:, 2] < 19.4) & (hi[:, 2] > 18.6)
print('verge pieces at the top plate:', [(int(i), np.round(lo[i], 2).tolist(), np.round(hi[i], 2).tolist(), int(cnt[i])) for i in np.where(vz)[0]][:20])
names, counts = np.unique(G, return_counts=True)
tri_count = {nm: int(cnt[G == nm].sum()) for nm in names}
print('pieces by group:', dict(zip(names, counts)), 'triangles:', tri_count)
pickle.dump({'G': G, 'inv': inv, 'C': C}, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'groups.pkl'), 'wb'))
