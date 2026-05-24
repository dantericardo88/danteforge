import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  claimDimension,
  getMatrixStatus,
  mergeScoreProposals,
  writeScoreProposal,
  type MatrixDevelopmentEngineOptions,
} from '../src/core/matrix-development-engine.js';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-matrix-engine-'));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, '.danteforge', 'compete'), { recursive: true });
  await fs.mkdir(path.join(root, '.danteforge', 'evidence'), { recursive: true });
  await fs.writeFile(path.join(root, '.danteforge', 'evidence', 'dim-27.json'), '{"ok":true}\n');
  await fs.writeFile(path.join(root, '.danteforge', 'compete', 'matrix.json'), JSON.stringify({
    project: 'demo',
    competitors: ['LeaderOSS', 'LeaderClosed'],
    competitors_closed_source: ['LeaderClosed'],
    competitors_oss: ['LeaderOSS'],
    lastUpdated: '2026-01-01T00:00:00.000Z',
    overallSelfScore: 6,
    dimensions: [{
      id: 'long_run_reasoning',
      label: 'Long Run Reasoning',
      weight: 1,
      category: 'reasoning',
      frequency: 'high',
      scores: { self: 6, LeaderOSS: 8, LeaderClosed: 9 },
      gap_to_leader: 3,
      leader: 'LeaderClosed',
      gap_to_closed_source_leader: 3,
      closed_source_leader: 'LeaderClosed',
      gap_to_oss_leader: 2,
      oss_leader: 'LeaderOSS',
      status: 'in-progress',
      sprint_history: [],
      next_sprint_target: 8,
      capability_test: { command: 'node -e "process.exit(0)"', description: 'always-pass gate for ceiling/merge test', timeoutMs: 5000 },
    }],
  }, null, 2));
  return root;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

function fakeTimeMachine(): MatrixDevelopmentEngineOptions['_createTimeMachineCommit'] {
  let n = 0;
  return async ({ paths, label, causalLinks }) => ({
    commitId: `tm_test_${++n}`,
    label,
    paths,
    causalLinks,
  });
}

describe('MatrixDevelopmentEngine', () => {
  it('reports matrix status and top next dimensions', async () => {
    const cwd = await makeRepo();

    const status = await getMatrixStatus({ cwd, top: 1 });

    assert.equal(status.matrixPath, '.danteforge/compete/matrix.json');
    assert.equal(status.topDimensions[0]?.id, 'long_run_reasoning');
    assert.equal(typeof status.matrixHash, 'string');
  });

  it('allows multiple agents to claim the same dimension independently', async () => {
    const cwd = await makeRepo();

    const a = await claimDimension({ cwd, dimension: '1', agent: 'codex' });
    const b = await claimDimension({ cwd, dimension: 'long_run_reasoning', agent: 'claude' });

    assert.equal(a.dimensionId, 'long_run_reasoning');
    assert.equal(b.dimensionId, 'long_run_reasoning');
    const claims = await fs.readdir(path.join(cwd, '.danteforge', 'dimension-claims'));
    assert.ok(claims.includes('long_run_reasoning-codex.lock'));
    assert.ok(claims.includes('long_run_reasoning-claude.lock'));
  });

  it('writes score proposals without rewriting the canonical matrix', async () => {
    const cwd = await makeRepo();

    const proposal = await writeScoreProposal({
      cwd,
      dimension: 'long_run_reasoning',
      score: 8.4,
      agent: 'codex',
      rationale: 'real evidence',
      evidence: ['.danteforge/evidence/dim-27.json'],
    });
    const matrix = await readJson<{ dimensions: Array<{ scores: { self: number } }> }>(
      path.join(cwd, '.danteforge', 'compete', 'matrix.json'),
    );

    assert.equal(matrix.dimensions[0]?.scores.self, 6);
    assert.match(proposal.id, /^proposal_/);
    assert.equal(proposal.baselineScore, 6);
  });

  it('merges proposals under lock, clamps ceilings, and writes a receipt with Time Machine links', async () => {
    const cwd = await makeRepo();
    const matrixPath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');
    const matrix = await readJson<any>(matrixPath);
    matrix.dimensions[0].ceiling = 7.5;
    await fs.writeFile(matrixPath, JSON.stringify(matrix, null, 2));
    const createCommit = fakeTimeMachine();

    await writeScoreProposal({ cwd, dimension: 1, score: 9, agent: 'optimist', rationale: 'optimistic' });
    await writeScoreProposal({ cwd, dimension: 1, score: 7.2, agent: 'harsh', rationale: 'harsh recheck' });
    const receipt = await mergeScoreProposals({
      cwd,
      policy: 'harsh-min',
      agent: 'merger',
      _createTimeMachineCommit: createCommit,
    });

    const updated = await readJson<any>(matrixPath);
    assert.equal(updated.dimensions[0].scores.self, 7.2);
    assert.equal(updated.dimensions[0].sprint_history[0].mergeReceipt, receipt.receiptPath);
    assert.equal(receipt.merged.length, 1);
    assert.equal(receipt.rejected.length, 1);
    assert.equal(receipt.selectedProposalIds.length, 1);
    assert.ok(receipt.proposalIds.length === 2);
    assert.equal(receipt.beforeTimeMachineCommitId, 'tm_test_1');
    assert.equal(receipt.afterTimeMachineCommitId, 'tm_test_2');
    assert.notEqual(receipt.matrixHashBefore, receipt.matrixHashAfter);
  });
});
