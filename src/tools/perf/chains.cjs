// node chains.cjs file.cpuprofile fnName [lineFilter]: heaviest call chains ending in fnName, and hot lines in it
const p = JSON.parse(require('fs').readFileSync(process.argv[2])); const want = process.argv[3], wl = process.argv[4] ? +process.argv[4] : null;
const byId = new Map(p.nodes.map(n => [n.id, n])); const parent = new Map(); for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
const dt = new Map(); for (let i = 0; i < p.samples.length; i++) dt.set(p.samples[i], (dt.get(p.samples[i]) || 0) + (p.timeDeltas[i + 1] || 0) / 1000);
const nm = n => `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`;
const chains = new Map(), lines = new Map();
for (const n of p.nodes) {
  if ((n.callFrame.functionName || '(anon)') !== want) continue; if (wl && n.callFrame.lineNumber + 1 !== wl) continue;
  const d = dt.get(n.id) || 0; if (!d) continue;
  const c = []; let x = parent.get(n.id); while (x !== undefined && c.length < 9) { c.push(nm(byId.get(x))); x = parent.get(x); }
  const k = c.join(' < '); chains.set(k, (chains.get(k) || 0) + d);
  for (const t of n.positionTicks || []) lines.set(t.line, (lines.get(t.line) || 0) + t.ticks);
}
[...chains].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, v]) => console.log(v.toFixed(0).padStart(6), k));
console.log('hot lines (ticks):', [...lines].sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => x.join(':')).join('  '));
