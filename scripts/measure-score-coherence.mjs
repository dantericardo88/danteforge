// Measures coherence between compete matrix self-scores and live harsh scorer (strict mode)
// Metric: count of shared dimensions where |matrix_self - live_dim| > 0.2
// Also checks stale at-ceiling entries
// Target: 0

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const CWD = process.cwd();

// Load compete matrix self-scores
let matrixScores = {};
try {
  const m = JSON.parse(readFileSync(join(CWD, '.danteforge/compete/matrix.json'), 'utf8'));
  for (const d of m.dimensions) {
    matrixScores[d.id] = { self: d.scores?.self ?? 0, status: d.status, ceiling: d.ceiling ?? 10 };
  }
} catch { console.error('No compete matrix'); process.exit(1); }

// Map matrix dim IDs to harsh scorer dim names (snake_case → camelCase)
const DIM_MAP = {
  enterprise_readiness: 'enterpriseReadiness',
  community_adoption: 'communityAdoption',
  developer_experience: 'developerExperience',
  ux_polish: 'uxPolish',
  spec_driven_pipeline: 'specDrivenPipeline',
  self_improvement: 'selfImprovement',
  convergence_self_healing: 'convergenceSelfHealing',
  token_economy: 'tokenEconomy',
  planning_quality: 'planningQuality',
  error_handling: 'errorHandling',
  testing: 'testing',
  functionality: 'functionality',
  security: 'security',
  performance: 'performance',
  documentation: 'documentation',
  maintainability: 'maintainability',
  autonomy: 'autonomy',
  ecosystem_mcp: 'ecosystemMcp',
};

// KNOWN_CEILINGS from source (mirrors ascend-engine.ts)
const KNOWN_CEILINGS = {
  communityAdoption: 4.0,
  enterpriseReadiness: 9.0,
};

// Get live dimension scores from the built CLI (strict mode = most accurate)
let liveDims = {};
try {
  const output = execSync('node dist/index.js measure --strict --full 2>&1', {
    cwd: CWD,
    timeout: 30000,
    encoding: 'utf8',
  });
  // Parse lines like: "[INFO]   communityAdoption         1.5  (weight   2%)"
  for (const line of output.split('\n')) {
    const m = line.match(/(\w+)\s+([\d.]+)\s+\(weight/);
    if (m) {
      liveDims[m[1]] = parseFloat(m[2]);
    }
  }
} catch (e) {
  console.error('Failed to run live scorer:', e.message);
}

const staleCeilings = [];
const scoreDivergences = [];
const checked = [];

for (const [matrixId, matrixDim] of Object.entries(matrixScores)) {
  const harshDim = DIM_MAP[matrixId];
  if (!harshDim) continue;

  const matrixSelf = matrixDim.self;

  // Check stale ceiling
  const knownCeiling = KNOWN_CEILINGS[harshDim];
  const isCeilingStale = matrixDim.status === 'at-ceiling' && knownCeiling && matrixSelf < knownCeiling;
  if (isCeilingStale) {
    staleCeilings.push({ dim: matrixId, matrixSelf, ceiling: knownCeiling, delta: knownCeiling - matrixSelf });
  }

  // Check live score divergence
  const live = liveDims[harshDim];
  if (live !== undefined) {
    const delta = Math.abs(matrixSelf - live);
    checked.push({ matrixId, harshDim, matrixSelf, live, delta });
    if (delta > 0.2) {
      scoreDivergences.push({ dim: matrixId, harshDim, matrixSelf, live, delta: live - matrixSelf });
    }
  }
}

const totalIssues = staleCeilings.length + scoreDivergences.length;

console.log(`\nScore Coherence Report`);
console.log(`======================`);
console.log(`Dimensions checked: ${checked.length}`);

console.log(`\nStale at-ceiling entries:`);
if (staleCeilings.length === 0) {
  console.log('  None');
} else {
  for (const d of staleCeilings) {
    console.log(`  ${d.dim}: matrix.self=${d.matrixSelf}, known ceiling=${d.ceiling}`);
  }
}

console.log(`\nScore divergences (|matrix - live| > 0.2):`);
if (scoreDivergences.length === 0) {
  console.log('  None — all dimensions within 0.2 of live scorer');
} else {
  const sorted = scoreDivergences.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  for (const d of sorted) {
    const dir = d.delta > 0 ? 'live↑' : 'matrix↑';
    console.log(`  ${d.dim.padEnd(30)} matrix=${d.matrixSelf}, live=${d.live}, Δ=${Math.abs(d.delta).toFixed(1)} (${dir})`);
  }
}

console.log(`\nMETRIC score_divergence_count: ${totalIssues}`);
console.log(`  stale_ceilings: ${staleCeilings.length}`);
console.log(`  score_divergences: ${scoreDivergences.length}`);
console.log(`TARGET: 0`);
console.log(`GAP: ${totalIssues}`);
