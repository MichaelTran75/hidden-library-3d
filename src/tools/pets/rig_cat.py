# The cat ("cat" by artofaria, a static mesh; Sketchfab Free Standard licence) rigged: its mesh made finer where it bends,
# a skeleton placed on its anatomy and centred in its limbs (the tail's line measured on the mesh), and skin weights laid
# along each limb's bones with a soft band at every joint, smoothed over the surface; exported as a skinned GLB with no
# animation (the page poses it). Blender frame: x forward, y left, z up. Each bone carries its length (extras.len).
#   blender -b --factory-startup -P rig_cat.py -- cat.glb cat_rigged.glb
import bpy, sys, bmesh, numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
mw = ob.matrix_world.copy(); ob.parent = None; ob.matrix_world = mw
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o.type == 'EMPTY': bpy.data.objects.remove(o)
me = ob.data
while len(me.uv_layers) > 1: me.uv_layers.remove(me.uv_layers[-1])
if me.has_custom_normals: bpy.ops.mesh.customdata_custom_splitnormals_clear()
# ---- the mesh made finer (each triangle into four, flat: its shape and look kept): everywhere once, and once more on
# the legs and the tail, which bend most (the model has some three rings of vertices down a leg: a knee had none to fold)
bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
# (the model's smooth normals carried onto the new vertices, interpolated: the finer mesh shades as the model did, not
# as its flat facets, which showed as rings down the tail)
bm.normal_update(); onrm = bm.verts.layers.float_vector.new('onrm')
for v in bm.verts: v[onrm] = v.normal.copy()
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
def bends(c): return (c.z < 0.08 and abs(c.y) > 0.012) or (c.x < -0.092 and c.z > 0.128)   # a leg below the belly, the tail
sel = [e for e in bm.edges if bends((e.verts[0].co + e.verts[1].co) / 2)]
bmesh.ops.subdivide_edges(bm, edges=sel, cuts=1, use_grid_fill=True)
bmesh.ops.triangulate(bm, faces=bm.faces[:])
nv = [v[onrm].normalized() for v in bm.verts]
bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
me.normals_split_custom_set_from_vertices(nv)
ob.name = 'cat_mesh'; me.name = 'cat_mesh'
P = np.array([tuple(v.co) for v in me.vertices]); x, y, z = P.T; ay = np.abs(y); N = len(P)
print('vertices', N, 'triangles', len(me.polygons))
# ---- the tail's line, measured: from a first guess along it, each point moved to the middle of the tube's section there
TJ0 = np.array([(-0.098, 0, 0.140), (-0.121, 0, 0.160), (-0.127, 0, 0.186), (-0.140, 0, 0.208), (-0.160, 0, 0.228), (-0.185, 0, 0.249), (-0.207, 0, 0.268), (-0.228, 0, 0.292)])
tailish = (x < -0.095) & (z > 0.13)
def resample(L, n):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(L, axis=0), axis=1))]; s = np.linspace(0, d[-1], n)
    return np.array([np.interp(s, d, L[:, k]) for k in range(3)]).T
line = resample(TJ0, 26)
for it in range(4):
    T = np.gradient(line, axis=0); T /= np.linalg.norm(T, axis=1)[:, None]; new = line.copy()
    for i in range(3, len(line)):   # (the first points lie inside the rump: kept)
        rel = P - line[i]; along = rel @ T[i]; r = np.linalg.norm(rel - np.outer(along, T[i]), axis=1)
        m = tailish & (np.abs(along) < 0.0045) & (r < 0.03)
        if m.sum() >= 6: new[i] = P[m].mean(0); new[i, 1] = 0
    line = new
    for k in range(2): line[1:-1] = 0.25 * line[:-2] + 0.5 * line[1:-1] + 0.25 * line[2:]
# its end: the farthest tail vertex along the last direction, less the tube's radius there
tdir = line[-1] - line[-2]; tdir /= np.linalg.norm(tdir); tip = P[tailish][np.argmax((P[tailish] - line[-1]) @ tdir)]
line = np.vstack([line, line[-1] + tdir * max(0.0, (tip - line[-1]) @ tdir - 0.006)])
NT = 12; TJ = resample(line, NT + 1)
print('tail joints', np.round(TJ[:, [0, 2]], 4).tolist())
# ---- the skeleton
arm = bpy.data.armatures.new('cat_rig'); rig = bpy.data.objects.new('cat', arm); bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
E = arm.edit_bones
def bone(name, h, t, parent=None, connect=False, deform=True):
    b = E.new(name); b.head = Vector(h); b.tail = Vector(t); b.use_deform = deform
    if parent: b.parent = E[parent]; b.use_connect = connect
SP = [(-0.085, 0, 0.125), (-0.03, 0, 0.13), (-0.004, 0, 0.133), (0.022, 0, 0.136), (0.06, 0, 0.15), (0.088, 0, 0.165), (0.165, 0, 0.19)]
SPN = ['hips', 'spine', 'spine2', 'chest', 'neck', 'head']   # (the back in two below the chest: it bends along its length)
for i, n in enumerate(SPN): bone(n, SP[i], SP[i + 1], SPN[i - 1] if i else None, i > 0)
for i in range(NT): bone('tail%d' % (i + 1), TJ[i], TJ[i + 1], 'hips' if i == 0 else 'tail%d' % i, i > 0)
LEGJ = {}
for s, k in (('L', 1), ('R', -1)):
    bone('ear_' + s, (0.094, 0.03 * k, 0.222), (0.106, 0.048 * k, 0.257), 'head')
    # foreleg: shoulder, elbow (centred over the forearm's tube), wrist, the knuckles, the toes' tips
    LEGJ['f' + s] = [(0.058, 0.034 * k, 0.106), (0.061, 0.036 * k, 0.058), (0.072, 0.04 * k, 0.020), (0.085, 0.041 * k, 0.009), (0.096, 0.041 * k, 0.006)]
    # hind leg: hip, knee (the stifle, at the front of the thigh), hock (the heel, at the back), the ball of the foot, toes
    LEGJ['h' + s] = [(-0.068, 0.04 * k, 0.112), (-0.046, 0.047 * k, 0.07), (-0.084, 0.051 * k, 0.034), (-0.078, 0.052 * k, 0.008), (-0.058, 0.052 * k, 0.005)]
    f = LEGJ['f' + s]; h = LEGJ['h' + s]
    bone('scap_' + s, (0.045, 0.026 * k, 0.168), f[0], 'chest', False, False)   # shoulder blade: moves the leg, no skin of its own
    bone('arm_' + s, f[0], f[1], 'scap_' + s, True); bone('fore_' + s, f[1], f[2], 'arm_' + s, True)
    bone('paw_' + s, f[2], f[3], 'fore_' + s, True); bone('ftoe_' + s, f[3], f[4], 'paw_' + s, True)
    bone('thigh_' + s, h[0], h[1], 'hips'); bone('shin_' + s, h[1], h[2], 'thigh_' + s, True)
    bone('foot_' + s, h[2], h[3], 'shin_' + s, True); bone('toe_' + s, h[3], h[4], 'foot_' + s, True)
bpy.ops.armature.select_all(action='SELECT'); bpy.ops.armature.calculate_roll(type='GLOBAL_POS_Z')
bpy.ops.object.mode_set(mode='OBJECT')
names = [b.name for b in arm.bones if b.use_deform]; idx = {n: i for i, n in enumerate(names)}
W = np.zeros((N, len(names)))
def ss(a, b, t): u = np.clip((t - a) / (b - a), 0, 1); return u * u * (3 - 2 * u)
def chain_weights(pts, joints, bands):   # along a chain of bones: where each point projects (its arc length), each
    # bone taking its stretch, the two either side of a joint sharing a band of half-width bands[j] about it
    J = np.array(joints); seg = np.diff(J, axis=0); L = np.linalg.norm(seg, axis=1); S = np.r_[0, np.cumsum(L)]
    best = np.full(len(pts), 9.0); s = np.zeros(len(pts))
    for i in range(len(seg)):
        t = np.clip(((pts - J[i]) @ seg[i]) / (L[i] ** 2), 0, 1); d = np.linalg.norm(pts - (J[i] + np.outer(t, seg[i])), axis=1)
        b = d < best - 1e-9; best = np.where(b, d, best); s = np.where(b, S[i] + t * L[i], s)
    w = np.zeros((len(pts), len(seg)))
    for i in range(len(seg)):
        lo = ss(S[i] - bands[i - 1], S[i] + bands[i - 1], s) if i > 0 else np.ones(len(pts))
        hi = 1 - ss(S[i + 1] - bands[i], S[i + 1] + bands[i], s) if i < len(seg) - 1 else np.ones(len(pts))
        w[:, i] = lo * hi
    return w / np.maximum(w.sum(1, keepdims=True), 1e-9), best
def take(m, parts):   # a part takes membership m of the vertex from what it had, shared among its bones
    global W
    W *= (1 - m)[:, None]
    for n, w in parts: W[:, idx[n]] += m * w
# the body: hips to chest along the back; the head beyond a plane from the nape (0.055, 0.2) to the throat (0.105, 0.085),
# the neck in the band between
s_head = (x - 0.055) * 0.917 + (z - 0.2) * 0.399
w_head = ss(0.0, 0.022, s_head); w_neck = ss(-0.03, -0.002, s_head) - w_head
rest = 1 - w_head - w_neck
cw, _ = chain_weights(P * np.array([1, 0, 0.35]), [np.array(p) * np.array([1, 0, 0.35]) for p in SP[:5]], [0.016, 0.014, 0.014])   # (mostly by x)
for i, n in enumerate(['hips', 'spine', 'spine2', 'chest']): W[:, idx[n]] = rest * cw[:, i]
W[:, idx['neck']] = w_neck; W[:, idx['head']] = w_head
# the legs: membership as before (the column under the body all leg, the shoulder and haunch blending into the trunk near
# the leg's line); within a leg, along its bones (a band of ~6-8 mm about each joint: a bend shared by two rings of the
# finer mesh, not a crease)
for s, k in (('L', 1), ('R', -1)):
    f = LEGJ['f' + s]; side = (y * k > 0.004)
    _, r_up = chain_weights(P, [f[0], f[2]], [])
    m = side * (x > 0.0) * np.where(z < 0.05, 1.0, (1 - ss(0.05, 0.118, z)) * (1 - ss(0.028, 0.052, r_up)))   # (the shoulder's muscle going with the arm)
    w, _ = chain_weights(P, f, [0.009, 0.007, 0.004, 0.003])
    take(m, [('arm_' + s, w[:, 0]), ('fore_' + s, w[:, 1]), ('paw_' + s, w[:, 2]), ('ftoe_' + s, w[:, 3])])
    h = LEGJ['h' + s]
    _, r_th = chain_weights(P, [h[0], h[1]], [])
    m = side * (x < -0.0) * np.where(z < 0.055, 1.0, (1 - ss(0.055, 0.132, z)) * (1 - ss(0.036, 0.066, r_th)))   # (the haunch, the thigh's muscle, going with the thigh)
    w, _ = chain_weights(P, h, [0.009, 0.007, 0.005, 0.003])
    take(m, [('thigh_' + s, w[:, 0]), ('shin_' + s, w[:, 1]), ('foot_' + s, w[:, 2]), ('toe_' + s, w[:, 3])])
# the tail: its tube beyond the rump, along its twelve bones (a band of ~40 % of a bone about each joint); its root blending
# into the hips over the rump
tw, td = chain_weights(P, TJ, [0.4 * np.linalg.norm(TJ[i + 1] - TJ[i]) for i in range(NT)])
m_tail = (td < 0.032) * ss(-0.104, -0.122, x) * ss(0.11, 0.135, z) * tailish
take(m_tail, [('tail%d' % (i + 1), tw[:, i]) for i in range(NT)])
# the ears: the flaps above the crown
for s, k in (('L', 1), ('R', -1)):
    m = (y * k > 0) * ss(0.226, 0.24, z) * ss(0.018, 0.03, ay) * (x > 0.065) * (x < 0.14)
    take(m, [('ear_' + s, np.ones(N))])
# smoothed over the surface (each vertex toward its neighbours' mean; the finer mesh needs more passes for the same
# reach), then the four largest kept
adj = [[] for _ in range(N)]
for e in me.edges: a, b = e.vertices; adj[a].append(b); adj[b].append(a)
for it in range(5):
    Wn = np.array([W[nb].mean(0) if nb else W[i] for i, nb in enumerate(adj)]); W = 0.5 * W + 0.5 * Wn
order = np.argsort(-W, axis=1)
for i in range(N):
    keep = order[i, :4]; row = np.zeros(len(names)); row[keep] = W[i, keep]; row[row < 0.01] = 0; W[i] = row / row.sum()
for n in names: ob.vertex_groups.new(name=n)
for i in range(N):
    for j in np.nonzero(W[i])[0]: ob.vertex_groups[names[j]].add([i], float(W[i, j]), 'REPLACE')
mod = ob.modifiers.new('rig', 'ARMATURE'); mod.object = rig; ob.parent = rig
dom = np.array(names)[W.argmax(1)]
print('dominant', {n: int((dom == n).sum()) for n in names})
for b in arm.bones: b['len'] = round(b.length, 5)   # each bone's length (leaf bones have no child to show it)
bpy.ops.wm.save_as_mainfile(filepath=out.replace('.glb', '.blend'))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_skins=True, export_animations=False, export_yup=True, export_texcoords=True,
    export_normals=True, export_tangents=False, export_materials='EXPORT', export_image_format='AUTO', export_def_bones=False, use_selection=False, export_extras=True)
print('written', out)
