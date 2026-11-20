# the dial ring's face drawn anew, large and sharp: python3 -I ring.py <clock-tex.jpg> <ring.png> [size]
# In the model's picture the ring's face is 147 px across, its numerals 11 px tall. Here: its own picture (XII up), the
# ground taken from the model's (its numerals wiped out, the mottling kept, a fine grain added), the twelve Roman
# numerals and the dots between them drawn as shapes where the model has them: upright along the radius, their heads
# outward, IIII for four. make.mjs lays it on the face by the face's own place: 6.4 units from the ring's middle to the
# picture's edge.
import os, site, sys, math; sys.path.append(site.getusersitepackages())
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
src, out = sys.argv[1], sys.argv[2]; N = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
HALF = 6.4; CY, CZ = 0.335, 11.594; RIN, ROUT = 4.707, 6.239            # the ring on the clock (units): its middle (Y, Z), its face's edges
K = N / (2 * HALF)                                                        # px a unit
A = np.asarray(Image.open(src).convert('RGB'), np.float32)
# ---- the ground: each point of the new picture from the model's (u = 0.011488 Z - 0.061071, v = -0.011335 Y + 0.075391; 1024 px)
ys, xs = np.mgrid[0:N, 0:N].astype(np.float32); right = (xs + 0.5 - N / 2) / K; up = (N / 2 - ys - 0.5) / K; rad = np.hypot(right, up)
ax = (0.011488 * (CZ + up) - 0.061071) * 1024 - 0.5; ay = (-0.011335 * (CY - right) + 0.075391) * 1024 - 0.5
x0 = np.clip(np.floor(ax).astype(int), 0, 1022); y0 = np.clip(np.floor(ay).astype(int), 0, 1022); fx = np.clip(ax - x0, 0, 1)[..., None]; fy = np.clip(ay - y0, 0, 1)[..., None]
G0 = (A[y0, x0] * (1 - fx) + A[y0, x0 + 1] * fx) * (1 - fy) + (A[y0 + 1, x0] * (1 - fx) + A[y0 + 1, x0 + 1] * fx) * fy
band = (rad > RIN + 0.10) & (rad < ROUT - 0.10); lum = G0.astype(np.float64) @ np.array([0.299, 0.587, 0.114])
ink = band & (lum < np.percentile(lum[band], 72) - 14)                    # the model's numerals and dots: darker than the ground
keep = band & ~np.asarray(Image.fromarray((ink * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * int(0.012 * N) + 1)), bool)
def blur(a, s): return np.asarray(Image.fromarray(a).filter(ImageFilter.GaussianBlur(s)), np.float32)
# the ground's own colour (the lighter half of what is left of the band), and how it varies over the ring: the model's
# mottling, smoothed (what was ink is filled from round it)
ivory = np.array([np.percentile(G0[..., c][keep], 70) for c in range(3)], np.float32)
w = blur((keep * 255).astype(np.uint8), 0.035 * N) / 255; lf = blur((lum * keep).clip(0, 255).astype(np.uint8), 0.035 * N) / 255 / np.maximum(w, 1e-3)
vary = np.clip(lf / np.median(lf[keep]), 0.90, 1.06); vary = 1 + (vary - 1) * np.clip(w * 4, 0, 1)   # (nothing known far from the band: the plain colour)
print('ground colour', ivory.round(1), '; the model\'s ink', G0[ink].mean(0).round(1))
rng = np.random.RandomState(7)
grain = blur(rng.randint(0, 256, (N, N)).astype(np.uint8), 0.8) - 127.5; cloud = blur(rng.randint(0, 256, (N, N)).astype(np.uint8), 0.014 * N) - 127.5
ground = ivory[None, None, :] * (vary * (1 + grain * 0.0005 + cloud * 0.0050))[..., None]
stain = blur(rng.randint(0, 256, (N, N)).astype(np.uint8), 0.045 * N) - 127.5; stain = stain / (stain.std() + 1e-6)   # age: warmer, a little darker, in broad patches
ground = ground * np.dstack([1 + 0.012 * stain, 1 + 0.002 * stain, 1 - 0.040 * stain]) * (1 - 0.018 * np.clip(stain, 0, 3))[..., None]
edge = np.clip((rad - RIN) / 0.14, 0, 1) * np.clip((ROUT - rad) / 0.14, 0, 1); ground = ground * (0.93 + 0.07 * np.where((rad > RIN - 0.3) & (rad < ROUT + 0.3), edge, 1.0))[..., None]   # (a little darker at the rims, as the model)
base = Image.fromarray(ground.clip(0, 255).astype(np.uint8))
# ---- the numerals: strokes with serifs, drawn 4 times as large then brought down (smooth edges)
SS = 4; M = N * SS; ink_img = Image.new('L', (M, M), 0); dr = ImageDraw.Draw(ink_img)
RMID = (RIN + ROUT) / 2; HGT = (ROUT - RIN) * 0.60; THICK = HGT * 0.185; THIN = HGT * 0.075; SER = HGT * 0.085   # the numerals' height, their thick and thin strokes, their serifs
def place(theta):   # the numeral's own frame at hour angle theta (clockwise from XII): x along the ring (clockwise), y outward; origin on the band's middle
    c, s = math.cos(theta), math.sin(theta)
    def f(x, y): r = RMID + y; px = r * s + x * c; py = r * c - x * s; return ((M / 2 + px * K * SS), (M / 2 - py * K * SS))
    return f
def stem(f, x, w, lean=0.0):   # a stroke from the foot line to the head line, x at its middle at the foot, leaning by `lean` (its head's shift)
    h = HGT / 2; pts = [(x - w / 2, -h), (x + w / 2, -h), (x + w / 2 + lean, h), (x - w / 2 + lean, h)]; dr.polygon([f(*p) for p in pts], fill=255)
def serif(f, x, w, y):      # a slab across a stroke's end, with a slight bracket
    e = SER * 1.25; t = SER * 0.62; s = 1 if y > 0 else -1
    dr.polygon([f(x - w / 2 - e, y), f(x + w / 2 + e, y), f(x + w / 2 + e, y - s * t * 0.55), f(x + w / 2, y - s * t * 1.9), f(x - w / 2, y - s * t * 1.9), f(x - w / 2 - e, y - s * t * 0.55)], fill=255)
def glyph_I(f, x): stem(f, x, THICK); serif(f, x, THICK, HGT / 2); serif(f, x, THICK, -HGT / 2)
def glyph_V(f, x, wd):      # thick stroke from the head at the left down to the foot, thin one up to the right
    h = HGT / 2; a = wd / 2
    dr.polygon([f(x - a - THICK * 0.55, h), f(x - a + THICK * 0.55, h), f(x + THICK * 0.42, -h), f(x - THICK * 0.42 - THIN * 0.2, -h)], fill=255)
    dr.polygon([f(x + a - THIN * 0.6, h), f(x + a + THIN * 0.6, h), f(x + THICK * 0.42, -h), f(x - THIN * 0.5, -h + THICK * 0.9)], fill=255)
    serif(f, x - a, THICK * 1.1, h); serif(f, x + a, THIN * 1.2, h)
def glyph_X(f, x, wd):      # thick stroke from the head at the left to the foot at the right, thin one across it
    h = HGT / 2; a = wd / 2
    dr.polygon([f(x - a - THICK * 0.55, h), f(x - a + THICK * 0.55, h), f(x + a + THICK * 0.55, -h), f(x + a - THICK * 0.55, -h)], fill=255)
    dr.polygon([f(x + a - THIN * 0.6, h), f(x + a + THIN * 0.6, h), f(x - a + THIN * 0.6, -h), f(x - a - THIN * 0.6, -h)], fill=255)
    for sx, sy, w in ((-a, h, THICK * 1.1), (a, -h, THICK * 1.1), (a, h, THIN * 1.2), (-a, -h, THIN * 1.2)): serif(f, x + sx, w, sy)
WI = THICK + SER * 2.5; WV = HGT * 0.74; WX = HGT * 0.72; GAP = HGT * 0.13   # each letter's width, the space between two
NUM = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']
for k, word in enumerate(NUM):
    f = place(k * math.pi / 6); widths = [WI if ch == 'I' else WV if ch == 'V' else WX for ch in word]; total = sum(widths) + GAP * (len(word) - 1); x = -total / 2
    for ch, w in zip(word, widths):
        cx = x + w / 2
        if ch == 'I': glyph_I(f, cx)
        elif ch == 'V': glyph_V(f, cx, w - THICK * 1.1 - SER)
        else: glyph_X(f, cx, w - THICK * 1.1 - SER)
        x += w + GAP
    g = place((k + 0.5) * math.pi / 6); c = g(0, 0); rr = HGT * 0.085 * K * SS; dr.ellipse((c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr), fill=255)   # the dot at the half hour
ink_a = np.asarray(ink_img.resize((N, N), Image.LANCZOS), np.float32) / 255
soft = np.asarray(ink_img.filter(ImageFilter.GaussianBlur(0.9 * SS)).resize((N, N), Image.LANCZOS), np.float32) / 255
INK = np.array([104, 88, 38], np.float32); DARK = np.array([58, 48, 22], np.float32)   # the model's olive gold, a little deeper; its edge darker still (cut into the ground)
g = np.asarray(base, np.float32); edge_a = np.clip(soft - ink_a, 0, 1) * 0.55
res = g * (1 - edge_a[..., None]) + DARK * edge_a[..., None]; inkc = INK * (1 + grain[..., None] * 0.0022)
res = res * (1 - ink_a[..., None]) + inkc * ink_a[..., None]
Image.fromarray(res.clip(0, 255).astype(np.uint8)).save(out); print('wrote', out, N)
