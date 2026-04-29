// Monorepo-aware AST scanner — mirrors maturity-engine extractFunctions exactly,
// walking both src/ and packages/*/src/ to match getProjectSourceDirs.
// Usage: node scripts/find-large-functions-ast-monorepo.mjs <repo_path>

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const repoArg = process.argv[2] || '.';

function getProjectSourceDirs(cwd) {
  const dirs = [];
  if (existsSync(join(cwd, 'src'))) dirs.push(join(cwd, 'src'));
  const packagesDir = join(cwd, 'packages');
  if (existsSync(packagesDir)) {
    for (const e of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const pkgSrc = join(packagesDir, e.name, 'src');
      if (existsSync(pkgSrc)) dirs.push(pkgSrc);
    }
  }
  return dirs;
}

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

const srcDirs = getProjectSourceDirs(repoArg);
console.log(`Scanning ${srcDirs.length} source dir(s) in ${repoArg}:`);
for (const d of srcDirs) console.log('  ' + d);

const off = [];
let totalFiles = 0;
for (const srcDir of srcDirs) {
  const files = scan(srcDir);
  totalFiles += files.length;
  for (const f of files) {
    let content;
    try { content = readFileSync(f, 'utf-8'); } catch { continue; }
    const sf = ts.createSourceFile('temp.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt)) {
        const name = stmt.name?.escapedText || '<anon>';
        const loc = stmt.getFullText(sf).split('\n').length;
        if (loc > 100) off.push({ file: f.replace(/\\/g, '/'), name: String(name), loc });
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            const name = decl.name.getText(sf);
            const loc = stmt.getFullText(sf).split('\n').length;
            if (loc > 100) off.push({ file: f.replace(/\\/g, '/'), name: String(name), loc });
          }
        }
      }
    }
  }
}
off.sort((a, b) => b.loc - a.loc);
console.log(`\nScanned ${totalFiles} .ts files. ${off.length} functions over 100 LOC.`);
console.log('\nTop 30:');
for (const o of off.slice(0, 30)) console.log('  ' + String(o.loc).padStart(4) + '  ' + String(o.name).padEnd(40) + o.file);
console.log(`\nMaturity penalty: count×2 = ${off.length * 2} (capped at 30).`);
