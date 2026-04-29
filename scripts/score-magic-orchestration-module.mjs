// Phase F -- explicit per-dim score evidence for the magic-level integration
// module. PRD-MASTER Section 8.2 #7: "Harsh double scoring matrix grades the
// magic-level integration at 9.0+ on Autonomy, Convergence Self-Healing,
// Token Economy, and Spec-Driven Pipeline dimensions."

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'tsx/esm';

const { computeHarshScore, applyStrictOverrides, computeStrictDimensions } = await import('../src/core/harsh-scorer.js');

const REQUIRED = ['autonomy', 'convergenceSelfHealing', 'tokenEconomy', 'specDrivenPipeline'];

console.log('Scoring DanteForge in strict mode (covers magic-level integration module)...');
const harsh = await computeHarshScore({ cwd: process.cwd() });
await applyStrictOverrides(harsh, process.cwd(), computeStrictDimensions);

const dims = {};
for (const k of REQUIRED) dims[k] = harsh.displayDimensions[k];

const STRUCTURAL_CAPS = {
  specDrivenPipeline: { cap: 8.5, reason: 'strictSpecDrivenPipeline capped at 85/100 by design -- file existence cannot fully prove pipeline execution quality' },
  convergenceSelfHealing: { cap: 9.5, reason: 'KNOWN_CEILINGS line 109 -- display <=9.5' }
};

const summary = {
  scoredAt: new Date().toISOString(),
  prdReference: 'PRD-MASTER Section 8.2 #7 -- magic-level integration scored at 9.0+ on 4 named dimensions',
  module: 'src/spine/magic_skill_orchestration/',
  scope: 'integration into DanteForge cwd (the module is part of DanteForge)',
  required: REQUIRED,
  scores: dims,
  threshold: 9.0,
  perDimStatus: REQUIRED.map(d => {
    const score = dims[d] ?? 0;
    const cap = STRUCTURAL_CAPS[d];
    if (score >= 9.0) return { dim: d, score, status: 'GREEN' };
    if (cap && score >= cap.cap - 0.05) return { dim: d, score, status: 'AT_STRUCTURAL_CAP', cap: cap.cap, reason: cap.reason };
    return { dim: d, score, status: 'BELOW_THRESHOLD', gap: 9.0 - score };
  }),
  meetsThreshold: REQUIRED.every(d => (dims[d] ?? 0) >= 9.0),
  meetsThresholdAccountingForCaps: REQUIRED.every(d => {
    const score = dims[d] ?? 0;
    const cap = STRUCTURAL_CAPS[d];
    return score >= 9.0 || (cap && score >= cap.cap - 0.05);
  })
};

const evidenceDir = resolve(process.cwd(), '.danteforge/evidence');
mkdirSync(evidenceDir, { recursive: true });
const out = resolve(evidenceDir, 'magic-orchestration-score.json');
writeFileSync(out, JSON.stringify(summary, null, 2) + '\n', 'utf-8');

console.log(`PRD-MASTER Section 8.2 #7 dimensions:`);
for (const ps of summary.perDimStatus) {
  const flag = ps.status === 'GREEN' ? 'OK GREEN' : ps.status === 'AT_STRUCTURAL_CAP' ? `AT CAP (${ps.cap})` : `BELOW (gap ${ps.gap?.toFixed(2)})`;
  console.log(`  ${ps.dim}: ${ps.score?.toFixed(2)}  [${flag}]`);
}
console.log(`Meets threshold strictly: ${summary.meetsThreshold}`);
console.log(`Meets threshold accounting for structural caps: ${summary.meetsThresholdAccountingForCaps}`);
console.log(`Evidence: ${out}`);
