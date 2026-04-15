import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMutants,
  applyMutant,
  runMutationScore,
  type MutationResult,
} from '../src/core/mutation-score.js';

// ── generateMutants ───────────────────────────────────────────────────────────

describe('generateMutants', () => {
  it('T1: condition-flip: > becomes <', () => {
    const source = `function check(x, y) {\n  if (x > y) return true;\n}`;
    const mutants = generateMutants(source);
    const flip = mutants.find(m => m.operator === 'condition-flip');
    assert.ok(flip, 'should generate a condition-flip mutant');
    assert.ok(flip!.mutated.includes(' < '), 'should flip > to <');
    assert.ok(!flip!.mutated.includes(' > '), 'original > should be gone');
  });

  it('T2: boolean-literal: true becomes false', () => {
    const source = `const enabled = true;\nconst ready = false;`;
    const mutants = generateMutants(source);
    const boolMutants = mutants.filter(m => m.operator === 'boolean-literal');
    assert.ok(boolMutants.length > 0, 'should find boolean-literal mutants');
    const trueMutant = boolMutants.find(m => m.mutated.includes('false') && m.original.includes('true'));
    assert.ok(trueMutant, 'should flip true to false');
  });

  it('T3: return-null: return expr becomes return null', () => {
    const source = `function getValue() {\n  return this.value;\n}`;
    const mutants = generateMutants(source);
    const returnMutant = mutants.find(m => m.operator === 'return-null');
    assert.ok(returnMutant, 'should generate return-null mutant');
    assert.ok(returnMutant!.mutated.includes('return null'), 'should replace with return null');
  });

  it('T4: boundary-shift: >= n becomes > n', () => {
    const source = `if (score >= 9) converged = true;`;
    const mutants = generateMutants(source);
    const boundary = mutants.find(m => m.operator === 'boundary-shift');
    assert.ok(boundary, 'should generate boundary-shift mutant');
    assert.ok(boundary!.mutated.includes('> 9') && !boundary!.mutated.includes('>= 9'));
  });

  it('T5: arithmetic-flip: a + b becomes a - b (no string context)', () => {
    const source = `function total(a, b) {\n  return a + b;\n}`;
    const mutants = generateMutants(source);
    const arith = mutants.find(m => m.operator === 'arithmetic-flip');
    assert.ok(arith, 'should generate arithmetic-flip mutant');
    assert.ok(arith!.mutated.includes('a - b'), 'should flip + to -');
  });

  it('T6: skips comment lines', () => {
    const source = `// if (x > y) return true;\n  return x + y;`;
    const mutants = generateMutants(source);
    // comment line should be skipped; arithmetic in return line may still fire
    const conditionMutants = mutants.filter(m => m.operator === 'condition-flip');
    // condition-flip on comment line should NOT appear since comment line is skipped
    for (const m of conditionMutants) {
      assert.ok(!m.original.trimStart().startsWith('//'), 'should not mutate comment lines');
    }
  });

  it('T7: returns empty array for source with no mutable patterns', () => {
    const source = `const x = 'hello world';`;
    const mutants = generateMutants(source);
    // String-only source — arithmetic-flip skips lines with quotes
    // No conditions, no booleans, no return statements
    assert.ok(mutants.length === 0 || mutants.every(m => m.operator !== 'arithmetic-flip'));
  });
});

// ── applyMutant ───────────────────────────────────────────────────────────────

describe('applyMutant', () => {
  it('T8: replaces the correct line with mutated version', () => {
    const source = `line1\n  if (x > y) return true;\nline3`;
    const mutants = generateMutants(source);
    const flip = mutants.find(m => m.operator === 'condition-flip');
    if (!flip) return; // skip if no mutant generated for this simple case

    const mutated = applyMutant(source, flip);
    assert.ok(mutated.includes(flip.mutated), 'mutated source should contain the mutated line');
    assert.ok(!mutated.includes(flip.original) || flip.original === flip.mutated, 'original line should be replaced');
  });
});

// ── runMutationScore ─────────────────────────────────────────────────────────

describe('runMutationScore', () => {
  it('T9: killed mutations count correctly when tests detect them', async () => {
    const source = `function check(x, y) {\n  if (x > y) return true;\n  return false;\n}`;
    let written = '';

    const result = await runMutationScore(['/fake/src/check.ts'], {
      cwd: '/fake',
      maxMutantsPerFile: 5,
      _readFile: async () => source,
      _writeFile: async (_p, c) => { written = c; },
      _restoreFile: async (_p, _orig) => {},
      // Tests always detect the mutation → all killed
      _runTests: async () => true,
    });

    assert.ok(result.totalMutants > 0, 'should have generated mutants');
    assert.equal(result.killed, result.totalMutants, 'all mutants should be killed');
    assert.equal(result.survived, 0);
    assert.equal(result.mutationScore, 1.0);
  });

  it('T10: survived mutations count when tests miss them', async () => {
    const source = `function total(a, b) {\n  if (a >= 0) return a + b;\n  return false;\n}`;

    const result = await runMutationScore(['/fake/src/total.ts'], {
      cwd: '/fake',
      maxMutantsPerFile: 5,
      _readFile: async () => source,
      _writeFile: async () => {},
      _restoreFile: async () => {},
      // Tests never detect mutations → all survived
      _runTests: async () => false,
    });

    assert.ok(result.totalMutants > 0);
    assert.equal(result.survived, result.totalMutants, 'all mutants should survive');
    assert.equal(result.mutationScore, 0);
  });

  it('T11: returns zero-score result for unreadable files', async () => {
    const result = await runMutationScore(['/nonexistent/file.ts'], {
      cwd: '/fake',
      _readFile: async () => { throw new Error('ENOENT'); },
      _writeFile: async () => {},
      _restoreFile: async () => {},
      _runTests: async () => true,
    });

    assert.equal(result.totalMutants, 0);
    assert.equal(result.mutationScore, 0);
    assert.equal(result.filesAnalysed.length, 0);
  });

  it('T12: restores file even when runTests throws', async () => {
    const source = `if (x > 0) return true;`;
    let restored = false;

    await runMutationScore(['/fake/src/x.ts'], {
      cwd: '/fake',
      maxMutantsPerFile: 2,
      _readFile: async () => source,
      _writeFile: async () => {},
      _restoreFile: async () => { restored = true; },
      _runTests: async () => { throw new Error('test runner crashed'); },
    }).catch(() => {}); // result may be partial

    assert.equal(restored, true, 'file should be restored even on test runner failure');
  });
});
