// Tests for council-crusade command.
// All tests use injection seams — no real subprocesses, no disk I/O (except
// the report-file test which writes to a temp directory).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import {
  runCouncilCrusade,
} from '../src/cli/commands/council-crusade.js';
import type {
  CouncilCrusadeOptions,
  CouncilCrusadeResult,
} from '../src/cli/commands/council-crusade.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';
import type { ParallelCouncilOptions } from '../src/cli/commands/council-parallel.js';

// ── Matrix factory ────────────────────────────────────────────────────────────

function makeDim(
  id: string,
  self: number,
  weight = 1.0,
  overrides: Partial<MatrixDimension> = {},
): MatrixDimension {
  return {
    id,
    label: id.replace(/_/g, ' '),
    weight,
    category: 'features',
    frequency: 'medium',
    scores: { self },
    gap_to_leader: 9 - self,
    leader: 'cursor',
    gap_to_closed_source_leader: 9 - self,
    closed_source_leader: 'cursor',
    gap_to_oss_leader: 7 - self,
    oss_leader: 'aider',
    status: 'in-progress',
    sprint_history: [],
    next_sprint_target: self + 1,
    ...overrides,
  } as MatrixDimension;
}

function makeMatrix(dims: MatrixDimension[], overrides: Partial<CompeteMatrix> = {}): CompeteMatrix {
  const selfScores = dims.map(d => d.scores['self'] ?? 0);
  const overall = selfScores.length > 0
    ? selfScores.reduce((s, v) => s + v, 0) / selfScores.length
    : 0;
  return {
    project: 'test-project',
    competitors: ['cursor'],
    competitors_closed_source: ['cursor'],
    competitors_oss: ['aider'],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: overall,
    dimensions: dims,
    ...overrides,
  };
}

// ── No-op parallel council (does not mutate matrix) ────────────────────────────

function noopCouncil(): (opts: ParallelCouncilOptions) => Promise<void> {
  return async () => { /* no-op */ };
}

// ── Test 1: dry-run exits without calling runParallelCouncil ──────────────────

describe('runCouncilCrusade — dry-run', () => {
  it('completes without calling runParallelCouncil and returns DRY_RUN status', async () => {
    let councilCalled = false;
    const matrix = makeMatrix([
      makeDim('testing', 5.0),
      makeDim('security', 4.0),
    ]);

    const result = await runCouncilCrusade({
      dryRun: true,
      target: 9,
      maxPasses: 3,
      _loadMatrix: async () => matrix,
      _runParallelCouncil: async () => { councilCalled = true; },
      _writeReport: async () => { /* no-op */ },
    });

    assert.equal(result.status, 'DRY_RUN');
    assert.equal(result.passesRun, 0);
    assert.equal(result.passes.length, 0);
    assert.equal(councilCalled, false, 'runParallelCouncil must NOT be called in dry-run mode');
  });

  it('dry-run works even when matrix load fails', async () => {
    const result = await runCouncilCrusade({
      dryRun: true,
      _loadMatrix: async () => null,
      _runParallelCouncil: async () => { throw new Error('should not be called'); },
      _writeReport: async () => { /* no-op */ },
    });
    assert.equal(result.status, 'DRY_RUN');
    assert.equal(result.passesRun, 0);
  });
});

// ── Test 2: all dims at target -> exits immediately ────────────────────────────

describe('runCouncilCrusade — already at target', () => {
  it('returns ALREADY_AT_TARGET when all dims are at or above target', async () => {
    let councilCalled = false;
    const matrix = makeMatrix([
      makeDim('testing', 9.5),
      makeDim('security', 9.1),
    ]);

    const result = await runCouncilCrusade({
      target: 9,
      _loadMatrix: async () => matrix,
      _runParallelCouncil: async () => { councilCalled = true; },
      _writeReport: async () => { /* no-op */ },
    });

    assert.equal(result.status, 'ALREADY_AT_TARGET');
    assert.equal(result.passesRun, 0);
    assert.equal(councilCalled, false, 'runParallelCouncil must NOT be called when already at target');
  });

  it('closed dims do not count as eligible — returns ALREADY_AT_TARGET', async () => {
    const matrix = makeMatrix([
      makeDim('testing', 3.0, 1.0, { status: 'closed' }),
      makeDim('security', 9.5),
    ]);

    const result = await runCouncilCrusade({
      target: 9,
      _loadMatrix: async () => matrix,
      _runParallelCouncil: async () => { throw new Error('should not be called'); },
      _writeReport: async () => { /* no-op */ },
    });

    assert.equal(result.status, 'ALREADY_AT_TARGET');
  });

  it('excluded dims are treated as non-eligible', async () => {
    const matrix = makeMatrix([
      makeDim('testing', 3.0),
    ], { excludedDimensions: ['testing'] });

    const result = await runCouncilCrusade({
      target: 9,
      _loadMatrix: async () => matrix,
      _runParallelCouncil: async () => { throw new Error('should not be called'); },
      _writeReport: async () => { /* no-op */ },
    });

    assert.equal(result.status, 'ALREADY_AT_TARGET');
  });
});

// ── Test 3: stall detection ───────────────────────────────────────────────────

describe('runCouncilCrusade — stall detection', () => {
  it('stops after 2 consecutive passes with overall delta < 0.02', async () => {
    // Matrix never changes — all passes produce zero delta.
    const matrix = makeMatrix([
      makeDim('testing', 5.0),
      makeDim('security', 4.0),
    ]);
    // Fixed overall score — simulates zero progress
    const frozenMatrix = { ...matrix, overallSelfScore: 4.5 };

    let passesRun = 0;
    const result = await runCouncilCrusade({
      target: 9,
      maxPasses: 10,
      _loadMatrix: async () => frozenMatrix,
      _runParallelCouncil: async () => { passesRun++; },
      _writeReport: async () => { /* no-op */ },
    });

    // Should stop at 3 passes: pass 1 initializes prevOverallScore,
    // pass 2 triggers stallCount=1, pass 3 triggers stallCount=2 -> stop
    assert.ok(passesRun <= 4, `Expected stall stop within 4 passes, got ${passesRun}`);
    assert.ok(result.status === 'MAX_PASSES' || result.status === 'COMPLETE');
  });

  it('resets stall count when progress is made', async () => {
    let callCount = 0;
    // Alternate between progress and no-progress
    const matrices = [
      makeMatrix([makeDim('testing', 5.0)], { overallSelfScore: 5.0 }),
      makeMatrix([makeDim('testing', 6.0)], { overallSelfScore: 6.0 }),  // +1.0 progress — reset stall
      makeMatrix([makeDim('testing', 6.0)], { overallSelfScore: 6.0 }),  // stall 1
      makeMatrix([makeDim('testing', 7.0)], { overallSelfScore: 7.0 }),  // +1.0 progress — reset stall
      makeMatrix([makeDim('testing', 7.0)], { overallSelfScore: 7.0 }),  // stall 1
      makeMatrix([makeDim('testing', 7.0)], { overallSelfScore: 7.0 }),  // stall 2 -> stop
    ];

    const result = await runCouncilCrusade({
      target: 9,
      maxPasses: 10,
      _loadMatrix: async () => {
        const m = matrices[callCount] ?? matrices[matrices.length - 1]!;
        callCount++;
        return m;
      },
      _runParallelCouncil: async () => { /* no-op */ },
      _writeReport: async () => { /* no-op */ },
    });

    // Should have run at least 4 passes (two progress resets)
    assert.ok(result.passesRun >= 4, `Expected at least 4 passes with resets, got ${result.passesRun}`);
  });
});

// ── Test 4: dim selection by gap x weight ─────────────────────────────────────

describe('runCouncilCrusade — dim selection', () => {
  it('selects dims with highest (target - self) * weight first', async () => {
    // dim_a: gap=4, weight=1.0  => priority=4.0
    // dim_b: gap=2, weight=3.0  => priority=6.0  <- should be first
    // dim_c: gap=7, weight=0.5  => priority=3.5
    const dims = [
      makeDim('dim_a', 5.0, 1.0),
      makeDim('dim_b', 7.0, 3.0),
      makeDim('dim_c', 2.0, 0.5),
    ];
    const matrix = makeMatrix(dims);

    const scheduled: string[][] = [];
    await runCouncilCrusade({
      target: 9,
      maxPasses: 1,
      maxDimsPerPass: 2,
      _loadMatrix: async () => matrix,
      _runParallelCouncil: async (opts) => {
        scheduled.push(opts.focusDims ?? []);
      },
      _writeReport: async () => { /* no-op */ },
    });

    assert.equal(scheduled.length, 1, 'Expected exactly one council pass');
    const firstBatch = scheduled[0]!;
    // dim_b (priority 6.0) and dim_a (priority 4.0) should be in the batch, not dim_c (3.5)
    assert.ok(firstBatch.includes('dim_b'), `dim_b (priority 6.0) should be selected, got: ${firstBatch.join(',')}`);
    assert.ok(firstBatch.includes('dim_a'), `dim_a (priority 4.0) should be selected, got: ${firstBatch.join(',')}`);
    assert.ok(!firstBatch.includes('dim_c'), `dim_c (priority 3.5) should NOT be selected, got: ${firstBatch.join(',')}`);
  });

  it('respects focusDims restriction', async () => {
    const matrix = makeMatrix([
      makeDim('dim_a', 5.0, 1.0),
      makeDim('dim_b', 5.0, 1.0),
      makeDim('dim_c', 5.0, 1.0),
    ]);

    const scheduled: string[][] = [];
    await runCouncilCrusade({
      target: 9,
      maxPasses: 1,
      focusDims: ['dim_a', 'dim_c'],
      _loadMatrix: async () => matrix,
      _runParallelCouncil: async (opts) => {
        scheduled.push(opts.focusDims ?? []);
      },
      _writeReport: async () => { /* no-op */ },
    });

    const batch = scheduled[0] ?? [];
    assert.ok(batch.includes('dim_a'), 'dim_a should be in focus batch');
    assert.ok(batch.includes('dim_c'), 'dim_c should be in focus batch');
    assert.ok(!batch.includes('dim_b'), 'dim_b was not in focusDims and should be excluded');
  });

  it('passes correct council options to runParallelCouncil', async () => {
    const capturedOpts: ParallelCouncilOptions[] = [];
    const matrix = makeMatrix([makeDim('testing', 4.0)]);

    await runCouncilCrusade({
      target: 9,
      maxPasses: 1,
      maxRoundsPerPass: 3,
      slotsPerMember: 4,
      minJudges: 3,
      skipValidate: true,
      goal: 'Fix testing coverage',
      _loadMatrix: async () => matrix,
      _runParallelCouncil: async (opts) => { capturedOpts.push(opts); },
      _writeReport: async () => { /* no-op */ },
    });

    assert.equal(capturedOpts.length, 1);
    const opts = capturedOpts[0]!;
    assert.equal(opts.maxRounds, 3);
    assert.equal(opts.slotsPerMember, 4);
    assert.equal(opts.minJudges, 3);
    assert.equal(opts.skipValidate, true);
    assert.ok(typeof opts.goal === 'string' && opts.goal.length > 0);
  });
});

// ── Test 5: report file written ────────────────────────────────────────────────

describe('runCouncilCrusade — report file', () => {
  it('writes COUNCIL_CRUSADE_REPORT.md to cwd after run', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'council-crusade-report-'));
    try {
      const matrix = makeMatrix([makeDim('testing', 5.0)]);

      // Use real writeReport (default) so the actual file gets written
      const opts: CouncilCrusadeOptions = {
        cwd: tmpDir,
        target: 9,
        maxPasses: 1,
        _loadMatrix: async () => matrix,
        _runParallelCouncil: async () => { /* no-op */ },
        // Do NOT inject _writeReport — let the real default write to disk
      };

      await runCouncilCrusade(opts);

      const reportPath = path.join(tmpDir, 'COUNCIL_CRUSADE_REPORT.md');
      const stat = await fs.stat(reportPath);
      assert.ok(stat.isFile(), `Expected COUNCIL_CRUSADE_REPORT.md to exist at ${reportPath}`);

      const content = await fs.readFile(reportPath, 'utf8');
      assert.ok(content.includes('COUNCIL_CRUSADE_REPORT'), 'Report should contain header');
      assert.ok(content.includes('Pass Log'), 'Report should contain pass log section');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
    }
  });

  it('report contains dimension score details from the pass', async () => {
    let writtenContent = '';
    const matrix = makeMatrix([makeDim('testing', 5.0)]);
    // After "council runs", return an improved score
    let loadCount = 0;
    const matrices = [
      matrix,
      matrix, // initial load
      matrix, // pass 1 before
      makeMatrix([makeDim('testing', 7.0)]), // after council
      makeMatrix([makeDim('testing', 7.0)]), // final reload
    ];

    await runCouncilCrusade({
      target: 9,
      maxPasses: 1,
      goal: 'Improve testing',
      _loadMatrix: async () => {
        const m = matrices[loadCount] ?? matrices[matrices.length - 1]!;
        loadCount++;
        return m;
      },
      _runParallelCouncil: async () => { /* no-op */ },
      _writeReport: async (_cwd, content) => { writtenContent = content; },
    });

    assert.ok(writtenContent.includes('testing'), 'Report should mention the dim ID');
    assert.ok(writtenContent.includes('Pass Log'), 'Report should have pass log section');
    assert.ok(writtenContent.includes('Improve testing'), 'Report should include goal');
  });
});

// ── Test 6: pass count and result shape ────────────────────────────────────────

describe('runCouncilCrusade — result shape', () => {
  it('returns MAX_PASSES status when not all dims reach target', async () => {
    const matrix = makeMatrix([makeDim('testing', 5.0)]);

    const result: CouncilCrusadeResult = await runCouncilCrusade({
      target: 9,
      maxPasses: 2,
      _loadMatrix: async () => matrix,
      _runParallelCouncil: async () => { /* no-op */ },
      _writeReport: async () => { /* no-op */ },
    });

    assert.equal(result.status, 'MAX_PASSES');
    assert.ok(result.passes.every(p => Array.isArray(p.dimsAttempted)));
    assert.ok(result.passes.every(p => typeof p.delta === 'number'));
  });

  it('returns COMPLETE when all dims reach target', async () => {
    let loadCount = 0;
    // First two loads return below-target matrix, third load (after council) returns at-target
    const matrices = [
      makeMatrix([makeDim('testing', 5.0)]), // initial check
      makeMatrix([makeDim('testing', 5.0)]), // pass 1 before
      makeMatrix([makeDim('testing', 9.5)]), // after council
      makeMatrix([makeDim('testing', 9.5)]), // final reload
    ];

    const result = await runCouncilCrusade({
      target: 9,
      maxPasses: 5,
      _loadMatrix: async () => {
        const m = matrices[loadCount] ?? matrices[matrices.length - 1]!;
        loadCount++;
        return m;
      },
      _runParallelCouncil: async () => { /* no-op */ },
      _writeReport: async () => { /* no-op */ },
    });

    assert.equal(result.status, 'COMPLETE');
    assert.equal(result.passesRun, 1);
  });

  it('pass results contain correct scoresBefore and scoresAfter', async () => {
    let loadCount = 0;
    const matrices = [
      makeMatrix([makeDim('testing', 5.0)]),  // initial check
      makeMatrix([makeDim('testing', 5.0)]),  // pass 1 before
      makeMatrix([makeDim('testing', 6.5)]),  // after council
      makeMatrix([makeDim('testing', 6.5)]),  // final reload
    ];

    const result = await runCouncilCrusade({
      target: 9,
      maxPasses: 1,
      _loadMatrix: async () => {
        const m = matrices[loadCount] ?? matrices[matrices.length - 1]!;
        loadCount++;
        return m;
      },
      _runParallelCouncil: async () => { /* no-op */ },
      _writeReport: async () => { /* no-op */ },
    });

    assert.equal(result.passes.length, 1);
    const p = result.passes[0]!;
    assert.ok(p.dimsAttempted.includes('testing'));
    assert.ok(typeof p.scoresBefore['testing'] === 'number');
    assert.ok(typeof p.scoresAfter['testing'] === 'number');
    assert.ok(p.scoresAfter['testing']! >= p.scoresBefore['testing']!);
  });
});
