import { readFileSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function extractLargeFns(content, threshold = 100) {
  const sf = ts.createSourceFile('temp.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const large = [];
  for (const stmt of sf.statements) {
    let name = null, text = null;
    if (ts.isFunctionDeclaration(stmt)) {
      name = stmt.name?.text ?? '(anonymous)';
      text = stmt.getFullText(sf);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          name = decl.name.getText ? decl.name.getText(sf) : String(decl.name.escapedText);
          text = stmt.getFullText(sf);
        }
      }
    }
    if (text && text.split('\n').length > threshold) {
      large.push({ name, lines: text.split('\n').length });
    }
  }
  return large;
}

function walkTs(dir) {
  const files = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) files.push(...walkTs(full));
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(full);
    }
  } catch {}
  return files;
}

let total = 0;
const byFile = [];
for (const f of walkTs('src')) {
  try {
    const content = readFileSync(f, 'utf8');
    const large = extractLargeFns(content);
    if (large.length > 0) {
      total += large.length;
      byFile.push({ file: f.replace(/\\/g, '/'), count: large.length, max: Math.max(...large.map(x => x.lines)), fns: large });
    }
  } catch {}
}
byFile.sort((a, b) => b.count - a.count);
console.log('Total large fns >100 LOC (AST-based):', total);
byFile.slice(0, 15).forEach(f => {
  console.log(`\n  [${f.count} fns, max ${f.max}L] ${f.file}`);
  f.fns.forEach(fn => console.log(`      ${fn.lines}L: ${fn.name}`));
});
