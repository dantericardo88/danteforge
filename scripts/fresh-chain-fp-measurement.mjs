// Pass 27 F-004 remediation — fresh-chain false-positive measurement.
// Builds N independent 1000-commit chains and runs verifyTimeMachine on each.
// A statistical FP rate (not a determinism check) requires fresh chains per iteration.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import 'tsx/esm';

const { runTimeMachineValidation } = await import('../src/core/time-machine-validation.ts');

const ROOT = process.cwd();
const NUM_CHAINS = parseInt(process.argv[2] ?? '20', 10);
const COMMITS_PER_CHAIN = parseInt(process.argv[3] ?? '100', 10);

console.log(`Fresh-chain FP measurement: ${NUM_CHAINS} chains × ${COMMITS_PER_CHAIN} commits each`);

const results = [];
let falsePositives = 0;
const startWall = Date.now();

for (let i = 0; i < NUM_CHAINS; i += 1) {
  const ws = mkdtempSync(resolve(tmpdir(), `fresh-chain-${i}-`));
  const verifyMs0 = Date.now();
  try {
    // Use smoke-mode clean-run count, but force the chain length reported by the receipt.
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['A'],
      scale: 'smoke',
      commitCountOverride: COMMITS_PER_CHAIN,
      now: () => new Date(2026, 3, 29, 23, 0, i).toISOString(),
    });
    const a = report.classes.A;
    if (!a) {
      throw new Error('Class A result missing');
    }
    // Class A on smoke scale runs the false-positive sub-test internally.
    // We additionally count any clean-chain FP across the iteration set.
    const fp = a.cleanChainFalsePositives ?? 0;
    if (fp > 0) falsePositives += fp;
    results.push({
      iteration: i,
      cleanChainFalsePositives: fp,
      cleanChainFalsePositiveRuns: a.cleanChainFalsePositiveRuns ?? 0,
      adversarialDetected: a.adversarialDetections.filter(x => x.detected).length,
      adversarialTotal: a.adversarialDetections.length,
      maxDetectionMs: a.maxDetectionMs,
      iterationMs: Date.now() - verifyMs0,
    });
    process.stdout.write(`  iter ${i + 1}/${NUM_CHAINS}: ${fp} FP, ${a.adversarialDetections.filter(x => x.detected).length}/${a.adversarialDetections.length} mods detected (${Date.now() - verifyMs0}ms)\n`);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

const totalWall = Date.now() - startWall;

const report = {
  schemaVersion: 1,
  scenario: 'F-004 remediation — fresh-chain false-positive measurement (independent chains per iteration)',
  generatedAt: new Date().toISOString(),
  parameters: { numChains: NUM_CHAINS, commitsPerChain: COMMITS_PER_CHAIN },
  aggregate: {
    totalChains: NUM_CHAINS,
    totalFalsePositives: falsePositives,
    falsePositiveRate: falsePositives / NUM_CHAINS,
    totalWallMs: totalWall,
    averageMsPerChain: Math.round(totalWall / NUM_CHAINS),
  },
  perIteration: results,
};

const outDir = resolve(ROOT, '.danteforge', 'evidence', 'pass-27-runs');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'fresh-chain-fp.json');
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');

console.log(`\nFresh-chain FP measurement: ${NUM_CHAINS} chains, ${falsePositives} FPs, rate ${(falsePositives / NUM_CHAINS).toFixed(4)}`);
console.log(`Total wall: ${totalWall}ms`);
console.log(`Report: ${outPath}`);
