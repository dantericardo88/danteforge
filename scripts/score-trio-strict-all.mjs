// Strict-mode scoring for all three repos. Mirrors score-trio-strict.mjs but
// scores DanteCode + DanteAgents in addition to DanteForge.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import 'tsx/esm';

const { computeCanonicalScore } = await import('../src/core/harsh-scorer.js');

const TARGETS = [
  { name: 'DanteForge', cwd: 'C:/Projects/DanteForge' },
  { name: 'DanteCode', cwd: 'C:/Projects/DanteCode' },
  { name: 'DanteAgents', cwd: 'C:/Projects/DanteAgents' }
];

const evidenceDir = resolve(process.cwd(), '.danteforge', 'evidence');
mkdirSync(evidenceDir, { recursive: true });

const allDims = new Set();
const results = [];
for (const t of TARGETS) {
  if (!existsSync(t.cwd)) { console.log(`SKIP ${t.name}`); continue; }
  console.log(`Strict-scoring ${t.name}...`);
  const canonical = await computeCanonicalScore(t.cwd);
  const summary = {
    repo: t.name, cwd: t.cwd, runAt: new Date().toISOString(), mode: canonical.source,
    gitSha: canonical.gitSha, computedAt: canonical.computedAt,
    overall: canonical.overall, dimensions: canonical.dimensions, threshold: 9.0,
    dimensionsAtOrAbove: Object.entries(canonical.dimensions).filter(([, v]) => v >= 9.0).map(([k]) => k),
    dimensionsBelow: Object.entries(canonical.dimensions).filter(([, v]) => v < 9.0).map(([k, v]) => ({ dim: k, score: v }))
  };
  for (const d of Object.keys(canonical.dimensions)) allDims.add(d);
  results.push(summary);
  const outPath = resolve(evidenceDir, `trio-strict-${basename(t.cwd).toLowerCase()}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8');
  console.log(`  ${t.name}: ${canonical.overall.toFixed(2)}/10 (${summary.dimensionsAtOrAbove.length}/${Object.keys(canonical.dimensions).length} >=9.0)`);
}

// Cross-trio gap summary
console.log('\n=== Cross-trio gap heatmap (strict mode) ===');
const dims = [...allDims].sort();
console.log('dim'.padEnd(28) + 'DF'.padStart(6) + 'DC'.padStart(6) + 'DA'.padStart(6) + '   trioGap (lift to 9.0)');
for (const d of dims) {
  const sf = results[0]?.dimensions?.[d];
  const sc = results[1]?.dimensions?.[d];
  const sa = results[2]?.dimensions?.[d];
  const gap = ['','',''].map((_, i) => {
    const v = results[i]?.dimensions?.[d];
    return v === undefined ? 0 : Math.max(0, 9.0 - v);
  }).reduce((a,b)=>a+b,0);
  if (gap === 0) continue;
  const fmt = (v) => v === undefined ? '  -- ' : v.toFixed(1).padStart(5);
  console.log(d.padEnd(28) + fmt(sf) + fmt(sc) + fmt(sa) + '   ' + gap.toFixed(1));
}

// Identify the dimension with the largest cross-trio lift potential
const ranked = [];
for (const d of dims) {
  const gaps = results.map(r => r?.dimensions?.[d] === undefined ? 0 : Math.max(0, 9.0 - r.dimensions[d]));
  const total = gaps.reduce((a,b)=>a+b,0);
  if (total > 0) ranked.push({ dim: d, total, dfGap: gaps[0], dcGap: gaps[1], daGap: gaps[2] });
}
ranked.sort((a,b) => b.total - a.total);
console.log('\n=== Top 10 cross-trio gaps (excluding communityAdoption capped by design) ===');
for (const r of ranked.filter(r => r.dim !== 'communityAdoption').slice(0, 10)) {
  console.log(`  ${r.dim.padEnd(28)} totalGap=${r.total.toFixed(1)}  (DF=${r.dfGap.toFixed(1)}, DC=${r.dcGap.toFixed(1)}, DA=${r.daGap.toFixed(1)})`);
}

const reportPath = resolve(evidenceDir, 'trio-strict-cross-gap.json');
writeFileSync(reportPath, JSON.stringify({ runAt: new Date().toISOString(), results, ranked }, null, 2) + '\n', 'utf-8');
console.log(`\nCross-gap evidence: ${reportPath}`);
