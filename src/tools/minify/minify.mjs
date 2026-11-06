// The page's scripts and styles made smaller for the visitor: build.py sends them here (G, 05/11/2026: "Node js có giúp
// được gì cho library ko?" ... "Ok em làm và tối ưu đi").
//   node minify.mjs PACKAGES_DIR  < [{ kind, code, module }]  > [{ code } | { error }]
// Only comments and whitespace go. Nothing is renamed or rewritten, for three reasons:
// - the 3D module's workers are written from its functions' own source and call them by name (world/textures.js
//   painterSource, world/books.js spineAtlas): renamed, a worker's script calls names it does not have; and a function
//   declaration printed as `let f = function` (as esbuild prints the ones in a block, and all of lib3d is in
//   `if (LIB) { … }`) gives its source without its name. A worker that fails falls back to the page's own thread,
//   silently: the room only stutters as it opens.
// - the page's classic scripts share their top-level names (each one's are globals the others call);
// - three.js keys a shader program on its material's onBeforeCompile source (and world/gardenbook.js sharpTwinMat a
//   twin's on its fix's source): renamed, two functions that differ only in their own names would come out the same
//   and share one program. Two that differ only in spaces or comments still could: each function of the module is
//   paired with its minified self (the same functions in the same order), and a module where two that touch a shader
//   come out the same is kept as written (sameShader).
// kind 'js': terser (module: the 3D module, with its top-level await); kind 'css': esbuild. A code that will not parse
// comes back as { error } and build.py keeps it as it was.
// The packages (package.json here, esbuild and terser) are installed in PACKAGES_DIR, ~/.cache/hidden-library-3d:
// out of iCloud, which evicts files it thinks unused.
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(path.join(process.argv[2], 'package.json'));
const { minify } = require('terser');
const esbuild = require('esbuild');
const acorn = require('acorn');   // (terser's own)

// the source of each function in a module, in order
function functions(src) {
  const out = [];
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (/Function/.test(n.type)) out.push(src.slice(n.start, n.end));
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
  })(acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' }));
  return out;
}
// two functions that touch a shader, written differently, minified the same: null if none
function sameShader(src, small) {
  const a = functions(src), b = functions(small), seen = new Map();
  if (a.length !== b.length) return 'the minified module has ' + b.length + ' functions, the module ' + a.length;
  for (let i = 0; i < a.length; i++) {
    if (!/\b(fragmentShader|vertexShader)\b/.test(a[i])) continue;
    const was = seen.get(b[i]);
    if (was !== undefined && was !== a[i]) return 'two shader functions come out the same: ' + b[i].slice(0, 120);
    seen.set(b[i], a[i]);
  }
  return null;
}

let input = '';
for await (const chunk of process.stdin) input += chunk;
const out = [];
for (const j of JSON.parse(input)) {
  try {
    if (j.kind === 'css') out.push({ code: (await esbuild.transform(j.code, { loader: 'css', minifyWhitespace: true, charset: 'utf8', logLevel: 'silent' })).code.trim() });
    else {
      const { code } = await minify(j.code, { module: !!j.module, ecma: 2020, compress: false, mangle: false, format: { comments: false } });
      const clash = j.module ? sameShader(j.code, code) : null;
      out.push(clash ? { error: clash } : { code });
    }
  } catch (e) { out.push({ error: String(e.message || e).slice(0, 400) }); }
}
process.stdout.write(JSON.stringify(out));
