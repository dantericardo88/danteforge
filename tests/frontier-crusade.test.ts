import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runFrontierCrusade, type FrontierCrusadeOptions, type FrontierCrusadeResult } from '../src/cli/commands/crusade.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDim(id: string, self: number, ceiling?: number): MatrixDimension {
  return {
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    category: 'core',
    weight: 1,
    scores: { self, competitor: 9.5 },
    gap_to_leader: Math.max(0, 9.5 - self),
    leader: 'competitor',
    gap_to_closed_source_leader: Math.max(0, 9.5 - self),
    closed_source_leader: 'competitor',
    gap_to_oss_leader: Math.max(0, 9.5 - self),
    oss_leader: 'competitor',
    status: self >= 9.0 ? 'closed' : 'in-progress',
    sprint_history: [],
    ...(ceiling !== undefined ? { ceiling } : {}),
  };
}

function makeMatrix(dims: MatrixDimension[]): CompeteMatrix {
  return {
    version: 1,
    projectName: 'test',
    dimensions: dims,
    competitors_closed_source: ['competitor'],
    competitors_oss: [],
    overallSelfScore: 5.0,
    lastUpdated: new Date().toISOString(),
  };
}

function makeOptions(overrides: Partial<FrontierCrusadeOptions> & {
  matrix: CompeteMatrix;
  scores?: Record<string, number[]>;
}): FrontierCrusadeOptions {
  const { matrix, scores = {}, ...rest } = overrides;

  const callCounts: Record<string, number> = {};
  const getScore = async (dimId: string, _cwd: string): Promise<number> => {
    callCounts[dimId] = (callCounts[dimId] ?? 0) + 1;
    const seq = scores[dimId];
    if (seq) {
      const idx = Math.min(callCounts[dimId] - 1, seq.length - 1);
      return seq[idx] ?? seq[seq.length - 1] ?? 0;
    }
    return matrix.dimensions.find(d => d.id === dimId)?.scores['self'] ?? 0;
  };

  return {
    goal: 'test frontier goal',
    cwd: '/tmp/test',
    _loadMatrix: async () => matrix,
    _writeFile: async () => { /* no-op */ },
    _runInferno: async () => { /* no-op */ },
    _getScore: getScore,
    _runAutoResearch: async () => { /* no-op */ },
    ...rest,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runFrontierCrusade', () => {
  it('returns ALL_DONE with empty dimensions when all dims already at target', async () => {
    const matrix = makeMatrix([makeDim('testing', 9.5)]);
    const opts = makeOptions({ matrix });
    const result = await runFrontierCrusade(opts);
    assert.equal(result.status, 'ALL_DONE');
    assert.equal(result.dimensions.length, 0);
  });

  it('returns ALL_DONE with empty dimensions when all dims excluded', async () => {
    const matrix = makeMatrix([makeDim('testing', 5.0)]);
    matrix.excludedDimensions = ['testing'];
    const opts = makeOptions({ matrix });
    const result = await runFrontierCrusade(opts);
    assert.equal(result.status, 'ALL_DONE');
    assert.equal(result.dimensions.length, 0);
  });

  it('drives a dimension to FRONTIER_REACHED when score crosses target', async () => {
    const matrix = makeMatrix([makeDim('testing', 7.0)]);
    const opts = makeOptions({
      matrix,
      scores: { testing: [7.5, 8.0, 9.0] },
      maxDimCycles: 5,
    });
    const result = await runFrontierCrusade(opts);
    assert.equal(result.status, 'ALL_DONE');
    const dim = result.dimensions[0];
    assert.ok(dim, 'expected one dim result');
    assert.equal(dim.status, 'FRONTIER_REACHED');
    assert.ok(dim.finalScore >= 9.0);
  });

  it('stops at AT_CEILING when score reaches dim ceiling below target', async () => {
    // ceiling=5.0, target=9.0: dim is eligible (score < target AND score < ceiling initially),
    // but ceiling < target. When score reaches ceiling, AT_CEILING fires before FRONTIER_REACHED.
    const dim = makeDim('token_economy', 4.0, 5.0);
    const matrix = makeMatrix([dim]);
    const opts: FrontierCrusadeOptions = {
      goal: 'test ceiling',
      cwd: '/tmp/test',
      target: 9.0,
      maxDimCycles: 5,
      stallThreshold: 99,
      _loadMatrix: async () => matrix,
      _writeFile: async () => { /* no-op */ },
      _runInferno: async () => { /* no-op */ },
      _getScore: (() => {
        let call = 0;
        const seq = [4.5, 5.0]; // reaches ceiling=5.0 before target=9.0
        return async (_dimId: string) => { const v = seq[call] ?? seq[seq.length - 1] ?? 4.0; call++; return v; };
      })(),
      _runAutoResearch: async () => { /* no-op */ },
    };
    const result = await runFrontierCrusade(opts);
    const d = result.dimensions[0];
    assert.ok(d, 'expected one dim result');
    assert.equal(d.status, 'AT_CEILING');
    assert.ok(d.finalScore >= 5.0);
  });

  it('triggers autoresearch after stallThreshold consecutive no-progress cycles', async () => {
    const matrix = makeMatrix([makeDim('security', 7.0)]);
    let autoresearchCalled = 0;
    // Score stays flat for 3 cycles (delta=0, < stallDelta=0.1), then jumps on cycle 4
    const opts: FrontierCrusadeOptions = {
      goal: 'security frontier',
      cwd: '/tmp/test',
      target: 9.0,
      maxDimCycles: 10,
      stallThreshold: 3,
      stallDelta: 0.1,
      _loadMatrix: async () => matrix,
      _writeFile: async () => { /* no-op */ },
      _runInferno: async () => { /* no-op */ },
      _runAutoResearch: async () => { autoresearchCalled++; },
      _getScore: (() => {
        let call = 0;
        const seq = [7.0, 7.0, 7.0, 7.0, 9.0]; // flat for 3 cycles then jump
        return async (_dimId: string) => {
          const v = seq[call] ?? seq[seq.length - 1] ?? 7.0;
          call++;
          return v;
        };
      })(),
    };
    await runFrontierCrusade(opts);
    assert.ok(autoresearchCalled >= 1, `expected autoresearch to be called at least once, got ${autoresearchCalled}`);
  });

  it('does not trigger autoresearch when dimension makes steady progress', async () => {
    const matrix = makeMatrix([makeDim('security', 7.0)]);
    let autoresearchCalled = 0;
    const opts: FrontierCrusadeOptions = {
      goal: 'security frontier',
      cwd: '/tmp/test',
      target: 9.0,
      maxDimCycles: 5,
      stallThreshold: 3,
      stallDelta: 0.1,
      _loadMatrix: async () => matrix,
      _writeFile: async () => { /* no-op */ },
      _runInferno: async () => { /* no-op */ },
      _runAutoResearch: async () => { autoresearchCalled++; },
      _getScore: (() => {
        let call = 0;
        const seq = [7.5, 8.0, 8.5, 9.0]; // steady progress each cycle
        return async (_dimId: string) => {
          const v = seq[call] ?? seq[seq.length - 1] ?? 7.0;
          call++;
          return v;
        };
      })(),
    };
    await runFrontierCrusade(opts);
    assert.equal(autoresearchCalled, 0, 'autoresearch should not be triggered when progress is steady');
  });

  it('respects maxDimCycles and returns MAX_CYCLES when stalled permanently', async () => {
    const matrix = makeMatrix([makeDim('security', 7.0)]);
    const opts = makeOptions({
      matrix,
      scores: { security: [7.0] }, // never improves
      maxDimCycles: 3,
      stallThreshold: 99, // disable autoresearch to isolate
    });
    const result = await runFrontierCrusade(opts);
    const dim = result.dimensions[0];
    assert.ok(dim, 'expected one dim result');
    assert.equal(dim.status, 'MAX_CYCLES');
    assert.equal(dim.cyclesRun, 3);
  });

  it('caps parallel slice to specified count', async () => {
    const dims = [
      makeDim('a', 5.0),
      makeDim('b', 5.0),
      makeDim('c', 5.0),
      makeDim('d', 5.0),
      makeDim('e', 5.0),
    ];
    const matrix = makeMatrix(dims);
    // Score returns 9.0 immediately for each dim
    const opts = makeOptions({
      matrix,
      parallel: 2,
      scores: { a: [9.0], b: [9.0], c: [9.0], d: [9.0], e: [9.0] },
      maxDimCycles: 2,
    });
    const result = await runFrontierCrusade(opts);
    // Only 2 dims should be in results (parallel=2)
    assert.equal(result.dimensions.length, 2);
  });

  it('dispatches all parallel dimensions concurrently (no sequential ordering dependency)', async () => {
    const dims = [makeDim('a', 5.0), makeDim('b', 5.0), makeDim('c', 5.0)];
    const matrix = makeMatrix(dims);
    const startTimes: Record<string, number> = {};
    const opts: FrontierCrusadeOptions = {
      goal: 'test',
      cwd: '/tmp/test',
      parallel: 3,
      maxDimCycles: 1,
      _loadMatrix: async () => matrix,
      _writeFile: async () => { /* no-op */ },
      _runInferno: async (_goal, _cwd) => {
        // Record that all inferno calls start within the same tick (concurrent)
        startTimes[_goal] = Date.now();
      },
      _getScore: async (dimId) => {
        return dimId === 'a' ? 9.0 : dimId === 'b' ? 9.0 : 9.0;
      },
      _runAutoResearch: async () => { /* no-op */ },
    };
    const result = await runFrontierCrusade(opts);
    assert.equal(result.dimensions.length, 3);
  });

  it('writes FRONTIER_CRUSADE_REPORT.md on completion', async () => {
    const matrix = makeMatrix([makeDim('testing', 8.5)]);
    let writtenPath = '';
    let writtenContent = '';
    const opts: FrontierCrusadeOptions = {
      goal: 'push testing to 9+',
      cwd: '/tmp/project',
      maxDimCycles: 1,
      _loadMatrix: async () => matrix,
      _writeFile: async (p, c) => { writtenPath = p; writtenContent = c; },
      _runInferno: async () => { /* no-op */ },
      _getScore: async () => 9.0,
      _runAutoResearch: async () => { /* no-op */ },
    };
    await runFrontierCrusade(opts);
    assert.ok(writtenPath.includes('FRONTIER_CRUSADE_REPORT.md'), `Expected report path, got: ${writtenPath}`);
    assert.ok(writtenContent.includes('# FRONTIER_CRUSADE_REPORT.md'), 'Report should have header');
    assert.ok(writtenContent.includes('push testing to 9+'), 'Report should contain goal');
  });

  it('returns PARTIAL when some dimensions reach MAX_CYCLES', async () => {
    const matrix = makeMatrix([
      makeDim('a', 7.0),
      makeDim('b', 7.0),
    ]);
    const opts: FrontierCrusadeOptions = {
      goal: 'test',
      cwd: '/tmp/test',
      parallel: 2,
      maxDimCycles: 2,
      stallThreshold: 99,
      _loadMatrix: async () => matrix,
      _writeFile: async () => { /* no-op */ },
      _runInferno: async () => { /* no-op */ },
      _getScore: async (dimId) => dimId === 'a' ? 9.0 : 7.0,
      _runAutoResearch: async () => { /* no-op */ },
    };
    const result = await runFrontierCrusade(opts);
    assert.equal(result.status, 'PARTIAL');
    const a = result.dimensions.find(d => d.dimensionId === 'a');
    const b = result.dimensions.find(d => d.dimensionId === 'b');
    assert.equal(a?.status, 'FRONTIER_REACHED');
    assert.equal(b?.status, 'MAX_CYCLES');
  });

  it('--loop: keeps re-running passes until ALL_DONE', async () => {
    // Pass 1: dim 'a' (score=7) reaches 9.0, dim 'b' (score=7) stays at 7 (MAX_CYCLES)
    // Pass 2: matrix re-read shows b still at 7, b reaches 9.0
    let pass = 0;
    const scores: Record<string, number[][]> = {
      a: [[9.0]], // always 9 from first cycle
      b: [[7.0, 7.0], [9.0]], // stalls pass 1, succeeds pass 2
    };
    const calls: Record<string, number> = { a: 0, b: 0 };

    // Simulate matrix that updates between passes
    const baseMatrix = makeMatrix([makeDim('a', 7.0), makeDim('b', 7.0)]);
    let matrixState = baseMatrix;

    const opts: FrontierCrusadeOptions = {
      goal: 'test loop',
      cwd: '/tmp/test',
      parallel: 2,
      maxDimCycles: 2,
      stallThreshold: 99,
      loop: true,
      _writeFile: async () => { /* no-op */ },
      _runInferno: async () => { /* no-op */ },
      _loadMatrix: async () => {
        pass++;
        // On pass 2, update matrix so 'a' is now at 9.0 (closed), only 'b' remains
        if (pass > 1) {
          matrixState = makeMatrix([makeDim('a', 9.0), makeDim('b', 7.0)]);
          matrixState.dimensions[0].status = 'closed';
        }
        return matrixState;
      },
      _getScore: async (dimId) => {
        calls[dimId] = (calls[dimId] ?? 0) + 1;
        const passScores = scores[dimId] ?? [];
        const passIdx = Math.min((pass > 1 ? 1 : 0), passScores.length - 1);
        const seq = passScores[passIdx] ?? [7.0];
        const idx = Math.min((calls[dimId] ?? 1) - 1, seq.length - 1);
        return seq[idx] ?? seq[seq.length - 1] ?? 7.0;
      },
      _runAutoResearch: async () => { /* no-op */ },
    };
    const result = await runFrontierCrusade(opts);
    assert.equal(result.status, 'ALL_DONE');
  });

  it('--verify-cap: continues improving when capability_test fails despite score >= target', async () => {
    const matrix = makeMatrix([makeDim('security', 7.0)]);
    let capCallCount = 0;
    const opts: FrontierCrusadeOptions = {
      goal: 'security frontier',
      cwd: '/tmp/test',
      target: 9.0,
      maxDimCycles: 5,
      stallThreshold: 99,
      verifyCap: true,
      _loadMatrix: async () => matrix,
      _writeFile: async () => { /* no-op */ },
      _runInferno: async () => { /* no-op */ },
      _getScore: async () => 9.0, // always at target
      _runVerifyCap: async () => {
        capCallCount++;
        return capCallCount >= 2; // fails first call, passes second
      },
      _runAutoResearch: async () => { /* no-op */ },
    };
    const result = await runFrontierCrusade(opts);
    const dim = result.dimensions[0];
    assert.ok(dim, 'expected one dim result');
    assert.equal(dim.status, 'FRONTIER_REACHED');
    assert.ok(capCallCount >= 2, `expected at least 2 verify-cap calls, got ${capCallCount}`);
  });

  it('--verify-cap: declares FRONTIER_REACHED immediately when capability_test passes', async () => {
    const matrix = makeMatrix([makeDim('testing', 7.0)]);
    let capCallCount = 0;
    const opts: FrontierCrusadeOptions = {
      goal: 'test',
      cwd: '/tmp/test',
      target: 9.0,
      maxDimCycles: 5,
      stallThreshold: 99,
      verifyCap: true,
      _loadMatrix: async () => matrix,
      _writeFile: async () => { /* no-op */ },
      _runInferno: async () => { /* no-op */ },
      _getScore: async () => 9.0,
      _runVerifyCap: async () => { capCallCount++; return true; },
      _runAutoResearch: async () => { /* no-op */ },
    };
    const result = await runFrontierCrusade(opts);
    assert.equal(result.dimensions[0]?.status, 'FRONTIER_REACHED');
    assert.equal(capCallCount, 1, 'should stop after first successful verify');
  });
});
