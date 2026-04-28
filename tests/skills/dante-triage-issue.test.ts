import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runSkill } from '../../src/spine/skill_runner/runner.js';
import { danteTriageIssueExecutor } from '../../src/spine/skill_runner/executors/dante-triage-issue-executor.js';

let workspace: string;

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'dante-triage-eval-'));
  mkdirSync(resolve(workspace, '.danteforge'), { recursive: true });
});

const COMPLETE_INPUTS = {
  symptom: 'Webhook returns 500 after 3 minutes',
  reproductionSteps: ['Send webhook X', 'Wait 3 minutes', 'Webhook returns 500'],
  failingCondition: 'POST /webhook returns 200',
  hypotheses: [
    { id: 'h1', statement: 'DB connection pool exhausted', falsificationTest: 'monitor pool size', status: 'confirmed' as const },
    { id: 'h2', statement: 'Network timeout', falsificationTest: 'check tcpdump', status: 'falsified' as const },
    { id: 'h3', statement: 'Bug in retry loop', falsificationTest: 'unit test retry', status: 'falsified' as const }
  ],
  fix: {
    proximate: 'Increase pool size to 50',
    structural: 'Add a circuit breaker that fails fast when pool > 80% occupied',
    regressionTest: 'tests/webhook-pool-saturation.test.ts'
  },
  incidentRoot: '',
  runId: ''
};

test('/dante-triage-issue: green path with confirmed root cause + 2-layer fix', async () => {
  const incidentRoot = resolve(workspace, 'incidents');
  mkdirSync(incidentRoot, { recursive: true });
  const inputs = { ...COMPLETE_INPUTS, incidentRoot, runId: 'run_20260428_930' };

  const result = await runSkill(danteTriageIssueExecutor, {
    skillName: 'dante-triage-issue',
    repo: workspace,
    inputs,
    runId: 'run_20260428_930',
    frontmatter: {
      name: 'dante-triage-issue',
      description: 'eval',
      requiredDimensions: ['errorHandling', 'testing', 'functionality']
    },
    scorer: () => ({ errorHandling: 9.4, testing: 9.2, functionality: 9.0 })
  });
  const o = result.output as { rootCauseConfirmed: boolean; soulSealHash: string; soulSealPath: string | null; blockingIssues: string[] };
  assert.equal(o.rootCauseConfirmed, true);
  assert.match(o.soulSealHash, /^[a-f0-9]{64}$/);
  assert.ok(o.soulSealPath && existsSync(o.soulSealPath));
  // SoulSeal hash must match what's persisted
  const receipt = JSON.parse(readFileSync(o.soulSealPath!, 'utf-8'));
  assert.equal(receipt.soulSealHash, o.soulSealHash);
  assert.equal(o.blockingIssues.length, 0);
});

test('/dante-triage-issue: <3 hypotheses blocks (Phase 2 Iron Law)', async () => {
  const result = await runSkill(danteTriageIssueExecutor, {
    skillName: 'dante-triage-issue',
    repo: workspace,
    inputs: {
      ...COMPLETE_INPUTS,
      hypotheses: COMPLETE_INPUTS.hypotheses.slice(0, 2)
    },
    runId: 'run_20260428_931',
    frontmatter: {
      name: 'dante-triage-issue',
      description: 'eval',
      requiredDimensions: ['errorHandling']
    },
    scorer: () => ({ errorHandling: 9.0 })
  });
  const o = result.output as { rootCauseConfirmed: boolean; blockingIssues: string[] };
  assert.equal(o.rootCauseConfirmed, false);
  assert.ok(o.blockingIssues.some(b => /3 hypotheses/.test(b)));
});

test('/dante-triage-issue: missing structural fix blocks (defense-in-depth Iron Law)', async () => {
  const result = await runSkill(danteTriageIssueExecutor, {
    skillName: 'dante-triage-issue',
    repo: workspace,
    inputs: {
      ...COMPLETE_INPUTS,
      fix: { proximate: 'increase pool', structural: '', regressionTest: 'tests/x.test.ts' }
    },
    runId: 'run_20260428_932',
    frontmatter: {
      name: 'dante-triage-issue',
      description: 'eval',
      requiredDimensions: ['errorHandling']
    },
    scorer: () => ({ errorHandling: 9.0 })
  });
  const o = result.output as { blockingIssues: string[] };
  assert.ok(o.blockingIssues.some(b => /structural/.test(b)));
});

test('/dante-triage-issue: quick mode skips Phase 4', async () => {
  const result = await runSkill(danteTriageIssueExecutor, {
    skillName: 'dante-triage-issue',
    repo: workspace,
    inputs: {
      ...COMPLETE_INPUTS,
      mode: 'quick',
      fix: undefined
    },
    runId: 'run_20260428_933',
    frontmatter: {
      name: 'dante-triage-issue',
      description: 'eval',
      requiredDimensions: ['errorHandling']
    },
    scorer: () => ({ errorHandling: 9.5 })
  });
  const o = result.output as { rootCauseConfirmed: boolean; blockingIssues: string[] };
  assert.equal(o.rootCauseConfirmed, true);
  // No fix-related blockers in quick mode
  assert.ok(!o.blockingIssues.some(b => /Phase 4/.test(b)));
});
