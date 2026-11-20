// node gen.cjs library3d-bg.js outDir : writes the ES modules (outDir/<parts>, outDir/main.js) from the one-file module
const fs = require('fs'), path = require('path');
const [src, outDir] = process.argv.slice(2);
const text = fs.readFileSync(src, 'utf8'), a = require('./an.json'), PARTS = require('./parts.cjs');
const EXT = { THREE: ['* as THREE', 'three'], GLTFLoader: ['{ GLTFLoader }', 'three/addons/loaders/GLTFLoader.js'],
  MeshoptDecoder: ['{ MeshoptDecoder }', 'three/addons/libs/meshopt_decoder.module.js'], RectAreaLightUniformsLib: ['{ RectAreaLightUniformsLib }', 'three/addons/lights/RectAreaLightUniformsLib.js'],
  mergeGeometries: ['{ mergeGeometries }', 'three/addons/utils/BufferGeometryUtils.js'], FullScreenQuad: ['{ FullScreenQuad }', 'three/addons/postprocessing/Pass.js'] };
const SETTER = { needs: 'setNeeds', shadowsDirty: 'setShadowsDirty', RT_SCALE: 'setRtScale', ready: 'setReady' };
const order = PARTS.map(p => p[0]);
const modOf = s => { for (const [m, rs] of PARTS) for (const [x, y] of rs) if (s.line0 >= x && s.line0 <= y) return m; throw new Error('line ' + s.line0); };
const stmtMod = new Map(a.stmts.map(s => [s.i, modOf(s)]));
const ownerMod = n => EXT[n] ? null : stmtMod.get(a.owner[n]);
const rel = (from, to) => { let r = path.relative(path.dirname(from), to); return r.startsWith('.') ? r : './' + r; };
// what every module uses from the others
const use = new Map(order.map(m => [m, { names: new Set(), setters: new Set(), ext: new Set() }]));
for (const s of a.stmts) {
  if (s.i === 0) continue;   // `const [THREE, …] = LIB`: replaced by imports
  const m = stmtMod.get(s.i), u = use.get(m);
  for (const n of s.pureReads) { if (EXT[n]) u.ext.add(n); else if (ownerMod(n) !== m) u.names.add(n); }
  for (const n of s.writes) { if (ownerMod(n) === m) continue; if (!SETTER[n]) throw new Error('cross-module write without a setter: ' + n); u.setters.add(n); }
}
const exportsOf = new Map(order.map(m => [m, new Set()]));
for (const [m, u] of use) { for (const n of u.names) exportsOf.get(ownerMod(n)).add(n); for (const n of u.setters) exportsOf.get(ownerMod(n)).add(SETTER[n]); }
fs.rmSync(outDir, { recursive: true, force: true });
order.forEach((m, k) => {
  const st = a.stmts.filter(s => s.i !== 0 && stmtMod.get(s.i) === m).sort((x, y) => x.pos - y.pos);
  let body = st.map(s => {
    let t = text.slice(s.pos, s.end); const edits = s.wsites.filter(w => ownerMod(w.name) !== m).sort((x, y) => y.start - x.start);
    for (const w of edits) { if (w.op !== '=') throw new Error('compound write ' + w.name); t = t.slice(0, w.start - s.pos) + `${SETTER[w.name]}(${text.slice(w.rs, w.re)})` + t.slice(w.end - s.pos); }
    return t;
  }).join('').replace(/^\n+/, '');
  const u = use.get(m), lines = [];
  if (k > 0) lines.push(`import '${rel(m, order[k - 1])}';   // build order: the module before this one runs first`);
  for (const n of Object.keys(EXT)) if (u.ext.has(n)) lines.push(`import ${EXT[n][0]} from '${EXT[n][1]}';`);
  const from = new Map();
  for (const n of u.names) { const o = ownerMod(n); (from.get(o) || from.set(o, []).get(o)).push(n); }
  for (const n of u.setters) { const o = ownerMod(n); (from.get(o) || from.set(o, []).get(o)).push(SETTER[n]); }
  for (const o of order) if (from.has(o)) lines.push(`import { ${from.get(o).sort().join(', ')} } from '${rel(m, o)}';`);
  const own = Object.keys(SETTER).filter(n => ownerMod(n) === m && exportsOf.get(m).has(SETTER[n]));
  let tail = '';
  if (own.length) tail += '\n// other modules change these through a setter (an imported binding is read-only)\n' + own.map(n => `function ${SETTER[n]}(v) { ${n} = v; }`).join('\n') + '\n';
  const ex = [...exportsOf.get(m)].sort();
  if (ex.length) tail += `\nexport { ${ex.join(', ')} };\n`;
  const file = path.join(outDir, m); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n\n' + body.replace(/\s+$/, '') + '\n' + tail);
});
const main = `// The 3D library of Hidden Library: on wide screens the reading room is the page's interface (see ../ARCHITECTURE.md).
// The modules run in build order, which is also the order the room's objects are created in (their ids decide the draw
// order of surfaces at equal depth, and the shared random sequence is drawn in that order). Each module first imports
// the one built just before it, so importing the last one here runs them all in this order, whatever else they import
// from each other (a module may use a later one's functions; they are only called once everything has run):
${order.map((m, k) => '//   ' + String(k + 1).padStart(2) + '. ' + m).join('\n')}
// A new part goes in where it belongs in that order: it imports the module before it, and the module after it (or this
// file, at the end) imports it instead.
import './${order[order.length - 1]}';
`;
fs.writeFileSync(path.join(outDir, 'main.js'), main);
console.log('wrote', order.length + 1, 'modules to', outDir);
