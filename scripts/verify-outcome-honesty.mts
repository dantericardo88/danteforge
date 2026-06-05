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
let problems = 0;

for (const d of dims) {
  const issues: string[] = [];
  for (const o of d.outcomes ?? []) {
    if (!HIGH.has(o.tier)) continue;
    const cs = o.required_callsite;
    if (!cs) { issues.push(`${o.id}: T5+ has NO required_callsite`); problems++; continue; }
    if (cs.startsWith('tests/') || cs.endsWith('.test.ts')) { issues.push(`${o.id}: callsite is a TEST FILE (${cs})`); problems++; }
    else if (!fs.existsSync(path.join(cwd, cs))) { issues.push(`${o.id}: callsite MISSING on disk (${cs})`); problems++; }
  }
  // integrity-gate verdicts for this dim
  for (const v of report.violations.filter((v: any) => v.dimId === d.id)) {
    issues.push(`${v.outcomeId}: ${v.kind} — ${v.detail.slice(0, 90)}`);
    problems++;
  }
  if (issues.length) console.error(`✗ ${d.id}\n  ` + issues.join('\n  '));
  else if (only) console.error(`✓ ${d.id}: all T5+ outcomes honest (real wired callsite, referenced, seam-free)`);
}
console.error(`\n${problems === 0 ? 'CLEAN' : 'PROBLEMS=' + problems} (${dims.length} dim(s) checked)`);
process.exit(problems === 0 ? 0 : 1);
