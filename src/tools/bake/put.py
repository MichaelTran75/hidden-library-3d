# python3 put.py DIR SRC: a bake (DIR: bake.webp + bake.json, from bake.mjs) put into the source: the picture next to
# build.py, its measures between the marks in lib3d/core/bake.js
import sys, os, re, shutil, json
d, src = sys.argv[1], sys.argv[2]
meta = json.dumps(json.load(open(os.path.join(d, 'bake.json'))), separators=(', ', ': '))
p = os.path.join(src, 'lib3d', 'core', 'bake.js'); s = open(p, encoding='utf-8').read()
s2, n = re.subn(r'/\*BAKE-META\*/.*?/\*BAKE-END\*/', lambda m: '/*BAKE-META*/' + meta + '/*BAKE-END*/', s, flags=re.S); assert n == 1
open(p, 'w', encoding='utf-8').write(s2); shutil.copyfile(os.path.join(d, 'bake.webp'), os.path.join(src, 'bake.webp'))
print('put:', meta, os.path.getsize(os.path.join(src, 'bake.webp')), 'bytes')
