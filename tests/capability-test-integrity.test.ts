import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { auditCapabilityTest, summarizeYardsticks, type YardstickAudit } from '../src/matrix/engines/capability-test-integrity.js';

// The wired-basename set the real auditor builds from production imports; here we provide it directly.
const WIRED = new Set(['memory_inject', 'data-privacy-engine', 'derived-score']);

function dim(id: string, command: string | undefined, callsites: string[] = []): Parameters<typeof auditCapabilityTest>[0] {
  return {
    id,
    capability_test: command === undefined ? undefined : { command },
    outcomes: callsites.map((cs, i) => ({ id: `o${i}`, required_callsite: cs })),
  };
}

describe('auditCapabilityTest — the yardstick stub detector', () => {
  test('SELF_FULFILLING_STUB: a script with NO wired production callsite (the fleet failure mode)', () => {
    const a = auditCapabilityTest(dim('dim011', 'python scripts/dante.py test memory-injection', []), WIRED, true);
    assert.equal(a.verdict, 'SELF_FULFILLING_STUB');
    assert.equal(a.needsAuthoring, true);
  });

  test('REAL_TEST: same kind of command but exercising a WIRED production callsite', () => {
    const a = auditCapabilityTest(dim('dim011', 'cargo test -p dante-endpoint --lib memory_inject', ['src/endpoint/src/memory_inject.rs']), WIRED, true);
    assert.equal(a.verdict, 'REAL_TEST');
    assert.equal(a.needsAuthoring, false);
    assert.deepEqual(a.wiredCallsites, ['src/endpoint/src/memory_inject.rs']);
  });

  test('REAL_PRODUCT_PROBE: invoking the real product CLI', () => {
    const a = auditCapabilityTest(dim('ecosystem_mcp', 'node dist/index.js mcp-tools --json', []), WIRED, true);
    assert.equal(a.verdict, 'REAL_PRODUCT_PROBE');
    assert.equal(a.needsAuthoring, false);
  });

  test('STRUCTURAL_ONLY: a readFileSync existence check cannot exceed 7.0', () => {
    const a = auditCapabilityTest(dim('docs', 'node -e "require(\'fs\').readFileSync(\'README.md\')"', []), WIRED, true);
    assert.equal(a.verdict, 'STRUCTURAL_ONLY');
    assert.equal(a.needsAuthoring, true);
  });

  test('SCAFFOLD: a literal exit-1 placeholder', () => {
    const a = auditCapabilityTest(dim('dim003', 'exit 1', []), WIRED, false);
    assert.equal(a.verdict, 'SCAFFOLD');
    assert.equal(a.needsAuthoring, true);
  });

  test('NONE: no capability_test declared', () => {
    const a = auditCapabilityTest(dim('x', undefined, []), WIRED, false);
    assert.equal(a.verdict, 'NONE');
    assert.equal(a.needsAuthoring, true);
  });

  test('a test file as the callsite does NOT count as a wired production callsite', () => {
    // memory_inject.test.ts is a test file — even if its basename matched, tests are not production.
    const a = auditCapabilityTest(dim('dim011', 'npx tsx --test tests/x.test.ts', ['tests/memory_inject.test.ts']), WIRED, true);
    assert.equal(a.verdict, 'SELF_FULFILLING_STUB', 'a test-file callsite is not production wiring');
  });

  test('summarizeYardsticks counts verdicts', () => {
    const audits: YardstickAudit[] = [
      auditCapabilityTest(dim('a', 'exit 1'), WIRED, false),
      auditCapabilityTest(dim('b', 'node dist/index.js gap a'), WIRED, true),
      auditCapabilityTest(dim('c', 'python t.py'), WIRED, true),
    ];
    const s = summarizeYardsticks(audits);
    assert.equal(s.SCAFFOLD, 1);
    assert.equal(s.REAL_PRODUCT_PROBE, 1);
    assert.equal(s.SELF_FULFILLING_STUB, 1);
  });
});
