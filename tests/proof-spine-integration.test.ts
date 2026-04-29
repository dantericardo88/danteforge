import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

import { proof } from '../src/cli/commands/proof.js';
import { writeVerifyReceipt, type VerifyReceipt } from '../src/core/verify-receipts.js';
import { runTruthLoop } from '../src/spine/truth_loop/runner.js';
import { danteTriageIssueExecutor } from '../src/spine/skill_runner/executors/dante-triage-issue-executor.js';
import { createReceipt } from '../packages/evidence-chain/src/index.ts';

function makeReceipt(overrides: Partial<VerifyReceipt> = {}): VerifyReceipt {
  return {
    project: 'danteforge',
    version: '1.0.0',
    gitSha: 'abc123',
    platform: 'win32',
    nodeVersion: 'v22.0.0',
    cwd: '/project',
    projectType: 'cli',
    workflowStage: 'verify',
    timestamp: '2026-04-29T10:00:00.000Z',
    commandMode: { release: false, live: false, recompute: false },
    passed: ['one check'],
    warnings: [],
    failures: [],
    counts: { passed: 1, warnings: 0, failures: 0 },
    releaseCheckPassed: null,
    liveCheckPassed: null,
    currentStateFresh: true,
    selfEditPolicyEnforced: true,
    status: 'pass',
    ...overrides,
  };
}

describe('proof spine integrations', () => {
  let workspace: string;

  before(() => {
    workspace = mkdtempSync(resolve(tmpdir(), 'danteforge-proof-spine-'));
    execSync('git init -q', { cwd: workspace });
    execSync('git -c user.email=t@t -c user.name=Test commit --allow-empty -q -m initial', { cwd: workspace });
    mkdirSync(resolve(workspace, 'src'), { recursive: true });
    writeFileSync(resolve(workspace, 'src/example.ts'), 'export const x = 1;\n');
  });

  after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('verify receipts include a verifiable proof bundle', async () => {
    await writeVerifyReceipt(makeReceipt(), workspace);

    const written = JSON.parse(readFileSync(resolve(workspace, '.danteforge/evidence/verify/latest.json'), 'utf-8'));
    assert.equal(written.proof.schemaVersion, 'evidence-chain.v1');
    assert.equal(written.proof.gitSha, 'abc123');
    assert.equal(written.proof.verificationStatus, 'unverified');

    const lines: string[] = [];
    await proof({ verify: resolve(workspace, '.danteforge/evidence/verify/latest.json'), cwd: workspace, skipGit: true, _stdout: line => lines.push(line) } as never);
    const result = JSON.parse(lines.join('\n'));
    assert.equal(result.valid, true);
    assert.equal(result.checks.bundleIntegrity.valid, true);
  });

  it('proof verify rejects a tampered receipt payload', async () => {
    const receiptPath = resolve(workspace, 'receipt.json');
    const receipt = createReceipt({
      runId: 'run_20260429_001',
      gitSha: 'abc123',
      action: 'manual-proof',
      payload: { score: 8.8 },
      createdAt: '2026-04-29T10:01:00.000Z',
    });
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

    const ok: string[] = [];
    await proof({ verify: receiptPath, cwd: workspace, skipGit: true, _stdout: line => ok.push(line) } as never);
    assert.equal(JSON.parse(ok.join('\n')).valid, true);

    writeFileSync(receiptPath, JSON.stringify({ ...receipt, payload: { score: 10 } }, null, 2) + '\n');
    const bad: string[] = [];
    await proof({ verify: receiptPath, cwd: workspace, skipGit: true, _stdout: line => bad.push(line) } as never);
    assert.equal(JSON.parse(bad.join('\n')).valid, false);
  });

  it('truth-loop artifacts, evidence, and verdicts carry proof objects', async () => {
    const critique = resolve(workspace, 'critique.md');
    writeFileSync(critique, '- File `src/example.ts` exists\n');

    const result = await runTruthLoop({
      repo: workspace,
      objective: 'proof-spine integration',
      critics: ['codex'],
      critiqueFiles: [{ source: 'codex', path: critique }],
      budgetUsd: 1,
      mode: 'sequential',
      strictness: 'standard',
      skipTests: true,
      forcedRunId: 'run_20260429_002',
    });

    assert.ok(result.artifacts.every(a => a.proof?.payloadHash));
    assert.ok(result.evidence.every(e => e.proof?.payloadHash));
    assert.ok(result.verdict.proof?.payloadHash);
  });

  it('SoulSeal triage receipts are backed by a proof receipt', async () => {
    const incidentRoot = resolve(workspace, '.danteforge/incidents');
    const result = await danteTriageIssueExecutor({
      symptom: 'score fluctuates between runs',
      reproductionSteps: ['run score twice'],
      failingCondition: 'overall score changes',
      hypotheses: [
        { id: 'h1', statement: 'cache race', falsificationTest: 'inspect cache', status: 'falsified' },
        { id: 'h2', statement: 'state mutation', falsificationTest: 'diff STATE', status: 'confirmed' },
        { id: 'h3', statement: 'clock based scoring', falsificationTest: 'freeze time', status: 'falsified' },
      ],
      fix: { proximate: 'use canonical score', structural: 'pure score function', regressionTest: 'determinism test' },
      incidentRoot,
      runId: 'incident_001',
    });

    const out = result.output as { soulSealPath: string; soulSealHash: string };
    const receipt = JSON.parse(readFileSync(out.soulSealPath, 'utf-8'));
    assert.equal(receipt.soulSealHash, out.soulSealHash);
    assert.equal(receipt.proof.schemaVersion, 'evidence-chain.v1');
    assert.equal(receipt.proof.payloadHash, out.soulSealHash);
  });
});
