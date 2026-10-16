import numpy as np, warnings, sys, base64
from PIL import Image
warnings.filterwarnings('ignore')
X = np.load(sys.argv[1]); res = float(sys.argv[2]); levels = int(sys.argv[3]); out = sys.argv[4]
lo = np.floor(X.min(0) / res) * res; hi = np.ceil(X.max(0) / res) * res
dims = np.round((hi - lo) / res).astype(int)
idx = np.clip(((X - lo) / res).astype(int), 0, dims - 1)
G = np.zeros(dims, int); np.add.at(G, (idx[:, 0], idx[:, 1], idx[:, 2]), 1)
nz = G[G > 0]
print('dims', dims, 'voxels', G.size, 'occupied', (G > 0).sum(), 'count p50/p90/max', np.percentile(nz, [50, 90]), nz.max())
# quantize: level = ceil(levels * sqrt(count/p95)) clipped, 0 stays 0
p95 = np.percentile(nz, 95)
Q = np.where(G > 0, np.clip(np.ceil((levels - 1) * (G / p95) ** 0.75), 1, levels - 1), 0).astype(int)
# reconstruct weights: level -> mean count of voxels with that level
wts = np.array([0] + [G[Q == l].mean() if (Q == l).any() else 0 for l in range(1, levels)])
print('levels', levels, 'mean count per level', wts.round(2), 'hist', np.bincount(Q.ravel(), minlength=levels))
# sample
rng = np.random.default_rng(3)
W = wts[Q].ravel().astype(float); p = W / W.sum()
k = rng.choice(len(p), size=len(X), p=p)
ii = np.array(np.unravel_index(k, dims)).T
S = lo + (ii + rng.random(ii.shape)) * res
np.save(out + '_samp.npy', S)
# compact encoding: bits per voxel
bits = int(np.ceil(np.log2(levels)))
flat = Q.ravel()
by = bytearray()
acc = 0; nb = 0
for v in flat:
    acc |= int(v) << nb; nb += bits
    while nb >= 8: by.append(acc & 255); acc >>= 8; nb -= 8
if nb: by.append(acc & 255)
b64 = base64.b64encode(bytes(by)).decode()
print('bytes', len(by), 'base64 chars', len(b64))
open(out + '.txt', 'w').write(f'lo={lo.round(3).tolist()} res={res} dims={dims.tolist()} levels={levels} wts={wts.round(3).tolist()}\n{b64}\n')
