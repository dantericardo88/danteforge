// autoresearch-command.test.ts — command-level tests for autoResearch() via injection seams
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { DanteState } from '../src/core/state.js';
import type { AutoResearchConfig, ExperimentResult } from '../src/core/autoresearch-engine.js';
import { autoResearch } from '../src/cli/commands/autoresearch.js';

const originalExitCode = process.exitCode;

beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = originalExitCode; });

function makeState(): DanteState {
  return {
    project: 'test', workflowStage: 'tasks', currentPhase: 0,
    profile: 'budget', lastHandoff: 'none', auditLog: [], tasks: {},
  } as unknown as DanteState;
}

function makeBaseOpts(overrides: Partial<Parameters<typeof autoResearch>[2]> = {}) {
  const state = makeState();
  const saved: DanteState[] = [];
  return {
    _loadState: async () => ({ ...state, auditLog: [...state.auditLog] } as DanteState),
    _saveState: async (s: DanteState) => { saved.push(s); },
    _isLLMAvailable: async () => false,
    _callLLM: async (_p: string) => '{"description":"test","fileToChange":"","change":""}',
    _runBaseline: async (_c: AutoResearchConfig) => 100,
    _runExperiment: async (_c: AutoResearchConfig, _id: number, _d: string): Promise<ExperimentResult> => ({
      id: 1, description: 'test experiment', metricValue: 90, status: 'keep',
    }),
    _git: async (args: string[], _cwd: string) => args[0] === 'status' ? '' : 'abc1234',
    _writeFile: async (_p: string, _c: string) => {},
    _appendFile: async (_p: string, _c: string) => {},
    _now: () => 0,
    saved,
    ...overrides,
  };
}

// ── Prompt mode ───────────────────────────────────────────────────────────────

describe('autoResearch: prompt mode', () => {
  it('writes audit log entry with "prompt mode" and saves state', async () => {
    const opts = makeBaseOpts();
    await autoResearch('reduce bundle size', { prompt: true }, opts);
    assert.ok(opts.saved.length > 0, 'state should be saved');
    const entry = opts.saved[0]!.auditLog[0]!;
    assert.ok(entry.includes('prompt mode'), 'audit entry should mention prompt mode');
    assert.ok(entry.includes('reduce bundle size'), 'audit entry should reference the goal');
  });

  it('does NOT call _isLLMAvailable in prompt mode', async () => {
    let llmChecked = false;
    const opts = makeBaseOpts({ _isLLMAvailable: async () => { llmChecked = true; return false; } });
    await autoResearch('my goal', { prompt: true }, opts);
    assert.strictEqual(llmChecked, false, '_isLLMAvailable should not be called in prompt mode');
  });

  it('does NOT call _runBaseline in prompt mode', async () => {
    let baselineCalled = false;
    const opts = makeBaseOpts({ _runBaseline: async () => { baselineCalled = true; return 0; } });
    await autoResearch('my goal', { prompt: true }, opts);
    assert.strictEqual(baselineCalled, false, '_runBaseline should not be called in prompt mode');
  });
});

// ── Dry-run mode ──────────────────────────────────────────────────────────────

describe('autoResearch: dry-run mode', () => {
  it('writes audit log entry with "dry-run" and saves state', async () => {
    const opts = makeBaseOpts();
    await autoResearch('optimize coverage', { dryRun: true }, opts);
    assert.ok(opts.saved.length > 0, 'state should be saved');
    const entry = opts.saved[0]!.auditLog[0]!;
    assert.ok(entry.includes('dry-run'), 'audit entry should mention dry-run');
    assert.ok(entry.includes('optimize coverage'), 'audit entry should reference the goal');
  });

  it('does NOT call _runBaseline in dry-run mode', async () => {
    let baselineCalled = false;
    const opts = makeBaseOpts({ _runBaseline: async () => { baselineCalled = true; return 0; } });
    await autoResearch('my goal', { dryRun: true }, opts);
    assert.strictEqual(baselineCalled, false);
  });

  it('does NOT call _isLLMAvailable in dry-run mode', async () => {
    let checked = false;
    const opts = makeBaseOpts({ _isLLMAvailable: async () => { checked = true; return false; } });
    await autoResearch('my goal', { dryRun: true }, opts);
    assert.strictEqual(checked, false);
  });
});

// ── Execute mode — safety rails ───────────────────────────────────────────────

describe('autoResearch: execute mode — safety rails', () => {
  it('sets exitCode=1 and returns before baseline when metric cannot derive a command', async () => {
    let baselineCalled = false;
    const opts = makeBaseOpts({
      _runBaseline: async () => {
        baselineCalled = true;
        return 100;
      },
    });
    await autoResearch('goal', { metric: 'some unknown metric' }, opts);
    assert.strictEqual(process.exitCode, 1);
    assert.strictEqual(baselineCalled, false, 'baseline should not run without a valid measurement command');
    process.exitCode = 0;
  });

  it('sets exitCode=1 and returns before baseline when the git working tree is dirty', async () => {
    let baselineCalled = false;
    const opts = makeBaseOpts({
      _runBaseline: async () => {
        baselineCalled = true;
        return 100;
      },
      _git: async (args: string[]) => {
        if (args[0] === 'status') return ' M src/cli/commands/autoresearch.ts';
        return 'abc1234';
      },
    });
    await autoResearch('goal', { measurementCommand: 'echo 0', time: '1m' }, opts);
    assert.strictEqual(process.exitCode, 1);
    assert.strictEqual(baselineCalled, false, 'baseline should not run on a dirty worktree');
    process.exitCode = 0;
  });
});

// ── Execute mode — baseline failure ──────────────────────────────────────────

describe('autoResearch: execute mode — baseline failure', () => {
  it('sets exitCode=1 when _runBaseline throws', async () => {
    const opts = makeBaseOpts({
      _runBaseline: async () => { throw new Error('measurement command not found'); },
      // time=0 so loop won't run anyway
    });
    await autoResearch('goal', { time: '1m', measurementCommand: 'echo 0' }, opts);
    assert.strictEqual(process.exitCode, 1);
    process.exitCode = 0;
  });

  it('continues and runs baseline when _git throws on branch creation', async () => {
    let baselineCalled = false;
    const opts = makeBaseOpts({
      _git: async (args: string[]) => {
        if (args[0] === 'status') return '';
        if (args[0] === 'checkout') throw new Error('not a git repo');
        return '';
      },
      _runBaseline: async () => { baselineCalled = true; return 100; },
      _isLLMAvailable: async () => false,
      _now: () => Date.now() + 999_999_999, // budget exhausted immediately
    });
    await autoResearch('goal', { time: '1m', measurementCommand: 'echo 0' }, opts);
    assert.ok(baselineCalled, 'baseline should still run after branch creation failure');
  });
});

// ── Execute mode — LLM unavailable ───────────────────────────────────────────

describe('autoResearch: execute mode — LLM unavailable (pre-flight)', () => {
  it('sets exitCode=1 and returns early when LLM unavailable at pre-flight check', async () => {
    const opts = makeBaseOpts({ _isLLMAvailable: async () => false });
    await autoResearch('reduce latency', { time: '1m', measurementCommand: 'echo 0' }, opts);
    assert.strictEqual(process.exitCode, 1, 'exitCode should be 1 when LLM unavailable');
    process.exitCode = 0;
  });

  it('does NOT write report when LLM unavailable at pre-flight check', async () => {
    const written: string[] = [];
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => false,
      _writeFile: async (p) => { written.push(p); },
    });
    await autoResearch('reduce latency', { time: '1m', measurementCommand: 'echo 0' }, opts);
    assert.strictEqual(written.filter(p => p.includes('AUTORESEARCH_REPORT')).length, 0,
      'report should NOT be written when LLM unavailable at pre-flight');
    process.exitCode = 0;
  });

  it('does NOT save state when LLM unavailable at pre-flight check', async () => {
    const opts = makeBaseOpts({ _isLLMAvailable: async () => false });
    await autoResearch('goal', { time: '1m', measurementCommand: 'echo 0' }, opts);
    assert.strictEqual(opts.saved.length, 0, 'state should NOT be saved when LLM unavailable at pre-flight');
    process.exitCode = 0;
  });
});

// ── Execute mode — experiment cycle ──────────────────────────────────────────

describe('autoResearch: execute mode — experiment cycle', () => {
  it('calls _git for commit when experiment is kept (metric improved)', async () => {
    const gitCalls: string[][] = [];
    // Boolean toggle: budget expires after the first experiment runs — decoupled from internal call count
    let budgetExpired = false;
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async () => '{"description":"test","fileToChange":"","change":""}',
      _runBaseline: async () => 100,
      _runExperiment: async (_c, id): Promise<ExperimentResult> => {
        budgetExpired = true; // expire budget so loop exits on next while-check
        return { id, description: 'experiment', metricValue: 50, status: 'keep' };
      },
      _git: async (args: string[]) => {
        gitCalls.push([...args]);
        if (args[0] === 'status') return '';
        return 'abc1234';
      },
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    await autoResearch('goal', { time: '30m', measurementCommand: 'echo 0' }, opts);
    // git should have been called for add + commit (keeping the experiment)
    assert.ok(gitCalls.some(args => args[0] === 'add'), 'git add should be called for kept experiment');
    assert.ok(gitCalls.some(args => args[0] === 'commit'), 'git commit should be called for kept experiment');
  });

  it('calls _git for reset when experiment is discarded', async () => {
    const gitCalls: string[][] = [];
    // Boolean toggle: budget expires after the first experiment runs — decoupled from internal call count
    let budgetExpired = false;
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async () => '{"description":"test","fileToChange":"","change":""}',
      _runBaseline: async () => 50,
      _runExperiment: async (_c, id): Promise<ExperimentResult> => {
        budgetExpired = true;
        return { id, description: 'experiment', metricValue: 200, status: 'discard' };
      },
      _git: async (args: string[]) => {
        gitCalls.push([...args]);
        if (args[0] === 'status') return '';
        return 'abc1234';
      },
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    await autoResearch('goal', { time: '30m', measurementCommand: 'echo 0' }, opts);
    assert.ok(gitCalls.some(args => args[0] === 'reset'), 'git reset should be called for discarded experiment');
  });

  it('exits loop immediately when _now returns time past budget', async () => {
    let experimentCalled = false;
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _runExperiment: async (_c, id): Promise<ExperimentResult> => {
        experimentCalled = true;
        return { id, description: 'exp', metricValue: 50, status: 'keep' };
      },
      _now: () => 999_999_999, // always past budget
    });
    await autoResearch('goal', { time: '1m', measurementCommand: 'echo 0' }, opts);
    assert.strictEqual(experimentCalled, false, 'no experiments should run when budget is exhausted');
  });

  it('calls _writeFile to write the report when budget expires with no experiments', async () => {
    const written: string[] = [];
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _writeFile: async (p) => { written.push(p); },
      _now: () => 999_999_999, // budget always exhausted → loop exits immediately, report still written
    });
    await autoResearch('goal', { time: '1m', measurementCommand: 'echo 0' }, opts);
    assert.ok(written.some(p => p.includes('AUTORESEARCH_REPORT')), 'report should be written');
  });
});

// ── Execute mode — experiment error paths ─────────────────────────────────────

describe('autoResearch: execute mode — experiment error paths', () => {
  it('continues loop after hypothesis generation failure (_callLLM throws)', async () => {
    let experiments = 0;
    let nowCount = 0;
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async () => { throw new Error('LLM timeout'); },
      _runBaseline: async () => 100,
      _runExperiment: async (_c: AutoResearchConfig, id: number): Promise<ExperimentResult> => {
        experiments++;
        return { id, description: 'x', metricValue: 50, status: 'keep' };
      },
      // Call sequence: 1=startTime(0), 2=while-check(0→enter), 3=remainingMs(0→ok),
      // hypothesis throws→continue, 4=while-check(past-budget→exit)
      _now: () => { nowCount++; return nowCount <= 3 ? 0 : 31 * 60 * 1000; },
    });
    await autoResearch('goal', { time: '30m', measurementCommand: 'echo 0' }, opts);
    assert.strictEqual(experiments, 0, '_runExperiment should NOT be called when hypothesis fails');
  });

  it('does not throw when git commit fails in keep path (best-effort commit)', async () => {
    const gitCalls: string[][] = [];
    let budgetExpired = false;
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async () => '{"description":"test","fileToChange":"","change":""}',
      _runBaseline: async () => 100,
      _runExperiment: async (_c: AutoResearchConfig, id: number): Promise<ExperimentResult> => {
        budgetExpired = true;
        return { id, description: 'x', metricValue: 50, status: 'keep' };
      },
      _git: async (args: string[]) => {
        gitCalls.push([...args]);
        if (args[0] === 'status') return '';
        if (args[0] === 'commit') throw new Error('commit failed');
        return 'abc1234';
      },
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    await assert.doesNotReject(() =>
      autoResearch('goal', { time: '30m', measurementCommand: 'echo 0' }, opts));
    assert.ok(opts.saved.length > 0, 'state should be saved even when commit fails');
    assert.ok(gitCalls.some(a => a[0] === 'add'), 'git add should be called in keep path');
  });

  it('does not throw when git reset fails during rollback (best-effort rollback)', async () => {
    const gitCalls: string[][] = [];
    let budgetExpired = false;
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async () => '{"description":"test","fileToChange":"","change":""}',
      _runBaseline: async () => 50,
      _runExperiment: async (_c: AutoResearchConfig, id: number): Promise<ExperimentResult> => {
        budgetExpired = true;
        return { id, description: 'x', metricValue: 200, status: 'discard' };
      },
      _git: async (args: string[]) => {
        gitCalls.push([...args]);
        if (args[0] === 'status') return '';
        if (args[0] === 'reset') throw new Error('reset failed');
        return 'abc1234';
      },
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    await assert.doesNotReject(() =>
      autoResearch('goal', { time: '30m', measurementCommand: 'echo 0' }, opts));
    assert.ok(opts.saved.length > 0, 'state should be saved even when reset fails');
    assert.ok(gitCalls.some(a => a[0] === 'reset'), 'git reset should still be attempted');
  });

  it('skips commit but runs rollback when experiment crashes (metricValue null)', async () => {
    const gitCalls: string[][] = [];
    let budgetExpired = false;
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async () => '{"description":"test","fileToChange":"","change":""}',
      _runBaseline: async () => 100,
      _runExperiment: async (_c: AutoResearchConfig, id: number): Promise<ExperimentResult> => {
        budgetExpired = true;
        return { id, description: 'x', metricValue: null, status: 'crash' };
      },
      _git: async (args: string[]) => {
        gitCalls.push([...args]);
        if (args[0] === 'status') return '';
        return 'abc1234';
      },
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    await autoResearch('goal', { time: '30m', measurementCommand: 'echo 0' }, opts);
    assert.ok(!gitCalls.some(a => a[0] === 'commit'), 'commit NOT called for crash result');
    assert.ok(gitCalls.some(a => a[0] === 'reset'), 'reset IS called for crash result (rollback path)');
  });
});

// ── Execute mode — per-iteration LLM retry ───────────────────────────────────

describe('autoResearch: execute mode — per-iteration LLM retry', () => {
  it('retries and runs experiment when LLM recovers after transient failures', async () => {
    let llmCallCount = 0;
    let experimentRan = false;
    let budgetExpired = false;

    // Pre-flight: true. Per-iter call 1: false, call 2: false, call 3: true → run experiment
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => {
        llmCallCount++;
        // call 1 = pre-flight (true), calls 2-3 = per-iteration (false), call 4+ = true
        return llmCallCount === 1 || llmCallCount >= 4;
      },
      _sleep: async () => {}, // instant sleep so test doesn't hang
      _callLLM: async () => '{"description":"test","fileToChange":"","change":""}',
      _runBaseline: async () => 100,
      _runExperiment: async (_c: AutoResearchConfig, id: number): Promise<ExperimentResult> => {
        budgetExpired = true;
        experimentRan = true;
        return { id, description: 'recovered', metricValue: 50, status: 'keep' };
      },
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    await autoResearch('goal', { time: '30m', measurementCommand: 'echo 0' }, opts);
    assert.ok(experimentRan, 'experiment should run after LLM recovers from transient failures');
  });

  it('breaks loop after MAX_LLM_FAILURES consecutive per-iteration failures', async () => {
    let preflightCalled = false;
    let experimentRan = false;

    const opts = makeBaseOpts({
      _isLLMAvailable: async () => {
        if (!preflightCalled) { preflightCalled = true; return true; } // pre-flight passes
        return false; // all per-iteration checks fail
      },
      _sleep: async () => {},
      _runBaseline: async () => 100,
      _runExperiment: async (_c: AutoResearchConfig, id: number): Promise<ExperimentResult> => {
        experimentRan = true;
        return { id, description: 'x', metricValue: 50, status: 'keep' };
      },
      _now: () => 0, // budget never expires by time — loop must exit via consecutive failure limit
    });
    await autoResearch('goal', { time: '30m', measurementCommand: 'echo 0' }, opts);
    assert.strictEqual(experimentRan, false, 'no experiments should run when LLM is persistently unavailable');
  });
});

// ── Execute mode — program.md research strategy ───────────────────────────────

describe('autoResearch: execute mode — program.md research strategy', () => {
  it('injects program.md contents into the hypothesis LLM prompt', async () => {
    const capturedPrompts: string[] = [];
    let budgetExpired = false;

    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async (prompt: string) => {
        capturedPrompts.push(prompt);
        return '{"description":"test","fileToChange":"","change":""}';
      },
      _readFile: async (p: string) => {
        if (p.includes('autoresearch.program.md')) return '## Strategy\nFocus on caching only.';
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      _runBaseline: async () => 100,
      _runExperiment: async (_c: AutoResearchConfig, id: number): Promise<ExperimentResult> => {
        budgetExpired = true;
        return { id, description: 'x', metricValue: 90, status: 'keep' };
      },
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    await autoResearch('goal', { time: '30m', measurementCommand: 'echo 0' }, opts);
    const hypothesisPrompts = capturedPrompts.filter(p => p.includes('autonomous code optimizer'));
    assert.ok(hypothesisPrompts.length > 0, 'at least one hypothesis prompt should be captured');
    assert.ok(
      hypothesisPrompts.some(p => p.includes('Focus on caching only')),
      'program.md strategy should appear in the hypothesis LLM prompt',
    );
  });

  it('runs normally when autoresearch.program.md does not exist', async () => {
    let experimentRan = false;
    let budgetExpired = false;

    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async () => '{"description":"test","fileToChange":"","change":""}',
      _readFile: async (_p: string) => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      _runBaseline: async () => 100,
      _runExperiment: async (_c: AutoResearchConfig, id: number): Promise<ExperimentResult> => {
        budgetExpired = true;
        experimentRan = true;
        return { id, description: 'x', metricValue: 90, status: 'keep' };
      },
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    await assert.doesNotReject(
      () => autoResearch('goal', { time: '30m', measurementCommand: 'echo 0' }, opts),
      'should not throw when program.md is absent',
    );
    assert.ok(experimentRan, 'experiment should run when program.md is absent');
  });
});
