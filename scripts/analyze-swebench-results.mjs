// analyze-swebench-results.mjs — read a SWE-bench grade report dir and print the failure-mode distribution.
// Turns a bare "resolved N/M" into a diagnosis: how many unresolved instances are the tractable
// fixed-but-regressed mode vs genuine no-fix. Usage:
//   npx tsx scripts/analyze-swebench-results.mjs <report-dir>
import 'tsx/esm';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const { categorizeInstanceResult, summarizeResults } = await import('../src/matrix/engines/swebench-failure-analysis.ts');

const dir = process.argv[2];
if (!dir || !existsSync(dir)) { console.error('usage: analyze-swebench-results.mjs <report-dir>'); process.exit(2); }

const reports = [];
for (const name of readdirSync(dir)) {
  const sub = join(dir, name);
  if (!statSync(sub).isDirectory()) continue;
  const rp = join(sub, 'report.json');
  if (existsSync(rp)) { try { reports.push(JSON.parse(readFileSync(rp, 'utf8'))); } catch { /* skip malformed */ } }
}
if (reports.length === 0) { console.error(`no report.json files under ${dir}`); process.exit(1); }

for (const r of reports) {
  const a = categorizeInstanceResult(r);
  console.log(`${a.instanceId.padEnd(42)} ${a.category.padEnd(20)} target ${a.targetFixed}/${a.targetTotal} | regressions ${a.regressions}`);
}
const s = summarizeResults(reports);
console.log('\n── summary ──');
console.log(`resolved ${s.resolved}/${s.total} (pass_rate ${(s.passRate * 100).toFixed(1)}%)`);
for (const [cat, n] of Object.entries(s.byCategory)) if (n > 0) console.log(`  ${cat}: ${n}`);
console.log(`fixed-but-regressed share of unresolved: ${(s.regressionShareOfUnresolved * 100).toFixed(0)}% ` +
  `(high = the climb is regression-discipline; low = genuine fix-capability gap)`);
