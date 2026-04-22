import { readFileSync, readdirSync } from 'fs';
import path from 'path';

function findClosingBrace(content, start) {
  let depth = 0, inString = false, stringChar = '';
  for (let i = start; i < content.length; i++) {
    const ch = content[i], prev = content[i-1];
    if (!inString) {
      if ((ch === '"' || ch === "'" || ch === '`') && prev !== '\\') { inString=true; stringChar=ch; }
      else if (ch==='{') depth++;
      else if (ch==='}') { depth--; if (depth===0) return i+1; }
    } else { if (ch===stringChar && prev!=='\\') inString=false; }
  }
  return content.length;
}

const REGEX = /function\s+\w+\s*\([^)]*\)[^{]*\{|const\s+\w+\s*=\s*\([^)]*\)\s*=>\s*\{|async\s+function\s+\w+\s*\([^)]*\)[^{]*\{/g;

function extractFunctions(content) {
  const fns = [];
  REGEX.lastIndex = 0;
  let m;
  while ((m = REGEX.exec(content)) !== null) {
    const end = findClosingBrace(content, m.index);
    fns.push({ sig: m[0].slice(0, 60), text: content.slice(m.index, end) });
  }
  return fns;
}

function walkTs(dir) {
  const files = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walkTs(full));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(full);
  }
  return files;
}

let totalLarge = 0;
const topFiles = [];
for (const f of walkTs('src')) {
  const content = readFileSync(f, 'utf8');
  const fns = extractFunctions(content);
  const large = fns.filter(fn => fn.text.split('\n').length > 100);
  if (large.length > 0) {
    totalLarge += large.length;
    topFiles.push({
      file: f.replace(/\\/g, '/').replace('src/', 'src/'),
      count: large.length,
      max: Math.max(...large.map(fn => fn.text.split('\n').length)),
      fns: large.map(fn => ({ sig: fn.sig, lines: fn.text.split('\n').length }))
    });
  }
}
topFiles.sort((a, b) => b.count - a.count);
console.log('Total large fns >100 LOC (maturity-engine extractor):', totalLarge);
topFiles.slice(0, 15).forEach(f => {
  console.log(`\n  [${f.count} fns, max ${f.max}L] ${f.file}`);
  f.fns.forEach(fn => console.log(`      ${fn.lines}L: ${fn.sig}`));
});
