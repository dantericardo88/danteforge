// AST-based scanner matching maturity-engine extractFunctions exactly.
// Top-level FunctionDeclaration + VariableStatement(arrow|fnExpr).
// Size = getFullText(sf).split('\n').length.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function scan(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist' || f.startsWith('.')) continue;
    const fp = join(dir, f);
    const s = statSync(fp);
    if (s.isDirectory()) out.push(...scan(fp));
    else if (f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts')) out.push(fp);
  }
  return out;
}

const files = scan('src');
const off = [];
for (const f of files) {
  const content = readFileSync(f, 'utf-8');
  const sf = ts.createSourceFile('temp.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fns = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      const name = stmt.name?.escapedText || '<anon>';
      fns.push({ name, text: stmt.getFullText(sf) });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          const name = decl.name.getText(sf);
          fns.push({ name, text: stmt.getFullText(sf) });
        }
      }
    }
  }
  for (const fn of fns) {
    const loc = fn.text.split('\n').length;
    if (loc > 100) off.push({ file: f.replace(/\\/g, '/'), name: fn.name, loc });
  }
}
off.sort((a, b) => b.loc - a.loc);
console.log('AST-mode top 30 over-100-LOC top-level functions (' + off.length + ' total):');
for (const o of off.slice(0, 30)) console.log('  ' + String(o.loc).padStart(4) + '  ' + String(o.name).padEnd(40) + o.file);
console.log(`\nMaturity penalty cap: 30. Current count×2 = ${off.length * 2} (capped).`);
