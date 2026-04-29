/**
 * E2E convergence runtime test — exercises the magic-level orchestration
 * runtime's convergence-on-dimension loop with a scorer that ramps from
 * below-threshold → above-threshold across attempts. Closes PRD-MASTER §8.2 #4
 * (orchestrations emit complete evidence chains) and feeds the
 * convergenceSelfHealing harsh-scorer dimension via the
 * `hasE2EConvergenceTest` evidence flag.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runMagicLevelOrchestration } from '../src/spine/magic_skill_orchestration/runtime.js';
import type { SkillExecutor } from '../src/spine/skill_runner/runner.js';
import type { DanteSkill } from '../src/spine/magic_skill_orchestration/index.js';
import type { SkillFrontmatter } from '../src/spine/skill_runner/types.js';

let workspace: string;
const okExecutor: SkillExecutor = async () => ({ output: { ok: true }, surfacedAssumptions: [] });
const executors: Partial<Record<DanteSkill, SkillExecutor>> = {
  'dante-to-prd': okExecutor,
  'dante-grill-me': okExecutor,
  'dante-tdd': okExecutor,
  'dante-design-an-interface': okExecutor,
  'dante-triage-issue': okExecutor
};
const frontmatterByStep: Partial<Record<DanteSkill, SkillFrontmatter>> = {
  'dante-to-prd': { name: 'dante-to-prd', description: 't', requiredDimensions: ['specDrivenPipeline', 'planningQuality', 'documentation'] },
  'dante-grill-me': { name: 'dante-grill-me', description: 't', requiredDimensions: ['planningQuality', 'specDrivenPipeline'] },
  'dante-tdd': { name: 'dante-tdd', description: 't', requiredDimensions: ['testing', 'errorHandling', 'maintainability'] },
  'dante-design-an-interface': { name: 'dante-design-an-interface', description: 't', requiredDimensions: ['functionality', 'maintainability', 'developerExperience'] },
  'dante-triage-issue': { name: 'dante-triage-issue', description: 't', requiredDimensions: ['errorHandling', 'testing', 'functionality'] }
};

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'e2e-convergence-'));
  mkdirSync(resolve(workspace, '.danteforge'), { recursive: true });
});

test('e2e convergence: nova ramps an under-threshold dim to ≥9.0 across retries', async () => {
  // Scorer simulates a real convergence story: first attempt 8.0 (below threshold),
  // second attempt 9.5 (above). The runtime should retry and eventually pass.
  let attemptsByStep = new Map<string, number>();
  const rampScorer = (dims: string[]): Record<string, number> => {
    // We don't know which step is calling — use total call count as proxy
    const key = dims.join(',');
    const n = (attemptsByStep.get(key) ?? 0) + 1;
    attemptsByStep.set(key, n);
    const baseScore = n >= 2 ? 9.5 : 8.0;
    const out: Record<string, number> = {};
    for (const d of dims) out[d] = baseScore;
    return out;
  };

  const result = await runMagicLevelOrchestration({
    level: 'nova',
    inputs: { conversation: 'goal', changeName: 'e2e-convergence' },
    repo: workspace,
    forcedRunId: 'run_20260428_700',
    executors,
    frontmatterByStep,
    scorer: rampScorer,
    maxConvergenceRetries: 3,
    onHumanCheckpoint: () => { /* swallow */ }
  });

  // Steps in nova workflow that have convergeOnDimension should retry once
  const retryingSteps = result.steps.filter(s => s.attempts >= 2);
  assert.ok(retryingSteps.length >= 1, `expected ≥1 step to retry; got attempts=[${result.steps.map(s => s.attempts).join(',')}]`);

  // Persistence proof: chain_hash must be a sha256, run.json must round-trip
  const runJsonPath = resolve(result.outputDir, 'run.json');
  assert.ok(existsSync(runJsonPath));
  const persisted = JSON.parse(readFileSync(runJsonPath, 'utf-8'));
  assert.equal(persisted.runId, 'run_20260428_700');
  const chainHash = readFileSync(resolve(result.outputDir, 'chain_hash.txt'), 'utf-8');
  assert.match(chainHash, /^[a-f0-9]{64}$/);
});

test('e2e convergence: nova exhausts retries when scorer never crosses threshold', async () => {
  const stuckScorer = (dims: string[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const d of dims) out[d] = 7.0;  // never reaches 9.0
    return out;
  };

  const result = await runMagicLevelOrchestration({
    level: 'nova',
    inputs: { conversation: 'goal', changeName: 'stuck-convergence' },
    repo: workspace,
    forcedRunId: 'run_20260428_701',
    executors,
    frontmatterByStep,
    scorer: stuckScorer,
    maxConvergenceRetries: 2,
    onHumanCheckpoint: () => { /* swallow */ }
  });

  // First step should max out retries (1 + 2 = 3 attempts) then autopause
  const firstStep = result.steps[0]!;
  assert.equal(firstStep.attempts, 3, `expected 3 attempts, got ${firstStep.attempts}`);
  assert.notEqual(result.overallStatus, 'green');
});

test('e2e convergence: chain_hash differs across runs with different convergence outcomes', async () => {
  let mode: 'green' | 'red' = 'green';
  const dynamicScorer = (dims: string[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const d of dims) out[d] = mode === 'green' ? 9.5 : 7.0;
    return out;
  };

  mode = 'green';
  const r1 = await runMagicLevelOrchestration({
    level: 'magic',
    inputs: {},
    repo: workspace,
    forcedRunId: 'run_20260428_702',
    executors,
    frontmatterByStep,
    scorer: dynamicScorer,
    maxConvergenceRetries: 0,
    onHumanCheckpoint: () => {}
  });
  const hash1 = readFileSync(resolve(r1.outputDir, 'chain_hash.txt'), 'utf-8');

  mode = 'red';
  const r2 = await runMagicLevelOrchestration({
    level: 'magic',
    inputs: {},
    repo: workspace,
    forcedRunId: 'run_20260428_703',
    executors,
    frontmatterByStep,
    scorer: dynamicScorer,
    maxConvergenceRetries: 0,
    onHumanCheckpoint: () => {}
  });
  const hash2 = readFileSync(resolve(r2.outputDir, 'chain_hash.txt'), 'utf-8');

  // Different convergence outcomes ⇒ different evidence chains ⇒ different hashes
  assert.notEqual(hash1, hash2, 'chain_hash should differ across runs with different outcomes');
});
