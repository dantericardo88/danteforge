import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runSessionRecord, MIN_REAL_RUN_MS } from '../src/cli/commands/session-record.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

function makeMatrix(): CompeteMatrix {
  return {
    dimensions: [
      { id: 'forge', label: 'Forge', outcomes: [{ id: 'forge-t5-scaffold', tier: 'T5', command: 'exit 1', _scaffold: true }] },
    ],
  } as unknown as CompeteMatrix;
}

function base(matrix: CompeteMatrix, over: Partial<Parameters<typeof runSessionRecord>[0]> = {}) {
  return {
    cwd: '/tmp/fake', dimId: 'forge',
    run: 'node dist/index.js forge --project fixtures/sample',
    callsite: 'src/core/forge-engine.ts',
    artifact: 'fixtures/sample/out.md',
    _loadMatrix: async () => matrix,
    _writeMatrix: async () => { /* captured per-test */ },
    _runCommand: async () => ({ exitCode: 0, durationMs: MIN_REAL_RUN_MS + 500, stdout: 'ok' }),
    _artifactProduced: async () => true,
    ...over,
  };
}

describe('session-record — honest real-user-path producer', () => {
  test('a genuine product run + artifact is accepted and emits a real-user-path T7 outcome', async () => {
    const matrix = makeMatrix();
    const r = await runSessionRecord(base(matrix, { write: true, _writeMatrix: async () => { /* ok */ } }));
    assert.equal(r.accepted, true);
    assert.equal(r.wrote, true);
    assert.equal(r.outcome?.tier, 'T7');
    assert.equal(r.outcome?.kind, 'runtime-exec'); // runtime-exec consumes `command`; e2e-workflow needs steps[]
    assert.deepEqual(r.outcome?.input_source, { type: 'real-user-path', description: r.outcome?.input_source && (r.outcome.input_source as { description: string }).description });
    assert.equal((r.outcome?.input_source as { type: string }).type, 'real-user-path');
    assert.equal(r.outcome?.required_callsite, 'src/core/forge-engine.ts');
  });

  test('--write replaces the scaffold stub with the real outcome', async () => {
    const matrix = makeMatrix();
    let written: CompeteMatrix | null = null;
    await runSessionRecord(base(matrix, { write: true, _writeMatrix: async (m) => { written = m; } }));
    const outcomes = (written as unknown as { dimensions: Array<{ outcomes: Array<Record<string, unknown>> }> })!.dimensions[0]!.outcomes;
    assert.equal(outcomes.length, 1, 'scaffold stub dropped, one real outcome remains');
    assert.equal(outcomes[0]!._scaffold, undefined);
    assert.equal((outcomes[0]!.input_source as { type: string }).type, 'real-user-path');
  });

  test('REJECTS a test-runner command (cannot be real-user-path)', async () => {
    const r = await runSessionRecord(base(makeMatrix(), { run: 'npx tsx --test tests/forge.test.ts' }));
    assert.equal(r.accepted, false);
    assert.match(r.reason, /test-runner/);
  });

  test('REJECTS a failed run', async () => {
    const r = await runSessionRecord(base(makeMatrix(), { _runCommand: async () => ({ exitCode: 1, durationMs: 3000, stdout: '' }) }));
    assert.equal(r.accepted, false);
    assert.match(r.reason, /exited 1/);
  });

  test('REJECTS an instant run (< min duration)', async () => {
    const r = await runSessionRecord(base(makeMatrix(), { _runCommand: async () => ({ exitCode: 0, durationMs: 40, stdout: 'ok' }) }));
    assert.equal(r.accepted, false);
    assert.match(r.reason, /Too fast/);
  });

  test('REJECTS a run that produced no observable artifact', async () => {
    const r = await runSessionRecord(base(makeMatrix(), { _artifactProduced: async () => false }));
    assert.equal(r.accepted, false);
    assert.match(r.reason, /artifact/);
  });

  test('dry-run accepts but does not write', async () => {
    let wrote = false;
    const r = await runSessionRecord(base(makeMatrix(), { write: false, _writeMatrix: async () => { wrote = true; } }));
    assert.equal(r.accepted, true);
    assert.equal(r.wrote, false);
    assert.equal(wrote, false);
  });
});
