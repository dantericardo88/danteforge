import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runMigrateOutcomes, classifyForMigration } from '../src/cli/commands/migrate-outcomes.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

const fileCheck = `node -e "const c=require('fs').readFileSync('src/foo.ts','utf8');if(!c.includes('bar'))process.exit(1)"`;

describe('classifyForMigration — honest, never-raises classification', () => {
  test('already-declared outcome is left untouched', () => {
    assert.equal(classifyForMigration({ input_source: { type: 'real-user-path', description: 'x' } }).bucket, 'already');
  });

  test('structural file check → synthetic-fixture', () => {
    const c = classifyForMigration({ kind: 'runtime-exec', command: fileCheck });
    assert.equal(c.bucket, 'synthetic');
  });

  test('test-suite command → synthetic-fixture', () => {
    assert.equal(classifyForMigration({ kind: 'shell', command: 'npx tsx --test tests/a.test.ts' }).bucket, 'synthetic');
  });

  test('registered external benchmark → external-benchmark', () => {
    const c = classifyForMigration({ kind: 'external-benchmark', benchmark: 'swe-bench', command: 'run' });
    assert.equal(c.bucket, 'external');
  });

  test('genuine CLI invocation → candidate (NOT auto-assigned real-user-path)', () => {
    assert.equal(classifyForMigration({ kind: 'runtime-exec', command: 'node dist/index.js go' }).bucket, 'candidate');
  });

  test('unclassified shell → synthetic (conservative, can only lower/hold)', () => {
    assert.equal(classifyForMigration({ kind: 'shell', command: 'echo hi' }).bucket, 'synthetic');
  });
});

function makeMatrix(): CompeteMatrix {
  return {
    dimensions: [
      { id: 'd1', label: 'D1', outcomes: [{ id: 'o1', tier: 'T5', kind: 'runtime-exec', command: fileCheck }] },
      { id: 'd2', label: 'D2', outcomes: [{ id: 'o2', tier: 'T7', kind: 'runtime-exec', command: 'node dist/index.js go' }] },
      { id: 'd3', label: 'D3', outcomes: [{ id: 'o3', tier: 'T8', kind: 'external-benchmark', benchmark: 'exercism', command: 'run' }] },
      { id: 'd4', label: 'D4', outcomes: [{ id: 'o4', tier: 'T5', kind: 'runtime-exec', command: 'node dist/index.js x', input_source: { type: 'real-user-path', description: 'set' } }] },
    ],
  } as unknown as CompeteMatrix;
}

describe('runMigrateOutcomes', () => {
  test('dry-run classifies but does not mutate the matrix', async () => {
    const matrix = makeMatrix();
    let wrote = false;
    const r = await runMigrateOutcomes({
      cwd: '/tmp/fake', write: false,
      _loadMatrix: async () => matrix,
      _writeMatrix: async () => { wrote = true; },
    });
    assert.equal(wrote, false);
    assert.equal(r.wrote, false);
    assert.deepEqual(r.synthetic, ['d1/o1']);
    assert.deepEqual(r.externalBenchmark, ['d3/o3']);
    assert.deepEqual(r.realUserPathCandidates, ['d2/o2']);
    assert.deepEqual(r.alreadyDeclared, ['d4/o4']);
    // matrix untouched
    const o1 = (matrix as unknown as { dimensions: Array<{ outcomes: Array<Record<string, unknown>> }> }).dimensions[0]!.outcomes[0]!;
    assert.equal(o1.input_source, undefined);
  });

  test('--write applies synthetic + external annotations but NOT candidates', async () => {
    const matrix = makeMatrix();
    let written: CompeteMatrix | null = null;
    const r = await runMigrateOutcomes({
      cwd: '/tmp/fake', write: true,
      _loadMatrix: async () => matrix,
      _writeMatrix: async (m) => { written = m; },
    });
    assert.equal(r.wrote, true);
    assert.ok(written);
    const dims = (written as unknown as { dimensions: Array<{ id: string; outcomes: Array<Record<string, unknown>> }> }).dimensions;
    // d1 structural → synthetic-fixture
    assert.deepEqual(dims[0]!.outcomes[0]!.input_source, { type: 'synthetic-fixture', fixture_id: 'legacy-structural-check' });
    // d2 CLI candidate → left undeclared (never auto-raised)
    assert.equal(dims[1]!.outcomes[0]!.input_source, undefined);
    // d3 registered benchmark → external-benchmark
    assert.deepEqual(dims[2]!.outcomes[0]!.input_source, { type: 'external-benchmark', suite: 'exercism' });
    // d4 already declared → unchanged
    assert.deepEqual(dims[3]!.outcomes[0]!.input_source, { type: 'real-user-path', description: 'set' });
  });
});
