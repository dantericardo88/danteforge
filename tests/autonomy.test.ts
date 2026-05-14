// autonomy.test.ts — Tests for checkpoint/resume, transient-retry, goal-loop-unattended, schedule.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  saveCheckpoint,
  loadCheckpoint,
  AUTOFORGE_CHECKPOINT_FILE,
  CHECKPOINT_MAX_AGE_MS,
  AutoforgeLoopState,
  type AutoforgeCheckpoint,
  type AutoforgeLoopContext,
} from '../src/core/autoforge-loop.js';

import {
  withTransientRetry,
  isTransientError,
  type RetryOptions,
} from '../src/core/transient-retry.js';

import {
  runGoalLoopUnattended,
  type GoalLoopUnattendedOptions,
} from '../src/core/goal-loop-engine.js';

import {
  schedule,
  type ScheduleOptions,
} from '../src/cli/commands/schedule.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): { dir: string; cleanup: () => Promise<void> } {
  let dir = '';
  return {
    get dir() { return dir; },
    async [Symbol.asyncDispose]() { if (dir) await fs.rm(dir, { recursive: true, force: true }); },
    async cleanup() { if (dir) await fs.rm(dir, { recursive: true, force: true }); },
    async init() {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-autonomy-'));
    },
  } as { dir: string; cleanup: () => Promise<void> } & { init(): Promise<void> };
}

function makeCtx(overrides: Partial<AutoforgeLoopContext> = {}): AutoforgeLoopContext {
  return {
    goal: 'Test goal',
    cwd: process.cwd(),
    state: {
      auditLog: [],
      tasks: {},
      constitution: null,
      workflowStage: 'initialized',
      totalTokensUsed: 0,
    } as unknown as AutoforgeLoopContext['state'],
    loopState: AutoforgeLoopState.RUNNING,
    cycleCount: 5,
    startedAt: new Date().toISOString(),
    retryCounters: { 'spec.md': 2 },
    blockedArtifacts: ['verify'],
    lastGuidance: null,
    isWebProject: false,
    force: false,
    maxRetries: 3,
    recentScores: [70, 75, 80],
    ...overrides,
  };
}

// ── Section 1: saveCheckpoint / loadCheckpoint ────────────────────────────────

describe('saveCheckpoint', () => {
  it('writes a valid checkpoint JSON to the expected path', async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const ctx = makeCtx();

    await saveCheckpoint(
      ctx,
      '/fake/cwd',
      async (p, d) => { writes.push({ path: p, data: d }); },
    );

    assert.equal(writes.length, 1);
    const { path: writtenPath, data } = writes[0];
    assert.ok(writtenPath.endsWith('autoforge-checkpoint.json'));
    const parsed = JSON.parse(data) as AutoforgeCheckpoint;
    assert.equal(parsed.cycleCount, 5);
    assert.equal(parsed.goal, 'Test goal');
    assert.deepEqual(parsed.retryCounters, { 'spec.md': 2 });
    assert.deepEqual(parsed.blockedArtifacts, ['verify']);
    assert.deepEqual(parsed.recentScores, [70, 75, 80]);
    assert.equal(parsed.lastOverall, 80);
    assert.equal(parsed.loopState, AutoforgeLoopState.RUNNING);
    assert.ok(typeof parsed.savedAt === 'string');
  });

  it('includes a savedAt ISO timestamp', async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const ctx = makeCtx();

    const before = Date.now();
    await saveCheckpoint(ctx, '/fake/cwd', async (p, d) => { writes.push({ path: p, data: d }); });
    const after = Date.now();

    const parsed = JSON.parse(writes[0].data) as AutoforgeCheckpoint;
    const ts = new Date(parsed.savedAt).getTime();
    assert.ok(ts >= before && ts <= after, 'savedAt should be a recent timestamp');
  });

  it('sets lastOverall to 0 when recentScores is empty', async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const ctx = makeCtx({ recentScores: [] });

    await saveCheckpoint(ctx, '/fake/cwd', async (p, d) => { writes.push({ path: p, data: d }); });

    const parsed = JSON.parse(writes[0].data) as AutoforgeCheckpoint;
    assert.equal(parsed.lastOverall, 0);
  });

  it('never throws even when the write function rejects', async () => {
    const ctx = makeCtx();
    // No assertion — just must not throw
    await assert.doesNotReject(() =>
      saveCheckpoint(ctx, '/fake/cwd', async () => { throw new Error('disk full'); }),
    );
  });
});

describe('loadCheckpoint', () => {
  it('returns a checkpoint when file is fresh (< 4 hours old)', async () => {
    const checkpoint: AutoforgeCheckpoint = {
      savedAt: new Date().toISOString(),
      cycleCount: 7,
      goal: 'Improve testing',
      loopState: AutoforgeLoopState.RUNNING,
      retryCounters: {},
      blockedArtifacts: [],
      recentScores: [60, 65],
      lastOverall: 65,
    };

    const result = await loadCheckpoint(
      '/fake/cwd',
      async () => JSON.stringify(checkpoint),
      () => Date.now(),
    );

    assert.ok(result !== null);
    assert.equal(result.cycleCount, 7);
    assert.equal(result.goal, 'Improve testing');
  });

  it('returns null when checkpoint is older than 4 hours', async () => {
    const stale = new Date(Date.now() - CHECKPOINT_MAX_AGE_MS - 1).toISOString();
    const checkpoint: AutoforgeCheckpoint = {
      savedAt: stale,
      cycleCount: 3,
      goal: 'Old goal',
      loopState: AutoforgeLoopState.COMPLETE,
      retryCounters: {},
      blockedArtifacts: [],
      recentScores: [],
      lastOverall: 90,
    };

    const result = await loadCheckpoint(
      '/fake/cwd',
      async () => JSON.stringify(checkpoint),
      () => Date.now(),
    );

    assert.equal(result, null);
  });

  it('returns null when the file does not exist', async () => {
    const result = await loadCheckpoint(
      '/fake/cwd',
      async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    );
    assert.equal(result, null);
  });

  it('returns null when the file contains invalid JSON', async () => {
    const result = await loadCheckpoint('/fake/cwd', async () => 'not-json');
    assert.equal(result, null);
  });

  it('restores all fields correctly', async () => {
    const checkpoint: AutoforgeCheckpoint = {
      savedAt: new Date().toISOString(),
      cycleCount: 12,
      goal: 'Multi-dim goal',
      loopState: AutoforgeLoopState.BLOCKED,
      retryCounters: { 'plan.md': 1, 'tasks.md': 2 },
      blockedArtifacts: ['forge', 'verify'],
      recentScores: [50, 55, 60, 65],
      lastOverall: 65,
    };

    const result = await loadCheckpoint(
      '/fake/cwd',
      async () => JSON.stringify(checkpoint),
      () => Date.now(),
    );

    assert.ok(result !== null);
    assert.deepEqual(result.retryCounters, { 'plan.md': 1, 'tasks.md': 2 });
    assert.deepEqual(result.blockedArtifacts, ['forge', 'verify']);
    assert.deepEqual(result.recentScores, [50, 55, 60, 65]);
    assert.equal(result.loopState, AutoforgeLoopState.BLOCKED);
  });
});

// ── Section 2: withTransientRetry ─────────────────────────────────────────────

describe('withTransientRetry', () => {
  it('returns the result on first success', async () => {
    const result = await withTransientRetry(async () => 42, { maxAttempts: 3 });
    assert.equal(result, 42);
  });

  it('succeeds on the 3rd attempt after two transient failures', async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withTransientRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('ECONNRESET connection reset');
        return 'ok';
      },
      {
        maxAttempts: 3,
        delayMs: 10,
        backoffFactor: 2,
        _sleep: async (ms) => { delays.push(ms); },
      },
    );

    assert.equal(result, 'ok');
    assert.equal(calls, 3);
    assert.equal(delays.length, 2);
    assert.equal(delays[0], 10);
    assert.equal(delays[1], 20);
  });

  it('throws after exhausting maxAttempts', async () => {
    let calls = 0;
    await assert.rejects(
      () => withTransientRetry(
        async () => {
          calls++;
          throw new Error('429 rate limit exceeded');
        },
        { maxAttempts: 3, delayMs: 1, _sleep: async () => { /* no-op */ } },
      ),
      (err: Error) => {
        assert.ok(err.message.includes('429'));
        return true;
      },
    );
    assert.equal(calls, 3);
  });

  it('does NOT retry non-transient errors', async () => {
    let calls = 0;
    await assert.rejects(
      () => withTransientRetry(
        async () => {
          calls++;
          throw new Error('Invalid API key — authentication failed');
        },
        { maxAttempts: 3, delayMs: 1, _sleep: async () => { /* no-op */ } },
      ),
    );
    assert.equal(calls, 1, 'Should not retry non-transient errors');
  });

  it('applies exponential backoff correctly', async () => {
    const delays: number[] = [];
    let calls = 0;
    await withTransientRetry(
      async () => {
        calls++;
        if (calls < 4) throw new Error('ETIMEDOUT timed out');
        return 'done';
      },
      {
        maxAttempts: 4,
        delayMs: 100,
        backoffFactor: 3,
        _sleep: async (ms) => { delays.push(ms); },
      },
    );
    assert.equal(delays[0], 100);
    assert.equal(delays[1], 300);
    assert.equal(delays[2], 900);
  });
});

// ── Section 3: isTransientError ───────────────────────────────────────────────

describe('isTransientError', () => {
  it('classifies ECONNRESET as transient', () => {
    assert.ok(isTransientError(new Error('ECONNRESET connection reset by peer')));
  });

  it('classifies ETIMEDOUT as transient', () => {
    assert.ok(isTransientError(new Error('ETIMEDOUT operation timed out')));
  });

  it('classifies ENOTFOUND as transient', () => {
    assert.ok(isTransientError(new Error('ENOTFOUND getaddrinfo failed')));
  });

  it('classifies 429 rate limit as transient', () => {
    assert.ok(isTransientError(new Error('rate limit exceeded: 429')));
  });

  it('classifies 503 service unavailable as transient', () => {
    assert.ok(isTransientError(new Error('503 temporarily unavailable')));
  });

  it('classifies socket hang up as transient', () => {
    assert.ok(isTransientError(new Error('socket hang up')));
  });

  it('classifies request timed out as transient', () => {
    assert.ok(isTransientError(new Error('request timed out after 30000ms')));
  });

  it('does NOT classify auth error as transient', () => {
    assert.equal(isTransientError(new Error('401 authentication failed')), false);
  });

  it('does NOT classify invalid JSON as transient', () => {
    assert.equal(isTransientError(new Error('returned invalid JSON')), false);
  });

  it('does NOT classify generic errors as transient', () => {
    assert.equal(isTransientError(new Error('unknown error')), false);
  });
});

// ── Section 4: runGoalLoopUnattended ─────────────────────────────────────────

describe('runGoalLoopUnattended', () => {
  it('stops when goal score is reached', async () => {
    const logs: string[] = [];
    let calls = 0;

    const result = await runGoalLoopUnattended({
      goal: 'Reach 9.0',
      maxCycles: 10,
      targetScore: 9.0,
      cwd: '/fake',
      _runStage: async () => {
        calls++;
        return { success: true, overallScore: calls >= 3 ? 9.2 : 5.0 };
      },
      _appendLog: async (_, line) => { logs.push(line); },
    });

    assert.equal(result.goalMet, true);
    assert.equal(result.stopReason, 'goal-met');
    assert.equal(result.cyclesRun, 3);
    assert.ok(result.finalScore >= 9.0);
  });

  it('stops at max cycles when goal is never met', async () => {
    const logs: string[] = [];

    const result = await runGoalLoopUnattended({
      goal: 'Never reached',
      maxCycles: 5,
      targetScore: 9.5,
      cwd: '/fake',
      _runStage: async () => ({ success: true, overallScore: 7.0 }),
      _appendLog: async (_, line) => { logs.push(line); },
    });

    assert.equal(result.goalMet, false);
    assert.equal(result.stopReason, 'max-cycles');
    assert.equal(result.cyclesRun, 5);
  });

  it('stops after 3 consecutive failures', async () => {
    const logs: string[] = [];
    let calls = 0;

    const result = await runGoalLoopUnattended({
      goal: 'Always failing',
      maxCycles: 20,
      targetScore: 9.0,
      cwd: '/fake',
      _runStage: async () => {
        calls++;
        return { success: false, overallScore: 0 };
      },
      _appendLog: async (_, line) => { logs.push(line); },
    });

    assert.equal(result.stopReason, 'consecutive-failures');
    assert.equal(result.cyclesRun, 3);
    assert.ok(logs.some(l => l.includes('consecutive failures')));
  });

  it('never prompts for input (no stdin reads)', async () => {
    // If any stdin read were attempted the test would hang.
    // This test completes in < 500ms proving no input is needed.
    const result = await runGoalLoopUnattended({
      goal: 'Unattended test',
      maxCycles: 2,
      targetScore: 99,
      cwd: '/fake',
      _runStage: async () => ({ success: true, overallScore: 1.0 }),
      _appendLog: async () => { /* no-op */ },
    });
    assert.equal(result.cyclesRun, 2);
    assert.equal(result.goalMet, false);
  });

  it('appends START and END log entries', async () => {
    const logs: string[] = [];

    await runGoalLoopUnattended({
      goal: 'Log test',
      maxCycles: 1,
      targetScore: 9.0,
      cwd: '/fake',
      _runStage: async () => ({ success: true, overallScore: 5.0 }),
      _appendLog: async (_, line) => { logs.push(line); },
    });

    assert.ok(logs.some(l => l.includes('START')));
    assert.ok(logs.some(l => l.includes('END')));
  });

  it('resets consecutive failure counter on success', async () => {
    const logs: string[] = [];
    let calls = 0;

    const result = await runGoalLoopUnattended({
      goal: 'Mixed success/fail',
      maxCycles: 6,
      targetScore: 9.0,
      cwd: '/fake',
      _runStage: async () => {
        calls++;
        // Fail on calls 1 and 2, succeed on 3-4 (reset counter), fail 5-7...
        // Should NOT stop at 3 because successes reset the counter
        if (calls === 3 || calls === 4) return { success: true, overallScore: 5.0 };
        return { success: false, overallScore: 0 };
      },
      _appendLog: async (_, line) => { logs.push(line); },
    });

    // Should not stop at consecutive-failures because successes reset the counter
    assert.equal(result.stopReason, 'max-cycles');
    assert.equal(result.cyclesRun, 6);
  });
});

// ── Section 5: schedule ───────────────────────────────────────────────────────

describe('schedule', () => {
  it('runs the command N times when maxRuns is set', async () => {
    const runs: string[] = [];
    const opts: ScheduleOptions = {
      intervalMinutes: 0.001,
      maxRuns: 3,
      cwd: '/fake',
      _runCommand: async (cmd) => { runs.push(cmd); return 0; },
      _sleep: async () => { /* no-op */ },
    };

    const result = await schedule('compete --calibrate', opts);

    assert.equal(result.runsCompleted, 3);
    assert.equal(result.runsFailed, 0);
    assert.equal(result.stopped, 'max-runs-reached');
    assert.equal(runs.length, 3);
    assert.ok(runs.every(r => r === 'compete --calibrate'));
  });

  it('counts failed runs separately', async () => {
    let callCount = 0;
    const opts: ScheduleOptions = {
      intervalMinutes: 0.001,
      maxRuns: 4,
      cwd: '/fake',
      _runCommand: async () => {
        callCount++;
        return callCount % 2 === 0 ? 1 : 0; // alternate success/failure
      },
      _sleep: async () => { /* no-op */ },
    };

    const result = await schedule('autoforge --auto', opts);

    assert.equal(result.runsCompleted, 4);
    assert.equal(result.runsFailed, 2);
  });

  it('respects the sleep interval between runs', async () => {
    const sleepCalls: number[] = [];
    const opts: ScheduleOptions = {
      intervalMinutes: 5,
      maxRuns: 3,
      cwd: '/fake',
      _runCommand: async () => 0,
      _sleep: async (ms) => { sleepCalls.push(ms); },
    };

    await schedule('verify', opts);

    // 3 runs, 2 intervals (last run doesn't wait before stopping)
    assert.equal(sleepCalls.length, 2);
    assert.ok(sleepCalls.every(ms => ms === 5 * 60_000));
  });

  it('stops when SIGINT is received (via injection)', async () => {
    // Simulate: override maxRuns=0 (unlimited) but we limit via injection
    // by making the run function set an interrupt flag through side-effect.
    let runs = 0;
    let sigintTrigger: (() => void) | undefined;

    const opts: ScheduleOptions = {
      intervalMinutes: 0.001,
      maxRuns: 5,
      cwd: '/fake',
      _runCommand: async () => {
        runs++;
        if (runs === 2) {
          // Trigger SIGINT on the 2nd run
          process.emit('SIGINT' as unknown as never);
        }
        return 0;
      },
      _sleep: async () => { if (sigintTrigger) sigintTrigger(); },
    };

    const result = await schedule('test-command', opts);

    // Should stop soon after SIGINT
    assert.ok(result.runsCompleted <= 3);
    assert.ok(result.stopped === 'user-interrupted' || result.stopped === 'max-runs-reached');
  });

  it('writes a log entry per run', async () => {
    const logEntries: Array<{ path: string; line: string }> = [];
    let tmpDir = '';

    try {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-sched-'));
      const logFile = path.join(tmpDir, 'test-schedule.log');

      const opts: ScheduleOptions = {
        intervalMinutes: 0.001,
        maxRuns: 2,
        logFile,
        cwd: tmpDir,
        _runCommand: async () => 0,
        _sleep: async () => { /* no-op */ },
      };

      await schedule('score', opts);

      const content = await fs.readFile(logFile, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      assert.equal(lines.length, 2);
      const parsed = lines.map(l => JSON.parse(l) as { command: string; exitCode: number; runNumber: number });
      assert.ok(parsed.every(r => r.command === 'score'));
      assert.ok(parsed.every(r => r.exitCode === 0));
      assert.equal(parsed[0].runNumber, 1);
      assert.equal(parsed[1].runNumber, 2);
    } finally {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
