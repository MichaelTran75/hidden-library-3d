# the clock's mechanism measured on the model: what lib3d/world/clock.js (CK.axis, CK.esc, CK.strike) and make.mjs (the
# pivots) are set from. Frame: X along the arbors (the dial at −X), Y to the viewer's left, Z up; clock.js: (X, Z, −Y).
import os, sys, math; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from base import *
deg = np.degrees
# ---- 1. the wheels: the middle of each one's teeth (the pivot), its plane (the axis it turns about)
def circle(yy, zz):
    sol = np.linalg.lstsq(np.c_[yy, zz, np.ones(len(yy))], yy ** 2 + zz ** 2, rcond=None)[0]; return sol[0] / 2, sol[1] / 2, math.sqrt(sol[2] + (sol[0] ** 2 + sol[1] ** 2) / 4)
def tips(q, c, nsec=720, keep=0.3):   # the farthest point of each sector about c, the outer share of them: the teeth's tips
    a = ((deg(np.arctan2(q[:, 1] - c[0], q[:, 2] - c[1])) % 360) * nsec / 360).astype(int) % nsec; r = np.hypot(q[:, 1] - c[0], q[:, 2] - c[1])
    far = np.full(nsec, -1.0); idx = np.zeros(nsec, int); o = np.argsort(r); far[a[o]] = r[o]; idx[a[o]] = o
    ok = far > 0; sel = ok & (far >= np.quantile(far[ok], 1 - keep)); return q[idx[sel]]
for g, c0, x0, x1, nm in (('dial', (0.35, 11.59), -3.54, -2.94, 'hour wheel'), ('low', (0.419, 8.343), 0.44, 0.94, 'great wheel'), ('mid', (0.345, 11.575), 0.10, 0.50, 'second wheel'), ('top', (0.398, 14.708), -0.75, -0.22, 'crown wheel')):
    q = dense(tris_of(g), 6); q = q[(q[:, 0] >= x0) & (q[:, 0] < x1)]; c = c0
    for _ in range(4): tp = tips(q[np.hypot(q[:, 1] - c[0], q[:, 2] - c[1]) > 2.0], c); cy, cz, R = circle(tp[:, 1], tp[:, 2]); c = (cy, cz)
    rim = q[np.hypot(q[:, 1] - c[0], q[:, 2] - c[1]) > 2.2]; w, v = np.linalg.eigh(np.cov((rim - rim.mean(0)).T)); nrm = v[:, 0] * np.sign(v[0, 0])
    print('%-12s teeth middle (Y %.3f, Z %.3f) at X %.2f, tips radius %.3f; plane normal (%.4f, %.4f, %.4f) -> clock.js axis [%.4f, %.4f, %.4f]' % (nm, cy, cz, (x0 + x1) / 2, R, *nrm, nrm[0], nrm[2], -nrm[1]))
# ---- 2. the verge: its rod's middle by height (its axis leans), the foliot, the two pallets
vg = tris_of('verge'); pts = dense(vg, 5); rod = (np.hypot(pts[:, 0] + 1.59, pts[:, 1] - 0.40) < 0.34) & (pts[:, 2] > 12.0) & (pts[:, 2] < 16.8); cen = []   # (the bare rod, between the pallets)
for z in np.arange(12.0, 16.8, 0.4):
    m = rod & (pts[:, 2] >= z) & (pts[:, 2] < z + 0.4)
    if m.sum() > 30: s = pts[m]; cen.append((z + 0.2, (s[:, 0].min() + s[:, 0].max()) / 2, (s[:, 1].min() + s[:, 1].max()) / 2))
cen = np.array(cen); kx = np.polyfit(cen[:, 0], cen[:, 1], 1); ky = np.polyfit(cen[:, 0], cen[:, 2], 1); axis_at = lambda z: np.array([np.polyval(kx, z), np.polyval(ky, z)])
print('verge axis: X = %.3f %+.4f (Z - 14.7), Y = %.3f %+.4f (Z - 14.7): leans %.2f deg -> clock.js axis [%.4f, 1, %.4f], pivot (%.3f, 14.7, %.3f)' % (np.polyval(kx, 14.7), kx[0], np.polyval(ky, 14.7), ky[0], deg(math.hypot(kx[0], ky[0])), kx[0], -ky[0], np.polyval(kx, 14.7), -np.polyval(ky, 14.7)))
UP = [2118, 2121, 2142, 2123, 2141, 2122, 1750]; LO = [2669, 2688, 2932, 2967, 2969]; dirs = {}
for name, ids, zmid in (('upper', UP, 17.65), ('lower', LO, 11.3)):
    q = dense(Vt[np.isin(inv, ids)], 6); xy = (q[:, :2] - axis_at(zmid)).astype(np.float64); w, v = np.linalg.eigh(np.cov((xy - xy.mean(0)).T)); u = v[:, 1] * np.sign(v[0, 1]); nr = np.array([-u[1], u[0]]); o = xy[:, 0] * nr[0] + xy[:, 1] * nr[1]
    dirs[name] = deg(math.atan2(u[1], u[0])); print('%s pallet: its plate %.1f deg from straight at the wheel; across it %.3f..%.3f from the axis; reach %.3f' % (name, dirs[name], o.min(), o.max(), np.hypot(xy[:, 0], xy[:, 1]).max()))
print('pallets %.1f deg apart (beta %.1f); the verge\'s middle %.1f deg back from the model\'s pose (mid)' % (dirs['upper'] - dirs['lower'], (dirs['upper'] - dirs['lower']) / 2, (dirs['upper'] + dirs['lower']) / 2))
# the crown wheel's tips: their angles past the top (toward +Y), how far they reach toward the verge
cr = tris_of('top'); A = (0.398, 14.708); cp = dense(cr, 6); r = np.hypot(cp[:, 1] - A[0], cp[:, 2] - A[1]); ring = (r > 2.7) & (cp[:, 0] < -0.3)
ang = deg(np.arctan2(cp[ring, 1] - A[0], cp[ring, 2] - A[1])) % 360; NB = 1440; xm = np.full(NB, 9.0); np.minimum.at(xm, (ang * NB / 360).astype(int) % NB, cp[ring, 0])
tp = [i * 360 / NB for i in range(NB) if xm[i] < -1.0 and xm[i] == min(xm[(i + j) % NB] for j in range(-20, 21))]
print('crown wheel: %d tips, at %.2f deg past the top (mod 14.4: tip0); they reach X %.2f at the top, %.2f at the foot; the verge\'s axis there X %.2f, %.2f (d: %.2f, %.2f)' % (len(tp), np.median(np.array(tp) % 14.4), np.median([xm[int(t * 4)] for t in tp if t < 30 or t > 330]), np.median([xm[int(t * 4)] for t in tp if 150 < t < 210]), axis_at(17.9)[0], axis_at(11.5)[0], np.median([xm[int(t * 4)] for t in tp if t < 30 or t > 330]) - axis_at(17.9)[0], np.median([xm[int(t * 4)] for t in tp if 150 < t < 210]) - axis_at(11.5)[0]))
# ---- 3. the strike: the hammer on its pin over the bell, the wire, the lever, the star as a cam
C = np.array([0.35, 11.59]); PL = np.array([1.236, 8.398]); PH = np.array([-0.27, 29.40])   # the hand's arbor, the lever's pin, the hammer's (Y, Z)
st = tris_of('star'); lv = tris_of('lever'); hm = tris_of('hammer'); bl = tris_of('bell'); wr = tris_of('wire')
bp = dense(bl, 5); BX, BY = 0.220, 0.198; zb0, dz = 24.3, 0.05; rout = np.zeros(100); np.maximum.at(rout, np.clip(((bp[:, 2] - zb0) / dz).astype(int), 0, 99), np.hypot(bp[:, 0] - BX, bp[:, 1] - BY))
for i in range(1, 100):
    if rout[i] == 0: rout[i] = rout[i - 1]
hp = dense(hm, 6); head = hp[hp[:, 1] > 3.0]
def gap(eta):
    q = rot_x(head, PH, eta); k = (q[:, 2] - zb0) / dz; ok = (k >= 2) & (k < 70); return float((np.hypot(q[ok, 0] - BX, q[ok, 1] - BY) - rout[k[ok].astype(int)]).min())
lo, hi = np.radians(-4), np.radians(6)
for _ in range(30):
    mid = (lo + hi) / 2
    if gap(mid) > 0: hi = mid
    else: lo = mid
hc = head.mean(0); print('hammer: its head touches the bell turned %.2f deg from the model\'s pose (bell); the head\'s middle %.2f out from the pin, %.2f to the side' % (deg(hi), math.hypot(hc[1] - PH[0], hc[2] - PH[1]), hc[1] - PH[0]))
wp = dense(wr, 4); B = wp[wp[:, 2] < wp[:, 2].min() + 0.25].mean(0); TP = wp[wp[:, 2] > wp[:, 2].max() - 0.25].mean(0); L = float(np.linalg.norm(TP - B))
print('wire: lower hook (%.3f, %.3f, %.3f), upper (%.3f, %.3f, %.3f), %.3f long -> clock.js: the wire\'s pivot [%.3f, %.3f, %.3f], T [%.3f, %.3f, %.3f]' % (*B, *TP, L, B[0], B[2], -B[1], TP[0], TP[2], -TP[1]))
def eta_of(lam):
    b = rot_x(B[None], PL, lam)[0]; f = lambda e: np.linalg.norm(rot_x(TP[None], PH, e)[0] - b) - L; e = 0.0
    for _ in range(20): e -= f(e) * 2e-5 / (f(e + 1e-5) - f(e - 1e-5))
    return e
print('hammer turn for the lever\'s: %.3f to 1 (gear)' % (eta_of(np.radians(5)) / np.radians(5)))
# the star's shadow from the front as a picture; the lever's points behind its body (its tab) against it
RES, HALF = 0.004, 2.3; N = int(2 * HALF / RES); im = Image.new('L', (N, N), 0); dr = ImageDraw.Draw(im)
for t in st: dr.polygon([((p[1] - C[0] + HALF) / RES, (p[2] - C[1] + HALF) / RES) for p in t], fill=255)
bm = np.array(im) > 0; lp = dense(lv, 6); tab = lp[(lp[:, 0] > -3.88) & (np.hypot(lp[:, 1] - C[0], lp[:, 2] - C[1]) < 2.6)]
def meets(phi, lam):
    q = rot_x(rot_x(tab, PL, lam), C, -phi); iy = ((q[:, 1] - C[0] + HALF) / RES).astype(int); iz = ((q[:, 2] - C[1] + HALF) / RES).astype(int); ok = (iy >= 0) & (iy < N) & (iz >= 0) & (iz < N); return bm[iz[ok], iy[ok]].any()
def press(phi, top):   # the least the lever is pressed down with the star turned phi
    lam = top
    while meets(phi, lam) and lam < 0.4: lam += np.radians(0.25)
    if lam == top: return top
    a, b = lam - np.radians(0.25), lam
    for _ in range(12):
        m = (a + b) / 2
        if meets(phi, m): a = m
        else: b = m
    return b
top = hi / (eta_of(np.radians(5)) / np.radians(5)); phis = np.arange(0, 360, 0.1); cam = deg(np.array([press(np.radians(p), top) for p in phis]))
j = np.where(np.diff(cam) < -2.0)[0]; rel = phis[j + 1]; rows = []
for a, b in zip(j, np.r_[j[1:], j[0] + len(phis)]): seg = cam[np.arange(a + 1, b + 1) % len(phis)]; rows.append(np.interp(np.arange(0, 30.001, 0.25), np.linspace(0, 30, len(seg)), seg))
med = np.median(np.array(rows), 0); sm = med.copy()
for i in range(2, len(med) - 2): sm[i] = med[i - 2:i + 3].mean()
print('star: %d teeth let the lever go at %s (mod 30: median %.2f); in the model the hand is then %.1f min past the hour -> star0 = %.2f deg' % (len(rel), rel.round(1).tolist(), np.median(rel % 30), ((np.median(rel % 30) + 44.27) % 30) * 2, (np.median(rel % 30) + 44.27) % 30))
print('cam (the lever\'s turn for each degree of the star since a tooth let go):', ', '.join('%.2f' % v for v in sm[::4]))
