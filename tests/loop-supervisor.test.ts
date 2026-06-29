import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLoopExit, backoffFor, isBudgetStop, isPolicyStop, isConfigBlock,
  type LoopExit, type ClassifyConfig,
} from '../src/core/loop-exit-classifier.js';
import { runSupervisor, type SupervisorDeps, type SupervisorConfig } from '../src/core/loop-supervisor.js';
import type { LoopRunSummary } from '../src/core/autonomous-loop-runner.js';
import {
  freshSupervisorState, saveSupervisorState, loadSupervisorState, type SupervisorState,
} from '../src/core/supervisor-state.js';

const NOW = 1_700_000_000_000;
const tiered: ClassifyConfig = { posture: 'tiered' };

function exit(partial: Partial<LoopExit>): LoopExit {
  return { status: 'stopped', ceilingHit: false, finalReason: 'done', ...partial };
}

describe('loop-exit-classifier — the tiered auto-reengage brain', () => {
  test('target reached → stop (the only happy terminal)', () => {
    const a = classifyLoopExit(exit({ targetReached: true }), tiered, NOW);
    assert.equal(a.kind, 'stop');
  });

  test('provider outage with a NAMED reset → resume-at that instant', () => {
    const a = classifyLoopExit(
      exit({ crashed: true, output: 'ERROR: You have hit your usage limit, try again at 8:45 PM' }), tiered, NOW);
    assert.equal(a.kind, 'resume-at');
    if (a.kind === 'resume-at') assert.ok(a.resumeAtMs > NOW, 'resumes at a future instant');
  });

  test('provider outage UNTIMED → restart with backoff (not a ceiling)', () => {
    const a = classifyLoopExit(exit({ output: 'Error: 401 Unauthorized — authentication failed' }), tiered, NOW);
    assert.equal(a.kind, 'restart');
  });

  test('provider outage under notify posture → pause (operator drives)', () => {
    const a = classifyLoopExit(
      exit({ output: 'quota exceeded' }), { posture: 'notify' }, NOW);
    assert.equal(a.kind, 'pause');
  });

  test('circuit breaker: stale restarts at the cap → pause + escalate', () => {
    const a = classifyLoopExit(exit({ staleRestarts: 5 }), { posture: 'tiered', maxStaleRestarts: 5 }, NOW);
    assert.equal(a.kind, 'pause');
    if (a.kind === 'pause') assert.equal(a.escalate, true);
  });

  test('capability ceiling → pause + escalate in EVERY posture (incl. afk)', () => {
    for (const posture of ['tiered', 'afk', 'notify'] as const) {
      const a = classifyLoopExit(exit({ ceilingHit: true, finalReason: 'generator-ceiling' }), { posture }, NOW);
      assert.equal(a.kind, 'pause', posture);
      if (a.kind === 'pause') assert.equal(a.escalate, true, posture);
    }
  });

  test('policy block → pause, no escalate', () => {
    const a = classifyLoopExit(exit({ finalReason: 'BLOCKED_BY_POLICY: protected line' }), tiered, NOW);
    assert.equal(a.kind, 'pause');
    if (a.kind === 'pause') assert.equal(a.escalate, false);
  });

  test('budget stop: tiered pauses, afk restarts the window', () => {
    const r = exit({ finalReason: 'token budget exhausted' });
    assert.equal(classifyLoopExit(r, { posture: 'tiered' }, NOW).kind, 'pause');
    assert.equal(classifyLoopExit(r, { posture: 'afk' }, NOW).kind, 'restart');
  });

  test('degraded panel (status paused) → transient restart', () => {
    const a = classifyLoopExit(exit({ status: 'paused', finalReason: 'quorum not met' }), tiered, NOW);
    assert.equal(a.kind, 'restart');
  });

  test('crash → transient restart', () => {
    const a = classifyLoopExit(exit({ crashed: true, finalReason: 'engine crashed', output: 'worktree exploded' }), tiered, NOW);
    assert.equal(a.kind, 'restart');
  });

  test('notify posture pauses on an ordinary stop', () => {
    const a = classifyLoopExit(exit({ finalReason: 'max cycles reached (20)' }), { posture: 'notify' }, NOW);
    assert.equal(a.kind, 'pause');
  });

  test('backoff grows exponentially and is capped', () => {
    const cfg: ClassifyConfig = { posture: 'tiered', baseBackoffMs: 1000, maxBackoffMs: 10_000 };
    assert.equal(backoffFor(0, cfg), 1000);
    assert.equal(backoffFor(2, cfg), 4000);
    assert.equal(backoffFor(99, cfg), 10_000); // capped
  });

  test('budget/policy reason matchers', () => {
    assert.ok(isBudgetStop('out of tokens'));
    assert.ok(!isBudgetStop('quorum not met'));
    assert.ok(isPolicyStop('gate blocked'));
    assert.ok(!isPolicyStop('done'));
  });

  test('config block (no provider) → pause immediately, do NOT retry as transient (dogfood fix)', () => {
    const reason = 'No verified live LLM provider is configured for forge execution. Re-run with --prompt or configure a provider.';
    // First run, no stale restarts — must still pause, not restart.
    const a = classifyLoopExit(exit({ status: 'paused', finalReason: reason, staleRestarts: 0 }), tiered, NOW);
    assert.equal(a.kind, 'pause');
    if (a.kind === 'pause') assert.equal(a.escalate, false);
    // afk posture must ALSO pause — restarting can't conjure a provider.
    assert.equal(classifyLoopExit(exit({ finalReason: reason }), { posture: 'afk' }, NOW).kind, 'pause');
  });

  test('isConfigBlock matchers (provider missing vs ordinary failure)', () => {
    assert.ok(isConfigBlock('No verified live LLM provider is available'));
    assert.ok(isConfigBlock('Ollama model "llama3" is not available from the configured endpoint'));
    assert.ok(isConfigBlock('configure a provider with working model access'));
    assert.ok(isConfigBlock('OpenAI model "gpt-foo" is not available from the configured endpoint'));
    assert.ok(isConfigBlock('The configured model is not available for the selected provider'));
    assert.ok(!isConfigBlock('quorum not met'));
    assert.ok(!isConfigBlock('max cycles reached (20)'));
  });
});

// ── Supervisor integration (fakes only — no subprocess, no real clock) ─────────

function fakeDeps(over: Partial<SupervisorDeps> = {}): { deps: SupervisorDeps; sleeps: number[]; saved: SupervisorState[] } {
  const sleeps: number[] = [];
  const saved: SupervisorState[] = [];
  const deps: SupervisorDeps = {
    runEngine: async () => ({ status: 'stopped', ceilingHit: false, cyclesRun: 1, groundingStart: 0, groundingEnd: 0, finalReason: 'done', history: [] }),
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => NOW,
    saveState: async (s) => { saved.push(JSON.parse(JSON.stringify(s))); },
    log: () => {},
    ...over,
  };
  return { deps, sleeps, saved };
}

const cfg: SupervisorConfig = { posture: 'tiered', goal: 'g', target: 8, engine: 'autoforge', baseBackoffMs: 10 };

describe('runSupervisor — auto-reengage without a human', () => {
  test('restarts through 2 transient stops then stops on target — NO manual resume', async () => {
    let runCount = 0;
    const summary: LoopRunSummary = { status: 'paused', ceilingHit: false, cyclesRun: 1, groundingStart: 0, groundingEnd: 0, finalReason: 'quorum not met', history: [] };
    const { deps, sleeps } = fakeDeps({
      runEngine: async () => { runCount++; return summary; },
      targetReached: async () => runCount >= 2,
    });
    const res = await runSupervisor(deps, cfg);
    assert.equal(res.outcome, 'stopped-success');
    assert.equal(runCount, 2, 'ran the engine twice unattended');
    assert.ok(sleeps.length >= 1, 'backed off between restarts');
  });

  test('recovers from a CRASH, then escalates a real ceiling into a worklist (no-walls)', async () => {
    let runCount = 0;
    const { deps } = fakeDeps({
      runEngine: async () => {
        runCount++;
        if (runCount === 1) throw new Error('docker daemon not running');
        return { status: 'stopped', ceilingHit: true, cyclesRun: 1, groundingStart: 0, groundingEnd: 0, finalReason: 'generator-ceiling', history: [] };
      },
      proposeCeilingChildren: () => [
        { kind: 'sub', signal: 'wire the missing callsite', rationale: 'orphan check failed' },
        { kind: 'sub', signal: 'author a real product-run test', rationale: 'structural probe only' },
      ],
    });
    const res = await runSupervisor(deps, cfg);
    assert.equal(res.outcome, 'escalated');
    assert.equal(runCount, 2, 'crash on run 1 recovered, ceiling on run 2');
    assert.ok(res.ceilingDecomposition, 'ceiling produced a decomposition receipt');
    assert.equal(res.ceilingDecomposition!.resolution.kind, 'decomposed');
  });

  test('honors the operator stop sentinel', async () => {
    const { deps } = fakeDeps({ stopRequested: async () => true });
    const res = await runSupervisor(deps, cfg);
    assert.equal(res.outcome, 'stopped-operator');
  });

  test('circuit breaker fires after N restarts with no grounding progress', async () => {
    const { deps } = fakeDeps({
      runEngine: async () => ({ status: 'stopped', ceilingHit: false, cyclesRun: 1, groundingStart: 0, groundingEnd: 0, finalReason: 'max cycles reached (20)', history: [] }),
      measureGrounding: async () => 0.42, // flat — never improves
      proposeCeilingChildren: () => [
        { kind: 'sub', signal: 'a', rationale: 'r' }, { kind: 'sub', signal: 'b', rationale: 'r' },
      ],
    });
    const res = await runSupervisor(deps, { ...cfg, maxStaleRestarts: 3 });
    assert.equal(res.outcome, 'escalated');
    assert.ok(res.restarts >= 3, 'burned the stale-restart budget before escalating');
  });

  test('respects the hard restart cap', async () => {
    const { deps } = fakeDeps({
      runEngine: async () => ({ status: 'paused', ceilingHit: false, cyclesRun: 1, groundingStart: 0, groundingEnd: 0, finalReason: 'quorum not met', history: [] }),
      measureGrounding: async () => Math.random(), // always "progresses" so the breaker never fires
    });
    const res = await runSupervisor(deps, { ...cfg, maxRestarts: 4, maxStaleRestarts: 999 });
    assert.equal(res.outcome, 'restart-cap');
    assert.equal(res.restarts, 4);
  });

  test('provider outage with named reset → sleeps until that instant', async () => {
    let runCount = 0;
    const { deps, sleeps } = fakeDeps({
      runEngine: async () => {
        runCount++;
        return { status: 'stopped', ceilingHit: false, cyclesRun: 1, groundingStart: 0, groundingEnd: 0,
          finalReason: 'You have hit your usage limit, try again at 8:45 PM', history: [] };
      },
      targetReached: async () => runCount >= 2,
    });
    // Run 1 hits the outage → resume-at sleep; run 2 then reaches target. The long sleep must have happened.
    await runSupervisor(deps, cfg);
    assert.ok(sleeps.some((s) => s > 60_000), 'slept a long window until the provider reset');
  });
});

describe('supervisor-state — durable resume', () => {
  test('fresh state is running with zero restarts', () => {
    const s = freshSupervisorState({ goal: 'g', target: 9, engine: 'crusade', posture: 'tiered' }, new Date(NOW).toISOString());
    assert.equal(s.status, 'running');
    assert.equal(s.restarts, 0);
    assert.equal(s.stopRequested, false);
  });

  test('save/load round-trips via injected fs', async () => {
    let stored = '';
    const s = freshSupervisorState({ goal: 'g', target: 9, engine: 'crusade', posture: 'tiered' }, new Date(NOW).toISOString());
    s.restarts = 7;
    await saveSupervisorState(s, '/x', async (_p, d) => { stored = d; });
    const loaded = await loadSupervisorState('/x', async () => stored);
    assert.equal(loaded!.restarts, 7);
    assert.equal(loaded!.engine, 'crusade');
  });

  test('load returns null on missing/malformed state', async () => {
    const loaded = await loadSupervisorState('/x', async () => { throw new Error('ENOENT'); });
    assert.equal(loaded, null);
  });
});
