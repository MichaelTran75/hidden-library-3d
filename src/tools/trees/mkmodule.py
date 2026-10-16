# treegen.js (the generator with its tuning knobs P.*) -> makeTrees() in lib3d/world/trees.js, knobs fixed at their values.
#   python3 tools/trees/mkmodule.py   then   python3 build.py
import re, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
s = open(os.path.join(HERE, 'treegen.js')).read()
start = s.index('window.makeTrees = function (THREE, rng, P = {}) {\n') + len('window.makeTrees = function (THREE, rng, P = {}) {\n')
end = s.rindex('  return { A: treeA(rng(301))')
body = s[start:end]
# tuning knobs -> their values
body = re.sub(r'(?<![\w$)\]])\(P\.\w+ \?\? (-?[\d.]+)\)', r'\1', body)
body = re.sub(r'P\.\w+ \?\? (-?[\d.]+)', r'\1', body)
assert 'P.' not in re.sub(r'[A-Za-z_]P\.', '', body), [l for l in body.split('\n') if re.search(r'(?<![A-Za-z_])P\.', l)]
def match(src, k, o, c):   # index of the bracket closing the one at k
    depth = 0
    while True:
        if src[k] == o: depth += 1
        elif src[k] == c:
            depth -= 1
            if depth == 0: return k
        k += 1
def drop_fn(src, name):
    f = src.index('  function ' + name + '(')
    i = f
    while True:   # take the comment lines right above with it
        prev = src.rindex('\n', 0, i - 1) + 1
        if src[prev:i].lstrip().startswith('//'): i = prev
        else: break
    pclose = match(src, src.index('(', f), '(', ')')
    k = match(src, src.index('{', pclose), '{', '}')
    k = src.index('\n', k)
    return src[:i] + src[k + 1:]
def drop_line(src, startswith):
    lines = src.split('\n'); out = []; skip_comments = []
    for ln in lines:
        if ln.lstrip().startswith(startswith): 
            while out and out[-1].lstrip().startswith('//'): out.pop()
            continue
        out.append(ln)
    return '\n'.join(out)
for fn in ['path', 'colonize', 'nodeBranches', 'seedLine', 'blobTexture']: body = drop_fn(body, fn)
def drop_const_block(src, name):
    i = src.index('  const ' + name + ' = ')
    while src[src.rindex('\n', 0, i - 1) + 1:i].lstrip().startswith('//'): i = src.rindex('\n', 0, i - 1) + 1
    j = src.index('{', src.index('  const ' + name + ' = ')); depth = 0; k = j
    while True:
        if src[k] == '{': depth += 1
        elif src[k] == '}':
            depth -= 1
            if depth == 0: break
        k += 1
    k = src.index('\n', k)
    return src[:i] + src[k + 1:]
body = drop_const_block(body, 'along')
for st in ['const taper = ', 'const branchLen = ', 'const sideDir = ', 'const stats = ', 'const canvas = ']: body = drop_line(body, st)
body = body.replace('return { scale: 1, stats, parts:', 'return { scale: 1, parts:')
for name in ['along', 'taper', 'branchLen', 'sideDir', 'colonize', 'nodeBranches', 'seedLine', 'blobTexture', 'stats']:
    assert not re.search(r'\b' + name + r'\b\s*\(', body) and not re.search(r'const ' + name + r'\b', body), name
head = '''/* ---------------------------------------------------------------- trees, built in code
   The garden's three trees, rebuilt from measurements of the GLB models they replace (credits in the page): A and C
   on skeletons traced from those models, B on its twelve limbs; leaves placed by the old models' leaf densities (cells
   of 0.4-0.6 m), card sizes, facing and textures as measured there. Metres, scale 1.                             */
async function makeTrees() {
'''
tail = '''  const trees = { A: treeA(rng(301)) }; await tick();
  trees.B = treeB(rng(302)); await tick();
  trees.C = treeC(rng(303));
  return trees;
}
'''
out = head + body.rstrip() + '\n' + tail
mod = os.path.join(HERE, '..', '..', 'lib3d', 'world', 'trees.js'); m = open(mod).read()
i = m.index('/* ---------------------------------------------------------------- trees, built in code')
j = m.index('\nexport {') + 1   # the module's imports above and its export line below stay as they are
open(mod, 'w').write(m[:i] + out + '\n' + m[j:])
print('lib3d/world/trees.js: makeTrees updated,', out.count('\n'), 'lines')
