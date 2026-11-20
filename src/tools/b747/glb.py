import os, site, sys; sys.path.append(site.getusersitepackages()); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # (numpy under -I; the modules beside this one)
# read the 747-8i GLB: meshes as numpy arrays (positions, normals, uvs, triangles) in glTF space (y up, metres)
import json, struct, numpy as np
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
def load(path):
    b = open(path, 'rb').read(); jl, = struct.unpack('<I', b[12:16]); g = json.loads(b[20:20 + jl])
    off = 20 + jl; bl, = struct.unpack('<I', b[off:off + 4]); blob = b[off + 8:off + 8 + bl]
    def acc(i):
        a = g['accessors'][i]; v = g['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = np.dtype(CT[a['componentType']])
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0); stride = v.get('byteStride', 0) or n * dt.itemsize
        raw = np.frombuffer(blob, dtype=np.uint8, count=stride * (a['count'] - 1) + n * dt.itemsize, offset=start)
        out = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], n * dt.itemsize), strides=(stride, 1)).copy().view(dt).reshape(a['count'], n)
        return out
    meshes = []
    for mi, m in enumerate(g['meshes']):
        for p in m['primitives']:
            A = p['attributes']; meshes.append({'i': mi, 'mat': p.get('material'), 'P': acc(A['POSITION']).astype(np.float64), 'N': acc(A['NORMAL']).astype(np.float64) if 'NORMAL' in A else None,
                'UV': acc(A['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in A else None, 'T': acc(p['indices']).reshape(-1, 3).astype(np.int64)})
    imgs = []
    for im in g.get('images', []):
        v = g['bufferViews'][im['bufferView']]; imgs.append(blob[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])
    return g, meshes, imgs
def components(P, T, tol=1e-4):
    # connected parts of a mesh: triangles sharing a vertex (welded by position)
    key = np.round(P / tol).astype(np.int64); _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
    parent = np.arange(inv.max() + 1)
    def find(x):
        while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for a, b, c in inv[T]:
        ra, rb, rc = find(a), find(b), find(c)
        if ra != rb: parent[rb] = ra
        rc = find(c); ra = find(a)
        if ra != rc: parent[rc] = ra
    roots = np.array([find(v) for v in inv[T[:, 0]]])
    return roots
