import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runSkill } from '../../src/spine/skill_runner/runner.js';
import { danteGrillMeExecutor } from '../../src/spine/skill_runner/executors/dante-grill-me-executor.js';

let workspace: string;

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'dante-grill-eval-'));
  mkdirSync(resolve(workspace, '.danteforge'), { recursive: true });
});

test('/dante-grill-me: surfaces ≥3 assumptions on a vague plan (Iron Law)', async () => {
  const result = await runSkill(danteGrillMeExecutor, {
    skillName: 'dante-grill-me',
    repo: workspace,
    inputs: { plan: 'We will build a thing.' },
    runId: 'run_20260428_910',
    frontmatter: {
      name: 'dante-grill-me',
      description: 'eval',
      requiredDimensions: ['planningQuality']
    },
    scorer: () => ({ planningQuality: 9.2 })
  });
  const assumptions = (result.verdict.opinionClaims ?? []);
  assert.ok(assumptions.length >= 3, `expected ≥3 surfaced, got ${assumptions.length}`);
});

test('/dante-grill-me: question batch covers all 4 depth levels', async () => {
  const result = await runSkill(danteGrillMeExecutor, {
    skillName: 'dante-grill-me',
    repo: workspace,
    inputs: { plan: 'Goal: launch v1. Approach: ship features. Success criteria: green CI.' },
    runId: 'run_20260428_911',
    frontmatter: {
      name: 'dante-grill-me',
      description: 'eval',
      requiredDimensions: ['planningQuality']
    },
    scorer: () => ({ planningQuality: 9.5 })
  });
  const o = result.output as { questions: { depth: string }[] };
  const depths = new Set(o.questions.map(q => q.depth));
  assert.ok(depths.has('surface'));
  assert.ok(depths.has('mechanism'));
  assert.ok(depths.has('assumption'));
  assert.ok(depths.has('counterfactual'));
});

test('/dante-grill-me: high-risk plan flags unresolved disagreement', async () => {
  const result = await runSkill(danteGrillMeExecutor, {
    skillName: 'dante-grill-me',
    repo: workspace,
    inputs: { plan: 'We will hard-code production credentials in the security module.' },
    runId: 'run_20260428_912',
    frontmatter: {
      name: 'dante-grill-me',
      description: 'eval',
      requiredDimensions: ['planningQuality']
    },
    scorer: () => ({ planningQuality: 9.0 })
  });
  const o = result.output as { unresolvedDisagreements: string[] };
  assert.ok(o.unresolvedDisagreements.length >= 1, 'high-risk plan should flag an unresolved disagreement');
  assert.match(o.unresolvedDisagreements[0]!, /high-risk/i);
});
