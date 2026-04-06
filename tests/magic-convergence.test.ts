import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Convergence cycle counts per preset ─────────────────────────────────────

describe('MAGIC_PRESETS convergenceCycles', () => {
  it('spark has 0 convergence cycles (planning-only)', async () => {
    const { MAGIC_PRESETS } = await import('../src/core/magic-presets.js');
    assert.strictEqual(MAGIC_PRESETS.spark.convergenceCycles, 0);
  });

  it('ember has 1 convergence cycle (budget-conscious)', async () => {
    const { MAGIC_PRESETS } = await import('../src/core/magic-presets.js');
    assert.strictEqual(MAGIC_PRESETS.ember.convergenceCycles, 1);
  });

  it('magic has 2 convergence cycles (standard)', async () => {
    const { MAGIC_PRESETS } = await import('../src/core/magic-presets.js');
    assert.strictEqual(MAGIC_PRESETS.magic.convergenceCycles, 2);
  });

  it('blaze has 2 convergence cycles (high power)', async () => {
    const { MAGIC_PRESETS } = await import('../src/core/magic-presets.js');
    assert.strictEqual(MAGIC_PRESETS.blaze.convergenceCycles, 2);
  });

  it('nova has 3 convergence cycles (very high power)', async () => {
    const { MAGIC_PRESETS } = await import('../src/core/magic-presets.js');
    assert.strictEqual(MAGIC_PRESETS.nova.convergenceCycles, 3);
  });

  it('inferno has 3 convergence cycles (maximum)', async () => {
    const { MAGIC_PRESETS } = await import('../src/core/magic-presets.js');
    assert.strictEqual(MAGIC_PRESETS.inferno.convergenceCycles, 3);
  });

  it('canvas has 2 convergence cycles (design-first)', async () => {
    const { MAGIC_PRESETS } = await import('../src/core/magic-presets.js');
    assert.strictEqual(MAGIC_PRESETS.canvas.convergenceCycles, 2);
  });

  it('all execute-phase presets have at least 1 convergence cycle', async () => {
    const { MAGIC_PRESETS } = await import('../src/core/magic-presets.js');
    const executePresets = ['ember', 'canvas', 'magic', 'blaze', 'nova', 'inferno'] as const;
    for (const level of executePresets) {
      assert.ok(
        MAGIC_PRESETS[level].convergenceCycles >= 1,
        `${level} should have at least 1 convergence cycle`,
      );
    }
  });

  it('convergenceCycles are non-decreasing from spark to inferno', async () => {
    const { MAGIC_PRESETS } = await import('../src/core/magic-presets.js');
    const levels = ['spark', 'ember', 'canvas', 'magic', 'blaze', 'nova', 'inferno'] as const;
    for (let i = 1; i < levels.length; i++) {
      assert.ok(
        MAGIC_PRESETS[levels[i]!].convergenceCycles >= MAGIC_PRESETS[levels[i - 1]!].convergenceCycles,
        `${levels[i]} convergenceCycles should be >= ${levels[i - 1]} convergenceCycles`,
      );
    }
  });
});

// ── formatMagicPlan includes convergence info ────────────────────────────────

describe('formatMagicPlan convergence line', () => {
  it('spark shows convergence disabled', async () => {
    const { buildMagicExecutionPlan, formatMagicPlan } = await import('../src/core/magic-presets.js');
    const plan = buildMagicExecutionPlan('spark', 'New project idea');
    const formatted = formatMagicPlan(plan);
    assert.ok(formatted.includes('Convergence: disabled'), 'spark should show convergence disabled');
  });

  it('ember shows 1 convergence cycle', async () => {
    const { buildMagicExecutionPlan, formatMagicPlan } = await import('../src/core/magic-presets.js');
    const plan = buildMagicExecutionPlan('ember', 'Quick feature');
    const formatted = formatMagicPlan(plan);
    assert.ok(formatted.includes('1 cycle'), 'ember should show 1 cycle');
    assert.ok(formatted.includes('Convergence:'), 'should have Convergence: label');
  });

  it('magic shows 2 convergence cycles', async () => {
    const { buildMagicExecutionPlan, formatMagicPlan } = await import('../src/core/magic-presets.js');
    const plan = buildMagicExecutionPlan('magic', 'Daily work');
    const formatted = formatMagicPlan(plan);
    assert.ok(formatted.includes('2 cycles'), 'magic should show 2 cycles');
  });

  it('nova shows 3 convergence cycles', async () => {
    const { buildMagicExecutionPlan, formatMagicPlan } = await import('../src/core/magic-presets.js');
    const plan = buildMagicExecutionPlan('nova', 'Feature sprint');
    const formatted = formatMagicPlan(plan);
    assert.ok(formatted.includes('3 cycles'), 'nova should show 3 cycles');
    assert.ok(formatted.includes('autoforge → verify'), 'should describe the loop');
  });
});

// ── runConvergenceCycles behavior ────────────────────────────────────────────

describe('runConvergenceCycles', () => {
  it('returns immediately with unknown status when maxCycles is 0', async () => {
    const { runConvergenceCycles } = await import('../src/cli/commands/magic.js');
    const result = await runConvergenceCycles({
      level: 'magic',
      goal: 'test',
      maxCycles: 0,
      _getVerifyStatus: async () => 'fail',
      _runAutoforge: async () => { throw new Error('should not be called'); },
      _runVerify: async () => { throw new Error('should not be called'); },
    });
    assert.strictEqual(result.cyclesRun, 0);
    assert.strictEqual(result.initialStatus, 'unknown');
    assert.strictEqual(result.finalStatus, 'unknown');
  });

  it('runs initial verify when skipInitialVerify is false', async () => {
    const { runConvergenceCycles } = await import('../src/cli/commands/magic.js');
    let verifyCallCount = 0;
    await runConvergenceCycles({
      level: 'magic',
      goal: 'test',
      maxCycles: 1,
      skipInitialVerify: false,
      _getVerifyStatus: async () => 'pass',
      _runAutoforge: async () => {},
      _runVerify: async () => { verifyCallCount++; },
    });
    assert.strictEqual(verifyCallCount, 1, 'should call verify once for initial check');
  });

  it('skips initial verify when skipInitialVerify is true', async () => {
    const { runConvergenceCycles } = await import('../src/cli/commands/magic.js');
    let verifyCallCount = 0;
    await runConvergenceCycles({
      level: 'blaze',
      goal: 'test',
      maxCycles: 2,
      skipInitialVerify: true,
      _getVerifyStatus: async () => 'pass',
      _runAutoforge: async () => {},
      _runVerify: async () => { verifyCallCount++; },
    });
    assert.strictEqual(verifyCallCount, 0, 'should skip initial verify call');
  });

  it('returns 0 cycles when initial verify passes', async () => {
    const { runConvergenceCycles } = await import('../src/cli/commands/magic.js');
    const result = await runConvergenceCycles({
      level: 'magic',
      goal: 'Build feature',
      maxCycles: 2,
      _getVerifyStatus: async () => 'pass',
      _runAutoforge: async () => {},
      _runVerify: async () => {},
    });
    assert.strictEqual(result.cyclesRun, 0);
    assert.strictEqual(result.initialStatus, 'pass');
    assert.strictEqual(result.finalStatus, 'pass');
  });

  it('runs 1 repair cycle when verify fails then passes', async () => {
    const { runConvergenceCycles } = await import('../src/cli/commands/magic.js');
    let calls = 0;
    const result = await runConvergenceCycles({
      level: 'nova',
      goal: 'Build auth',
      maxCycles: 3,
      skipInitialVerify: true,
      _getVerifyStatus: async () => (calls++ === 0 ? 'fail' : 'pass'),
      _runAutoforge: async () => {},
      _runVerify: async () => {},
    });
    assert.strictEqual(result.cyclesRun, 1);
    assert.strictEqual(result.finalStatus, 'pass');
  });

  it('exhausts maxCycles when verify never passes', async () => {
    const { runConvergenceCycles } = await import('../src/cli/commands/magic.js');
    const result = await runConvergenceCycles({
      level: 'blaze',
      goal: 'test',
      maxCycles: 2,
      skipInitialVerify: true,
      _getVerifyStatus: async () => 'fail',
      _runAutoforge: async () => {},
      _runVerify: async () => {},
    });
    assert.strictEqual(result.cyclesRun, 2);
    assert.strictEqual(result.finalStatus, 'fail');
  });

  it('calls autoforge with a goal containing the original goal', async () => {
    const { runConvergenceCycles } = await import('../src/cli/commands/magic.js');
    const capturedGoals: string[] = [];
    let statusCalls = 0;
    await runConvergenceCycles({
      level: 'inferno',
      goal: 'Build payment flow',
      maxCycles: 2,
      skipInitialVerify: true,
      _getVerifyStatus: async () => (statusCalls++ >= 1 ? 'pass' : 'fail'),
      _runAutoforge: async (goal) => { capturedGoals.push(goal); },
      _runVerify: async () => {},
    });
    assert.strictEqual(capturedGoals.length, 1, 'should call autoforge once');
    assert.ok(capturedGoals[0]!.includes('Build payment flow'), 'goal should reference original goal');
  });

  it('calls autoforge with 3 waves per convergence cycle', async () => {
    const { runConvergenceCycles } = await import('../src/cli/commands/magic.js');
    const capturedWaves: number[] = [];
    let statusCalls = 0;
    await runConvergenceCycles({
      level: 'nova',
      goal: 'test',
      maxCycles: 3,
      skipInitialVerify: true,
      _getVerifyStatus: async () => (statusCalls++ >= 2 ? 'pass' : 'fail'),
      _runAutoforge: async (_goal, waves) => { capturedWaves.push(waves); },
      _runVerify: async () => {},
    });
    assert.strictEqual(capturedWaves.length, 2);
    assert.ok(capturedWaves.every(w => w === 3), 'each cycle should use exactly 3 waves');
  });

  it('handles warn status as non-passing (still triggers repair)', async () => {
    const { runConvergenceCycles } = await import('../src/cli/commands/magic.js');
    let autoforgeCallCount = 0;
    let statusCalls = 0;
    const result = await runConvergenceCycles({
      level: 'magic',
      goal: 'test',
      maxCycles: 1,
      skipInitialVerify: true,
      _getVerifyStatus: async () => (statusCalls++ >= 1 ? 'pass' : 'warn'),
      _runAutoforge: async () => { autoforgeCallCount++; },
      _runVerify: async () => {},
    });
    assert.strictEqual(autoforgeCallCount, 1, 'warn status should trigger repair');
    assert.strictEqual(result.finalStatus, 'pass');
  });
});
