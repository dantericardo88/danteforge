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
  test('non-zero exit → parseError even if stdout has JSON', () => {
    const r = parseCourtOutput({ ok: false, stdout: '{"result":{"verdict":"VALIDATED"}}' });
    assert.equal(r.parseError, true, 'a failed command can never be read as a pass');
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
