// Split from compete-matrix.test.ts (750-line LOC gate): adversarial calibration,
// excludedDimensions, the loadMatrix cache surface, the saveMatrix test-isolation guard,
// and the saveMatrix reconciliation clamp.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  getNextSprintDimension,
  getTopGapDimensions,
  classifyDimensions,
  excludeDimension,
  includeDimension,
  applyAdversarialCalibration,
  loadMatrix,
  saveMatrix,
  invalidateMatrixCache,
  type MatrixDimension,
  type CompeteMatrix,
} from '../src/core/compete-matrix.js';

function makeDim(overrides: Partial<MatrixDimension> = {}): MatrixDimension {
  return {
    id: 'test_dim', label: 'Test Dimension', weight: 1.0, category: 'quality', frequency: 'medium',
    scores: { self: 5.0, cursor: 9.0 },
    gap_to_leader: 4.0, leader: 'cursor',
    gap_to_closed_source_leader: 4.0, closed_source_leader: 'cursor',
    gap_to_oss_leader: 0, oss_leader: 'unknown',
    status: 'not-started', sprint_history: [], next_sprint_target: 7.0,
    ...overrides,
  } as unknown as MatrixDimension;
}
function makeMatrix(dims: MatrixDimension[]): CompeteMatrix {
  return {
    project: 'TestProject',
    competitors: ['cursor'],
    lastUpdated: '2026-04-13T00:00:00.000Z',
    overallSelfScore: 5.0,
    dimensions: dims,
  } as unknown as CompeteMatrix;
}

// ── applyAdversarialCalibration ───────────────────────────────────────────────

describe('applyAdversarialCalibration()', () => {
  function makeCalMatrix(selfScore: number): CompeteMatrix {
    const dim: MatrixDimension = {
      ...makeDim({ id: 'ux_polish', label: 'UX Polish' }),
      scores: { self: selfScore, Cursor: 9.2 },
      gap_to_leader: Math.max(0, 9.2 - selfScore),
      leader: 'Cursor',
    };
    return {
      project: 'p',
      competitors: ['Cursor'],
      competitors_closed_source: ['Cursor'],
      competitors_oss: [],
      lastUpdated: '',
      overallSelfScore: selfScore,
      dimensions: [dim],
    } as unknown as CompeteMatrix;
  }

  it('T20: reduces inflated self-score to consensus of harsh and adversarial scores', () => {
    const matrix = makeCalMatrix(10.0);
    const applied = applyAdversarialCalibration(matrix, 'ux_polish', 8.0, 7.0, 'inflated', 'UX is aspirational');
    assert.ok(applied, 'should return true for inflated verdict');
    assert.strictEqual(matrix.dimensions[0]!.scores['self'], 7.5, 'consensus = (8.0 + 7.0) / 2 = 7.5');
    assert.ok(matrix.adversarialCalibrations?.length === 1, 'calibration record appended');
    assert.strictEqual(matrix.adversarialCalibrations![0]!.dimensionId, 'ux_polish');
    assert.strictEqual(matrix.adversarialCalibrations![0]!.verdict, 'inflated');
    assert.strictEqual(matrix.adversarialCalibrations![0]!.beforeScore, 10.0);
    assert.strictEqual(matrix.adversarialCalibrations![0]!.afterScore, 7.5);
  });

  it('T21: no-op for trusted verdict — returns false, score unchanged', () => {
    const matrix = makeCalMatrix(8.0);
    const applied = applyAdversarialCalibration(matrix, 'ux_polish', 8.0, 8.1, 'trusted', 'score matches');
    assert.strictEqual(applied, false);
    assert.strictEqual(matrix.dimensions[0]!.scores['self'], 8.0, 'score unchanged');
    assert.ok(!matrix.adversarialCalibrations?.length, 'no calibration record added');
  });

  it('T22: no-op for watch verdict', () => {
    const matrix = makeCalMatrix(9.0);
    const applied = applyAdversarialCalibration(matrix, 'ux_polish', 9.0, 8.0, 'watch', 'minor gap');
    assert.strictEqual(applied, false);
  });

  it('T23: no-op for unknown dimension id — returns false', () => {
    const matrix = makeCalMatrix(10.0);
    const applied = applyAdversarialCalibration(matrix, 'nonexistent_dim', 5.0, 4.0, 'inflated', 'x');
    assert.strictEqual(applied, false);
  });

  it('T24: respects ceiling — consensus clamped to ceiling', () => {
    const matrix = makeCalMatrix(10.0);
    matrix.dimensions[0]!.ceiling = 8.0;
    const applied = applyAdversarialCalibration(matrix, 'ux_polish', 9.0, 7.0, 'inflated', 'ceiling test');
    assert.ok(applied);
    assert.ok(matrix.dimensions[0]!.scores['self']! <= 8.0, 'score must not exceed ceiling');
  });

  it('T25: overall score is recomputed after calibration', () => {
    const matrix = makeCalMatrix(10.0);
    applyAdversarialCalibration(matrix, 'ux_polish', 8.0, 7.0, 'inflated', 'recompute test');
    assert.strictEqual(matrix.overallSelfScore, 7.5, 'overall score recomputed');
  });

  it('T26: gap_to_leader recomputed upward after score reduction', () => {
    const matrix = makeCalMatrix(10.0);
    applyAdversarialCalibration(matrix, 'ux_polish', 8.0, 7.0, 'inflated', 'gap test');
    const gap = matrix.dimensions[0]!.gap_to_leader;
    assert.ok(gap > 0, `gap should now be positive; got ${gap}`);
  });
});

// ── excludedDimensions filtering ─────────────────────────────────────────────

describe('excludedDimensions', () => {
  it('getNextSprintDimension skips excluded dimensions', () => {
    const a = makeDim({ id: 'a', gap_to_leader: 5.0, weight: 2.0 });
    const b = makeDim({ id: 'b', gap_to_leader: 3.0 });
    const matrix = makeMatrix([a, b]);
    matrix.excludedDimensions = ['a'];
    const next = getNextSprintDimension(matrix);
    assert.ok(next !== null);
    assert.strictEqual(next!.id, 'b', 'should pick b because a is excluded');
  });

  it('getTopGapDimensions skips excluded dimensions', () => {
    const a = makeDim({ id: 'a', gap_to_leader: 8.0, weight: 2.0, frequency: 'high' });
    const b = makeDim({ id: 'b', gap_to_leader: 5.0 });
    const matrix = makeMatrix([a, b]);
    matrix.excludedDimensions = ['a'];
    const top = getTopGapDimensions(matrix, 5);
    assert.strictEqual(top.length, 1);
    assert.strictEqual(top[0]!.id, 'b');
  });

  it('classifyDimensions skips excluded dimensions from both buckets', () => {
    const a = makeDim({ id: 'a' });
    const b = makeDim({ id: 'b', ceiling: 3.0, ceilingReason: 'human-bounded' });
    const matrix = makeMatrix([a, b]);
    matrix.excludedDimensions = ['a', 'b'];
    const { achievable, atCeiling } = classifyDimensions(matrix, 9.0);
    assert.strictEqual(achievable.length, 0);
    assert.strictEqual(atCeiling.length, 0);
  });

  it('excludeDimension is idempotent and records lastUpdated', async () => {
    const matrix = makeMatrix([makeDim({ id: 'x' })]);
    const before = matrix.lastUpdated;
    await new Promise(r => setTimeout(r, 5));
    excludeDimension(matrix, 'x');
    excludeDimension(matrix, 'x');
    assert.deepStrictEqual(matrix.excludedDimensions, ['x']);
    assert.notStrictEqual(matrix.lastUpdated, before);
  });

  it('includeDimension reverses a previous exclude', () => {
    const matrix = makeMatrix([makeDim({ id: 'x' })]);
    excludeDimension(matrix, 'x');
    includeDimension(matrix, 'x');
    assert.deepStrictEqual(matrix.excludedDimensions, []);
  });
});

// ── loadMatrix TTL cache ───────────────────────────────────────────────────────

describe('loadMatrix in-process cache', () => {
  it('returns cached result on second call when using real fs (via injected reads)', async () => {
    // Use injected reads so the cache key never matches real fs — safe isolation
    let readCount = 0;
    const dim = makeDim({ id: 'cache_test', scores: { self: 7.0 }, gap_to_leader: 1.0 });
    const matrixJson = JSON.stringify(makeMatrix([dim]));
    const fakeRead = async (_p: string) => { readCount++; return matrixJson; };

    const m1 = await loadMatrix('/fake/cache/cwd', fakeRead);
    const m2 = await loadMatrix('/fake/cache/cwd', fakeRead);

    // Both calls return valid matrices
    assert.ok(m1 !== null && m2 !== null);
    assert.strictEqual(m1!.dimensions[0]!.id, 'cache_test');
    // Injected reads bypass the cache, so readCount should be 2
    assert.strictEqual(readCount, 2);
  });

  it('invalidateMatrixCache is a callable export', () => {
    // Smoke test: should not throw
    assert.doesNotThrow(() => { invalidateMatrixCache(); });
  });

  // The read-path honesty pins (subprocess-write cache seam + read-time frontier gate) live in
  // tests/compete-matrix-read-gates.test.ts.

  it('saveMatrix calls through without error on injected write', async () => {
    let written = '';
    const dim = makeDim({ id: 'save_cache_test', scores: { self: 8.0 }, gap_to_leader: 0.5 });
    const matrix = makeMatrix([dim]);
    await saveMatrix(matrix, '/fake/save/cwd', async (_p, c) => { written = c; });
    const parsed = JSON.parse(written) as CompeteMatrix;
    assert.strictEqual(parsed.dimensions[0]!.id, 'save_cache_test');
  });
});

// ── Test-isolation guard ──────────────────────────────────────────────────────
// Regression for the matrix-clobber incident (council 2026-05-29): a test wrote
// the live .danteforge/compete/matrix.json. saveMatrix now refuses a real-disk
// write to a non-temp path during a test run.

describe('saveMatrix test-isolation guard', () => {
  it('THROWS on a real-disk write to a non-temp path during a test run', async () => {
    const matrix = makeMatrix([makeDim({ id: 'guard_test', scores: { self: 8.0 } })]);
    // No _fsWrite seam + a real (non-tmp) cwd → must throw rather than clobber.
    await assert.rejects(
      () => saveMatrix(matrix, 'X:/Projects/DanteForge'),
      /Refusing to write a real matrix\.json during a test run/,
    );
  });

  it('ALLOWS a real write when the cwd is under os.tmpdir()', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'df-matrix-guard-'));
    try {
      const matrix = makeMatrix([makeDim({ id: 'tmp_ok', scores: { self: 7.0 } })]);
      await saveMatrix(matrix, tmpRoot); // real write, but under tmp → allowed
      const written = await fs.readFile(path.join(tmpRoot, '.danteforge', 'compete', 'matrix.json'), 'utf8');
      assert.ok(written.includes('tmp_ok'));
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('ALLOWS any path when the _fsWrite seam is provided (no real disk write)', async () => {
    const matrix = makeMatrix([makeDim({ id: 'seam_ok', scores: { self: 9.0 } })]);
    let captured = '';
    // Seam present → guard does not fire even for a real-looking path.
    await saveMatrix(matrix, 'X:/Projects/DanteForge', async (_p, c) => { captured = c; });
    assert.ok(captured.includes('seam_ok'));
  });
});

// ── saveMatrix reconciliation clamp ───────────────────────────────────────────
// Rank-8 split-brain backstop: live derivation refuses values above the market cap /
// declared ceiling, so a PERSISTED value above them is stale split-brain state. The
// save boundary clamps both scores.self and scores.derived through the canonical
// clampDimScore — it can only LOWER or hold, never raise.

describe('saveMatrix reconciliation clamp', () => {
  it('a stale market-dim (token_economy) self 9.0 / derived 7.5 saves as 5.0; under-cap values untouched', async () => {
    let written = '';
    const stale = makeDim({ id: 'token_economy', scores: { self: 9.0, derived: 7.5, cursor: 9.0 } });
    const honest = makeDim({ id: 'honest_dim', scores: { self: 6.5, derived: 6.0, cursor: 9.0 } });
    const matrix = makeMatrix([stale, honest]);

    await saveMatrix(matrix, '/fake/reconcile', async (_p, c) => { written = c; });

    const parsed = JSON.parse(written) as CompeteMatrix;
    const t = parsed.dimensions.find(d => d.id === 'token_economy')!;
    assert.strictEqual(t.scores['self'], 5.0, 'market-capped self 9.0 must persist as 5.0');
    assert.strictEqual(t.scores['derived'], 5.0, 'market-capped derived 7.5 must persist as 5.0');
    const h = parsed.dimensions.find(d => d.id === 'honest_dim')!;
    assert.strictEqual(h.scores['self'], 6.5, 'a value under the cap must be untouched');
    assert.strictEqual(h.scores['derived'], 6.0, 'an under-cap derived must be untouched');
    // The self-lowering routes through writeVerifiedScore → carries an auditable provenance row.
    assert.ok(
      parsed.scoreProvenance?.some(p => p.dimensionId === 'token_economy' && p.agent === 'save-reconcile' && p.after === 5.0),
      'the reconciliation write must carry save-reconcile provenance',
    );
  });

  it('clamps above-ceiling values; never raises a value already under its caps', async () => {
    let written = '';
    const over = makeDim({ id: 'testing', scores: { self: 7.2, derived: 6.8, cursor: 9.0 }, ceiling: 6.0 });
    const under = makeDim({ id: 'token_economy', scores: { self: 4.0, cursor: 9.0 } });
    const matrix = makeMatrix([over, under]);

    await saveMatrix(matrix, '/fake/reconcile2', async (_p, c) => { written = c; });

    const parsed = JSON.parse(written) as CompeteMatrix;
    const o = parsed.dimensions.find(d => d.id === 'testing')!;
    assert.strictEqual(o.scores['self'], 6.0, 'above-ceiling self must be clamped to the ceiling');
    assert.strictEqual(o.scores['derived'], 6.0, 'above-ceiling derived must be clamped to the ceiling');
    const u = parsed.dimensions.find(d => d.id === 'token_economy')!;
    assert.strictEqual(u.scores['self'], 4.0, 'reconciliation must never RAISE a value toward the cap');
  });
});
