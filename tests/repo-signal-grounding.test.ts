import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectStack,
  groundDimFromSignals,
  gatherRepoSignals,
  type RepoSignals,
} from '../src/matrix-orchestration/analysis/repo-signal-grounding.ts';

const base: RepoSignals = {
  stack: 'node', buildPasses: null, typecheckPasses: null, lintPasses: null,
  testsPresent: false, testsPass: null, hasCI: false, hasReadme: false,
};

test('detectStack reads marker files', () => {
  assert.equal(detectStack(p => p === 'package.json'), 'node');
  assert.equal(detectStack(p => p === 'pyproject.toml'), 'python');
  assert.equal(detectStack(p => p === 'Cargo.toml'), 'rust');
  assert.equal(detectStack(() => false), 'unknown');
});

test('a dim with NO matching real signal is UNSCORED (null) — never a fabricated number', () => {
  // testing dim, no tests gathered → null
  assert.equal(groundDimFromSignals('testing', 'test_coverage', base).score, null);
  // a subjective dim with no automatable signal → null + the honest reason
  const g = groundDimFromSignals('ux', 'visual_polish', base);
  assert.equal(g.score, null);
  assert.match(g.basis, /needs LLM assess or human/);
});

test('grounded scores trace to a real signal and cap at 7.0 (T4 doctrine)', () => {
  const green: RepoSignals = { ...base, buildPasses: true, typecheckPasses: true, lintPasses: true, testsPass: true, testsPresent: true };
  assert.equal(groundDimFromSignals('testing', 't', green).score, 7.0);
  assert.equal(groundDimFromSignals('core_functionality', 'f', green).score, 7.0);
  assert.equal(groundDimFromSignals('maintainability', 'm', green).score, 7.0);
  // never exceeds 7.0 even with every signal green
  for (const d of ['testing', 'functionality', 'maintainability', 'docs', 'ci']) {
    const s = groundDimFromSignals(d, d, green).score;
    if (s !== null) assert.ok(s <= 7.0, `${d} grounded above the T4 cap`);
  }
});

test('a FAILING real signal grounds LOW (honest deflation, not omission)', () => {
  const red: RepoSignals = { ...base, buildPasses: false, testsPass: false, testsPresent: true };
  assert.equal(groundDimFromSignals('testing', 't', red).score, 3.0);
  assert.equal(groundDimFromSignals('functionality', 'f', red).score, 3.0);
});

test('gatherRepoSignals: a throwing/timed-out check yields null (never an assumed pass)', async () => {
  const s = await gatherRepoSignals({
    exists: (p) => p === 'package.json' || p === 'tsconfig.json' || p === 'README.md',
    run: async (cmd) => { if (cmd.includes('tsc')) throw new Error('timeout'); return 0; },
  });
  assert.equal(s.stack, 'node');
  assert.equal(s.buildPasses, null);      // Node build is NOT a gathered signal (--if-present false-pass dropped)
  assert.equal(s.typecheckPasses, null);  // tsc threw → null, not a false pass
  assert.equal(s.testsPass, null);        // runTests not set → never run
  assert.equal(s.hasReadme, true);
});

test('node typecheck WITHOUT tsconfig.json is null, never a fabricated pass', async () => {
  // A Node repo with no tsconfig: even if `tsc` would exit 0, we must NOT claim a clean typecheck.
  let tscRan = false;
  const s = await gatherRepoSignals({
    exists: (p) => p === 'package.json', // no tsconfig.json
    run: async (cmd) => { if (cmd.includes('tsc')) { tscRan = true; return 0; } return 0; },
  });
  assert.equal(s.typecheckPasses, null, 'no tsconfig → typecheck must be unscored, not a false pass');
  assert.equal(tscRan, false, 'tsc must not even run without a tsconfig');
});

test('gatherRepoSignals only runs the test suite when runTests is opt-in', async () => {
  let ranTest = false;
  await gatherRepoSignals({
    exists: () => true,
    run: async (cmd) => { if (cmd.includes('test')) ranTest = true; return 0; },
  });
  assert.equal(ranTest, false, 'arbitrary test suite must not run without explicit opt-in (council hardware-risk guard)');
});
