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
  persistCounterfactualReplayTrace,
  queryTimeMachine,
  restoreTimeMachineCommit,
  verifyTimeMachine,
} from '../src/core/time-machine.js';
import { buildSessionGraph } from '../src/core/time-machine-provenance.js';
import { createDecisionNodeStore, createDecisionNode } from '../src/core/decision-node.js';
import type { CounterfactualReplayResult } from '../src/core/time-machine-replay.js';
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

  it('answers line-provenance queries and preserves unchanged line attribution', async () => {
    write('docs/a.md', 'one\ntwo\nthree\n', workspace);
    const c1 = await createTimeMachineCommit({
      cwd: workspace,
      paths: ['docs/a.md'],
      label: 'initial lines',
      now: () => '2026-04-29T10:00:00.000Z',
    });

    write('docs/a.md', 'one\ntwo changed\nthree\nfour\n', workspace);
    const c2 = await createTimeMachineCommit({
      cwd: workspace,
      paths: ['docs/a.md'],
      label: 'changed middle and appended tail',
      now: () => '2026-04-29T10:01:00.000Z',
    });

    const unchanged = await queryTimeMachine({ cwd: workspace, kind: 'line-provenance', path: 'docs/a.md', line: 1 });
    const changed = await queryTimeMachine({ cwd: workspace, kind: 'line-provenance', path: 'docs/a.md', line: 2 });
    const appended = await queryTimeMachine({ cwd: workspace, kind: 'line-provenance', path: 'docs/a.md', line: 4 });

    assert.equal(unchanged.status, 'ok');
    assert.equal(unchanged.results[0]!.commitId, c1.commitId);
    assert.equal(unchanged.results[0]!.label, 'initial lines');
    assert.equal(changed.results[0]!.commitId, c2.commitId);
    assert.equal(changed.results[0]!.label, 'changed middle and appended tail');
    assert.equal(appended.results[0]!.commitId, c2.commitId);
  });

  it('returns an empty diagnostic for missing or out-of-range line-provenance queries', async () => {
    const c1 = await createTimeMachineCommit({
      cwd: workspace,
      paths: ['docs/a.md'],
      label: 'single line',
      now: () => '2026-04-29T10:00:00.000Z',
    });

    const missing = await queryTimeMachine({ cwd: workspace, commitId: c1.commitId, kind: 'line-provenance', path: 'docs/missing.md', line: 1 });
    const outOfRange = await queryTimeMachine({ cwd: workspace, commitId: c1.commitId, kind: 'line-provenance', path: 'docs/a.md', line: 99 });

    assert.equal(missing.status, 'ok');
    assert.deepEqual(missing.results, []);
    assert.match(missing.message ?? '', /No line provenance/i);
    assert.equal(outOfRange.status, 'ok');
    assert.deepEqual(outOfRange.results, []);
    assert.match(outOfRange.message ?? '', /No line provenance/i);
  });

  it('persists counterfactual replay summaries as queryable traces', async () => {
    write('docs/a.md', 'branch point\n', workspace);
    const replayResult: CounterfactualReplayResult = {
      originalTimelineId: 'main',
      newTimelineId: 'alt-re_gent-harvest',
      branchPoint: {
        id: 'node-branch',
        parentId: null,
        sessionId: 'sess-trace',
        timelineId: 'main',
        timestamp: '2026-04-29T10:00:00.000Z',
        actor: { type: 'agent', id: 'codex', product: 'danteforge' },
        input: { prompt: 'original prompt' },
        output: { result: 'original result', success: true, costUsd: 0, latencyMs: 0 },
        hash: 'hash-branch',
        prevHash: null,
      },
      originalPath: [],
      alternatePath: [],
      divergence: { convergent: [], divergent: [], unreachable: [] },
      outcomeEquivalent: false,
      causalChain: ['original prompt -> original result'],
      costUsd: 0,
      durationMs: 12,
    };

    const commit = await persistCounterfactualReplayTrace({
      cwd: workspace,
      replayResult,
      question: 'What if the prompt changed?',
      verdictId: 'replay_trace_001',
      now: () => '2026-04-29T10:02:00.000Z',
    });

    const counterfactual = await queryTimeMachine({ cwd: workspace, commitId: commit.commitId, kind: 'counterfactual' });
    assert.equal(counterfactual.status, 'ok');
    assert.equal(counterfactual.results[0]!.verdictId, 'replay_trace_001');
    assert.equal(counterfactual.results[0]!.status, 'preserved');
    assert.match(String(counterfactual.results[0]!.trace), /counterfactual-traces/);
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

// ── buildSessionGraph ─────────────────────────────────────────────────────────

describe('buildSessionGraph()', () => {
  const actor: import('../src/core/decision-node.js').DecisionNode['actor'] = {
    type: 'agent',
    id: 'test-agent',
    product: 'danteforge',
  };

  function makeNode(
    parentNode: import('../src/core/decision-node.js').DecisionNode | null,
    sessionId: string,
    timelineId: string,
    prompt: string,
  ) {
    return createDecisionNode({
      parentNode,
      sessionId,
      timelineId,
      actor,
      input: { prompt },
      output: { result: 'ok', success: true, costUsd: 0, latencyMs: 1 },
    });
  }

  it('single isolated node — no children, appears in roots', async () => {
    const storePath = resolve(tmpdir(), `sg-isolated-${Date.now()}.jsonl`);
    const store = createDecisionNodeStore(storePath);
    const node = makeNode(null, 'session-A', 'main', 'first step');
    await store.append(node);

    const graph = await buildSessionGraph('session-A', store);
    assert.ok(graph.nodes[node.id], 'node appears in graph');
    assert.ok(graph.roots.includes(node.id), 'node is a root');
    assert.deepEqual(graph.nodes[node.id]!.children, [], 'no children');
    assert.ok(graph.timelines.includes('main'));
  });

  it('parent → child edge wired correctly', async () => {
    const storePath = resolve(tmpdir(), `sg-chain-${Date.now()}.jsonl`);
    const store = createDecisionNodeStore(storePath);
    const parent = makeNode(null, 'session-B', 'main', 'step 1');
    const child = makeNode(parent, 'session-B', 'main', 'step 2');
    await store.append(parent);
    await store.append(child);

    const graph = await buildSessionGraph('session-B', store);
    assert.ok(graph.nodes[parent.id]!.children.includes(child.id), 'parent → child edge present');
    assert.ok(graph.roots.includes(parent.id), 'parent is root');
    assert.ok(!graph.roots.includes(child.id), 'child is not root');
  });

  it('fork node appears in both timelines', async () => {
    const storePath = resolve(tmpdir(), `sg-fork-${Date.now()}.jsonl`);
    const store = createDecisionNodeStore(storePath);
    const root = makeNode(null, 'session-C', 'main', 'root');
    const branchA = makeNode(root, 'session-C', 'timeline-A', 'branch A');
    const branchB = makeNode(root, 'session-C', 'timeline-B', 'branch B');
    await store.append(root);
    await store.append(branchA);
    await store.append(branchB);

    const graph = await buildSessionGraph('session-C', store);
    assert.ok(graph.timelines.includes('main'), 'main timeline present');
    assert.ok(graph.timelines.includes('timeline-A'), 'timeline-A present');
    assert.ok(graph.timelines.includes('timeline-B'), 'timeline-B present');
    assert.ok(graph.nodes[root.id]!.children.includes(branchA.id), 'root → branchA');
    assert.ok(graph.nodes[root.id]!.children.includes(branchB.id), 'root → branchB');
  });

  it('returns empty graph for session with no nodes', async () => {
    const storePath = resolve(tmpdir(), `sg-empty-${Date.now()}.jsonl`);
    const store = createDecisionNodeStore(storePath);
    const graph = await buildSessionGraph('nonexistent-session', store);
    assert.equal(Object.keys(graph.nodes).length, 0);
    assert.equal(graph.roots.length, 0);
  });
});
