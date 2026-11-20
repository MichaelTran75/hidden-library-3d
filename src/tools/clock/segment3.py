# the clock's finer parts, cut from what segment.py made (groups.pkl): the hand and the trip star apart from the hour wheel,
# the trip lever, the wire, the hammer's tail, the bell, the verge's two pallets, the dial ring's face. Then groups.bin, one
# byte a triangle.
import os, site, sys; sys.path.append(site.getusersitepackages()); HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import numpy as np, frame, pickle
D = frame.load(); F, T = D['F'], D['T']
Gd = pickle.load(open(os.path.join(HERE, 'groups.pkl'), 'rb')); G = Gd['G'].copy(); inv = Gd['inv']
n = len(G); Vt = F[T]
def pmax(vals): out = np.full(n, -np.inf); np.maximum.at(out, inv, vals); return out
def pmin(vals): out = np.full(n, np.inf); np.minimum.at(out, inv, vals); return out
X0, X1 = pmin(Vt[:, :, 0].min(1)), pmax(Vt[:, :, 0].max(1)); Y0, Y1 = pmin(Vt[:, :, 1].min(1)), pmax(Vt[:, :, 1].max(1)); Z0, Z1 = pmin(Vt[:, :, 2].min(1)), pmax(Vt[:, :, 2].max(1))
def put(mask, name, src='static'): G[(G == src) & mask] = name
# ---- on the hand's arbor (Y 0.35, Z 11.59): the hand with its nut and washer in front, the 12-tooth star behind it, the
# hour wheel and the pipe they sit on
rd = pmax(np.hypot(Vt[:, :, 1] - 0.35, Vt[:, :, 2] - 11.59).max(1))
put(X1 < -4.55, 'hand', 'dial')
put((X0 > -4.25) & (X1 < -3.45) & (rd < 2.15) & (rd > 0.5), 'star', 'dial')
# ---- the trip lever: a strip from its foot on the bracket left of the star (Y 1.8), under the star, out through the dial's
# ring to the wire (Y -8.1): its middle along Z = 9.78 + 0.192 (1.0 - Y); in front of the front plate
zl = 9.78 + 0.192 * (1.0 - Vt[:, :, 1]); off = pmax(np.abs(Vt[:, :, 2] - zl).max(1))
put((Y0 > -8.3) & (Y1 < 1.75) & (off < 0.55) & (X0 > -4.4) & (X1 < -2.75), 'lever')
put((Y0 > 0.2) & (Y1 < 1.9) & (Z0 > 8.8) & (Z1 < 10.2) & (X0 > -4.3) & (X1 < -3.9), 'lever')   # its bend down to the bracket
# its front face whole (one piece, down the foot to the pin it turns on: Y 1.236, Z 8.398), and the foot's other faces
put((Y0 > -8.3) & (Y1 < 1.95) & (Z0 > 7.9) & (Z1 < 12.3) & (X0 > -4.45) & (X1 < -2.9) & (np.arange(n) == 2733), 'lever')
put((Y0 > 0.55) & (Y1 < 1.95) & (Z0 > 7.9) & (Z1 < 10.2) & (X0 > -4.5) & (X1 < -3.98), 'lever')
# ---- the wire: from the lever's end up to the hammer's tail, slanting back (X -2.95 at Z 11.6 to X 1.05 at Z 32.6) and in
zc = Vt[:, :, 2]; xw = -2.95 + (zc - 11.6) * (4.0 / 21.0); yw = -7.95 + (zc - 11.6) * (0.85 / 21.0)
dw = pmax(np.hypot(Vt[:, :, 0] - xw, Vt[:, :, 1] - yw).max(1))
put((Z0 > 11.75) & (Z1 < 33.3) & (dw < 0.45), 'wire')
# ---- the hammer's tail: the arm from its pin (Y -0.27, Z 29.40) up and out to where the wire hangs; the hoop and the pin stay
put((Z0 > 28.95) & (Y1 < -0.3) & (Y0 > -8.0) & (X0 > 0.6), 'hammer')
put(np.isin(np.arange(n), [3496, 3407]), 'hammer')   # (the arm's other face, and its middle at the pin: pieces that run from the head's side to the tail's)
# ---- the bell: the shell round its upright axis (X 0.22, Y 0.20), its lip at Z 24.4, its shoulder and crown above
bz = np.array([24.3, 24.6, 26.15, 27.75, 28.2, 28.4]); br = np.array([3.4, 3.3, 2.84, 2.19, 1.5, 0.0])
Vr = np.hypot(Vt[:, :, 0] - 0.22, Vt[:, :, 1] - 0.20); dev = Vr - np.interp(Vt[:, :, 2], bz, br, left=3.4, right=0.0)
put((Z0 > 24.15) & (Z1 < 28.55) & (pmax(np.abs(dev).max(1)) < 0.3), 'bell')
put(np.isin(np.arange(n), [3552, 3102]), 'bell')   # (its shoulder, and the plate inside under it: two pieces of their own)
# ---- the verge's pallets: the flag at the top of the crown wheel (segment.py took most of it for the wheel's), the one at its foot
UP = [2118, 2121, 2142, 2123, 2141, 2122, 1750]; LO = [2669, 2688, 2932, 2967, 2969]
G[np.isin(np.arange(n), UP + LO)] = 'verge'
# ---- faces that segment.py left standing though they belong to a moving part (a part is many pieces: each of its faces is
# its own; one that reaches a little outside the part's slab was passed over). Found by ghost.py: the pieces left standing
# that lie on a moving part.
def add(ids, name): G[np.isin(np.arange(n), ids)] = name
add([1877, 3720, 1162, 1966, 3721, 216, 3, 277], 'dial')                                        # the hour wheel's spokes' sides
add([5066, 5063], 'hand')                                                               # the hand's very tip
add([3052, 3054, 5, 7, 2995, 2935, 2999, 2992, 3013, 4040, 4049, 2966, 2986, 4043, 4003, 0, 4037, 8, 4018, 9, 2919, 2997, 2934, 3005, 4012, 4039, 4046, 4017], 'low')               # the great wheel's front face, strips of its arbor and pinion
add([3068, 2863, 2850, 2692, 2848, 2840, 2897, 2895, 2858, 2861, 2899, 2837, 2839, 2847, 2841, 2890, 2896, 2908, 2829, 2834, 2831, 2833], 'mid')         # the second wheel's front face, its pinion's leaves
add([1843, 2039, 1850, 1562, 2202, 1539, 1836, 1566, 1854, 1565, 1851, 1551, 2435, 1555, 1883, 1535, 1561, 1577, 1586], 'top')                                                    # strips of the crown wheel's arbor
add([3372, 3543, 3642, 3532, 3539, 3542], 'hammer')                                                       # its eye on the pin
add([2513, 2501, 2487, 2537, 2514], 'wire')                                             # its lowest stretch, down to the lever
# the verge: the three leaf-shaped arms under the foliot (one surface with the foliot's bar), a weight's underside, and the
# faces of the block the foliot sits on
add([1743, 1754, 5308, 5390, 727, 3120, 3122, 3121, 3210, 5523, 5554, 5524, 5394, 5391, 5314, 1751, 3119], 'verge')
dvg = pmax(np.hypot(Vt[:, :, 0] + 1.59, Vt[:, :, 1] - 0.40).max(1)); put((dvg < 0.9) & (Z0 > 19.9) & (Z1 < 21.7), 'verge')
# ---- the dial ring's face (the numerals): two pieces; make.mjs gives it a picture of its own (ring.py)
add([2982, 5146, 4961], 'ring')
# the rest of the ring (its back, its rims): a part of its own, so that make.mjs does not thin it (thinned, its rims'
# triangles come through the face)
rr = np.hypot(Vt[:, :, 1] - 0.335, Vt[:, :, 2] - 11.594); put((pmin(rr.min(1)) > 4.5) & (pmax(rr.max(1)) < 6.45) & (X1 < -4.2) & (X0 > -5.3), 'ringbody')
# and the face's stray bits (single triangles and small patches lying on it, looking forward): onto the face's picture too
V64 = Vt.astype(np.float64); nrm = np.cross(V64[:, 1] - V64[:, 0], V64[:, 2] - V64[:, 0]); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
nx = np.zeros(n); np.add.at(nx, inv, nrm[:, 0]); nx /= np.maximum(np.bincount(inv, minlength=n), 1)
G[(G == 'ringbody') & (nx < -0.5) & (pmin(rr.min(1)) > 4.55) & (pmax(rr.max(1)) < 6.4) & (X0 > -4.80) & (X1 < -4.45)] = 'ring'
names, counts = np.unique(G, return_counts=True); cnt = np.bincount(inv, minlength=n)
print('pieces by group:', dict(zip(names, counts)), 'triangles:', {nm: int(cnt[G == nm].sum()) for nm in names})
ID = {'static': 0, 'dial': 1, 'low': 2, 'mid': 3, 'top': 4, 'verge': 5, 'hammer': 6, 'hand': 7, 'star': 8, 'lever': 9, 'wire': 10, 'bell': 11, 'ring': 12, 'ringbody': 13}
open(os.path.join(HERE, 'groups.bin'), 'wb').write(bytes(ID[g] for g in G[inv]))
pickle.dump({'G': G, 'inv': inv, 'C': Gd['C']}, open(os.path.join(HERE, 'groups3.pkl'), 'wb'))
