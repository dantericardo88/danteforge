import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runSkill } from '../../src/spine/skill_runner/runner.js';
import { danteToPrdExecutor } from '../../src/spine/skill_runner/executors/dante-to-prd-executor.js';

let workspace: string;

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'dante-to-prd-eval-'));
  mkdirSync(resolve(workspace, '.danteforge'), { recursive: true });
});

test('/dante-to-prd: produces an OpenSpec-style per-change folder with proposal, specs, design, tasks', async () => {
  const result = await runSkill(danteToPrdExecutor, {
    skillName: 'dante-to-prd',
    repo: workspace,
    inputs: {
      conversation: 'Goal: ship a payment receipt webhook. Constraint: must respond < 200ms. Non-goal: invoice generation.',
      changeName: 'payment-receipt-webhook',
      outputRoot: workspace,
      successMetric: 'p99 latency < 200ms over 7 days; zero dropped webhooks'
    },
    runId: 'run_20260428_900',
    frontmatter: {
      name: 'dante-to-prd',
      description: 'eval',
      requiredDimensions: ['specDrivenPipeline', 'planningQuality', 'documentation']
    },
    scorer: () => ({ specDrivenPipeline: 9.4, planningQuality: 9.2, documentation: 9.0 })
  });

  const folder = resolve(workspace, 'docs/PRDs/payment-receipt-webhook');
  assert.ok(existsSync(folder), 'per-change folder should exist');
  assert.ok(existsSync(resolve(folder, 'proposal.md')));
  assert.ok(existsSync(resolve(folder, 'specs/payment-receipt-webhook.md')));
  assert.ok(existsSync(resolve(folder, 'design.md')));
  assert.ok(existsSync(resolve(folder, 'tasks.md')));
  assert.ok(existsSync(resolve(folder, 'constitutional_checklist.md')));
  assert.ok(existsSync(resolve(folder, 'surfaced_assumptions.md')));

  // Proposal must include the success metric
  const proposal = readFileSync(resolve(folder, 'proposal.md'), 'utf-8');
  assert.match(proposal, /p99 latency < 200ms/);

  // Three-way gate green when all dimensions ≥9.0
  assert.equal(result.gate.overall, 'green');
});

test('/dante-to-prd: emits ≥3 surfaced assumptions per Iron Law', async () => {
  const result = await runSkill(danteToPrdExecutor, {
    skillName: 'dante-to-prd',
    repo: workspace,
    inputs: {
      conversation: 'Build a thing that does the thing.',
      changeName: 'vague-thing',
      outputRoot: workspace
    },
    runId: 'run_20260428_901',
    frontmatter: {
      name: 'dante-to-prd',
      description: 'eval',
      requiredDimensions: ['planningQuality']
    },
    scorer: () => ({ planningQuality: 9.0 })
  });
  const assumptions = (result.verdict.opinionClaims ?? []);
  assert.ok(assumptions.length >= 3, `expected ≥3 surfaced assumptions, got ${assumptions.length}`);
});

test('/dante-to-prd: design.md has ≥2 alternatives with tradeoffs', async () => {
  await runSkill(danteToPrdExecutor, {
    skillName: 'dante-to-prd',
    repo: workspace,
    inputs: {
      conversation: 'Goal: ship a feature.',
      changeName: 'design-alternatives-test',
      outputRoot: workspace
    },
    runId: 'run_20260428_902',
    frontmatter: {
      name: 'dante-to-prd',
      description: 'eval',
      requiredDimensions: ['planningQuality']
    },
    scorer: () => ({ planningQuality: 9.0 })
  });

  const design = readFileSync(resolve(workspace, 'docs/PRDs/design-alternatives-test/design.md'), 'utf-8');
  const altCount = (design.match(/^### /gm) ?? []).length;
  assert.ok(altCount >= 2, `design.md must have ≥2 alternatives, got ${altCount}`);
});

test('/dante-to-prd: red path — gate fails when score below 9.0', async () => {
  const result = await runSkill(danteToPrdExecutor, {
    skillName: 'dante-to-prd',
    repo: workspace,
    inputs: {
      conversation: 'Goal: ship.',
      changeName: 'red-path',
      outputRoot: workspace
    },
    runId: 'run_20260428_903',
    frontmatter: {
      name: 'dante-to-prd',
      description: 'eval',
      requiredDimensions: ['specDrivenPipeline', 'planningQuality']
    },
    scorer: () => ({ specDrivenPipeline: 8.5, planningQuality: 9.1 })
  });
  assert.equal(result.gate.overall, 'red');
  assert.notEqual(result.verdict.finalStatus, 'complete');
});
