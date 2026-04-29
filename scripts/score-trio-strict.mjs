// Phase zeta -- strict-mode trio rescore. The basic computeHarshScore reads
// state.yaml signals only; the strict scorer additionally reads filesystem
// evidence (retros, verify receipts, oss-harvest.json) which is what we
// added in Phases alpha-gamma. Strict mode is what feeds the canonical score.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import 'tsx/esm';

const { computeCanonicalScore } = await import('../src/core/harsh-scorer.js');

const TARGETS = [
  { name: 'DanteForge', cwd: 'C:/Projects/DanteForge' }
];

const evidenceDir = resolve(process.cwd(), '.danteforge', 'evidence');
mkdirSync(evidenceDir, { recursive: true });

for (const t of TARGETS) {
  if (!existsSync(t.cwd)) {
    console.log(`SKIP ${t.name}`);
    continue;
  }
  console.log(`Strict-scoring ${t.name}...`);
  const canonical = await computeCanonicalScore(t.cwd);

  const summary = {
    repo: t.name,
    cwd: t.cwd,
    runAt: new Date().toISOString(),
    mode: canonical.source,
    gitSha: canonical.gitSha,
    computedAt: canonical.computedAt,
    overall: canonical.overall,
    dimensions: canonical.dimensions,
    threshold: 9.0,
    dimensionsAtOrAbove: Object.entries(canonical.dimensions).filter(([, v]) => v >= 9.0).map(([k]) => k),
    dimensionsBelow: Object.entries(canonical.dimensions).filter(([, v]) => v < 9.0).map(([k, v]) => ({ dim: k, score: v }))
  };

  const outPath = resolve(evidenceDir, `trio-score-strict-${basename(t.cwd).toLowerCase()}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8');

  console.log(`  ${t.name}: ${canonical.overall.toFixed(2)}/10 (${summary.dimensionsAtOrAbove.length}/${Object.keys(canonical.dimensions).length} >=9.0)`);
  console.log(`  Liftable dims status:`);
  for (const dim of ['maintainability', 'selfImprovement', 'autonomy', 'convergenceSelfHealing']) {
    const score = canonical.dimensions[dim];
    const flag = score >= 9.0 ? 'OK GREEN' : `BELOW (gap ${(9.0 - score).toFixed(2)})`;
    console.log(`    ${dim}: ${score?.toFixed(2)} [${flag}]`);
  }
  console.log(`  communityAdoption: ${canonical.dimensions.communityAdoption?.toFixed(2)} (ceiling 4.0 by design -- skipped)`);
}
