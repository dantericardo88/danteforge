import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runAscendFrontier, setupCommands, buildTo7Commands, type PushResult } from '../src/cli/commands/ascend-frontier.js';
import { phaseTimeoutMs } from '../src/cli/commands/ascend-frontier-runner.js';
import type { DimState } from '../src/core/ascend-frontier-engine.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

const ROOT = path.join('X:\\tmp', `ascend-loop-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

function dim(over: Partial<DimState> = {}): DimState {
  // demandBound:true by default — these orchestration tests exercise the PUSH-to-9 flow, which now requires a
  // demand-bound dim (a no-demand 8.0 dim FINISHES instead of pushing; finish-mode is tested in the engine test).
  return { id: 'd', effectiveScore: 8.0, frontierStatus: 'frozen', ceiling: null, attempts: 0, isMarketCapped: false, demandBound: true, ...over };
}

describe('ascend-frontier — phase routing (sequential vs council-parallel)', () => {
  const M = ['codex', 'claude-code', 'grok-build'];
  // Setup chain: scaffold → migrate → yardstick self-heal (conduct --execute, budget-bounded) →
  // honest-define grounding. The conduct step is the conductor brain turned ON inside the loop —
  // it repairs/re-authors self-fulfilling capability_tests BEFORE the build grips them.
  const SERIAL_SETUP = [
    ['evidence-scaffold'], ['migrate-outcomes', '--write'],
    ['capability-test', 'conduct', '--execute', '--max-actions', '3'],
    ['ground-outcomes', '--apply'],
  ];
  test('sequential define = scaffold + migrate + yardstick self-heal + honest-define grounding', () => {
    assert.deepEqual(setupCommands(false, M), SERIAL_SETUP);
  });
  test('parallel define fans research out to council-universe (member-split), then serial scaffold/migrate/conduct/ground', () => {
    const c = setupCommands(true, M);
    assert.deepEqual(c[0], ['council-universe', '--members', 'codex,claude-code,grok-build', '--propose-outcomes']);
    assert.deepEqual(c.slice(1), SERIAL_SETUP);
  });
  test('build-to-7 uses harden-crusade SERIAL (--parallel 1) — shared-working-tree race avoided', () => {
    // Serial, not --parallel N: N autoresearch workers share one working tree and corrupt each other
    // (checkout/file-writes/reset --hard). harden-crusade --loop still drives every dim, one at a time.
    // build pass, then re-ground (honesty self-correction: a build can introduce a fresh orphan).
    const expected = [
      ['harden-crusade', '--parallel', '1', '--loop', '--target', '7', '--time', '18', '--max-minutes', '55'],
      ['ground-outcomes', '--apply'],
    ];
    assert.deepEqual(buildTo7Commands(false, M, ['a', 'b']), expected);
    assert.deepEqual(buildTo7Commands(true, M, ['a', 'b']), expected, 'council fan-out is reserved for push-to-9, not the 7.0 bar');
    assert.deepEqual(buildTo7Commands(true, ['codex'], ['a']), expected);
  });
  test('build-to-7 carries the dead-loop budgets: --time 18 (inner cycle) + --max-minutes 55 (checkpoint exit)', () => {
    // Fleet run 2 dead-loop: inner autoresearch budget (30m) == outer tree-kill cap (30m), so the
    // runner killed build-to-7 mid-dim-001 every cycle and NOTHING persisted. --time 18 lets at
    // least one full cycle finish inside any reasonable window; --max-minutes 55 (under the 60m
    // phase cap) makes harden-crusade checkpoint-exit cleanly instead of being tree-killed.
    const [hc] = buildTo7Commands(false, M, ['a']);
    const timeIdx = hc!.indexOf('--time');
    assert.ok(timeIdx > 0, 'harden-crusade must carry an explicit --time inner budget');
    assert.equal(hc![timeIdx + 1], '18');
    const maxIdx = hc!.indexOf('--max-minutes');
    assert.ok(maxIdx > 0, 'harden-crusade must carry the --max-minutes wall-clock checkpoint');
    assert.equal(hc![maxIdx + 1], '55');
  });
  test('runner phase cap is phase-aware: council builds get 2h (30m builder leash + revisions + court must FIT, L6), harden-crusade 60m, everything else 30m', () => {
    assert.equal(phaseTimeoutMs(['harden-crusade', '--parallel', '1', '--loop']), 60 * 60_000);
    assert.equal(phaseTimeoutMs(['council-crusade']), 120 * 60_000);
    assert.equal(phaseTimeoutMs(['council', '--parallel']), 120 * 60_000);
    assert.equal(phaseTimeoutMs(['ground-outcomes', '--apply']), 30 * 60_000);
    assert.equal(phaseTimeoutMs(['validate', 'dim001']), 30 * 60_000);
    assert.equal(phaseTimeoutMs([]), 30 * 60_000);
  });
});

describe('ascend-frontier — unattended loop control', () => {
  test('dry-run prints the next action and does not execute', async () => {
    let executed = false;
    const r = await runAscendFrontier({
      cwd: ROOT, dryRun: true,
      _buildState: async () => [dim({ id: 'a', effectiveScore: 7.0 })],
      _runPushTo9: async () => { executed = true; return { verdict: 'REJECTED', courtRan: true, fingerprint: { dimId: 'a', command: 'x', artifactPath: 'y', gitSha: 's' } }; },
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'dry-run');
    assert.match(r.actions[0]!, /push-to-9\(a\)/);
    assert.equal(executed, false, 'dry-run must not execute the push');
  });

  test('terminates DONE when all dims are validated or ceilinged', async () => {
    const r = await runAscendFrontier({
      cwd: ROOT,
      _buildState: async () => [dim({ id: 'a', effectiveScore: 9.0, frontierStatus: 'validated' })],
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done');
    assert.equal(r.cycles, 0);
  });

  test('a dim that keeps getting REJECTED is ceilinged after maxAttempts → loop ends DONE', async () => {
    // buildState reflects the disk ledger's attempt count (the loop records each rejected attempt).
    let pushN = 0;
    const r = await runAscendFrontier({
      cwd: ROOT, maxAttemptsPerDim: 2, maxCycles: 20,
      _buildState: async () => {
        const ledger = JSON.parse(await fs.readFile(path.join(ROOT, '.danteforge', 'evidence-novelty.json'), 'utf8').catch(() => '[]'));
        const attempts = ledger.filter((a: { dimId: string }) => a.dimId === 'a').length;
        const ceiling = await fs.readFile(path.join(ROOT, '.danteforge', 'ceilings', 'a.json'), 'utf8').then(JSON.parse).catch(() => null);
        return [{ ...dim({ id: 'a', effectiveScore: 8.0 }), attempts, ceiling }];
      },
      _runPushTo9: async (): Promise<PushResult> => {
        pushN++;
        return { verdict: 'REJECTED', courtRan: true, fingerprint: { dimId: 'a', command: 'run', artifactPath: 'art', gitSha: `sha-${pushN}` } }; // fresh SHA → novel each time
      },
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done', 'after 2 rejected attempts the dim is ceilinged → all complete');
    assert.equal(pushN, 2, 'exactly maxAttempts pushes, then generator-ceiling');
    // A generator-ceiling receipt was written for the dim.
    const ceiling = JSON.parse(await fs.readFile(path.join(ROOT, '.danteforge', 'ceilings', 'a.json'), 'utf8'));
    assert.equal(ceiling.cause, 'generator-ceiling');
  });

  test('an UN-BUILDABLE dim (stuck below 7) is ceilinged after the stall cap → loop reaches DONE (the field bug)', async () => {
    const dir = path.join(ROOT, 'stuck');
    let builds = 0;
    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 10, maxBuildAttempts: 2,
      _buildState: async () => {
        const ceiling = await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'go_dim.json'), 'utf8').then(JSON.parse).catch(() => null);
        return [{ ...dim({ id: 'go_dim', effectiveScore: 6.0 }), ceiling }]; // never reaches 7 (e.g. Go, no network)
      },
      _runBuildTo7: async () => { builds++; }, // build runs but the dim can't advance
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done', 'the loop signs a ceiling and completes — it does NOT spin to max-cycles');
    assert.equal(builds, 2, 'exactly maxBuildAttempts build attempts, then a stall-ceiling');
    const ceiling = JSON.parse(await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'go_dim.json'), 'utf8'));
    assert.equal(ceiling.cause, 'generator-ceiling');
    assert.match(ceiling.detail, /build attempts/);
  });

  test('a perpetually-needsSetup dim is ceilinged after the cap → loop is never wedged (DanteCode bug)', async () => {
    const dir = path.join(ROOT, 'setupstuck');
    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 10, maxBuildAttempts: 2,
      _buildState: async () => {
        const ceiling = await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 's.json'), 'utf8').then(JSON.parse).catch(() => null);
        return [{ ...dim({ id: 's', effectiveScore: 9.0, frontierStatus: 'none' as const, needsSetup: true }), ceiling }];
      },
      _runSetup: async () => {}, // setup runs but never clears needsSetup
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done', 'one stuck-setup dim no longer blocks the entire loop forever');
  });

  test('--parallel mode fans the push across members (each builds a different dim concurrently)', async () => {
    const dir = path.join(ROOT, 'par');
    const pushedBy: Record<string, string> = {};
    let rounds = 0;
    const r = await runAscendFrontier({
      cwd: dir, parallel: true, maxCycles: 3,
      _buildState: async () => {
        // After round 1, all three are validated → done. Before, three frozen dims at 8.0.
        if (rounds >= 1) return ['a', 'b', 'c'].map(id => ({ ...dim({ id, effectiveScore: 9.0, frontierStatus: 'validated' as const }) }));
        return ['a', 'b', 'c'].map(id => ({ ...dim({ id, effectiveScore: 8.0 }) }));
      },
      _discoverMembers: async () => ['codex', 'claude-code', 'grok-build'],
      _buildAll: async () => { rounds = 1; },
      _promoteOne: async (_cwd, asg) => {
        pushedBy[asg.dimId] = asg.memberId;
        return { dimId: asg.dimId, builderId: asg.memberId, verdict: 'VALIDATED', passedByJudges: ['codex', 'claude-code', 'grok-build'].filter(m => m !== asg.memberId) };
      },
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done');
    // Each of the 3 dims was pushed by a DIFFERENT member in the same round.
    assert.deepEqual(Object.keys(pushedBy).sort(), ['a', 'b', 'c']);
    assert.equal(new Set(Object.values(pushedBy)).size, 3, 'three distinct member-builders');
  });

  test('a non-novel push (no new evidence) is ceilinged immediately (anti-grind)', async () => {
    const dir = path.join(ROOT, 'nn');
    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 5,
      _buildState: async () => {
        const ceiling = await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'a.json'), 'utf8').then(JSON.parse).catch(() => null);
        return [{ ...dim({ id: 'a', effectiveScore: 8.0 }), ceiling }];
      },
      // Same fingerprint every push (no new SHA) — must be caught as non-novel after the first record.
      _runPushTo9: async (): Promise<PushResult> => ({ verdict: 'REJECTED', courtRan: true, fingerprint: { dimId: 'a', command: 'run', artifactPath: 'art', gitSha: 'SAME' } }),
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done');
    const ceiling = JSON.parse(await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'a.json'), 'utf8'));
    assert.equal(ceiling.failedGates[0], 'evidence-novelty');
  });

  test('a spec-incomplete push writes an ACTIONABLE ceiling (not build-failed, no churn) and ends the dim honestly', async () => {
    const dir = path.join(ROOT, 'specinc');
    let pushN = 0;
    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 5,
      _buildState: async () => {
        const ceiling = await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'a.json'), 'utf8').then(JSON.parse).catch(() => null);
        return [{ ...dim({ id: 'a', effectiveScore: 8.0 }), ceiling }];
      },
      // The dim's frontier_spec is missing genuinely-human fields → the push returns an actionable
      // ceiling (NOT courtRan, NOT a build crash). The loop must record THAT, not a build-failed.
      _runPushTo9: async (): Promise<PushResult> => {
        pushN++;
        return {
          verdict: 'REJECTED', courtRan: false,
          ceiling: { cause: 'spec-incomplete', detail: 'a held below 9.0 — author observed_capability | observable_artifacts' },
          fingerprint: { dimId: 'a', command: 'node dist/index.js plan', artifactPath: '', gitSha: 'sha' },
        };
      },
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done', 'the actionable ceiling ends the dim → loop completes');
    assert.equal(pushN, 1, 'one push writes the ceiling immediately — no build-failed churn');
    const ceiling = JSON.parse(await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'a.json'), 'utf8'));
    assert.equal(ceiling.cause, 'spec-incomplete', 'recorded as spec-incomplete, not build-failed');
    assert.match(ceiling.detail, /observed_capability/, 'the ceiling names the exact missing work');
    assert.ok(ceiling.reviewAfter, 're-openable once the operator authors the spec');
  });
});

// ── Phase A bootstrap (cold repo define) ──────────────────────────────────────

function minimalMatrix(): CompeteMatrix {
  return {
    project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [],
    lastUpdated: '2026-06-09T00:00:00.000Z', overallSelfScore: 0, dimensions: [],
  };
}

async function writeMatrixFile(dir: string): Promise<void> {
  const matrixPath = path.join(dir, '.danteforge', 'compete', 'matrix.json');
  await fs.mkdir(path.dirname(matrixPath), { recursive: true });
  await fs.writeFile(matrixPath, JSON.stringify(minimalMatrix()), 'utf8');
}

describe('ascend-frontier — Phase A bootstrap (cold repo define)', () => {
  test('no matrix: define runs FIRST (non-interactive), then the loop proceeds with the seamed state', async () => {
    const dir = path.join(ROOT, 'cold');
    const defineCalls: { cwd?: string; interactive?: boolean }[] = [];
    const r = await runAscendFrontier({
      cwd: dir,
      _defineUniverse: async (opts) => { defineCalls.push({ cwd: opts.cwd, interactive: opts.interactive }); return minimalMatrix(); },
      _buildState: async () => [dim({ id: 'a', effectiveScore: 9.0, frontierStatus: 'validated' })],
      _now: () => '2026-06-09T00:00:00.000Z',
    });
    assert.equal(defineCalls.length, 1, 'define ran exactly once');
    assert.equal(defineCalls[0]!.interactive, false, 'NEVER prompts — the orchestrator contract');
    assert.equal(defineCalls[0]!.cwd, dir);
    assert.equal(r.actions[0], 'define(bootstrap)', 'define is recorded as the first action');
    assert.equal(r.terminal, 'done', 'after define, the loop proceeds and terminates normally');
  });

  test('--no-bootstrap on a cold repo fails CLEANLY naming the remedy; define is NOT called', async () => {
    const dir = path.join(ROOT, 'coldnb');
    let defined = 0;
    const r = await runAscendFrontier({
      cwd: dir, bootstrap: false,
      _defineUniverse: async () => { defined++; return minimalMatrix(); },
    });
    assert.equal(r.terminal, 'failed');
    assert.equal(defined, 0, 'define must NOT run under --no-bootstrap');
    assert.match(r.summary, /no compete matrix/i);
    assert.match(r.summary, /--no-bootstrap/, 'the failure explains what blocked the run');
    assert.match(r.summary, /ascend|matrix-orchestrate/, 'the failure names the remedy');
  });

  test('define failure → terminal failed with the UNDERLYING reason (not a swallowed retry spin)', async () => {
    const dir = path.join(ROOT, 'coldfail');
    const r = await runAscendFrontier({
      cwd: dir,
      _defineUniverse: async () => { throw new Error('competitor scan exploded'); },
      _now: () => '2026-06-09T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'failed');
    assert.match(r.summary, /competitor scan exploded/, 'the real reason surfaces in the terminal summary');
  });

  test('matrix present: define is never called', async () => {
    const dir = path.join(ROOT, 'warm');
    await writeMatrixFile(dir);
    let defined = 0;
    const r = await runAscendFrontier({
      cwd: dir,
      _defineUniverse: async () => { defined++; return minimalMatrix(); },
      _buildState: async () => [dim({ id: 'a', effectiveScore: 9.0, frontierStatus: 'validated' })],
      _now: () => '2026-06-09T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done');
    assert.equal(defined, 0, 'an existing matrix must never be re-defined');
  });

  test('dry-run on a cold repo REPORTS define would run — no crash, nothing executed, no ledger', async () => {
    const dir = path.join(ROOT, 'colddry');
    let defined = 0;
    const r = await runAscendFrontier({
      cwd: dir, dryRun: true,
      _defineUniverse: async () => { defined++; return minimalMatrix(); },
      _now: () => '2026-06-09T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'dry-run');
    assert.match(r.actions[0]!, /define/, 'dry-run names define as the next action');
    assert.equal(defined, 0, 'dry-run must not execute define');
    assert.equal(r.runId, undefined, 'dry-run stays read-only (no run ledger)');
  });

  test('matrix-orchestrate detect/discover artifacts seed the define call (cold-start wiring)', async () => {
    const dir = path.join(ROOT, 'coldseed');
    const orch = path.join(dir, '.danteforge', 'matrix-orchestration');
    await fs.mkdir(orch, { recursive: true });
    await fs.writeFile(path.join(orch, 'project-intent.json'), JSON.stringify({ projectName: 'p', goal: 'A CLI that forges agents' }), 'utf8');
    await fs.writeFile(path.join(orch, 'competitive-universe.json'), JSON.stringify({ entries: [
      { name: 'aider', recommendedAction: 'harvest' },
      { name: 'continue.dev', recommendedAction: 'profile' },
      { name: 'ignored-tool', recommendedAction: 'skip' },
      { name: 'aider', recommendedAction: 'observe' }, // duplicate — must dedupe
    ] }), 'utf8');
    let seen: { seedProjectDescription?: string; seedCompetitors?: string[] } | null = null;
    const r = await runAscendFrontier({
      cwd: dir,
      _defineUniverse: async (opts) => {
        seen = { seedProjectDescription: opts.seedProjectDescription, seedCompetitors: opts.seedCompetitors };
        return minimalMatrix();
      },
      _buildState: async () => [dim({ id: 'a', effectiveScore: 9.0, frontierStatus: 'validated' })],
      _now: () => '2026-06-09T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done');
    assert.ok(seen, 'define received the seeds');
    assert.equal(seen!.seedProjectDescription, 'A CLI that forges agents');
    assert.deepEqual(seen!.seedCompetitors, ['aider', 'continue.dev'], 'skip entries excluded, duplicates removed');
  });
});
