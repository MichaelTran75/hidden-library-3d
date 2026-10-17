import os, site, sys; sys.path.append(site.getusersitepackages()); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # (numpy under -I; the modules beside this one)
# measurements of the 747-8i GLB (glTF space: y up, x span (+x = left wing? checked below), z along the body, nose +z)
import glb, numpy as np, json
from PIL import Image
g, M, imgs = glb.load(sys.argv[1])
if not os.path.exists('tex.jpg'): open('tex.jpg', 'wb').write(imgs[0])   # (the paint, taken out of the GLB)
TEX = np.asarray(Image.open('tex.jpg').convert('RGB')).astype(np.float64) / 255
def parts(m):
    r = glb.components(m['P'], m['T']); out = []
    for u in np.unique(r):
        T = m['T'][r == u]; P = m['P'][np.unique(T)]
        out.append({'T': T, 'lo': P.min(0), 'hi': P.max(0), 'n': len(T)})
    return out
def pick(m, cond):
    return [p for p in parts(m) if cond(p['lo'], p['hi'], p['n'])]
def slice_tris(m, T, axis, v):
    # intersection of triangles T with the plane coord[axis] = v: points (3D) with uv
    P, UV = m['P'], m['UV']; pts = []
    for tri in T:
        a = P[tri][:, axis] - v
        if (a > 0).all() or (a < 0).all(): continue
        seg = []
        for i in range(3):
            j = (i + 1) % 3; ai, aj = a[i], a[j]
            if ai == 0: seg.append((P[tri[i]], UV[tri[i]]))
            elif ai * aj < 0:
                t = ai / (ai - aj); seg.append((P[tri[i]] + (P[tri[j]] - P[tri[i]]) * t, UV[tri[i]] + (UV[tri[j]] - UV[tri[i]]) * t))
        pts += seg
    return pts
def tex_at(uv):
    u, v = uv[0] % 1, uv[1] % 1; x = min(1023, int(u * 1024)); y = min(1023, int(v * 1024)); return TEX[y, x]
fus_mesh = [m for m in M if m['i'] == 2][0]
fus = pick(fus_mesh, lambda lo, hi, n: n > 1000)[0]
fin = pick(fus_mesh, lambda lo, hi, n: hi[1] > 14)[0]
stabs = pick(fus_mesh, lambda lo, hi, n: lo[1] > 2.5 and hi[1] < 4.4 and n > 50)
fair = pick(fus_mesh, lambda lo, hi, n: n == 443)[0]
wing_mesh = [m for m in M if m['i'] == 1][0]
wings = pick(wing_mesh, lambda lo, hi, n: hi[0] - lo[0] > 30)
print('fuselage', fus['lo'], fus['hi'], 'fin', fin['lo'], fin['hi'], 'stabs', [ (s['lo'], s['hi']) for s in stabs], 'wings', [(w['lo'], w['hi']) for w in wings])
OUT = {}
# ---- fuselage: cross-sections every 0.5 m: top, bottom, half width, height of the widest point, r(theta) about the section's middle
secs = []
for z in np.arange(-37.9, 35.91, 0.5):
    pts = slice_tris(fus_mesh, fus['T'], 2, z)
    if len(pts) < 6: continue
    X = np.array([p[0] for p in pts]); xs, ys = X[:, 0], X[:, 1]
    top, bot = ys.max(), ys.min(); hw = np.abs(xs).max(); yw = ys[np.argmax(np.abs(xs))]
    secs.append({'z': round(float(z), 2), 'top': round(float(top), 3), 'bot': round(float(bot), 3), 'hw': round(float(hw), 3), 'yw': round(float(yw), 3), 'xc': round(float((xs.max() + xs.min()) / 2), 3), 'pts': [[round(float(p[0][0]), 3), round(float(p[0][1]), 3), [round(c, 3) for c in tex_at(p[1])]] for p in pts]})
OUT['fus'] = secs
# ---- lifting surfaces: slices across the span (x for wings and stabilisers; y for the fin): leading and trailing edge, thickness, mean height
def surf(mesh, part, axis, vals):
    rows = []
    for v in vals:
        pts = slice_tris(mesh, part['T'], axis, v)
        if len(pts) < 4: continue
        X = np.array([p[0] for p in pts])
        zl, zt = X[:, 2].max(), X[:, 2].min()   # leading edge toward +z (the nose)
        other = 1 if axis == 0 else 0           # thickness across: y for wings/stabs, x for the fin
        # thickness: at each chord position the spread of the other coordinate
        ch = zl - zt; thick = 0; mid = 0
        for f in np.linspace(0.05, 0.95, 19):
            zz = zt + f * ch; near = X[np.abs(X[:, 2] - zz) < ch * 0.06]
            if len(near) >= 2: t = near[:, other].max() - near[:, other].min(); 
            else: continue
            if t > thick: thick = t; mid = (near[:, other].max() + near[:, other].min()) / 2
        yle = X[np.argmax(X[:, 2])][other]; yte = X[np.argmin(X[:, 2])][other]
        rows.append({'s': round(float(v), 3), 'le': round(float(zl), 3), 'te': round(float(zt), 3), 'thick': round(float(thick), 3), 'mid': round(float(mid), 3), 'yle': round(float(yle), 3), 'yte': round(float(yte), 3),
                     'col': [round(c, 3) for c in np.mean([tex_at(p[1]) for p in pts], axis=0)]})
    return rows
wR = [w for w in wings if w['lo'][0] > 0][0]
OUT['wing'] = surf(wing_mesh, wR, 0, np.arange(2.4, 34.37, 0.8))
sR = [s for s in stabs if s['lo'][0] > 0][0]
OUT['stab'] = surf(fus_mesh, sR, 0, np.arange(0.8, 11.03, 0.5))
OUT['fin'] = surf(fus_mesh, fin, 1, np.arange(4.6, 14.59, 0.5))
json.dump(OUT, open('measure.json', 'w'))
for s in secs[::8]: print('z %6.1f top %6.2f bot %6.2f hw %5.2f yw %5.2f xc %5.2f n %d' % (s['z'], s['top'], s['bot'], s['hw'], s['yw'], s['xc'], len(s['pts'])))
print('wing'); [print(r) for r in OUT['wing'][::4]]
print('stab'); [print(r) for r in OUT['stab'][::4]]
print('fin'); [print(r) for r in OUT['fin'][::4]]
