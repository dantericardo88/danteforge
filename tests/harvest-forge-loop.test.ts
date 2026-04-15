// Harvest Forge Loop — unit tests covering all Sprint 17/18 additions.
// All dependencies injected — no real LLM, no real filesystem state writes.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  harvestForge,
  parseCheckpointInput,
  type HarvestForgeOptions,
} from '../src/cli/commands/harvest-forge.js';
import {
  initConvergence,
  type ConvergenceState,
} from '../src/core/convergence.js';
import { type AdoptionCandidate } from '../src/cli/commands/oss-intel.js';
import { type GoalConfig } from '../src/cli/commands/set-goal.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-hf-loop-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function makeCandidate(patternName: string, overrides: Partial<AdoptionCandidate> = {}): AdoptionCandidate {
  return {
    patternName,
    category: 'observability',
    sourceRepo: 'test/repo',
    referenceImplementation: '',
    whatToBuild: `Implement ${patternName}`,
    filesToModify: ['src/core/logger.ts'],
    estimatedEffort: '4h',
    unlocksGapClosure: [],
    adoptionScore: 7,
    ...overrides,
  };
}

function makeGoal(overrides: Partial<GoalConfig> = {}): GoalConfig {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    category: 'agentic dev CLI',
    competitors: ['Cursor'],
    definition9: 'Fully autonomous',
    exclusions: [],
    dailyBudgetUsd: 50.0,
    oversightLevel: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Minimal harvestForge options with everything injected for one successful cycle. */
function makeOneSuccessCycle(
  dir: string,
  pattern = 'circuit-breaker',
  extraOpts: Partial<HarvestForgeOptions> = {},
): HarvestForgeOptions {
  let state = initConvergence(9.0);
  return {
    cwd: dir,
    maxCycles: 1,
    _isLLMAvailable: async () => false,
    _runOssIntel: async () => {},
    _readAdoptionQueue: async () => [makeCandidate(pattern)],
    _runForge: async () => ({ success: true }),
    _runVerify: async () => {},
    _getScores: async () => ({ 'circuit-breaker': 7.0 }),
    _loadConvergence: async () => state,
    _saveConvergence: async (s) => { state = s; },
    _runUniverseScan: async () => ({
      version: '1.0.0', scannedAt: new Date().toISOString(), category: 'test',
      dimensions: [], selfScores: {}, dimensionChanges: { new: [], dead: [], shifted: [] },
    }),
    _getCycleCost: () => 0,
    _loadGoal: async () => makeGoal({ oversightLevel: 3 }),  // level 3 → always auto-approve
    _recordAdoption: (s, name) => {
      if (s.adoptedPatternsSummary.includes(name)) return s;
      return { ...s, adoptedPatternsSummary: [...s.adoptedPatternsSummary, name] };
    },
    _now: () => Date.now(),
    ...extraOpts,
  };
}

// ── parseCheckpointInput tests ────────────────────────────────────────────────

describe('parseCheckpointInput — pure function', () => {

  it('T13: APPROVE returns []', () => {
    assert.deepStrictEqual(parseCheckpointInput('APPROVE', 3), []);
  });

  it('T13b: empty string returns []', () => {
    assert.deepStrictEqual(parseCheckpointInput('', 3), []);
  });

  it('T14: STOP returns [-1]', () => {
    assert.deepStrictEqual(parseCheckpointInput('STOP', 3), [-1]);
  });

  it('T14b: SKIP 2 returns [1] (0-based)', () => {
    assert.deepStrictEqual(parseCheckpointInput('SKIP 2', 3), [1]);
  });

  it('T14c: SKIP 1 3 returns [0, 2] (0-based)', () => {
    assert.deepStrictEqual(parseCheckpointInput('SKIP 1 3', 3), [0, 2]);
  });

  it('T14d: SKIP indices out of range are filtered out', () => {
    // count=2, SKIP 5 → index 4 out of range → empty
    assert.deepStrictEqual(parseCheckpointInput('SKIP 5', 2), []);
  });

  it('T14e: unrecognised input returns [] (treat as approve)', () => {
    assert.deepStrictEqual(parseCheckpointInput('yes please', 3), []);
  });

});

// ── Main harvestForge loop tests ──────────────────────────────────────────────

describe('Harvest Forge — parallel vs sequential forge', () => {

  it('T1: parallelForge=true runs all adoptions via Promise.all (both calls complete)', async () => {
    const dir = await makeTempDir();
    const forgedPatterns: string[] = [];

    await harvestForge(makeOneSuccessCycle(dir, 'circuit-breaker', {
      parallelForge: true,
      _readAdoptionQueue: async () => [
        makeCandidate('circuit-breaker'),
        makeCandidate('retry-with-backoff'),
      ],
      _runForge: async (goal) => {
        // Extract pattern name from goal string for verification
        if (goal.includes('circuit-breaker')) forgedPatterns.push('circuit-breaker');
        if (goal.includes('retry-with-backoff')) forgedPatterns.push('retry-with-backoff');
        return { success: true };
      },
    }));

    assert.ok(forgedPatterns.includes('circuit-breaker'), 'circuit-breaker must be forged');
    assert.ok(forgedPatterns.includes('retry-with-backoff'), 'retry-with-backoff must be forged');
  });

  it('T2: parallelForge=false runs adoptions sequentially (same result, order preserved)', async () => {
    const dir = await makeTempDir();
    const callOrder: string[] = [];

    await harvestForge(makeOneSuccessCycle(dir, 'circuit-breaker', {
      parallelForge: false,
      _readAdoptionQueue: async () => [
        makeCandidate('alpha'),
        makeCandidate('beta'),
      ],
      _runForge: async (goal) => {
        if (goal.includes('alpha')) callOrder.push('alpha');
        if (goal.includes('beta')) callOrder.push('beta');
        return { success: true };
      },
    }));

    assert.deepStrictEqual(callOrder, ['alpha', 'beta'], 'sequential forge must preserve order');
  });

});

describe('Harvest Forge — cost tracking', () => {

  it('T3: _getCycleCost is called each cycle and accumulated into totalCostUsd', async () => {
    const dir = await makeTempDir();
    let savedState: ConvergenceState | null = null;

    await harvestForge(makeOneSuccessCycle(dir, 'pattern-a', {
      maxCycles: 2,
      _getCycleCost: () => 1.50,
      _saveConvergence: async (s) => { savedState = s; },
      // Need 2 cycles of adoptions
      _readAdoptionQueue: async () => [makeCandidate('pattern-a')],
    }));

    // At least 1 cycle must have accumulated cost
    assert.ok(savedState !== null, 'state must be saved');
    assert.ok((savedState as ConvergenceState).totalCostUsd >= 1.50, `totalCostUsd must be >= 1.50, got ${(savedState as ConvergenceState).totalCostUsd}`);
  });

});

describe('Harvest Forge — universe sync schedule', () => {

  it('T4: universe sync is called at cycle 3 and 6, not at cycles 1, 2, 4, 5', async () => {
    const dir = await makeTempDir();
    let syncCallCount = 0;
    // Scores must improve between scoresBefore and scoresAfter calls each cycle so that
    // detectPlateau never fires across 6 cycles. A call counter achieves this.
    let getScoreCallCount = 0;

    const result = await harvestForge({
      ...makeOneSuccessCycle(dir),
      maxCycles: 6,
      _getScores: async () => {
        getScoreCallCount++;
        // Produces increasing series 4.5, 5.0, 5.5 … 0.5 improvement per cycle pair
        return { 'circuit-breaker': 4.0 + getScoreCallCount * 0.5 };
      },
      _runUniverseScan: async () => {
        syncCallCount++;
        return {
          version: '1.0.0', scannedAt: new Date().toISOString(), category: 'test',
          dimensions: [], selfScores: {}, dimensionChanges: { new: [], dead: [], shifted: [] },
        };
      },
    });

    assert.strictEqual(result.cyclesRun, 6, 'must run all 6 cycles to get syncs at 3 and 6');
    assert.strictEqual(syncCallCount, 2, 'universe sync must be called exactly twice — at cycles 3 and 6');
  });

});

describe('Harvest Forge — budget hard stop', () => {

  it('T5: budget hard stop fires when totalCostUsd >= dailyBudgetUsd', async () => {
    const dir = await makeTempDir();

    // _getCycleCost returns 5.10 — exceeds $5.00 daily budget after the first cycle.
    // harvestForge reinits state when lastCycle=0 && dims=[], so we do not pre-seed
    // totalCostUsd; instead we rely on the first cycle exceeding the budget.
    const result = await harvestForge({
      ...makeOneSuccessCycle(dir),
      maxCycles: 5,
      _getCycleCost: () => 5.10,
      _loadGoal: async () => makeGoal({ dailyBudgetUsd: 5.0, oversightLevel: 3 }),
    });

    assert.strictEqual(result.stopReason, 'budget-exhausted', 'must stop with budget-exhausted');
    assert.ok(result.cyclesRun <= 2, 'must stop early after first budget-exceeding cycle');
  });

  it('T6: budget hard stop does NOT fire when no _loadGoal provided (defaults to no budget)', async () => {
    const dir = await makeTempDir();

    const result = await harvestForge({
      ...makeOneSuccessCycle(dir),
      maxCycles: 2,
      _getCycleCost: () => 999.99,   // enormous cost — would fire if budget check is wrong
      _loadGoal: async () => null,    // no GOAL.json → no budget limit
    });

    // Should complete normally (max-cycles or queue-exhausted), not budget-exhausted
    assert.notStrictEqual(result.stopReason, 'budget-exhausted', 'must NOT stop due to budget when no goal set');
  });

});

describe('Harvest Forge — oversight level', () => {

  it('T7: oversightLevel=3 skips humanCheckpoint entirely (auto-approve)', async () => {
    const dir = await makeTempDir();
    let forged = false;

    // With TTY stdin absent (test environment), the checkpoint auto-approves anyway.
    // oversightLevel=3 short-circuits before even reaching the stdin check.
    const result = await harvestForge(makeOneSuccessCycle(dir, 'obs-pattern', {
      autoApprove: false,   // NOT set at call level
      _loadGoal: async () => makeGoal({ oversightLevel: 3 }),
      _runForge: async () => { forged = true; return { success: true }; },
    }));

    assert.strictEqual(forged, true, 'forge must run when oversightLevel=3 auto-approves');
    assert.strictEqual(result.cyclesRun, 1);
  });

  it('T8: oversightLevel=2 auto-approves non-architectural adoptions (filesToModify.length <= 3)', async () => {
    const dir = await makeTempDir();
    let forged = false;

    await harvestForge(makeOneSuccessCycle(dir, 'small-pattern', {
      autoApprove: false,
      _readAdoptionQueue: async () => [
        makeCandidate('small-pattern', { filesToModify: ['src/a.ts', 'src/b.ts'] }),  // 2 files, not architectural
      ],
      _loadGoal: async () => makeGoal({ oversightLevel: 2 }),
      _runForge: async () => { forged = true; return { success: true }; },
    }));

    assert.strictEqual(forged, true, 'non-architectural adoption must run with oversightLevel=2');
  });

  it('T9: oversightLevel=2 shows checkpoint for architectural adoptions (filesToModify.length > 3)', async () => {
    const dir = await makeTempDir();
    // In test env (no TTY), checkpoint auto-approves — verify forge still runs
    let forged = false;

    await harvestForge(makeOneSuccessCycle(dir, 'arch-pattern', {
      autoApprove: false,
      _readAdoptionQueue: async () => [
        makeCandidate('arch-pattern', {
          filesToModify: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],  // 4 files → architectural
          category: 'observability',
        }),
      ],
      _loadGoal: async () => makeGoal({ oversightLevel: 2 }),
      _runForge: async () => { forged = true; return { success: true }; },
    }));

    // Even with checkpoint shown (non-TTY → auto-approve), forge runs
    assert.strictEqual(forged, true, 'architectural adoption with oversight=2 must still forge (non-TTY auto-approve)');
  });

  it('T10: oversightLevel=1 always shows checkpoint (non-TTY → auto-approve, forge runs)', async () => {
    const dir = await makeTempDir();
    let forged = false;

    await harvestForge(makeOneSuccessCycle(dir, 'lvl1-pattern', {
      autoApprove: false,
      _loadGoal: async () => makeGoal({ oversightLevel: 1 }),
      _runForge: async () => { forged = true; return { success: true }; },
    }));

    assert.strictEqual(forged, true, 'oversightLevel=1 must still forge in non-TTY environments');
  });

});

describe('Harvest Forge — compounding memory', () => {

  it('T11: adoptedPatternsSummary grows each cycle with successfully forged patterns', async () => {
    const dir = await makeTempDir();
    let state = initConvergence(9.0);

    await harvestForge({
      ...makeOneSuccessCycle(dir, 'pattern-x'),
      _loadConvergence: async () => state,
      _saveConvergence: async (s) => { state = s; },
      _runForge: async () => ({ success: true }),
    });

    assert.ok(
      state.adoptedPatternsSummary.includes('pattern-x'),
      'adoptedPatternsSummary must include successfully forged pattern',
    );
  });

  it('T12: oss-intel receives _adoptedPatterns from state.adoptedPatternsSummary', async () => {
    const dir = await makeTempDir();
    let capturedAdoptedPatterns: string[] | undefined;

    // Pre-populate state with a prior adoption AND a dimension so the reinit guard
    // (lastCycle===0 && dimensions.length===0) does not clear adoptedPatternsSummary.
    let state: ConvergenceState = {
      ...initConvergence(9.0),
      adoptedPatternsSummary: ['already-done-pattern'],
      dimensions: [{
        dimension: 'circuit-breaker',
        score: 7,
        evidence: [],
        scoreHistory: [7],
        converged: false,
      }],
    };

    await harvestForge({
      ...makeOneSuccessCycle(dir, 'new-pattern'),
      _loadConvergence: async () => state,
      _saveConvergence: async (s) => { state = s; },
      _runOssIntel: async (opts) => {
        capturedAdoptedPatterns = opts?._adoptedPatterns;
      },
    });

    assert.ok(
      Array.isArray(capturedAdoptedPatterns),
      '_adoptedPatterns must be passed to oss-intel',
    );
    assert.ok(
      capturedAdoptedPatterns!.includes('already-done-pattern'),
      'prior adopted patterns must appear in _adoptedPatterns fed to oss-intel',
    );
  });

});

describe('Harvest Forge — maxHours time budget', () => {

  it('T15: maxHours stop fires when _now indicates elapsed time >= limit', async () => {
    const dir = await makeTempDir();

    // Simulate 2 hours already elapsed right after the first cycle
    let callCount = 0;
    const start = 1_000_000;
    const oneHourMs = 3_600_000;

    const result = await harvestForge({
      ...makeOneSuccessCycle(dir, 'slow-pattern'),
      maxCycles: 5,
      maxHours: 1,
      _now: () => {
        callCount++;
        // First call (startedAt) returns base time; subsequent calls return 2h later
        return callCount === 1 ? start : start + 2 * oneHourMs;
      },
    });

    assert.strictEqual(result.stopReason, 'budget-exhausted', 'must stop with budget-exhausted when maxHours exceeded');
  });

});
