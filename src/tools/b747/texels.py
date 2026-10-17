import os, site, sys; sys.path.append(site.getusersitepackages()); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # (numpy under -I; the modules beside this one)
# every texel of the livery that lies on a part, with the 3D point it paints (UV triangles rasterized, barycentric)
import glb, numpy as np
from PIL import Image
def texels(m, T, tex, step=1):
    H, W = tex.shape[:2]; P, UV = m['P'], m['UV']; outP, outC = [], []
    for tri in T:
        uv = UV[tri] % 1.0; px = uv[:, 0] * W; py = uv[:, 1] * H   # (glTF: v down the image)
        x0, x1 = int(np.floor(px.min())), int(np.ceil(px.max())); y0, y1 = int(np.floor(py.min())), int(np.ceil(py.max()))
        if x1 - x0 > W * 0.9 or y1 - y0 > H * 0.9: continue   # (a triangle wrapping across the texture's edge)
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1, step) + 0.5, np.arange(y0, y1 + 1, step) + 0.5)
        a, b, c = np.stack([px, py], 1); v0, v1 = b - a, c - a; den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-9: continue
        dx, dy = xs - a[0], ys - a[1]; l1 = (dx * v1[1] - v1[0] * dy) / den; l2 = (v0[0] * dy - dx * v0[1]) / den; l0 = 1 - l1 - l2
        ins = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        if not ins.any(): continue
        L = np.stack([l0[ins], l1[ins], l2[ins]], 1); pos = L @ P[tri]
        ix = np.clip(xs[ins].astype(int), 0, W - 1); iy = np.clip(ys[ins].astype(int), 0, H - 1)
        outP.append(pos); outC.append(tex[iy, ix])
    return np.concatenate(outP), np.concatenate(outC)
