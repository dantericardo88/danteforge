import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runEvidenceScaffold } from '../src/cli/commands/evidence-scaffold.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

// Build a minimal matrix. Each dim already carries a capability_test so the
// capability-test loop is a no-op and the test isolates the NEW outcome-scaffold
// behaviour (the 7→9 depth-path requirement baked into the matrix build).
function makeMatrix(dims: Array<{ id: string; label: string; outcomes?: unknown[] }>): CompeteMatrix {
  return {
    dimensions: dims.map(d => ({
      id: d.id,
      label: d.label,
      capability_test: { command: 'true', description: 'present', timeoutMs: 1000 },
      ...(d.outcomes ? { outcomes: d.outcomes } : {}),
    })),
  } as unknown as CompeteMatrix;
}

function run(matrix: CompeteMatrix, opts: { dryRun?: boolean } = {}) {
  let written: CompeteMatrix | null = null;
  return runEvidenceScaffold({
    cwd: '/tmp/fake-project',
    dryRun: opts.dryRun,
    projectType: 'custom',
    _loadMatrix: async () => matrix,
    _writeFile: async () => { /* no-op: no cap-test stubs in this suite */ },
    _writeMatrix: async (m) => { written = m; },
    _createTimeMachineCommit: null, // disable Time Machine in tests
    _detectProbes: () => [], // isolate from real-disk product-probe detection
  }).then(result => ({ result, written, matrix }));
}

describe('evidence-scaffold: outcome stubs (7→9 depth-path requirement)', () => {
  test('a receipt-eligible dim without outcomes gets a failing T5 scaffold stub', async () => {
    const matrix = makeMatrix([{ id: 'testing', label: 'Testing' }]);
    const { result, written } = await run(matrix);

    assert.deepEqual(result.outcomeStubsGenerated, ['testing']);
    const dim = (written as unknown as { dimensions: Array<Record<string, unknown>> })!.dimensions[0]!;
    const outcomes = dim.outcomes as Array<Record<string, unknown>>;
    assert.equal(outcomes.length, 1);
    const o = outcomes[0]!;
    assert.equal(o.tier, 'T5');
    assert.equal(o.kind, 'shell');
    assert.equal(o.command, 'exit 1', 'stub must fail by construction — cannot inflate');
    assert.equal(o._scaffold, true);
    assert.equal(o.id, 'testing-t5-scaffold');
    assert.ok(String(o.description).startsWith('SCAFFOLD'));
  });

  test('market-cap dims are skipped (clamped to 5.0, so an outcome is pointless)', async () => {
    const matrix = makeMatrix([
      { id: 'community_adoption', label: 'Community Adoption' },
      { id: 'enterprise_readiness', label: 'Enterprise Readiness' },
    ]);
    const { result, written } = await run(matrix);

    assert.deepEqual(result.outcomeStubsGenerated, []);
    assert.ok(result.skipped.includes('community_adoption'));
    assert.ok(result.skipped.includes('enterprise_readiness'));
    // Nothing eligible → matrix not dirty → not written.
    assert.equal(written, null, 'market-only matrix must not be rewritten');
    for (const dim of (matrix as unknown as { dimensions: Array<Record<string, unknown>> }).dimensions) {
      assert.equal(dim.outcomes, undefined, 'market dims must not receive outcome stubs');
    }
  });

  test('dims that already declare outcomes are left untouched', async () => {
    const realOutcome = [{ id: 'testing-real', tier: 'T5', kind: 'shell', command: 'npm test' }];
    const matrix = makeMatrix([{ id: 'testing', label: 'Testing', outcomes: realOutcome }]);
    const { result, written } = await run(matrix);

    assert.deepEqual(result.outcomeStubsGenerated, []);
    assert.deepEqual(result.outcomesAlreadyHave, ['testing']);
    const dim = (written as unknown as { dimensions: Array<Record<string, unknown>> } | null);
    // With nothing dirty, writeMatrix is not called — assert the original is unchanged.
    const outcomes = (matrix as unknown as { dimensions: Array<Record<string, unknown>> }).dimensions[0]!.outcomes as Array<Record<string, unknown>>;
    assert.equal(outcomes[0]!.id, 'testing-real');
    assert.equal(dim, null);
  });

  test('dry-run reports the stub but does not mutate the matrix', async () => {
    const matrix = makeMatrix([{ id: 'security', label: 'Security' }]);
    const { result, written } = await run(matrix, { dryRun: true });

    assert.deepEqual(result.outcomeStubsGenerated, ['security']);
    assert.equal(written, null, 'dry-run must not write the matrix');
    const dim = (matrix as unknown as { dimensions: Array<Record<string, unknown>> }).dimensions[0]!;
    assert.equal(dim.outcomes, undefined, 'dry-run must not mutate the dim in place');
  });
});
