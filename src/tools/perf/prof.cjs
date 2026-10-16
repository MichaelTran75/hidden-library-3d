// node prof.cjs file.cpuprofile : self and total time per function (ms), top N
const p = JSON.parse(require('fs').readFileSync(process.argv[2]));
const N = +process.argv[3] || 40;
const byId = new Map(p.nodes.map(n => [n.id, n]));
const parent = new Map(); for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
const dt = new Map(); const ts = p.timeDeltas; let t = p.startTime;
for (let i = 0; i < p.samples.length; i++) { const d = (ts[i + 1] || 0) / 1000; dt.set(p.samples[i], (dt.get(p.samples[i]) || 0) + d); }
const key = n => { const f = n.callFrame; return `${f.functionName || '(anon)'} ${f.url.split('/').pop().slice(0, 30)}:${f.lineNumber + 1}`; };
const self = new Map(), total = new Map();
for (const [id, d] of dt) {
  const n = byId.get(id); self.set(key(n), (self.get(key(n)) || 0) + d);
  const seen = new Set(); let x = id; while (x !== undefined) { const k = key(byId.get(x)); if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) || 0) + d); } x = parent.get(x); }
}
const show = (m, title) => { console.log('== ' + title); [...m].sort((a, b) => b[1] - a[1]).slice(0, N).forEach(([k, v]) => console.log(v.toFixed(0).padStart(7), k)); };
show(self, 'self'); show(total, 'total');
