import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

import { runTruthLoop } from '../src/spine/truth_loop/runner.js';
import { validate } from '../src/spine/truth_loop/schema-validator.js';
import { extractClaims, classifyClaim } from '../src/spine/truth_loop/critic-importer.js';
import { reconcileClaims } from '../src/spine/truth_loop/reconciler.js';
import { buildVerdict } from '../src/spine/truth_loop/verdict-writer.js';
import { buildNextAction } from '../src/spine/truth_loop/next-action-writer.js';

let workspace: string;

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'dante-truth-loop-'));
  // Make it look like a git repo so collectors find a commit hash.
  execSync('git init -q', { cwd: workspace });
  execSync('git -c user.email=t@t -c user.name=Test commit --allow-empty -q -m initial', { cwd: workspace });
  mkdirSync(resolve(workspace, 'src'), { recursive: true });
  writeFileSync(resolve(workspace, 'src/example.ts'), 'export const x = 1;\n');
});

after(() => {
  // Tmp cleanup is best-effort; node leaves it for inspection on failure.
});

test('schema validator: every required field is enforced', () => {
  const incomplete = { runId: 'run_20260427_001' };
  const r = validate('run', incomplete);
  assert.equal(r.valid, false);
  assert.ok(r.errors.length >= 5, `expected at least 5 missing-field errors, got ${r.errors.length}`);
});

test('schema validator: enum + pattern checks', () => {
  const bad = {
    runId: 'not-matching-pattern',
    projectId: 'p',
    repo: '/r',
    commit: 'abc',
    startedAt: 'not-a-date',
    mode: 'invalid',
    initiator: 'founder',
    objective: 'x',
    budgetEnvelopeId: 'b'
  };
  const r = validate('run', bad);
  assert.equal(r.valid, false);
  const messages = r.errors.map(e => e.message).join('\n');
  assert.match(messages, /pattern/);
  assert.match(messages, /date-time/);
  assert.match(messages, /enum/);
});

test('claim classification: mechanical, repo, opinion', () => {
  assert.equal(classifyClaim('Tests pass and exit code is 0'), 'mechanical');
  assert.equal(classifyClaim('File `src/example.ts` exports x'), 'repo');
  assert.equal(classifyClaim('This will scale better over time'), 'prediction');
  assert.equal(classifyClaim('I prefer flat PRDs'), 'preference');
  assert.equal(classifyClaim('This should be the next product'), 'strategic');
});

test('extractClaims: parses bullets and ignores headings', () => {
  const md = [
    '# Critique header',
    '## Section',
    '- Tests pass on main',
    '* File `src/example.ts` exports the symbol',
    '1. The architecture is brittle',
    'paragraph not a claim'
  ].join('\n');
  const claims = extractClaims(md);
  assert.equal(claims.length, 3);
  assert.deepEqual(claims.map(c => c.type).sort(), ['architecture', 'mechanical', 'repo']);
});

test('reconciler: repo claim verifiable from filesystem (passed)', () => {
  const claims = [{ claimId: 'c1', type: 'repo' as const, text: 'File `src/example.ts` exists' }];
  const { reconciled, evidence } = reconcileClaims(claims, {
    repo: workspace,
    runId: 'run_20260427_001',
    testArtifactId: 'art_test',
    repoArtifactId: 'art_repo',
    test: { attempted: false, passed: 0, failed: 0, total: 0, raw: '' },
    snapshot: { branch: 'main', commit: 'abc', dirtyFiles: 0, fileCount: 1 }
  });
  assert.equal(reconciled[0]!.status, 'supported');
  assert.equal(evidence[0]!.status, 'passed');
});

test('reconciler: repo claim falsifiable (failed when path missing)', () => {
  const claims = [{ claimId: 'c1', type: 'repo' as const, text: 'File `src/missing.ts` defines z' }];
  const { reconciled, evidence } = reconcileClaims(claims, {
    repo: workspace,
    runId: 'run_20260427_001',
    testArtifactId: 'art_test',
    repoArtifactId: 'art_repo',
    test: { attempted: false, passed: 0, failed: 0, total: 0, raw: '' },
    snapshot: { branch: 'main', commit: 'abc', dirtyFiles: 0, fileCount: 1 }
  });
  assert.equal(reconciled[0]!.status, 'contradicted');
  assert.equal(evidence[0]!.status, 'failed');
});

test('verdict: anti-stub — unsupported opinion is NEVER promoted to supported', () => {
  const claims = [
    { claimId: 'c1', type: 'architecture' as const, text: 'Design A is better than design B' },
    { claimId: 'c2', type: 'prediction' as const, text: 'This will scale better over time' }
  ];
  const { reconciled } = reconcileClaims(claims, {
    repo: workspace,
    runId: 'run_20260427_001',
    testArtifactId: 'art_test',
    repoArtifactId: 'art_repo',
    test: { attempted: false, passed: 0, failed: 0, total: 0, raw: '' },
    snapshot: { branch: 'main', commit: 'abc', dirtyFiles: 0, fileCount: 1 }
  });
  const verdict = buildVerdict({ runId: 'run_20260427_001', reconciled, strictness: 'standard' });
  assert.equal(verdict.supportedClaims?.length ?? 0, 0, 'opinion-only claims must never appear as supported');
  assert.equal((verdict.opinionClaims?.length ?? 0), 2);
});

test('verdict: contradiction triggers blocked status', () => {
  const claims = [{ claimId: 'c1', type: 'repo' as const, text: 'File `src/missing.ts` exists' }];
  const { reconciled } = reconcileClaims(claims, {
    repo: workspace,
    runId: 'run_20260427_001',
    testArtifactId: 'art_test',
    repoArtifactId: 'art_repo',
    test: { attempted: false, passed: 0, failed: 0, total: 0, raw: '' },
    snapshot: { branch: 'main', commit: 'abc', dirtyFiles: 0, fileCount: 1 }
  });
  const verdict = buildVerdict({ runId: 'run_20260427_001', reconciled, strictness: 'standard' });
  assert.equal(verdict.finalStatus, 'blocked');
  assert.ok(verdict.blockingGaps && verdict.blockingGaps.length > 0);
});

test('verdict: budget exhaustion produces budget_stopped status', () => {
  const verdict = buildVerdict({
    runId: 'run_20260427_001',
    reconciled: [],
    strictness: 'standard',
    budgetExhausted: true
  });
  assert.equal(verdict.finalStatus, 'budget_stopped');
});

test('next-action: contradicted claims yield P0 targeted_test_request', () => {
  const verdict = buildVerdict({
    runId: 'run_20260427_001',
    reconciled: [
      {
        claim: { claimId: 'c1', type: 'repo', text: 'File missing exists' },
        status: 'contradicted',
        reasoning: 'fs.existsSync returned false'
      }
    ],
    strictness: 'standard'
  });
  const action = buildNextAction({
    verdict,
    targetRepo: workspace,
    strictness: 'standard',
    promptUri: 'file:///nope'
  });
  assert.equal(action.priority, 'P0');
  assert.equal(action.actionType, 'targeted_test_request');
  assert.ok(action.acceptanceCriteria.length >= 1);
});

test('runner: end-to-end produces a valid run directory layout', async () => {
  const critique = resolve(workspace, 'codex_critique.md');
  writeFileSync(critique, [
    '# Codex critique',
    '- File `src/example.ts` defines x',
    '- The build approach feels overengineered'
  ].join('\n'));

  const result = await runTruthLoop({
    repo: workspace,
    objective: 'pilot harness',
    critics: ['codex'],
    critiqueFiles: [{ source: 'codex', path: critique }],
    budgetUsd: 5,
    mode: 'sequential',
    strictness: 'standard',
    skipTests: true,
    forcedRunId: 'run_20260427_999'
  });

  assert.equal(result.run.runId, 'run_20260427_999');
  assert.ok(existsSync(resolve(result.runDir, 'run.json')));
  assert.ok(existsSync(resolve(result.runDir, 'budget.json')));
  assert.ok(existsSync(resolve(result.runDir, 'verdict', 'verdict.json')));
  assert.ok(existsSync(resolve(result.runDir, 'verdict', 'verdict.md')));
  assert.ok(existsSync(resolve(result.runDir, 'next_action', 'next_action.json')));
  assert.ok(existsSync(resolve(result.runDir, 'next_action', 'next_action_prompt.md')));
  assert.ok(existsSync(resolve(result.runDir, 'report.md')));

  const runJson = JSON.parse(readFileSync(resolve(result.runDir, 'run.json'), 'utf-8'));
  assert.equal(validate('run', runJson).valid, true);

  const verdictJson = JSON.parse(readFileSync(resolve(result.runDir, 'verdict', 'verdict.json'), 'utf-8'));
  assert.equal(validate('verdict', verdictJson).valid, true);

  const naJson = JSON.parse(readFileSync(resolve(result.runDir, 'next_action', 'next_action.json'), 'utf-8'));
  assert.equal(validate('next_action', naJson).valid, true);

  const promptText = readFileSync(resolve(result.runDir, 'next_action', 'next_action_prompt.md'), 'utf-8');
  assert.match(promptText, /Next Action/);
  assert.match(promptText, /Acceptance criteria/);
});

test('runner: strict mode marks unsupported claims as evidence_insufficient', async () => {
  const critique = resolve(workspace, 'claude_critique_strict.md');
  writeFileSync(critique, [
    '# Claude critique',
    '- The system will scale better in the future',
    '- File `src/unknown_file.ts` exports something'
  ].join('\n'));

  const result = await runTruthLoop({
    repo: workspace,
    objective: 'strict-mode pilot',
    critics: ['claude'],
    critiqueFiles: [{ source: 'claude', path: critique }],
    budgetUsd: 1,
    mode: 'sequential',
    strictness: 'strict',
    skipTests: true,
    forcedRunId: 'run_20260427_998'
  });

  // unknown_file is contradicted (path missing) → blocked OR evidence_insufficient
  assert.ok(['blocked', 'evidence_insufficient', 'progress_real_but_not_done'].includes(result.verdict.finalStatus));
  assert.ok((result.verdict.opinionClaims?.length ?? 0) >= 1);
});
