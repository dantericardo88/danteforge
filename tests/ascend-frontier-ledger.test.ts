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
        return { verdict: 'REJECTED', fingerprint: { dimId: 'd', command: 'run', artifactPath: 'art', gitSha: `sha-${pushN}` } };
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

  test('dry-run writes NO ledger (read-only)', async () => {
    const dir = path.join(ROOT, 'dry');
    const r = await runAscendFrontier({
      cwd: dir, dryRun: true,
      _buildState: async () => [dim({ id: 'a', effectiveScore: 7.0 })],
      _runPushTo9: async () => ({ verdict: 'REJECTED', fingerprint: { dimId: 'a', command: 'x', artifactPath: 'y', gitSha: 's' } }),
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
