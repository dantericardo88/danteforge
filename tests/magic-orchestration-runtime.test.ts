import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runMagicLevelOrchestration } from '../src/spine/magic_skill_orchestration/runtime.js';
import type { SkillExecutor } from '../src/spine/skill_runner/runner.js';
import type { DanteSkill } from '../src/spine/magic_skill_orchestration/index.js';

let workspace: string;

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'magic-orchestrate-'));
  mkdirSync(resolve(workspace, '.danteforge'), { recursive: true });
});

const okExecutor: SkillExecutor = async () => ({ output: { ok: true }, surfacedAssumptions: [] });

const failingExecutor: SkillExecutor = async () => ({ output: { ok: false }, surfacedAssumptions: [] });

const executors: Partial<Record<DanteSkill, SkillExecutor>> = {
  'dante-to-prd': okExecutor,
  'dante-grill-me': okExecutor,
  'dante-tdd': okExecutor,
  'dante-triage-issue': okExecutor,
  'dante-design-an-interface': okExecutor
};

// Test workspace doesn't have SKILL.md files; inject frontmatter so the harsh-score
// gate evaluates the dimensions the tests intend to exercise.
import type { SkillFrontmatter } from '../src/spine/skill_runner/types.js';
const frontmatterByStep: Partial<Record<DanteSkill, SkillFrontmatter>> = {
  'dante-to-prd': { name: 'dante-to-prd', description: 't', requiredDimensions: ['specDrivenPipeline', 'planningQuality', 'documentation'] },
  'dante-grill-me': { name: 'dante-grill-me', description: 't', requiredDimensions: ['planningQuality', 'specDrivenPipeline'] },
  'dante-tdd': { name: 'dante-tdd', description: 't', requiredDimensions: ['testing', 'errorHandling', 'maintainability'] },
  'dante-triage-issue': { name: 'dante-triage-issue', description: 't', requiredDimensions: ['errorHandling', 'testing', 'functionality'] },
  'dante-design-an-interface': { name: 'dante-design-an-interface', description: 't', requiredDimensions: ['functionality', 'maintainability', 'developerExperience'] }
};
const failingExecutorRef = failingExecutor; void failingExecutorRef; // keep reference live for callers below

const greenScorer = (): Record<string, number> => ({
  specDrivenPipeline: 9.5, planningQuality: 9.4, documentation: 9.2,
  testing: 9.5, errorHandling: 9.3, maintainability: 9.1,
  functionality: 9.4, developerExperience: 9.0
});

test('runtime: green-path canvas chain produces step-per-skill, all green', async () => {
  const result = await runMagicLevelOrchestration({
    level: 'canvas',
    inputs: { conversation: 'Goal: ship a feature', changeName: 'green-canvas' },
    repo: workspace,
    forcedRunId: 'run_20260428_500',
    executors,
    frontmatterByStep,
    scorer: greenScorer,
    onHumanCheckpoint: () => { /* swallow checkpoint pause */ }
  });

  // Canvas defaults to human_checkpoint after every step → first step is green but workflow pauses
  assert.equal(result.overallStatus, 'paused');
  assert.equal(result.steps[0]!.status, 'green');
  assert.equal(result.steps[0]!.gate, 'human_checkpoint');
  assert.ok(existsSync(resolve(result.outputDir, 'run.json')));
  assert.ok(existsSync(resolve(result.outputDir, 'report.md')));
  assert.ok(existsSync(resolve(result.outputDir, 'chain_hash.txt')));
});

test('runtime: magic level autopauses on autopause_on_fail when scorer fails', async () => {
  const result = await runMagicLevelOrchestration({
    level: 'magic',
    inputs: { conversation: 'goal', changeName: 'autopause-test' },
    repo: workspace,
    forcedRunId: 'run_20260428_501',
    executors,
    frontmatterByStep,
    scorer: () => ({
      specDrivenPipeline: 8.5, planningQuality: 9.0, documentation: 9.0,
      testing: 9.0, errorHandling: 9.0, maintainability: 9.0,
      functionality: 9.0, developerExperience: 9.0
    }),
    onHumanCheckpoint: () => { /* swallow */ }
  });
  assert.equal(result.overallStatus, 'paused');
  assert.equal(result.steps[0]!.status, 'autopaused');
});

test('runtime: nova convergence loop retries on under-threshold dimension', async () => {
  // Scorer returns a low value on first attempt, then ramps up — but our deterministic mode
  // can't change scores per call without state. Use a closure to track attempt count.
  let attempt = 0;
  const rampScorer = (): Record<string, number> => {
    attempt++;
    return {
      specDrivenPipeline: attempt >= 2 ? 9.5 : 8.0,
      planningQuality: 9.5, documentation: 9.3,
      testing: 9.5, errorHandling: 9.0, maintainability: 9.1,
      functionality: 9.4, developerExperience: 9.0
    };
  };
  const result = await runMagicLevelOrchestration({
    level: 'nova',
    inputs: { conversation: 'goal', changeName: 'nova-converge' },
    repo: workspace,
    forcedRunId: 'run_20260428_502',
    executors,
    frontmatterByStep,
    scorer: rampScorer,
    maxConvergenceRetries: 3,
    onHumanCheckpoint: () => { /* swallow */ }
  });
  // First step (dante-to-prd) should retry on specDrivenPipeline < 9.0 then succeed
  const first = result.steps[0]!;
  assert.ok(first.attempts >= 2, `expected ≥2 attempts after convergence retry, got ${first.attempts}`);
});

test('runtime: inferno fail-closed halts on first red gate', async () => {
  const result = await runMagicLevelOrchestration({
    level: 'inferno',
    inputs: { conversation: 'goal', changeName: 'inferno-failclosed' },
    repo: workspace,
    forcedRunId: 'run_20260428_503',
    executors,
    frontmatterByStep,
    scorer: () => ({
      specDrivenPipeline: 8.0, planningQuality: 8.0, documentation: 9.0,
      testing: 9.0, errorHandling: 9.0, maintainability: 9.0,
      functionality: 9.0, developerExperience: 9.0
    }),
    maxConvergenceRetries: 0,
    onHumanCheckpoint: () => { /* swallow */ }
  });
  assert.equal(result.overallStatus, 'failed');
  assert.equal(result.steps[0]!.status, 'fail_closed');
  // Must halt on first failure, not run all steps
  assert.equal(result.steps.length, 1);
});

test('runtime: spark level does not orchestrate (returns immediately green)', async () => {
  const result = await runMagicLevelOrchestration({
    level: 'spark',
    inputs: {},
    repo: workspace,
    forcedRunId: 'run_20260428_504',
    executors,
    frontmatterByStep,
    scorer: greenScorer
  });
  assert.equal(result.overallStatus, 'green');
  assert.equal(result.steps.length, 0);
});

test('runtime: budget envelope stops orchestration when usd budget exceeded', async () => {
  const result = await runMagicLevelOrchestration({
    level: 'inferno',
    inputs: { conversation: 'goal', changeName: 'budget' },
    repo: workspace,
    forcedRunId: 'run_20260428_505',
    executors,
    frontmatterByStep,
    scorer: greenScorer,
    budgetUsd: 0,
    onHumanCheckpoint: () => { /* swallow */ }
  });
  assert.equal(result.overallStatus, 'budget_stopped');
});

test('runtime: budget envelope stops orchestration when minute budget exceeded', async () => {
  const result = await runMagicLevelOrchestration({
    level: 'inferno',
    inputs: { conversation: 'goal', changeName: 'minute-budget' },
    repo: workspace,
    forcedRunId: 'run_20260428_506',
    executors,
    frontmatterByStep,
    scorer: greenScorer,
    budgetMinutes: 0,
    onHumanCheckpoint: () => { /* swallow */ }
  });
  assert.equal(result.overallStatus, 'budget_stopped');
});

test('runtime: persists run.json + report.md + chain_hash.txt', async () => {
  const result = await runMagicLevelOrchestration({
    level: 'magic',
    inputs: { conversation: 'goal', changeName: 'persist' },
    repo: workspace,
    forcedRunId: 'run_20260428_507',
    executors,
    frontmatterByStep,
    scorer: greenScorer,
    onHumanCheckpoint: () => { /* swallow */ }
  });
  const persisted = JSON.parse(readFileSync(resolve(result.outputDir, 'run.json'), 'utf-8'));
  assert.equal(persisted.runId, result.runId);
  const report = readFileSync(resolve(result.outputDir, 'report.md'), 'utf-8');
  assert.match(report, /Orchestration Report/);
  const hash = readFileSync(resolve(result.outputDir, 'chain_hash.txt'), 'utf-8');
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('runtime: hardware ceiling refuses workflow with 4+ parallel steps on inferno', async () => {
  await assert.rejects(
    () => runMagicLevelOrchestration({
      level: 'inferno',
      inputs: {},
      repo: workspace,
      forcedRunId: 'run_20260428_508',
      executors,
      scorer: greenScorer,
      workflow: [
        { skill: 'dante-to-prd', gate: 'fail_closed', parallel: true },
        { skill: 'dante-grill-me', gate: 'fail_closed', parallel: true },
        { skill: 'dante-tdd', gate: 'fail_closed', parallel: true },
        { skill: 'dante-triage-issue', gate: 'fail_closed', parallel: true }
      ],
      onHumanCheckpoint: () => { /* swallow */ }
    }),
    /hardware ceiling/i
  );
});

test('runtime: ascend level (orchestrates=true with empty workflow) returns green immediately', async () => {
  // Ascend's defaultWorkflow is empty per PRD-MASTER §8.1 (it dispatches to other levels)
  const result = await runMagicLevelOrchestration({
    level: 'ascend',
    inputs: {},
    repo: workspace,
    forcedRunId: 'run_20260428_509',
    executors,
    frontmatterByStep,
    scorer: greenScorer
  });
  assert.equal(result.overallStatus, 'green');
  assert.equal(result.steps.length, 0);
});
