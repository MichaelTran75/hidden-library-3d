# The cat ("cat" by artofaria, a static mesh; Sketchfab Free Standard licence) rigged: a skeleton placed on its anatomy
# and skin weights laid by region (the body along its spine, then the legs, tail and ears taking over where they leave
# it), smoothed over the surface, exported as a skinned GLB with no animation (the page poses it). Blender frame: x
# forward, y left, z up. Each bone carries its length (extras.len). Run with Blender 4.2+:
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
bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5); bm.to_mesh(me); bm.free()
if me.has_custom_normals: bpy.ops.mesh.customdata_custom_splitnormals_clear()
for p in me.polygons: p.use_smooth = True
ob.name = 'cat_mesh'; me.name = 'cat_mesh'
# ---- the skeleton
arm = bpy.data.armatures.new('cat_rig'); rig = bpy.data.objects.new('cat', arm); bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
E = arm.edit_bones
def bone(name, h, t, parent=None, connect=False, deform=True):
    b = E.new(name); b.head = Vector(h); b.tail = Vector(t); b.use_deform = deform
    if parent: b.parent = E[parent]; b.use_connect = connect
J = {}
J['hips'] = ((-0.085, 0, 0.125), (-0.03, 0, 0.13)); J['spine'] = ((-0.03, 0, 0.13), (0.022, 0, 0.136))
J['chest'] = ((0.022, 0, 0.136), (0.06, 0, 0.15)); J['neck'] = ((0.06, 0, 0.15), (0.088, 0, 0.165)); J['head'] = ((0.088, 0, 0.165), (0.165, 0, 0.19))
bone('hips', *J['hips']); bone('spine', *J['spine'], 'hips', True); bone('chest', *J['chest'], 'spine', True)
bone('neck', *J['neck'], 'chest', True); bone('head', *J['head'], 'neck', True)
TJ = [(-0.098, 0.140), (-0.121, 0.160), (-0.127, 0.186), (-0.140, 0.208), (-0.160, 0.228), (-0.185, 0.249), (-0.207, 0.268), (-0.226, 0.29)]
for i in range(7): bone('tail%d' % (i + 1), (TJ[i][0], 0, TJ[i][1]), (TJ[i + 1][0], 0, TJ[i + 1][1]), 'hips' if i == 0 else 'tail%d' % i, i > 0)
LEGJ = {}
for s, k in (('L', 1), ('R', -1)):
    bone('ear_' + s, (0.094, 0.03 * k, 0.222), (0.106, 0.048 * k, 0.257), 'head')
    LEGJ['f' + s] = [(0.058, 0.034 * k, 0.106), (0.054, 0.036 * k, 0.06), (0.073, 0.04 * k, 0.019), (0.096, 0.041 * k, 0.006)]
    LEGJ['h' + s] = [(-0.068, 0.04 * k, 0.112), (-0.046, 0.047 * k, 0.07), (-0.084, 0.051 * k, 0.034), (-0.078, 0.052 * k, 0.008), (-0.058, 0.052 * k, 0.005)]
    f = LEGJ['f' + s]; h = LEGJ['h' + s]
    bone('scap_' + s, (0.045, 0.026 * k, 0.168), f[0], 'chest', False, False)   # shoulder blade: moves the leg, no skin of its own
    bone('arm_' + s, f[0], f[1], 'scap_' + s, True); bone('fore_' + s, f[1], f[2], 'arm_' + s, True); bone('paw_' + s, f[2], f[3], 'fore_' + s, True)
    bone('thigh_' + s, h[0], h[1], 'hips'); bone('shin_' + s, h[1], h[2], 'thigh_' + s, True)
    bone('foot_' + s, h[2], h[3], 'shin_' + s, True); bone('toe_' + s, h[3], h[4], 'foot_' + s, True)
bpy.ops.armature.select_all(action='SELECT'); bpy.ops.armature.calculate_roll(type='GLOBAL_POS_Z')
bpy.ops.object.mode_set(mode='OBJECT')
names = [b.name for b in arm.bones if b.use_deform]; idx = {n: i for i, n in enumerate(names)}
P = np.array([tuple(v.co) for v in me.vertices]); x, y, z = P.T; ay = np.abs(y); N = len(P)
W = np.zeros((N, len(names)))
ss = lambda a, b, t: np.clip((t - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((t - a) / (b - a), 0, 1))
# the body: hips, spine, chest along x; the head beyond a plane from the nape (0.055, 0.2) to the throat (0.105, 0.085),
# the neck in the band between
s_head = (x - 0.055) * 0.917 + (z - 0.2) * 0.399
w_head = ss(0.0, 0.022, s_head); w_neck = ss(-0.03, -0.002, s_head) - w_head
rest = 1 - w_head - w_neck
w_hips = rest * (1 - ss(-0.065, -0.005, x)); w_chest = rest * ss(-0.005, 0.045, x); w_spine = rest - w_hips - w_chest
for n, w in (('hips', w_hips), ('spine', w_spine), ('chest', w_chest), ('neck', w_neck), ('head', w_head)): W[:, idx[n]] = w
def take(m, parts):   # a part takes membership m of the vertex from what it had, shared among its bones
    global W
    W *= (1 - m)[:, None]
    for n, w in parts: W[:, idx[n]] += m * w
def seg_t(p, a, b):   # where a point projects along a segment (0..1, unclamped) and its distance from the line
    a = np.array(a); b = np.array(b); d = b - a; t = ((p - a) @ d) / (d @ d)
    return t, np.linalg.norm(p - (a + np.outer(t, d)), axis=1)
# forelegs: the column under the chest is all leg; above, the shoulder blends in near the leg's line
for s, k in (('L', 1), ('R', -1)):
    f = LEGJ['f' + s]; side = (y * k > 0.004)
    t_up, r_up = seg_t(P, f[0], f[2])
    m = side * (x > 0.0) * np.where(z < 0.05, 1.0, (1 - ss(0.05, 0.11, z)) * (1 - ss(0.022, 0.045, r_up)))
    w_paw = 1 - ss(0.01, 0.024, z); w_arm = ss(0.052, 0.068, z) * (1 - w_paw); w_fore = 1 - w_paw - w_arm
    take(m, [('arm_' + s, w_arm), ('fore_' + s, w_fore), ('paw_' + s, w_paw)])
    h = LEGJ['h' + s]
    t_th, r_th = seg_t(P, h[0], h[1])
    m = side * (x < -0.0) * np.where(z < 0.05, 1.0, (1 - ss(0.05, 0.125, z)) * (1 - ss(0.026, 0.05, r_th)))
    w_toe = (1 - ss(0.006, 0.014, z)) * ss(-0.08, -0.068, x); w_foot = (1 - ss(0.028, 0.042, z)) * (1 - w_toe)
    w_thigh = ss(0.062, 0.078, z) * (1 - w_toe - w_foot); w_shin = 1 - w_toe - w_foot - w_thigh
    take(m, [('thigh_' + s, w_thigh), ('shin_' + s, w_shin), ('foot_' + s, w_foot), ('toe_' + s, w_toe)])
# the tail: its tube beyond the rump, each length to its bone (blended at the joints)
TP = [np.array((a[0], 0, a[1])) for a in TJ]
best_d = np.full(N, 9.0); tpar = np.zeros(N)
for i in range(7):
    t, d = seg_t(P, TP[i], TP[i + 1]); dd = np.where((t >= -0.15) & (t <= 1.15), d, 9.0)
    better = dd < best_d; best_d = np.where(better, dd, best_d); tpar = np.where(better, i + np.clip(t, 0, 1), tpar)
m_tail = (best_d < 0.032) * ss(-0.106, -0.124, x) * ss(0.11, 0.135, z)
parts = []
for i in range(7):
    c = i + 0.5; w = np.clip(1 - np.abs(tpar - c) / 1.0, 0, 1)   # tent weights, summing to one along the tail
    parts.append(('tail%d' % (i + 1), w))
tot = sum(w for _, w in parts); parts = [(n, w / np.maximum(tot, 1e-6)) for n, w in parts]
take(m_tail, parts)
# the ears: the flaps above the crown
for s, k in (('L', 1), ('R', -1)):
    m = (y * k > 0) * ss(0.226, 0.24, z) * ss(0.018, 0.03, ay) * (x > 0.065) * (x < 0.14)
    take(m, [('ear_' + s, np.ones(N))])
# smoothed over the surface a little (the weights of each vertex's neighbours), then the four largest kept
adj = [[] for _ in range(N)]
for e in me.edges: a, b = e.vertices; adj[a].append(b); adj[b].append(a)
for it in range(2):
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
