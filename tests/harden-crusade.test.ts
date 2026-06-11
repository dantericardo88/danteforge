import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runHardenCrusade,
  type HardenCrusadeOptions,
  type HardenDimResult,
} from '../src/cli/commands/harden-crusade.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeDim(id: string, selfScore: number, opts: Partial<MatrixDimension> = {}): MatrixDimension {
  return {
    id,
    label: id,
    description: '',
    scores: { self: selfScore },
    weight: 1,
    outcomes: [],
    // Default capability_test so fixtures exercise the realistic build-to-7 path (autoresearch is
    // metric-driven). Tests that need the no-metric path pass `no_capability_test: true` explicitly.
    capability_test: { command: `echo ${id}`, description: 'fixture metric' },
    ...opts,
  } as unknown as MatrixDimension;
}

function makeMatrix(dims: MatrixDimension[]): CompeteMatrix {
  return {
    dimensions: dims,
    version: '1',
    projectName: 'test',
    competitors: [],
  } as unknown as CompeteMatrix;
}

const gatePass: HardenDimResult = { allowed: true, scoreCap: 10, failedChecks: [] };
const gateCap6: HardenDimResult = { allowed: false, scoreCap: 6.0, failedChecks: ['recency-check'] };

function baseOpts(overrides: Partial<HardenCrusadeOptions> = {}): HardenCrusadeOptions {
  return {
    goal: 'test goal',
    cwd: '/tmp/test-harden-crusade',
    parallel: 4,
    target: 9.0,
    maxDimCycles: 3,
    timeMinutes: 1,
    loop: false,
    _loadState: null,
    // L8 default for these suites: a FAILING capability test, so the builder-dispatch path stays
    // available — the legacy behavior every pre-L8 expectation here was written against. L8's
    // routing behavior itself is pinned in tests/laws/laws-l8-evidence-bound-routing.test.ts.
    _runCapTest: async () => 1,
    _runAutoResearch: async () => { /* no-op */ },
    _runOutcomesForDim: async () => { /* no-op */ },
    _writeFile: async () => { /* no-op */ },
    // CIP pass-through: tests run without a real project dir; bypass the matrix.json check
    _cipCheck: async () => ({ passed: true, gaps: [], score: 1.0, cipScore: 1.0, blocksFrontierReached: false }),
    // Autonomy rules bypass: tests run without crusade state on disk
    _checkAutonomyRules: null,
    ...overrides,
  };
}

// ── Outcomes refresh seam ─────────────────────────────────────────────────────

describe('runHardenCrusade — outcomes refresh', () => {
  it('calls _runOutcomesForDim once per cycle after autoresearch', async () => {
    const dim = makeDim('security', 5.0);
    const matrix = makeMatrix([dim]);
    let outcomesRefreshCalls = 0;
    let autoresearchCalls = 0;

    await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      _getScore: async () => 9.5,
      _runAutoResearch: async () => { autoresearchCalls++; },
      _runOutcomesForDim: async () => { outcomesRefreshCalls++; },
      _runHardenForDim: async () => gatePass,
      maxDimCycles: 2,
    }));

    // Should have refreshed outcomes at least once (one cycle ran before FRONTIER_REACHED)
    assert.ok(outcomesRefreshCalls >= 1, 'outcomes refresh should run after autoresearch');
    assert.equal(outcomesRefreshCalls, autoresearchCalls, 'one refresh per autoresearch run');
  });
});

// ── pickWeakestDims behavior (tested indirectly through runHardenCrusade) ──────

describe('runHardenCrusade — eligibility', () => {
  it('includes dims with no numeric ceiling field (declared_ceiling T3 should not exclude)', async () => {
    // With target=9 and declared_ceiling=T3 (cap 6), a dim should still be eligible
    // because declared_ceiling is informational only — only numeric d.ceiling excludes.
    const dim = makeDim('testing', 0.0, { declared_ceiling: 'T3' } as Partial<MatrixDimension>);
    let dimLoopCalled = false;

    const matrix = makeMatrix([dim]);
    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      _getScore: async () => 0.0,
      _runAutoResearch: async () => { dimLoopCalled = true; },
      _runHardenForDim: async () => gatePass,
    }));
    assert.ok(dimLoopCalled || result.dimensions.length === 1, 'dim with declared_ceiling T3 should be eligible');
  });

  it('excludes dims where score has already reached numeric d.ceiling', async () => {
    // A dim at its ceiling (score >= d.ceiling) should be skipped — already done.
    const dim = makeDim('community_adoption', 4.0, { ceiling: 4 } as Partial<MatrixDimension>);
    let autoResearchCalled = false;

    const matrix = makeMatrix([dim]);
    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      _getScore: async () => 4.0,
      _runAutoResearch: async () => { autoResearchCalled = true; },
      _runHardenForDim: async () => gatePass,
    }));
    assert.equal(autoResearchCalled, false, 'dim already at its numeric ceiling should be excluded');
    assert.equal(result.dimensions.length, 0);
    assert.equal(result.status, 'ALL_DONE');
  });

  it('includes dim with numeric ceiling=4 when score=0 (hasn\'t hit ceiling yet)', async () => {
    // community_adoption at score=0 with ceiling=4: eligible since 0 < 4.
    // The harden gate then classifies AT_CEILING when it caps at 4.
    const dim = makeDim('community_adoption', 0.0, { ceiling: 4 } as Partial<MatrixDimension>);
    let autoResearchCalled = false;

    const matrix = makeMatrix([dim]);
    await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      _getScore: async () => 0.0,
      _runAutoResearch: async () => { autoResearchCalled = true; },
      _runHardenForDim: async () => ({ allowed: false, scoreCap: 4.0, failedChecks: ['recency-check'] }),
    }));
    assert.equal(autoResearchCalled, true, 'dim with score < numeric ceiling should be eligible');
  });

  it('excludes dims with status=closed when score is near target (already at frontier)', async () => {
    // A closed dim at score=9.0 (>= 80% of target 9.0=7.2) should be excluded.
    const dim = makeDim('closed_dim', 9.0, { status: 'closed' } as Partial<MatrixDimension>);
    const matrix = makeMatrix([dim]);
    let called = false;
    await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      _getScore: async () => 9.0,
      _runAutoResearch: async () => { called = true; },
      _runHardenForDim: async () => gatePass,
    }));
    assert.equal(called, false);
  });

  it('reopens dims with status=closed when derived score dropped below 80% of target', async () => {
    // A closed dim at score=0 (evidence expired after commit) should be reopened.
    const dim = makeDim('stale_closed', 0.0, { status: 'closed' } as Partial<MatrixDimension>);
    const matrix = makeMatrix([dim]);
    let called = false;
    await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      _getScore: async () => 0.0,
      _runAutoResearch: async () => { called = true; },
      _runHardenForDim: async () => gatePass,
    }));
    assert.equal(called, true, 'stale closed dim should be reopened for crusade');
  });
});

// ── Per-dim loop outcomes ─────────────────────────────────────────────────────

describe('runHardenCrusade — dim loop outcomes', () => {
  it('FRONTIER_REACHED when score >= target and gate passes', async () => {
    const dim = makeDim('functionality', 7.0);
    const matrix = makeMatrix([dim]);

    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      _getScore: async () => 9.5,
      _runAutoResearch: async () => { /* no-op */ },
      _runHardenForDim: async () => gatePass,
    }));

    assert.equal(result.dimensions[0]?.status, 'FRONTIER_REACHED');
    assert.equal(result.status, 'ALL_DONE');
  });

  it('AT_CEILING when gate caps below target', async () => {
    const dim = makeDim('functionality', 5.0);
    const matrix = makeMatrix([dim]);

    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      _getScore: async () => 5.5,
      _runAutoResearch: async () => { /* no-op */ },
      _runHardenForDim: async () => gateCap6,
    }));

    assert.equal(result.dimensions[0]?.status, 'AT_CEILING');
    assert.equal(result.dimensions[0]?.finalCap, 6.0);
  });

  it('GATE_BLOCKED when no progress after 2 autoresearch runs', async () => {
    const dim = makeDim('performance', 5.0);
    const matrix = makeMatrix([dim]);
    let calls = 0;

    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      _getScore: async () => 5.0, // no progress
      _runAutoResearch: async () => { calls++; },
      _runHardenForDim: async () => gatePass,
      maxDimCycles: 6,
    }));

    assert.equal(result.dimensions[0]?.status, 'GATE_BLOCKED');
    assert.ok(calls >= 2, 'should have run at least 2 autoresearch attempts');
  });

  it('MAX_CYCLES when cycle limit reached without hitting target or ceiling', async () => {
    const dim = makeDim('security', 7.0);
    const matrix = makeMatrix([dim]);
    let cycle = 0;

    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      // Score improves by 0.1 each cycle — but never reaches 9.0 within maxDimCycles=3
      _getScore: async () => { cycle++; return 7.0 + cycle * 0.1; },
      _runAutoResearch: async () => { /* no-op */ },
      _runHardenForDim: async () => gatePass,
      maxDimCycles: 3,
    }));

    assert.equal(result.dimensions[0]?.status, 'MAX_CYCLES');
    assert.equal(result.dimensions[0]?.cyclesRun, 3);
  });
});

// ── Regrade cadence ───────────────────────────────────────────────────────────

describe('runHardenCrusade — regrade cadence', () => {
  it('blocks when wavesSinceLastRegrade > 3', async () => {
    const dim = makeDim('testing', 5.0);
    const matrix = makeMatrix([dim]);

    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      _getScore: async () => 9.0,
      _runHardenForDim: async () => gatePass,
      _loadState: async () => ({ wavesSinceLastRegrade: 4 }),
    }));

    assert.equal(result.status, 'PARTIAL');
    assert.equal(result.dimensions.length, 0, 'should have been blocked before pushing any dims');
  });

  it('proceeds when _loadState is null (test isolation)', async () => {
    const dim = makeDim('testing', 7.0);
    const matrix = makeMatrix([dim]);

    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => matrix,
      _getScore: async () => 9.5,
      _runAutoResearch: async () => { /* no-op */ },
      _runHardenForDim: async () => gatePass,
      _loadState: null,
    }));

    assert.equal(result.dimensions[0]?.status, 'FRONTIER_REACHED');
  });
});

// ── Parallel pass (loop mode) ──────────────────────────────────────────────────

describe('runHardenCrusade — loop mode', () => {
  it('runs multiple passes until ALL_DONE', async () => {
    let passCount = 0;
    const dims = [makeDim('a', 5.0), makeDim('b', 5.0), makeDim('c', 5.0)];

    const result = await runHardenCrusade(baseOpts({
      loop: true,
      parallel: 2,
      _loadMatrix: async () => {
        passCount++;
        // After pass 2, pretend all dims hit target
        const score = passCount >= 2 ? 9.0 : 5.0;
        return makeMatrix(dims.map(d => makeDim(d.id, score)));
      },
      _getScore: async () => 9.5,
      _runAutoResearch: async () => { /* no-op */ },
      _runHardenForDim: async () => gatePass,
      _loadState: null,
    }));

    assert.equal(result.status, 'ALL_DONE');
    // All pushed dims should be FRONTIER_REACHED
    assert.ok(result.dimensions.every(d => d.status === 'FRONTIER_REACHED'), 'all dims should be FRONTIER_REACHED');
  });
});

// ── Fix A: capability_test wired as the autoresearch measurement metric ───────────
// Root cause of the fleet build-to-7 crash/hang: autoresearch was invoked with --metric <dimId>
// but NO --measurement-command, so it errored "needs an explicit measurement command".

describe('runHardenCrusade — autoresearch measurement-command (fleet build-to-7 fix)', () => {
  it("passes the dim's capability_test command as the autoresearch measurement metric", async () => {
    const dim = makeDim('security', 5.0, {
      capability_test: { command: 'node dist/index.js security-scan --dry-run', description: 'scan' },
    } as Partial<MatrixDimension>);
    let receivedMeasurementCommand: string | undefined = 'UNSET';
    await runHardenCrusade(baseOpts({
      _loadMatrix: async () => makeMatrix([dim]),
      _getScore: async () => 5.0,        // stays below target → autoresearch runs
      _runAutoResearch: async (_id, _goal, _cwd, _t, mc) => { receivedMeasurementCommand = mc; },
      _runHardenForDim: async () => gatePass,
      target: 7, maxDimCycles: 1,
    }));
    assert.equal(receivedMeasurementCommand, 'node dist/index.js security-scan --dry-run',
      'autoresearch must receive the capability_test command — never undefined (the crash cause)');
  });

  it('does NOT select a dim already within a rounding-hair of target (no "Improve from 7.00 to 7" waste)', async () => {
    const atTarget = makeDim('reliability', 6.97);   // 6.97 >= 7 - 0.05 → excluded
    const realGap = makeDim('performance', 5.0);     // genuine sub-target → built
    const built = new Set<string>();
    await runHardenCrusade(baseOpts({
      _loadMatrix: async () => makeMatrix([atTarget, realGap]),
      _getScore: async (id) => (id === 'reliability' ? 6.97 : 5.0),
      _runAutoResearch: async (id) => { built.add(id); },
      _runHardenForDim: async () => gatePass,
      target: 7, maxDimCycles: 1,
    }));
    assert.ok(!built.has('reliability'), 'a ~7.0 dim must not consume a build slot');
    assert.ok(built.has('performance'), 'the genuine sub-target dim is built');
  });

  it('skips autoresearch entirely for a dim with no_capability_test (no metric to measure)', async () => {
    const dim = makeDim('token_economy', 5.0, { no_capability_test: true } as Partial<MatrixDimension>);
    let autoresearchCalls = 0;
    await runHardenCrusade(baseOpts({
      _loadMatrix: async () => makeMatrix([dim]),
      _getScore: async () => 5.0,
      _runAutoResearch: async () => { autoresearchCalls++; },
      _runHardenForDim: async () => gatePass,
      target: 7, maxDimCycles: 1,
    }));
    assert.equal(autoresearchCalls, 0, 'a no_capability_test dim must not invoke autoresearch (would crash)');
  });
});

// ── Wall-clock budget checkpoint (--max-minutes, fleet run 2 dead-loop fix) ───
// The orchestrator's runner tree-kills harden-crusade at the phase cap. With --max-minutes set
// UNDER that cap, the run must stop CLEANLY between cycles — never start a cycle it cannot finish
// — so merged progress persists and the next orchestrator cycle continues from the re-ranked queue.

describe('runHardenCrusade — wall-clock budget checkpoint (--max-minutes)', () => {
  it('exits cleanly before starting a cycle it cannot finish (seamed clock)', async () => {
    const dim = makeDim('security', 5.0);
    let clockMs = 0;
    let autoresearchCalls = 0;
    let score = 5.0;
    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => makeMatrix([dim]),
      _now: () => clockMs,
      maxMinutes: 30,
      timeMinutes: 18, // a cycle needs 18 + 2m slack of remaining budget to be allowed to start
      maxDimCycles: 6,
      target: 9,
      // Genuine progress each cycle — without the guard the loop would happily keep cycling.
      _getScore: async () => { score += 0.5; return score; },
      // Each cycle consumes 25 simulated minutes (autoresearch + merge-back).
      _runAutoResearch: async () => { autoresearchCalls++; clockMs += 25 * 60_000; },
      _runHardenForDim: async () => gatePass,
    }));
    assert.equal(autoresearchCalls, 1, 'cycle 1 fits (0 + 20 <= 30); cycle 2 must NOT start (25 + 20 > 30)');
    assert.equal(result.budgetReached, true, 'the clean checkpoint must be marked (this is the exit-0 path)');
    assert.equal(result.status, 'PARTIAL', 'the dim has not settled — the orchestrator re-plans');
    assert.equal(result.dimensions[0]?.status, 'CHECKPOINT');
    assert.equal(result.dimensions[0]?.autoresearchRuns, 1, 'partial progress is recorded, not discarded');
  });

  it('without --max-minutes the clock never trips the guard (prior behavior preserved)', async () => {
    const dim = makeDim('security', 5.0);
    let clockMs = 0;
    let autoresearchCalls = 0;
    let score = 5.0;
    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => makeMatrix([dim]),
      _now: () => clockMs,
      timeMinutes: 18,
      maxDimCycles: 3,
      target: 9,
      _getScore: async () => { score += 0.5; return score; },
      _runAutoResearch: async () => { autoresearchCalls++; clockMs += 25 * 60_000; },
      _runHardenForDim: async () => gatePass,
    }));
    assert.equal(autoresearchCalls, 3, 'unguarded run cycles to maxDimCycles regardless of elapsed time');
    assert.equal(result.budgetReached, false);
    assert.equal(result.dimensions[0]?.status, 'MAX_CYCLES');
  });

  it('a budget stop with work remaining NEVER inflates to ALL_DONE (report still written)', async () => {
    // Budget so tight even the FIRST cycle cannot start — the run must checkpoint immediately
    // (no pass started, zero cycles), write its report as usual, and report PARTIAL + budgetReached.
    const dim = makeDim('security', 5.0);
    let autoresearchCalls = 0;
    let reportWritten = '';
    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => makeMatrix([dim]),
      _now: () => 0,
      maxMinutes: 10, // 0 + (18 + 2) > 10 → the pass (and cycle 1) never starts
      timeMinutes: 18,
      target: 9,
      _getScore: async () => 5.0,
      _runAutoResearch: async () => { autoresearchCalls++; },
      _runHardenForDim: async () => gatePass,
      _writeFile: async (_p, c) => { reportWritten = c; },
    }));
    assert.equal(autoresearchCalls, 0, 'no cycle may start when even the first cannot finish');
    assert.equal(result.budgetReached, true);
    assert.equal(result.status, 'PARTIAL', 'a checkpoint exit with work remaining must never read ALL_DONE');
    assert.equal(result.dimensions.length, 0, 'nothing was attempted — nothing may be claimed');
    assert.ok(reportWritten.includes('HARDEN_CRUSADE_REPORT'), 'the report is written as usual on a checkpoint exit');
  });

  it('a genuinely finished run still reads ALL_DONE even with --max-minutes set (no false PARTIAL)', async () => {
    // All dims already at target → the empty-todo break fires BEFORE the budget check.
    const dim = makeDim('security', 9.5);
    const result = await runHardenCrusade(baseOpts({
      _loadMatrix: async () => makeMatrix([dim]),
      _now: () => 0,
      maxMinutes: 10,
      timeMinutes: 18,
      target: 9,
      _getScore: async () => 9.5,
      _runHardenForDim: async () => gatePass,
    }));
    assert.equal(result.status, 'ALL_DONE');
    assert.equal(result.budgetReached, false, 'the guard must not trip when there was no work to start');
  });
});
