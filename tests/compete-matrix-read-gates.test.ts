// Read-path honesty pins for loadMatrix (split from compete-matrix.test.ts — file-size standard):
//   1. the subprocess-write cache seam (fleet run 3b)
//   2. the read-time frontier gate (the court-less 9.0 leak, fleet run 3 pilot)
import { describe, it } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  loadMatrix,
  invalidateMatrixCache,
  type MatrixDimension,
  type CompeteMatrix,
} from '../src/core/compete-matrix.js';

function makeDim(overrides: Partial<MatrixDimension> = {}): MatrixDimension {
  return {
    id: 'test_dim', label: 'Test Dimension', weight: 1.0, category: 'quality',
    scores: { self: 5.0 }, gap_to_leader: 2.0, leader: 'x',
    gap_to_closed_source_leader: 2.0, closed_source_leader: 'x',
    gap_to_oss_leader: 0, oss_leader: '', status: 'in-progress', sprint_history: [],
    ...overrides,
  } as unknown as MatrixDimension;
}
function makeMatrix(dims: MatrixDimension[]): CompeteMatrix {
  return {
    version: 1, projectName: 'read-gates', dimensions: dims,
    competitors_closed_source: [], competitors_oss: [],
    overallSelfScore: 5.0, lastUpdated: new Date().toISOString(),
  } as unknown as CompeteMatrix;
}

describe('loadMatrix read-path honesty gates', () => {
  it('READ-TIME frontier gate: a frozen-but-unvalidated spec caps derived at 8.0 even with T7-grade receipts (live pilot pin)', async () => {
    // Live failure: the court REJECTED multi_agent_orchestration, yet gap/loadMatrix read 9.0 —
    // the frontier gate only existed in validate's display path, not the read-time derivation.
    const { applyFrontierGate } = await import('../src/core/frontier-spec.js');
    const frozen = { frontier_spec: { status: 'frozen', frozen_hash: 'x', version: 1, target_score: 9,
      leader_target: { competitor: 'c', score: 9, observed_capability: 'real' },
      real_user_path: { required_callsite: 'src/a.ts', run_command: 'node dist/index.js x', observable_artifacts: [] },
      required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' } } };
    assert.equal(applyFrontierGate(9.0, frozen).score, 8.0, 'frozen-not-validated 9.0 must clamp to 8.0');
    assert.equal(applyFrontierGate(9.0, frozen).capped, true);
    const validated = { frontier_spec: { ...frozen.frontier_spec, status: 'validated', frozen_hash: undefined } };
    assert.equal(applyFrontierGate(9.0, validated).score, 9.0, 'court-validated 9.0 passes');
    assert.equal(applyFrontierGate(8.0, {}).score, 8.0, 'at-threshold scores never need a spec');
  });

  it('sees a SUBPROCESS write immediately — mtime+size validation, never a blind TTL hit (fleet run 3b pin)', async () => {
    // Live failure: defaultPushTo9 spawned `frontier-spec init --write` (a child process wrote
    // matrix.json on disk), then re-read through a warm in-process cache and concluded the spec
    // was never created — silently voiding push cycles. Only invalidateMatrixCache()/saveMatrix
    // in THIS process busted the cache; child writes were invisible for the full TTL.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfm-cache-pin-'));
    const matrixDir = path.join(dir, '.danteforge', 'compete');
    await fs.mkdir(matrixDir, { recursive: true });
    const matrixPath = path.join(matrixDir, 'matrix.json');
    const dim = makeDim({ id: 'cache_pin', scores: { self: 5.0 }, gap_to_leader: 2.0 });

    try {
      invalidateMatrixCache();
      await fs.writeFile(matrixPath, JSON.stringify(makeMatrix([dim])), 'utf8');
      const before = await loadMatrix(dir);
      assert.ok(before, 'first real-fs load fills the cache');
      assert.strictEqual((before!.dimensions[0] as unknown as Record<string, unknown>)['frontier_spec'], undefined);

      // The "child process": an out-of-band write the parent's cache knows nothing about.
      const withSpec = makeMatrix([{ ...dim, frontier_spec: { status: 'draft' } } as unknown as MatrixDimension]);
      await fs.writeFile(matrixPath, JSON.stringify(withSpec), 'utf8');

      const after = await loadMatrix(dir); // well inside the 5s TTL
      assert.ok(after);
      assert.deepStrictEqual(
        (after!.dimensions[0] as unknown as Record<string, unknown>)['frontier_spec'],
        { status: 'draft' },
        'a warm cache must never hide an on-disk write made by another process',
      );
    } finally {
      invalidateMatrixCache();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
