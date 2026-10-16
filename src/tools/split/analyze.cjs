// node analyze.cjs module.js out.json : the top-level statements of the `if (LIB) { ... }` block, with the top-level names
// each declares, reads and writes (resolved by TypeScript's checker, so locals that shadow a top-level name are ignored)
const fs = require('fs');
const ts = require('/Users/michaeltran/.npm/_npx/5a9d879542beca3a/node_modules/typescript');
const [file, out] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8');
const host = ts.createCompilerHost({});
const orig = host.getSourceFile;
host.getSourceFile = (n, v) => n === 'm.js' ? ts.createSourceFile('m.js', text, v, true, ts.ScriptKind.JS) : orig(n, v);
host.fileExists = n => n === 'm.js' || ts.sys.fileExists(n); host.readFile = n => n === 'm.js' ? text : ts.sys.readFile(n);
const prog = ts.createProgram(['m.js'], { allowJs: true, noLib: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, noResolve: true }, host);
const checker = prog.getTypeChecker(), sf = prog.getSourceFile('m.js');
const ifs = sf.statements.find(s => ts.isIfStatement(s) && s.expression.getText(sf) === 'LIB');
const block = ifs.thenStatement, stmts = block.statements;
const lineOf = p => sf.getLineAndCharacterOfPosition(p).line + 1;
const topDecl = new Map();   // declaration node -> statement index
const declNames = stmts.map(() => []);
stmts.forEach((s, i) => {
  const addB = (b, node) => { if (ts.isIdentifier(b)) { declNames[i].push(b.text); topDecl.set(node || b.parent, i); } else for (const e of b.elements) if (!ts.isOmittedExpression(e)) addB(e.name, e); };
  if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) { declNames[i].push(s.name.text); topDecl.set(s, i); }
  else if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) { if (ts.isIdentifier(d.name)) { declNames[i].push(d.name.text); topDecl.set(d, i); } else addB(d.name); }
});
const kindOf = i => { const s = stmts[i]; return ts.isVariableStatement(s) ? (s.declarationList.flags & ts.NodeFlags.Let ? 'let' : s.declarationList.flags & ts.NodeFlags.Const ? 'const' : 'var') : ts.isFunctionDeclaration(s) ? 'function' : ts.isClassDeclaration(s) ? 'class' : 'stmt'; };
const ASSIGN = new Set([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, ts.SyntaxKind.AsteriskAsteriskEqualsToken, ts.SyntaxKind.CaretEqualsToken]);
const isWrite = id => { const p = id.parent;
  if (ts.isBinaryExpression(p) && p.left === id && ASSIGN.has(p.operatorToken.kind)) return true;
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return true;
  return false; };
const res = stmts.map((s, i) => ({ i, line0: lineOf(s.getStart(sf)), line1: lineOf(s.end), pos: s.getFullStart(), end: s.end, kind: kindOf(i), decl: declNames[i], reads: new Set(), pureReads: new Set(), writes: new Set(), wsites: [], evalReads: new Set(), head: s.getText(sf).split('\n')[0].slice(0, 90) }));
const resolve = id => {
  let sym = ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id ? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id);
  if (!sym || !sym.declarations) return null;
  for (const d of sym.declarations) if (topDecl.has(d)) return topDecl.get(d);
  return null;
};
// is node inside a function body (evaluated later), relative to the statement?
const inFunction = (node, stmt) => { for (let p = node.parent; p && p !== stmt.parent; p = p.parent) if (ts.isFunctionLike(p) && p !== stmt) return true; return ts.isFunctionDeclaration(stmt); };
stmts.forEach((s, i) => {
  const visit = n => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isDeclName = (ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isBindingElement(p) || ts.isParameter(p)) && p.name === n;
      const isProp = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || ts.isMethodDeclaration(p) && p.name === n || (ts.isBindingElement(p) && p.propertyName === n) || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p);
      if (!isDeclName && !isProp) {
        const j = resolve(n);
        if (j !== null) { const name = n.text; res[i].reads.add(name); if (isWrite(n)) { res[i].writes.add(name); const b = n.parent; res[i].wsites.push({ name, start: b.getStart(sf), end: b.end, op: ts.isBinaryExpression(b) ? b.operatorToken.getText(sf) : 'unary', rs: ts.isBinaryExpression(b) ? b.right.getStart(sf) : 0, re: ts.isBinaryExpression(b) ? b.right.end : 0 }); } else res[i].pureReads.add(name); if (!inFunction(n, s)) res[i].evalReads.add(name); }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(s);
});
const owner = {}; res.forEach(r => r.decl.forEach(n => { owner[n] = r.i; }));
fs.writeFileSync(out, JSON.stringify({ blockStart: lineOf(block.getStart(sf)), blockEnd: lineOf(block.end), owner, stmts: res.map(r => ({ ...r, reads: [...r.reads], pureReads: [...r.pureReads], writes: [...r.writes], evalReads: [...r.evalReads] })) }, null, 1));
console.log('statements', res.length, 'names', Object.keys(owner).length, 'block', lineOf(block.getStart(sf)), '-', lineOf(block.end));
