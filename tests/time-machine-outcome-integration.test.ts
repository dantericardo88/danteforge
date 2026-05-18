import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runOneOutcome } from '../src/matrix/engines/outcome-runner.js';
import { runHardenGate } from '../src/matrix/engines/hardener.js';
import type { ShellOutcome } from '../src/matrix/types/outcome.js';
import type { MatrixDimension } from '../src/core/compete-matrix.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDim(overrides: Partial<MatrixDimension> & Record<string, unknown> = {}): MatrixDimension {
  return {
    id: 'test_dim',
    label: 'Test Dim',
    weight: 1,
    category: 'core',
    frequency: 'medium',
    scores: { self: 6 },
    gap_to_leader: 0, leader: 'self',
    gap_to_closed_source_leader: 0, closed_source_leader: 'self',
    gap_to_oss_leader: 0, oss_leader: 'self',
    status: 'in-progress',
    sprint_history: [],
    ...overrides,
  } as MatrixDimension;
}

function makeStore() {
  const store = new Map<string, string>();
  return {
    store,
    _readFile: async (p: string) => {
      const v = store.get(p);
      if (!v) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    _writeFile: async (p: string, d: string) => { store.set(p, d); },
    _exists: async (p: string) => store.has(p),
    _mkdir: async () => {},
  };
}

// ── outcome-runner Time Machine integration ──────────────────────────────────

describe('outcome-runner Time Machine integration', () => {
  it('records a Time Machine commit after writing evidence', async () => {
    const fs = makeStore();
    const tmCalls: Array<{ label: string; paths: string[] }> = [];
    const outcome: ShellOutcome = {
      id: 'compiles', tier: 'T1',
      description: 'tsc passes',
      command: 'node -e "process.exit(0)"',
    };
    await runOneOutcome({
      dimensionId: 'testing',
      outcome,
      cwd: '/p',
      forceCold: true,
      _spawn: () => ({ status: 0, stdout: '', stderr: '' }),
      _readGitSha: async () => 'abc123',
      ...fs,
      _createTimeMachineCommit: async (opts) => {
        tmCalls.push({ label: opts.label, paths: opts.paths });
        return {} as never;
      },
    });
    assert.equal(tmCalls.length, 1, 'should have called createTimeMachineCommit once');
    assert.match(tmCalls[0]!.label, /^outcome-evidence\/testing\/compiles\/T1\/pass$/);
    assert.equal(tmCalls[0]!.paths.length, 1);
  });

  it('records a fail-labeled commit when the outcome fails', async () => {
    const fs = makeStore();
    const tmCalls: Array<{ label: string }> = [];
    const outcome: ShellOutcome = {
      id: 'compiles', tier: 'T1',
      description: 'tsc passes',
      command: 'node -e "process.exit(1)"',
    };
    await runOneOutcome({
      dimensionId: 'testing',
      outcome,
      cwd: '/p',
      forceCold: true,
      _spawn: () => ({ status: 1, stdout: '', stderr: 'fail' }),
      _readGitSha: async () => 'abc123',
      ...fs,
      _createTimeMachineCommit: async (opts) => {
        tmCalls.push({ label: opts.label });
        return {} as never;
      },
    });
    assert.equal(tmCalls.length, 1);
    assert.match(tmCalls[0]!.label, /\/fail$/, 'label should end in /fail when outcome fails');
  });

  it('explicit null disables the integration (test seam contract)', async () => {
    const fs = makeStore();
    let calls = 0;
    const outcome: ShellOutcome = { id: 'a', tier: 'T1', description: 'x', command: 'node -e "0"' };
    await runOneOutcome({
      dimensionId: 'testing',
      outcome,
      cwd: '/p',
      forceCold: true,
      _spawn: () => ({ status: 0, stdout: '', stderr: '' }),
      _readGitSha: async () => 'abc123',
      ...fs,
      _createTimeMachineCommit: null,
    });
    assert.equal(calls, 0, 'no calls expected when seam is null');
  });

  it('TM crash does not block the outcome runner', async () => {
    const fs = makeStore();
    const outcome: ShellOutcome = { id: 'a', tier: 'T1', description: 'x', command: 'node -e "0"' };
    // The runner should swallow this exception and still return the evidence entry.
    const entry = await runOneOutcome({
      dimensionId: 'testing',
      outcome,
      cwd: '/p',
      forceCold: true,
      _spawn: () => ({ status: 0, stdout: '', stderr: '' }),
      _readGitSha: async () => 'abc123',
      ...fs,
      _createTimeMachineCommit: async () => { throw new Error('TM down'); },
    });
    assert.equal(entry.passed, true, 'outcome runner returns the entry even when TM crashes');
  });
});

// ── hardener Time Machine integration ────────────────────────────────────────

describe('hardener Time Machine integration', () => {
  it('records a Time Machine commit after a verdict (allowed)', async () => {
    const dim = makeDim();
    const tmCalls: Array<{ label: string }> = [];
    const verdict = await runHardenGate({
      dimensionId: dim.id,
      dim,
      cwd: '/p',
      _check: {
        'orphan-audit': async () => ({
          check: 'orphan-audit', passed: true, durationMs: 1, findings: [], scoreCap: 10,
        }),
      },
      _createTimeMachineCommit: async (opts) => {
        tmCalls.push({ label: opts.label });
        return {} as never;
      },
    });
    assert.equal(verdict.allowed, true);
    // The runHardenGate aggregator runs 5 checks but only writes ONE TM commit
    // for the final verdict (not per-check).
    assert.equal(tmCalls.length, 1);
    assert.match(tmCalls[0]!.label, /^harden-verdict\//);
    assert.match(tmCalls[0]!.label, /\/allowed$/);
  });

  it('records blocked-by label when a check fails', async () => {
    const dim = makeDim();
    const tmCalls: Array<{ label: string }> = [];
    await runHardenGate({
      dimensionId: dim.id,
      dim,
      cwd: '/p',
      _check: {
        'orphan-audit': async () => ({
          check: 'orphan-audit', passed: false, durationMs: 1,
          findings: [{ file: 'src/foo.ts', line: 1, snippet: '', reason: 'orphan' }],
          scoreCap: 6.0,
        }),
      },
      _createTimeMachineCommit: async (opts) => {
        tmCalls.push({ label: opts.label });
        return {} as never;
      },
    });
    assert.match(tmCalls[0]!.label, /blocked-by-orphan-audit/);
  });

  it('null seam disables, TM crash does not block', async () => {
    const dim = makeDim();
    // Null seam:
    let calls = 0;
    await runHardenGate({
      dimensionId: dim.id, dim, cwd: '/p',
      _createTimeMachineCommit: null,
    });
    assert.equal(calls, 0);

    // Crash:
    const v = await runHardenGate({
      dimensionId: dim.id, dim, cwd: '/p',
      _createTimeMachineCommit: async () => { throw new Error('TM down'); },
    });
    assert.ok(v.dimensionId === dim.id, 'verdict still returned even when TM crashes');
  });

  it('_noWrite suppresses both receipt and TM commit', async () => {
    const dim = makeDim();
    const tmCalls: Array<unknown> = [];
    await runHardenGate({
      dimensionId: dim.id, dim, cwd: '/p',
      _noWrite: true,
      _createTimeMachineCommit: async (opts) => { tmCalls.push(opts); return {} as never; },
    });
    assert.equal(tmCalls.length, 0, '_noWrite should also suppress TM commits');
  });
});
