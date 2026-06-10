// polyglot-test-runner-cap.test.ts
// The gate must recognize Rust/Go/Python/.NET/JVM test runners as TEST SUITES and
// cap them at T4/7.0 — otherwise a `cargo test` / `pytest` / `go test` declared
// kind:runtime-exec escapes to the 8.0 default (silent over-credit). And it must
// NOT false-cap a real product run that merely mentions a test-ish word.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isTestSuiteCommand, classifyOutcomeKind } from '../src/matrix/engines/outcome-quality.js';
import type { Outcome } from '../src/matrix/types/outcome.js';

const rt = (command: string): Outcome =>
  ({ id: 'o', kind: 'runtime-exec', tier: 'T5', command } as unknown as Outcome);

describe('polyglot test-runner detection caps non-JS test suites at T4', () => {
  const runners = [
    'cargo test -p dante-endpoint --lib snapshot',
    'cargo nextest run',
    'go test ./internal/scanner',
    'pytest tests/test_hunter.py',
    'python -m pytest tests/',
    'python3 -m unittest discover',
    'dotnet test',
    'gradle test',
    'mvn test',
    'rspec spec/',
    'phpunit tests/',
  ];
  for (const cmd of runners) {
    test(`recognizes + caps at 7.0: ${cmd}`, () => {
      assert.equal(isTestSuiteCommand(cmd), true, `must be detected as a test suite: ${cmd}`);
      assert.equal(classifyOutcomeKind(rt(cmd)).maxScore, 7.0, `must cap at T4/7.0: ${cmd}`);
    });
  }

  test('JS runners still detected (no regression)', () => {
    for (const cmd of ['npx tsx --test tests/x.test.ts', 'jest', 'vitest run', 'npm test']) {
      assert.equal(isTestSuiteCommand(cmd), true, cmd);
    }
  });

  test('real PRODUCT runs are NOT false-capped (cargo run / a real CLI / go build)', () => {
    for (const cmd of ['cargo run --release', 'go build ./...', 'node dist/index.js validate dim013', './target/release/dante-endpoint --scan']) {
      assert.equal(isTestSuiteCommand(cmd), false, `must NOT be flagged as a test suite: ${cmd}`);
    }
    // a real product run with a real-user-path can still reach 9.0 — proves no over-cap
    const product = { id: 'o', kind: 'runtime-exec', tier: 'T5', command: 'node dist/index.js scan --input real.json',
      input_source: { type: 'real-user-path' } } as unknown as Outcome;
    assert.equal(classifyOutcomeKind(product).maxScore, 9.0, 'a real product run must NOT be capped at T4');
  });
});
