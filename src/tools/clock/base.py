# shared by the measuring scripts: the clock's triangles in its own frame (frame.py), each one's part (segment3.py), helpers
import os, site, sys; sys.path.append(site.getusersitepackages()); HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import numpy as np, pickle, frame
from PIL import Image, ImageDraw
D = frame.load(); F, T = D['F'], D['T']
Gd = pickle.load(open(os.path.join(HERE, 'groups3.pkl'), 'rb')); G = Gd['G']; inv = Gd['inv']   # G: each piece's part; inv: each triangle's piece
n = len(G); Vt = F[T]; cnt = np.bincount(inv, minlength=n); part = G[inv]
def pmax(vals): out = np.full(n, -np.inf); np.maximum.at(out, inv, vals); return out
def pmin(vals): out = np.full(n, np.inf); np.minimum.at(out, inv, vals); return out
X0, X1 = pmin(Vt[:, :, 0].min(1)), pmax(Vt[:, :, 0].max(1)); Y0, Y1 = pmin(Vt[:, :, 1].min(1)), pmax(Vt[:, :, 1].max(1)); Z0, Z1 = pmin(Vt[:, :, 2].min(1)), pmax(Vt[:, :, 2].max(1))
def dense(tris, k=8):   # points over each triangle
    w = np.array([(i / k, j / k, 1 - i / k - j / k) for i in range(k + 1) for j in range(k + 1 - i)])
    return np.einsum('wk,tkc->twc', w, tris).reshape(-1, 3)
def tris_of(name): return Vt[part == name]
def rot_x(p, c, a):   # points turned a about +X through (Y, Z) = c
    return np.c_[p[:, 0], c[0] + (p[:, 1] - c[0]) * np.cos(a) - (p[:, 2] - c[1]) * np.sin(a), c[1] + (p[:, 1] - c[0]) * np.sin(a) + (p[:, 2] - c[1]) * np.cos(a)]
def turn(P, c, axis, a):   # points turned a about an axis through c
    k = np.array(axis, float); k /= np.linalg.norm(k); v = P - c; return c + v * np.cos(a) + np.cross(k, v) * np.sin(a) + np.outer(v @ k, k) * (1 - np.cos(a))
def draw(sets, name, ax=(1, 2), scale=120, flip=(False, False), box=None, grid=1.0):
    # sets: [(triangles, colour)] as wire; ax: the coordinates across and up; flip across (the front view: Y flipped)
    allp = np.vstack([t.reshape(-1, 3) for t, _ in sets]); a, b = ax
    l = np.array([allp[:, a].min(), allp[:, b].min()]) - 0.2; h = np.array([allp[:, a].max(), allp[:, b].max()]) + 0.2
    if box: l = np.array(box[:2], float); h = np.array(box[2:], float)
    W = int((h[0] - l[0]) * scale) + 1; H = int((h[1] - l[1]) * scale) + 1; img = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(img)
    def px(p): x = (p[a] - l[0]) * scale; y = (p[b] - l[1]) * scale; return (W - x if flip[0] else x, y if flip[1] else H - y)
    for v in np.arange(np.ceil(l[0] / grid) * grid, h[0], grid):
        X = (v - l[0]) * scale; X = W - X if flip[0] else X; d.line((X, 0, X, H), fill=(225, 225, 240)); d.text((X + 2, 2), '%g' % v, fill=(0, 0, 160))
    for v in np.arange(np.ceil(l[1] / grid) * grid, h[1], grid):
        Y = (v - l[1]) * scale; Y = Y if flip[1] else H - Y; d.line((0, Y, W, Y), fill=(240, 225, 225)); d.text((2, Y - 11), '%g' % v, fill=(160, 0, 0))
    for tris, col in sets:
        for t in tris:
            if box and not ((t[:, a].max() > l[0]) and (t[:, a].min() < h[0]) and (t[:, b].max() > l[1]) and (t[:, b].min() < h[1])): continue
            p = [px(v) for v in t]; d.line(p + [p[0]], fill=col)
    img.save(name); print(name, img.size)
