// One-shot scanner: find top-level functions >100 LOC in src/, matching the
// maturity engine's penalty heuristic. Uses regex fallback (matches the
// engine's fallback path) for stable comparison.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

const RE = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{/gm;
const files = scan('src');
const off = [];
for (const f of files) {
  const c = readFileSync(f, 'utf-8');
  const matches = [];
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(c)) !== null) {
    matches.push({ idx: m.index, name: m[1] || m[2] });
  }
  const lines = c.split('\n');
  for (let i = 0; i < matches.length; i++) {
    const start = c.slice(0, matches[i].idx).split('\n').length - 1;
    const end = i + 1 < matches.length ? c.slice(0, matches[i + 1].idx).split('\n').length - 1 : lines.length;
    const loc = end - start;
    if (loc > 100) off.push({ file: f.replace(/\\/g, '/'), name: matches[i].name, loc });
  }
}
off.sort((a, b) => b.loc - a.loc);
console.log('Top 30 over-100-LOC top-level functions (' + off.length + ' total):');
for (const o of off.slice(0, 30)) console.log('  ' + String(o.loc).padStart(4) + '  ' + o.name.padEnd(40) + o.file);
console.log(`\nMaturity penalty cap: 30. Current count×2 = ${off.length * 2} (capped).`);
