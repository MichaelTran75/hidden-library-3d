# the escapement as the page moves it (clock.js ckEscSetup / ckBeat, ported), drawn on the model's own meshes from above:
# the top of the crown wheel with the upper pallet, its foot with the lower one, through two beats -> esc-film.png.
# A check after any change to CK.esc: each tooth's tip must ride its pallet's face and leave at its end.
import os, sys, math; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from base import *
K = dict(d=0.40, off=0.08, reach=0.54, R=3.2, tip0=math.radians(8.9), y0=0.04, beta=math.radians(11.2), mid=math.radians(3.9), swing=math.radians(32), dropT=0.03); TEETH = 25   # CK.esc
CA, CC = (0.9999, 0.0055, -0.0143), np.array([-0.48, 0.394, 14.707]); VA, VC = (0.0142, -0.0134, 1.0), np.array([-1.582, 0.378, 14.7])   # the crown wheel's axis and the verge's, in the frame (X, Y, Z)
face = lambda a: K['d'] * math.tan(a) + K['off'] / math.cos(a); tip = lambda th: math.asin((face(K['beta'] + th) - K['y0']) / K['R'])
H = math.pi / TEETH; tmax = math.sqrt(K['reach'] ** 2 - K['off'] ** 2); lo, hi = 0, 1.4
for _ in range(40):
    m = (lo + hi) / 2
    if (K['d'] + K['off'] * math.sin(m)) / math.cos(m) < tmax: lo = m
    else: hi = m
te = lo - K['beta']; A = te + K['swing']; q = 2 * A * K['dropT'] / (1 - K['dropT']); rho = (-q + math.sqrt(q * q - 4 * A * (q - (K['swing'] - te)))) / (2 * A); c = (1 - K['dropT']) / (1 + rho); we = 2 * A / c
E = dict(te=te, rho=rho, b=rho * c, we=we, acc=we / c, th1=-te - we * K['dropT']); E['e1'] = tip(te); E['e0'] = E['e1'] - H; E['ea'] = max(E['e0'], tip(E['th1']))
def beat(t):
    u = t - K['dropT']
    if u < 0: return -E['te'] - E['we'] * t, E['e0'] + (E['ea'] - E['e0']) * (t / K['dropT']) ** 2
    if u < E['b']: th = E['th1'] - E['rho'] * E['we'] * u + 0.5 * E['acc'] * u * u
    else: u -= E['b']; th = -K['swing'] + 0.5 * E['acc'] * u * u
    return th, tip(th)
cr = tris_of('top'); vg = tris_of('verge'); S = 186; frames = []
vgT = vg[(vg[:, :, 2].min(1) > 17.0) & (vg[:, :, 2].max(1) < 18.3)]; vgB = vg[(vg[:, :, 2].min(1) > 10.8) & (vg[:, :, 2].max(1) < 11.8)]
for B, t in [(0, 0.0), (0, 0.03), (0, 0.15), (0, 0.26), (0, 0.6), (0, 0.99), (1, 0.03), (1, 0.26), (1, 0.6), (1, 0.99)]:
    th, e = beat(t); crown = e - K['tip0'] + H * B; verge = (-th if B & 1 else th) - K['mid']; fr = Image.new('RGB', (840, 380), 'white'); d = ImageDraw.Draw(fr)
    for col, vt in enumerate((vgT, vgB)):
        px = lambda p: (col * 420 + (p[0] + 2.3) * S, 190 - (p[1] - 0.39) * S)
        for tri in cr:
            pts = turn(tri, CC, CA, -crown)
            if abs(pts[:, 1].mean() - 0.39) < 1.0 and pts[:, 0].min() < -0.5 and (pts[:, 2].mean() > 17.2 if col == 0 else pts[:, 2].mean() < 12.2): pp = [px(v) for v in pts]; d.line(pp + [pp[0]], fill=(210, 70, 50))
        for tri in vt: pp = [px(v) for v in turn(tri, VC, VA, verge)]; d.line(pp + [pp[0]], fill=(30, 70, 200))
    d.text((6, 4), 'beat %d + %.2f: verge %+.1f deg from its middle, crown %.2f deg' % (B, t, math.degrees(-th if B & 1 else th), math.degrees(crown)), fill=(0, 0, 0)); d.text((6, 360), 'top (upper pallet)', fill=(90, 90, 90)); d.text((426, 360), 'foot (lower pallet)', fill=(90, 90, 90)); frames.append(fr)
sheet = Image.new('RGB', (1680, 1900), 'white')
for i, fr in enumerate(frames): sheet.paste(fr, ((i % 2) * 840, (i // 2) * 380))
sheet.save(os.path.join(HERE, 'esc-film.png')); print('tooth leaves at %.1f deg of the verge; recoil %.3f, impulse %.3f of a beat; drop %.3f deg of the wheel' % (math.degrees(te), E['b'], c, math.degrees(E['ea'] - E['e0'])))
