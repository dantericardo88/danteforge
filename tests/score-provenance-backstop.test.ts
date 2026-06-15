import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertScoreProvenance, writeVerifiedScore, preserveFrozenSpecs, stripUnverifiedValidations } from '../src/core/write-verified-score.js';
import { pruneRuns, RunLedger, listRuns } from '../src/core/run-ledger.js';
import type { CompeteMatrix, MatrixDimension } from '../src/core/compete-matrix.js';
import { signValidation, computeSpecHash, type FrontierSpec } from '../src/core/frontier-spec.js';

const ROOT = path.join('X:\\tmp', `provenance-backstop-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

function mkMatrix(self: number): CompeteMatrix {
  const dim = {
    id: 'd', name: 'D', weight: 1, frequency: 'medium',
    scores: { self, Cursor: 8 }, gap_to_leader: 8 - self, leader: 'Cursor',
    gap_to_closed_source_leader: 0, closed_source_leader: 'u', gap_to_oss_leader: 0, oss_leader: 'u',
    status: 'in-progress', sprint_history: [], next_sprint_target: 9,
  } as MatrixDimension;
  return {
    project: 'p', competitors: ['Cursor'], competitors_closed_source: ['Cursor'], competitors_oss: [],
    lastUpdated: '', overallSelfScore: self, dimensions: [dim],
  };
}

describe('assertScoreProvenance — the persistence-time backstop (closes the grep blind spot)', () => {
  test('a scores.self change WITH a matching provenance entry is accepted', () => {
    const prev = mkMatrix(6);
    const next = mkMatrix(6);
    writeVerifiedScore(next, 'd', 7.0, { agent: 'merge' }); // writes provenance + sets self=7
    const violations = assertScoreProvenance(prev, next);
    assert.deepEqual(violations, []);
  });

  test('a scores.self change with NO provenance is a violation (the aliasing / hand-edit case)', () => {
    const prev = mkMatrix(6);
    const next = mkMatrix(6);
    // Simulate an out-of-band mutation the grep-guard cannot see (alias / Object.assign / disk edit).
    (next.dimensions[0]!.scores as Record<string, number>)['self'] = 9.0;
    const violations = assertScoreProvenance(prev, next);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]!.dimId, 'd');
    assert.equal(violations[0]!.before, 6);
    assert.equal(violations[0]!.after, 9.0);
  });

  test('an unchanged score needs no provenance (status-only / outcome saves pass)', () => {
    const prev = mkMatrix(7);
    const next = mkMatrix(7);
    next.dimensions[0]!.status = 'closed';
    assert.deepEqual(assertScoreProvenance(prev, next), []);
  });

  test('first write (no previous matrix) is never blocked', () => {
    const next = mkMatrix(8);
    assert.deepEqual(assertScoreProvenance(null, next), []);
  });

  test('a newly-added dimension is not blocked (no prior value to guard)', () => {
    const prev = mkMatrix(6);
    const next = mkMatrix(6);
    next.dimensions.push({ ...next.dimensions[0]!, id: 'new', scores: { self: 9, Cursor: 8 } });
    assert.deepEqual(assertScoreProvenance(prev, next), []);
  });
});

describe('preserveFrozenSpecs — a frozen/validated frontier_spec is never silently wiped (D19 regression)', () => {
  function withSpec(self: number, status?: string): CompeteMatrix {
    const m = mkMatrix(self);
    (m.dimensions[0] as unknown as { frontier_spec?: unknown }).frontier_spec =
      status ? { status, leader_target: 'x', real_user_path: {} } : undefined;
    return m;
  }

  test('a rewrite that DROPS a frozen spec → it is re-attached', () => {
    const prev = withSpec(7, 'frozen');
    const next = withSpec(7, undefined);            // the destructive rewrite (frozen → gone)
    const restored = preserveFrozenSpecs(prev, next);
    assert.deepEqual(restored, ['d']);
    assert.equal((next.dimensions[0] as unknown as { frontier_spec?: { status?: string } }).frontier_spec?.status, 'frozen');
  });

  test('a validated spec is preserved too', () => {
    const prev = withSpec(9, 'validated');
    const next = withSpec(9, undefined);
    assert.deepEqual(preserveFrozenSpecs(prev, next), ['d']);
  });

  test('a legitimate validated→frozen downgrade (audit) is NOT touched — the spec object stays', () => {
    const prev = withSpec(9, 'validated');
    const next = withSpec(8, 'frozen');             // audit downgrade keeps the spec object
    assert.deepEqual(preserveFrozenSpecs(prev, next), []);
    assert.equal((next.dimensions[0] as unknown as { frontier_spec?: { status?: string } }).frontier_spec?.status, 'frozen');
  });

  test('a draft/none spec is not protected (only frozen/validated)', () => {
    const prev = withSpec(7, 'draft');
    const next = withSpec(7, undefined);
    assert.deepEqual(preserveFrozenSpecs(prev, next), []);
  });
});

describe('stripUnverifiedValidations — the persistence-time validated backstop (court-audit #10)', () => {
  function baseSpec(): FrontierSpec {
    return {
      version: 1, target_score: 9, status: 'validated',
      leader_target: { competitor: 'Cursor', score: 9, observed_capability: 'whole-repo map' },
      real_user_path: { required_callsite: 'src/x.ts', run_command: 'node dist/index.js x', observable_artifacts: [{ kind: 'json', path: 'o.json' }] },
      required_receipts: { min_t5_plus_outcomes: 1, min_distinct_sessions: 1, input_source: 'real-user-path' },
    } as FrontierSpec;
  }
  function matrixWithSpec(spec: FrontierSpec): CompeteMatrix {
    const m = mkMatrix(8);
    (m.dimensions[0] as unknown as { frontier_spec?: FrontierSpec }).frontier_spec = spec;
    return m;
  }

  test('a hand-set status:validated with NO receipt is demoted to frozen + receipt stripped', () => {
    const m = matrixWithSpec(baseSpec()); // forged: no frozen_hash, no validated_by
    assert.deepEqual(stripUnverifiedValidations(m), ['d']);
    const s = (m.dimensions[0] as unknown as { frontier_spec?: FrontierSpec }).frontier_spec!;
    assert.equal(s.status, 'frozen');
    assert.equal(s.validated_by, undefined);
  });

  test('a court-signed receipt survives untouched (validated persists)', () => {
    const spec = baseSpec();
    const hash = computeSpecHash(spec);
    spec.frozen_hash = hash;
    const judges = ['grok-build', 'gemini-cli'];
    spec.validated_by = { frozen_hash: hash, judge_member_ids: judges, validated_at: 'now', sig: signValidation('d', hash, judges) };
    const m = matrixWithSpec(spec);
    assert.deepEqual(stripUnverifiedValidations(m), [], 'a verifiable receipt is honored');
    assert.equal((m.dimensions[0] as unknown as { frontier_spec?: FrontierSpec }).frontier_spec!.status, 'validated');
  });

  test('a receipt forged for ANOTHER dim is stripped (dim-bound)', () => {
    const spec = baseSpec();
    const hash = computeSpecHash(spec);
    spec.frozen_hash = hash;
    const judges = ['grok-build', 'gemini-cli'];
    spec.validated_by = { frozen_hash: hash, judge_member_ids: judges, validated_at: 'now', sig: signValidation('OTHER', hash, judges) };
    assert.deepEqual(stripUnverifiedValidations(matrixWithSpec(spec)), ['d'], 'a cross-dim receipt does not verify');
  });
});

describe('pruneRuns — RunLedger bundles cannot grow unbounded', () => {
  test('keeps the newest N run dirs and removes the rest', async () => {
    const runsDir = path.join(ROOT, 'runs');
    await fs.mkdir(runsDir, { recursive: true });
    for (let i = 0; i < 6; i++) {
      await fs.mkdir(path.join(runsDir, `run-${i}`), { recursive: true });
      await fs.writeFile(path.join(runsDir, `run-${i}`, 'bundle.json'), '{}');
      await new Promise(r => setTimeout(r, 5)); // stagger mtimes
    }
    const removed = await pruneRuns(runsDir, 3);
    assert.equal(removed.length, 3, 'three oldest removed');
    const left = (await fs.readdir(runsDir, { withFileTypes: true })).filter(e => e.isDirectory());
    assert.equal(left.length, 3);
  });

  test('logCommand is crash-durable — the failing command lands on disk BEFORE finalize (DS-024)', async () => {
    const cwd = path.join(ROOT, 'durable');
    const ledger = new RunLedger('ascend-frontier', [], cwd);
    await ledger.initialize();
    ledger.logCommand('danteforge', ['harden-crusade', '--parallel', '4'], 127, 1234, undefined, 'EPIPE: broken pipe');
    // Give the fire-and-forget append a tick to flush.
    await new Promise(r => setTimeout(r, 50));
    // The run is NOT finalized — simulate a hard crash. The command history must still be on disk.
    const live = await fs.readFile(path.join(cwd, '.danteforge', 'runs', ledger.getRunId(), 'commands-live.jsonl'), 'utf8');
    const row = JSON.parse(live.trim().split('\n')[0]!);
    assert.equal(row.exitCode, 127, 'the exact failing exit code survives a crash');
    assert.deepEqual(row.args, ['harden-crusade', '--parallel', '4'], 'the exact failing argv survives a crash');
  });

  test('logEvent is hang-durable — events land on disk BEFORE finalize (an empty-on-hang run dir is fixed)', async () => {
    const cwd = path.join(ROOT, 'hangdurable');
    const ledger = new RunLedger('ascend-frontier', [], cwd);
    await ledger.initialize();
    ledger.logEvent('cycle', { cycle: 1, action: 'build-to-7(56 dims)' }); // then "hang" — never finalize
    await new Promise(r => setTimeout(r, 50));
    const live = await fs.readFile(path.join(cwd, '.danteforge', 'runs', ledger.getRunId(), 'events-live.jsonl'), 'utf8');
    const row = JSON.parse(live.trim().split('\n')[0]!);
    assert.equal(row.eventType, 'cycle', 'a hang still leaves a record of how far the run got');
    assert.equal(row.data.action, 'build-to-7(56 dims)');
  });

  test('finalize() prunes automatically (retention enforced end-to-end)', async () => {
    const cwd = path.join(ROOT, 'auto');
    // Seed 52 stale run dirs.
    const runsDir = path.join(cwd, '.danteforge', 'runs');
    await fs.mkdir(runsDir, { recursive: true });
    for (let i = 0; i < 52; i++) await fs.mkdir(path.join(runsDir, `stale-${i}`), { recursive: true });
    const ledger = new RunLedger('test', [], cwd);
    await ledger.initialize();
    await ledger.finalize({}, {}, { status: 'success', completionOracle: true });
    const runs = await listRuns(cwd);
    assert.ok(runs.length <= 50, `retention cap enforced (got ${runs.length})`);
  });
});
