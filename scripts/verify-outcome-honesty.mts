// verify-outcome-honesty.mts — gate for re-authored outcomes. For each dim (or one
// named dim), checks every T5+ outcome: (1) required_callsite file EXISTS, (2) the
// command's test file(s) genuinely reference the callsite (so the integrity
// coupling gate passes HONESTLY, not via a fabricated string), (3) no injection
// seams. Reports violations so a re-authored suite can't silently re-introduce the
// fabricated-callsite problem. Usage: tsx scripts/verify-outcome-honesty.mts [dimId]
import fs from 'node:fs';
import path from 'node:path';
import { checkOutcomeIntegrity } from '../src/matrix/engines/outcome-integrity.js';

const cwd = process.cwd();
const only = process.argv[2];
const m = JSON.parse(fs.readFileSync(path.join(cwd, '.danteforge/compete/matrix.json'), 'utf8'));
const dims = m.dimensions.filter((d: any) => !only || d.id === only);

const report = await checkOutcomeIntegrity(dims, cwd);
const HIGH = new Set(['T5', 'T6', 'T7']);
const T4PLUS = new Set(['T4', 'T5', 'T6', 'T7']);

// Orphan (production-wiring) check. The integrity gate only checks test↔callsite
// coupling; it does NOT catch a module that exists + has a seam-free test but is
// never CALLED by production (an orphan). Depth Doctrine: T4+ requires the
// production callsite to be wired. We detect wiring by scanning every non-test
// src file for an import of the module (`<basename>.js'`) — substring matching so
// it catches static AND dynamic import()/registrar wiring (the static-only scan
// false-flagged dynamically-imported CLI commands as orphans).
const srcCorpus: Array<{ file: string; content: string }> = [];
(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts') && !e.name.includes('.test.')) {
      try { srcCorpus.push({ file: path.resolve(p), content: fs.readFileSync(p, 'utf8') }); } catch { /* skip */ }
    }
  }
})(path.join(cwd, 'src'));
function isWired(callsite: string): boolean {
  const base = path.basename(callsite).replace(/\.ts$/, '');
  const self = path.resolve(cwd, callsite);
  const a = `${base}.js'`, b = `${base}.js"`;
  return srcCorpus.some(({ file, content }) => file !== self && (content.includes(a) || content.includes(b)));
}

let problems = 0;

for (const d of dims) {
  const issues: string[] = [];
  for (const o of d.outcomes ?? []) {
    const cs = o.required_callsite;
    // Orphan check applies to T4+ (production-callsite-wired tier and above).
    if (T4PLUS.has(o.tier) && cs && !cs.startsWith('tests/') && !cs.endsWith('.test.ts')
        && fs.existsSync(path.join(cwd, cs)) && !isWired(cs)) {
      issues.push(`${o.id}: ORPHAN callsite (${cs}) — exists but NO production code imports it; honest tier is T2`);
      problems++;
    }
    if (!HIGH.has(o.tier)) continue;
    if (!cs) { issues.push(`${o.id}: T5+ has NO required_callsite`); problems++; continue; }
    if (cs.startsWith('tests/') || cs.endsWith('.test.ts')) { issues.push(`${o.id}: callsite is a TEST FILE (${cs})`); problems++; }
    else if (!fs.existsSync(path.join(cwd, cs))) { issues.push(`${o.id}: callsite MISSING on disk (${cs})`); problems++; }
  }
  // integrity-gate verdicts for this dim. MARKET_DIM is the HONEST market cap
  // (community_adoption / enterprise_readiness can't exceed 5.0 on internal
  // evidence) — it's expected, not a fabrication, so it does not count as a problem.
  for (const v of report.violations.filter((v: any) => v.dimId === d.id && v.kind !== 'MARKET_DIM')) {
    issues.push(`${v.outcomeId}: ${v.kind} — ${v.detail.slice(0, 90)}`);
    problems++;
  }
  if (issues.length) console.error(`✗ ${d.id}\n  ` + issues.join('\n  '));
  else if (only) console.error(`✓ ${d.id}: all T5+ outcomes honest (real wired callsite, referenced, seam-free)`);
}
console.error(`\n${problems === 0 ? 'CLEAN' : 'PROBLEMS=' + problems} (${dims.length} dim(s) checked)`);
process.exit(problems === 0 ? 0 : 1);
