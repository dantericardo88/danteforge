// Proof-anchor Pass 15 verify-SLO timing data.
//
// Captures the sequential vs parallel wall-time measurements + the SLO doc hash
// in a verifiable evidence bundle.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import 'tsx/esm';

const { createEvidenceBundle, sha256 } = await import('@danteforge/evidence-chain');

const ROOT = process.cwd();
const evidenceDir = resolve(ROOT, '.danteforge', 'evidence');
mkdirSync(evidenceDir, { recursive: true });

function getGitSha() {
  try { return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim(); }
  catch { return null; }
}

function readUtf8(rel) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) throw new Error(`Missing input: ${rel}`);
  return readFileSync(abs, 'utf-8');
}

const sloDocPath = '.danteforge/VERIFY_SLO.md';
const sloDocContent = readUtf8(sloDocPath);

const manifest = {
  schemaVersion: 1,
  pass: 15,
  passName: 'Verify SLO baseline + parallel-lane experiment (Pass 15)',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),
  measurementHardware: '8-core developer laptop, Node 24.13.1, Windows 11',

  baseline: {
    mode: 'sequential',
    command: 'npm test',
    totalWallTimeMs: 265900,
    totalWallTimeMin: 4.4,
    lanes: [
      { id: 'default',              files: 462, concurrency: 8, wallTimeMs: 103900 },
      { id: 'orchestration-heavy',  files: 20,  concurrency: 2, wallTimeMs: 10100  },
      { id: 'orchestration-e2e',    files: 2,   concurrency: 1, wallTimeMs: 1700   },
      { id: 'cli-process',          files: 5,   concurrency: 2, wallTimeMs: 150300 },
    ],
    fullVerifyEstimateMs: 280000,  // includes tsc + lint + anti-stub
    fullVerifyEstimateMin: 4.6,
  },

  experiment: {
    mode: 'parallel-3-lane',
    command: 'npm run test:parallel-experimental',
    hypothesis: 'Run default + cli-process + orchestration-heavy concurrently in Phase A, then orchestration-e2e in Phase B; expected ~max(default,cli-process,heavy) + e2e instead of sum.',
    totalWallTimeMs: 384400,
    totalWallTimeMin: 6.4,
    lanes: [
      { id: 'default',              files: 462, concurrency: 8, wallTimeMs: 269300, note: '2.6x slower than sequential — CPU oversubscription' },
      { id: 'orchestration-heavy',  files: 20,  concurrency: 2, wallTimeMs: 31400,  note: '3.1x slower' },
      { id: 'orchestration-e2e',    files: 2,   concurrency: 1, wallTimeMs: 1800   },
      { id: 'cli-process',          files: 5,   concurrency: 2, wallTimeMs: 382400, note: '2.5x slower; was the wall-time bottleneck' },
    ],
    result: 'failed',
    deltaPct: 45,
    cause: 'CPU oversubscription. Default lane runs at concurrency=8, saturating 8 cores. Phase A adds 2+2 more workers = 12 processes for 8 CPUs. Each lane ran 2-3x slower under contention.',
  },

  conclusion: 'Sequential `npm test` is the production gate. Parallel-lane execution does NOT pay off on CPU-bound machines. Parallel runner retained as `npm run test:parallel-experimental` for future hardware (16+ cores) but explicitly NOT wired into `verify`.',

  slo: {
    target: 'verify <= 5 min wall-time on 8-core dev laptop',
    currentBaseline: 'verify ~ 4.6 min',
    status: 'GREEN — within target',
    bands: {
      green:  { upToMin: 5,  action: 'within target' },
      yellow: { upToMin: 7,  action: 'investigate before next pass' },
      red:    { upToMin: 'any-above-yellow', action: 'profile per-lane + per-file before merging more changes' },
    },
  },

  sloDoc: {
    path: sloDocPath,
    sha256: sha256(sloDocContent),
  },

  futureOptimizationCandidates: [
    'tests/cli-release-readiness.test.ts (938 LOC, 44 tests, runTsxCli per test)',
    'tests/cli-stage2-remaining.test.ts (826 LOC, 88 tests)',
    'tests/autoforge-loop.test.ts (835 LOC, 78 tests, mkdtemp+scaffolding per test)',
    'tests/e2e-workflow.test.ts (794 LOC, 29 tests, full pipeline traversal)',
    'tests/autoforge.test.ts (592 LOC, 52 tests, mkdtemp+scaffold per test)',
    'tests/verify-light.test.ts (434 LOC, 17 tests, execFileSync sync child process)',
  ],

  optimizationPatternsThatPayOff: [
    'Shared per-suite tmpDir fixture (one mkdtemp per describe, not per test)',
    'Mock LLM caller via _llmCaller injection seams (already wired in many places)',
    'Batch related CLI tests into fewer subprocess spawns',
    'worker_threads instead of process-isolated tsx for non-isolating cases',
  ],
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_15_verify_slo',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-15-verify-slo.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored verify-SLO manifest: ${outPath}`);
console.log(`  baseline:              ${manifest.baseline.totalWallTimeMin} min (sequential)`);
console.log(`  experiment:            ${manifest.experiment.totalWallTimeMin} min (parallel) — FAILED, ${manifest.experiment.deltaPct}% slower`);
console.log(`  full-verify estimate:  ${manifest.baseline.fullVerifyEstimateMin} min`);
console.log(`  SLO status:            ${manifest.slo.status}`);
console.log(`  SLO doc hash:          ${manifest.sloDoc.sha256.slice(0, 16)}...`);
console.log(`  proof bundle:          ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:    ${manifest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  proof merkle root:     ${manifest.proof.merkleRoot.slice(0, 16)}...`);
console.log(`  git SHA:               ${manifest.gitSha?.slice(0, 8) ?? 'none'}`);
