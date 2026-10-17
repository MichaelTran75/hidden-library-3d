#!/usr/bin/env python3
"""lib.glb with its textures at half their width and height (G, 17/10/2026: the page loads faster).

    python3 tools/half-textures.py backup/lib.v5-full-textures.glb lib.glb

Every picture in the file larger than 256 px is scaled to half (Lanczos) and saved again as WebP (colour at quality 88,
normal maps at 92: their small slopes show the loss first); the rest of the binary (the meshes, meshopt-compressed) is
copied byte for byte and the buffer views moved to their new places. Nothing else changes: same nodes, same materials,
same samplers."""
import io, json, struct, sys
from PIL import Image

ALIGN = 16   # each part of the binary starts on a 16-byte boundary (glTF asks 4; meshopt streams are happy with it)


def half(data, normal):
    im = Image.open(io.BytesIO(data)); im.load()
    w, h = im.size
    if max(w, h) <= 256: return data, (w, h), (w, h)
    small = im.convert('RGBA' if 'A' in im.getbands() else 'RGB').resize((w // 2, h // 2), Image.LANCZOS)
    out = io.BytesIO(); small.save(out, 'WEBP', quality=92 if normal else 88, method=6)
    return out.getvalue(), (w, h), small.size


def main(inp, outp):
    b = open(inp, 'rb').read()
    magic, ver, _ = struct.unpack('<4sII', b[:12]); assert magic == b'glTF' and ver == 2, 'not a glTF 2 binary'
    jl, jt = struct.unpack('<I4s', b[12:20]); assert jt == b'JSON'
    g = json.loads(b[20:20 + jl])
    off = 20 + jl; bl, bt = struct.unpack('<I4s', b[off:off + 8]); assert bt == b'BIN\0'
    blob = b[off + 8:off + 8 + bl]
    assert 'uri' not in g['buffers'][0], 'buffer 0 is not the binary chunk'
    # the pictures: which are normal maps
    normal_tex = set()
    for m in g.get('materials', []):
        if 'normalTexture' in m: normal_tex.add(m['normalTexture']['index'])
    normal_img = set()
    for ti, t in enumerate(g.get('textures', [])):
        src = t.get('source', (t.get('extensions') or {}).get('EXT_texture_webp', {}).get('source'))
        if ti in normal_tex and src is not None: normal_img.add(src)
    img_view = {im['bufferView']: i for i, im in enumerate(g.get('images', [])) if 'bufferView' in im}
    # every range of the binary chunk something points at: buffer views of buffer 0, and meshopt streams kept in it
    refs = []
    for vi, bv in enumerate(g['bufferViews']):
        if bv['buffer'] == 0: refs.append((bv.get('byteOffset', 0), bv['byteLength'], bv, vi))
        mo = (bv.get('extensions') or {}).get('EXT_meshopt_compression')
        if mo and mo['buffer'] == 0: refs.append((mo.get('byteOffset', 0), mo['byteLength'], mo, None))
    refs.sort(key=lambda r: r[0])
    for (a0, al, *_), (b0, *_) in zip(refs, refs[1:]): assert a0 + al <= b0, 'buffer views overlap'
    out = bytearray(); before = after = 0
    for o, n, holder, vi in refs:
        data = blob[o:o + n]
        if vi is not None and vi in img_view:
            k = img_view[vi]; new, s0, s1 = half(data, k in normal_img)
            print(f'image {k}: {s0[0]}x{s0[1]} {len(data)} B -> {s1[0]}x{s1[1]} {len(new)} B' + (' (normal map)' if k in normal_img else ''))
            before += len(data); after += len(new); data = new
        while len(out) % ALIGN: out.append(0)
        holder['byteOffset'] = len(out); holder['byteLength'] = len(data); out += data
    while len(out) % 4: out.append(0)
    g['buffers'][0]['byteLength'] = len(out)
    js = json.dumps(g, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(outp, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total)); f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
        f.write(struct.pack('<I4s', len(out), b'BIN\0')); f.write(out)
    print(f'pictures {before} -> {after} B; file {len(b)} -> {total} B')


if __name__ == '__main__':
    main(*sys.argv[1:3])
