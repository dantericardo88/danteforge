import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueAudit, loadAuditQueue, resolveAudit, type AuditEscrowEntry } from '../src/core/audit-escrow.js';
import { runFrontierAudit } from '../src/cli/commands/frontier-audit.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';
import type { FrontierSpec } from '../src/core/frontier-spec.js';

function entry(over: Partial<AuditEscrowEntry> = {}): AuditEscrowEntry {
  return {
    dimId: 'repo_level_context', kind: 'validated-9.0',
    replayCommand: 'node dist/index.js context inspect --project fixtures/real',
    artifacts: ['out/x.json'], frontierSpecHash: 'h1',
    receipts: [{ sessionId: 's1', passed: true, tier: 'T7' }],
    councilVote: { pass: 2, fail: 0, summary: '2P/0F' }, dissent: [],
    enqueuedAt: '2026-06-03T00:00:00.000Z', status: 'pending', ...over,
  };
}

describe('audit-escrow — non-blocking queue', () => {
  test('enqueue/load round-trip; pending filter', async () => {
    const store = new Map<string, string>();
    const write = async (p: string, c: string) => { store.set(p, c); };
    const readdir = async () => ['repo_level_context.json'];
    const read = async (p: string) => { const v = store.get(p); if (v === undefined) throw new Error('nf'); return v; };
    await enqueueAudit('/tmp/fake', entry(), write);
    const q = await loadAuditQueue('/tmp/fake', readdir, read);
    assert.equal(q.length, 1);
    assert.equal(q[0]!.status, 'pending');
  });

  test('resolveAudit marks the entry confirmed/failed with reviewer + note', async () => {
    const store = new Map<string, string>();
    const write = async (p: string, c: string) => { store.set(p, c); };
    const read = async (p: string) => { const v = store.get(p); if (v === undefined) throw new Error('nf'); return v; };
    await enqueueAudit('/tmp/fake', entry(), write);
    const updated = await resolveAudit('/tmp/fake', 'repo_level_context', { outcome: 'failed', reviewer: 'rich', note: 'fixture', nowIso: 't2' }, { _read: read, _write: write });
    assert.equal(updated.status, 'failed');
    assert.equal(updated.reviewer, 'rich');
    assert.equal(updated.resolutionNote, 'fixture');
  });
});

describe('frontier-audit CLI', () => {
  function matrixValidated(): CompeteMatrix {
    const spec: FrontierSpec = {
      version: 1, target_score: 9.0, status: 'validated',
      leader_target: { competitor: 'Cursor', score: 9.5, observed_capability: 'x' },
      real_user_path: { required_callsite: 'src/x.ts', run_command: 'run', observable_artifacts: [{ kind: 'json', path: 'out/x.json' }] },
      required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
    };
    return { dimensions: [{ id: 'repo_level_context', label: 'Repo', frontier_spec: spec }] } as unknown as CompeteMatrix;
  }

  test('list mode reports pending entries', async () => {
    const r = await runFrontierAudit({ _loadQueue: async () => [entry(), entry({ dimId: 'b', status: 'confirmed' })] });
    assert.equal(r.mode, 'list');
    assert.equal(r.pending?.length, 1, 'only pending shown');
  });

  test('--fail downgrades a validated dim to frozen (re-opens it) and resolves the entry', async () => {
    const m = matrixValidated();
    let saved: CompeteMatrix | null = null;
    const r = await runFrontierAudit({
      dimId: 'repo_level_context', fail: true, reviewer: 'rich', note: 'prepared fixture on audit',
      _loadMatrix: async () => m, _saveMatrix: async (mm) => { saved = mm; },
      _resolve: async () => entry({ status: 'failed' }),
      _now: '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.resolved?.outcome, 'failed');
    assert.equal(r.resolved?.downgraded, true);
    const dim = (saved as unknown as { dimensions: Array<{ frontier_spec: FrontierSpec }> })!.dimensions[0]!;
    assert.equal(dim.frontier_spec.status, 'frozen', 'validated → frozen re-caps the dim to 8.0');
  });

  test('--confirm leaves the dim validated', async () => {
    const m = matrixValidated();
    let saved = false;
    const r = await runFrontierAudit({
      dimId: 'repo_level_context', confirm: true, reviewer: 'rich',
      _loadMatrix: async () => m, _saveMatrix: async () => { saved = true; },
      _resolve: async () => entry({ status: 'confirmed' }),
    });
    assert.equal(r.resolved?.outcome, 'confirmed');
    assert.equal(r.resolved?.downgraded, false);
    assert.equal(saved, false);
  });

  test('requires exactly one of --confirm/--fail and a reviewer', async () => {
    await assert.rejects(() => runFrontierAudit({ dimId: 'x', confirm: true, fail: true, _resolve: async () => entry() }), /exactly one/);
    await assert.rejects(() => runFrontierAudit({ dimId: 'x', fail: true, _resolve: async () => entry() }), /reviewer/);
  });
});
