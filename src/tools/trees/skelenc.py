import pickle, sys, numpy as np, base64, json
# skelenc.py K tol q rq -> shots/K_skelenc.json : traced skeleton as a compact node list (see skeleton() in treegen.js)
K = sys.argv[1]; tol = float(sys.argv[2]); q = float(sys.argv[3]); rq = float(sys.argv[4])
D = pickle.load(open(f'shots/{K}_skel.pkl', 'rb')); ctr, rad, par, comp = D['ctr'].copy(), D['rad'].copy(), D['parent'].copy(), D['comp']
n = len(ctr)
roots = np.where(par < 0)[0]; main = roots[np.argmin(ctr[roots, 1])]
for r in roots:   # separate branch meshes hang on the nearest node of another piece
    if r == main: continue
    cand = np.where(comp != comp[r])[0]; j = cand[np.argmin(np.linalg.norm(ctr[cand] - ctr[r], axis=1))]; par[r] = j
kids = [[] for _ in range(n)]
for i, p in enumerate(par):
    if p >= 0: kids[p].append(i)
# subtree length, for following the main stem
order = []; st = [main]
while st: x = st.pop(); order.append(x); st.extend(kids[x])
sub = np.zeros(n)
for x in reversed(order):
    for c in kids[x]: sub[x] += sub[c] + np.linalg.norm(ctr[c] - ctr[x])
chains = []
def walk(i0, frm):
    ch = [i0]; i = i0
    while kids[i]:
        m = max(kids[i], key=lambda c: sub[c] + 1e-3 * rad[c])
        for c in kids[i]:
            if c != m: walk(c, i)
        ch.append(m); i = m
    chains.append((frm, ch))
walk(main, -1)
# radii: median of 3 along each chain, then never thicker than the node before it (and a side chain never thicker
# than its parent where it starts)
R = rad.copy()
for frm, ch in chains:
    r = rad[ch]; rr = r.copy()
    for k in range(len(r)): rr[k] = np.median(r[max(0, k - 1):k + 2])
    R[ch] = rr
chains.sort(key=lambda c: (c[0] >= 0, -sub[c[1][0]]))
done = np.zeros(n, bool)
def fix(frm, ch):
    lim = R[frm] if frm >= 0 else 9
    for k, x in enumerate(ch):
        if not (frm < 0 and k < 3): R[x] = min(R[x], lim)   # keep the root flare
        lim = R[x]
# process chains parent-first (BFS by attachment)
pending = list(chains); fixed = set(); guard = 0
while pending and guard < 100000:
    frm, ch = pending.pop(0); guard += 1
    if frm >= 0 and frm not in fixed: pending.append((frm, ch)); continue
    fix(frm, ch); fixed.update(ch)
# simplify each chain (Douglas-Peucker), keeping nodes where other chains attach
attach = set(f for f, _ in chains if f >= 0)
def dp(pts, keep):
    if len(pts) <= 2: return list(range(len(pts)))
    a, b = ctr[pts[0]], ctr[pts[-1]]; ab = b - a; L2 = ab @ ab + 1e-12
    t = np.clip(((ctr[pts] - a) @ ab) / L2, 0, 1); d = np.linalg.norm(ctr[pts] - (a + np.outer(t, ab)), axis=1)
    j = int(np.argmax(d))
    if d[j] <= tol: return [0, len(pts) - 1]
    l = dp(pts[:j + 1], keep); r = dp(pts[j:], keep)
    return l[:-1] + [x + j for x in r]
kept = set()
for frm, ch in chains:
    segs = [0] + [k for k, x in enumerate(ch) if x in attach and 0 < k < len(ch) - 1] + [len(ch) - 1]
    for s0, s1 in zip(segs[:-1], segs[1:]):
        idx = dp(ch[s0:s1 + 1], None); kept.update(ch[s0 + i] for i in idx)
# new parent links over kept nodes: walk up until a kept node
newpar = {}
for x in kept:
    p = par[x]
    while p >= 0 and p not in kept: p = par[p]
    newpar[x] = p
# DFS order over kept nodes
kk = {x: [] for x in kept}
for x, p in newpar.items():
    if p >= 0: kk[p].append(x)
seq = []; st = [main]
while st:
    x = st.pop(); seq.append(x)
    ch = sorted(kk[x], key=lambda c: sub[c]); st.extend(ch)   # biggest child last -> popped first
pos = {x: i for i, x in enumerate(seq)}
Q = np.round(ctr / q).astype(int)
out = bytearray(); maxd = 0
for i, x in enumerate(seq):
    p = newpar[x]; back = 0 if p < 0 else i - pos[p]
    while True:
        b = back & 127; back >>= 7
        if back: out.append(b | 128)
        else: out.append(b); break
    dlt = Q[x] - (Q[p] if p >= 0 else Q[x]); maxd = max(maxd, np.abs(dlt).max())
    for v in dlt: out.append(int(v) & 255)
    out.append(int(np.clip(round(R[x] / rq), 1, 255)))
assert maxd <= 127, maxd
o = (Q[main] * q).round(3).tolist()
json.dump({'o': o, 'q': q, 'rq': rq, 'n': len(seq), 'data': base64.b64encode(bytes(out)).decode()}, open(f'shots/{K}_skelenc.json', 'w'))
print(K, 'nodes', n, '->', len(seq), 'bytes', len(out), 'b64', len(base64.b64encode(bytes(out))), 'max step', maxd, 'root', o)
