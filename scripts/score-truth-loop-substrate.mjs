// Phase 0 substrate scoring — runs the harsh-scorer against the current cwd
// (DanteForge) and extracts the 5 dimensions PRD-MASTER §5.7 #13 requires.
//
// Output: .danteforge/evidence/phase0-substrate-score.json

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { computeHarshScore } = await import('../src/core/harsh-scorer.js');

const REQUIRED = ['functionality', 'testing', 'errorHandling', 'specDrivenPipeline', 'contextEconomy'];

const result = await computeHarshScore({ cwd: process.cwd() });

const dims = {};
for (const k of REQUIRED) {
  dims[k] = result.displayDimensions[k] ?? 0;
}

const summary = {
  runAt: new Date().toISOString(),
  source: 'phase-0-substrate-scoring',
  prdReference: 'PRD-MASTER §5.7 #13',
  required: REQUIRED,
  scores: dims,
  overall: result.displayScore,
  threshold: 9.0,
  meetsThreshold: REQUIRED.every(k => (dims[k] ?? 0) >= 9.0),
  shortfalls: REQUIRED.filter(k => (dims[k] ?? 0) < 9.0).map(k => ({ dim: k, score: dims[k] }))
};

const evidenceDir = resolve(process.cwd(), '.danteforge', 'evidence');
mkdirSync(evidenceDir, { recursive: true });
const out = resolve(evidenceDir, 'phase0-substrate-score.json');
writeFileSync(out, JSON.stringify(summary, null, 2) + '\n', 'utf-8');

console.log(`Phase 0 substrate score: ${summary.overall.toFixed(2)}/10`);
for (const k of REQUIRED) {
  const s = dims[k];
  const flag = s >= 9.0 ? 'GREEN' : 'BELOW';
  console.log(`  ${k}: ${s.toFixed(2)} [${flag}]`);
}
console.log(`Meets all 5 ≥9.0: ${summary.meetsThreshold}`);
console.log(`Written to ${out}`);
