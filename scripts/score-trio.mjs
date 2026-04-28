// Phase F — score each repo of the DanteForge / DanteCode / DanteAgents trio
// against the harsh-scorer. PRD-MASTER §15 Success Metric #1: "Trio reaches
// 9.0+ on all 18 dimensions".
//
// Output: .danteforge/evidence/trio-score-<repo>.json (one per repo) plus
// .danteforge/TRIO_SCORE_REPORT.md aggregate summary.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const { computeHarshScore } = await import('../src/core/harsh-scorer.js');

const TARGETS = [
  { name: 'DanteForge', cwd: 'C:/Projects/DanteForge' },
  { name: 'DanteCode', cwd: 'C:/Projects/DanteCode' },
  { name: 'DanteAgents', cwd: 'C:/Projects/DanteAgents' }
];

const evidenceDir = resolve(process.cwd(), '.danteforge', 'evidence');
mkdirSync(evidenceDir, { recursive: true });

const results = [];

for (const t of TARGETS) {
  if (!existsSync(t.cwd)) {
    console.log(`SKIP ${t.name} — repo not found at ${t.cwd}`);
    results.push({ repo: t.name, status: 'missing', cwd: t.cwd });
    continue;
  }
  console.log(`Scoring ${t.name} (${t.cwd})...`);
  let r;
  try {
    r = await computeHarshScore({ cwd: t.cwd });
  } catch (e) {
    console.log(`  ERR: ${e.message?.slice(0, 200)}`);
    results.push({ repo: t.name, status: 'error', cwd: t.cwd, error: String(e.message ?? e) });
    continue;
  }
  const summary = {
    repo: t.name,
    cwd: t.cwd,
    runAt: new Date().toISOString(),
    overall: r.displayScore,
    dimensions: r.displayDimensions,
    threshold: 9.0,
    dimensionsAtOrAbove: Object.entries(r.displayDimensions).filter(([, v]) => v >= 9.0).map(([k]) => k),
    dimensionsBelow: Object.entries(r.displayDimensions).filter(([, v]) => v < 9.0).map(([k, v]) => ({ dim: k, score: v }))
  };
  results.push({ repo: t.name, status: 'scored', ...summary });
  const outPath = resolve(evidenceDir, `trio-score-${basename(t.cwd).toLowerCase()}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8');
  console.log(`  ${t.name}: ${summary.overall.toFixed(2)}/10 (${summary.dimensionsAtOrAbove.length}/${Object.keys(r.displayDimensions).length} ≥9.0)`);
}

// Aggregate report
const lines = [];
lines.push('# Trio Score Report');
lines.push('');
lines.push(`**Generated:** ${new Date().toISOString()}`);
lines.push(`**PRD reference:** PRD-MASTER §15 Success Metric #1`);
lines.push('');
lines.push('## Per-repo overall scores');
lines.push('');
lines.push('| Repo | Status | Overall | Dimensions ≥9.0 |');
lines.push('|---|---|---:|---|');
for (const r of results) {
  if (r.status === 'scored') {
    lines.push(`| ${r.repo} | scored | ${r.overall.toFixed(2)} | ${r.dimensionsAtOrAbove.length} / ${Object.keys(r.dimensions).length} |`);
  } else if (r.status === 'missing') {
    lines.push(`| ${r.repo} | not found | — | — |`);
  } else {
    lines.push(`| ${r.repo} | error | — | — |`);
  }
}
lines.push('');
lines.push('## Dimensions below 9.0 (P1 NextActions)');
lines.push('');
let anyShortfalls = false;
for (const r of results) {
  if (r.status !== 'scored') continue;
  if (r.dimensionsBelow.length === 0) {
    lines.push(`### ${r.repo}: all dimensions ≥9.0 ✓`);
    continue;
  }
  anyShortfalls = true;
  lines.push(`### ${r.repo}`);
  for (const s of r.dimensionsBelow) {
    lines.push(`- **${s.dim}:** ${s.score.toFixed(2)} (gap to 9.0: ${(9.0 - s.score).toFixed(2)})`);
  }
  lines.push('');
}
if (!anyShortfalls) {
  lines.push('All scored repos meet the 9.0+ threshold on all dimensions.');
}
lines.push('');
lines.push('## Acceptance');
lines.push('');
lines.push(`PRD-MASTER §15 Success Metric #1 — "Trio reaches 9.0+ on all 18 dimensions including new Context Economy dimension":`);
const allMet = results.filter(r => r.status === 'scored').every(r => r.dimensionsBelow.length === 0);
lines.push('');
lines.push(allMet ? '**MET** — every scored repo has all dimensions ≥9.0.' : '**PARTIAL** — see P1 NextActions above.');

const reportPath = resolve(process.cwd(), '.danteforge', 'TRIO_SCORE_REPORT.md');
writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8');
console.log(`\nReport written: ${reportPath}`);
console.log(`All scored repos ≥9.0 on all dims: ${allMet}`);
