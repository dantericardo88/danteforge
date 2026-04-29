import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import {
  TIME_MACHINE_SCHEMA_VERSION,
  createTimeMachineCommit,
  loadTimeMachineCommit,
  queryTimeMachine,
  restoreTimeMachineCommit,
  verifyTimeMachine,
} from '../src/core/time-machine.js';
import { computeCanonicalScore } from '../src/core/harsh-scorer.js';
import { runTruthLoop } from '../src/spine/truth_loop/runner.js';

function initGit(cwd: string): void {
  execSync('git init -q', { cwd });
  execSync('git -c user.email=t@t -c user.name=Test commit --allow-empty -q -m initial', { cwd });
}

function write(rel: string, body: string, cwd: string): void {
  const target = resolve(cwd, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

describe('time-machine core', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(resolve(tmpdir(), 'danteforge-time-machine-'));
    initGit(workspace);
    write('docs/a.md', 'alpha\n', workspace);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('committing the same files twice preserves identical blob hashes', async () => {
    const first = await createTimeMachineCommit({
      cwd: workspace,
      paths: ['docs'],
      label: 'first',
      now: () => '2026-04-29T10:00:00.000Z',
    });
    const second = await createTimeMachineCommit({
      cwd: workspace,
      paths: ['docs'],
      label: 'second',
      now: () => '2026-04-29T10:01:00.000Z',
    });

    assert.equal(first.schemaVersion, TIME_MACHINE_SCHEMA_VERSION);
    assert.deepEqual(
      first.entries.map(e => [e.path, e.blobHash]),
      second.entries.map(e => [e.path, e.blobHash]),
    );
  });

  it('changing one byte changes the blob hash and commit proof', async () => {
    const before = await createTimeMachineCommit({
      cwd: workspace,
      paths: ['docs/a.md'],
      label: 'before',
      now: () => '2026-04-29T10:00:00.000Z',
    });
    write('docs/a.md', 'alphb\n', workspace);
    const after = await createTimeMachineCommit({
      cwd: workspace,
      paths: ['docs/a.md'],
      label: 'after',
      now: () => '2026-04-29T10:01:00.000Z',
    });

    assert.notEqual(before.entries[0]!.blobHash, after.entries[0]!.blobHash);
    assert.notEqual(before.proof.payloadHash, after.proof.payloadHash);
  });

  it('verify passes clean chain and fails on blob tamper, broken parent, reordered reflog, and deleted commit', async () => {
    const c1 = await createTimeMachineCommit({
      cwd: workspace,
      paths: ['docs/a.md'],
      label: 'genesis',
      now: () => '2026-04-29T10:00:00.000Z',
    });
    write('docs/a.md', 'beta\n', workspace);
    const c2 = await createTimeMachineCommit({
      cwd: workspace,
      paths: ['docs/a.md'],
      label: 'head',
      now: () => '2026-04-29T10:01:00.000Z',
    });

    assert.equal((await verifyTimeMachine({ cwd: workspace })).valid, true);

    writeFileSync(resolve(workspace, '.danteforge/time-machine/blobs', c1.entries[0]!.blobHash), 'tampered');
    assert.equal((await verifyTimeMachine({ cwd: workspace })).valid, false);

    rmSync(resolve(workspace, '.danteforge'), { recursive: true, force: true });
    write('docs/a.md', 'alpha\n', workspace);
    const p1 = await createTimeMachineCommit({ cwd: workspace, paths: ['docs/a.md'], label: 'one', now: () => '2026-04-29T10:00:00.000Z' });
    write('docs/a.md', 'beta\n', workspace);
    const p2 = await createTimeMachineCommit({ cwd: workspace, paths: ['docs/a.md'], label: 'two', now: () => '2026-04-29T10:01:00.000Z' });
    const commitPath = resolve(workspace, '.danteforge/time-machine/commits', `${p2.commitId}.json`);
    const broken = { ...JSON.parse(readFileSync(commitPath, 'utf8')), parents: ['bad-parent'] };
    writeFileSync(commitPath, JSON.stringify(broken, null, 2));
    assert.equal((await verifyTimeMachine({ cwd: workspace })).valid, false);

    writeFileSync(commitPath, JSON.stringify(p2, null, 2));
    const reflogPath = resolve(workspace, '.danteforge/time-machine/refs/reflog.jsonl');
    writeFileSync(reflogPath, [p2.commitId, p1.commitId].map(commitId => JSON.stringify({ commitId })).join('\n') + '\n');
    assert.equal((await verifyTimeMachine({ cwd: workspace })).valid, false);

    writeFileSync(reflogPath, [p1.commitId, p2.commitId].map(commitId => JSON.stringify({ commitId })).join('\n') + '\n');
    rmSync(resolve(workspace, '.danteforge/time-machine/commits', `${p1.commitId}.json`));
    assert.equal((await verifyTimeMachine({ cwd: workspace })).valid, false);
  });

  it('restores genesis, middle, and head byte-identically and idempotently', async () => {
    const commits = [];
    for (const [i, body] of ['one\n', 'two\n', 'three\n'].entries()) {
      write('docs/a.md', body, workspace);
      commits.push(await createTimeMachineCommit({
        cwd: workspace,
        paths: ['docs/a.md'],
        label: `c${i}`,
        now: () => `2026-04-29T10:0${i}:00.000Z`,
      }));
    }

    for (const [i, commit] of commits.entries()) {
      const outDir = resolve(workspace, 'restore', String(i));
      await restoreTimeMachineCommit({ cwd: workspace, commitId: commit.commitId, outDir });
      assert.equal(readFileSync(resolve(outDir, 'docs/a.md'), 'utf8'), ['one\n', 'two\n', 'three\n'][i]);
      await restoreTimeMachineCommit({ cwd: workspace, commitId: commit.commitId, outDir });
      assert.equal(readFileSync(resolve(outDir, 'docs/a.md'), 'utf8'), ['one\n', 'two\n', 'three\n'][i]);
    }
  });

  it('answers evidence, file-history, and unsupported counterfactual queries honestly', async () => {
    const c1 = await createTimeMachineCommit({
      cwd: workspace,
      paths: ['docs/a.md'],
      label: 'with-causal-links',
      runId: 'run_20260429_001',
      causalLinks: {
        materials: ['docs/a.md'],
        products: ['docs/a.md'],
        verdictEvidence: [{ verdictId: 'verdict_001', evidenceIds: ['evidence_001'] }],
        evidenceArtifacts: [{ evidenceId: 'evidence_001', artifactId: 'artifact_001' }],
        rejectedClaims: [{ verdictId: 'verdict_001', status: 'unsupported', claim: 'all tests passed' }],
      },
      now: () => '2026-04-29T10:00:00.000Z',
    });
    write('docs/a.md', 'changed\n', workspace);
    const c2 = await createTimeMachineCommit({
      cwd: workspace,
      paths: ['docs/a.md'],
      label: 'file-history',
      now: () => '2026-04-29T10:01:00.000Z',
    });

    const evidence = await queryTimeMachine({ cwd: workspace, commitId: c1.commitId, kind: 'evidence' });
    assert.deepEqual(evidence.results, [{ verdictId: 'verdict_001', evidenceIds: ['evidence_001'] }]);

    const history = await queryTimeMachine({ cwd: workspace, kind: 'file-history', path: 'docs/a.md' });
    assert.deepEqual(history.results.map((r) => r.commitId), [c1.commitId, c2.commitId]);

    const counterfactual = await queryTimeMachine({ cwd: workspace, commitId: c2.commitId, kind: 'counterfactual' });
    assert.equal(counterfactual.status, 'not_preserved');
    assert.match(counterfactual.message, /counterfactual/i);
  });

  it('truth-loop runs create a proof-backed Time Machine commit', async () => {
    write('src/example.ts', 'export const x = 1;\n', workspace);
    const critique = resolve(workspace, 'critique.md');
    writeFileSync(critique, '- File `src/example.ts` exists\n');

    const result = await runTruthLoop({
      repo: workspace,
      objective: 'time-machine integration',
      critics: ['codex'],
      critiqueFiles: [{ source: 'codex', path: critique }],
      budgetUsd: 1,
      mode: 'sequential',
      strictness: 'standard',
      skipTests: true,
      forcedRunId: 'run_20260429_777',
    });

    const head = readFileSync(resolve(workspace, '.danteforge/time-machine/refs/head'), 'utf8').trim();
    const commit = await loadTimeMachineCommit({ cwd: workspace, commitId: head });
    assert.equal(commit.runId, 'run_20260429_777');
    assert.ok(commit.entries.some(e => e.path.includes('truth-loop/run_20260429_777/verdict/verdict.json')));
    assert.ok(commit.proof.payloadHash);
    assert.ok(result.verdict.proof?.payloadHash);
  });

  it('computeCanonicalScore remains deterministic and does not create Time Machine state', async () => {
    write('package.json', '{"name":"tm-score-fixture","type":"module"}\n', workspace);
    const beforeExists = existsSync(resolve(workspace, '.danteforge/time-machine'));
    const a = await computeCanonicalScore(workspace);
    const b = await computeCanonicalScore(workspace);

    assert.equal(a.overall, b.overall);
    assert.equal(beforeExists, false);
    assert.equal(existsSync(resolve(workspace, '.danteforge/time-machine')), false);
  });
});
