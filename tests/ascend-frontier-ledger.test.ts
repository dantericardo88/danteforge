import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runAscendFrontier, type PushResult } from '../src/cli/commands/ascend-frontier.js';
import { parseCourtOutput } from '../src/cli/commands/ascend-frontier-runner.js';
import { loadRunBundle, listRuns } from '../src/core/run-ledger.js';
import { runFrontierAudit } from '../src/cli/commands/frontier-audit.js';
import type { DimState } from '../src/core/ascend-frontier-engine.js';

const ROOT = path.join('X:\\tmp', `ascend-ledger-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

function dim(over: Partial<DimState> = {}): DimState {
  return { id: 'd', effectiveScore: 8.0, frontierStatus: 'frozen', ceiling: null, attempts: 0, isMarketCapped: false, ...over };
}

describe('parseCourtOutput — court output is read honestly (G3)', () => {
  test('a clean VALIDATED verdict parses with no parseError', () => {
    const r = parseCourtOutput({ ok: true, stdout: 'noise\n{"result":{"verdict":"VALIDATED","judges":[{"verdict":"PASS","judgeId":"codex"}]}}' });
    assert.equal(r.verdict, 'VALIDATED');
    assert.deepEqual(r.passedByJudges, ['codex']);
    assert.equal(r.parseError, false);
  });
  test('empty stdout → parseError (NOT a clean rejection)', () => {
    const r = parseCourtOutput({ ok: true, stdout: '' });
    assert.equal(r.verdict, 'REJECTED');
    assert.equal(r.parseError, true);
  });
  test('non-zero exit → parseError even if stdout has JSON claiming VALIDATED', () => {
    const r = parseCourtOutput({ ok: false, stdout: '{"result":{"verdict":"VALIDATED"}}' });
    assert.equal(r.parseError, true, 'a failed command can never be read as a pass');
  });
  test('non-zero exit with a complete REJECTED verdict IS a court that ran (live pilot pin)', () => {
    // frontier-review exits 1 on an honest REJECTED by design — booking it as "court did not
    // run" (the old !ok short-circuit) misfiled every honest rejection as a build failure.
    const r = parseCourtOutput({ ok: false, stdout: '{"result":{"verdict":"REJECTED","judges":[{"verdict":"FAIL","judgeId":"codex"}]}}' });
    assert.equal(r.parseError, false, 'an honest rejection must reach the attempt ledger');
    assert.equal(r.verdict, 'REJECTED');
  });
  test('non-zero exit with JSON but NO verdict field → parseError (crash mid-print)', () => {
    const r = parseCourtOutput({ ok: false, stdout: '{"result":{}}' });
    assert.equal(r.parseError, true);
  });
});

describe('stale-brain guard — a rebuilt engine never silently runs stale (CH-012 pin)', () => {
  test('newer dist than launch baseline → restart requested; missing stats / same build → keep running', async () => {
    const { engineUpdated } = await import('../src/cli/commands/ascend-frontier.js');
    assert.equal(engineUpdated(1000, 5000), true, 'dist rebuilt after launch → stale');
    assert.equal(engineUpdated(1000, 1500), false, 'sub-second jitter is not a rebuild');
    assert.equal(engineUpdated(1000, 1000), false, 'same build → keep running');
    assert.equal(engineUpdated(null, 5000), false, 'no baseline (tsx/test run) → check disabled');
    assert.equal(engineUpdated(1000, null), false, 'unreadable current stat → never false-fire');
  });
});

describe('budget-window awareness — the loop pauses instead of burning cycles (self-challenge #7)', () => {
  test('parses the live limit error and schedules the NEXT occurrence of the stated time + margin', async () => {
    const { noteBudgetLimit, getBudgetPauseUntil, clearBudgetPause } = await import('../src/cli/commands/ascend-frontier-runner.js');
    clearBudgetPause();
    // 3pm "now"; the error names 7:10pm → today 19:12 (2-min margin).
    const now = new Date(); now.setHours(15, 0, 0, 0);
    const t = noteBudgetLimit("You've hit your session limit · resets 7:10pm (America/New_York)", now.getTime());
    assert.ok(t !== null);
    const at = new Date(t!);
    assert.equal(at.getHours(), 19); assert.equal(at.getMinutes(), 12);
    // 11pm "now": 7:10pm already passed → tomorrow.
    clearBudgetPause();
    const late = new Date(); late.setHours(23, 0, 0, 0);
    const t2 = noteBudgetLimit('session limit · resets 7:10pm', late.getTime())!;
    assert.ok(t2 > late.getTime() + 19 * 3600_000, 'rolls to the next day');
    // Non-limit output records nothing; repeated reports keep the LATEST reset.
    clearBudgetPause();
    assert.equal(noteBudgetLimit('ordinary build failure: exit 1', Date.now()), null);
    assert.equal(getBudgetPauseUntil(), null);
    clearBudgetPause();
  });
});

describe('provider-outage awareness — outages PAUSE, never mint permanent ceilings (CH-019)', () => {
  test('detectProviderOutage: claude timed, codex timed, untimed, and clean build all classify correctly', async () => {
    const { detectProviderOutage } = await import('../src/core/provider-outage.js');
    const now = new Date(); now.setHours(15, 0, 0, 0);
    // claude phrasing (timed): resolves to the named reset.
    const claude = detectProviderOutage("You've hit your session limit · resets 7:10pm (America/New_York)", now.getTime());
    assert.equal(claude.outage, true);
    assert.ok(claude.resumeAtMs !== null);
    assert.equal(new Date(claude.resumeAtMs!).getHours(), 19);
    // codex phrasing (timed): "usage limit … try again at 8:45 PM".
    const codex = detectProviderOutage('ERROR: You have hit your usage limit. Please try again at 8:45 PM.', now.getTime());
    assert.equal(codex.outage, true);
    assert.ok(codex.resumeAtMs !== null);
    assert.equal(new Date(codex.resumeAtMs!).getHours(), 20);
    assert.equal(new Date(codex.resumeAtMs!).getMinutes(), 47);
    // untimed outage: real signature, no parseable time → resumeAtMs null (caller backs off).
    const untimed = detectProviderOutage('error: authentication failed (401 Unauthorized)', now.getTime());
    assert.equal(untimed.outage, true);
    assert.equal(untimed.resumeAtMs, null);
    // ordinary build/test output must NOT be read as an outage.
    assert.equal(detectProviderOutage('FAIL tests/foo.test.ts — expected 3, got 4 (exit 1)', now.getTime()).outage, false);
    assert.equal(detectProviderOutage('compiled 412 files; rate of 2000 lines/s', now.getTime()).outage, false);
  });

  test('parseCourtOutput flags all-abstained (every judge UNCLEAR) — NOT a clean rejection', () => {
    const allUnclear = parseCourtOutput({ ok: false, stdout: '{"result":{"verdict":"REJECTED","judges":[{"verdict":"UNCLEAR","judgeId":"codex"},{"verdict":"UNCLEAR","judgeId":"claude-code"}]}}' });
    assert.equal(allUnclear.parseError, false, 'the court ran — the JSON is complete');
    assert.equal(allUnclear.allAbstained, true, 'all judges abstained → outage/can-not-tell, never a no');
    // A genuine REJECTED carries ≥1 FAIL → not all-abstained.
    const realReject = parseCourtOutput({ ok: false, stdout: '{"result":{"verdict":"REJECTED","judges":[{"verdict":"FAIL","judgeId":"codex"},{"verdict":"UNCLEAR","judgeId":"claude-code"}]}}' });
    assert.equal(realReject.allAbstained, false);
    // A clean PASS → not all-abstained.
    const pass = parseCourtOutput({ ok: true, stdout: '{"result":{"verdict":"VALIDATED","judges":[{"verdict":"PASS","judgeId":"codex"}]}}' });
    assert.equal(pass.allAbstained, false);
  });

  test('noteProviderOutage sets the pause AND raises the cycle marker; consume clears it', async () => {
    const { noteProviderOutage, getBudgetPauseUntil, clearBudgetPause, peekPendingOutage, consumePendingOutage, clearPendingOutage } =
      await import('../src/cli/commands/ascend-frontier-runner.js');
    clearBudgetPause(); clearPendingOutage();
    const now = Date.now();
    // An untimed outage pauses for the default backoff window and raises the marker.
    const o = noteProviderOutage('ERROR: usage limit reached for this account', now);
    assert.ok(o && o.outage);
    assert.ok(getBudgetPauseUntil()! > now, 'a pause is scheduled');
    assert.ok(peekPendingOutage(), 'the cycle marker is raised (orchestrator skips ceiling accounting)');
    assert.ok(consumePendingOutage(), 'consume returns the marker');
    assert.equal(peekPendingOutage(), null, 'consume cleared it');
    // Ordinary output raises nothing.
    clearBudgetPause(); clearPendingOutage();
    assert.equal(noteProviderOutage('build OK, 0 errors', Date.now()), null);
    assert.equal(peekPendingOutage(), null);
    clearBudgetPause(); clearPendingOutage();
  });
});

describe('judge lease is READ-ONLY — a reviewer never holds the builders write lease (CH-017)', () => {
  test('makeJudgeLease has empty allowedWritePaths while makeLease (builder) grants src/tests', async () => {
    const { makeLease, makeJudgeLease } = await import('../src/cli/commands/council.js');
    const builder = makeLease(process.cwd()) as unknown as { allowedWritePaths: string[] };
    const judge = makeJudgeLease(process.cwd()) as unknown as { allowedWritePaths: string[]; allowedReadPaths: string[] };
    assert.ok(builder.allowedWritePaths.length > 0, 'a builder can write');
    assert.deepEqual(judge.allowedWritePaths, [], 'a judge can write NOTHING — it only audits');
    assert.ok(judge.allowedReadPaths.includes('**'), 'a judge can still read the whole tree to review it');
  });
});

describe('ladder remediation — the last permanently-human 8→9 step made autonomous', () => {
  test('routing: research fires ONLY for a never-researched bar (zero rubric rows + ladder-seeded field named)', async () => {
    const { isLadderBlocked } = await import('../src/cli/commands/ascend-frontier-push.js');
    assert.equal(isLadderBlocked(['leader_target.observed_capability is empty/TODO — state the specific capability the leader has.'], 0), true);
    assert.equal(isLadderBlocked(['real_user_path.observable_artifacts is empty/TODO — declare at least one real artifact the run produces.'], 0), false,
      'artifact/input failures are authoring work — a 10-minute council research must not fire for them');
    assert.equal(isLadderBlocked(['leader_target.observed_capability is empty/TODO'], 9), false,
      'rubric rows exist → the bar WAS researched; an unseeded field is an init problem, not a research problem');
  });

  test('failed research keeps the honest ceiling (returns null, never invents a bar)', async () => {
    const { remediateLadderIfBlocked } = await import('../src/cli/commands/ascend-frontier-push.js');
    const dir = path.join(ROOT, 'ladder-fail');
    await fs.mkdir(dir, { recursive: true }); // no universe dir → zero rubric rows
    const out = await remediateLadderIfBlocked(dir, 'some_dim',
      ['leader_target.observed_capability is empty/TODO'],
      async () => ({ ok: false, reason: 'no council member available' }));
    assert.equal(out, null, 'research failure → no spec mutation, the spec-incomplete ceiling stands');
  });

  test('researchDimLadder verifies USABLE ladder rows — an empty research result fails loudly', async () => {
    const { researchDimLadder } = await import('../src/matrix/engines/ladder-research.js');
    const dir = path.join(ROOT, 'ladder-verify');
    const uniDir = path.join(dir, '.danteforge', 'compete', 'universe');
    await fs.mkdir(uniDir, { recursive: true });
    await fs.mkdir(path.join(dir, '.danteforge', 'compete'), { recursive: true });
    await fs.writeFile(path.join(dir, '.danteforge', 'compete', 'matrix.json'),
      JSON.stringify({ project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0, dimensions: [{ id: 'dim_x', label: 'X', weight: 1, scores: { self: 8 }, gap_to_leader: 1, leader: 'c', status: 'in-progress', sprint_history: [] }] }), 'utf8');

    // Phase "succeeds" but writes a ladder-less universe file → must fail (bar still missing).
    const noLadder = await researchDimLadder({ cwd: dir, dimId: 'dim_x',
      _runPhase: async () => { await fs.writeFile(path.join(uniDir, 'dim_x.md'), '# notes only\n', 'utf8'); return { written: ['dim_x'] }; } });
    assert.equal(noLadder.ok, false);
    assert.match(noLadder.reason, /no usable/i);

    // Phase writes REAL ladder rows → ok.
    const withLadder = await researchDimLadder({ cwd: dir, dimId: 'dim_x',
      _runPhase: async () => { await fs.writeFile(path.join(uniDir, 'dim_x.md'), '## Score Ladder\n| Score | What it looks like |\n|---|---|\n| 8 | Kiro-grade gates |\n| 9 | LangGraph-grade PDSE |\n', 'utf8'); return { written: ['dim_x'] }; } });
    assert.equal(withLadder.ok, true);
    assert.match(withLadder.reason, /2 rows/);

    // Phase wrote NOTHING for this dim → fail, never invented.
    const nothing = await researchDimLadder({ cwd: dir, dimId: 'dim_x', _runPhase: async () => ({ written: [] }) });
    assert.equal(nothing.ok, false);
  });
});

describe('defaultBuildState — cause-aware ceiling re-opening (fleet run 3d pin)', () => {
  test('a spec-incomplete ceiling is RESOLVED once the spec is frozen; a draft-spec ceiling stays', async () => {
    // Live failure: run 3d exited after ZERO cycles — every dim sat behind a stale spec-incomplete
    // ceiling written before the specs were authored+frozen. The ceiling names the missing work;
    // once that work is verifiably done, holding it until reviewAfter starves the loop.
    const { defaultBuildState } = await import('../src/cli/commands/ascend-frontier.js');
    const dir = path.join(ROOT, 'reopen');
    await fs.mkdir(path.join(dir, '.danteforge', 'compete'), { recursive: true });
    await fs.mkdir(path.join(dir, '.danteforge', 'ceilings'), { recursive: true });
    const spec = (status: string) => ({
      version: 1, target_score: 9, status,
      leader_target: { competitor: 'c', score: 9, observed_capability: 'real' },
      real_user_path: { required_callsite: 'src/a.ts', run_command: 'node dist/index.js x', observable_artifacts: [{ kind: 'file', path: 'out.json' }], realistic_inputs: ['a', 'b'] },
      required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
    });
    await fs.writeFile(path.join(dir, '.danteforge', 'compete', 'matrix.json'), JSON.stringify({
      project: 'reopen', competitors: [], competitors_closed_source: [], competitors_oss: [],
      lastUpdated: new Date().toISOString(), overallSelfScore: 8,
      dimensions: [
        { id: 'frozen_dim', label: 'f', weight: 1, scores: { self: 8 }, gap_to_leader: 1, leader: 'c', status: 'in-progress', sprint_history: [], frontier_spec: spec('frozen'), capability_test: { command: 'echo x' }, outcomes: [{ id: 'o1', tier: 'T5', kind: 'shell', command: 'echo y' }] },
        { id: 'draft_dim', label: 'd', weight: 1, scores: { self: 8 }, gap_to_leader: 1, leader: 'c', status: 'in-progress', sprint_history: [], frontier_spec: spec('draft'), capability_test: { command: 'echo x' }, outcomes: [{ id: 'o2', tier: 'T5', kind: 'shell', command: 'echo y' }] },
      ],
    }), 'utf8');
    const tomorrow = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const receipt = (dimId: string) => JSON.stringify({ dimId, cap: 8, cause: 'spec-incomplete', detail: 'author the spec', failedGates: ['spec-incomplete'], recordedAt: new Date().toISOString(), reviewAfter: tomorrow });
    await fs.writeFile(path.join(dir, '.danteforge', 'ceilings', 'frozen_dim.json'), receipt('frozen_dim'), 'utf8');
    await fs.writeFile(path.join(dir, '.danteforge', 'ceilings', 'draft_dim.json'), receipt('draft_dim'), 'utf8');

    const state = await defaultBuildState(dir);
    const frozen = state.find(s => s.id === 'frozen_dim')!;
    const draft = state.find(s => s.id === 'draft_dim')!;
    assert.equal(frozen.ceiling, null, 'frozen spec = the named work is DONE — ceiling resolved, push re-opens');
    assert.ok(draft.ceiling, 'draft spec = the named work is NOT done — ceiling honestly stands');
  });
  test('garbage after the brace → parseError', () => {
    const r = parseCourtOutput({ ok: true, stdout: '{not json at all' });
    assert.equal(r.parseError, true);
  });
});

describe('ascend-frontier run-ledger — the orchestrator leaves an auditable receipt (G4)', () => {
  test('a real run writes .danteforge/runs/<runId>/ with the court verdict + ceiling receipt', async () => {
    const dir = path.join(ROOT, 'ledger');
    let pushN = 0;
    const r = await runAscendFrontier({
      cwd: dir, maxAttemptsPerDim: 1, maxCycles: 10,
      _buildState: async () => {
        const ledger = JSON.parse(await fs.readFile(path.join(dir, '.danteforge', 'evidence-novelty.json'), 'utf8').catch(() => '[]'));
        const attempts = ledger.filter((a: { dimId: string }) => a.dimId === 'd').length;
        const ceiling = await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'd.json'), 'utf8').then(JSON.parse).catch(() => null);
        return [{ ...dim({ id: 'd', effectiveScore: 8.0 }), attempts, ceiling }];
      },
      _runPushTo9: async (): Promise<PushResult> => {
        pushN++;
        return { verdict: 'REJECTED', courtRan: true, fingerprint: { dimId: 'd', command: 'run', artifactPath: 'art', gitSha: `sha-${pushN}` } };
      },
      _now: () => '2026-06-03T00:00:00.000Z',
    });

    assert.equal(r.terminal, 'done');
    assert.ok(r.runId, 'a run that executed cycles must surface its runId');

    const runs = await listRuns(dir);
    assert.ok(runs.includes(r.runId!), 'listRuns finds the recorded run');

    const bundle = await loadRunBundle(r.runId!, dir);
    assert.ok(bundle, 'the bundle is on disk');
    // The court verdict was recorded as a gate check…
    assert.ok(bundle!.gates.some(g => g.gateName.startsWith('frontier-court:') && g.status === 'fail'), 'the REJECT is in the ledger');
    // …and the generator-ceiling as a receipt.
    assert.ok(bundle!.receipts.some(rc => rc.type === 'ceiling'), 'the ceiling is in the ledger');
    // Cycle events were logged.
    assert.ok(bundle!.events.some(e => e.eventType === 'cycle'), 'per-cycle events recorded');
  });

  test('a push whose court NEVER RAN is recorded as build-failed, NOT a fabricated court rejection (the fleet integrity bug)', async () => {
    const dir = path.join(ROOT, 'courtless');
    let pushN = 0;
    const r = await runAscendFrontier({
      cwd: dir, maxBuildAttempts: 2, maxCycles: 10,
      _buildState: async () => {
        const ceiling = await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'd.json'), 'utf8').then(JSON.parse).catch(() => null);
        return [{ ...dim({ id: 'd', effectiveScore: 8.0 }), ceiling }];
      },
      // The court never ran (build/evidence/command failed) — courtRan:false every time.
      _runPushTo9: async (): Promise<PushResult> => {
        pushN++;
        return { verdict: 'REJECTED', courtRan: false, fingerprint: { dimId: 'd', command: 'run', artifactPath: 'art', gitSha: `sha-${pushN}` } };
      },
      _now: () => '2026-06-03T00:00:00.000Z',
    });

    assert.equal(r.terminal, 'done', 'the loop still terminates (no spin) via an honest build-failed ceiling');
    assert.equal(pushN, 2, 'exactly maxBuildAttempts push attempts, then ceiling');

    // The ceiling cause is build-failed — NOT a fabricated generator-ceiling / court-rejected.
    const ceiling = JSON.parse(await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'd.json'), 'utf8'));
    assert.equal(ceiling.cause, 'build-failed', 'a court that never ran must NEVER be recorded as a court rejection');
    assert.notEqual(ceiling.cause, 'generator-ceiling');
    assert.ok(ceiling.reviewAfter, 'build-failed is re-attemptable (carries reviewAfter)');

    // CRITICAL: the evidence-novelty ledger has ZERO court attempts — the engine did not fabricate
    // "the court rejected" provenance from commands that never produced a verdict.
    const ledger = JSON.parse(await fs.readFile(path.join(dir, '.danteforge', 'evidence-novelty.json'), 'utf8').catch(() => '[]'));
    assert.equal(ledger.filter((a: { dimId: string }) => a.dimId === 'd').length, 0,
      'a court that never ran must not appear as a recorded court attempt');
  });

  test('a persistently-crashing cycle aborts with a VISIBLE finalized ledger — never a silent exit / empty run dir (the fleet 127 bug)', async () => {
    const dir = path.join(ROOT, 'crash');
    let builds = 0;
    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 20,
      _buildState: async () => [dim({ id: 'd', effectiveScore: 6.0 })], // below 7 → build-to-7
      _runBuildTo7: async () => { builds++; throw new Error('spawn ENOENT (simulated transient 127)'); },
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'failed', 'a persistent crash terminates as failed — not a silent process abort');
    assert.equal(builds, 3, 'the cycle is retried up to MAX_CONSECUTIVE_ERRORS before giving up');
    assert.ok(r.runId, 'a runId is surfaced even on failure');
    const bundle = await loadRunBundle(r.runId!, dir);
    assert.ok(bundle, 'the ledger is FINALIZED on crash — never the empty run dir the fleet saw');
    assert.ok(bundle!.events.some(e => e.eventType === 'cycle-error'), 'the failing cycle is recorded (visible), not swallowed');
    assert.equal(bundle!.verdict.status, 'failure');
  });

  test('a single transient cycle error does NOT abort the run — it recovers and continues', async () => {
    const dir = path.join(ROOT, 'transient');
    let builds = 0;
    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 20,
      _buildState: async () => (builds >= 1
        ? [dim({ id: 'd', effectiveScore: 9.0, frontierStatus: 'validated' })] // after the build, it's done
        : [dim({ id: 'd', effectiveScore: 6.0 })]),
      _runBuildTo7: async () => { builds++; if (builds === 1) throw new Error('transient spawn 127'); },
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done', 'the loop recovered from one transient error and completed honestly');
  });

  test('dry-run writes NO ledger (read-only)', async () => {
    const dir = path.join(ROOT, 'dry');
    const r = await runAscendFrontier({
      cwd: dir, dryRun: true,
      _buildState: async () => [dim({ id: 'a', effectiveScore: 7.0 })],
      _runPushTo9: async () => ({ verdict: 'REJECTED', courtRan: true, fingerprint: { dimId: 'a', command: 'x', artifactPath: 'y', gitSha: 's' } }),
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'dry-run');
    assert.equal(r.runId, undefined, 'dry-run never creates a run ledger');
    assert.deepEqual(await listRuns(dir), []);
  });
});

describe('frontier-audit — a failed audit is never a silent no-op (G5)', () => {
  test('--fail on a non-validated spec reports downgraded=false WITH a reason', async () => {
    const matrix = {
      project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [],
      lastUpdated: '', overallSelfScore: 0,
      dimensions: [{ id: 'd', scores: { self: 7 }, frontier_spec: { status: 'frozen' } }],
    };
    const r = await runFrontierAudit({
      cwd: path.join(ROOT, 'audit'), dimId: 'd', fail: true, reviewer: 'rich',
      _loadMatrix: async () => matrix as never,
      _saveMatrix: async () => { throw new Error('must NOT save when nothing to downgrade'); },
      _loadQueue: async () => [],
      _resolve: (async () => ({})) as never,
      _now: '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.resolved?.downgraded, false);
    assert.match(r.resolved?.reason ?? '', /not 'validated'|nothing to downgrade/);
  });
});
